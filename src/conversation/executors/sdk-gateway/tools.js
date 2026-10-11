import { fail, positiveLimit } from './contracts.js';

// Deliberately bounded schema subset. Unknown constraints fail at registration,
// rather than being silently dropped. The domain registry remains authoritative.
const keywords = new Set(['type', 'description', 'title', 'default', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'pattern', 'anyOf', 'oneOf', 'allOf']);
function checkSchema(schema, depth = 0) {
    if (typeof schema === 'boolean') return;
    if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > 32) throw fail('invalid-tool-schema', 'Invalid tool schema');
    for (const key of Object.keys(schema)) if (!keywords.has(key)) throw fail('unsupported-tool-schema', `Unsupported schema keyword: ${key}`, 422);
    for (const child of Object.values(schema.properties ?? {})) checkSchema(child, depth + 1);
    for (const key of ['items', 'additionalProperties']) if (schema[key] !== undefined) checkSchema(schema[key], depth + 1);
    for (const key of ['anyOf', 'oneOf', 'allOf']) if (schema[key]) schema[key].forEach(s => checkSchema(s, depth + 1));
}
function valid(schema, value) {
    if (typeof schema === 'boolean') return schema;
    if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) return false;
    if (schema.enum && !schema.enum.some(v => JSON.stringify(v) === JSON.stringify(value))) return false;
    const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    const matches = type => ({ null: value === null, array: Array.isArray(value), object: value !== null && typeof value === 'object' && !Array.isArray(value), integer: Number.isSafeInteger(value), number: typeof value === 'number' && Number.isFinite(value), string: typeof value === 'string', boolean: typeof value === 'boolean' })[type] === true;
    if (types.length && !types.some(matches)) return false;
    if (schema.anyOf && !schema.anyOf.some(s => valid(s, value))) return false;
    if (schema.oneOf && schema.oneOf.filter(s => valid(s, value)).length !== 1) return false;
    if (schema.allOf && !schema.allOf.every(s => valid(s, value))) return false;
    if (typeof value === 'string' && ((schema.minLength !== undefined && [...value].length < schema.minLength) || (schema.maxLength !== undefined && [...value].length > schema.maxLength) || (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)))) return false;
    if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum) || (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) || (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum))) return false;
    if (Array.isArray(value) && ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems) || (schema.items && !value.every(v => valid(schema.items, v))))) return false;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (schema.required?.some(k => !Object.hasOwn(value, k))) return false;
        for (const [key, item] of Object.entries(value)) {
            if (Object.hasOwn(schema.properties ?? {}, key)) { if (!valid(schema.properties[key], item)) return false; } else if (schema.additionalProperties === false || (typeof schema.additionalProperties === 'object' && !valid(schema.additionalProperties, item))) return false;
        }
    }
    return true;
}
function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    return JSON.stringify(value);
}

export function createDomainTools({ tools = [], signal, limits = {}, onEvent, stop }) {
    const registry = new Map();
    const permits = new Map();
    const maxCalls = positiveLimit(limits.callsPerRound, 8, 'callsPerRound');
    const maxBytes = positiveLimit(limits.resultBytes, 32768, 'resultBytes');
    const timeoutMs = positiveLimit(limits.timeoutMs, 30000, 'timeoutMs');
    for (const tool of tools) {
        if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(tool.name) || registry.has(tool.name) || typeof tool.execute !== 'function' || tool.parameters?.type !== 'object') throw fail('invalid-tool', 'Unique domain tool names, object schemas and execute wrappers are required');
        checkSchema(tool.parameters);
        registry.set(tool.name, { ...tool, parameters: structuredClone(tool.parameters) });
    }
    function nameOf(wireName, namespace) {
        const raw = namespace ? `${namespace}.${wireName}` : wireName;
        for (const name of registry.keys()) if ([`mcp__domain__${name}`, `mcp__domain.${name}`].includes(raw)) return name;
        throw fail('forbidden-tool', 'Upstream attempted a non-domain tool', 422);
    }
    function permit(id, wireName, args, requestIndex, namespace) {
        const name = nameOf(wireName, namespace);
        if (typeof id !== 'string' || !id || !valid(registry.get(name).parameters, args)) throw fail('invalid-tool-call', 'Invalid tool ID or arguments', 422);
        const key = canonical(args);
        if (permits.has(id)) {
            const old = permits.get(id);
            if (old.name !== name || old.key !== key) throw fail('tool-id-conflict', 'Tool call ID was reused with different arguments');
            return;
        }
        if ([...permits.values()].filter(p => p.requestIndex === requestIndex).length >= maxCalls) throw fail('tool-call-limit', 'Too many tool calls in one model response');
        permits.set(id, { id, name, args, key, requestIndex, state: 'pending' });
    }
    async function call(name, args) {
        signal.throwIfAborted();
        const key = canonical(args);
        const permit = [...permits.values()].find(p => p.name === name && p.key === key && p.state === 'pending');
        if (!permit) throw fail('unissued-tool-call', 'MCP request has no unused model-issued tool permit', 403);
        permit.state = 'running';
        const controller = new AbortController();
        const effective = AbortSignal.any([signal, controller.signal]);
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let listener;
        let started = false;
        try {
            await onEvent?.({ type: 'tool.call', toolCallId: permit.id, name, args });
            effective.throwIfAborted();
            started = true;
            const aborted = new Promise((_, reject) => { listener = () => reject(fail('tool-aborted', 'Tool stopped; external result may be unknown')); effective.addEventListener('abort', listener, { once: true }); if (effective.aborted) listener(); });
            const output = await Promise.race([Promise.resolve().then(() => { effective.throwIfAborted(); return registry.get(name).execute(permit.id, args, effective); }), aborted]);
            effective.throwIfAborted();
            const result = output?.content ? output : { content: [{ type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output) ?? 'null' }] };
            if (Buffer.byteLength(JSON.stringify(result)) > maxBytes || !Array.isArray(result.content) || result.content.some(p => p.type !== 'text' || typeof p.text !== 'string')) throw fail('invalid-tool-result', 'Tool result is oversized or contains unsupported content');
            await onEvent?.({ type: 'tool.result', toolCallId: permit.id, name, result });
            effective.throwIfAborted();
            permit.state = 'completed';
            return result;
        } catch {
            permit.state = started ? 'unknown' : 'failed';
            const error = fail(started ? 'tool-result-unknown' : 'tool-event-failed', started ? 'External tool result is unknown; do not retry automatically' : 'Tool event persistence failed', 502);
            stop(error);
            throw error;
        } finally { clearTimeout(timer); if (listener) effective.removeEventListener('abort', listener); }
    }
    return {
        nameOf, permit, call,
        definition(name) { return registry.get(name); },
        list() { return [...registry.values()].map(t => ({ name: t.name, description: t.description ?? '', inputSchema: t.parameters })); },
        states() { return [...permits.values()].map(({ id, name, state }) => ({ id, name, state })); },
    };
}
