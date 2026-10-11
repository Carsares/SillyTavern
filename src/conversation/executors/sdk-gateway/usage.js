import { normalizeCost, aggregateCost } from '../../providers/core/cost.js';
// Inclusive input/output totals: cache and reasoning are breakdowns, not additions.
export const USAGE_FIELDS = Object.freeze(['inputTokens', 'outputTokens', 'cacheReadTokens',
    'cacheWriteTokens', 'reasoningTokens', 'totalTokens']);
const semantics = Object.freeze({ inputTokensIncludesCache: true, outputTokensIncludesReasoning: true });
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const sum = values => values.length && values.every(v => v !== null) ? count(values.reduce((a, b) => a + b, 0)) : null;

export function normalizeUsage(protocol, raw, costOptions = {}) {
    const u = raw ?? {};
    const anthropic = protocol === 'anthropic';
    const cacheReadTokens = count(anthropic ? u.cache_read_input_tokens : u.input_tokens_details?.cached_tokens);
    const cacheWriteTokens = count(anthropic ? u.cache_creation_input_tokens : u.input_tokens_details?.cache_write_tokens);
    const inputTokens = anthropic ? sum([count(u.input_tokens), cacheReadTokens, cacheWriteTokens]) : count(u.input_tokens);
    const outputTokens = count(u.output_tokens);
    const reasoningTokens = count(anthropic ? u.output_tokens_details?.thinking_tokens : u.output_tokens_details?.reasoning_tokens);
    // Only Responses defines total_tokens. Do not invent missing cache counts in Messages.
    const totalTokens = !anthropic && count(u.total_tokens) !== null ? count(u.total_tokens) : sum([inputTokens, outputTokens]);
    return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, totalTokens,
        ...semantics, rawInputTokensIncludesCache: !anthropic, ...normalizeCost(u, costOptions) };
}

/** Streaming usage fields are cumulative snapshots, never additive deltas.
 * Anthropic null delta fields mean no newer count: preserve an earlier report.
 */
export function mergeUsage(previous, incoming) {
    const result = structuredClone(previous ?? {});
    for (const [key, value] of Object.entries(incoming ?? {})) {
        if (value === null || value === undefined) {
            if (!Object.hasOwn(result, key)) result[key] = null;
        } else if (typeof value === 'object' && !Array.isArray(value)) {
            result[key] = mergeUsage(result[key], value);
        } else result[key] = value;
    }
    return result;
}

export function aggregateUsage(protocol, records, costOptions = {}) {
    const requests = records.map(record => {
        const normalized = normalizeUsage(protocol, record.rawUsage, { ...costOptions, sdkUsage: record.sdkUsage, sdkEstimated: record.sdkEstimated === true });
        return { ...structuredClone(record), ...normalized,
            usageComplete: record.complete && normalized.inputTokens !== null && normalized.outputTokens !== null && normalized.totalTokens !== null,
            cost: null };
    });
    const totals = Object.fromEntries(USAGE_FIELDS.map(field => [field, sum(requests.map(r => r[field]))]));
    return { ...totals, ...semantics, complete: requests.length > 0 && requests.every(r => r.usageComplete),
        breakdownComplete: requests.length > 0 && USAGE_FIELDS.every(field => totals[field] !== null),
        requests, cost: null, ...aggregateCost(requests) };
}
