import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createApplication, createSecurityMiddleware, startServer, parseArguments } from '../../../../src/conversation/server.js';
import { main } from '../../../../server.js';

function request(middleware, overrides = {}) {
    const headers = { host: 'localhost:8000', ...overrides.headers };
    const req = { method: 'GET', secure: false, ...overrides, headers, get: key => headers[key.toLowerCase()] };
    const result = { status: 200, headers: {}, next: false };
    const res = { setHeader(key, value) { result.headers[key] = value; }, status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; }, sendStatus(code) { result.status = code; return this; } };
    middleware(req, res, () => { result.next = true; });
    return result;
}
const auth = `Basic ${Buffer.from('user:unit-password').toString('base64')}`;

test('host, origin, authentication and CSRF are checked without HTTP requests', () => {
    const security = createSecurityMiddleware({ csrf: 'unit-csrf', password: 'unit-password' });
    assert.equal(request(security).status, 401);
    assert.equal(request(security, { headers: { authorization: auth } }).next, true);
    assert.equal(request(security, { headers: { host: 'evil.test', authorization: auth } }).status, 403);
    assert.equal(request(security, { headers: { host: 'evil@localhost', authorization: auth } }).status, 400);
    assert.equal(request(security, { headers: { host: undefined, authorization: auth } }).status, 400);
    assert.equal(request(security, { headers: { authorization: auth, origin: 'https://localhost:8000' } }).status, 403);
    assert.equal(request(security, { method: 'POST', headers: { authorization: auth, origin: 'http://localhost:8000' } }).status, 403);
    assert.equal(request(security, { method: 'POST', headers: { authorization: auth, origin: 'http://localhost:8000', 'x-csrf-token': 'unit-csrf' } }).next, true);
});

test('argument parsing rejects missing values and never maps old root directly', () => {
    for (const args of [['--port'], ['--host'], ['--dataRoot'], ['--allowed-host'], ['--port', '--listen'], ['--port', '-1'], ['--port', '65536'], ['--port', '1e3'], ['--host', 'http://localhost'], ['--allowed-host', '*']]) assert.throws(() => parseArguments(args));
    const options = parseArguments(['--port', '0', '--host', '::1', '--dataRoot', '/virtual/data']);
    assert.equal(options.directory, '/virtual/data/default-user/conversation-v1');
    assert.equal(options.port, 0);
});

function fakeExpress() {
    const routes = [];
    const app = { disable() {}, use(...args) { routes.push(args); }, get(...args) { routes.push(args); } };
    const factory = () => app;
    factory.static = value => ({ static: value });
    return { factory, app, routes };
}

test('application construction uses only new static roots and close is idempotent', async () => {
    let closed = 0;
    const fake = fakeExpress();
    const result = await createApplication({ directory: '/virtual/conversation-v1', services: { close: async () => { closed++; } }, dependencies: { express: fake.factory, createRouter: () => ({ router: true }) } });
    assert.ok(fake.routes.some(route => route[0] === '/modern/conversation'));
    assert.ok(fake.routes.some(route => route[0] === '/shared/conversation'));
    assert.ok(!fake.routes.some(route => route[0] === '/data'));
    await Promise.all([result.close(), result.close()]);
    assert.equal(closed, 1);
});

test('application setup failure awaits cleanup and invalid configuration creates no store', async () => {
    let closed = false, created = false;
    await assert.rejects(createApplication({ services: { close: async () => { await new Promise(r => setImmediate(r)); closed = true; } }, dependencies: { express: fakeExpress().factory, createRouter: () => { throw new Error('router'); } } }), /router/);
    assert.equal(closed, true);
    await assert.rejects(createApplication({ directory: '/virtual/old-data', dependencies: { createConversationServices: () => { created = true; } } }), { code: 'invalid-directory' });
    assert.equal(created, false);
});

class StubServer extends EventEmitter {
    listen(port, host) { this.bound = { port, host }; queueMicrotask(() => this.emit(this.fail ? 'error' : 'listening', new Error('address-in-use'))); }
    address() { return { address: '127.0.0.1', port: 1234 }; }
    close(callback) { this.closeCalls = (this.closeCalls ?? 0) + 1; this.closed = callback; }
    closeAllConnections() { this.allClosed = true; this.closed?.(); }
}

test('listener validates before construction; fake listen failure releases services', async () => {
    let created = 0, closed = 0;
    const server = new StubServer(); server.fail = true;
    const dependencies = { createApplication: async () => { created++; return { app: {}, close: async () => { closed++; } }; }, createServer: () => server };
    await assert.rejects(startServer({ host: '0.0.0.0', password: '', dependencies }));
    assert.equal(created, 0);
    await assert.rejects(startServer({ port: 90000, password: 'unit', dependencies }));
    assert.equal(created, 0);
    await assert.rejects(startServer({ password: 'unit', dependencies }), /address-in-use/);
    assert.equal(closed, 1); assert.equal(server.allClosed, true);
});

test('shutdown disconnects fake connections even when service close rejects', async () => {
    const server = new StubServer();
    const application = await startServer({ password: 'unit', dependencies: { createServer: () => server, createApplication: async () => ({ app: {}, close: async () => { throw new Error('shutdown'); } }) } });
    await assert.rejects(application.close(), /shutdown/);
    await assert.rejects(application.close(), /shutdown/);
    assert.equal(server.closeCalls, 1); assert.equal(server.allClosed, true);
});

test('root version check precedes loading application and signals close only once', async () => {
    let loaded = false, closed = 0;
    const host = new EventEmitter(); Object.assign(host, { versions: { node: '20.0.0' }, argv: ['node', 'server.js'] });
    await assert.rejects(main({ process: host, loadServer: async () => { loaded = true; } }), /22.19/);
    assert.equal(loaded, false);
    host.versions.node = '22.19.0';
    await main({ process: host, log: { log() {}, error() {} }, loadServer: async () => ({ parseArguments: () => ({}), startServer: async () => ({ address: { address: 'local', port: 0 }, close: async () => { closed++; } }) }) });
    host.emit('SIGINT'); host.emit('SIGTERM');
    await new Promise(r => setImmediate(r));
    assert.equal(closed, 1);
    assert.equal(host.listenerCount('SIGINT'), 0);
    assert.equal(host.listenerCount('SIGTERM'), 0);
    const entry = readFileSync(new URL('../../../../server.js', import.meta.url), 'utf8');
    assert.ok(!/server-main|CommandLineParser|migration|DATA_ROOT/.test(entry));
});
