import { validateMediaReferences } from './media.js';
import { CONNECTION_SETTING_KEYS, auxiliaryConnectionIds } from './references.js';
import { SCHEMA_VERSION, TURN_TYPES, TERMINAL_STATES, RESOURCE_KINDS, canonicalJson, invariant, validateTurnRequest } from '../../../public/shared/conversation/schemas/index.js';
import { ENTITY_TABLES, SECRET_SCHEMA } from './persistence.js';

const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const integer = (x, min = 0) => Number.isSafeInteger(x) && x >= min;
const text = x => typeof x === 'string';
const identifier = x => text(x) && x.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(x);
const assert = (condition, message) => invariant(condition, 'invalid-backup', message, 400);
const has = (map, key) => identifier(key) && Object.hasOwn(map, key);
const optionalArray = x => x === undefined || Array.isArray(x);
const activeStates = ['queued', 'preparing', 'generating', 'tool_running', 'finalizing'];
const blockStates = ['valid', 'stale', 'pending-confirm'];

export function validateAttachment(record) {
    invariant(object(record) && identifier(record.id) && text(record.name) && text(record.mime)
        && integer(record.size) && /^[a-f0-9]{64}$/i.test(record.sha256)
        && text(record.path) && /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)?$/.test(record.path)
        && record.path !== '.' && record.path !== '..' && (text(record.createdAt) || integer(record.createdAt)),
    'invalid-attachment', 'Attachment requires an opaque relative file ID and valid metadata');
    return record;
}

