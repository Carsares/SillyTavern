import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import express from 'express';
import { setConfigFilePath } from '../src/util.js';

let createModelServicesRouter;
let SecretManager;

beforeAll(async () => {
    // secrets.js reads config.yaml when it is first imported.
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    ({ createModelServicesRouter } = await import('../src/endpoints/model-services.js'));
    ({ SecretManager } = await import('../src/endpoints/secrets.js'));
});

const ACTIVE_KEY = 'sk-active-CHATKEY1234567890';
const SERVICE_KEY = 'sk-service-TRANSLATE0987654321';
const PROMPT = 'A private line about the silver dragon';

const harnesses = [];
let logged;

beforeEach(() => {
    logged = [];
    for (const method of ['debug', 'info', 'log', 'warn', 'error']) {
        jest.spyOn(console, method).mockImplementation((...args) => {
            logged.push(args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
        });
    }
});

afterEach(async () => {
    for (const harness of harnesses.splice(0)) {
        await harness.close();
    }
    jest.restoreAllMocks();
});

function baseSettings(overrides = {}) {
    return {
        main_api: 'openai',
        oai_settings: { chat_completion_source: 'custom', custom_url: 'https://chat.example.test/v1', custom_model: 'chat-model' },
        extension_settings: {
            modelServices: {
                services: [
                    { id: 'svc-a', name: 'Service A', provider: 'custom', baseUrl: 'https://a.example.test/v1', secretId: 'key-a', defaultModel: 'model-a' },
                    { id: 'svc-b', name: 'Service B', provider: 'deepseek', secretId: 'key-missing', defaultModel: 'deepseek-chat' },
                ],
                scenes: { chat: { serviceId: '' }, translation: { serviceId: 'svc-a', model: 'translate-model', maxOutputTokens: 1024 } },
            },
        },
        ...overrides,
    };
}

function chatReply(content, finishReason = 'stop', extra = {}) {
    return Response.json({ choices: [{ message: { role: 'assistant', content, ...extra }, finish_reason: finishReason }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
}

async function startHarness(settings = baseSettings()) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-model-services-'));
    fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify(settings));
    fs.writeFileSync(path.join(root, 'secrets.json'), JSON.stringify({
        api_key_custom: [
            { id: 'key-active', value: ACTIVE_KEY, label: 'chat', active: true },
            { id: 'key-a', value: SERVICE_KEY, label: 'service a', active: false },
        ],
    }));
    const harness = {
        root,
        requests: [],
        provider: async () => chatReply('你好'),
    };
    harness.fetch = jest.fn(async request => {
        harness.requests.push({ url: request.url, authorization: request.headers.get('authorization'), body: JSON.parse(await request.clone().text()) });
        return harness.provider(request);
    });
    const app = express();
    app.use(express.json());
    app.use((request, _response, next) => {
        request.user = { profile: { handle: 'alice' }, directories: { root } };
        next();
    });
    app.use('/api/model-services', createModelServicesRouter({ fetch: harness.fetch }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    harness.port = server.address().port;
    const base = `http://127.0.0.1:${harness.port}/api/model-services`;
    harness.post = async (route, body) => {
        const response = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const text = await response.text();
        return { status: response.status, body: text ? JSON.parse(text) : undefined };
    };
    harness.close = async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
    };
    harnesses.push(harness);
    return harness;
}

const translateMessages = [
    { role: 'system', content: 'Translate into Simplified Chinese.' },
    { role: 'user', content: PROMPT },
];

function expectNoSecretsInLogs() {
    const output = logged.join('\n');
    expect(output).not.toContain(ACTIVE_KEY);
    expect(output).not.toContain(SERVICE_KEY);
    expect(output).not.toContain(PROMPT);
}

describe('model services: scene calls', () => {
    test('the translation scene uses its own service, model, output limit and key by id, not the active key', async () => {
        const harness = await startHarness();
        const result = await harness.post('/complete', { scene: 'translation', messages: translateMessages });

        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({ content: '你好', finishReason: 'stop', provider: 'custom', model: 'translate-model', service: { id: 'svc-a', implicit: false, followsChat: false } });
        expect(harness.requests).toHaveLength(1);
        expect(harness.requests[0].url).toBe('https://a.example.test/v1/chat/completions');
        expect(harness.requests[0].authorization).toBe(`Bearer ${SERVICE_KEY}`);
        expect(harness.requests[0].body).toMatchObject({ model: 'translate-model', max_tokens: 1024, stream: false });
        expect(harness.requests[0].body.messages).toEqual(translateMessages);
        expectNoSecretsInLogs();
    });

    test('a translation scene without a service follows the chat connection and its active key', async () => {
        const settings = baseSettings();
        settings.extension_settings.modelServices.scenes.translation = { serviceId: '', model: '', maxOutputTokens: 2048 };
        const harness = await startHarness(settings);
        const result = await harness.post('/complete', { scene: 'translation', messages: translateMessages });

        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({ model: 'chat-model', service: { implicit: true, followsChat: true } });
        expect(harness.requests[0].url).toBe('https://chat.example.test/v1/chat/completions');
        expect(harness.requests[0].authorization).toBe(`Bearer ${ACTIVE_KEY}`);
        expect(harness.requests[0].body.max_tokens).toBe(2048);
    });

    test('a shorter maxOutputTokens from the request is honored, a longer one is capped at the scene limit', async () => {
        const harness = await startHarness();
        await harness.post('/complete', { scene: 'translation', messages: translateMessages, maxOutputTokens: 300 });
        await harness.post('/complete', { scene: 'translation', messages: translateMessages, maxOutputTokens: 99999 });
        expect(harness.requests.map(request => request.body.max_tokens)).toEqual([300, 1024]);
    });

    test('a truncated reply is reported as finishReason length', async () => {
        const harness = await startHarness();
        harness.provider = async () => chatReply('半截', 'length');
        const result = await harness.post('/complete', { scene: 'translation', messages: translateMessages });
        expect(result.body).toMatchObject({ content: '半截', finishReason: 'length' });
    });

    test('a reasoning-only reply says so without returning the reasoning text', async () => {
        const harness = await startHarness();
        harness.provider = async () => chatReply('', 'stop', { reasoning_content: 'thinking about the dragon' });
        const result = await harness.post('/complete', { scene: 'translation', messages: translateMessages });
        expect(result.body).toMatchObject({ content: '', hasReasoning: true });
        expect(JSON.stringify(result.body)).not.toContain('thinking about the dragon');
    });

    test('a provider error keeps a short redacted reason and never echoes the key', async () => {
        const harness = await startHarness();
        harness.provider = async () => Response.json({ error: { message: `Invalid key ${SERVICE_KEY}` } }, { status: 401 });
        const result = await harness.post('/complete', { scene: 'translation', messages: translateMessages });

        expect(result.status).toBe(502);
        expect(result.body).toMatchObject({ error: 'provider-http-error', message: 'The model service returned HTTP 401.' });
        expect(result.body.detail).toContain('Invalid key');
        expect(JSON.stringify(result.body)).not.toContain(SERVICE_KEY);
        expectNoSecretsInLogs();
    });

    test('a service whose key id is gone fails before any request, without falling back to the active key', async () => {
        const settings = baseSettings();
        settings.extension_settings.modelServices.scenes.translation = { serviceId: 'svc-b', model: '', maxOutputTokens: 1024 };
        const harness = await startHarness(settings);
        const result = await harness.post('/complete', { scene: 'translation', messages: translateMessages });

        expect(result.status).toBe(400);
        expect(result.body.error).toBe('secret-missing');
        expect(harness.fetch).not.toHaveBeenCalled();
    });

    test('scenes without a usable service, unknown scenes and bad messages are rejected', async () => {
        const settings = baseSettings({ main_api: 'textgenerationwebui' });
        settings.extension_settings.modelServices.scenes.translation = { serviceId: '', model: '', maxOutputTokens: 1024 };
        const harness = await startHarness(settings);

        expect((await harness.post('/complete', { scene: 'translation', messages: translateMessages })).body.error).toBe('scene-not-configured');
        expect((await harness.post('/complete', { scene: 'summary', messages: translateMessages })).body.error).toBe('scene-not-configured');
        expect((await harness.post('/complete', { scene: 'translation', messages: [] })).body.error).toBe('invalid-request');
        expect((await harness.post('/complete', { scene: 'translation', messages: [{ role: 'tool', content: 'x' }] })).body.error).toBe('invalid-request');
        expect(harness.fetch).not.toHaveBeenCalled();
    });

    test('the provider call is cancelled when the caller disconnects, and only then', async () => {
        const harness = await startHarness();
        let upstreamAborted;
        let reachedProvider;
        const providerReached = new Promise(resolve => { reachedProvider = resolve; });
        harness.provider = request => new Promise((_resolve, reject) => {
            upstreamAborted = new Promise(resolve => request.signal.addEventListener('abort', () => resolve(true)));
            request.signal.addEventListener('abort', () => reject(request.signal.reason));
            reachedProvider();
        });
        const caller = new AbortController();
        const pending = fetch(`http://127.0.0.1:${harness.port}/api/model-services/complete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ scene: 'translation', messages: translateMessages }),
            signal: caller.signal,
        }).catch(error => error);
        await providerReached;
        caller.abort();
        await pending;
        await expect(upstreamAborted).resolves.toBe(true);
    });

    test('a removed service referenced by the scene is reported', async () => {
        const settings = baseSettings();
        settings.extension_settings.modelServices.scenes.translation = { serviceId: 'svc-gone', model: 'x', maxOutputTokens: 1024 };
        const harness = await startHarness(settings);
        expect((await harness.post('/complete', { scene: 'translation', messages: translateMessages })).body.error).toBe('service-not-found');
    });
});

describe('model services: testing a service', () => {
    test('tests a saved service with its default model and a small reply budget', async () => {
        const harness = await startHarness();
        harness.provider = async () => chatReply('OK');
        const result = await harness.post('/test', { serviceId: 'svc-a' });

        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({ content: 'OK', model: 'model-a' });
        expect(harness.requests[0].authorization).toBe(`Bearer ${SERVICE_KEY}`);
        expect(harness.requests[0].body.max_tokens).toBe(256);
    });

    test('an unknown service is a 404', async () => {
        const harness = await startHarness();
        const result = await harness.post('/test', { serviceId: 'nope' });
        expect(result.status).toBe(404);
        expect(result.body.error).toBe('service-not-found');
    });
});

describe('secrets written for a model service', () => {
    test('activate:false keeps the active entry of the key, the first entry of a key is still active', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-model-services-secrets-'));
        try {
            const manager = new SecretManager({ root });
            const first = manager.writeSecret('api_key_custom', 'first', 'first', { activate: false });
            const second = manager.writeSecret('api_key_custom', 'second', 'second', { activate: false });
            const third = manager.writeSecret('api_key_custom', 'third', 'third');
            const entries = JSON.parse(fs.readFileSync(path.join(root, 'secrets.json'), 'utf8')).api_key_custom;
            expect(entries.map(entry => [entry.id, entry.active])).toEqual([[first, false], [second, false], [third, true]]);
            expect(manager.readSecret('api_key_custom', second)).toBe('second');

            const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'st-model-services-secrets-'));
            try {
                const other = new SecretManager({ root: fresh });
                other.writeSecret('api_key_deepseek', 'only', 'only', { activate: false });
                expect(JSON.parse(fs.readFileSync(path.join(fresh, 'secrets.json'), 'utf8')).api_key_deepseek[0].active).toBe(true);
            } finally {
                fs.rmSync(fresh, { recursive: true, force: true });
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
