import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeExecutor } from '../../../../src/conversation/executors/claude/index.js';
import { createCodexExecutor, codexProcessConfig } from '../../../../src/conversation/executors/codex/index.js';
import { createSdkGateway } from '../../../../src/conversation/executors/sdk-gateway/index.js';

const connection = { model: 'synthetic', baseUrl: 'https://upstream.invalid/v1', apiKey: 'fake-upstream-secret', contextWindow: 32000, workingBudget: 28000, maxOutputTokens: 1000 };
const requestPlan = { messages: [{ role: 'system', content: 'Our instructions' }, { role: 'user', content: 'Hello', id: 'm1', revision: 2 }] };

function harness(kind, { failAfterRequest = false, failEnvironment = false } = {}) {
    let gateway, closedSdk = false, closedGateway = false, closedEnvironment = false, seenPrompt, options, sent, threadConfig;
    const gatewayFactory = config => {
        gateway = createSdkGateway({ ...config, fetch: async (_url, init) => {
            sent = JSON.parse(init.body);
            assert.ok(!JSON.stringify(sent).includes('CONVERSATION_TRANSCRIPT_'));
            return Response.json(kind === 'claude'
                ? { content: [{ type: 'text', text: 'reply' }], stop_reason: 'end_turn', usage: { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
                : { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'reply' }] }], usage: { input_tokens: 12, output_tokens: 1 } });
        } });
        return { ...gateway, start: async () => ({ baseUrl: 'http://127.0.0.1:12345', token: gateway.token, mcpUrl: 'http://127.0.0.1:12345/mcp' }), close: async () => { closedGateway = true; await gateway.close(); } };
    };
    async function invoke(prompt) {
        seenPrompt = prompt;
        const body = kind === 'claude' ? { model: 'synthetic', system: 'Coding defaults', messages: [{ role: 'user', content: prompt }], max_tokens: 2000 } : { model: 'synthetic', instructions: 'Coding defaults', input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] };
        const result = await gateway.handle(new Request(`http://127.0.0.1/v1/${kind === 'claude' ? 'messages' : 'responses'}`, { method: 'POST', headers: { authorization: `Bearer ${gateway.token}` }, body: JSON.stringify(body) }));
        assert.equal(result.status, 200);
        await result.json();
        if (failAfterRequest) throw new Error('must not expose fake-upstream-secret');
    }
    const sdk = kind === 'claude' ? { query(input) {
        options = input.options;
        const iterator = (async function* () { await invoke(input.prompt); yield { type: 'result', subtype: 'success', is_error: false }; })();
        iterator.close = () => { closedSdk = true; };
        return iterator;
    } } : { Codex: class {
        constructor(input) { options = input; }
        startThread(threadOptions) {
            threadConfig = threadOptions;
            assert.equal(threadOptions.approvalPolicy, 'never');
            return { runStreamed: async prompt => ({ events: (async function* () { try { await invoke(prompt); yield { type: 'turn.completed' }; } finally { closedSdk = true; } })() }) };
        }
    } };
    const environmentFactory = async () => {
        if (failEnvironment) throw new Error('failed');
        return { directory: '/synthetic-isolation', env: { HOME: '/synthetic-isolation' }, security: { enforced: true, mode: 'unit-test-double', sdkRuntimeVerified: false }, close: async () => { closedEnvironment = true; } };
    };
    return { dependencies: { sdk, gatewayFactory, environmentFactory }, state: () => ({ closedSdk, closedGateway, closedEnvironment, seenPrompt, options, sent, threadConfig }) };
}

