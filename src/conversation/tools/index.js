import { createHash } from 'node:crypto';
import { TOOL_LIMITS, TERMINAL_STATES, canonicalJson, invariant, sourceRef, ProtocolError } from '../../../public/shared/conversation/schemas/index.js';
import { memoryProposal } from '../memory/index.js';
import { rollDice } from './dice.js';

const string = maxLength => ({ type: 'string', minLength: 1, maxLength });
const schema = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const DEFINITIONS = [
    { name: 'recall_memory', description: 'Search current conversation history and memories with versioned sources.', parameters: schema({ query: string(4096) }) },
    { name: 'search_lore', description: 'Search configured worldbooks with resource and entry references.', parameters: schema({ query: string(4096) }) },
    { name: 'update_memory', description: 'Propose an automatic memory change for successful turn finalization.', parameters: schema({ block: { type: 'object', properties: { id: string(128), expectedBlockRevision: { type: 'integer', minimum: 0 }, kind: { type: 'string', enum: ['character', 'relationship', 'world-state', 'timeline', 'user-fact'] } }, additionalProperties: false }, op: { type: 'string', enum: ['create', 'update', 'delete'] }, content: { type: 'string', maxLength: 8000 } }) },
    { name: 'roll_dice', description: 'Roll bounded dice expressions, e.g. 2d6+3; results are persisted once.', parameters: schema({ expr: string(200) }) },
    { name: 'get_time', description: 'Get the current time in the configured user time zone.', parameters: schema({}) },
    { name: 'generate_image', description: 'Generate an image using the configured image provider.', parameters: schema({ prompt: string(8000) }) },
];
function sessionLimits(settings) {
    const configured = settings?.toolLimits;
    invariant(configured === undefined || (configured !== null && typeof configured === 'object' && !Array.isArray(configured)),
        'invalid-tool-limits', 'toolLimits must be an object');
    for (const [key, value] of Object.entries(configured ?? {})) {
        invariant(Object.hasOwn(TOOL_LIMITS, key) && Number.isSafeInteger(value) && value > 0 && value <= TOOL_LIMITS[key],
            'invalid-tool-limits', 'Tool limits must be positive integers within the hard limits', 400, { key, maximum: TOOL_LIMITS[key] });
    }
    return Object.freeze({ ...TOOL_LIMITS, ...configured });
}

const DEFAULTS = ['recall_memory', 'search_lore', 'roll_dice', 'get_time'];
function validate(value, definition) {
    if (definition.type === 'object') {
        invariant(value && typeof value === 'object' && !Array.isArray(value), 'invalid-tool-args', 'Expected object');
        invariant(Object.keys(value).every(key => Object.hasOwn(definition.properties, key)), 'invalid-tool-args', 'Unknown tool argument');
        for (const key of definition.required ?? []) invariant(Object.hasOwn(value, key), 'invalid-tool-args', 'Missing tool argument');
        for (const [key, item] of Object.entries(value)) validate(item, definition.properties[key]);
    } else if (definition.type === 'string') {
        invariant(typeof value === 'string' && value.length >= (definition.minLength ?? 0) && value.length <= (definition.maxLength ?? 100000) && (!definition.enum || definition.enum.includes(value)), 'invalid-tool-args', 'Invalid string argument');
    } else if (definition.type === 'integer') invariant(Number.isSafeInteger(value) && value >= definition.minimum, 'invalid-tool-args', 'Invalid integer argument');
}

