import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePiUsage, updatePiUsage, usageSemantics } from '../../../../src/conversation/executors/pi/usage.js';
import { normalizeUsage as normalizeSdkUsage } from '../../../../src/conversation/executors/sdk-gateway/usage.js';
const message = { api: 'openai-completions', stopReason: 'stop', usage: { input: 60, output: 20, cacheRead: 30, cacheWrite: 10, totalTokens: 120 } };

test('OpenAI PI usage reports inclusive prompt counters and retains the raw response', () => {
    const raw = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 8 } };
    const result = normalizePiUsage(message, raw);
    assert.equal(result.inputTokens, 100); assert.equal(result.outputTokens, 20); assert.equal(result.totalTokens, 120);
    assert.equal(result.cacheReadTokens, 30); assert.equal(result.reasoningTokens, 8);
    assert.equal(result.usageComplete, true);
    assert.deepEqual(result.raw, raw); assert.notEqual(result.raw, raw);
});

test('Anthropic raw input normalization agrees with SDK gateway', () => {
    const raw = { input_tokens: 60, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 10 };
    const pi = normalizePiUsage({ ...message, api: 'anthropic-messages' }, raw);
    const sdk = normalizeSdkUsage('anthropic', raw);
    for (const field of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens']) assert.equal(pi[field], sdk[field]);
    assert.equal(pi.inputTokens, 100); assert.equal(pi.totalTokens, 120);
});

test('provider inclusivity flags normalize cache and reasoning without double counting', () => {
    const raw = { inputTokens: 60, outputTokens: 12, cacheReadTokens: 30, cacheWriteTokens: 10, reasoningTokens: 8, totalTokens: 120,
        cacheReadIncludedInInput: false, cacheWriteIncludedInInput: false, reasoningIncludedInOutput: false, raw: { vendor: 1 } };
    const result = normalizePiUsage(message, raw);
    assert.equal(result.inputTokens, 100); assert.equal(result.outputTokens, 20); assert.equal(result.totalTokens, 120);
    assert.equal(result.inputTokensIncludesCache, true); assert.equal(result.outputTokensIncludesReasoning, true);
    assert.deepEqual(result.raw, raw);
    const inclusive = normalizePiUsage(message, { ...raw, inputTokens: 100, outputTokens: 20,
        cacheReadIncludedInInput: true, cacheWriteIncludedInInput: true, reasoningIncludedInOutput: true });
    assert.equal(inclusive.inputTokens, 100); assert.equal(inclusive.outputTokens, 20);
});

test('missing totals, unknown inclusion and unfinished requests remain incomplete', () => {
    for (const raw of [null, { inputTokens: 4, outputTokens: 2, totalTokens: null },
        { inputTokens: 4, outputTokens: 2, cacheReadIncludedInInput: false },
        { inputTokens: 4, outputTokens: 2, cacheReadIncludedInInput: null },
        { inputTokens: 4, outputTokens: 2, reasoningIncludedInOutput: false },
    ]) assert.equal(normalizePiUsage(message, raw).usageComplete, false);
    for (const stopReason of ['pending', 'error', 'aborted']) {
        const result = normalizePiUsage({ ...message, stopReason }, { inputTokens: 4, outputTokens: 2, totalTokens: 6 });
        assert.equal(result.complete, false); assert.equal(result.usageComplete, false);
    }
});

test('aggregation retains request completion and inclusive fields', () => {
    const usage = { ...usageSemantics, requests: [], inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 0, cacheWrite1hTokens: 0 };
    updatePiUsage(usage, normalizePiUsage(message, { inputTokens: 100, outputTokens: 20, totalTokens: 120 }));
    updatePiUsage(usage, normalizePiUsage(message, { inputTokens: 50, outputTokens: 10, totalTokens: 60 }));
    assert.equal(usage.inputTokens, 150); assert.equal(usage.totalTokens, 180); assert.equal(usage.complete, true);
    assert.equal(usage.breakdownComplete, false);
    updatePiUsage(usage, normalizePiUsage(message, { inputTokens: 1, outputTokens: 1, totalTokens: null }));
    assert.equal(usage.totalTokens, null); assert.equal(usage.complete, false);
});
