import test from 'node:test';
import assert from 'node:assert/strict';
import { createPiExecutor, getCapabilities } from '../../../../src/conversation/executors/pi/index.js';
import { toPiMessages } from '../../../../src/conversation/executors/pi/messages.js';
import { createPrimaryModel } from '../../../../src/conversation/providers/primary/index.js';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai';

const connection = { provider: 'openai-compatible', executor: 'pi', baseUrl: 'http://unit.invalid/v1', model: 'test-model', contextWindow: 32000, inputLimit: 24000, outputLimit: 2000, maxOutputTokens: 1000, workingBudget: 20000, apiKey: 'test-secret-key', headers: { 'x-custom-token': 'test-secret-header' } };
const plan = { messages: [{ role: 'system', content: 'Initial instruction' }, { role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer' }, { role: 'system', content: 'Updated instruction' }, { role: 'user', content: 'Current question' }] };
const run = (executor, options = {}) => executor.runTurn({ connection, requestPlan: plan, ...options });
function response(delta, finish = 'stop', usage = { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 }) {
    const data = [{ id: 'resp-test', model: 'test-model', choices: [{ index: 0, delta, finish_reason: null }] }, { id: 'resp-test', model: 'test-model', choices: [{ index: 0, delta: {}, finish_reason: finish }], usage }];
    return new Response(data.map(d => `data: ${JSON.stringify(d)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}
const toolCall = { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{"query":"hello"}' } }] };
const tool = { name: 'lookup', description: 'Lookup text', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, execute: async () => 'tool result' };

test('capabilities reject unknown combinations and invalid budgets synchronously', () => {
    assert.equal(getCapabilities(connection).supported, true);
    for (const change of [{ provider: 'unknown' }, { executor: 'codex' }, { workingBudget: Infinity }, { maxOutputTokens: 40000 }, { reasoning: 'high' }, { baseUrl: 'https://user:password@example.com' }, { type: 'text' }]) assert.equal(getCapabilities({ ...connection, ...change }).supported, false);
});

test('real SDK + fake fetch preserve roles, await events and capture only redacted requests', async () => {
    const requests = [], traces = [], order = [];
    let persisting = false;
    const executor = createPiExecutor({
        onRequest: async trace => { traces.push(trace); await new Promise(r => setImmediate(r)); order.push('capture'); },
        fetch: async request => { assert.equal(order.at(-1), 'capture'); requests.push(await request.json()); return response({ content: 'Hello' }); },
    });
    const result = await run(executor, {
        beforeRequest: async context => { assert.equal(context.requestIndex, 1); assert.ok(context.messages.some(m => m.role === 'system')); await new Promise(r => setImmediate(r)); order.push('budget'); },
        onEvent: async event => { assert.equal(persisting, false); persisting = true; await new Promise(r => setImmediate(r)); order.push(event.type); persisting = false; },
    });
    assert.equal(result.content, 'Hello');
    assert.equal(result.usage.inputTokens, 11);
    assert.equal(result.usage.complete, true);
    assert.equal(result.usage.cost, null);
    assert.deepEqual(requests[0].messages.map(m => m.role), ['system', 'user', 'assistant', 'system', 'user']);
    assert.equal(requests[0].max_tokens ?? requests[0].max_completion_tokens, 1000);
    assert.ok(order.indexOf('budget') < order.indexOf('capture'));
    assert.ok(!JSON.stringify(traces).includes('test-secret'));
    assert.deepEqual(order.slice(-2), ['text.delta', 'usage.updated']);
});

test('real SDK executes tools then rechecks budget with tool results before the next request', async () => {
    const contexts = [], events = [], bodies = [];
    let executions = 0;
    const executor = createPiExecutor({ fetch: async request => { bodies.push(await request.json()); return bodies.length === 1 ? response(toolCall, 'tool_calls') : response({ content: 'Done' }); } });
    const result = await run(executor, { tools: [{ ...tool, execute: async (id, args, signal) => { executions++; assert.equal(id, 'call-1'); assert.deepEqual(args, { query: 'hello' }); assert.equal(signal.aborted, false); return 'tool result'; } }], beforeRequest: async c => contexts.push(c), onEvent: async e => { await new Promise(r => setImmediate(r)); events.push(e); } });
    assert.equal(executions, 1); assert.equal(contexts.length, 2);
    assert.ok(contexts[1].messages.some(m => m.role === 'toolResult'));
    assert.ok(bodies[1].messages.some(m => m.role === 'tool'));
    assert.equal(result.content, 'Done'); assert.equal(result.usage.inputTokens, 22);
    assert.equal(events.filter(e => e.type === 'tool.call').length, 1);
    assert.ok(events.findIndex(e => e.type === 'tool.result') < events.findIndex(e => e.type === 'text.delta'));
});

test('beforeRequest failure after a tool blocks the second model call', async () => {
    let network = 0, budget = 0;
    const executor = createPiExecutor({ fetch: async () => { network++; return response(toolCall, 'tool_calls'); } });
    await assert.rejects(run(executor, { tools: [tool], beforeRequest: () => { if (++budget === 2) throw new Error('deny'); } }), { code: 'before-request-failed' });
    assert.equal(network, 1);
});

test('budget and aborted input block all provider I/O', async () => {
    let network = 0;
    const executor = createPiExecutor({ fetch: async () => { network++; return response({ content: 'unexpected' }); } });
    await assert.rejects(run(executor, { connection: { ...connection, workingBudget: 20 } }), { code: 'budget-blocked' });
    await assert.rejects(run(executor, { signal: AbortSignal.abort() }), { code: 'aborted' });
    assert.equal(network, 0);
});

test('failed asynchronous persistence stops tool execution and further model calls', async () => {
    let network = 0, executions = 0;
    const executor = createPiExecutor({ fetch: async () => { network++; return response(toolCall, 'tool_calls'); } });
    await assert.rejects(run(executor, { tools: [{ ...tool, execute: async () => { executions++; } }], onEvent: async e => { if (e.type === 'tool.call') throw new Error('disk failed'); } }), { code: 'event-persistence-failed' });
    assert.equal(network, 1); assert.equal(executions, 0);
});

test('tool round and result limits stop SDK continuation', async () => {
    let network = 0;
    const executor = createPiExecutor({ fetch: async () => { network++; return response(toolCall, 'tool_calls'); } });
    await assert.rejects(run(executor, { tools: [tool], limits: { rounds: 1 } }), { code: 'tool-limit' });
    assert.equal(network, 2);
    network = 0;
    await assert.rejects(run(executor, { tools: [tool], limits: { resultBytes: 2 } }), { code: 'tool-result-limit' });
    assert.equal(network, 1);
});

test('tool history maps IDs and rejects unsupported media/roles without flattening', () => {
    const model = createPrimaryModel(connection);
    const messages = toPiMessages([{ role: 'assistant', content: [{ type: 'toolCall', id: 'x', name: 'lookup', arguments: {} }] }, { role: 'tool', toolCallId: 'x', content: 'old result' }], model);
    assert.equal(messages[1].role, 'toolResult'); assert.equal(messages[1].toolName, 'lookup');
    for (const message of [{ role: 'developer', content: 'bad' }, { role: 'user', content: [{ type: 'image', data: 'x' }] }, { role: 'tool', content: 'orphan' }]) assert.throws(() => toPiMessages([message], model));
});

test('stream/model injection still uses SDK scheduling; absent raw usage stays unknown', async () => {
    const model = createPrimaryModel(connection);
    const executor = createPiExecutor({ model, streamFn: () => {
        const stream = new AssistantMessageEventStream();
        const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, content: [{ type: 'text', text: 'Injected' }], usage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 0 };
        stream.push({ type: 'start', partial: message }); stream.push({ type: 'text_delta', contentIndex: 0, delta: 'Injected', partial: message }); stream.push({ type: 'done', reason: 'stop', message }); return stream;
    } });
    const result = await run(executor);
    assert.equal(result.content, 'Injected'); assert.equal(result.usage.complete, false);
});

test('abort after persisted delta terminates without further events', async () => {
    const controller = new AbortController();
    const events = [];
    const executor = createPiExecutor({ fetch: async () => response({ content: 'Partial' }) });
    await assert.rejects(run(executor, { signal: controller.signal, onEvent: async event => { events.push(event.type); if (event.type === 'text.delta') controller.abort(); } }), { code: 'aborted' });
    assert.deepEqual(events, ['text.delta']);
});

test('abort during a tool reaches the execute wrapper and prevents continuation', async () => {
    const controller = new AbortController();
    let network = 0, aborted = false;
    const executor = createPiExecutor({ fetch: async () => { network++; return response(toolCall, 'tool_calls'); } });
    const execute = async (_id, _args, signal) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
        controller.abort();
    });
    await assert.rejects(run(executor, { signal: controller.signal, tools: [{ ...tool, execute }] }), { code: 'aborted' });
    assert.equal(aborted, true); assert.equal(network, 1);
});

test('tool timeout is bounded and does not repeat an uncertain side effect', async () => {
    let network = 0, executions = 0;
    const executor = createPiExecutor({ fetch: async () => { network++; return response(toolCall, 'tool_calls'); } });
    await assert.rejects(run(executor, { tools: [{ ...tool, execute: () => { executions++; return new Promise(() => {}); } }], limits: { timeoutMs: 10 } }), { code: 'tool-timeout' });
    assert.equal(executions, 1); assert.equal(network, 1);
});

test('request capture failure prevents sending and does not leak thrown credentials', async () => {
    let network = 0;
    const executor = createPiExecutor({ onRequest: async () => { throw new Error(connection.apiKey); }, fetch: async () => { network++; return response({ content: 'bad' }); } });
    await assert.rejects(run(executor), { code: 'request-capture-failed' });
    assert.equal(network, 0);
});

test('malformed tool arguments never execute, provider errors are sanitized, retries stay off', async () => {
    let executions = 0, network = 0;
    const executor = createPiExecutor({ fetch: async () => {
        network++;
        if (network === 1) return response({ tool_calls: [{ index: 0, id: 'bad', type: 'function', function: { name: 'lookup', arguments: '{"unexpected":123}' } }] }, 'tool_calls');
        return new Response(JSON.stringify({ error: { message: connection.apiKey } }), { status: 500, headers: { 'content-type': 'application/json' } });
    } });
    await assert.rejects(run(executor, { tools: [{ ...tool, execute: async () => { executions++; } }] }), error => error.code === 'provider-error' && !error.message.includes(connection.apiKey));
    assert.equal(executions, 0); assert.equal(network, 2);
});

test('sampling cannot replace messages, token bounds or credentials', async () => {
    for (const key of ['messages', 'tools', 'max_tokens', 'apiKey', 'stream']) {
        await assert.rejects(run(createPiExecutor(), { connection: { ...connection, parameters: { [key]: 1 } } }), { code: 'unsupported-parameters' });
    }
});


test('native alias preserves capability identity and uses the same SDK executor', async () => {
    const nativeConnection = { ...connection, executor: 'native' };
    const caps = getCapabilities(nativeConnection);
    assert.equal(caps.supported, true);
    assert.equal(caps.executor, 'native');
    let actual;
    const result = await run(createPiExecutor({ fetch: async () => response({ content: 'Native' }) }), {
        connection: nativeConnection,
        beforeRequest: context => { actual = context.messages; },
    });
    assert.equal(result.content, 'Native');
    assert.deepEqual(actual.map(message => message.role), plan.messages.map(message => message.role));
    assert.deepEqual(actual.map(message => message.content.map(part => part.text).join('')), plan.messages.map(message => message.content));
});
