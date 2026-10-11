import { normalizeCost, aggregateCost } from '../../providers/core/cost.js';
const fields = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'];
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const inclusion = (value, field, alias) => Object.hasOwn(value, field) ? value[field] : Object.hasOwn(value, alias) ? value[alias] : true;
const sum = values => values.every(value => value !== null) ? count(values.reduce((a, b) => a + b, 0)) : null;
export const usageSemantics = Object.freeze({ inputTokensIncludesCache: true, outputTokensIncludesReasoning: true });

/** Provider envelopes retain their raw inclusion flags; public totals are inclusive. */
export function normalizePiUsage(message, raw, costOptions = {}) {
    const value = raw ?? {};
    const normalized = ['inputTokens', 'outputTokens', 'totalTokens'].some(key => Object.hasOwn(value, key));
    const anthropic = !normalized && (message.api?.includes('anthropic') || Object.hasOwn(value, 'cache_read_input_tokens') || Object.hasOwn(value, 'cache_creation_input_tokens'));
    const cacheReadTokens = count(normalized ? value.cacheReadTokens : anthropic ? value.cache_read_input_tokens
        : value.prompt_tokens_details?.cached_tokens ?? value.input_tokens_details?.cached_tokens ?? value.prompt_cache_hit_tokens ?? value.cached_tokens);
    const cacheWriteTokens = count(normalized ? value.cacheWriteTokens : anthropic ? value.cache_creation_input_tokens
        : value.prompt_tokens_details?.cache_write_tokens ?? value.input_tokens_details?.cache_write_tokens);
    const reasoningTokens = count(normalized ? value.reasoningTokens : value.completion_tokens_details?.reasoning_tokens ?? value.output_tokens_details?.reasoning_tokens ?? value.output_tokens_details?.thinking_tokens);
    let inputTokens = count(normalized ? value.inputTokens : value.prompt_tokens ?? value.input_tokens);
    let outputTokens = count(normalized ? value.outputTokens : value.completion_tokens ?? value.output_tokens);
    const readIncluded = normalized ? inclusion(value, 'cacheReadIncludedInInput', 'inputTokensIncludesCache') : !anthropic;
    const writeIncluded = normalized ? inclusion(value, 'cacheWriteIncludedInInput', 'inputTokensIncludesCache') : !anthropic;
    const reasoningIncluded = normalized ? inclusion(value, 'reasoningIncludedInOutput', 'outputTokensIncludesReasoning') : true;
    if (![true, false].includes(readIncluded) || ![true, false].includes(writeIncluded)) inputTokens = null;
    if (![true, false].includes(reasoningIncluded)) outputTokens = null;
    if (readIncluded === false) inputTokens = sum([inputTokens, cacheReadTokens]);
    if (writeIncluded === false) inputTokens = sum([inputTokens, cacheWriteTokens]);
    if (reasoningIncluded === false) outputTokens = sum([outputTokens, reasoningTokens]);
    const totalKey = normalized ? 'totalTokens' : 'total_tokens';
    const totalTokens = Object.hasOwn(value, totalKey) ? count(value[totalKey]) : sum([inputTokens, outputTokens]);
    const complete = ['stop', 'length', 'toolUse'].includes(message.stopReason);
    return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, totalTokens,
        cacheWrite1hTokens: count(normalized ? value.cacheWrite1hTokens : value.cache_creation?.ephemeral_1h_input_tokens),
        ...usageSemantics, complete, usageComplete: complete && inputTokens !== null && outputTokens !== null && totalTokens !== null,
        raw: raw == null ? null : structuredClone(raw), cost: null,
        ...normalizeCost(value, { provider: message.provider, sdkUsage: message.usage, ...costOptions }) };
}

export function updatePiUsage(usage, entry) {
    usage.requests.push(entry);
    Object.assign(usage, aggregateCost(usage.requests));
    for (const field of [...fields, 'cacheWrite1hTokens']) usage[field] = sum([usage[field], entry[field]]);
    usage.complete = usage.requests.length > 0 && usage.requests.every(request => request.usageComplete);
    usage.breakdownComplete = usage.requests.length > 0 && fields.every(field => usage[field] !== null);
}
