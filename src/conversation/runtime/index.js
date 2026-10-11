import { randomUUID } from 'node:crypto';
import { ProtocolError, invariant, TERMINAL_STATES, TOOL_LIMITS, validateTurnRequest } from '../../../public/shared/conversation/schemas/index.js';
import { applyRegex } from '../../../public/shared/conversation/regex/index.js';

/** Owns business turns, not the SDK's model/tool loop. All dependencies are injected. */
export function createRuntime({ store, executor, compile, memory, retrieval, tools, trace, groups, capabilities }) {
    const active = new Map();
    const automatic = new Map();
    const background = new Set();
    const backgroundController = new AbortController();
    let closing = false;

    function connectionFor(snapshot) {
        const ref = snapshot.resources.find(resource => resource.id === snapshot.settings.connectionId)
            ?? snapshot.resources.find(resource => resource.kind === 'connection');
        invariant(ref, 'connection-required', 'Select a new connection before generating', 422);
        const resource = store.getConnection(ref.id, ref.revision);
        return { ...resource.data, id: resource.id, revision: resource.revision };
    }

    function preflight(snapshot, request) {
        let members;
        if (request.type === 'group') {
            invariant(groups, 'group-unavailable', 'Group scheduler is unavailable', 422);
            members = groups.select(snapshot, request);
        }
        const connection = connectionFor(snapshot);
        const capability = capabilities(connection);
        invariant(capability.supported !== false, 'unsupported-connection', capability.reason || 'Connection is not supported', 422);
        invariant(!capability.types || capability.types.includes(request.type), 'unsupported-type', 'Connection does not support this generation type', 422);
        for (const media of request.media ?? []) invariant(capability.media?.includes(media.type), 'unsupported-media', `Connection does not support ${media.type}`, 422);
        const chosen = typeof executor === 'function' ? executor(connection) : executor;
        chosen.preflight?.({ snapshot, request, connection });
        invariant(Number.isFinite(connection.contextWindow) && connection.contextWindow > 0, 'model-capability-required', 'Configure the model context window', 422);
        invariant(Number.isFinite(connection.maxOutputTokens) && connection.maxOutputTokens > 0, 'model-capability-required', 'Configure the maximum output tokens', 422);
        invariant(connection.maxOutputTokens <= (connection.outputLimit ?? connection.contextWindow), 'output-limit', 'Output budget exceeds the model limit', 422);
        return { connection, capability, chosen, members };
    }

    function phase(turn, status) {
        if (store.advanceTurn) store.advanceTurn(turn.id, status, turn.attemptEpoch);
        else store.appendEvent(turn.conversationId, 'turn.phase', { status }, turn.id);
    }

    async function runMember(turn, snapshot, request, signal, member) {
        const { connection, capability, chosen } = preflight(snapshot, request);
        let preparedSnapshot = snapshot;
        const definitions = tools?.definitions({ type: request.type, enabled: snapshot.settings.tools }) ?? [];
        const enabledTools = capability.tools === false ? [] : definitions;
        const query = snapshot.messages.filter(message => message.role === 'user' && !message.deletedAt).at(-1)?.content;
        if (retrieval && snapshot.settings.retrieval !== false && typeof query === 'string' && query.trim()) {
            const matches = await retrieval.search(turn.conversationId, query.slice(0, 4096), { snapshot, signal });
            preparedSnapshot = { ...snapshot, retrieval: matches.map((item, index) => ({ ...item, id: `retrieved-${index}` })) };
        }
        let requestPlan;
        let lastCompression;
        for (let attempt = 0; attempt < 3; attempt++) {
            signal.throwIfAborted();
            try {
                requestPlan = compile(preparedSnapshot, {
                    type: request.type, targetMessageId: request.targetMessageId, capabilities: { ...capability, ...connection },
                    workingBudget: connection.workingBudget, tools: enabledTools,
                    variables: snapshot.settings.variables ?? {}, seed: turn.id,
                });
                break;
            } catch (error) {
                if (error.code !== 'budget-blocked' || !memory || attempt === 2) throw error;
                const fingerprint = JSON.stringify(preparedSnapshot.folds);
                invariant(fingerprint !== lastCompression, 'compression-failed', 'Compression made no progress', 422);
                lastCompression = fingerprint;
                phase(turn, 'preparing');
                await memory.compact(preparedSnapshot, { signal, budget: error.details?.budget ?? connection.workingBudget, turnId: turn.id, attemptEpoch: turn.attemptEpoch });
                preparedSnapshot = { ...store.getConversation(turn.conversationId), resources: snapshot.resources, settings: snapshot.settings };
            }
        }
        signal.throwIfAborted();
        phase(turn, 'generating');
        tools?.bindTurn?.({ turnId: turn.id, snapshot: preparedSnapshot, requestPlan });
        const traceId = trace?.begin?.({ conversationId: turn.conversationId, turnId: turn.id, memberRunId: member?.id, requestPlan, connection });
        let callNumber = 0;
        const memoryProposals = [];
        const toolDefinitions = enabledTools.map(definition => ({ ...definition,
            execute: async (toolCallId, args, toolSignal) => {
                signal.throwIfAborted();
                const task = active.get(turn.id);
                if (task && task.toolStep !== task.modelStep) {
                    task.toolStep = task.modelStep;
                    task.toolRound = (task.toolRound ?? 0) + 1;
                    tools.beginRound?.({ turnId: turn.id, conversationId: turn.conversationId, round: task.toolRound });
                }
                phase(turn, 'tool_running');
                const result = await tools.execute({ turnId: turn.id, conversationId: turn.conversationId, memberRunId: member?.id, toolCallId, name: definition.name, args, signal: toolSignal ?? signal });
                if (result?.memoryProposal) memoryProposals.push(result.memoryProposal);
                phase(turn, 'generating');
                return result;
            },
        }));
        let result;
        try { result = await chosen.runTurn({
            snapshot: preparedSnapshot, requestPlan, connection, tools: toolDefinitions, traceId,
            limits: { ...TOOL_LIMITS, ...snapshot.settings.toolLimits, maxOutputTokens: connection.maxOutputTokens }, signal,
            beforeRequest: async context => {
                signal.throwIfAborted();
                const current = store.getTurn(turn.id);
                invariant(!TERMINAL_STATES.includes(current.status) && !current.cancelRequested && current.attemptEpoch === turn.attemptEpoch, 'late-callback', 'Turn no longer accepts model requests', 409);
                callNumber++;
                const task = active.get(turn.id);
                if (task) task.modelStep = Symbol('model-step');
                // The SDK calls this for every step, including tool continuations.
                const messages = context?.messages ?? context?.context?.messages;
                if (messages) {
                    const safety = Math.max(256, Math.ceil(Math.min(connection.contextWindow, connection.inputLimit ?? connection.contextWindow) * 0.02));
                    const limit = Math.min(connection.workingBudget ?? 65536, Math.min(connection.inputLimit ?? connection.contextWindow, connection.contextWindow - connection.maxOutputTokens) - safety);
                    const estimated = (Number.isSafeInteger(context.estimatedTokens) && context.estimatedTokens >= 0
                        ? context.estimatedTokens : Buffer.byteLength(JSON.stringify(messages), 'utf8')) + Buffer.byteLength(JSON.stringify(enabledTools), 'utf8');
                    invariant(estimated <= limit, 'budget-blocked', 'Actual model context exceeds the conservative input budget', 422, { estimatedTokens: estimated, workingBudget: limit });
                }
                trace?.record?.(traceId, { type: 'model.prepare', callNumber });
            },
            onEvent: async event => {
                signal.throwIfAborted();
                if (event.type === 'text.delta') store.appendDelta(turn.id, { text: event.text ?? '' }, turn.attemptEpoch);
                else if (event.type === 'reasoning.delta') store.appendDelta(turn.id, { reasoning: event.text ?? '' }, turn.attemptEpoch);
                else if (['tool.call', 'tool.result', 'usage.updated'].includes(event.type)) store.appendEvent(turn.conversationId, event.type, { ...event, memberRunId: member?.id }, turn.id);
                trace?.record?.(traceId, event);
            },
        }); } catch (error) { trace?.fail?.(traceId, error); throw error; }
        signal.throwIfAborted();
        invariant(!['error', 'aborted'].includes(result.finishReason), 'model-failed', 'Model did not finish successfully', 502);
        trace?.finish?.(traceId, result);
        const preset = preparedSnapshot.resources.find(resource => resource.id === preparedSnapshot.settings.presetId && resource.kind === 'preset');
        result.content = applyRegex(result.content ?? '', preset?.data?.regex ?? [], { stage: 'output', role: request.type === 'impersonate' ? 'user' : 'assistant' });
        return { ...result, effects: requestPlan.effects, memoryProposals };
    }

    async function execute(turn, snapshot, request, controller) {
        let timer;
        try {
            const timeout = Math.min(Math.max(snapshot.settings.turnTimeoutMs ?? TOOL_LIMITS.turnTimeoutMs, 1000), 3600000);
            timer = setTimeout(() => controller.abort(new ProtocolError('turn-timeout', 'Turn deadline exceeded', 408)), timeout);
            timer.unref?.();
            phase(turn, 'preparing');
            let result;
            if (request.type === 'group') {
                invariant(groups && store.commitMember, 'group-unavailable', 'Group scheduler is unavailable', 422);
                const members = turn.plannedMembers ?? groups.select(snapshot, request);
                store.appendEvent(turn.conversationId, 'group.started', { members }, turn.id);
                const usages = [];
                const proposals = [];
                for (const member of members) {
                    controller.signal.throwIfAborted();
                    store.startMember?.(turn.id, { memberRunId: member.id, characterId: member.characterId }, turn.attemptEpoch);
                    const memberSnapshot = groups.snapshot({ ...store.getConversation(turn.conversationId), resources: snapshot.resources }, member);
                    store.appendEvent(turn.conversationId, 'group.member', { member }, turn.id);
                    result = await runMember(turn, memberSnapshot, { ...request, type: 'send' }, controller.signal, member);
                    store.commitMember(turn.id, { memberRunId: member.id, characterId: member.characterId, ...result }, turn.attemptEpoch);
                    usages.push(result.usage);
                    proposals.push(...result.memoryProposals);
                }
                result = { content: '', reasoning: '', usage: { members: usages }, memoryProposals: proposals };
            } else result = await runMember(turn, snapshot, request, controller.signal);
            if (tools?.memoryProposals) result.memoryProposals = tools.memoryProposals(turn.id);
            phase(turn, 'finalizing');
            store.finishTurn(turn.id, { status: 'completed', ...result }, turn.attemptEpoch);
            // Do not keep a DB transaction open across any background model work.
            if (memory && !closing) {
                const task = Promise.resolve().then(() => memory.schedule(turn.conversationId)).then(() => memory.drain?.({ signal: backgroundController.signal })).catch(() => {
                    if (!closing) store.appendEvent(turn.conversationId, 'memory.updated', { status: 'failed', turnId: turn.id, message: 'Background memory update failed' });
                });
                background.add(task);
                task.finally(() => background.delete(task)).catch(() => {});
            }
            if (retrieval && !closing) {
                const task = Promise.resolve().then(() => retrieval.index(turn.conversationId, { signal: backgroundController.signal })).catch(() => {});
                background.add(task);
                task.finally(() => background.delete(task)).catch(() => {});
            }
        } catch (error) {
            const automaticTimer = automatic.get(turn.conversationId);
            if (automaticTimer) {
                clearTimeout(automaticTimer);
                automatic.delete(turn.conversationId);
                store.appendEvent(turn.conversationId, 'automatic.changed', { enabled: false, reason: 'turn-failed-or-stopped' });
            }
            const stopped = controller.signal.aborted && controller.signal.reason?.code !== 'turn-timeout';
            const current = store.getTurn(turn.id);
            if (!TERMINAL_STATES.includes(current.status)) {
                store.finishTurn(turn.id, { status: stopped ? 'stopped' : 'failed', content: current.content ?? '', reasoning: current.reasoning ?? '', usage: null,
                    error: { code: error.code ?? (stopped ? 'stopped' : 'generation-failed'), message: error instanceof ProtocolError ? error.message : 'Generation failed; inspect the sanitized trace' },
                }, turn.attemptEpoch);
            }
        } finally {
            clearTimeout(timer);
            tools?.release?.(turn.id);
            active.delete(turn.id);
        }
    }

    const runtime = {
        start(conversationId, request) {
            invariant(!closing, 'service-closing', 'Service is shutting down', 503);
            validateTurnRequest(request);
            const accepted = store.beginTurn(conversationId, request, preflight);
            const { turn, snapshot, replayed } = accepted;
            if (!replayed) {
                const controller = new AbortController();
                const task = { controller, promise: null };
                active.set(turn.id, task);
                task.promise = Promise.resolve().then(() => execute(turn, snapshot, request, controller));
            }
            const events = store.events(conversationId, 0);
            return { turnId: turn.id, status: turn.status, contentRevision: store.getConversation(conversationId).conversation.contentRevision, eventCursor: events.at(-1)?.seq ?? 0, replayed };
        },
        stop(turnId) {
            const turn = store.getTurn(turnId);
            const timer = automatic.get(turn.conversationId);
            if (timer) clearTimeout(timer);
            automatic.delete(turn.conversationId);
            if (timer) store.appendEvent(turn.conversationId, 'automatic.changed', { enabled: false, reason: 'user-stopped' });
            const result = store.requestStop(turnId);
            active.get(turnId)?.controller.abort(new ProtocolError('stopped', 'Stopped by user'));
            return result;
        },
        async wait(turnId) {
            await active.get(turnId)?.promise;
            return store.getTurn(turnId);
        },
        estimate(conversationId, options = {}) {
            const snapshot = store.getConversation(conversationId);
            const { connection, capability } = preflight(snapshot, { type: options.type ?? 'send' });
            return compile(snapshot, { ...options, capabilities: { ...capability, ...connection }, workingBudget: connection.workingBudget, tools: tools?.definitions({ type: options.type ?? 'send', enabled: snapshot.settings.tools }) ?? [] });
        },
        async compact(conversationId, options = {}) {
            invariant(memory, 'memory-unavailable', 'Memory service is unavailable', 422);
            const snapshot = store.getConversation(conversationId);
            invariant(!snapshot.conversation.activeTurnId, 'conversation-busy', 'Stop the active turn before compacting', 409);
            invariant(options.expectedContentRevision === snapshot.conversation.contentRevision, 'revision-conflict', 'Conversation changed before compression', 409);
            invariant(options.expectedMemoryRevision === snapshot.conversation.memoryRevision, 'revision-conflict', 'Memory changed before compression', 409);
            return memory.compact(snapshot, { ...options, signal: options.signal ?? new AbortController().signal });
        },
        automaticStatus(conversationId) { store.getConversation(conversationId); return { enabled: automatic.has(conversationId) }; },
        setAutomatic(conversationId, { enabled, intervalMs = 30000, content = 'Continue the group conversation.', expectedContentRevision }) {
            invariant(typeof enabled === 'boolean', 'invalid-automatic', 'Enabled must be boolean');
            const snapshot = store.getConversation(conversationId);
            if (enabled) {
                invariant(snapshot.conversation.contentRevision === expectedContentRevision, 'revision-conflict', 'Conversation changed before scheduling', 409);
                invariant(typeof content === 'string' && content.trim() && content.length <= 100000, 'invalid-automatic', 'Automatic prompt must be nonempty text');
                invariant(Number.isSafeInteger(intervalMs) && intervalMs >= 1000 && intervalMs <= 3600000, 'invalid-interval', 'Automatic interval must be 1–3600 seconds');
                invariant(groups, 'group-unavailable', 'Group scheduler is unavailable', 422);
                groups.select(snapshot, { content });
                preflight(snapshot, { type: 'group' });
            }
            clearTimeout(automatic.get(conversationId));
            automatic.delete(conversationId);
            store.appendEvent(conversationId, 'automatic.changed', { enabled, intervalMs });
            if (!enabled) return { enabled: false };
            const tick = () => {
                if (closing || !automatic.has(conversationId)) return;
                let snapshot;
                try { snapshot = store.getConversation(conversationId); }
                catch { automatic.delete(conversationId); return; }
                if (!snapshot.conversation.activeTurnId) {
                    try { runtime.start(conversationId, { schemaVersion: 1, clientRequestId: randomUUID(), expectedContentRevision: snapshot.conversation.contentRevision, type: 'group', content }); }
                    catch { automatic.delete(conversationId); return; }
                }
                const timer = setTimeout(tick, intervalMs);
                timer.unref?.();
                automatic.set(conversationId, timer);
            };
            const timer = setTimeout(tick, intervalMs);
            timer.unref?.();
            automatic.set(conversationId, timer);
            return { enabled: true, intervalMs };
        },
        async close() {
            closing = true;
            for (const timer of automatic.values()) clearTimeout(timer);
            automatic.clear();
            for (const task of active.values()) task.controller.abort();
            backgroundController.abort();
            await Promise.allSettled([...active.values()].map(task => task.promise));
            await Promise.allSettled([...background]);
        },
    };
    return runtime;
}
