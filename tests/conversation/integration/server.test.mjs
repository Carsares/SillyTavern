import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const env = password => ({ PATH: process.env.PATH, NODE_ENV: 'test', ...(password === undefined ? {} : { CONVERSATION_PASSWORD: password }) });
const basic = password => `Basic ${Buffer.from(`test:${password}`).toString('base64')}`;
const workspace = directory => path.join(directory, 'default-user/conversation-v1');
const cleanups = new Map();

async function temporary(t) {
    const directory = await mkdtemp(path.join(tmpdir(), 'conversation-server-integration-'));
    cleanups.set(directory, []);
    t.after(async () => {
        try { for (const stop of cleanups.get(directory)) await stop(); }
        finally { cleanups.delete(directory); await rm(directory, { recursive: true, force: true }); }
    });
    return directory;
}

function processRun(script, args, directory, password) {
    const child = spawn(process.execPath, [path.join(root, script), ...args], { cwd: directory, env: env(password), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-16000); });
    const done = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal, output }));
    });
    // Every owned process has a deadline, including failed startup and healthcheck.
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    done.finally(() => clearTimeout(timer)).catch(() => {});
    return { child, done };
}

async function launch(t, directory, { port = 0, host = '127.0.0.1', password, extra = [] } = {}) {
    const running = processRun('server.js', ['--host', host, '--port', String(port), '--dataRoot', directory, ...extra], directory, password);
    let stopped = false;
    async function stop() {
        if (stopped) return;
        stopped = true;
        running.child.kill('SIGTERM');
        const result = await running.done;
        assert.equal(result.code, 0, result.output);
        assert.equal(result.signal, null);
        await assert.rejects(access(path.join(workspace(directory), '.writer.lock')), { code: 'ENOENT' });
    }
    cleanups.get(directory).push(stop);
    const actualPort = await new Promise((resolve, reject) => {
        let stdout = '';
        running.child.stdout.on('data', data => {
            stdout += data;
            const match = stdout.match(/Conversation v1 listening on .*:(\d+)/);
            if (match) resolve(Number(match[1]));
        });
        running.done.then(result => reject(new Error(`Server exited before ready: ${JSON.stringify(result)}`)), reject);
    });
    return { port: actualPort, stop };
}

function request(port, pathname, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers: { Connection: 'close', ...headers }, timeout: 4000 }, res => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { text += chunk; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('HTTP deadline exceeded')));
        req.end(body === undefined ? undefined : JSON.stringify(body));
    });
}

