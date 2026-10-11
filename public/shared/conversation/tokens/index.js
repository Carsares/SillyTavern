import { ProtocolError } from '../schemas/index.js';

export const TOKEN_DEFAULTS = Object.freeze({ messageOverhead: 16, requestOverhead: 32 });

/** UTF-8 byte estimate intentionally favors overcounting text; media requires an explicit cost. */
export function estimateTokens(request, { mediaTokenCost } = {}) {
    let mediaTokens = 0;
    const messages = request.messages.map(message => ({ ...message, content: typeof message.content === 'string' ? message.content : message.content.map(part => {
        if (part.type === 'text') return part;
        const cost = typeof mediaTokenCost === 'function' ? mediaTokenCost(part) : mediaTokenCost?.[part.type];
        if (!Number.isSafeInteger(cost) || cost < 0) throw new ProtocolError('media-budget-unknown', `Explicit token estimate required for ${part.type}`);
        mediaTokens += cost;
        return { type: part.type };
    }) }));
    const text = request.mode === 'text' ? { prompt: request.prompt, tools: request.tools } : { messages, tools: request.tools };
    return new TextEncoder().encode(JSON.stringify(text)).length + mediaTokens
        + messages.length * TOKEN_DEFAULTS.messageOverhead + TOKEN_DEFAULTS.requestOverhead;
}

/** Injected counter receives the entire final request, including tools and rendered text prompt. */
export function countRequest(request, { countTokens, mediaTokenCost } = {}) {
    if (!countTokens) return { tokens: estimateTokens(request, { mediaTokenCost }), method: 'utf8-conservative-estimate', exact: false };
    const result = countTokens(structuredClone(request));
    const tokens = typeof result === 'number' ? result : result?.tokens;
    if (!Number.isSafeInteger(tokens) || tokens < 0) throw new ProtocolError('invalid-token-count', 'Token counter must synchronously return nonnegative integer tokens');
    return { tokens, method: typeof result === 'number' ? 'injected-estimate' : result.method ?? 'injected-estimate', exact: typeof result === 'object' && result.exact === true };
}