export function createToolRegistry({ store, retrieval, memory, resources, image, now = Date.now, random = Math.random }) {
    const sessions = new Map();
    const inFlight = new Map();
    function definitions({ type = 'send', enabled } = {}) {
        if (!['send', 'regenerate', 'group'].includes(type)) return [];
        const names = enabled === undefined ? DEFAULTS : Array.isArray(enabled) ? enabled : Object.keys(enabled).filter(key => enabled[key] === true);
        return structuredClone(DEFINITIONS.filter(d => names.includes(d.name)));
    }
    function active(turnId, conversationId, epoch) {
        const turn = store.getTurn(turnId);
        const snapshot = store.getConversation(conversationId);
        invariant(turn.conversationId === conversationId && snapshot.conversation.activeTurnId === turnId && !TERMINAL_STATES.includes(turn.status) && !turn.cancelRequested && (epoch === undefined || turn.attemptEpoch === epoch),
            'turn-inactive', 'Tool turn is no longer active', 409);
        return { turn, snapshot };
    }
    function session(turnId, conversationId, frozenSnapshot) {
        const { turn, snapshot } = active(turnId, conversationId);
        let state = sessions.get(turnId);
        if (!state) {
            const input = structuredClone(frozenSnapshot ?? (store.getSnapshot ? store.getSnapshot(turn.snapshotId) : snapshot));
            state = { epoch: turn.attemptEpoch, snapshot: input, limits: sessionLimits(input.settings), startedAt: now(), round: 1, calls: new Map(), total: 0, proposals: new Map(), artifacts: new Map() };
            sessions.set(turnId, state);
        }
        invariant(state.epoch === turn.attemptEpoch, 'turn-inactive', 'Tool attempt changed', 409);
        invariant(now() - state.startedAt < state.limits.turnTimeoutMs, 'tool-limit', 'Turn tool deadline exceeded', 409);
        return { state, turn };
    }
    function fatal(state, code, details = {}) {
        const error = new ProtocolError(code, 'Tool outcome requires explicit recovery; automatic execution stopped', 409, details);
        error.fatal = true; error.retryable = false;
        state.fatal ??= error;
        try { state.onFatal?.(state.fatal); } catch { /* Preserve the domain failure. */ }
        return state.fatal;
    }
    function imageRecovery(conversationId, recordId) {
        const record = store.getTool(recordId);
        invariant(record?.conversationId === conversationId && record.name === 'generate_image', 'invalid-tool', 'Image record belongs to another operation', 409);
        const jobs = store.listJobs(conversationId).filter(job => job.kind === 'provider-request' && job.dependencies?.origin === record.id);
        invariant(jobs.length <= 1, 'provider-job-conflict', 'Ambiguous provider job', 409);
        const job = jobs[0];
        return { recordId, turnId: record.turnId, memberRunId: record.memberRunId ?? null, status: record.status,
            jobRecordId: job?.id ?? null, canResume: Boolean(job?.payload?.jobId) && record.status === 'unknown' && !['completed', 'cancelled'].includes(job.payload.state),
            canCancel: Boolean(job?.payload?.jobId) && !['completed', 'cancelled'].includes(job.payload.state),
            resubmitAllowed: false, ...(job?.payload?.jobId ? {} : { blockedReason: 'provider-job-handle-missing' }) };
    }
    function guardImageRetry(turn, memberRunId, args, state) {
        if (!turn.request?.retryTurnId) return;
        if (typeof store.listTools !== 'function') throw fatal(state, 'tool-retry-history-unavailable');
        const character = (item, member) => member == null ? null : item.plannedMembers?.find(m => m.id === member)?.characterId
            ?? item.members?.find(m => m.memberRunId === member)?.characterId;
        const identity = character(turn, memberRunId);
        const visited = new Set([turn.id]);
        let id = turn.request.retryTurnId, cached;
        const records = store.listTools(turn.conversationId);
        while (id) {
            invariant(!visited.has(id), 'invalid-retry', 'Cyclic retry chain', 409); visited.add(id);
            const ancestor = store.getTurn(id);
            invariant(ancestor?.conversationId === turn.conversationId, 'invalid-retry', 'Retry turn belongs to another conversation', 409);
            for (const record of records) {
                if (record.turnId !== id || record.name !== 'generate_image' || canonicalJson(record.args) !== canonicalJson(args)
                    || !['intent', 'running', 'unknown', 'completed'].includes(record.status)) continue;
                const priorIdentity = character(ancestor, record.memberRunId);
                const sameMember = memberRunId == null ? record.memberRunId == null
                    : record.memberRunId === memberRunId || identity === undefined || priorIdentity === undefined || identity === priorIdentity;
                if (!sameMember) continue;
                if (record.status !== 'completed') throw fatal(state, 'tool-result-unknown', { recordId: record.id, recovery: 'existing-provider-job-only' });
                // An unresolved identity may conservatively block a charge, but
                // must never authorize returning another member's saved image.
                if (memberRunId != null && record.memberRunId !== memberRunId && (identity === undefined || priorIdentity === undefined))
                    throw fatal(state, 'tool-retry-identity-unknown', { recordId: record.id });
                if (!record.result || typeof record.result !== 'object' || !Array.isArray(record.result.images))
                    throw fatal(state, 'tool-result-unknown', { recordId: record.id, recovery: 'existing-provider-job-only' });
                cached ??= record;
            }
            id = ancestor.request?.retryTurnId;
        }
        return cached;
    }
    function beginRound({ turnId, conversationId, round }) {
        const { state } = session(turnId, conversationId);
        invariant(Number.isSafeInteger(round) && round >= state.round && round <= state.limits.rounds, 'tool-limit', 'Tool round limit exceeded', 409);
        state.round = round;
    }
    function bounded(result, record, limits) {
        const text = JSON.stringify(result);
        if (Buffer.byteLength(text) <= limits.resultBytes) return result;
        invariant(Buffer.byteLength(JSON.stringify({ truncated: true, preview: '', resultRef: record.id })) <= limits.resultBytes,
            'tool-result-limit', 'Tool result limit is too small to return a stored-result reference', 409);
        let preview = text.slice(0, limits.resultBytes / 4);
        while (Buffer.byteLength(JSON.stringify({ truncated: true, preview, resultRef: record.id })) > limits.resultBytes) preview = preview.slice(0, Math.floor(preview.length * 0.8));
        return { truncated: true, preview, resultRef: record.id };
    }
    function rememberArtifacts(state, record) {
        if (record.name === 'generate_image' && record.status === 'completed') state.artifacts.set(record.id, record.memberRunId ?? null);
    }
    function toolArtifacts(turnId, memberRunId) {
        const state = sessions.get(turnId);
        if (!state || store.getTurn(turnId)?.attemptEpoch !== state.epoch) return [];
        const refs = new Map();
        for (const [recordId, member] of state.artifacts) {
            if (memberRunId !== undefined && member !== memberRunId) continue;
            const record = store.getTool(recordId);
            if (record?.status !== 'completed' || record.name !== 'generate_image' || record.turnId !== turnId || (record.memberRunId ?? null) !== member) continue;
            for (const image of Array.isArray(record.result?.images) ? record.result.images : []) {
                if (!image || image.external || image.url || image.externalURL || image.externalUrl) continue;
                const id = image.attachmentId ?? image.id;
                if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id) || typeof store.getAttachment !== 'function') continue;
                let registered;
                try { registered = store.getAttachment(id); } catch { continue; }
                // Only authoritative registered metadata crosses into assistant media.
                if (registered?.id !== id || typeof registered.mime !== 'string' || !registered.mime.startsWith('image/')
                    || typeof registered.name !== 'string' || !Number.isSafeInteger(registered.size) || registered.size < 0) continue;
                refs.set(id, { type: 'image', attachmentId: id, mimeType: registered.mime, name: registered.name, size: registered.size });
            }
        }
        return structuredClone([...refs.values()]);
    }
    async function perform(name, args, context) {
        const { state, turnId, conversationId, signal, record } = context;
        const snapshot = state.snapshot;
        switch (name) {
            case 'recall_memory':
                invariant(retrieval, 'tool-unavailable', 'Retrieval is not configured', 503);
                return { entries: await retrieval.search(conversationId, args.query, { snapshot, signal }) };
            case 'search_lore': {
                const query = args.query.toLocaleLowerCase();
                const entries = [];
                // Only already-authorized frozen worldbooks are eligible; no host/resource enumeration.
                for (const book of snapshot.resources.filter(r => r.kind === 'worldbook')) {
                    for (const entry of book.data?.entries ?? []) {
                        if (entry.disabled || entry.enabled === false || typeof entry.content !== 'string' || state.includedLore?.has(`${book.id}:${entry.id}`)) continue;
                        if (`${entry.name ?? ''} ${entry.content} ${(entry.keys ?? []).join(' ')}`.toLocaleLowerCase().includes(query))
                            entries.push({ content: entry.content, sourceRefs: [{ resourceId: book.id, revision: book.revision, entryId: entry.id }] });
                    }
                }
                return { entries: entries.slice(0, 32) };
            }
            case 'update_memory': {
                const refs = snapshot.messages.filter(m => !m.deletedAt && !m.userHidden && (!m.status || m.status === 'completed')).map(sourceRef);
                const proposal = memoryProposal(snapshot, { ...args.block, op: args.op, content: args.content }, refs);
                invariant(![...state.proposals.values()].flat().some(p => p.id === proposal.id), 'memory-proposal-conflict', 'This turn already proposed a change to that block', 409);
                return { memoryProposal: proposal, status: 'proposed' };
            }
            case 'roll_dice': return rollDice(args.expr, random);
            case 'get_time': {
                const instant = new Date(now());
                const timeZone = snapshot.settings?.timeZone ?? snapshot.settings?.timezone ?? 'UTC';
                return { iso: instant.toISOString(), timeZone, local: new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'full', timeStyle: 'long' }).format(instant) };
            }
            case 'generate_image':
                invariant(typeof image === 'function', 'tool-unavailable', 'Image provider is not configured', 503);
                context.externalStarted = true;
                return await image({ prompt: args.prompt, conversationId, turnId, idempotencyKey: record.id, recordId: record.id, memberRunId: record.memberRunId, snapshot: structuredClone(snapshot), signal });
            default: throw new ProtocolError('unknown-tool', 'Tool is not registered');
        }
    }
    async function execute({ turnId, conversationId, memberRunId, toolCallId, name, args = {}, signal }) {
        signal?.throwIfAborted();
        invariant(typeof toolCallId === 'string' && toolCallId.length > 0 && toolCallId.length <= 128, 'invalid-tool-call', 'Tool call ID is required');
        const { state, turn } = session(turnId, conversationId);
        if (state.fatal) throw state.fatal;
        const enabled = state.snapshot.settings?.tools;
        const definition = definitions({ type: turn.type, enabled }).find(d => d.name === name);
        invariant(definition, 'tool-disabled', 'Tool is disabled or unknown', 403);
        validate(args, definition.parameters);
        const cachedImage = name === 'generate_image' ? guardImageRetry(turn, memberRunId, args, state) : undefined;
        const requestHash = createHash('sha256').update(canonicalJson({ name, args })).digest('hex');
        const { record, replayed } = store.recordTool({ conversationId, turnId, memberRunId, toolCallId, requestHash, name, args });
        if (replayed) {
            if (inFlight.has(record.id)) return inFlight.get(record.id);
            if (record.status === 'completed') {
                if (record.result?.memoryProposal) state.proposals.set(record.id, [record.result.memoryProposal]);
                rememberArtifacts(state, record);
                return bounded(record.result, record, state.limits);
            }
            if (record.status === 'failed' && ['tool-result-unknown', 'provider-job-unknown', 'tool-persistence-failed'].includes(record.error?.code)) throw fatal(state, record.error.code, { recordId: record.id });
            if (record.status === 'failed') throw new ProtocolError(record.error?.code ?? 'tool-failed', 'Previous tool call failed', 409);
            // Persisted intent may have reached an external service before a process died.
            throw fatal(state, 'tool-result-unknown', { recordId: record.id });
        }
        const calls = state.calls.get(state.round) ?? 0;
        if (calls >= state.limits.callsPerRound || state.total >= state.limits.rounds * state.limits.callsPerRound) {
            store.finishTool(record.id, { status: 'failed', error: { code: 'tool-limit' } });
            throw new ProtocolError('tool-limit', 'Tool call limit exceeded', 409);
        }
        state.calls.set(state.round, calls + 1); state.total++;
        if (cachedImage) {
            // Persist a new-turn replay record so artifact collection remains
            // scoped to this member. Never mutate the historical tool/message.
            const usage = { cost: 0, complete: true };
            const result = { ...structuredClone(cachedImage.result), usage, reusedFromToolId: cachedImage.id };
            try { store.finishTool(record.id, { status: 'completed', result, usage }); } catch (error) { throw fatal(state, 'tool-persistence-failed', { recordId: record.id, code: error.code }); }
            rememberArtifacts(state, store.getTool(record.id));
            return bounded(result, record, state.limits);
        }
        const controller = new AbortController();
        const forward = () => controller.abort(signal.reason);
        signal?.addEventListener('abort', forward, { once: true });
        if (signal?.aborted) forward();
        const timeout = setTimeout(() => controller.abort(new ProtocolError('tool-timeout', 'Tool deadline exceeded', 408)), Math.min(state.limits.timeoutMs, Math.max(1, state.limits.turnTimeoutMs - (now() - state.startedAt))));
        const operation = (async () => {
            let abortListener;
            const context = { state, turnId, conversationId, signal: controller.signal, record, externalStarted: false };
            try {
                controller.signal.throwIfAborted();
                active(turnId, conversationId, state.epoch);
                const aborted = new Promise((_, reject) => {
                    abortListener = () => reject(controller.signal.reason ?? new ProtocolError('aborted', 'Tool stopped', 409));
                    controller.signal.addEventListener('abort', abortListener, { once: true });
                });
                const result = await Promise.race([perform(name, args, context), aborted]);
                controller.signal.throwIfAborted();
                active(turnId, conversationId, state.epoch);
                store.finishTool(record.id, { status: 'completed', result, usage: result?.usage ?? (name === 'generate_image' ? { cost: null, complete: false } : undefined) });
                if (result?.memoryProposal) state.proposals.set(record.id, [result.memoryProposal]);
                rememberArtifacts(state, store.getTool(record.id));
                return bounded(result, record, state.limits);
            } catch (error) {
                const status = (name === 'generate_image' && context.externalStarted && error.definitive !== true)
                    || ['tool-result-unknown', 'provider-job-unknown', 'tool-persistence-failed'].includes(error.code) ? 'unknown' : 'failed';
                // Never overwrite an already committed result if persistence failed after commit.
                const persisted = store.getTool(record.id);
                if (persisted.status === 'completed' && error.code === 'tool-result-limit') throw error;
                if (['intent', 'running'].includes(persisted.status)) {
                    try { store.finishTool(record.id, { status, error: { code: status === 'unknown' ? 'tool-result-unknown' : (error.code ?? 'tool-failed') }, ...(status === 'unknown' ? { usage: { cost: null, complete: false } } : {}) }); } catch (persistenceError) { throw fatal(state, 'tool-persistence-failed', { recordId: record.id, outcome: status, code: persistenceError.code }); }
                }
                if (status === 'unknown') throw fatal(state, 'tool-result-unknown', { recordId: record.id, recovery: 'existing-provider-job-only' });
                throw new ProtocolError(status === 'unknown' ? 'tool-result-unknown' : (error.code ?? 'tool-failed'), status === 'unknown' ? 'Paid tool outcome is unknown; do not replay' : 'Tool execution failed', 409);
            } finally {
                clearTimeout(timeout); signal?.removeEventListener('abort', forward);
                if (abortListener) controller.signal.removeEventListener('abort', abortListener);
            }
        })();
        inFlight.set(record.id, operation);
        try { return await operation; } finally { inFlight.delete(record.id); }
    }
    return { definitions, execute, beginRound, toolArtifacts, imageRecovery,
        fatalError(turnId) { return sessions.get(turnId)?.fatal ?? null; },
        bindTurn({ turnId, snapshot, requestPlan, onFatal }) {
            const conversationId = snapshot.conversationId ?? snapshot.conversation.id;
            const { state } = session(turnId, conversationId, snapshot);
            if (onFatal !== undefined) { invariant(typeof onFatal === 'function', 'invalid-tool', 'onFatal must be a function'); state.onFatal = onFatal; }
            state.snapshot = structuredClone(snapshot);
            state.includedLore = new Set((requestPlan?.blocks ?? []).filter(b => b.worldKey).map(b => b.worldKey));
        },
        memoryProposals(turnId) { return structuredClone([...(sessions.get(turnId)?.proposals.values() ?? [])].flat()); },
        release(turnId) { sessions.delete(turnId); },
    };
}
