import { validateMediaReferences } from './media.js';
import { CONNECTION_SETTING_KEYS, auxiliaryConnectionIds } from './references.js';
import { initializeDatabase, unitOfWork, materialize, UNIT, ENTITY_TABLES } from './persistence.js';
import { validateBackup as validateBackupData, validateAttachment } from './backup.js';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { SCHEMA_VERSION, RESOURCE_KINDS, TERMINAL_STATES, canonicalJson, validateTurnRequest, invariant, sourceRef } from '../../../public/shared/conversation/schemas/index.js';

const copy = value => structuredClone(value);
const terminal = turn => TERMINAL_STATES.includes(turn.status);
const redact = value => {
    if (Array.isArray(value)) return value.map(redact);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(apiKey|api_key|authorization|password|secret|accessToken|refreshToken|token|headers)$/i.test(key)).map(([key, item]) => [key, redact(item)]));
};

/** Synchronous single-writer repository. Every state change and its events share one SQLite commit. */
export function createStore({ directory, now = () => new Date().toISOString(), id = randomUUID }) {
    invariant(typeof directory === 'string', 'invalid-directory', 'An explicit new data directory is required');
    const path = resolve(directory);
    const temp = realpathSync(tmpdir());
    invariant(basename(path) === 'conversation-v1' || path.startsWith(tmpdir() + sep) || path.startsWith(temp + sep), 'invalid-directory', 'Use conversation-v1 or an isolated temporary directory');
    mkdirSync(path, { recursive: true });
    const actual = realpathSync(path);
    invariant(basename(actual) === 'conversation-v1' || actual.startsWith(temp + sep), 'invalid-directory', 'Directory resolves outside an allowed location');
    const lock = resolve(actual, '.writer.lock');
    const claim = () => { const fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, JSON.stringify({ pid: process.pid })); closeSync(fd); };
    try { claim(); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner;
        try { owner = JSON.parse(readFileSync(lock, 'utf8')); } catch { invariant(false, 'store-locked', 'Store lock cannot be verified', 409); }
        let alive = true;
        try { process.kill(owner.pid, 0); } catch (probe) { if (probe.code === 'ESRCH') alive = false; }
        invariant(!alive, 'store-locked', 'Store already has a writer', 409);
        unlinkSync(lock); claim();
    }
    let db;
    try {
        db = new DatabaseSync(resolve(actual, 'store.sqlite'));
        initializeDatabase(db);
    } catch (error) { db?.close(); unlinkSync(lock); throw error; }
    let closed = false;
    let busy = false;
    const read = () => { invariant(!closed, 'store-closed', 'Store is closed'); return unitOfWork(db); };
    const tx = fn => {
        invariant(!closed && !busy, 'store-busy', 'Nested writes are not allowed', 409);
        busy = true; let began = false;
        try { db.exec('BEGIN IMMEDIATE'); began = true; const state = read(); const result = fn(state); state[UNIT].flush(); db.exec('COMMIT'); return copy(result); }
        catch (error) { if (began) db.exec('ROLLBACK'); throw error; }
        finally { busy = false; }
    };
    const get = (map, key) => { invariant(Object.hasOwn(map, key), 'not-found', 'Entity not found', 404); return map[key]; };
    const conv = (s, key) => get(s.conversations, key);
    const check = (actualRevision, expected) => invariant(Number.isSafeInteger(expected) && actualRevision === expected, 'revision-conflict', 'Revision changed', 409, { currentRevision: actualRevision });
    const idle = c => invariant(!c.activeTurnId, 'conversation-busy', 'Conversation has an active turn', 409);
    const current = record => record.versions.find(v => v.revision === record.revision && v.candidateId === record.candidateId && v.candidateRevision === record.candidateRevision);
    const messages = (s, cid) => s[UNIT].values('messages', cid).filter(m => !m.deletedAt).map(m => copy(current(m)));
    const resource = (s, rid, revision) => { const r = get(s.resources, rid); invariant(revision || !r.deletedAt, 'not-found', 'Resource deleted', 404); return get(r.versions, revision ?? r.revision); };
    const refs = (s, c, strict = true) => {
        const ids = new Set((c.explicitResourceRefs ?? c.resourceRefs).map(r => r.id));
        const resolveResource = rid => {
            const record = s.resources[rid];
            if (!record || record.deletedAt) {
                invariant(!strict, 'not-found', 'Selected resource is missing or deleted', 404, { resourceId: rid });
                return null;
            }
            return record.versions[record.revision];
        };
        const add = (rid, kind) => {
            ids.add(rid);
            const r = resolveResource(rid);
            invariant(!strict || !kind || r?.kind === kind, 'invalid-resource', `Expected ${kind} resource`);
        };
        for (const key of [...CONNECTION_SETTING_KEYS, 'characterId', 'personaId', 'presetId', 'groupId']) if (c.settings[key]) add(c.settings[key], CONNECTION_SETTING_KEYS.includes(key) ? 'connection' : undefined);
        for (const rid of c.settings.worldbookIds ?? []) add(rid);
        for (const rid of ids) {
            const r = resolveResource(rid);
            if (!r) continue;
            if (r.kind === 'connection') for (const connectionId of auxiliaryConnectionIds(r.data.auxiliary)) add(connectionId, 'connection');
            if (r.kind === 'group') for (const member of r.data.members ?? []) add(typeof member === 'string' ? member : member.characterId ?? member.id, 'character');
        }
        return [...ids].map(rid => {
            const r = resolveResource(rid);
            return r ? { id: rid, revision: r.revision } : { id: rid, revision: s.resources[rid]?.revision ?? null, missing: true, ...(s.resources[rid]?.deletedAt ? { deletedAt: s.resources[rid].deletedAt } : {}) };
        });
    };
    const snapshot = (s, cid, strictResources = false) => {
        const c = conv(s, cid);
        const active = c.activeTurnId && s.turns[c.activeTurnId];
        const frozen = !strictResources && active ? s.snapshots[active.snapshotId] : null;
        const resolvedRefs = frozen ? frozen.conversation.resourceRefs : refs(s, c, strictResources || Boolean(c.activeTurnId));
        const resolvedResources = frozen ? frozen.resources : resolvedRefs.map(ref => {
            if (!ref.missing) return resource(s, ref.id, ref.revision);
            const old = s.resources[ref.id]?.versions[ref.revision];
            return { id: ref.id, revision: ref.revision, kind: old?.kind, name: old?.name, data: {}, missing: true, ...(ref.deletedAt ? { deletedAt: ref.deletedAt } : {}) };
        });
        const currentMessages = messages(s, cid);
        const attachments = Object.create(null);
        const collectAttachments = value => {
            if (Array.isArray(value)) return value.forEach(collectAttachments);
            if (!value || typeof value !== 'object') return;
            if (value.attachmentId !== undefined) {
                const { path: internalPath, ...metadata } = get(s.attachments, value.attachmentId);
                attachments[metadata.id] = copy(metadata);
            }
            Object.values(value).forEach(collectAttachments);
        };
        for (const m of currentMessages) collectAttachments(m.media);
        return redact({ id: id(), conversationId: cid, conversation: { ...copy(c), resourceRefs: copy(resolvedRefs) }, messages: currentMessages, attachments, resources: resolvedResources, settings: c.settings, ...Object.fromEntries(['summaries', 'memories', 'folds'].map(kind => [kind, s[UNIT].values(kind, cid)])) });
    };
    const event = (s, cid, type, payload, tid) => {
        const c = conv(s, cid);
        const e = redact({ schemaVersion: SCHEMA_VERSION, eventId: id(), seq: s[UNIT].nextSeq(cid), conversationId: cid, turnId: tid, type, payload, entityRevisions: { contentRevision: c.contentRevision, memoryRevision: c.memoryRevision } });
        s[UNIT].appendEvent(e); return e;
    };
    const validSource = (s, cid, ref) => { const m = s.messages[ref.messageId]; return m && m.conversationId === cid && !m.deletedAt && canonicalJson(sourceRef(current(m))) === canonicalJson({ messageId: ref.messageId, revision: ref.revision, candidateId: ref.candidateId ?? null, candidateRevision: ref.candidateRevision ?? null }); };
    const validBlock = (s, cid, b) => (b.resourceRefs ?? []).every(r => s.resources[r.id] && !s.resources[r.id].deletedAt && s.resources[r.id].revision === r.revision) && (b.memoryRefs ?? []).every(r => { const m = s.memories[r.id ?? r.memoryId]; return m && m.conversationId === cid && m.revision === r.revision && m.status === 'valid'; }) && (b.sourceRefs ?? []).every(r => validSource(s, cid, r)) && [...(b.parentSummaryRefs ?? []), ...(b.summaryRef ? [b.summaryRef] : [])].every(r => { const p = s.summaries[r.id ?? r.summaryId]; return p && p.conversationId === cid && p.revision === r.revision && p.status === 'valid'; });
    const invalidate = (s, cid) => {
        let changed; let any = false;
        do { changed = false; for (const kind of ['summaries', 'memories', 'folds']) for (const b of Object.values(s[kind])) {
            if (b.conversationId === cid && b.status === 'valid' && !validBlock(s, cid, b)) { b.status = b.locked || b.origin === 'manual' ? 'pending-confirm' : 'stale'; changed = any = true; }
        } } while (changed);
        if (any) conv(s, cid).memoryRevision++;
        for (const j of Object.values(s.jobs)) if (j.conversationId === cid && !(j.dependencies?.sourceRefs ?? (Array.isArray(j.dependencies) ? j.dependencies : [])).every(r => validSource(s, cid, r))) j.status = 'stale';
    };
    const validateMedia = (s, media) => validateMediaReferences(s.attachments, media);
    const newMessage = (s, cid, tid, role, content, status = 'completed', media = [], identifiers = {}) => {
        validateMedia(s, media);
        const m = { id: id(), conversationId: cid, turnId: tid, role, content, revision: 1, candidateId: role === 'assistant' ? id() : null, candidateRevision: role === 'assistant' ? 1 : null, status, media: copy(media), ...identifiers };
        s.messages[m.id] = { ...m, versions: [copy(m)] }; return m;
    };
    const select = (m, v) => { m.revision = v.revision; m.candidateId = v.candidateId; m.candidateRevision = v.candidateRevision; };
    const live = (s, tid, epoch) => { const t = get(s.turns, tid); invariant(!terminal(t) && !t.cancelRequested && t.attemptEpoch === epoch && conv(s, t.conversationId).activeTurnId === tid, 'late-callback', 'Turn no longer accepts callbacks', 409); return t; };
    const derived = (s, cid, proposal) => {
        const c = conv(s, cid);
        if (c.activeTurnId) { invariant(proposal.turnId === c.activeTurnId, 'conversation-busy', 'Background commit requires idle conversation', 409); live(s, proposal.turnId, proposal.attemptEpoch); }
        if (proposal.expectedMemoryRevision !== undefined) check(c.memoryRevision, proposal.expectedMemoryRevision);
        invariant((proposal.sourceRefs ?? []).every(r => validSource(s, cid, r)), 'source-conflict', 'Sources changed', 409);
        for (const kind of ['summaries', 'memories', 'folds']) for (const input of proposal[kind] ?? []) {
            invariant(!['__proto__', 'constructor', 'prototype'].includes(input.id), 'invalid-id', 'Invalid entity ID');
            const previous = input.id && s[kind][input.id];
            if (previous) { invariant(previous.conversationId === cid && !previous.locked && previous.origin !== 'manual', 'memory-protected', 'Manual or locked block cannot be replaced', 409); check(previous.revision, input.expectedBlockRevision ?? input.expectedRevision ?? input.revision); }
            const b = { ...copy(input), id: previous?.id ?? input.id ?? id(), conversationId: cid, revision: (previous?.revision ?? 0) + 1, sourceRefs: copy(input.sourceRefs ?? proposal.sourceRefs ?? []), status: input.op === 'delete' ? 'stale' : 'valid', origin: 'automatic', locked: false };
            invariant(validBlock(s, cid, b), 'source-conflict', 'Derived dependencies changed', 409);
            s[kind][b.id] = b;
        }
        c.memoryRevision++; invalidate(s, cid); event(s, cid, 'memory.updated', {}, proposal.turnId);
        return { accepted: true, memoryRevision: c.memoryRevision };
    };
    const applyEffects = (c, effects) => {
        if (effects !== undefined) {
            invariant(Array.isArray(effects), 'invalid-effects', 'Effects must be an array');
            for (const effect of effects) {
                invariant(!['__proto__', 'constructor', 'prototype'].includes(effect.name ?? effect.key), 'invalid-effects', 'Invalid effect key');
                if (effect.type === 'variable.set') {
                    c.settings.variables ??= {};
                    invariant(canonicalJson(c.settings.variables[effect.name] ?? null) === canonicalJson(effect.previous ?? null), 'revision-conflict', 'Variable changed', 409);
                    c.settings.variables[effect.name] = copy(effect.value);
                } else if (effect.type === 'worldbook.activate') {
                    c.settings.worldInfo ??= {}; c.settings.worldInfo.state ??= {};
                    invariant(canonicalJson(c.settings.worldInfo.state[effect.key] ?? null) === canonicalJson(effect.previous ?? null), 'revision-conflict', 'Worldbook timing changed', 409);
                    c.settings.worldInfo.state[effect.key] = copy(effect.value);
                } else invariant(false, 'invalid-effects', 'Unknown effect type');
            }
        }
    };
    const finish = (s, tid, result, epoch, recovery = false) => {
        const t = get(s.turns, tid);
        invariant(!terminal(t) && t.attemptEpoch === epoch, 'late-callback', 'Turn already finished or epoch expired', 409);
        invariant(TERMINAL_STATES.includes(result.status), 'invalid-status', 'Expected terminal status');
        const c = conv(s, t.conversationId);
        invariant(c.activeTurnId === tid, 'late-callback', 'Turn no longer active', 409);
        invariant(!t.cancelRequested || result.status !== 'completed', 'late-callback', 'Stopped turn cannot complete', 409);
        if (result.memoryProposals && result.status === 'completed') derived(s, c.id, { ...(Array.isArray(result.memoryProposals) ? { memories: result.memoryProposals } : result.memoryProposals), turnId: tid, attemptEpoch: epoch });
        const content = t.type === 'group' && result.status !== 'completed' ? t.content || result.content || '' : result.content ?? t.content;
        const success = result.status === 'completed';
        invariant(!success || t.type !== 'group' || !t.activeMember, 'member-busy', 'Current group member must commit before successful finalization', 409);
        invariant(!success || !Object.values(s.tools).some(r => r.turnId === tid && ['intent', 'running', 'unknown'].includes(r.status)), 'tool-result-unknown', 'Unresolved tool side effects prevent successful completion', 409);
        if (content && !['auxiliary', 'impersonate', 'group'].includes(t.type)) {
            if (t.targetMessageId) {
                const m = get(s.messages, t.targetMessageId); const old = current(m);
                const candidateId = t.type === 'continue' && success ? old.candidateId : t.candidateId;
                const v = { ...copy(old), turnId: tid, revision: Math.max(...m.versions.map(v => v.revision)) + 1, candidateId, candidateRevision: Math.max(0, ...m.versions.filter(v => v.candidateId === candidateId).map(v => v.candidateRevision ?? 0)) + 1, content: t.type === 'continue' ? old.content + content : content, status: success ? 'completed' : 'partial' };
                m.versions.push(v); if (success) { select(m, v); c.contentRevision++; invalidate(s, c.id); }
            } else { const m = newMessage(s, c.id, tid, 'assistant', content, success ? 'completed' : 'partial', [], { id: t.messageId, candidateId: t.candidateId }); t.messageId = m.id; t.candidateId = m.candidateId; c.contentRevision++; }
        }
        if (t.type === 'group' && t.activeMember && content && !success) {
            const member = t.activeMember;
            newMessage(s, c.id, tid, 'assistant', content, 'partial', [], { id: member.messageId, candidateId: member.candidateId, characterId: member.characterId, memberRunId: member.memberRunId, reasoning: t.reasoning });
            c.contentRevision++;
        }
        if (success && t.type !== 'group') applyEffects(c, result.effects);
        Object.assign(t, redact({ status: result.status, content, reasoning: result.reasoning ?? t.reasoning, usage: result.usage ?? t.usage, error: result.error, completedAt: now() }));
        c.activeTurnId = null;
        for (const tool of Object.values(s.tools)) if (tool.turnId === tid && ['intent', 'running'].includes(tool.status)) tool.status = 'unknown';
        event(s, c.id, `turn.${t.status}`, { turnId: tid, status: t.status, recovery }, tid); return t;
    };
    const api = {
        createConversation: ({ title = '', settings = {}, resourceRefs = [] } = {}) => tx(s => { const c = { id: id(), title, contentRevision: 0, memoryRevision: 0, activeTurnId: null, resourceRefs: copy(resourceRefs), explicitResourceRefs: copy(resourceRefs), settings: copy(settings), createdAt: now() }; s.conversations[c.id] = c; c.resourceRefs = refs(s, c); event(s, c.id, 'conversation.changed', {}); return c; }),
        listConversations: () => redact(Object.values(read().conversations)),
        getConversation: cid => snapshot(read(), cid),
        deleteConversation: (cid, revision) => tx(s => { const c = conv(s, cid); idle(c); check(c.contentRevision, revision); for (const kind of ['messages', 'turns', 'snapshots', 'summaries', 'memories', 'folds', 'jobs', 'tools', 'traces']) for (const [key, value] of Object.entries(s[kind])) if (value.conversationId === cid) delete s[kind][key]; delete s.events[cid]; delete s.conversations[cid]; return { deleted: true }; }),
        createResource: input => tx(s => { invariant(RESOURCE_KINDS.includes(input.kind), 'invalid-resource', 'Unknown resource kind'); const r = { ...copy(input), id: id(), revision: 1 }; s.resources[r.id] = { revision: 1, versions: { 1: r } }; return redact(r); }),
        listResources: kind => Object.values(read().resources).filter(r => !r.deletedAt).map(r => redact(r.versions[r.revision])).filter(r => !kind || r.kind === kind),
        getResource: (rid, revision) => redact(resource(read(), rid, revision)),
        getConnection: (rid, revision) => { const r = resource(read(), rid, revision); invariant(r.kind === 'connection', 'invalid-resource', 'Expected connection'); return r; },
        updateResource: (rid, input) => tx(s => { const old = resource(s, rid); check(old.revision, input.expectedRevision); const r = { ...old, name: input.name ?? old.name, data: copy(input.data ?? old.data), revision: old.revision + 1 }; s.resources[rid].versions[r.revision] = r; s.resources[rid].revision = r.revision; for (const c of Object.values(s.conversations)) { invalidate(s, c.id); event(s, c.id, 'resource.updated', { id: rid, revision: r.revision }); } return redact(r); }),
        deleteResource: (rid, revision) => tx(s => { const r = resource(s, rid); check(r.revision, revision); s.resources[rid].deletedAt = now(); for (const c of Object.values(s.conversations)) { invalidate(s, c.id); event(s, c.id, 'resource.deleted', { id: rid }); } return { deleted: true }; }),
        beginTurn: (cid, request, preflight) => tx(s => {
            validateTurnRequest(request); const c = conv(s, cid); const hash = canonicalJson(request);
            const prior = s[UNIT].values('turns', cid).find(t => t.clientRequestId === request.clientRequestId);
            if (prior) { invariant(prior.payloadHash === hash, 'idempotency-conflict', 'Request ID reused with different payload', 409); return { turn: prior, snapshot: s.snapshots[prior.snapshotId], replayed: true }; }
            check(c.contentRevision, request.expectedContentRevision); idle(c);
            if (request.media !== undefined) validateMedia(s, request.media);
            if (request.targetMessageId) { const target = get(s.messages, request.targetMessageId); invariant(target.conversationId === cid && !target.deletedAt && current(target).role === 'assistant', 'invalid-target', 'Expected current assistant message'); }
            const before = snapshot(s, cid, true);
            if (preflight) { const value = preflight(copy(before), copy(request)); invariant(!value?.then, 'async-preflight', 'Preflight must be synchronous'); }
            const tid = id();
            let userMessageId;
            if (request.retryTurnId) {
                const previous = get(s.turns, request.retryTurnId);
                invariant(previous.conversationId === cid && ['failed', 'stopped', 'interrupted'].includes(previous.status) && previous.type === request.type, 'invalid-retry', 'Retry requires a failed turn of the same type and conversation', 409);
                invariant(previous.request.content === request.content && canonicalJson(previous.request.media ?? []) === canonicalJson(request.media ?? []) && previous.targetMessageId === request.targetMessageId, 'invalid-retry', 'Retry must preserve the original input', 409);
                userMessageId = previous.userMessageId ?? s[UNIT].values('messages', cid).find(m => m.turnId === previous.id && current(m).role === 'user')?.id;
                invariant(!['send', 'group'].includes(request.type) || userMessageId && !get(s.messages, userMessageId).deletedAt, 'invalid-retry', 'Original user message no longer available', 409);
            } else if (['send', 'group'].includes(request.type)) { userMessageId = newMessage(s, cid, tid, 'user', request.content, 'completed', request.media ?? []).id; c.contentRevision++; }
            c.activeTurnId = tid; c.resourceRefs = refs(s, c);
            const snap = snapshot(s, cid); s.snapshots[snap.id] = snap;
            const t = { id: tid, conversationId: cid, clientRequestId: request.clientRequestId, payloadHash: hash, type: request.type, targetMessageId: request.targetMessageId, status: 'queued', attemptEpoch: 1, snapshotId: snap.id, userMessageId, content: '', reasoning: '', usage: null, request: copy(request), cancelRequested: false, messageId: request.targetMessageId ?? id(), candidateId: id() };
            s.turns[tid] = t; event(s, cid, 'turn.accepted', { turnId: tid }, tid); return { turn: t, snapshot: snap, replayed: false };
        }),
        startMember: (tid, input, epoch) => tx(s => {
            const t = live(s, tid, epoch);
            invariant(t.type === 'group' && typeof input.memberRunId === 'string' && input.memberRunId && typeof input.characterId === 'string', 'invalid-member', 'Group member identifiers required');
            const completed = (t.members ?? []).find(m => m.memberRunId === input.memberRunId);
            if (completed) { invariant(completed.characterId === input.characterId, 'idempotency-conflict', 'Member identity changed', 409); return completed; }
            if (t.activeMember) { invariant(t.activeMember.memberRunId === input.memberRunId && t.activeMember.characterId === input.characterId, 'member-busy', 'Previous member has not committed', 409); return { ...t.activeMember, status: 'generating' }; }
            const member = { memberRunId: input.memberRunId, characterId: input.characterId, messageId: id(), candidateId: id() };
            t.activeMember = member; t.messageId = member.messageId; t.candidateId = member.candidateId; t.content = ''; t.reasoning = ''; t.status = 'generating';
            event(s, t.conversationId, 'group.member.started', member, tid);
            return { ...member, status: 'generating' };
        }),
        commitMember: (tid, input, epoch) => tx(s => {
            const t = live(s, tid, epoch);
            invariant(t.type === 'group', 'invalid-turn', 'Members require a group turn');
            invariant(typeof input.memberRunId === 'string' && input.memberRunId && typeof input.content === 'string', 'invalid-member', 'Member run ID and content required');
            const fingerprint = canonicalJson(input);
            const prior = (t.members ?? []).find(m => m.memberRunId === input.memberRunId);
            if (prior) { invariant(prior.fingerprint === fingerprint, 'idempotency-conflict', 'Member result changed', 409); return prior; }
            invariant(!t.activeMember || t.activeMember.memberRunId === input.memberRunId && t.activeMember.characterId === input.characterId, 'invalid-member', 'Member does not match active stream', 409);
            applyEffects(conv(s, t.conversationId), input.effects);
            const streamIds = t.activeMember ? { id: t.activeMember.messageId, candidateId: t.activeMember.candidateId } : {};
            const m = input.content ? newMessage(s, t.conversationId, tid, 'assistant', input.content, 'completed', [], { ...streamIds, characterId: input.characterId, memberRunId: input.memberRunId }) : null;
            t.activeMember = null; t.content = input.content; t.reasoning = input.reasoning ?? t.reasoning;
            const member = redact({ ...copy(input), fingerprint, messageId: m?.id, status: 'completed' });
            (t.members ??= []).push(member);
            if (m) conv(s, t.conversationId).contentRevision++;
            event(s, t.conversationId, 'group.member.completed', member, tid);
            return member;
        }),
        advanceTurn: (tid, status, epoch) => tx(s => {
            const t = live(s, tid, epoch);
            invariant(['preparing', 'generating', 'tool_running', 'finalizing'].includes(status), 'invalid-status', 'Invalid active turn phase');
            invariant(t.status !== 'finalizing' || status === 'finalizing', 'invalid-status', 'Finalizing cannot return to generation', 409);
            if (t.status !== status) { t.status = status; event(s, t.conversationId, 'turn.phase', { status }, tid); }
            return t;
        }),
        getCandidates: (cid, mid) => {
            const s = read(); conv(s, cid); const m = get(s.messages, mid);
            invariant(m.conversationId === cid, 'not-found', 'Message not found', 404);
            return m.versions.filter(v => v.candidateId).map(v => ({ ...copy(v), selected: v.revision === m.revision && v.candidateId === m.candidateId && v.candidateRevision === m.candidateRevision }));
        },
        getTurn: tid => redact(get(read().turns, tid)),
        appendDelta: (tid, delta, epoch) => tx(s => { const t = live(s, tid, epoch); for (const [key, type] of [['text', 'text.delta'], ['reasoning', 'reasoning.delta']]) if (delta[key] !== undefined) { invariant(typeof delta[key] === 'string', 'invalid-delta', 'Delta must be text'); const field = key === 'text' ? 'content' : 'reasoning'; const offset = t[field].length; t[field] += delta[key]; event(s, t.conversationId, type, { text: delta[key], offset, messageId: t.messageId, candidateId: t.candidateId }, tid); } t.status = 'generating'; return t; }),
        appendEvent: (cid, type, payload, tid) => tx(s => { if (tid) { const t = get(s.turns, tid); invariant(t.conversationId === cid && !terminal(t) && !t.cancelRequested, 'late-callback', 'Turn no longer active', 409); } return event(s, cid, type, payload, tid); }),
        events: (cid, after = 0) => { const s = read(); conv(s, cid); return s[UNIT].events(cid, after); },
        finishTurn: (tid, result, epoch) => tx(s => finish(s, tid, result, epoch)),
        requestStop: tid => tx(s => { const t = get(s.turns, tid); if (!terminal(t) && !t.cancelRequested) { t.cancelRequested = true; event(s, t.conversationId, 'turn.phase', { status: 'stopping' }, tid); } return t; }),
        recoverInterrupted: () => tx(s => { const recovered = []; for (const t of Object.values(s.turns)) if (!terminal(t)) recovered.push(finish(s, t.id, { status: 'interrupted' }, t.attemptEpoch, true)); return recovered; }),
        command: (cid, cmd) => tx(s => {
            const c = conv(s, cid); idle(c);
            if (cmd.type === 'memory.create') {
                check(c.memoryRevision, cmd.expectedMemoryRevision);
                invariant(['character', 'relationship', 'world-state', 'timeline', 'user-fact'].includes(cmd.kind), 'invalid-memory', 'Unknown memory kind');
                invariant(typeof cmd.content === 'string' && cmd.content.trim().length > 0 && cmd.content.length <= 8000, 'invalid-memory', 'Memory content must contain 1 to 8000 characters');
                invariant(cmd.locked === undefined || typeof cmd.locked === 'boolean', 'invalid-memory', 'Memory lock must be boolean');
                const b = { id: id(), conversationId: cid, kind: cmd.kind, content: cmd.content, locked: cmd.locked ?? false, origin: 'manual', sourceRefs: [], revision: 1, status: 'valid' };
                s.memories[b.id] = b; c.memoryRevision++;
                event(s, cid, 'memory.updated', { id: b.id, type: cmd.type });
            } else if (cmd.type.startsWith('memory.')) {
                const b = get(s.memories, cmd.memoryId ?? cmd.blockId ?? cmd.id); invariant(b.conversationId === cid, 'not-found', 'Memory not found', 404); check(b.revision, cmd.expectedBlockRevision);
                if (cmd.type === 'memory.edit') { b.content = cmd.content; b.origin = 'manual'; }
                else if (cmd.type === 'memory.lock') b.locked = cmd.locked ?? true;
                else if (cmd.type === 'memory.confirm') { b.sourceRefs = []; b.parentSummaryRefs = []; b.memoryRefs = []; b.resourceRefs = []; b.origin = 'manual'; b.status = 'valid'; }
                else invariant(false, 'invalid-command', 'Unknown memory command');
                b.revision++; c.memoryRevision++; invalidate(s, cid); event(s, cid, 'memory.updated', { id: b.id });
            } else {
                check(c.contentRevision, cmd.expectedContentRevision);
                if (cmd.type === 'conversation.configure') { c.settings = { ...c.settings, ...copy(cmd.settings) }; if (cmd.title !== undefined) c.title = cmd.title; if (cmd.resourceRefs !== undefined) c.explicitResourceRefs = copy(cmd.resourceRefs); c.resourceRefs = refs(s, c); }
                else if (cmd.type === 'fold.expand') { const b = get(s.folds, cmd.foldId ?? cmd.id); invariant(b.conversationId === cid, 'not-found', 'Fold not found', 404); b.status = 'stale'; b.revision++; c.memoryRevision++; }
                else {
                    const m = get(s.messages, cmd.messageId); invariant(m.conversationId === cid && !m.deletedAt, 'not-found', 'Message not found', 404);
                    if (cmd.type === 'message.delete') m.deletedAt = now();
                    else if (cmd.type === 'message.edit') { if (cmd.media !== undefined) validateMedia(s, cmd.media); const old = current(m); const v = { ...copy(old), content: cmd.content ?? old.content, media: copy(cmd.media ?? old.media), revision: Math.max(...m.versions.map(v => v.revision)) + 1, candidateRevision: old.candidateId ? Math.max(...m.versions.filter(v => v.candidateId === old.candidateId).map(v => v.candidateRevision)) + 1 : null }; m.versions.push(v); select(m, v); }
                    else if (cmd.type === 'candidate.select') { const v = [...m.versions].reverse().find(v => v.candidateId === cmd.candidateId && (cmd.candidateRevision === undefined || v.candidateRevision === cmd.candidateRevision)); invariant(v, 'not-found', 'Candidate not found', 404); select(m, v); }
                    else invariant(false, 'invalid-command', 'Unknown command');
                }
                c.contentRevision++; invalidate(s, cid); event(s, cid, 'conversation.changed', { type: cmd.type });
            }
            return snapshot(s, cid);
        }),
        commitDerived: (cid, proposal) => tx(s => derived(s, cid, proposal)),
        createJob: input => tx(s => { conv(s, input.conversationId); const fingerprint = canonicalJson([input.conversationId, input.kind, input.dependencies]); const old = Object.values(s.jobs).find(j => j.fingerprint === fingerprint); if (old) return old; const j = { ...copy(input), id: id(), fingerprint, status: 'pending', attempts: 0 }; s.jobs[j.id] = j; event(s, j.conversationId, 'job.updated', { id: j.id, status: j.status }); return j; }),
        listJobs: cid => Object.values(read().jobs).filter(j => !cid || j.conversationId === cid),
        updateJob: (jid, patch) => tx(s => { const j = get(s.jobs, jid); for (const key of ['status', 'attempts', 'result', 'error', 'payload', 'completedAt']) if (patch[key] !== undefined) j[key] = copy(patch[key]); invariant(Number.isInteger(j.attempts) && j.attempts >= 0 && j.attempts <= 2, 'retry-limit', 'At most one recomputation allowed'); event(s, j.conversationId, 'job.updated', { id: jid, status: j.status }); return j; }),
        recordTool: input => tx(s => { const t = get(s.turns, input.turnId); invariant(t.conversationId === input.conversationId, 'invalid-tool', 'Tool conversation mismatch'); const old = Object.values(s.tools).find(r => r.turnId === input.turnId && r.memberRunId === input.memberRunId && r.toolCallId === input.toolCallId); if (old) { invariant(old.requestHash === input.requestHash, 'idempotency-conflict', 'Tool call payload changed', 409); return { record: old, replayed: true }; } live(s, t.id, t.attemptEpoch); const r = { ...copy(input), id: id(), status: 'intent', attemptEpoch: t.attemptEpoch }; s.tools[r.id] = r; event(s, t.conversationId, 'tool.call', { id: r.id, name: r.name }, t.id); return { record: r, replayed: false }; }),
        finishTool: (rid, result) => tx(s => { const r = get(s.tools, rid); live(s, r.turnId, r.attemptEpoch); invariant(['intent', 'running'].includes(r.status), 'late-callback', 'Tool already finalized', 409); invariant(['completed', 'failed', 'unknown'].includes(result.status), 'invalid-status', 'Invalid tool status'); Object.assign(r, redact(result)); event(s, r.conversationId, 'tool.result', { id: rid, status: r.status }, r.turnId); return r; }),
        getTool: rid => redact(get(read().tools, rid)),
        saveTrace: input => tx(s => {
            conv(s, input.conversationId);
            const traceId = input.id ?? id();
            invariant(typeof traceId === 'string' && traceId && !['__proto__', 'constructor', 'prototype'].includes(traceId), 'invalid-trace', 'Invalid trace ID');
            if (input.turnId) invariant(get(s.turns, input.turnId).conversationId === input.conversationId, 'invalid-trace', 'Trace turn conversation mismatch');
            const previous = s.traces[traceId];
            invariant(!previous || previous.conversationId === input.conversationId && (previous.turnId ?? null) === (input.turnId ?? null), 'trace-conflict', 'Trace identity cannot change', 409);
            const trace = redact({ ...previous, ...copy(input), id: traceId }); s.traces[traceId] = trace; return trace;
        }),
        getTrace: rid => get(read().traces, rid),
        listTraces: cid => Object.values(read().traces).filter(t => t.conversationId === cid),
        getMessageHistory: mid => copy(get(read().messages, mid).versions),
        saveAttachment: input => tx(s => {
            const record = copy(validateAttachment(input));
            const previous = s.attachments[record.id];
            invariant(!previous || canonicalJson(previous) === canonicalJson(record), 'attachment-conflict', 'Attachment metadata is immutable', 409);
            invariant(!Object.values(s.attachments).some(a => a.id !== record.id && a.path === record.path), 'attachment-conflict', 'Attachment file ID is already registered', 409);
            s.attachments[record.id] = record; return record;
        }),
        getAttachment: aid => copy(get(read().attachments, aid)),
        listAttachments: () => Object.values(read().attachments),
        deleteAttachment: aid => tx(s => {
            get(s.attachments, aid);
            const references = value => Array.isArray(value) ? value.some(references) : value && typeof value === 'object' ? value.attachmentId === aid || Object.values(value).some(references) : false;
            for (const table of ENTITY_TABLES.filter(table => table !== 'attachments')) invariant(!Object.values(s[table]).some(references), 'attachment-in-use', 'Attachment is referenced by retained data', 409);
            invariant(!Object.values(s.events).some(references), 'attachment-in-use', 'Attachment is referenced by events', 409);
            delete s.attachments[aid]; return { deleted: true };
        }),
        validateBackup: data => {
            invariant(read()[UNIT].isEmpty(), 'restore-not-empty', 'Restore requires an entirely empty store', 409);
            validateBackupData(data); return { valid: true };
        },
        exportData: () => materialize(read()),
        restoreData: data => tx(s => {
            invariant(s[UNIT].isEmpty(), 'restore-not-empty', 'Restore requires an entirely empty store', 409);
            const restored = validateBackupData(data);
            for (const table of [...ENTITY_TABLES, 'events']) for (const [key, value] of Object.entries(restored[table])) s[table][key] = value;
            // Flush validated records before recovery appends events so restored sequence numbers are authoritative.
            s[UNIT].flush();
            const recovery = read();
            for (const t of Object.values(recovery.turns)) if (!terminal(t)) finish(recovery, t.id, { status: 'interrupted' }, t.attemptEpoch, true);
            recovery[UNIT].flush();
            return { restored: true };
        }),
        close: () => { if (!closed) { invariant(!busy, 'store-busy', 'Cannot close in a transaction'); db.close(); closed = true; unlinkSync(lock); } },
    };
    try { invariant(read().schemaVersion === SCHEMA_VERSION, 'schema-version', 'Unsupported database schema', 409); api.recoverInterrupted(); } catch (error) { api.close(); throw error; }
    return api;
}