test('real default entrypoint: init, routes, request security, old API removal and shutdown', { timeout: 25000 }, async t => {
    const directory = await temporary(t);
    await mkdir(path.join(directory, 'default-user/chats'), { recursive: true });
    const sentinel = path.join(directory, 'default-user/chats/legacy.json');
    await writeFile(sentinel, 'synthetic legacy data: leave untouched');
    for (let i = 0; i < 2; i++) {
        const result = await processRun('src/conversation/init.js', ['--dataRoot', directory], directory).done;
        assert.equal(result.code, 0, result.output);
        assert.match(result.output, /workspace initialized/);
        await access(path.join(workspace(directory), 'store.sqlite'));
        await assert.rejects(access(path.join(workspace(directory), '.writer.lock')), { code: 'ENOENT' });
    }
    const server = await launch(t, directory, { extra: ['--allowed-host', 'conversation.test'] });
    const { port } = server;
    await t.test('root redirect, modern assets and health', async () => {
        const landing = await request(port, '/');
        assert.equal(landing.status, 302);
        assert.equal(landing.headers.location, '/modern/conversation/');
        assert.equal((await request(port, '/modern/conversation/')).status, 200);
        const health = await request(port, '/health');
        assert.equal(health.status, 200);
        assert.deepEqual(health.json(), { status: 'ok', schemaVersion: 1 });
        assert.equal(health.headers['x-content-type-options'], 'nosniff');
        assert.match(health.headers['content-security-policy'], /frame-ancestors 'none'/);
        assert.deepEqual((await request(port, '/api/conversation/v1/resources')).json(), []);
    });
    const tokenResponse = await request(port, '/csrf-token');
    assert.equal(tokenResponse.headers['cache-control'], 'no-store');
    const token = tokenResponse.json().token;
    assert.match(token, /^[a-f0-9]{64}$/);
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': token };
    await t.test('CSRF rejects mutations without valid token; same-origin mutation persists', async () => {
        for (const supplied of [undefined, 'wrong']) {
            const result = await request(port, '/api/conversation/v1/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(supplied ? { 'X-CSRF-Token': supplied } : {}) }, body: { schemaVersion: 1 } });
            assert.equal(result.status, 403);
            assert.equal(result.json().error.code, 'csrf');
        }
        assert.deepEqual((await request(port, '/api/conversation/v1/conversations')).json(), []);
        const created = await request(port, '/api/conversation/v1/conversations', { method: 'POST', headers: { ...headers, Origin: `http://127.0.0.1:${port}` }, body: { schemaVersion: 1, title: 'isolated integration' } });
        assert.equal(created.status, 201, created.text);
        assert.equal((await request(port, '/api/conversation/v1/conversations')).json().length, 1);
    });
    await t.test('Host allowlist and Origin checks apply even with valid CSRF', async () => {
        for (const host of ['127.0.0.1', 'localhost', 'conversation.test']) assert.equal((await request(port, '/health', { headers: { Host: `${host}:${port}` } })).status, 200);
        const denied = await request(port, '/health', { headers: { Host: `attacker.invalid:${port}` } });
        assert.equal(denied.status, 403);
        assert.equal(denied.json().error.code, 'host-denied');
        for (const origin of ['null', 'https://attacker.invalid', `https://127.0.0.1:${port}`, 'http://127.0.0.1:1']) {
            const response = await request(port, '/api/conversation/v1/conversations', { method: 'POST', headers: { ...headers, Origin: origin }, body: { schemaVersion: 1 } });
            assert.equal(response.status, 403, origin);
        }
        assert.equal((await request(port, '/api/conversation/v1/conversations')).json().length, 1);
    });
    await t.test('old routes are absent after passing authentication and CSRF', async () => {
        for (const route of ['/api/chats/get', '/api/settings/get', '/api/backends/chat-completions/generate', '/api/backends/text-completions/generate']) {
            for (const method of ['GET', 'POST']) assert.equal((await request(port, route, { method, headers, ...(method === 'POST' ? { body: {} } : {}) })).status, 404, `${method} ${route}`);
        }
        for (const route of ['/index.html', '/script.js', '/scripts/secrets.js']) assert.equal((await request(port, route)).status, 404, route);
    });
    await server.stop();
    assert.equal(await readFile(sentinel, 'utf8'), 'synthetic legacy data: leave untouched');
});

test('remote listener requires password before creating data; valid password protects all routes', { timeout: 25000 }, async t => {
    const directory = await temporary(t);
    for (const args of [['--listen'], ['--host', '0.0.0.0']]) {
        const result = await processRun('server.js', [...args, '--port', '0', '--dataRoot', directory], directory).done;
        assert.equal(result.code, 1, result.output);
        await assert.rejects(access(workspace(directory)), { code: 'ENOENT' });
    }
    const password = 'synthetic-integration-password';
    const { port } = await launch(t, directory, { host: '0.0.0.0', password });
    for (const route of ['/', '/health', '/csrf-token', '/modern/conversation/', '/api/conversation/v1/resources']) {
        const anonymous = await request(port, route);
        assert.equal(anonymous.status, 401, route);
        assert.match(anonymous.headers['www-authenticate'], /^Basic /);
        assert.equal((await request(port, route, { headers: { Authorization: basic('incorrect') } })).status, 401);
    }
    assert.equal((await request(port, '/health', { headers: { Authorization: basic(password) } })).status, 200);
});

test('actual healthcheck executable succeeds only against owned authenticated server', { timeout: 25000 }, async t => {
    const reservation = net.createServer();
    try {
        await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(8000, '127.0.0.1', resolve); });
    } catch (error) {
        if (error.code === 'EADDRINUSE') return t.skip('Port 8000 is occupied; never query an unowned server');
        throw error;
    }
    await new Promise(resolve => reservation.close(resolve));
    const directory = await temporary(t);
    const password = 'synthetic-health-password';
    await launch(t, directory, { port: 8000, password });
    for (const [credential, expected] of [[password, 0], [undefined, 1], ['wrong', 1]]) {
        const result = await processRun('src/conversation/healthcheck.js', [], directory, credential).done;
        assert.equal(result.code, expected, result.output);
    }
});