/** Validate the complete internal backup graph before any entity is inserted. */
export function validateBackup(input) {
    assert(object(input), 'Backup must be an object');
    invariant(input.schemaVersion === SCHEMA_VERSION, 'schema-version', 'Unsupported backup schema', 409);
    assert(canonicalJson(input.secretSchema) === canonicalJson(SECRET_SCHEMA), 'Backup must declare the credential-bearing secretSchema');
    const tables = [...ENTITY_TABLES, 'events'];
    assert(Object.keys(input).every(key => ['schemaVersion', 'secretSchema', ...tables].includes(key)), 'Unknown backup table');
    for (const table of tables) assert(object(input[table]), `Missing or invalid ${table} table`);
    const data = structuredClone(input);
    // Prohibit prototype keys throughout the imported graph, not just in top-level IDs.
    const safeJson = value => {
        if (Array.isArray(value)) return value.forEach(safeJson);
        if (object(value)) for (const [key, child] of Object.entries(value)) { assert(!['__proto__', 'constructor', 'prototype'].includes(key), 'Unsafe object key'); safeJson(child); }
        else assert(value === null || ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value)) || value === undefined, 'Invalid JSON value');
    };
    safeJson(data);
    for (const table of ENTITY_TABLES) for (const [key, row] of Object.entries(data[table])) {
        assert(identifier(key) && object(row), `Invalid ${table} row`);
        if (table !== 'resources') assert(row.id === key, `${table} key differs from entity ID`);
        if (!['conversations', 'resources', 'attachments'].includes(table)) assert(has(data.conversations, row.conversationId), `${table} references missing conversation`);
    }
    const owner = (table, key, cid) => has(data[table], key) && data[table][key].conversationId === cid;
    const resourceRef = ref => {
        assert(object(ref) && has(data.resources, ref.id) && integer(ref.revision, 1), 'Invalid resource reference');
        assert(Object.hasOwn(data.resources[ref.id].versions, ref.revision), 'Missing resource revision');
    };
    const media = items => { try { validateMediaReferences(data.attachments, items); } catch { assert(false, 'Invalid media attachment reference or metadata'); } };
    for (const a of Object.values(data.attachments)) { try { validateAttachment(a); } catch { assert(false, 'Invalid attachment metadata or unsafe path'); } }
    const paths = Object.values(data.attachments).map(a => a.path);
    assert(new Set(paths).size === paths.length, 'Attachment paths must be unique');
    for (const [rid, r] of Object.entries(data.resources)) {
        assert(integer(r.revision, 1) && object(r.versions) && Object.hasOwn(r.versions, r.revision), 'Invalid resource head');
        for (const [rev, v] of Object.entries(r.versions)) {
            assert(object(v) && v.id === rid && integer(v.revision, 1) && String(v.revision) === rev && RESOURCE_KINDS.includes(v.kind) && object(v.data), 'Invalid resource revision');
            if (v.kind === 'connection') for (const rid of auxiliaryConnectionIds(v.data.auxiliary)) assert(has(data.resources, rid) && data.resources[rid].versions?.[data.resources[rid].revision]?.kind === 'connection', 'Missing auxiliary connection');
            if (v.kind === 'group' && v.data.members !== undefined) {
                assert(Array.isArray(v.data.members), 'Invalid group members');
                for (const member of v.data.members) { const mid = typeof member === 'string' ? member : member?.characterId ?? member?.id; assert(has(data.resources, mid) && data.resources[mid].versions[data.resources[mid].revision]?.kind === 'character', 'Missing group character'); }
            }
        }
    }
    for (const c of Object.values(data.conversations)) {
        assert(text(c.title) && integer(c.contentRevision) && integer(c.memoryRevision) && object(c.settings) && Array.isArray(c.resourceRefs), 'Invalid conversation');
        c.resourceRefs.forEach(resourceRef);
        assert(optionalArray(c.explicitResourceRefs), 'Invalid explicit resource references');
        for (const ref of c.explicitResourceRefs ?? []) resourceRef(ref);
        for (const key of [...CONNECTION_SETTING_KEYS, 'characterId', 'personaId', 'presetId', 'groupId']) if (c.settings[key]) {
            assert(has(data.resources, c.settings[key]), 'Missing configured resource');
            if (CONNECTION_SETTING_KEYS.includes(key)) assert(data.resources[c.settings[key]].versions[data.resources[c.settings[key]].revision].kind === 'connection', 'Configured auxiliary resource must be a connection');
        }
        assert(optionalArray(c.settings.worldbookIds), 'Invalid configured worldbooks');
        for (const rid of c.settings.worldbookIds ?? []) assert(has(data.resources, rid), 'Missing worldbook');
        assert(c.activeTurnId === null || owner('turns', c.activeTurnId, c.id), 'Invalid active turn');
    }
    const messageVersion = (v, mid, cid) => {
        assert(object(v) && v.id === mid && v.conversationId === cid && ['user', 'assistant', 'system', 'tool'].includes(v.role)
            && text(v.content) && integer(v.revision, 1) && ['completed', 'partial'].includes(v.status), 'Invalid message version');
        assert(v.candidateId === null ? v.candidateRevision === null : identifier(v.candidateId) && integer(v.candidateRevision, 1), 'Invalid candidate version');
        assert(owner('turns', v.turnId, cid), 'Missing message turn'); media(v.media);
    };
    const sourceExists = (ref, cid, current = false) => {
        assert(object(ref) && owner('messages', ref.messageId, cid) && integer(ref.revision, 1), 'Missing source message');
        const m = data.messages[ref.messageId];
        assert(m.versions.some(v => v.revision === ref.revision && v.candidateId === (ref.candidateId ?? null) && v.candidateRevision === (ref.candidateRevision ?? null)), 'Missing source revision or candidate');
        if (current) assert(!m.deletedAt && m.revision === ref.revision && m.candidateId === (ref.candidateId ?? null) && m.candidateRevision === (ref.candidateRevision ?? null), 'Valid block references stale message');
    };
    for (const m of Object.values(data.messages)) {
        assert(Array.isArray(m.versions) && m.versions.length > 0 && integer(m.revision, 1), 'Invalid message history');
        const versions = new Set();
        for (const v of m.versions) { messageVersion(v, m.id, m.conversationId); assert(!versions.has(v.revision), 'Duplicate message revision'); versions.add(v.revision); }
        assert(m.versions.some(v => v.revision === m.revision && v.candidateId === m.candidateId && v.candidateRevision === m.candidateRevision), 'Missing selected message version');
    }
    const requestIds = new Set();
    for (const t of Object.values(data.turns)) {
        assert(TURN_TYPES.includes(t.type) && [...activeStates, ...TERMINAL_STATES].includes(t.status) && integer(t.attemptEpoch, 1)
            && text(t.content) && text(t.reasoning) && typeof t.cancelRequested === 'boolean', 'Invalid turn state');
        try { validateTurnRequest(t.request); } catch { assert(false, 'Invalid accepted request'); }
        if (t.request.media !== undefined) media(t.request.media);
        if (t.userMessageId) assert(owner('messages', t.userMessageId, t.conversationId) && data.messages[t.userMessageId].role === 'user', 'Invalid reused user message');
        if (t.activeMember) assert(object(t.activeMember) && identifier(t.activeMember.memberRunId) && identifier(t.activeMember.characterId) && identifier(t.activeMember.messageId) && identifier(t.activeMember.candidateId), 'Invalid active member');
        assert(t.request.clientRequestId === t.clientRequestId && t.request.type === t.type && t.payloadHash === canonicalJson(t.request), 'Turn request identity mismatch');
        const key = canonicalJson([t.conversationId, t.clientRequestId]); assert(!requestIds.has(key), 'Duplicate turn request'); requestIds.add(key);
        assert(owner('snapshots', t.snapshotId, t.conversationId), 'Missing turn snapshot');
        if (t.targetMessageId) assert(owner('messages', t.targetMessageId, t.conversationId), 'Missing target message');
        if (t.request.retryTurnId) assert(owner('turns', t.request.retryTurnId, t.conversationId) && ['failed', 'stopped', 'interrupted'].includes(data.turns[t.request.retryTurnId].status), 'Invalid retry source');
        if (!TERMINAL_STATES.includes(t.status)) assert(data.conversations[t.conversationId].activeTurnId === t.id, 'Unfinished turn is not active');
        else assert(data.conversations[t.conversationId].activeTurnId !== t.id, 'Terminal turn is still active');
        assert(optionalArray(t.members), 'Invalid members');
        const members = new Set();
        for (const m of t.members ?? []) { assert(identifier(m.memberRunId) && !members.has(m.memberRunId) && text(m.content), 'Invalid or duplicate group member'); members.add(m.memberRunId); if (m.messageId) assert(owner('messages', m.messageId, t.conversationId), 'Missing group member message'); }
    }
    const block = (b, cid, historical = false) => {
        assert(object(b) && identifier(b.id) && integer(b.revision, 1) && blockStates.includes(b.status) && Array.isArray(b.sourceRefs), 'Invalid derived block');
        for (const ref of b.sourceRefs) sourceExists(ref, cid, !historical && b.status === 'valid');
        for (const key of ['parentSummaryRefs', 'memoryRefs', 'resourceRefs']) assert(optionalArray(b[key]), 'Invalid derived references');
        for (const ref of [...(b.parentSummaryRefs ?? []), ...(b.summaryRef ? [b.summaryRef] : [])]) {
            const rid = ref?.id ?? ref?.summaryId;
            assert(owner('summaries', rid, cid) && integer(ref.revision, 1) && ref.revision <= data.summaries[rid].revision, 'Missing parent summary');
            if (!historical && b.status === 'valid') assert(data.summaries[rid].revision === ref.revision && data.summaries[rid].status === 'valid', 'Stale parent summary');
        }
        for (const ref of b.memoryRefs ?? []) { const rid = ref?.id ?? ref?.memoryId; assert(owner('memories', rid, cid) && integer(ref.revision, 1) && ref.revision <= data.memories[rid].revision, 'Missing memory reference'); if (!historical && b.status === 'valid') assert(data.memories[rid].revision === ref.revision && data.memories[rid].status === 'valid', 'Stale memory reference'); }
        for (const ref of b.resourceRefs ?? []) { resourceRef(ref); if (!historical && b.status === 'valid') assert(!data.resources[ref.id].deletedAt && data.resources[ref.id].revision === ref.revision, 'Stale resource dependency'); }
    };
    for (const table of ['summaries', 'memories', 'folds']) for (const b of Object.values(data[table])) block(b, b.conversationId);
    for (const snap of Object.values(data.snapshots)) {
        assert(object(snap.conversation) && snap.conversation.id === snap.conversationId && object(snap.settings), 'Invalid snapshot conversation');
        for (const kind of ['messages', 'resources', 'summaries', 'memories', 'folds']) assert(Array.isArray(snap[kind]), 'Invalid snapshot collection');
        for (const m of snap.messages) { messageVersion(m, m.id, snap.conversationId); sourceExists({ messageId: m.id, revision: m.revision, candidateId: m.candidateId, candidateRevision: m.candidateRevision }, snap.conversationId); }
        if (snap.attachments !== undefined) {
            assert(object(snap.attachments), 'Invalid snapshot attachment index');
            for (const [aid, attachment] of Object.entries(snap.attachments)) {
                assert(has(data.attachments, aid) && object(attachment) && attachment.id === aid, 'Invalid snapshot attachment reference');
                const { path: internalPath, ...metadata } = data.attachments[aid];
                assert(canonicalJson(metadata) === canonicalJson(attachment), 'Snapshot attachment metadata differs from registered attachment');
            }
        }
        snap.resources.forEach(resourceRef);
        const frozenConnections = new Set(snap.resources.filter(r => r.kind === 'connection').map(r => r.id));
        for (const key of CONNECTION_SETTING_KEYS) if (snap.settings[key]) assert(frozenConnections.has(snap.settings[key]), 'Missing frozen configured connection');
        for (const r of snap.resources) if (r.kind === 'connection') for (const rid of auxiliaryConnectionIds(r.data.auxiliary)) assert(frozenConnections.has(rid), 'Missing frozen auxiliary connection');
        assert(Array.isArray(snap.conversation.resourceRefs) && integer(snap.conversation.contentRevision) && integer(snap.conversation.memoryRevision), 'Invalid snapshot revisions');
        snap.conversation.resourceRefs.forEach(resourceRef);
        if (snap.conversation.activeTurnId) assert(owner('turns', snap.conversation.activeTurnId, snap.conversationId), 'Missing snapshot turn');
        for (const kind of ['summaries', 'memories', 'folds']) for (const b of snap[kind]) block(b, snap.conversationId, true);
    }
    const eventIds = new Set();
    for (const [cid, list] of Object.entries(data.events)) {
        assert(has(data.conversations, cid) && Array.isArray(list), 'Invalid event conversation'); let seq = 0;
        for (const e of list) {
            assert(object(e) && e.schemaVersion === SCHEMA_VERSION && e.conversationId === cid && identifier(e.eventId) && !eventIds.has(e.eventId)
                && integer(e.seq, 1) && e.seq === seq + 1 && text(e.type) && object(e.entityRevisions)
                && integer(e.entityRevisions.contentRevision) && integer(e.entityRevisions.memoryRevision), 'Invalid event sequence or schema');
            if (e.turnId) assert(owner('turns', e.turnId, cid), 'Missing event turn'); eventIds.add(e.eventId); seq = e.seq;
        }
    }
    const jobFingerprints = new Set();
    for (const j of Object.values(data.jobs)) {
        assert(text(j.kind) && ['pending', 'running', 'ready', 'completed', 'failed', 'stale'].includes(j.status) && integer(j.attempts) && j.attempts <= 2 && object(j.payload), 'Invalid job');
        assert(j.fingerprint === canonicalJson([j.conversationId, j.kind, j.dependencies]) && !jobFingerprints.has(j.fingerprint), 'Invalid job fingerprint'); jobFingerprints.add(j.fingerprint);
        const refs = Array.isArray(j.dependencies) ? j.dependencies : j.dependencies?.sourceRefs;
        assert(Array.isArray(refs), 'Invalid job dependencies'); for (const ref of refs) sourceExists(ref, j.conversationId);
    }
    const calls = new Set();
    for (const r of Object.values(data.tools)) {
        assert(object(r.args) && owner('turns', r.turnId, r.conversationId) && identifier(r.toolCallId) && text(r.requestHash) && text(r.name) && ['intent', 'running', 'completed', 'failed', 'unknown'].includes(r.status) && integer(r.attemptEpoch, 1), 'Invalid tool record');
        const key = canonicalJson([r.turnId, r.memberRunId ?? null, r.toolCallId]); assert(!calls.has(key), 'Duplicate tool call'); calls.add(key);
    }
    for (const r of Object.values(data.traces)) if (r.turnId) assert(owner('turns', r.turnId, r.conversationId), 'Missing trace turn');
    return data;
}
