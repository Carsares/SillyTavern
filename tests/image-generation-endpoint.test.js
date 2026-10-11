import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import express from 'express';
import { setConfigFilePath } from '../src/util.js';

let createImageGenerationRouter;

beforeAll(async () => {
    // secrets.js reads config.yaml when it is first imported.
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    ({ createImageGenerationRouter } = await import('../src/endpoints/image-generation.js'));
});

const KEY = 'sk-test-SECRET1234567890';
const SECOND_KEY = 'sk-second-0987654321';
const PROMPT = 'A private prompt about a silver dragon';
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64');
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const PUBLIC_ADDRESS = [{ address: '93.184.216.34', family: 4 }];
const OPENAI_URL = 'https://api.openai.com/v1/images/generations';

const harnesses = [];
/** Console output of one test, to prove that prompts and keys never reach the logs. */
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

function uuid() {
    return randomUUID();
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

/** Rejects like a real transport once the request signal aborts. */
function waitForAbort(request) {
    return new Promise((_resolve, reject) => {
        if (request.signal.aborted) {
            reject(request.signal.reason);
            return;
        }
        request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
    });
}

/** Answers each request with the handler of the first matching URL prefix. */
function byUrl(routes) {
    return async request => {
        const prefix = Object.keys(routes).find(candidate => request.url.startsWith(candidate));
        if (!prefix) {
            throw new Error('Unexpected request');
        }
        return routes[prefix](request);
    };
}

function openAiImages(...items) {
    return Response.json({ data: items });
}

function pngResponse(bytes = PNG_BYTES) {
    return new Response(bytes, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } });
}

function createUser(root, handle, secrets) {
    const userRoot = path.join(root, handle);
    fs.mkdirSync(userRoot, { recursive: true });
    if (secrets) {
        fs.writeFileSync(path.join(userRoot, 'secrets.json'), JSON.stringify(secrets));
    }
    return { profile: { handle }, directories: { root: userRoot, userImages: path.join(userRoot, 'user', 'images') } };
}

/**
 * Real Express app around the router. The injected fetch receives WHATWG Requests for both the provider call and image
 * downloads; `harness.provider` decides the answer per test.
 */
async function startHarness(options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-image-generation-'));
    const users = {
        alice: createUser(root, 'alice', {
            api_key_image_generation: [
                { id: 'key-1', value: KEY, label: 'main', active: true },
                { id: 'key-2', value: SECOND_KEY, label: 'second', active: false },
            ],
        }),
        bob: createUser(root, 'bob', null),
    };
    const harness = {
        root,
        users,
        provider: async () => { throw new Error('No provider response configured'); },
    };
    harness.fetch = jest.fn(async (request, init) => harness.provider(request, init));
    harness.lookup = jest.fn(async () => PUBLIC_ADDRESS);
    const router = createImageGenerationRouter({ fetch: harness.fetch, lookup: harness.lookup, ...options });

    const app = express();
    app.use(express.json());
    app.use((request, _response, next) => {
        request.user = users[request.get('x-test-user') ?? 'alice'];
        next();
    });
    app.use('/api/image-generation', router);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api/image-generation`;

    async function read(response) {
        const text = await response.text();
        return { status: response.status, body: text ? JSON.parse(text) : undefined, text };
    }
    harness.post = async (route, body, { user = 'alice', signal } = {}) => read(await fetch(`${base}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': user },
        body: JSON.stringify(body),
        signal,
    }));
    harness.get = async (requestId, { user = 'alice' } = {}) => read(await fetch(`${base}/requests/${requestId}`, { headers: { 'x-test-user': user } }));
    harness.generate = (body, requestOptions) => harness.post('/generate', {
        requestId: uuid(),
        provider: 'openai',
        model: 'gpt-image-1',
        characterName: 'Lia',
        prompt: PROMPT,
        ...body,
    }, requestOptions);
    harness.waitForStatus = async (requestId, status) => {
        for (let attempt = 0; attempt < 200; attempt++) {
            const result = await harness.get(requestId);
            if (result.body?.status === status) {
                return result;
            }
            await delay(10);
        }
        throw new Error(`Request did not reach ${status}`);
    };
    harness.close = async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(root, { recursive: true, force: true });
    };
    harnesses.push(harness);
    return harness;
}

