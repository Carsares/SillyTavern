import { randomUUID } from 'node:crypto';

const SECRET = /authorization|api[-_]?key|password|secret|token|cookie|credential|^proxy$/i;
export function redact(value, key = '', seen = new WeakSet()) {
    if (SECRET.test(key) && !/tokens|tokenCount|tokenUsage/i.test(key)) return '[redacted]';
    if (typeof value === 'string') {
        return value.replace(/\b(Bearer\s+)[^\s"']+/gi, '$1[redacted]').replace(/([?&](?:key|api_key|token)=)[^&#\s]+/gi, '$1[redacted]');
    }
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const result = Array.isArray(value) ? value.map(item => redact(item, '', seen)) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k, seen)]));
    seen.delete(value);
    return result;
}

export function createTraceService({ store, now = () => new Date().toISOString(), id = randomUUID }) {
    const pending = new Map();
    function save(record) { store.saveTrace(redact(record)); }
    return {
        begin(value) {
            const record = { ...redact(value), id: id(), createdAt: now(), events: [], status: 'running' };
            save(record);
            pending.set(record.id, { id: record.id, conversationId: record.conversationId, turnId: record.turnId });
            return record.id;
        },
        record(traceId, event) {
            const record = pending.get(traceId);
            if (!record) return;
            store.appendTraceEvent(traceId, { ...redact(event), at: now() });
        },
        finish(traceId, result) {
            const record = pending.get(traceId);
            if (!record) return;
            save({ ...record, status: 'completed', usage: result.usage ?? null, finishedAt: now() });
            pending.delete(traceId);
        },
        fail(traceId, error) {
            const record = pending.get(traceId);
            if (!record) return;
            save({ ...record, status: 'failed', error: { code: error.code ?? 'generation-failed', message: 'Execution failed; review sanitized request and event records' }, finishedAt: now() });
            pending.delete(traceId);
        },
    };
}