for (const [kind, factory] of [['claude', createClaudeExecutor], ['codex', createCodexExecutor]]) {
    test(`${kind}: adapter passes requested effort to the SDK and gateway`, async () => {
        const h = harness(kind);
        await factory(h.dependencies).runTurn({ connection: { ...connection, reasoning: 'high' }, requestPlan });
        const state = h.state();
        if (kind === 'claude') {
            assert.equal(state.options.effort, 'high');
            assert.deepEqual(state.options.thinking, { type: 'adaptive' });
            assert.equal(state.sent.output_config.effort, 'high');
            assert.ok(!state.options.systemPrompt.includes('structured-transcript interpretation'));
        } else {
            assert.equal(state.threadConfig.modelReasoningEffort, 'high');
            assert.equal(state.sent.reasoning.effort, 'high');
        }
    });
    test(`${kind}: native transcript is the default and remains explicitly distinguished from text fallback`, () => {
        const executor = factory();
        assert.equal(executor.getCapabilities(connection).historyMode, 'native-transcript');
        assert.equal(executor.getCapabilities(connection).nativeHistory, true);
        assert.equal(executor.getCapabilities(connection).budgetEnforcement, 'gateway-every-request');
        // preflight is the authoritative per-connection mode.
        assert.equal(executor.preflight({ connection: { ...connection, historyMode: 'structured-transcript' } }).nativeHistory, false);
        assert.throws(() => executor.preflight({ connection: { ...connection, parameters: { ignored: 1 } } }), { code: 'unsupported-parameters' });
    });
    test(`${kind}: real gateway policy + fake SDK completes a turn and closes resources`, async () => {
        const h = harness(kind); const events = [], traces = [];
        const result = await factory({ ...h.dependencies, onRequest: t => traces.push(t) }).runTurn({ connection, requestPlan, onEvent: e => events.push(e) });
        assert.equal(result.content, 'reply');
        assert.equal(result.capabilities.historyMode, 'native-transcript');
        assert.equal(result.usage.complete, true);
        assert.equal(events.filter(e => e.type === 'text.delta').length, 1);
        assert.equal(traces.length, 1);
        assert.ok(!JSON.stringify(traces).includes(connection.apiKey));
        const state = h.state();
        assert.ok(state.closedSdk && state.closedGateway && state.closedEnvironment);
        assert.match(state.seenPrompt, /^CONVERSATION_TRANSCRIPT_/);
        if (kind === 'claude') { assert.deepEqual(state.options.tools, []); assert.deepEqual(state.options.settingSources, []); assert.equal(state.options.persistSession, false); assert.equal(state.sent.system[0].text, 'Our instructions'); }
        else { assert.equal(state.options.config.features.shell_tool, false); assert.equal(state.sent.instructions, ''); assert.equal(state.sent.input[0].role, 'system'); }
    });
    test(`${kind}: SDK failure still closes all resources and sanitizes its error`, async () => {
        const h = harness(kind, { failAfterRequest: true });
        await assert.rejects(factory(h.dependencies).runTurn({ connection, requestPlan }), { code: 'sdk-execution-failed' });
        assert.ok(h.state().closedSdk && h.state().closedGateway && h.state().closedEnvironment);
    });
    test(`${kind}: environment failure closes a gateway that was already started`, async () => {
        const h = harness(kind, { failEnvironment: true });
        await assert.rejects(factory(h.dependencies).runTurn({ connection, requestPlan }), { code: 'sdk-execution-failed' });
        assert.equal(h.state().closedGateway, true);
    });
}

test('Codex has no model retry, remote WebSocket transport, inherited MCP servers or enabled shell', () => {
    const config = codexProcessConfig({ address: { baseUrl: 'http://127.0.0.1:1', token: 'fake', mcpUrl: 'http://127.0.0.1:1/mcp' }, tools: [{ name: 'recall' }] });
    assert.equal(config.model_providers.conversation_gateway.request_max_retries, 0);
    assert.equal(config.model_providers.conversation_gateway.stream_max_retries, 0);
    assert.equal(config.model_providers.conversation_gateway.supports_websockets, false);
    assert.deepEqual(Object.keys(config.mcp_servers), ['domain']);
    assert.deepEqual(config.mcp_servers.domain.enabled_tools, ['recall']);
});
