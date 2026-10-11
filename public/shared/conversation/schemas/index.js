/** New conversation protocol. This module is shared with the browser. */
export const SCHEMA_VERSION = 1;
export const BACKUP_MAX_BYTES = 256 * 1024 * 1024;
export const API_BASE = '/api/conversation/v1';
export const TURN_TYPES = Object.freeze(['send', 'regenerate', 'continue', 'impersonate', 'auxiliary', 'group']);
export const TERMINAL_STATES = Object.freeze(['completed', 'stopped', 'failed', 'interrupted']);
export const RESOURCE_KINDS = Object.freeze(['character', 'persona', 'preset', 'worldbook', 'group', 'connection']);
export const TOOL_LIMITS = Object.freeze({ rounds: 5, callsPerRound: 8, resultBytes: 32768, timeoutMs: 30000, turnTimeoutMs: 180000 });

export class ProtocolError extends Error {
    constructor(code, message, status = 400, details = {}) {
        super(message);
        this.name = 'ProtocolError';
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

export function invariant(condition, code, message, status = 400, details = {}) {
    if (!condition) throw new ProtocolError(code, message, status, details);
}

export function canonicalJson(value) {
    if (value === undefined) return 'null';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function requireObject(value, name = 'body') {
    invariant(value && typeof value === 'object' && !Array.isArray(value), 'invalid-request', `${name} must be an object`);
    return value;
}

export function requireString(value, name, max = 1000000) {
    invariant(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'invalid-request', `${name} must be a non-empty string (max ${max})`);
    return value;
}

export function requireRevision(value, name = 'expectedContentRevision') {
    invariant(Number.isSafeInteger(value) && value >= 0, 'invalid-request', `${name} must be a nonnegative integer`);
    return value;
}

export function validateTurnRequest(body) {
    requireObject(body);
    invariant(body.schemaVersion === SCHEMA_VERSION, 'schema-version', 'Unsupported conversation protocol version', 409);
    requireString(body.clientRequestId, 'clientRequestId', 128);
    requireRevision(body.expectedContentRevision);
    invariant(TURN_TYPES.includes(body.type), 'invalid-request', 'Unknown generation type');
    if (body.type === 'send' || body.type === 'group') requireString(body.content, 'content');
    if (body.type === 'regenerate' || body.type === 'continue') requireString(body.targetMessageId, 'targetMessageId', 128);
    return body;
}

export function validateSourceRef(ref) {
    requireObject(ref, 'sourceRef');
    requireString(ref.messageId, 'sourceRef.messageId', 128);
    requireRevision(ref.revision, 'sourceRef.revision');
    if (ref.candidateId != null) {
        requireString(ref.candidateId, 'sourceRef.candidateId', 128);
        requireRevision(ref.candidateRevision, 'sourceRef.candidateRevision');
    }
    return ref;
}

export function sourceRef(message) {
    return { messageId: message.id, revision: message.revision, candidateId: message.candidateId ?? null, candidateRevision: message.candidateRevision ?? null };
}

export function serializeError(error) {
    return { code: error?.code || 'internal-error', message: error instanceof ProtocolError ? error.message : 'The operation could not be completed', details: error instanceof ProtocolError ? error.details : {} };
}
