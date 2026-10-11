import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createConnectionFetch, validateConnectionProxy } from '../../../../src/conversation/providers/core/proxy.js';

async function listen(t, handler) {
    const server = http.createServer(handler);
    const sockets = new Set();
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
    return { server, url: `http://127.0.0.1:${server.address().port}` };
}
function transport(t, connection, options) {
    const result = createConnectionFetch(connection, options);
    t.after(() => result.close());
    return result;
}

test('strict proxy validation permits authenticated HTTP/HTTPS only and hides secrets', () => {
    assert.equal(validateConnectionProxy({}), null);
    assert.equal(validateConnectionProxy({ proxy: null }), null);
    assert.equal(validateConnectionProxy({ data: { proxy: { url: 'https://user:p%40ss@proxy.invalid:8443/' } } }), 'https://user:p%40ss@proxy.invalid:8443/');
    for (const proxy of [false, '', [], {}, { url: 'http://host', rejectUnauthorized: false },
        ...['socks5://host', 'file:///secret', 'http://host/x', 'http://host/x/..', 'http://host/?', 'http://host/#', 'http://host?token=secret',
            'http://host:0', 'http://host:99999', ' http://host', 'http://host\\secret', 'http://user:%xx@host', 'http://user:%0a@host', `http://${'a'.repeat(4096)}`].map(url => ({ url }))]) {
        assert.throws(() => validateConnectionProxy({ proxy }), error => error.code === 'invalid-proxy' && !error.message.includes('secret'));
    }
});

