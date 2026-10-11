import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeExecutor } from '../../../src/conversation/executors/claude/index.js';
import { createCodexExecutor } from '../../../src/conversation/executors/codex/index.js';
import { createSdkGateway } from '../../../src/conversation/executors/sdk-gateway/index.js';
import { createBudgetTransport, pipelineQuote } from './transport-budget.mjs';
import { upstreamEndpoint, outputKey, wireProtocol } from './protocols.mjs';
import { createEvaluationAdapter } from './adapter.mjs';

const pricing = { inputUsdPerMillionUpper: 2, outputUsdPerMillionUpper: 6, perRequestUsdUpper: 0.01, source: 'unit price ceiling, not real billing' };
const connection = kind => ({ provider: 'deepseek', executor: kind, model: 'unit-model', apiKey: 'fake-secret', baseUrl: kind === 'claude' ? 'https://unit.invalid/anthropic' : 'https://unit.invalid/v1',
    contextWindow: 64000, workingBudget: 60000, maxOutputTokens: 1000, type: 'chat', pricing });
const plan = { type: 'send', messages: [{ role: 'system', content: 'Answer facts' }, { role: 'user', content: 'Where?' }] };
const payload = (kind, extra = {}) => ({ model: 'unit-model', [outputKey(wireProtocol(connection(kind)))]: 100, ...extra });
const post = (kind, extra) => new Request(upstreamEndpoint(connection(kind)), { method: 'POST', body: JSON.stringify(payload(kind, extra)) });
const completion = kind => kind === 'claude'
    ? { content: [{ type: 'text', text: 'reply' }], stop_reason: 'end_turn', usage: { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } }
    : { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'reply' }] }], usage: { input_tokens: 12, output_tokens: 1, input_tokens_details: { cached_tokens: 3 } } };

// Real executor/gateway policy, fake SDK and OS process boundary. start() is replaced;
// all requests invoke handle() directly, with no listener, subprocess or network.
function fakeSdk(kind, transport, attempts = 1) {
    let gateway, calls = 0, cleaned = false;
    const invoke = async prompt => {
        for (let i = 0; i < attempts; i++) {
            const body = kind === 'claude' ? { model: 'unit-model', messages: [{ role: 'user', content: prompt }], max_tokens: 1000 }
                : { model: 'unit-model', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }], max_output_tokens: 1000 };
            const response = await gateway.handle(new Request(`http://127.0.0.1/v1/${kind === 'claude' ? 'messages' : 'responses'}`, {
                method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify(body) }));
            calls++; if (!response.ok) throw new Error('SDK request failed'); await response.json();
        }
    };
    const sdk = kind === 'claude' ? { query: ({ prompt }) => { const iterator = (async function* () { await invoke(prompt); yield { type: 'result', subtype: 'success' }; })(); iterator.close = () => {}; return iterator; } }
        : { Codex: class { startThread() { return { runStreamed: async prompt => ({ events: (async function* () { await invoke(prompt); yield { type: 'turn.completed' }; })() }) }; } } };
    return { factory: (kind === 'claude' ? createClaudeExecutor : createCodexExecutor)({ sdk, fetch: transport.fetch,
        gatewayFactory(options) {
            gateway = createSdkGateway(options);
            return { ...gateway, start: async () => ({ baseUrl: 'http://127.0.0.1:12345', token: gateway.token, mcpUrl: 'http://127.0.0.1:12345/mcp' }) };
        },
        environmentFactory: async () => ({ directory: '/fake/isolation', env: {}, security: { enforced: true, mode: 'unit-double' }, close: async () => { cleaned = true; } }),
    }), state: () => ({ calls, cleaned }) };
}

