import { mergeUsage, normalizeUsage } from '../../../src/conversation/executors/sdk-gateway/usage.js';

/** These paths match the actual native provider bridge and SDK gateway, not CLI URLs. */
export function wireProtocol(connection) {
    if (connection.type === 'embedding') return 'embedding';
    if (connection.executor === 'claude') return 'anthropic';
    if (connection.executor === 'codex') return 'responses';
    return 'chat';
}
export function upstreamEndpoint(connection) {
    const base = connection.baseUrl.replace(/\/$/, ''), protocol = wireProtocol(connection);
    if (protocol === 'anthropic') return base + (base.endsWith('/v1') ? '/messages' : '/v1/messages');
    return `${base}/${protocol === 'responses' ? 'responses' : protocol === 'embedding' ? 'embeddings' : 'chat/completions'}`;
}
export const outputKey = protocol => protocol === 'responses' ? 'max_output_tokens' : 'max_tokens';

/** Anthropic message_start/delta are cumulative partials. Cached input is chargeable.
 * Missing cache counters stay unknown; zero is accepted only when explicitly reported. */
export function usageReader(protocol) {
    let raw, terminal = false;
    return {
        accept(body) {
            const usage = body?.usage ?? body?.message?.usage ?? body?.response?.usage;
            if (usage) raw = mergeUsage(raw, usage);
            if (protocol === 'anthropic' && (body?.type === 'message_stop' || body?.stop_reason)) terminal = true;
            if (protocol === 'responses' && (body?.status === 'completed' || body?.type === 'response.completed' && body?.response?.status === 'completed')) terminal = true;
        },
        result() {
            if (protocol === 'anthropic' || protocol === 'responses') {
                const u = normalizeUsage(protocol, raw);
                return { ...u, raw, terminal };
            }
            return { inputTokens: raw?.prompt_tokens ?? raw?.input_tokens, outputTokens: protocol === 'embedding' ? 0 : raw?.completion_tokens ?? raw?.output_tokens, raw, terminal: true };
        },
    };
}
