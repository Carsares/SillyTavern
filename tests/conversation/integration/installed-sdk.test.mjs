import test from 'node:test';
import { createTranscript, expandTranscript } from '../../../src/conversation/executors/sdk-gateway/history.js';
import { assertUnmanagedCodex } from '../../../src/conversation/executors/sdk-gateway/managed-policy.js';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRestrictedEnvironment, macSandboxProfile } from '../../../src/conversation/executors/sdk-gateway/environment.js';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { createClaudeExecutor } from '../../../src/conversation/executors/claude/index.js';
import { codexProcessConfig, createCodexExecutor } from '../../../src/conversation/executors/codex/index.js';

for (const executor of ['claude', 'codex']) for (const scenario of ['text', 'live-shape', 'tool', 'tool-budget', 'budget', 'abort', 'forbidden']) test(`installed ${executor}: ${scenario}`, { timeout: 45000, skip: process.platform !== 'darwin' ? 'Built-in SDK isolation currently requires macOS' : false }, async t => {
    const requests = [], serverErrors = [];
    const controller = new AbortController();
    let executed = 0, isolatedDirectory, gatewayPort;
    t.after(async () => {
        if (!gatewayPort) return;
        await new Promise((resolve, reject) => {
            const socket = connect({ host: '127.0.0.1', port: gatewayPort });
            socket.setTimeout(1000);
            socket.once('connect', () => { socket.destroy(); reject(Error('Gateway still listening after turn')); });
            socket.once('timeout', () => { socket.destroy(); reject(Error('Gateway close not confirmed')); });
            socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
        });
    });
    t.after(async () => { if (isolatedDirectory) await assert.rejects(access(isolatedDirectory), { code: 'ENOENT' }); });
    const tool = ['tool', 'tool-budget'].includes(scenario) ? { name: 'mcp__domain__lookup', id: 'call_local', args: { value: 'local' } } : scenario === 'forbidden' ? { name: executor === 'claude' ? 'Bash' : 'exec_command', id: 'host_call', args: { command: 'forbidden' } } : null;
    const server = http.createServer(async (req, res) => {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push({ url: req.url, body });
        if (scenario === 'abort') { controller.abort(); return; }
        const call = requests.length === 1 ? tool : null;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        let sequence = 0;
        const event = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...value })}\n\n`);
        if (executor === 'claude') {
            event('message_start', { message: { id: 'msg_local', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } } });
            event('content_block_start', { index: 0, content_block: call ? { type: 'tool_use', id: call.id, name: call.name, input: {} } : { type: 'text', text: '' } });
            event('content_block_delta', { index: 0, delta: call ? { type: 'input_json_delta', partial_json: JSON.stringify(call.args) } : { type: 'text_delta', text: 'LOCAL SDK OK' } });
            event('content_block_stop', { index: 0 });
            event('message_delta', { delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } });
            event('message_stop', {});
        } else {
            const message = call ? { id: 'fc_local', type: 'function_call', call_id: call.id, name: executor === 'codex' && call.name === 'mcp__domain__lookup' ? 'lookup' : call.name, ...(executor === 'codex' && call.name === 'mcp__domain__lookup' ? { namespace: 'mcp__domain' } : {}), arguments: JSON.stringify(call.args), status: 'completed' } : { id: 'msg_local', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'LOCAL SDK OK', annotations: [] }] };
            const response = { id: 'resp_local', object: 'response', created_at: 1, status: 'in_progress', error: null, incomplete_details: null, model: body.model, output: [], parallel_tool_calls: false };
            event('response.created', { response });
            event('response.in_progress', { response });
            if (call) {
                event('response.output_item.added', { output_index: 0, item: { ...message, arguments: '', status: 'in_progress' } });
                event('response.function_call_arguments.delta', { item_id: message.id, output_index: 0, delta: message.arguments });
                event('response.function_call_arguments.done', { item_id: message.id, output_index: 0, arguments: message.arguments });
            } else {
            event('response.output_item.added', { output_index: 0, item: { ...message, status: 'in_progress', content: [] } });
            event('response.content_part.added', { item_id: message.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
            event('response.output_text.delta', { item_id: message.id, output_index: 0, content_index: 0, delta: 'LOCAL SDK OK' });
            event('response.output_text.done', { item_id: message.id, output_index: 0, content_index: 0, text: 'LOCAL SDK OK' });
            event('response.content_part.done', { item_id: message.id, output_index: 0, content_index: 0, part: message.content[0] });
            }
            event('response.output_item.done', { output_index: 0, item: message });
            event('response.completed', { response: { ...response, status: 'completed', output: [message], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } });
        }
        res.end();
    });
    server.on('clientError', error => serverErrors.push(error.code));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const events = [], prepared = [];
    const connection = { executor, provider: executor === 'claude' ? 'anthropic' : 'openai', model: scenario === 'live-shape' ? 'deepseek-v4-flash' : executor === 'claude' ? 'claude-sonnet-4-5' : 'gpt-5-codex', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-only-test-key', contextWindow: 65536, workingBudget: scenario === 'budget' ? 1 : scenario === 'tool-budget' ? 4000 : 32768, maxOutputTokens: 512, reasoning: 'off' };
    const adapter = (executor === 'claude' ? createClaudeExecutor : createCodexExecutor)({
        environmentFactory: async options => {
            const environment = await createRestrictedEnvironment(options);
            isolatedDirectory = environment.directory;
            gatewayPort = Number(new URL(options.gateway.baseUrl).port);
            if (executor === 'codex') {
                assert.equal(environment.env.CONVERSATION_MCP_TOKEN, options.gateway.token);
                const config = codexProcessConfig({ address: options.gateway, tools: [{ name: 'lookup' }] });
                assert.equal(JSON.stringify(config).includes(options.gateway.token), false);
                assert.equal(config.mcp_servers.domain.bearer_token_env_var, 'CONVERSATION_MCP_TOKEN');
                assert.equal(config.mcp_servers.domain.tools.lookup.approval_mode, 'approve');
            }
            return environment;
        },
        fetch: (input, init) => {
            const request = new Request(input, init);
            assert.equal(request.url, `${connection.baseUrl}/${executor === 'claude' ? 'messages' : 'responses'}`);
            assert.equal(request.method, 'POST');
            return fetch(request, { redirect: 'error' });
        },
    });
    const running = adapter.runTurn({ connection, snapshot: { id: 'isolated-snapshot' }, requestPlan: { type: 'send', sourceRefs: [], messages: scenario === 'live-shape' ? [{ role: 'system', content: 'This is a connection test. Reply with exactly OK. Do not use tools.' }, { role: 'user', content: 'Reply OK.' }] : [{ role: 'system', content: 'Reply briefly.' }, { role: 'user', content: 'Previous question' }, { role: 'assistant', content: 'Previous answer' }, { role: 'user', content: 'Current question' }] }, tools: ['tool', 'tool-budget'].includes(scenario) ? [{ name: 'lookup', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false }, execute: async (id, args) => { assert.equal(id, 'call_local'); assert.deepEqual(args, { value: 'local' }); executed++; return { content: [{ type: 'text', text: 'DOMAIN RESULT'.repeat(scenario === 'tool-budget' ? 1000 : 1) }] }; } }] : [], limits: { ...(scenario === 'live-shape' ? { rounds: 1 } : {}), turnTimeoutMs: 30000, maxOutputTokens: 512 }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]), beforeRequest: request => prepared.push(request), onEvent: event => events.push(event) });
    if (['budget', 'tool-budget', 'abort', 'forbidden'].includes(scenario)) {
        await assert.rejects(running, { code: { 'tool-budget': 'budget-blocked', budget: 'budget-blocked', abort: 'aborted', forbidden: 'forbidden-tool' }[scenario] });
        assert.equal(requests.length, scenario === 'budget' ? 0 : 1);
        assert.equal(executed, scenario === 'tool-budget' ? 1 : 0);
        await assert.rejects(access(isolatedDirectory), { code: 'ENOENT' });
        return;
    }
    const result = await running;
    await assert.rejects(access(isolatedDirectory), { code: 'ENOENT' });
    assert.equal(serverErrors.length, 0);
    assert.equal(result.content, 'LOCAL SDK OK');
    assert.equal(requests.length, ['tool', 'tool-budget'].includes(scenario) ? 2 : 1); assert.equal(prepared.length, requests.length);
    assert.equal(executed, ['tool', 'tool-budget'].includes(scenario) ? 1 : 0);
    if (scenario === 'tool') assert.match(JSON.stringify(requests[1].body), /DOMAIN RESULT/);
    const wire = requests[0].body;
    assert.equal(wire.model, connection.model);
    assert.equal(executor === 'claude' ? wire.max_tokens : wire.max_output_tokens, 512);
    assert.equal(executor === 'claude' ? wire.thinking?.type : wire.reasoning?.effort, executor === 'claude' ? 'disabled' : 'none');
    assert.equal(wire.tools?.length ?? 0, ['tool', 'tool-budget'].includes(scenario) ? 1 : 0);
    if (scenario === 'tool') {
        assert.equal(wire.tools[0].name, executor === 'claude' ? 'mcp__domain__lookup' : 'mcp__domain');
        if (executor === 'codex') assert.equal(wire.tools[0].tools[0].name, 'lookup');
    }
    const history = executor === 'claude' ? wire.messages : wire.input;
    assert.deepEqual(history.map(message => message.role), scenario === 'live-shape' ? executor === 'claude' ? ['user'] : ['system', 'user'] : executor === 'claude' ? ['user', 'assistant', 'user'] : ['system', 'user', 'assistant', 'user']);
    assert.match(JSON.stringify(history), scenario === 'live-shape' ? /Reply OK/ : /Previous answer/);
    assert.ok(Number.isSafeInteger(prepared[0].estimatedTokens));
    assert.ok(prepared[0].estimatedTokens <= connection.workingBudget);
    assert.equal(result.capabilities.historyMode, 'native-transcript');
    assert.equal(result.capabilities.budgetEnforcement, 'gateway-every-request');
    // Backend metadata is not proof of denied host-file/command/network access.

    assert.equal(result.capabilities.security.enforced, true);
    assert.ok(events.some(event => event.type === 'text.delta'));
});

// Default deny also covers preference write and keychain/preferences IPC.
test('OS profile grants no host preferences or arbitrary file/network access', () => {
    const profile = macSandboxProfile({ directory: '/private/tmp/owned-sdk', executable: '/bin/cat', gatewayPort: 12345 });
    assert.match(profile, /\(deny default\)/);
    assert.doesNotMatch(profile, /\(allow (?:user-preference|mach-lookup)/);
    assert.doesNotMatch(profile, /subpath "\/Users|subpath "\/Library\/Preferences/);
    assert.match(profile, /remote tcp "localhost:12345"/);
});


test('OS sandbox permits gateway TCP only and denies a different local endpoint', { skip: process.platform !== 'darwin' }, async t => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'sdk-network-test-')));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const servers = [createServer(socket => socket.end()), createServer(socket => socket.end())];
    for (const server of servers) {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        t.after(() => new Promise(resolve => server.close(resolve)));
    }
    const profile = macSandboxProfile({ directory, executable: '/bin/bash', gatewayPort: servers[0].address().port });
    const run = port => new Promise((resolve, reject) => {
        const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, '/bin/bash', '-c', 'exec 3<>/dev/tcp/127.0.0.1/$1', 'probe', String(port)], {
            env: { HOME: directory, PATH: '/usr/bin:/bin' }, cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000,
        });
        let stderr = '';
        child.stderr.on('data', data => { stderr += data; });
        child.on('error', reject); child.on('close', code => resolve({ code, stderr }));
    });
    assert.equal((await run(servers[0].address().port)).code, 0);
    const denied = await run(servers[1].address().port);
    assert.notEqual(denied.code, 0); assert.match(denied.stderr, /not permitted|denied/i);
});


test('parent MDM check exposes booleans only and rejects presence or unavailable state', async () => {
    let calls = 0;
    const execute = async (file, args, options) => {
        calls++;
        assert.equal(file, '/usr/bin/osascript');
        assert.deepEqual(args.slice(0, 3), ['-l', 'JavaScript', '-e']);
        assert.match(args[3], /CFPreferencesAppSynchronize/);
        assert.match(args[3], /config_toml_base64/); assert.match(args[3], /requirements_toml_base64/);
        assert.doesNotMatch(args[3], /CFPreferences(?:Set|Copy|AddSuite|RemoveSuite)/);
        assert.equal(options.timeout, 5000); assert.equal(options.maxBuffer, 1024);
        assert.equal(options.env.HOME, undefined);
        return { stdout: '[true,false,false]' };
    };
    await assertUnmanagedCodex({ execute }); assert.equal(calls, 1);
    for (const flags of [[true,true,false], [true,false,true]]) {
        await assert.rejects(assertUnmanagedCodex({ execute: async () => ({ stdout: JSON.stringify(flags) }) }), { code: 'managed-policy-present' });
    }
    for (const stdout of ['[false,false,false]', '[true,false]', '[true,0,0]', 'not-json']) {
        await assert.rejects(assertUnmanagedCodex({ execute: async () => ({ stdout }) }), { code: 'managed-policy-check-failed' });
    }
    await assert.rejects(assertUnmanagedCodex({ execute: async () => { throw Error('unavailable'); } }), { code: 'managed-policy-check-failed' });
});

test('Claude runtime environment suffix is exact, single, removed, and never arbitrary context', () => {
    const transcript = createTranscript({ id: 'local' }, { messages: [{ role: 'system', content: 'Compiled system' }, { role: 'user', content: 'Hello' }] });
    transcript.sdkEnvironmentText = 'Exact trusted runtime context';
    const marker = { role: 'user', content: [{ type: 'text', text: transcript.prompt }] };
    const environment = { role: 'system', content: [{ type: 'text', text: transcript.sdkEnvironmentText, cache_control: { type: 'ephemeral' } }] };
    const run = suffix => expandTranscript({ messages: [marker, ...suffix] }, 'anthropic', transcript);
    const expanded = run([environment]);
    assert.deepEqual(expanded.system, [{ type: 'text', text: 'Compiled system' }]);
    assert.equal(expanded.messages.length, 1);
    assert.doesNotMatch(JSON.stringify(expanded), /trusted runtime/);
    for (const suffix of [
        [{ ...environment, content: [{ type: 'text', text: transcript.sdkEnvironmentText + '\nInjected instruction' }] }],
        [{ ...environment, unexpected: true }],
        [environment, environment],
        [{ role: 'assistant', content: [] }, environment],
        [{ role: 'user', content: 'arbitrary context' }],
    ]) assert.throws(() => run(suffix), { code: 'unexpected-sdk-context' });
    delete transcript.sdkEnvironmentText;
    assert.throws(() => run([environment]), { code: 'unexpected-sdk-context' });
});