for (const kind of ['claude', 'codex']) {
    test(`${kind}: real SDK gateway egress uses the shared ceiling and closes without a listener`, async () => {
        let dispatched = 0;
        const c = connection(kind), transport = createBudgetTransport({ connections: [c], ceiling: pipelineQuote([c], 1), fetch: async (request, options) => {
            dispatched++; assert.equal(request.url, upstreamEndpoint(c)); assert.equal(options.redirect, 'error');
            const body = await request.json(); assert.ok(!JSON.stringify(body).includes('CONVERSATION_TRANSCRIPT_'));
            assert.equal(body[outputKey(wireProtocol(c))], 1000);
            return Response.json(completion(kind));
        } });
        const h = fakeSdk(kind, transport), result = await h.factory.runTurn({ connection: c, requestPlan: plan });
        const usage = await transport.finish();
        assert.equal(result.content, 'reply'); assert.equal(dispatched, 1); assert.equal(usage.complete, true); assert.equal(usage.costUsd, null);
        assert.equal(usage.inputTokens, kind === 'claude' ? 17 : 12); assert.equal(usage.outputTokens, 1); assert.equal(h.state().cleaned, true);
    });
    test(`${kind}: SDK continuation cannot exceed the pre-reserved pipeline requests`, async () => {
        let dispatched = 0;
        const c = connection(kind), transport = createBudgetTransport({ connections: [c], ceiling: pipelineQuote([c], 1), fetch: async () => { dispatched++; return Response.json(completion(kind)); } });
        const h = fakeSdk(kind, transport, 2);
        await assert.rejects(h.factory.runTurn({ connection: c, requestPlan: plan }));
        assert.equal(dispatched, 1); assert.equal(h.state().cleaned, true);
        await assert.rejects(transport.finish(), { code: 'evaluation-budget-exhausted' });
    });
    test(`${kind}: cost, total input and output caps independently stop dispatch`, async () => {
        const c = connection(kind), quoted = pipelineQuote([c], 1);
        for (const key of ['maxCostUsd', 'maxInputTokens', 'maxOutputTokens']) {
            const transport = createBudgetTransport({ connections: [c], ceiling: { ...quoted, [key]: 0 }, fetch: () => assert.fail('must not dispatch') });
            await assert.rejects(transport.fetch(post(kind)), { code: 'evaluation-budget-exhausted' });
            assert.equal(transport.dispatched, 0);
        }
    });
    test(`${kind}: quoted configuration uses environment credentials without claiming cache support`, async () => {
        const { apiKey, ...c } = connection(kind);
        const adapter = createEvaluationAdapter({ executor: kind, config: { connection: { ...c, apiKeyEnv: 'TEST_KEY' }, modelVersion: 'unit-v1', maxRequestsPerBatch: 2 }, env: { TEST_KEY: 'not-a-real-key' } });
        assert.equal(adapter.capabilities.runtimeWired, true); assert.equal(adapter.capabilities.cacheControl, false);
        const request = { snapshot: {}, questions: [], condition: { cache: 'uncontrolled' } };
        assert.equal((await adapter.quote(request)).maxRequests, 2);
        await assert.rejects(adapter.quote({ ...request, condition: { cache: 'cold' } }), { code: 'provider-cache-isolation-unverified' });
    });
}

test('Anthropic streaming merges message_start/delta and includes cache read/write once', async () => {
    const events = [
        { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 } } },
        { type: 'message_delta', usage: { input_tokens: null, output_tokens: 4 } },
        { type: 'message_stop' },
    ];
    const wire = events.map(e => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join('');
    const c = connection('claude'), transport = createBudgetTransport({ connections: [c], ceiling: pipelineQuote([c], 1),
        fetch: async () => new Response(wire, { headers: { 'content-type': 'text/event-stream' } }) });
    const returned = await transport.fetch(post('claude')); assert.equal(await returned.text(), wire);
    const usage = await transport.finish(); assert.equal(usage.complete, true); assert.equal(usage.inputTokens, 20); assert.equal(usage.outputTokens, 4);
});

