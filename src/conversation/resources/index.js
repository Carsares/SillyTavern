import { invariant, requireObject, requireString, RESOURCE_KINDS } from '../../../public/shared/conversation/schemas/index.js';

const RESERVED_PARAMETERS = new Set(['messages', 'prompt', 'tools', 'tool_choice', 'model', 'stream', 'max_tokens', 'max_completion_tokens', 'max_output_tokens', 'api_key', 'authorization']);
export function validateResource({ kind, name, data }) {
    invariant(RESOURCE_KINDS.includes(kind), 'invalid-resource', 'Unknown resource kind');
    requireString(name, 'name', 256);
    requireObject(data, 'data');
    if (kind === 'connection') {
        requireString(data.provider, 'provider', 80);
        invariant(['pi', 'native', 'claude', 'codex'].includes(data.executor ?? 'pi'), 'invalid-executor', 'Unknown executor');
        requireString(data.model, 'model', 256);
        if (data.baseUrl) {
            let url;
            try { url = new URL(data.baseUrl); } catch { invariant(false, 'invalid-url', 'Connection URL is invalid'); }
            invariant(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash, 'invalid-url', 'Use an HTTP(S) URL without embedded credentials');
        }
        for (const key of ['contextWindow', 'inputLimit', 'outputLimit', 'maxOutputTokens', 'workingBudget']) {
            if (data[key] !== undefined) invariant(Number.isSafeInteger(data[key]) && data[key] > 0, 'invalid-budget', `${key} must be a positive integer`);
        }
        if (data.maxOutputTokens && data.outputLimit) invariant(data.maxOutputTokens <= data.outputLimit, 'output-limit', 'Output reservation exceeds the model limit');
        for (const [key, value] of Object.entries(data.headers ?? {})) {
            invariant(!/^(authorization|cookie|host|content-length|connection|x-api-key)$/i.test(key), 'reserved-header', `Header ${key} is managed by the connection`);
            invariant(typeof value === 'string' && !/[\r\n]/.test(key + value), 'invalid-header', 'Headers cannot contain line breaks');
        }
        for (const key of Object.keys(data.parameters ?? {})) invariant(!RESERVED_PARAMETERS.has(key.toLowerCase()), 'reserved-parameter', `Parameter ${key} is managed by the runtime`);
    }
    if (kind === 'group') {
        invariant(Array.isArray(data.members) && data.members.length > 0 && data.members.length <= 32 && data.members.every(member => typeof member === 'string'), 'invalid-group', 'Group must contain 1–32 character IDs');
        invariant(new Set(data.members).size === data.members.length, 'invalid-group', 'Duplicate group members');
    }
    if (kind === 'worldbook') invariant(Array.isArray(data.entries), 'invalid-worldbook', 'Worldbook entries must be an array');
    return { kind, name, data };
}

export function createResourceService({ store }) {
    function checkReferences(resource) {
        if (resource.kind === 'group') for (const id of resource.data.members) invariant(store.getResource(id).kind === 'character', 'invalid-member', 'Every group member must be a character');
    }
    return {
        createResource(input) {
            validateResource(input); checkReferences(input);
            return store.createResource(input);
        },
        updateResource(id, input) {
            let previous = store.getResource(id);
            if (previous.kind === 'connection') previous = store.getConnection(id);
            const data = input.data ? { ...input.data } : previous.data;
            if (previous.kind === 'connection' && input.data && input.data.apiKey === undefined && previous.data.apiKey !== undefined) data.apiKey = previous.data.apiKey;
            if (previous.kind === 'connection' && input.data && input.data.headers === undefined && previous.data.headers !== undefined) data.headers = previous.data.headers;
            const value = { kind: previous.kind, name: input.name ?? previous.name, data };
            validateResource(value); checkReferences(value);
            return store.updateResource(id, { ...value, expectedRevision: input.expectedRevision });
        },
    };
}
