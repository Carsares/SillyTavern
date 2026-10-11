import { normalizeCost, aggregateCost } from '../core/cost.js';
// Token counters only; never retain prompts, embeddings or generated media.
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const copy = value => structuredClone(value ?? null);
export function auxiliaryUsage(api, response = {}, { completed = false } = {}) {
    const u = response?.usageMetadata ?? response?.usage ?? response?.result?.usage;
    const result = { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
        reasoningTokens: null, totalTokens: null, cacheReadIncludedInInput: null,
        cacheWriteIncludedInInput: null, reasoningIncludedInOutput: null, raw: copy(u), cost: null, ...normalizeCost(u, { provider: api === 'openrouter-image' ? 'openrouter' : undefined }), complete: false };
    if (api === 'cohere-embed') {
        result.raw = copy(response.meta);
        result.inputTokens = count(response.meta?.tokens?.input_tokens);
        result.outputTokens = count(response.meta?.tokens?.output_tokens);
        // Billed units are preserved but must not be substituted for actual tokens.
    } else if (api === 'vertex-embed') {
        result.raw = copy(response.statistics);
        result.inputTokens = count(response.statistics?.token_count);
    } else if (api === 'ollama-embed') {
        result.raw = Object.fromEntries(['prompt_eval_count', 'total_duration', 'load_duration'].filter(k => response[k] !== undefined).map(k => [k, copy(response[k])]));
        if (!Object.keys(result.raw).length) result.raw = null;
        result.inputTokens = count(response.prompt_eval_count);
    } else if (response?.usageMetadata) {
        result.inputTokens = count(u.promptTokenCount);
        result.reasoningTokens = count(u.thoughtsTokenCount);
        const candidates = count(u.candidatesTokenCount);
        // Google reports candidates and thoughts separately. Missing thoughts are unknown.
        if (candidates !== null && result.reasoningTokens !== null) result.outputTokens = candidates + result.reasoningTokens;
        result.cacheReadTokens = count(u.cachedContentTokenCount);
        result.totalTokens = count(u.totalTokenCount);
        result.cacheReadIncludedInInput = true;
        result.reasoningIncludedInOutput = true;
    } else if (u) {
        result.inputTokens = count(u.input_tokens ?? u.prompt_tokens);
        result.outputTokens = count(u.output_tokens ?? u.completion_tokens);
        result.totalTokens = count(u.total_tokens);
        result.cacheReadTokens = count((u.input_tokens_details ?? u.prompt_tokens_details)?.cached_tokens);
        result.cacheWriteTokens = count((u.input_tokens_details ?? u.prompt_tokens_details)?.cache_write_tokens);
        result.reasoningTokens = count((u.output_tokens_details ?? u.completion_tokens_details)?.reasoning_tokens);
        if (['openai-auxiliary', 'openrouter-image'].includes(api)) {
            result.cacheReadIncludedInInput = true;
            result.cacheWriteIncludedInInput = true;
            result.reasoningIncludedInOutput = true;
        }
    }
    // A derived total is useful, but is not a reported total for completeness.
    result.complete = completed === true && ['inputTokens', 'outputTokens', 'totalTokens'].every(key => count(result[key]) !== null);
    if (result.totalTokens === null && result.inputTokens !== null && result.outputTokens !== null) result.totalTokens = result.inputTokens + result.outputTokens;
    return result;
}
export function aggregateEmbeddingUsage(requests) {
    const result = auxiliaryUsage('vertex-embed');
    for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens']) {
        result[key] = requests.length && requests.every(r => r[key] !== null) ? requests.reduce((sum, r) => sum + r[key], 0) : null;
    }
    result.raw = requests.map(r => copy(r.raw));
    result.requests = requests;
    Object.assign(result, aggregateCost(requests));
    result.complete = requests.length > 0 && requests.every(r => r.complete === true)
        && [result.inputTokens, result.outputTokens, result.totalTokens].every(value => count(value) !== null);
    return result;
}