test('Responses stream uses response.completed usage, not additive repeated counters', async () => {
    const completed = completion('codex');
    const wire = `data: ${JSON.stringify({ type: 'response.in_progress', response: { usage: { input_tokens: 12, output_tokens: 0 } } })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: completed })}\n\n`;
    const c = connection('codex'), transport = createBudgetTransport({ connections: [c], ceiling: pipelineQuote([c], 1), fetch: async () => new Response(wire, { headers: { 'content-type': 'text/event-stream' } }) });
    await transport.fetch(post('codex')); const usage = await transport.finish();
    assert.equal(usage.complete, true); assert.equal(usage.inputTokens, 12); assert.equal(usage.outputTokens, 1);
});

test('SDK egress cannot hide server context, change endpoint/model or omit output limit', async () => {
    for (const kind of ['claude', 'codex']) for (const [extra, code] of [
        [{ previous_response_id: 'hidden' }, 'unbounded-server-context'],
        [{ [outputKey(wireProtocol(connection(kind)))]: null }, 'unbounded-provider-output'],
        [{ model: 'different-model' }, 'unpriced-provider-request'],
    ]) {
        const c = connection(kind), transport = createBudgetTransport({ connections: [c], ceiling: pipelineQuote([c], 1), fetch: () => assert.fail('no paid call') });
        await assert.rejects(transport.fetch(post(kind, extra)), { code });
    }
});

test('SDK partial streams and missing Anthropic cache counts never fabricate complete usage', async () => {
    for (const kind of ['claude', 'codex']) {
        const c = connection(kind), body = completion(kind);
        if (kind === 'claude') delete body.usage.cache_creation_input_tokens;
        else body.status = 'in_progress';
        const transport = createBudgetTransport({ connections: [c], ceiling: pipelineQuote([c], 1), fetch: async () => Response.json(body) });
        await transport.fetch(post(kind)); const usage = await transport.finish(); assert.equal(usage.complete, false); assert.equal(usage.costUsd, null);
    }
});

test('one quote and one ceiling cover both SDK protocols plus native summary and embedding calls', async () => {
    const native = { ...connection('native'), provider: 'openai-compatible' }, embedding = { ...native, type: 'embedding', model: 'unit-embed', maxOutputTokens: 0 };
    const connections = [connection('claude'), connection('codex'), native, embedding];
    let sent = 0;
    const transport = createBudgetTransport({ connections, ceiling: pipelineQuote(connections, 4), fetch: async request => {
        sent++;
        if (request.url.endsWith('/messages')) return Response.json(completion('claude'));
        if (request.url.endsWith('/responses')) return Response.json(completion('codex'));
        return Response.json({ usage: { prompt_tokens: 10, completion_tokens: 2 } });
    } });
    await transport.fetch(post('claude')); await transport.fetch(post('codex'));
    await transport.fetch(upstreamEndpoint(native), { method: 'POST', body: JSON.stringify({ model: native.model, max_tokens: 10, messages: [] }) });
    await transport.fetch(upstreamEndpoint(embedding), { method: 'POST', body: JSON.stringify({ model: embedding.model, input: ['index and recall'] }) });
    const usage = await transport.finish();
    assert.equal(sent, 4); assert.equal(usage.providerRequests, 4); assert.equal(usage.inputTokens, 49); assert.equal(usage.outputTokens, 4);
    assert.equal(usage.costUsd, null); assert.ok(usage.costUpperBoundUsd > 0);
});

for (const kind of ['claude', 'codex']) test(`${kind}: unknown submission is not resent even with remaining request credit`, async () => {
    let sent = 0; const c = connection(kind);
    const transport = createBudgetTransport({ connections: [c], ceiling: pipelineQuote([c], 3), fetch: async () => { sent++; throw new Error('connection lost'); } });
    const h = fakeSdk(kind, transport, 2);
    await assert.rejects(h.factory.runTurn({ connection: c, requestPlan: plan }));
    await assert.rejects(transport.fetch(post(kind)), { code: 'evaluation-prior-outcome-unknown' });
    const usage = await transport.finish(); assert.equal(sent, 1); assert.equal(usage.complete, false); assert.equal(usage.costUsd, null); assert.equal(usage.reservedRequests, 1);
});
