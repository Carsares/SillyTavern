// Preserve only the provider's usage envelope/counters, never prompt or response bodies.
import { usage } from '../chat/http.js';
export function textUsage(api, response) {
    if (api === 'openai-text') return usage(response.usage?.prompt_tokens, response.usage?.completion_tokens, {
        raw: structuredClone(response.usage ?? null), cacheReadTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? null,
        reasoningTokens: response.usage?.completion_tokens_details?.reasoning_tokens ?? null,
        cacheReadIncludedInInput: true, reasoningIncludedInOutput: true,
    });
    if (api === 'huggingface-tgi') return usage(undefined, response.details?.generated_tokens, {
        raw: response.details ? { generated_tokens: response.details.generated_tokens, finish_reason: response.details.finish_reason, seed: response.details.seed } : null,
    });
    const keys = api === 'ollama-generate'
        ? ['prompt_eval_count', 'eval_count', 'total_duration', 'load_duration', 'prompt_eval_duration', 'eval_duration']
        : ['tokens_evaluated', 'tokens_predicted', 'tokens_cached', 'timings'];
    const raw = Object.fromEntries(keys.filter(key => response[key] !== undefined).map(key => [key, structuredClone(response[key])]));
    return usage(response[keys[0]], response[keys[1]], { raw: Object.keys(raw).length ? raw : null });
}