function diskPath(harness, user, clientPath) {
    return path.join(harness.users[user].directories.root, ...clientPath.split('/').filter(Boolean));
}

function expectNoSecretsInLogs() {
    const output = logged.join('\n');
    expect(output).not.toContain(PROMPT);
    expect(output).not.toContain(KEY);
}

describe('POST /capabilities', () => {
    test('reports each P1 provider from the adapter tables without any network request', async () => {
        const harness = await startHarness();
        const openAiParameters = ['width', 'height', 'count', 'quality', 'style', 'outputFormat'];
        const cases = [
            { body: { provider: 'openai', model: 'gpt-image-1' }, api: 'openai-auxiliary', parameters: openAiParameters,
                limits: { countMax: 4, maxDimension: 4096, dimensionMultiple: null }, requiresBaseUrl: false, requiresKey: true },
            { body: { provider: 'openai-compatible', model: 'flux-dev', baseUrl: 'https://images.example.com/v1' }, api: 'openai-auxiliary', parameters: openAiParameters,
                limits: { countMax: 4, maxDimension: 4096, dimensionMultiple: null }, requiresBaseUrl: true, requiresKey: true },
            { body: { provider: 'google', model: 'gemini-2.5-flash-image' }, api: 'google-image', parameters: ['aspectRatio', 'imageSize', 'count'],
                limits: { countMax: 1, maxDimension: null, dimensionMultiple: null }, requiresBaseUrl: false, requiresKey: true },
            { body: { provider: 'google', model: 'imagen-4.0-generate-001' }, api: 'google-image', parameters: ['aspectRatio', 'count'],
                limits: { countMax: 4, maxDimension: null, dimensionMultiple: null }, requiresBaseUrl: false, requiresKey: true },
            { body: { provider: 'openrouter', model: 'google/gemini-2.5-flash-image' }, api: 'openrouter-image', parameters: ['aspectRatio', 'imageSize'],
                limits: { countMax: 1, maxDimension: null, dimensionMultiple: null }, requiresBaseUrl: false, requiresKey: true },
            { body: { provider: 'novelai', model: 'nai-diffusion-4-5-full' }, api: 'novelai-image',
                parameters: ['negativePrompt', 'width', 'height', 'count', 'seed', 'steps', 'scale', 'sampler', 'noiseSchedule', 'characters', 'useCoordinates'],
                limits: { countMax: 4, maxDimension: 4096, dimensionMultiple: 64 }, requiresBaseUrl: false, requiresKey: true },
            { body: { provider: 'automatic1111', model: 'sd_xl_base_1.0', baseUrl: 'http://127.0.0.1:7860' }, api: 'sd-webui-image',
                parameters: ['negativePrompt', 'width', 'height', 'count', 'seed', 'steps', 'scale', 'sampler'],
                limits: { countMax: 4, maxDimension: 4096, dimensionMultiple: null }, requiresBaseUrl: true, requiresKey: false },
        ];

        for (const { body, ...expected } of cases) {
            const result = await harness.post('/capabilities', body);
            expect(result.status).toBe(200);
            expect(result.body).toEqual({ supported: true, provider: body.provider, keySaved: true, ...expected });
            expect(result.text).not.toContain(KEY);
        }
        expect(harness.fetch).not.toHaveBeenCalled();
        expect(harness.lookup).not.toHaveBeenCalled();
    });

    test('rejects providers outside the whitelist and reports missing configuration or keys', async () => {
        const harness = await startHarness();

        for (const provider of ['horde', 'stability', 'no-such-provider']) {
            const result = await harness.post('/capabilities', { provider, model: 'x' });
            expect(result.status).toBe(400);
            expect(result.body).toEqual({ error: 'unsupported-provider', message: expect.any(String), outcome: 'not-charged' });
        }

        const missingBaseUrl = await harness.post('/capabilities', { provider: 'openai-compatible', model: 'flux-dev' });
        expect(missingBaseUrl.status).toBe(200);
        expect(missingBaseUrl.body).toMatchObject({ supported: false, reason: 'Explicit baseUrl required', requiresBaseUrl: true });

        const unknownSecret = await harness.post('/capabilities', { provider: 'openai', model: 'gpt-image-1', secretId: 'missing-id' });
        expect(unknownSecret.body).toMatchObject({ supported: true, keySaved: false });
        const noSecrets = await harness.post('/capabilities', { provider: 'openai', model: 'gpt-image-1' }, { user: 'bob' });
        expect(noSecrets.body).toMatchObject({ supported: true, keySaved: false });
        expect(harness.fetch).not.toHaveBeenCalled();
    });
});