test('authenticated HTTP proxy carries POST body and returns global Web-stream Response', { timeout: 5000 }, async t => {
    const received = [], forwarded = [];
    const origin = await listen(t, async (req, res) => {
        let body = ''; for await (const chunk of req) body += chunk;
        received.push({ body, auth: req.headers['proxy-authorization'], authorization: req.headers.authorization });
        res.setHeader('Content-Type', 'text/event-stream'); res.write('data: first\n\n'); res.end('data: final\n\n');
    });
    const proxy = await listen(t, (req, res) => {
        forwarded.push({ url: req.url, auth: req.headers['proxy-authorization'] });
        const headers = { ...req.headers }; delete headers['proxy-authorization']; delete headers['proxy-connection'];
        const upstream = http.request(req.url, { method: req.method, headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
        upstream.on('error', () => res.destroy()); req.pipe(upstream);
    });
    const url = new URL(proxy.url); url.username = 'user'; url.password = 'p@ss';
    const client = transport(t, { proxy: { url: url.href } });
    const response = await client.fetch(`${origin.url}/generate`, { method: 'POST', body: '{"hello":1}', headers: { Authorization: 'Bearer synthetic', 'Proxy-Authorization': 'must-not-win' } });
    assert.ok(response instanceof Response); assert.equal(typeof response.body.getReader, 'function');
    assert.equal(await response.text(), 'data: first\n\ndata: final\n\n');
    assert.equal(forwarded.length, 1); assert.equal(forwarded[0].url, `${origin.url}/generate`);
    assert.equal(forwarded[0].auth, `Basic ${Buffer.from('user:p@ss').toString('base64')}`);
    assert.deepEqual(received, [{ body: '{"hello":1}', auth: undefined, authorization: 'Bearer synthetic' }]);
    const next = await client.fetch(`${origin.url}/again`); await next.text();
    assert.equal(forwarded.length, 2);
    client.close(); client.close();
    await assert.rejects(client.fetch(origin.url), { code: 'transport-closed' });
});

test('unavailable or refusing proxy never falls back to a reachable origin', { timeout: 5000 }, async t => {
    let direct = 0;
    const origin = await listen(t, (_req, res) => { direct++; res.end('direct'); });
    const refused = await listen(t, (_req, res) => { res.writeHead(407); res.end('proxy auth required'); });
    const client = transport(t, { proxy: { url: refused.url } });
    assert.equal((await client.fetch(origin.url)).status, 407);
    await new Promise(resolve => refused.server.close(resolve));
    const unavailable = transport(t, { proxy: { url: refused.url } });
    await assert.rejects(unavailable.fetch(origin.url), { code: 'provider-network-error' });
    assert.equal(direct, 0);
});

test('ambient proxy and NO_PROXY do not affect either direct or explicit proxy transport', { timeout: 5000 }, async t => {
    let originCalls = 0, proxyCalls = 0;
    const origin = await listen(t, (_req, res) => { originCalls++; res.end('origin'); });
    const proxy = await listen(t, (_req, res) => { proxyCalls++; res.end('proxy'); });
    const values = { HTTP_PROXY: proxy.url, HTTPS_PROXY: proxy.url, ALL_PROXY: proxy.url, http_proxy: proxy.url, https_proxy: proxy.url, all_proxy: proxy.url, NO_PROXY: '*', no_proxy: '*' };
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    try {
        Object.assign(process.env, values);
        assert.equal(await (await transport(t, {}).fetch(origin.url)).text(), 'origin');
        assert.equal(await (await transport(t, { proxy: { url: proxy.url } }).fetch(origin.url)).text(), 'proxy');
        // Now remove bypass: direct transport must still ignore environment proxies.
        process.env.NO_PROXY = ''; process.env.no_proxy = '';
        assert.equal(await (await transport(t, { proxy: null }).fetch(origin.url)).text(), 'origin');
        assert.equal(originCalls, 2); assert.equal(proxyCalls, 1);
    } finally {
        for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
});

test('HTTPS destination uses CONNECT; proxy refusal never reaches destination', { timeout: 5000 }, async t => {
    const proxy = await listen(t, (_req, res) => res.end());
    const connects = [];
    proxy.server.on('connect', (req, socket) => { connects.push(req.url); socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n'); });
    const response = await transport(t, { proxy: { url: proxy.url } }).fetch('https://synthetic.invalid/generate');
    assert.equal(response.status, 407); assert.deepEqual(connects, ['synthetic.invalid:443']);
});

test('close aborts a live streaming body; redirect never follows to another host', { timeout: 5000 }, async t => {
    let redirected = 0;
    const other = await listen(t, (_req, res) => { redirected++; res.end(); });
    const source = await listen(t, (req, res) => {
        if (req.url === '/redirect') { res.writeHead(302, { Location: other.url }); res.end(); }
        else { res.writeHead(200); res.write('first'); }
    });
    const client = transport(t, {});
    await assert.rejects(client.fetch(`${source.url}/redirect`, { redirect: 'follow' }), { code: 'provider-network-error' });
    assert.equal(redirected, 0);
    const response = await client.fetch(source.url);
    const reader = response.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
    client.close();
    await assert.rejects(reader.read());
});

test('injected transport receives agent with forced TLS and fixed proxy; native fetch is rejected', async t => {
    assert.throws(() => createConnectionFetch({ proxy: { url: 'http://proxy.invalid' } }, { fetch: globalThis.fetch }), { code: 'invalid-transport' });
    let calls = 0;
    const client = transport(t, { proxy: { url: 'https://user:secret@proxy.invalid' } }, { fetch: async (request, options) => {
        calls++;
        assert.ok(request instanceof Request);
        assert.equal(options.agent.connectOpts.rejectUnauthorized, true);
        assert.equal(await options.agent.getProxyForUrl('http://different.invalid'), 'https://user:secret@proxy.invalid/');
        assert.equal(request.redirect, 'error');
        return new Response('injected');
    } });
    assert.equal(await (await client.fetch('http://target.invalid')).text(), 'injected');
    assert.equal(calls, 1);
    const broken = transport(t, {}, { fetch: async () => { throw new Error('https://user:secret@proxy.invalid'); } });
    await assert.rejects(broken.fetch('http://target.invalid'), error => error.code === 'provider-network-error' && !error.message.includes('secret'));
});

test('empty response statuses, multipart bodies and per-request abort retain fetch semantics', { timeout: 5000 }, async t => {
    let ready;
    const arrived = new Promise(resolve => { ready = resolve; });
    const source = await listen(t, async (req, res) => {
        if (req.url === '/pending') { ready(); return; }
        if (req.url === '/multipart') {
            let body = ''; for await (const chunk of req) body += chunk;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ type: req.headers['content-type'], body })); return;
        }
        res.writeHead(204); res.end();
    });
    const client = transport(t, {});
    for (const method of ['GET', 'HEAD']) {
        const response = await client.fetch(source.url, { method });
        assert.equal(response.status, 204); assert.equal(response.body, null);
    }
    const form = new FormData(); form.append('prompt', 'hello');
    const multipart = await (await client.fetch(`${source.url}/multipart`, { method: 'POST', body: form })).json();
    assert.match(multipart.type, /^multipart\/form-data; boundary=/); assert.match(multipart.body, /hello/);
    const controller = new AbortController();
    const pending = client.fetch(`${source.url}/pending`, { signal: controller.signal });
    const rejected = assert.rejects(pending, { code: 'aborted' });
    await arrived; controller.abort(); await rejected;
    assert.equal((await client.fetch(source.url)).status, 204);
});

test('global agent mode passes no agent to an injected transport and keeps request hygiene', async t => {
    const seen = [];
    const client = transport(t, { proxy: null }, { agent: 'global', fetch: async (request, options) => {
        seen.push({ options, redirect: request.redirect, proxyAuth: request.headers.get('proxy-authorization'), authorization: request.headers.get('authorization') });
        return new Response('global');
    } });
    assert.equal(await (await client.fetch('http://target.invalid', { headers: { Authorization: 'Bearer synthetic', 'Proxy-Authorization': 'must-not-pass' } })).text(), 'global');
    assert.deepEqual(seen, [{ options: { redirect: 'error' }, redirect: 'error', proxyAuth: null, authorization: 'Bearer synthetic' }]);
    assert.equal(Object.hasOwn(seen[0].options, 'agent'), false);
    client.close(); client.close();
    await assert.rejects(client.fetch('http://target.invalid'), { code: 'transport-closed' });
    const broken = transport(t, {}, { agent: 'global', fetch: async () => { throw new Error('https://user:secret@target.invalid'); } });
    await assert.rejects(broken.fetch('http://target.invalid'), error => error.code === 'provider-network-error' && !error.message.includes('secret'));
});

test('global agent mode rejects connection proxy, native fetch and unknown agent values', () => {
    for (const connection of [{ proxy: { url: 'https://user:secret@proxy.invalid:8443/' } }, { data: { proxy: { url: 'http://proxy.invalid' } } }]) {
        assert.throws(() => createConnectionFetch(connection, { agent: 'global' }),
            error => error.code === 'invalid-transport' && !/secret|proxy\.invalid|user/.test(error.message));
    }
    // Bare `fetch` is the native global fetch (tests/.eslintrc.cjs does not declare globalThis).
    assert.throws(() => createConnectionFetch({}, { agent: 'global', fetch }), { code: 'invalid-transport' });
    for (const agent of ['Global', 'proxy', '', null, true, {}, () => 'global']) {
        assert.throws(() => createConnectionFetch({}, { agent }), { code: 'invalid-transport' });
    }
    assert.throws(() => createConnectionFetch({}, { agent: 'global', fetch: 'not-a-function' }), { code: 'invalid-transport' });
});

test('global agent mode routes node-fetch through http.globalAgent; default mode does not', { timeout: 5000 }, async t => {
    const origin = await listen(t, (_req, res) => res.end('origin'));
    let connections = 0, destroyed = 0;
    class CountingAgent extends http.Agent {
        createConnection(...args) { connections++; return super.createConnection(...args); }
        destroy() { destroyed++; return super.destroy(); }
    }
    const previous = http.globalAgent;
    const counting = new CountingAgent({ keepAlive: false });
    try {
        http.globalAgent = counting;
        const global = createConnectionFetch({}, { agent: 'global' });
        assert.equal(await (await global.fetch(`${origin.url}/global`)).text(), 'origin');
        assert.equal(connections, 1);
        global.close(); global.close();
        assert.equal(destroyed, 0);
        await assert.rejects(global.fetch(origin.url), { code: 'transport-closed' });
        assert.equal(await (await transport(t, {}).fetch(`${origin.url}/default`)).text(), 'origin');
        assert.equal(connections, 1);
    } finally {
        http.globalAgent = previous;
        counting.destroy();
    }
});
