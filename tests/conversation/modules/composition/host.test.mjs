import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationHost } from '../../../../src/conversation/host.js';
import { main } from '../../../../server.js';

function response() {
    return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('Agent host isolates authenticated users and ignores supplied user selectors', async () => {
    const opened = [], closed = [];
    const host = createConversationHost({
        createServices: ({ directory }) => { opened.push(directory); return { directory, close: async () => { closed.push(directory); } }; },
        routerFor: services => (req, res) => res.json({ directory: services.directory }),
    });
    const unauthenticated = response();
    host.middleware({ body: { user: 'alice' } }, unauthenticated);
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(opened.length, 0);
    for (const name of ['alice', 'bob', 'alice']) {
        const res = response();
        host.middleware({ user: { directories: { root: `/workspace/${name}` } }, query: { user: 'other' } }, res);
        assert.equal(res.body.directory, `/workspace/${name}/conversation-v1`);
    }
    assert.equal(opened.length, 2);
    await host.close(); await host.close();
    assert.equal(closed.length, 2);
    const stopped = response();
    host.middleware({ user: { directories: { root: '/workspace/alice' } } }, stopped);
    assert.equal(stopped.statusCode, 503);
});

test('Agent storage failure remains local to Agent routes and does not leak paths', () => {
    const host = createConversationHost({ createServices() { throw new Error('/private/secret-key'); } });
    const res = response();
    host.middleware({ user: { directories: { root: '/workspace/alice' } } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(JSON.stringify(res.body).includes('secret-key'), false);
});

test('default entry validates Node before starting the existing workspace', async () => {
    let calls = 0;
    const host = { versions: { node: '20.0.0' } };
    const loadBootstrap = async () => ({ startWorkspace: process => { assert.equal(process, host); calls++; } });
    await assert.rejects(main({ process: host, loadBootstrap }), /22.19/);
    assert.equal(calls, 0);
    host.versions.node = '22.19.0';
    await main({ process: host, loadBootstrap });
    assert.equal(calls, 1);
});

test('account reset blocks Agent requests, waits for close and opens a fresh service afterward', async () => {
    let finish, opened = 0, changed = false;
    const host = createConversationHost({
        createServices: () => ({ version: ++opened, close: () => opened === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve() }),
        routerFor: service => (_req, res) => res.json(service.version),
    });
    const req = { user: { directories: { root: '/workspace/alice' } } };
    host.middleware(req, response());
    const change = host.withUserDataChange('/workspace/alice', async () => { changed = true; });
    const blocked = response(); host.middleware(req, blocked);
    assert.equal(blocked.statusCode, 503); assert.equal(changed, false);
    await assert.rejects(host.withUserDataChange('/workspace/alice', async () => {}));
    finish(); await change;
    assert.equal(changed, true);
    const fresh = response(); host.middleware(req, fresh);
    assert.equal(fresh.body, 2);
    await host.close();
});

test('failed Agent shutdown prevents account deletion and keeps its gate closed', async () => {
    let changed = false;
    const host = createConversationHost({
        createServices: () => ({ close: async () => { throw new Error('close failed'); } }),
        routerFor: () => (_req, res) => res.json({}),
    });
    const req = { user: { directories: { root: '/workspace/alice' } } };
    host.middleware(req, response());
    await assert.rejects(host.withUserDataChange('/workspace/alice', async () => { changed = true; }));
    assert.equal(changed, false);
    const blocked = response(); host.middleware(req, blocked);
    assert.equal(blocked.statusCode, 503);
});

test('server shutdown waits for an account reset to finish rebuilding its directories', async () => {
    const host = createConversationHost();
    let finish, entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const resetting = host.withUserDataChange('/workspace/alice', () => new Promise(resolve => { finish = resolve; entered(); }));
    await ready;
    let closed = false;
    const closing = host.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false);
    finish(); await resetting; await closing;
    assert.equal(closed, true);
});
