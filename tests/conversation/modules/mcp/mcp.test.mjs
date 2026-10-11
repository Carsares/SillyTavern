import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createMcpServer } from '../../../../src/conversation/mcp/index.js';
import { createToolRegistry } from '../../../../src/conversation/tools/index.js';
import { fakeStore } from '../memory/fake-store.mjs';
const message = (method, params = {}, id = 1) => ({ jsonrpc: '2.0', id, method, params });
test('MCP uses the same registry definitions and persisted tool executions', async () => {
    const store = fakeStore({ active: true }); let draws = 0;
    const registry = createToolRegistry({ store, random: () => { draws++; return 0; } }); const mcp = createMcpServer({ registry, store }); const token = mcp.issueToken('active');
    const list = await mcp.handle({ token, message: message('tools/list') });
    assert.deepEqual(list.body.result.tools.map(d => d.name), registry.definitions().map(d => d.name));
    const request = { token, message: message('tools/call', { name: 'roll_dice', arguments: { expr: '1d6' } }, 2) };
    assert.deepEqual(await mcp.handle(request), await mcp.handle(request)); assert.equal(draws, 1);
});
test('token scope cannot elevate, expiry/revocation and every-call turn checks apply', async () => {
    const store = fakeStore({ active: true }); let now = 10;
    const registry = createToolRegistry({ store }); const mcp = createMcpServer({ registry, store, now: () => now, ttlMs: 100 });
    assert.throws(() => mcp.issueToken('active', { tools: ['shell'] }));
    const token = mcp.issueToken('active', { tools: ['get_time'] });
    assert.equal((await mcp.handle({ token, message: message('tools/call', { name: 'roll_dice', arguments: { expr: '1d6' } }) })).status, 403);
    now = 110; assert.equal((await mcp.handle({ token, message: message('ping') })).status, 401);
    const next = mcp.issueToken('active'); mcp.revokeToken(next); assert.equal((await mcp.handle({ token: next, message: message('ping') })).status, 401);
    const stopped = mcp.issueToken('active'); store.turns.get('active').cancelRequested = true;
    assert.equal((await mcp.handle({ token: stopped, message: message('tools/list') })).status, 401);
});
test('initialize and unknown methods expose no host capabilities', async () => {
    const store = fakeStore({ active: true }); const mcp = createMcpServer({ registry: createToolRegistry({ store }), store }); const token = mcp.issueToken('active');
    const init = await mcp.handle({ token, message: message('initialize') }); assert.deepEqual(Object.keys(init.body.result.capabilities), ['tools']);
    assert.equal((await mcp.handle({ token, message: message('resources/read', { uri: 'file:///etc/passwd' }) })).body.error.code, -32601);
    assert.equal((await mcp.handle({ token, message: [] })).status, 400);
});
test('HTTP handler parses JSON without listening on any port and rejects unauthorized/origin', async () => {
    const store = fakeStore({ active: true }); const mcp = createMcpServer({ registry: createToolRegistry({ store }), store }); const token = mcp.issueToken('active');
    async function invoke(body, headers = {}) {
        const req = Readable.from([body]); req.method = 'POST'; req.headers = { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers };
        const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
        await mcp.handler(req, res); return res;
    }
    assert.equal((await invoke(JSON.stringify(message('tools/list')))).statusCode, 200);
    assert.equal((await invoke('{}', { origin: 'https://example.com' })).statusCode, 403);
    assert.equal((await invoke('{}', { authorization: 'Bearer bad' })).statusCode, 401);
    assert.equal((await invoke('{bad')).statusCode, 400);
    assert.equal((await invoke('x'.repeat(65537))).statusCode, 413);
});