describe('POST /generate', () => {
    test('saves an OpenAI base64 image under the character folder and returns the raw path', async () => {
        const harness = await startHarness();
        const calls = [];
        harness.provider = async request => {
            calls.push({ url: request.url, authorization: request.headers.get('authorization'), body: await request.json() });
            return openAiImages({ b64_json: PNG_BASE64 });
        };
        const requestId = uuid();

        const result = await harness.generate({ requestId, characterName: '莉亚', width: 1024, height: 1024, quality: 'high' });

        expect(result.status).toBe(200);
        expect(result.body).toEqual({
            requestId,
            status: 'completed',
            images: [{ path: expect.stringMatching(/^\/user\/images\/莉亚\/莉亚_\d{4}-\d{2}-\d{2}@\d{2}h\d{2}m\d{2}s_1\.png$/), mimeType: 'image/png', bytes: PNG_BYTES.length, width: 1, height: 1 }],
            provider: 'openai',
            model: 'gpt-image-1',
            elapsedMs: expect.any(Number),
            incomplete: 0,
        });
        // Raw path, not URL-encoded: Data Maid compares message references byte for byte.
        expect(result.text).toContain('/user/images/莉亚/');
        const saved = fs.readFileSync(diskPath(harness, 'alice', result.body.images[0].path));
        expect(saved.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
        expect(saved.equals(PNG_BYTES)).toBe(true);
        expect(calls).toEqual([{
            url: OPENAI_URL,
            authorization: `Bearer ${KEY}`,
            body: { model: 'gpt-image-1', prompt: PROMPT, size: '1024x1024', n: 1, quality: 'high' },
        }]);
        expectNoSecretsInLogs();
    });

    test('downloads URL results over public HTTPS and rejects a non-HTTPS URL', async () => {
        const harness = await startHarness();
        const downloads = [];
        let imageUrl = 'https://cdn.example.com/generated/out.png?sig=abc';
        harness.provider = byUrl({
            [OPENAI_URL]: () => openAiImages({ url: imageUrl }),
            'https://cdn.example.com/': request => {
                downloads.push({ url: request.url, authorization: request.headers.get('authorization') });
                return pngResponse();
            },
        });

        const downloaded = await harness.generate({});
        expect(downloaded.status).toBe(200);
        expect(downloaded.body.images).toHaveLength(1);
        expect(fs.readFileSync(diskPath(harness, 'alice', downloaded.body.images[0].path)).equals(PNG_BYTES)).toBe(true);
        expect(downloads).toEqual([{ url: imageUrl, authorization: null }]);
        expect(harness.lookup).toHaveBeenCalledWith('cdn.example.com', { all: true });

        harness.fetch.mockClear();
        harness.lookup.mockClear();
        imageUrl = 'http://cdn.example.com/generated/out.png';
        const rejected = await harness.generate({});
        expect(rejected.status).toBe(502);
        expect(rejected.body).toEqual({ error: 'image-download-failed', message: expect.any(String), outcome: 'charged' });
        expect(harness.fetch).toHaveBeenCalledTimes(1);
        expect(harness.lookup).not.toHaveBeenCalled();
        expect(logged.join('\n')).not.toContain('cdn.example.com');
    });

    test('reads the key by secretId and refuses an unknown id without calling the provider', async () => {
        const harness = await startHarness();
        const authorizations = [];
        harness.provider = byUrl({
            [OPENAI_URL]: request => {
                authorizations.push(request.headers.get('authorization'));
                return openAiImages({ b64_json: PNG_BASE64 });
            },
            'http://127.0.0.1:7860/sdapi/v1/txt2img': request => {
                authorizations.push(request.headers.get('authorization'));
                return Response.json({ images: [PNG_BASE64] });
            },
        });

        const unknown = await harness.generate({ secretId: 'missing-id' });
        expect(unknown.status).toBe(400);
        expect(unknown.body).toEqual({ error: 'secret-missing', message: expect.any(String), outcome: 'not-charged' });
        const noKey = await harness.generate({}, { user: 'bob' });
        expect(noKey.status).toBe(400);
        expect(noKey.body.error).toBe('secret-missing');
        expect(harness.fetch).not.toHaveBeenCalled();

        const second = await harness.generate({ secretId: 'key-2' });
        expect(second.status).toBe(200);
        // A local SD WebUI is the one provider that may run without a key.
        const local = await harness.generate({ provider: 'automatic1111', model: 'sd_xl_base_1.0', baseUrl: 'http://127.0.0.1:7860' }, { user: 'bob' });
        expect(local.status).toBe(200);
        expect(authorizations).toEqual([`Bearer ${SECOND_KEY}`, null]);
        expect(unknown.text + noKey.text + second.text).not.toContain(KEY);
        expect(logged.join('\n')).toContain('error=secret-missing');
        expectNoSecretsInLogs();
    });

    test('rejects parameters the provider does not implement before calling it', async () => {
        const harness = await startHarness();
        const requestId = uuid();

        const negative = await harness.generate({ requestId, negativePrompt: 'blurry' });
        expect(negative.status).toBe(400);
        expect(negative.body).toEqual({ error: 'invalid-request', message: expect.any(String), outcome: 'not-charged' });
        expect((await harness.get(requestId)).status).toBe(404);

        const invalid = [
            { unknownField: true },
            { requestId: 'not-a-uuid' },
            { prompt: '   ' },
            { prompt: 'x'.repeat(8001) },
            { width: 1024.5 },
            { outputFormat: 'gif' },
            { characterName: undefined },
            { provider: 'google', model: 'gemini-2.5-flash-image', count: 2 },
            { provider: 'openai-compatible', model: 'flux-dev' },
        ];
        for (const body of invalid) {
            const result = await harness.generate(body);
            expect(result.status).toBe(400);
            expect(result.body).toMatchObject({ error: 'invalid-request', outcome: 'not-charged' });
        }
        expect(harness.fetch).not.toHaveBeenCalled();
        expectNoSecretsInLogs();
    });

    test('maps a provider HTTP error to 502 with a redacted provider reason', async () => {
        const harness = await startHarness();
        harness.provider = async () => Response.json({ error: { message: `Incorrect API key provided: ${KEY}. Check your plan.` } }, { status: 400 });
        const requestId = uuid();

        const result = await harness.generate({ requestId });

        expect(result.status).toBe(502);
        expect(result.body).toEqual({ error: 'provider-http-error', message: 'The image provider returned HTTP 400.', detail: expect.any(String), outcome: 'unknown' });
        expect(result.body.detail).toContain('[REDACTED]');
        expect(result.text).not.toContain(KEY);
        const record = await harness.get(requestId);
        expect(record.body).toMatchObject({ requestId, status: 'failed', error: { error: 'provider-http-error', outcome: 'unknown' } });
        expect(record.text).not.toContain(KEY);
        expect(logged.join('\n')).toContain(`Request ${requestId} failed: provider=openai, model=gpt-image-1, error=provider-http-error (HTTP 400)`);
        expectNoSecretsInLogs();
    });

    test('maps network failures and the provider deadline', async () => {
        const harness = await startHarness({ timeoutMs: 100 });
        harness.provider = async () => { throw new TypeError(`connect ECONNREFUSED ${KEY}`); };
        const network = await harness.generate({});
        expect(network.status).toBe(502);
        expect(network.body).toEqual({ error: 'provider-network-error', message: expect.any(String), outcome: 'unknown' });

        harness.provider = request => waitForAbort(request);
        const timeout = await harness.generate({});
        expect(timeout.status).toBe(504);
        expect(timeout.body).toEqual({ error: 'provider-timeout', message: expect.any(String), outcome: 'unknown' });
        expectNoSecretsInLogs();
    });

    test('allows one request per user at a time and answers a pending retry with 202', async () => {
        const harness = await startHarness();
        const release = deferred();
        const called = deferred();
        harness.provider = async () => {
            called.resolve();
            await release.promise;
            return openAiImages({ b64_json: PNG_BASE64 });
        };
        const requestId = uuid();

        const first = harness.generate({ requestId });
        await called.promise;
        const busy = await harness.generate({});
        expect(busy.status).toBe(409);
        expect(busy.body).toEqual({ error: 'image-generation-busy', message: expect.any(String), outcome: 'not-charged' });
        const retry = await harness.generate({ requestId });
        expect(retry.status).toBe(202);
        expect(retry.body).toEqual({ requestId, status: 'pending', startedAt: expect.any(Number) });
        // Another user is not blocked by alice's request.
        const other = await harness.post('/capabilities', { provider: 'openai', model: 'gpt-image-1' }, { user: 'bob' });
        expect(other.status).toBe(200);

        release.resolve();
        expect((await first).status).toBe(200);
        expect(harness.fetch).toHaveBeenCalledTimes(1);
    });

    test('answers a repeated requestId from its record without calling the provider again', async () => {
        const harness = await startHarness();
        harness.provider = async () => openAiImages({ b64_json: PNG_BASE64 });
        const requestId = uuid();

        const first = await harness.generate({ requestId });
        const second = await harness.generate({ requestId });

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(second.body).toEqual(first.body);
        expect(harness.fetch).toHaveBeenCalledTimes(1);
        expect(fs.readdirSync(path.join(harness.users.alice.directories.userImages, 'Lia'))).toHaveLength(1);
    });

    test('keeps generating after the browser disconnects and stops only on cancel', async () => {
        const harness = await startHarness();
        let providerRequest;
        let release = deferred();
        let called = deferred();
        harness.provider = async request => {
            providerRequest = request;
            called.resolve();
            const outcome = await Promise.race([release.promise, waitForAbort(request)]);
            return outcome;
        };

        const disconnected = uuid();
        const client = new AbortController();
        const abandoned = harness.generate({ requestId: disconnected }, { signal: client.signal }).catch(error => error);
        await called.promise;
        client.abort();
        expect((await abandoned).name).toBe('AbortError');
        await delay(50);
        expect(providerRequest.signal.aborted).toBe(false);
        expect((await harness.get(disconnected)).body).toEqual({ requestId: disconnected, status: 'pending', startedAt: expect.any(Number) });

        release.resolve(openAiImages({ b64_json: PNG_BASE64 }));
        const recovered = await harness.waitForStatus(disconnected, 'completed');
        expect(recovered.body).toEqual({
            requestId: disconnected,
            status: 'completed',
            startedAt: expect.any(Number),
            images: [expect.objectContaining({ mimeType: 'image/png', width: 1, height: 1 })],
            incomplete: 0,
        });
        expect(fs.existsSync(diskPath(harness, 'alice', recovered.body.images[0].path))).toBe(true);

        release = deferred();
        called = deferred();
        const cancelledId = uuid();
        const waiting = harness.generate({ requestId: cancelledId, characterName: 'Cancelled' });
        await called.promise;
        const cancel = await harness.post('/cancel', { requestId: cancelledId });
        expect(cancel.status).toBe(200);
        expect(cancel.body).toEqual({ requestId: cancelledId, status: 'cancelled', outcome: 'unknown' });
        const original = await waiting;
        expect(original.status).toBe(409);
        expect(original.body).toEqual({ error: 'cancelled', message: expect.any(String), outcome: 'unknown' });
        expect(providerRequest.signal.aborted).toBe(true);
        expect((await harness.get(cancelledId)).body).toMatchObject({ requestId: cancelledId, status: 'cancelled', error: { error: 'cancelled', outcome: 'unknown' } });
        expect((await harness.post('/cancel', { requestId: cancelledId })).body).toEqual(cancel.body);
        expect(fs.existsSync(path.join(harness.users.alice.directories.userImages, 'Cancelled'))).toBe(false);

        // Cancelling a finished request returns its completed state unchanged; unknown ids are 404.
        const finished = await harness.post('/cancel', { requestId: disconnected });
        expect(finished.status).toBe(200);
        expect(finished.body).toMatchObject({ requestId: disconnected, status: 'completed' });
        expect((await harness.post('/cancel', { requestId: uuid() })).status).toBe(404);
        // The user may submit again right after a cancel.
        release = deferred();
        release.resolve(openAiImages({ b64_json: PNG_BASE64 }));
        expect((await harness.generate({})).status).toBe(200);
    });

    test('keeps hostile character names inside user/images with safe file names', async () => {
        const harness = await startHarness();
        harness.provider = async () => openAiImages({ b64_json: PNG_BASE64 });
        const userImages = harness.users.alice.directories.userImages;
        const cases = [
            { characterName: '../%evil#name', folder: '.._evil_name' },
            { characterName: '..', folder: 'generated' },
            { characterName: 'a/b\\c', folder: 'abc' },
            { characterName: '', folder: 'generated' },
        ];

        for (const { characterName, folder } of cases) {
            const result = await harness.generate({ characterName });
            expect(result.status).toBe(200);
            const clientPath = result.body.images[0].path;
            const segments = clientPath.split('/');
            expect(segments.slice(0, 4)).toEqual(['', 'user', 'images', folder]);
            expect(segments).toHaveLength(5);
            expect(segments[4]).toMatch(new RegExp(`^${folder.replace(/\./g, '\\.')}_\\d{4}-\\d{2}-\\d{2}@\\d{2}h\\d{2}m\\d{2}s_\\d+\\.png$`));
            expect(clientPath).not.toMatch(/[%#]/);
            const file = path.resolve(diskPath(harness, 'alice', clientPath));
            expect(path.relative(userImages, file).startsWith('..' + path.sep)).toBe(false);
            expect(path.dirname(file)).toBe(path.join(userImages, folder));
            expect(fs.existsSync(file)).toBe(true);
        }
        expect(fs.existsSync(path.join(harness.users.alice.directories.root, 'user', '%evil#name'))).toBe(false);
    });

    test('reports save-failed as charged when the image cannot be written', async () => {
        const harness = await startHarness();
        harness.provider = async () => openAiImages({ b64_json: PNG_BASE64 });
        const userImages = harness.users.alice.directories.userImages;
        fs.mkdirSync(userImages, { recursive: true });
        // A file where the character folder should be makes the directory creation fail.
        fs.writeFileSync(path.join(userImages, 'Lia'), 'not a directory');
        const requestId = uuid();

        const result = await harness.generate({ requestId });

        expect(result.status).toBe(500);
        expect(result.body).toEqual({ error: 'save-failed', message: expect.any(String), outcome: 'charged' });
        expect((await harness.get(requestId)).body).toMatchObject({ status: 'failed', error: { error: 'save-failed', outcome: 'charged' } });
        expectNoSecretsInLogs();
    });

    test('completes with an incomplete count when only some images can be saved', async () => {
        const harness = await startHarness();
        harness.provider = async () => openAiImages({ b64_json: PNG_BASE64 }, { b64_json: Buffer.from('not an image').toString('base64') });

        const result = await harness.generate({ count: 2 });

        expect(result.status).toBe(200);
        expect(result.body.images).toHaveLength(1);
        expect(result.body.incomplete).toBe(1);
    });
});

describe('GET /requests/:requestId', () => {
    test('is scoped to the user and expires finished records', async () => {
        let clock = Date.parse('2026-10-11T22:04:10');
        const harness = await startHarness({ now: () => clock, retentionMs: 1000, maxRecords: 2 });
        harness.provider = async () => openAiImages({ b64_json: PNG_BASE64 });
        const ids = [uuid(), uuid(), uuid()];

        expect((await harness.generate({ requestId: ids[0] })).status).toBe(200);
        expect((await harness.get(ids[0])).body).toMatchObject({ requestId: ids[0], status: 'completed', startedAt: clock });
        expect((await harness.get(ids[0], { user: 'bob' })).status).toBe(404);
        expect((await harness.get('not-a-uuid')).status).toBe(400);

        clock += 10;
        await harness.generate({ requestId: ids[1] });
        clock += 10;
        await harness.generate({ requestId: ids[2] });
        // maxRecords keeps the newest two.
        expect((await harness.get(ids[0])).status).toBe(404);
        expect((await harness.get(ids[1])).status).toBe(200);

        clock += 1000;
        expect((await harness.get(ids[2])).status).toBe(404);
    });
});
