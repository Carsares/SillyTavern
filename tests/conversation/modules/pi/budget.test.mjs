import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { estimateContext, estimatePiContext } from '../../../../src/conversation/providers/core/index.js';
import { createPiExecutor } from '../../../../src/conversation/executors/pi/index.js';
import { createPrimaryStream } from '../../../../src/conversation/providers/primary/index.js';
import { createEvaluationAdapter } from '../../evaluation/adapter.mjs';
import { createDataset, publicInput } from '../../evaluation/dataset.mjs';
import { createConversationServices } from '../../../../src/conversation/composition/index.js';
import { createStore } from '../../../../src/conversation/store/index.js';
import { createMemoryService } from '../../../../src/conversation/memory/index.js';
import { createRetrieval } from '../../../../src/conversation/retrieval/index.js';

const connection = { provider: 'openai-compatible', executor: 'pi', baseUrl: 'https://offline.invalid/v1', apiKey: 'dummy-offline', model: 'test', contextWindow: 10000, workingBudget: 2000, maxOutputTokens: 1000 };
const requestPlan = { messages: [{ role: 'user', content: 'hello' }] };
function response(content, finish = 'stop') {
    return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: content, finish_reason: finish }], usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
}

test('PI estimate excludes bookkeeping but preserves model-visible replay and tool fields', () => {
    const message = { role: 'assistant', content: [{ type: 'thinking', thinking: 'reason', thinkingSignature: 'signature' }, { type: 'toolCall', id: 'call', name: 'lookup', arguments: { text: 'x'.repeat(3000) } }], providerContent: [{ type: 'text', text: 'native replay' }] };
    const sdkMessage = { ...message, api: 'openai-completions', provider: 'provider', model: 'model', timestamp: 123456789, stopReason: 'toolUse', usage: { raw: 'x'.repeat(200000) }, errorMessage: 'SDK-only error' };
    assert.equal(estimatePiContext([sdkMessage]), estimateContext([message]));
    assert.ok(estimatePiContext([sdkMessage]) > 3000);
    assert.equal(estimatePiContext([{ role: 'toolResult', toolCallId: 'call', toolName: 'lookup', content: 'result', isError: true, timestamp: 42 }]), estimateContext([{ role: 'toolResult', toolCallId: 'call', toolName: 'lookup', content: 'result', isError: true }]));
});

for (const bypassPayload of [false, true]) test(`serialized tools exceeding budget block fetch with beforeRequest (bypassPayload=${bypassPayload})`, async () => {
    let calls = 0, checks = 0;
    const executor = createPiExecutor({ fetch: async () => { calls++; throw Error('must not dispatch'); },
        ...(bypassPayload ? { streamFn: (model, context, options) => createPrimaryStream(connection, model)(model, context, { ...options, onPayload: undefined }) } : {}) });
    await assert.rejects(executor.runTurn({ connection, requestPlan, beforeRequest: () => { checks++; }, tools: [{ name: 'large', description: 'x'.repeat(4000), parameters: { type: 'object', properties: {} }, execute: async () => 'ok' }] }), { code: 'budget-blocked' });
    assert.equal(checks, 1);
    assert.equal(calls, 0);
});

test('a permissive runtime hook cannot bypass the next SDK tool-result budget', async () => {
    let calls = 0, checks = 0;
    const executor = createPiExecutor({ fetch: async () => { calls++; return response({ tool_calls: [{ index: 0, id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } }] }, 'tool_calls'); } });
    await assert.rejects(executor.runTurn({ connection, requestPlan, beforeRequest: () => { checks++; }, tools: [{ name: 'lookup', parameters: { type: 'object', properties: {} }, execute: async () => 'x'.repeat(5000) }] }), { code: 'budget-blocked' });
    assert.equal(checks, 2);
    assert.equal(calls, 1);
});

test('full evaluation: 3040 messages/50 questions fit 1M/950k/8192 through real PI and offline fetch', async t => {
    const config = JSON.parse(await readFile(new URL('../../evaluation/config.deepseek.example.json', import.meta.url), 'utf8')).executors.pi;
    const counts = [], wire = [];
    const adapter = createEvaluationAdapter({ config, env: { EVALUATION_API_KEY: 'dummy-offline' }, dependencies: {
        fetch: async request => { wire.push(Buffer.byteLength(await request.text(), 'utf8')); return response({ content: '{"answers":[]}' }); },
        factories: { createStore, createMemoryService, createRetrieval, createServices: options => createConversationServices({ ...options, dependencies: { ...options.dependencies,
            createPiExecutor: options => {
                const executor = createPiExecutor(options);
                return { ...executor, runTurn: input => executor.runTurn({ ...input, beforeRequest: context => {
                    counts.push({ sdkBytes: estimateContext(context.messages), modelBytes: context.estimatedTokens });
                    return input.beforeRequest?.(context);
                } }) };
            },
        } }) },
    } });
    const dataset = createDataset();
    assert.equal(dataset.snapshot.messages.length, 3040);
    const input = { ...publicInput(dataset, dataset.questions.slice(0, 50)), condition: { executor: 'pi', budget: 'full', workingBudget: 950000, repeat: 1, cache: 'uncontrolled' }, preserveFullHistory: true };
    const result = await adapter.run({ ...input, ceiling: await adapter.quote(input) });
    assert.equal(result.output, '{"answers":[]}');
    assert.equal(result.usage.providerRequests, 1);
    assert.equal(result.usage.complete, true);
    assert.equal(wire.length, 1);
    assert.ok(counts[0].sdkBytes > 950000);
    assert.ok(counts[0].modelBytes < 950000);
    assert.ok(wire[0] + 64 < 950000);
    t.diagnostic(JSON.stringify({ estimates: counts, wireBytes: wire }));
});
