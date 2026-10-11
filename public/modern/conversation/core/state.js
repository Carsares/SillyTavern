import { SCHEMA_VERSION, TERMINAL_STATES, validateTurnRequest, requireRevision } from '../../../shared/conversation/schemas/index.js';
export const terminal = turn => !turn || TERMINAL_STATES.includes(turn.status);
export function initialState() {
    return { snapshot: null, turn: null, cursor: 0, stream: 'disconnected', busy: false, error: '', notice: '', pending: null, recoveredDraft: null, activity: [] };
}
export function hydrate(state, snapshot, turn = null) {
    return { ...state, snapshot, turn };
}
export function reduceEvent(state, event) {
    if (!state.snapshot || event.conversationId !== state.snapshot.conversation.id || event.seq <= state.cursor) return state;
    if (event.schemaVersion !== SCHEMA_VERSION) throw new Error('不支持的事件版本');
    const next = { ...state, cursor: event.seq };
    const payload = event.payload || {};
    // Snapshot + GET turn is authoritative. Unknown events trigger refresh in the controller.
    const isDelta = event.type === 'text.delta' || event.type === 'reasoning.delta' || event.type === 'turn.delta' || event.type === 'turn.reasoning' || event.type === 'turn.reasoning.delta';
    if (isDelta && state.turn?.id === event.turnId && !terminal(state.turn)) {
        const key = event.type.includes('reasoning') ? 'reasoning' : 'content';
        const content = state.turn[key] || '';
        const offset = payload.offset;
        if (!Number.isSafeInteger(offset) || offset < 0 || typeof payload.text !== 'string') throw new Error('无效增量事件');
        if (offset > content.length) return { ...next, needsRefresh: true };
        const overlap = content.slice(offset, offset + payload.text.length);
        if (overlap !== payload.text.slice(0, overlap.length)) return { ...next, needsRefresh: true };
        next.turn = { ...state.turn, [key]: content + payload.text.slice(Math.max(0, content.length - offset)) };
    } else next.needsRefresh = true;
    if (!isDelta) next.activity = [...(state.activity || []), { ...event, payload: redact(payload) }].slice(-200);
    return next;
}
export function turnRequest(snapshot, type, content, targetMessageId, clientRequestId, { media = [], members } = {}) {
    if (!snapshot) throw new Error('请先选择会话');
    const request = {
        schemaVersion: SCHEMA_VERSION, clientRequestId, type,
        expectedContentRevision: snapshot.conversation.contentRevision,
        ...(media.length ? { media: structuredClone(media) } : {}), ...(members?.length ? { members: [...members] } : {}),
        ...(content ? { content } : {}), ...(targetMessageId ? { targetMessageId } : {}),
    };
    return validateTurnRequest(request);
}
export function versionedCommand(snapshot, type, fields = {}) {
    if (!snapshot) throw new Error('请先选择会话');
    const memoryVersion = type === 'memory.create' ? { expectedMemoryRevision: requireRevision(snapshot.conversation.memoryRevision, 'expectedMemoryRevision') } : {};
    return { ...fields, ...memoryVersion, schemaVersion: SCHEMA_VERSION, type, expectedContentRevision: snapshot.conversation.contentRevision };
}
export function estimateRequest(draft, media = [], type = 'send') {
    if (typeof draft !== 'string' || !Array.isArray(media)) throw new Error('上下文估算需要文字草稿与媒体数组');
    return { draft, media: structuredClone(media), type };
}
/** Never display secrets even if an incorrectly configured server returns them. */
export function redact(value) {
    if (Array.isArray(value)) return value.map(redact);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(api.?key|authorization|password|secret|accessToken|refreshToken|token|headers)$/i.test(key)).map(([key, item]) => [key, redact(item)]));
}
export function list(value, key) {
    const result = Array.isArray(value) ? value : value?.[key];
    if (!Array.isArray(result)) throw new Error(`服务器缺少 ${key} 列表`);
    return result;
}
