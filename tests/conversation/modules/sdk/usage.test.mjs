import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateUsage, normalizeUsage, mergeUsage, USAGE_FIELDS } from '../../../../src/conversation/executors/sdk-gateway/usage.js';
import { createSdkGateway } from '../../../../src/conversation/executors/sdk-gateway/index.js';
import { createTranscript } from '../../../../src/conversation/executors/sdk-gateway/history.js';

const anthropic = { input_tokens: 12, cache_read_input_tokens: 80, cache_creation_input_tokens: 8, output_tokens: 20, output_tokens_details: { thinking_tokens: 15 } };
const responses = { input_tokens: 100, input_tokens_details: { cached_tokens: 80, cache_write_tokens: 8 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 15 }, total_tokens: 120 };
const numbers = usage => Object.fromEntries(USAGE_FIELDS.map(k => [k, usage[k]]));
const expected = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 8, reasoningTokens: 15, totalTokens: 120 };

test('both protocols normalize to inclusive input/output without double counting breakdowns', () => {
    for (const [protocol, raw] of [['anthropic', anthropic], ['responses', responses]]) {
        const u = normalizeUsage(protocol, raw);
        assert.deepEqual(numbers(u), expected);
        assert.equal(u.inputTokensIncludesCache, true);
        assert.equal(u.outputTokensIncludesReasoning, true);
        assert.equal(u.rawInputTokensIncludesCache, protocol === 'responses');
    }
});

test('unknown cache/reasoning is null, explicit zero survives, no count inferred from visible text', () => {
    for (const protocol of ['anthropic', 'responses']) {
        assert.ok(USAGE_FIELDS.every(k => normalizeUsage(protocol, null)[k] === null));
    }
    const a = normalizeUsage('anthropic', { input_tokens: 12, output_tokens: 20 });
    assert.equal(a.inputTokens, null); assert.equal(a.totalTokens, null);
    assert.equal(a.outputTokens, 20); assert.equal(a.reasoningTokens, null);
    const r = normalizeUsage('responses', { input_tokens: 12, output_tokens: 20 });
    assert.equal(r.inputTokens, 12); assert.equal(r.totalTokens, 32);
    assert.equal(r.cacheReadTokens, null); assert.equal(r.cacheWriteTokens, null);
    const zero = normalizeUsage('responses', { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } });
    assert.ok(USAGE_FIELDS.every(k => zero[k] === 0));
    assert.equal(normalizeUsage('responses', { input_tokens: '12', output_tokens: -1 }).totalTokens, null);
});

test('aggregate sums each field once and preserves unknown in any contributing request', () => {
    const records = [1, 2].map(requestIndex => ({ requestIndex, rawUsage: responses, complete: true }));
    const a = aggregateUsage('responses', records);
    assert.deepEqual(numbers(a), Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, v * 2])));
    assert.equal(a.complete, true); assert.equal(a.breakdownComplete, true);
    assert.deepEqual(numbers(a.requests[0]), expected); assert.deepEqual(a.requests[0].rawUsage, responses);
    records.push({ requestIndex: 3, complete: true, rawUsage: { input_tokens: 5, output_tokens: 2 } });
    const b = aggregateUsage('responses', records);
    assert.equal(b.totalTokens, 247); assert.equal(b.reasoningTokens, null);
    assert.equal(b.cacheReadTokens, null); assert.equal(b.complete, true); assert.equal(b.breakdownComplete, false);
    records.push({ requestIndex: 4, complete: true, rawUsage: null });
    const c = aggregateUsage('responses', records);
    assert.equal(c.totalTokens, null); assert.equal(c.complete, false);
    assert.ok(USAGE_FIELDS.every(k => aggregateUsage('responses', [])[k] === null));
});

test('stream usage snapshots overwrite counts, merge breakdowns, and do not erase earlier counts with null delta', () => {
    const previous = { ...anthropic, output_tokens: 1 };
    const merged = mergeUsage(previous, { input_tokens: null, cache_read_input_tokens: null, cache_creation_input_tokens: null, output_tokens: 20, output_tokens_details: { thinking_tokens: 15 } });
    assert.deepEqual(numbers(normalizeUsage('anthropic', merged)), expected);
    assert.equal(previous.output_tokens, 1);
    assert.deepEqual(mergeUsage({ input_tokens_details: { cached_tokens: 8 } }, { input_tokens_details: { cache_write_tokens: 3 } }), { input_tokens_details: { cached_tokens: 8, cache_write_tokens: 3 } });
});

test('real gateway emits normalized per-request and aggregate usage for a streamed Claude response', async t => {
    const transcript = createTranscript({}, { messages: [{ role: 'user', content: 'Hello' }] });
    const events = [];
    const frames = [
        { type: 'message_start', message: { usage: { ...anthropic, output_tokens: 0, output_tokens_details: null } } },
        { type: 'message_delta', usage: { input_tokens: null, cache_read_input_tokens: null, output_tokens: 20, output_tokens_details: { thinking_tokens: 15 } } },
        { type: 'message_stop' },
    ];
    const gateway = createSdkGateway({ protocol: 'anthropic', connection: { model: 'synthetic', baseUrl: 'https://test.invalid' }, transcript,
        inputBudget: 10000, maxOutputTokens: 100, onEvent: e => events.push(e),
        fetch: async () => new Response(frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }) });
    t.after(() => gateway.close());
    for (let i = 0; i < 2; i++) {
        const response = await gateway.handle(new Request('http://localhost/v1/messages', { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify({ model: 'synthetic', messages: [{ role: 'user', content: transcript.prompt }], stream: true }) }));
        assert.equal(response.status, 200); await response.text();
    }
    const usage = gateway.result().usage;
    assert.equal(usage.totalTokens, 240); assert.equal(usage.requests.length, 2);
    assert.deepEqual(numbers(usage.requests[0]), expected);
    const updates = events.filter(e => e.type === 'usage.updated');
    assert.equal(updates.length, 2); assert.deepEqual(numbers(updates[0]), expected);
    assert.deepEqual(updates[1].usage, usage); assert.equal(updates[0].usage.totalTokens, 120);
});
