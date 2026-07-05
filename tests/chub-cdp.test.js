/* eslint-disable playwright/expect-expect */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import { searchChubViaCdp } from '../src/remote-resources/chub-cdp.js';

const require = createRequire(import.meta.url);
const wsModulePath = require.resolve('ws');

test('Chub CDP launches and closes a fresh headless Chrome process for each search', async () => {
    await withFakeChrome(async ({ tempRoot, logPath }) => {
        const [first, second] = await Promise.all([
            searchChubViaCdp({ query: 'cat', resourceType: 'character', limit: 1 }, { directories: { root: tempRoot } }),
            searchChubViaCdp({ query: 'dog', resourceType: 'character', limit: 1 }, { directories: { root: tempRoot } }),
        ]);

        assert.equal(first.items.length, 1);
        assert.equal(second.items.length, 1);
        assert.equal(first.items[0].title, 'Fake characters result');
        assert.equal(second.items[0].title, 'Fake characters result');

        const events = readJsonLines(logPath);
        const starts = events.filter(event => event.type === 'start');
        const closes = events.filter(event => event.type === 'browser-close');
        const exits = events.filter(event => event.type === 'exit');

        assert.equal(starts.length, 2);
        assert.equal(closes.length, 2);
        assert.equal(exits.length, 2);
        assert.notEqual(starts[0].pid, starts[1].pid);
        assert.deepEqual(events.map(event => event.type), ['start', 'browser-close', 'exit', 'start', 'browser-close', 'exit']);
        assert.ok(fs.readdirSync(path.join(tempRoot, 'remote-resources')).every(name => !name.startsWith('chub-headless-')));
    });
});

test('Chub CDP launches and closes one fresh headless Chrome process for each search invocation', async () => {
    await withFakeChrome(async ({ tempRoot, logPath }) => {
        const result = await searchChubViaCdp({ query: 'pony', limit: 2 }, { directories: { root: tempRoot } });

        assert.equal(result.items.length, 2);
        assert.equal(result.total, 2);
        assert.deepEqual(result.items.map(item => item.title), ['Fake characters result', 'Fake lorebooks result']);

        const events = readJsonLines(logPath);
        const starts = events.filter(event => event.type === 'start');
        const closes = events.filter(event => event.type === 'browser-close');
        const exits = events.filter(event => event.type === 'exit');

        assert.equal(starts.length, 1);
        assert.equal(closes.length, 1);
        assert.equal(exits.length, 1);
        assert.deepEqual(events.map(event => event.type), ['start', 'browser-close', 'exit']);
        assert.ok(fs.readdirSync(path.join(tempRoot, 'remote-resources')).every(name => !name.startsWith('chub-headless-')));
    });
});

async function withFakeChrome(callback) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chub-cdp-test-'));
    const logPath = path.join(tempRoot, 'fake-chrome.jsonl');
    const chromePath = path.join(tempRoot, 'fake-chrome.mjs');
    const port = await getFreePort();
    const originalChromePath = process.env.SILLYTAVERN_CHUB_CHROME_PATH;
    const originalCdpPort = process.env.SILLYTAVERN_CHUB_CDP_PORT;
    const originalLogPath = process.env.SILLYTAVERN_FAKE_CHROME_LOG;

    fs.writeFileSync(chromePath, buildFakeChromeScript(wsModulePath), { mode: 0o755 });
    process.env.SILLYTAVERN_CHUB_CHROME_PATH = chromePath;
    process.env.SILLYTAVERN_CHUB_CDP_PORT = String(port);
    process.env.SILLYTAVERN_FAKE_CHROME_LOG = logPath;

    try {
        await callback({ tempRoot, logPath });
    } finally {
        restoreEnv('SILLYTAVERN_CHUB_CHROME_PATH', originalChromePath);
        restoreEnv('SILLYTAVERN_CHUB_CDP_PORT', originalCdpPort);
        restoreEnv('SILLYTAVERN_FAKE_CHROME_LOG', originalLogPath);
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

async function getFreePort() {
    return await new Promise((resolve, reject) => {
        const server = http.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close(error => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(address.port);
            });
        });
    });
}

