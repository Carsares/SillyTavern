import test from 'node:test';
import assert from 'node:assert/strict';
import { createSdkGateway } from '../../../../src/conversation/executors/sdk-gateway/index.js';
import { createTranscript, encodeHistory, expandTranscript } from '../../../../src/conversation/executors/sdk-gateway/history.js';

const history = [
    { role: 'system', content: 'Story rules' },
    { role: 'user', content: 'Past input' },
    { role: 'assistant', content: [{ type: 'text', text: 'Checking' }, { type: 'toolCall', id: 'past-call', name: 'recall', arguments: { query: 'past' } }] },
    { role: 'tool', toolCallId: 'past-call', content: 'Past result' },
    { role: 'assistant', content: 'Past reply' },
    { role: 'user', content: 'Continue' },
];
const connection = { model: 'synthetic', baseUrl: 'https://provider.invalid/v1', apiKey: 'synthetic-secret' };
const answer = () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }], usage: { input_tokens: 9, output_tokens: 2 } });
function setup(extra = {}) {
    const transcript = createTranscript({ id: 's1' }, { messages: history, sourceRefs: [{ messageId: 'one', revision: 3 }] });
    const calls = [], traces = [];
    const gateway = createSdkGateway({ protocol: 'responses', connection, inputBudget: 30000, maxOutputTokens: 200, transcript,
        onRequest: t => traces.push(t), fetch: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return answer(); }, ...extra });
    const body = { model: 'synthetic', instructions: 'You are a coding agent', input: [{ role: 'user', content: transcript.prompt }] };
    const request = (payload = body, path = '/v1/responses', token = gateway.token) => gateway.handle(new Request(`http://127.0.0.1${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(payload) }));
    return { gateway, calls, traces, body, transcript, request };
}

test('both native encoders preserve ordered roles, tool IDs and results', () => {
    const a = encodeHistory(history, 'anthropic');
    assert.deepEqual(a.system, [{ type: 'text', text: 'Story rules' }]);
    assert.equal(a.messages[1].content[1].id, 'past-call');
    assert.equal(a.messages[2].content[0].tool_use_id, 'past-call');
    const r = encodeHistory(history, 'responses');
    assert.deepEqual(r.messages.map(x => x.type === 'message' ? x.role : x.type), ['system', 'user', 'assistant', 'function_call', 'function_call_output', 'assistant', 'user']);
    assert.equal(r.messages[3].call_id, r.messages[4].call_id);
    assert.throws(() => encodeHistory([{ role: 'user', content: 'x' }, { role: 'system', content: 'deep' }], 'anthropic'), { code: 'unsupported-deep-system' });
    assert.equal(encodeHistory([{ role: 'user', content: 'x' }, { role: 'system', content: 'deep' }], 'responses').messages[1].role, 'system');
});

test('gateway expands before counting, captures exact filtered JSON, strips built-ins and never sends its token upstream', async t => {
    let counted;
    const h = setup({ beforeRequest: context => { counted = context; context.request.model = 'mutated-copy'; } }); t.after(() => h.gateway.close());
    h.body.tools = [{ type: 'function', name: 'exec_command', parameters: {} }, { type: 'web_search' }];
    const response = await h.request(); assert.equal(response.status, 200);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].body.instructions, '');
    assert.deepEqual(h.calls[0].body.tools, []);
    assert.equal(h.calls[0].body.model, 'synthetic');
    assert.equal(h.calls[0].body.max_output_tokens, 200);
    assert.equal(h.calls[0].init.headers.get('authorization'), 'Bearer synthetic-secret');
    assert.equal(counted.messages[0].role, 'system');
    assert.deepEqual(h.traces[0].body, h.calls[0].body);
    assert.ok(!JSON.stringify(h.traces).includes('synthetic-secret'));
    assert.ok(!JSON.stringify(h.calls[0].body).includes(h.transcript.marker));
});

test('every iteration needs an exact unique marker; hidden compacted history cannot continue', async t => {
    const h = setup(); t.after(() => h.gateway.close());
    assert.equal((await h.request()).status, 200);
    const rewritten = { ...h.body, input: [{ role: 'user', content: 'SDK compacted away original prompt' }] };
    const response = await h.request(rewritten);
    assert.equal(response.status, 422); assert.equal((await response.json()).error.code, 'missing-transcript-marker');
    assert.equal(h.calls.length, 1);
});

test('second request keeps current SDK function call/output after expanded frozen history', async t => {
    const h = setup(); t.after(() => h.gateway.close());
    const continuation = [{ type: 'function_call', call_id: 'new-call', name: 'mcp__domain__recall', arguments: '{}' }, { type: 'function_call_output', call_id: 'new-call', output: 'new-result' }];
    const out = expandTranscript({ ...h.body, input: [...h.body.input, ...continuation] }, 'responses', h.transcript);
    assert.deepEqual(out.input.slice(-2), continuation);
});

test('budget, marker tampering, and trace persistence failures all prevent model dispatch', async t => {
    for (const extra of [{ inputBudget: 1 }, { onRequest: () => { throw new Error('trace unavailable'); } }]) {
        const h = setup(extra); t.after(() => h.gateway.close());
        assert.notEqual((await h.request()).status, 200); assert.equal(h.calls.length, 0);
    }
    const h = setup(); t.after(() => h.gateway.close());
    h.body.input[0].content += 'modified';
    assert.equal((await h.request()).status, 422); assert.equal(h.calls.length, 0);
});

test('gateway rejects foreign token and arbitrary proxy paths without model calls', async t => {
    const h = setup(); t.after(() => h.gateway.close());
    assert.equal((await h.request(h.body, '/v1/responses', 'foreign')).status, 401);
    assert.equal((await h.request(h.body, '/v1/models')).status, 403);
    assert.equal(h.calls.length, 0);
});

test('request limits include every continuation; output limit cannot be enlarged by SDK', async t => {
    const h = setup({ limits: { rounds: 1 } }); t.after(() => h.gateway.close());
    h.body.max_output_tokens = 50000;
    assert.equal((await h.request()).status, 200); assert.equal((await h.request()).status, 200);
    assert.equal((await h.request()).status, 422); assert.equal(h.calls.length, 2);
    assert.equal(h.calls[0].body.max_output_tokens, 200);
});

function sse(events, byteChunks = false) {
    const bytes = new TextEncoder().encode(events.map(e => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join(''));
    return new Response(new ReadableStream({ start(c) { if (byteChunks) for (const b of bytes) c.enqueue(Uint8Array.of(b)); else c.enqueue(bytes); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}

test('SSE validates before forwarding and handles split UTF-8/CRLF', async t => {
    const h = setup({ fetch: async () => sse([{ type: 'response.output_text.delta', delta: '你好' }, { type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1 } } }], true) });
    t.after(() => h.gateway.close());
    const res = await h.request(); await res.text();
    assert.equal(h.gateway.result().content, '你好'); assert.equal(h.gateway.result().usage.complete, true);
});

test('a forbidden tool response never reaches the SDK or executes', async t => {
    const h = setup({ fetch: async () => sse([{ type: 'response.output_item.added', item: { type: 'function_call', name: 'exec_command', call_id: 'bad', arguments: '{}' } }]) });
    t.after(() => h.gateway.close());
    const res = await h.request(); await assert.rejects(res.text(), { code: 'forbidden-tool' });
    assert.throws(() => h.gateway.result(), { code: 'forbidden-tool' });
});

test('truncated response is a failure, never a successful empty/partial completion', async t => {
    const h = setup({ fetch: async () => sse([{ type: 'response.output_text.delta', delta: 'partial' }]) });
    t.after(() => h.gateway.close());
    const res = await h.request(); await assert.rejects(res.text(), { code: 'incomplete-model-response' });
});

test('MCP executes only a matching unused model-issued permit, using the real toolCallId', async t => {
    const executed = [];
    const tool = { name: 'recall', description: 'Recall', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false }, execute: async (...args) => { executed.push(args); return 'result'; } };
    const h = setup({ tools: [tool], fetch: async () => Response.json({ status: 'completed', output: [{ type: 'function_call', call_id: 'issued-call', name: 'mcp__domain__recall', arguments: '{"query":"test"}' }], usage: { input_tokens: 1, output_tokens: 2 } }) });
    t.after(() => h.gateway.close());
    h.body.tools = [{ type: 'function', name: 'mcp__domain__recall', parameters: { type: 'string' } }];
    assert.equal((await h.request()).status, 200);
    const call = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'recall', arguments: { query: 'test' } } };
    assert.equal((await h.request(call, '/mcp')).status, 200);
    assert.equal(executed.length, 1); assert.equal(executed[0][0], 'issued-call');
    assert.equal((await h.request(call, '/mcp')).status, 403); assert.equal(executed.length, 1);
});

test('tool side effect failure is unknown, stops turn, and cannot be retried', async t => {
    let executions = 0;
    const h = setup({ tools: [{ name: 'draw', parameters: { type: 'object' }, execute: async () => { executions++; throw new Error('external result lost'); } }],
        fetch: async () => Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'mcp__domain__draw', call_id: 'draw1', arguments: '{}' }] }) });
    t.after(() => h.gateway.close()); await h.request();
    const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'draw', arguments: {} } };
    const response = await h.request(call, '/mcp');
    assert.equal((await response.json()).error.code, 'tool-result-unknown');
    await h.request(call, '/mcp'); assert.equal(executions, 1);
});

test('abort prevents first dispatch and later continuations', async t => {
    const controller = new AbortController();
    const h = setup({ signal: controller.signal }); t.after(() => h.gateway.close());
    controller.abort(); assert.notEqual((await h.request()).status, 200); assert.equal(h.calls.length, 0);
});

test('Anthropic expansion sets compiled system, and streaming signed tool arguments get a permit', async t => {
    const transcript = createTranscript({}, { messages: [{ role: 'system', content: 'Our system' }, { role: 'user', content: 'Ask' }] });
    let sent;
    const gateway = createSdkGateway({ protocol: 'anthropic', connection, transcript, inputBudget: 30000, maxOutputTokens: 200,
        tools: [{ name: 'recall', parameters: { type: 'object' }, execute: async () => 'ok' }],
        fetch: async (_url, init) => { sent = JSON.parse(init.body); return sse([
            { type: 'message_start', message: { usage: { input_tokens: 10 } } },
            { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'a1', name: 'mcp__domain__recall', input: {} } },
            { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_delta', usage: { output_tokens: 2 }, delta: { stop_reason: 'tool_use' } },
            { type: 'message_stop' },
        ]); } }); t.after(() => gateway.close());
    const response = await gateway.handle(new Request('http://127.0.0.1/v1/messages?beta=true', { method: 'POST', headers: { 'x-api-key': gateway.token }, body: JSON.stringify({ model: 'synthetic', system: 'Coding defaults', messages: [{ role: 'user', content: transcript.prompt }], tools: [] }) }));
    assert.equal(response.status, 200); await response.text();
    assert.deepEqual(sent.system, [{ type: 'text', text: 'Our system' }]);
    assert.deepEqual(gateway.result().toolStates, [{ id: 'a1', name: 'recall', state: 'pending' }]);
    assert.deepEqual(gateway.result().usage.requests[0].rawUsage, { input_tokens: 10, output_tokens: 2 });
});

for (const output of [
    { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'tool-result-unknown' } }) }] },
    { isError: true, details: { outcome: 'unknown' }, content: [{ type: 'text', text: 'lost result' }] },
    { error: { code: 'tool-persistence-failed' } },
]) test('returned unknown outcome aborts gateway and preserves tool state without continuation', async t => {
    let executions = 0, requests = 0;
    const h = setup({ tools: [{ name: 'draw', parameters: { type: 'object' }, execute: async () => { executions++; return output; } }],
        fetch: async () => { requests++; return Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'mcp__domain__draw', call_id: 'draw-unknown', arguments: '{}' }] }); } });
    t.after(() => h.gateway.close());
    assert.equal((await h.request()).status, 200);
    const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'draw', arguments: {} } };
    assert.equal((await h.request(call, '/mcp')).status, 502);
    assert.equal(h.gateway.signal.aborted, true);
    assert.throws(() => h.gateway.check(), error => {
        assert.equal(error.code, 'tool-result-unknown');
        assert.equal(error.details.outcome, 'unknown');
        assert.deepEqual(error.details.toolStates, [{ id: 'draw-unknown', name: 'draw', state: 'unknown' }]);
        return true;
    });
    assert.equal((await h.request()).status, 502);
    assert.equal((await h.request(call, '/mcp')).status, 502);
    assert.equal(requests, 1); assert.equal(executions, 1);
});

test('definitive returned tool error remains a completed tool response', async t => {
    const h = setup({ tools: [{ name: 'draw', parameters: { type: 'object' }, execute: async () => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code: 'invalid-size' } }) }] }) }],
        fetch: async () => Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'mcp__domain__draw', call_id: 'draw-failed', arguments: '{}' }] }) });
    t.after(() => h.gateway.close());
    await h.request();
    const response = await h.request({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'draw', arguments: {} } }, '/mcp');
    assert.equal(response.status, 200);
    assert.equal(h.gateway.signal.aborted, false);
    assert.deepEqual(h.gateway.result().toolStates, [{ id: 'draw-failed', name: 'draw', state: 'completed' }]);
});
