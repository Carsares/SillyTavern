import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuxiliaryAdapter } from '../../../../src/conversation/providers/auxiliary/index.js';
import { auxiliaryUsage, aggregateEmbeddingUsage } from '../../../../src/conversation/providers/auxiliary/usage.js';
const adapter = (provider, response, type = 'image') => createAuxiliaryAdapter({ provider, type, model: 'test-model', baseUrl: 'https://provider.invalid/v1' }, {
    fetch: async () => Response.json(response),
});

test('OpenRouter images preserve native usage and inclusive cache/reasoning breakdowns', async () => {
    const usage = { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50,
        prompt_tokens_details: { cached_tokens: 10, cache_write_tokens: 4 }, completion_tokens_details: { reasoning_tokens: 5, image_tokens: 12 }, cost: 0.01 };
    const result = await adapter('openrouter', { usage, choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,YQ==' } }] } }] }).generateImage({ prompt: 'scene' });
    assert.equal(result.usage.complete, true); assert.equal(result.usage.inputTokens, 30); assert.equal(result.usage.outputTokens, 20);
    assert.equal(result.usage.totalTokens, 50); assert.equal(result.usage.cacheReadTokens, 10);
    assert.equal(result.usage.cacheWriteTokens, 4); assert.equal(result.usage.reasoningTokens, 5);
    assert.equal(result.usage.cacheReadIncludedInInput, true); assert.equal(result.usage.cacheWriteIncludedInInput, true);
    assert.equal(result.usage.reasoningIncludedInOutput, true); assert.deepEqual(result.usage.raw, usage);
});

test('Google images add thoughts once and preserve modality detail', async () => {
    const usageMetadata = { promptTokenCount: 30, candidatesTokenCount: 20, thoughtsTokenCount: 5, totalTokenCount: 55,
        cachedContentTokenCount: 10, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 20 }] };
    const result = await adapter('google', { usageMetadata, candidates: [{ content: { parts: [{ inlineData: { data: 'YQ==', mimeType: 'image/png' } }] } }] }).generateImage({ prompt: 'scene' });
    assert.equal(result.usage.complete, true); assert.equal(result.usage.inputTokens, 30); assert.equal(result.usage.outputTokens, 25);
    assert.equal(result.usage.reasoningTokens, 5); assert.equal(result.usage.totalTokens, 55);
    assert.equal(result.usage.cacheReadIncludedInInput, true); assert.equal(result.usage.reasoningIncludedInOutput, true);
    assert.deepEqual(result.usage.raw, usageMetadata);
});

test('OpenAI image usage preserves image/text breakdowns', async () => {
    const usage = { input_tokens: 10, output_tokens: 30, total_tokens: 40, input_tokens_details: { text_tokens: 8, image_tokens: 2 } };
    const result = await adapter('openai', { usage, data: [{ b64_json: 'YQ==' }] }).generateImage({ prompt: 'scene' });
    assert.deepEqual(result.usage.raw, usage); assert.equal(result.usage.totalTokens, 40);
    assert.equal(result.usage.cacheReadTokens, null); assert.equal(result.usage.reasoningTokens, null);
});

test('embedding preserves reported total and does not invent output zero', async () => {
    const usage = { prompt_tokens: 9, total_tokens: 9 };
    const result = await adapter('openai', { data: [{ index: 0, embedding: [1, 2] }], usage }, 'embedding').embed(['text']);
    assert.equal(result.usage.complete, false); assert.equal(result.usage.inputTokens, 9); assert.equal(result.usage.outputTokens, null);
    assert.equal(result.usage.totalTokens, 9); assert.deepEqual(result.usage.raw, usage);
});

test('Cohere billed units remain separate from actual tokens', async () => {
    const meta = { billed_units: { input_tokens: 9 }, tokens: { input_tokens: 12 } };
    const result = await adapter('cohere', { embeddings: { float: [[1, 2]] }, meta }, 'embedding').embed(['text']);
    assert.equal(result.usage.inputTokens, 12); assert.deepEqual(result.usage.raw, meta);
    assert.equal(auxiliaryUsage('cohere-embed', { meta: { billed_units: { input_tokens: 9 } } }).inputTokens, null);
});

test('Vertex preserves each request statistics with null-propagating aggregate', async () => {
    let n = 0;
    const subject = createAuxiliaryAdapter({ provider: 'vertexai', model: 'test-model', baseUrl: 'https://provider.invalid' }, {
        fetch: async () => Response.json({ predictions: [{ embeddings: { values: [1, 2], statistics: ++n === 1 ? { token_count: 7, truncated: false } : { truncated: false } } }] }),
    });
    const result = await subject.embed(['a', 'b']);
    assert.equal(result.usage.complete, false); assert.equal(result.usage.inputTokens, null);
    assert.equal(result.usage.requests[0].inputTokens, 7);
    assert.deepEqual(result.usage.raw, [{ token_count: 7, truncated: false }, { truncated: false }]);
});

test('absent, invalid and partial counts remain unknown; raw is detached', () => {
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) assert.equal(auxiliaryUsage('extras-image')[key], null);
    const usage = { input_tokens: -1, output_tokens: '4', total_tokens: 4 };
    const parsed = auxiliaryUsage('openai-auxiliary', { usage }); usage.total_tokens = 100;
    assert.equal(parsed.inputTokens, null); assert.equal(parsed.outputTokens, null); assert.equal(parsed.raw.total_tokens, 4);
    const google = auxiliaryUsage('google-image', { usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 8 } });
    assert.equal(google.reasoningTokens, null); assert.equal(google.outputTokens, null);
    assert.equal(google.totalTokens, null);
});


test('complete requires completed request and all three reported counts; no invented zeros', () => {
    const response = { usage: { input_tokens: 3, output_tokens: 0, total_tokens: 3 } };
    const full = auxiliaryUsage('openai-auxiliary', response, { completed: true });
    assert.equal(full.complete, true); // Explicit zero is known, unlike an absent value.
    assert.equal(auxiliaryUsage('openai-auxiliary', response).complete, false);
    const partial = auxiliaryUsage('openai-auxiliary', { usage: { input_tokens: 3, total_tokens: 3 } }, { completed: true });
    assert.equal(partial.complete, false); assert.equal(partial.outputTokens, null);
    const derived = auxiliaryUsage('openai-auxiliary', { usage: { input_tokens: 3, output_tokens: 2 } }, { completed: true });
    assert.equal(derived.totalTokens, 5); assert.equal(derived.complete, false);
    assert.equal(aggregateEmbeddingUsage([full, full]).complete, true);
    assert.equal(aggregateEmbeddingUsage([full, partial]).complete, false);
    assert.equal(aggregateEmbeddingUsage([]).complete, false);
});