function readJsonLines(file) {
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function restoreEnv(key, value) {
    if (value === undefined) {
        delete process.env[key];
        return;
    }
    process.env[key] = value;
}

function buildFakeChromeScript(wsPath) {
    return `#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { WebSocketServer } = require(${JSON.stringify(wsPath)});
const portArg = process.argv.find(arg => arg.startsWith('--remote-debugging-port='));
const port = Number(portArg?.split('=')[1]);
const logPath = process.env.SILLYTAVERN_FAKE_CHROME_LOG;
const targets = new Map();
let nextTargetId = 0;

function log(type, extra = {}) {
    fs.appendFileSync(logPath, JSON.stringify({ type, pid: process.pid, ...extra }) + '\\n');
}

function writeJson(response, payload) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
}

const server = http.createServer((request, response) => {
    if (request.url === '/json/version') {
        writeJson(response, { webSocketDebuggerUrl: \`ws://127.0.0.1:\${port}/browser\` });
        return;
    }
    if (request.url === '/json/list') {
        writeJson(response, Array.from(targets.values()));
        return;
    }
    response.writeHead(404);
    response.end();
});

const webSockets = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
    webSockets.handleUpgrade(request, socket, head, webSocket => webSockets.emit('connection', webSocket, request));
});

webSockets.on('connection', (webSocket, request) => {
    const pathname = new URL(request.url, \`http://127.0.0.1:\${port}\`).pathname;
    webSocket.on('message', rawMessage => {
        const message = JSON.parse(rawMessage.toString());
        const sendResult = result => webSocket.send(JSON.stringify({ id: message.id, result }));

        if (pathname === '/browser') {
            handleBrowserMethod(message, sendResult);
            return;
        }

        handlePageMethod(webSocket, message, sendResult);
    });
});

function handleBrowserMethod(message, sendResult) {
    if (message.method === 'Target.createTarget') {
        const id = \`target-\${++nextTargetId}\`;
        targets.set(id, { id, webSocketDebuggerUrl: \`ws://127.0.0.1:\${port}/page/\${id}\` });
        sendResult({ targetId: id });
        return;
    }
    if (message.method === 'Target.closeTarget') {
        targets.delete(message.params?.targetId);
        sendResult({});
        return;
    }
    if (message.method === 'Storage.setCookies') {
        sendResult({});
        return;
    }
    if (message.method === 'Browser.close') {
        log('browser-close');
        sendResult({});
        setTimeout(closeAndExit, 350);
        return;
    }
    sendResult({});
}

function handlePageMethod(webSocket, message, sendResult) {
    if (message.method === 'Page.navigate') {
        const namespace = message.params?.url?.includes('/lorebooks') ? 'lorebooks' : 'characters';
        const requestId = \`request-\${namespace}\`;
        sendResult({});
        setTimeout(() => {
            webSocket.send(JSON.stringify({
                method: 'Network.responseReceived',
                params: { requestId, response: { status: 200, url: \`https://ro.chub.ai/search?namespace=\${namespace}\` } },
            }));
            webSocket.send(JSON.stringify({ method: 'Network.loadingFinished', params: { requestId } }));
        }, 10);
        return;
    }
    if (message.method === 'Network.getResponseBody') {
        const namespace = String(message.params?.requestId || '').includes('lorebooks') ? 'lorebooks' : 'characters';
        sendResult({
            body: JSON.stringify({
                data: {
                    count: 1,
                    nodes: [{ fullPath: namespace === 'lorebooks' ? 'lorebooks/fake/result' : 'fake/result', name: \`Fake \${namespace} result\` }],
                },
            }),
        });
        return;
    }
    sendResult({});
}

function closeAndExit() {
    for (const client of webSockets.clients) {
        client.close();
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
}

process.on('exit', () => log('exit'));
process.on('SIGTERM', () => closeAndExit());
process.on('SIGINT', () => closeAndExit());
server.listen(port, '127.0.0.1', () => log('start', { port }));
`;
}
