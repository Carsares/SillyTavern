import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderAdapter } from '../../../../src/conversation/providers/chat/index.js';
import { auxiliaryUsage, aggregateEmbeddingUsage } from '../../../../src/conversation/providers/auxiliary/usage.js';
import { normalizeCost } from '../../../../src/conversation/providers/core/cost.js';

const connection = { provider: 'openrouter', executor: 'pi', type: 'chat', model: 'test-model', baseUrl: 'https://synthetic.invalid/v1', contextWindow: 8192, outputLimit: 1000, maxOutputTokens: 500, workingBudget: 4000 };
for (const streaming of [false, true]) test(`OpenRouter ${streaming ? 'stream' : 'JSON'} retains account charge, not upstream cost`, async () => {
    const usage = { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4, cost: 0.02, cost_details: { upstream_inference_cost: 0.3 } };
    const fetch = async () => streaming
        ? new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
        : Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage });
    const events = [];
    const result = await createProviderAdapter({ ...connection, stream: streaming }, { fetch }).generate({ messages: [{ role: 'user', content: 'hi' }], onEvent: event => events.push(event) });
    assert.equal(result.usage.costUsd, 0.02); assert.equal(result.usage.costSource, 'provider'); assert.equal(result.usage.costEstimated, false);
    assert.deepEqual(result.usage.raw, usage);
    assert.equal(events.find(event => event.type === 'usage').usage.costUsd, 0.02);
});

test('auxiliary amounts and batch sums retain unknown currency and missing amounts', () => {
    const image = auxiliaryUsage('openrouter-image', { usage: { cost: 0, cost_details: { upstream_inference_cost: 2 } } });
    assert.equal(image.costUsd, 0); assert.equal(image.costEstimated, false);
    assert.equal(auxiliaryUsage('other', { usage: { cost: 5 } }).costUsd, null);
    const embedding = auxiliaryUsage('openai-auxiliary', { usage: { costUsd: 0.01 } });
    assert.equal(aggregateEmbeddingUsage([embedding, embedding]).costUsd, 0.02);
    assert.equal(aggregateEmbeddingUsage([embedding, auxiliaryUsage('other')]).costUsd, null);
    assert.equal(normalizeCost({ cost: 2, currency: 'EUR' }).costUsd, null);
    assert.equal(normalizeCost({ costUsd: Infinity }).costUsd, null);
});

test('text usage preserves explicit USD without treating generic provider credits as dollars', async () => {
    const { textUsage } = await import('../../../../src/conversation/providers/text/usage.js');
    assert.equal(textUsage('openai-text', { usage: { costUsd: 0.02 } }).costUsd, 0.02);
    assert.equal(textUsage('openai-text', { usage: { cost: 3 } }).costUsd, null);
});
