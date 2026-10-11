import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

// Deterministic coverage for /api/content/importURL and /api/content/importUUID branch dispatch,
// without hitting any external vendor (node-fetch and chub.js are mocked).
const fetchMock = jest.fn();
const chubMocks = {
    downloadChubCharacter: jest.fn(async id => ({ buffer: Buffer.from('chub-character'), fileName: `${id.replace('/', '_')}.png`, fileType: 'image/png' })),
    downloadChubLorebook: jest.fn(async id => ({ buffer: Buffer.from('{}'), fileName: `${id.replace('/', '_')}.json`, fileType: 'application/json' })),
    parseChubUrl: jest.fn(url => (String(url).includes('lorebook') ? { type: 'lorebook', id: 'author/book' } : { type: 'character', id: 'author/char' })),
};

jest.unstable_mockModule('node-fetch', () => ({ default: fetchMock }));
jest.unstable_mockModule('../src/chub.js', () => chubMocks);

let importUrlHandler;
let importUuidHandler;

const FAKE_PNG = Buffer.from('\x89PNG fake character card payload');
// Minimal valid 1x1 PNG, used where the downloader embeds a card into a real image (e.g. perchance write())
const MINIMAL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

beforeAll(async () => {
    const { setConfigFilePath } = await import('../src/util.js');
    // Whitelist for the generic branch is read at module load from config.yaml (includes raw.githubusercontent.com)
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    const { router } = await import('../src/endpoints/content-manager.js');
    importUrlHandler = router.stack.find(layer => layer.route?.path === '/importURL').route.stack.at(-1).handle;
    importUuidHandler = router.stack.find(layer => layer.route?.path === '/importUUID').route.stack.at(-1).handle;
});

afterEach(() => {
    fetchMock.mockReset();
    Object.values(chubMocks).forEach(mock => mock.mockClear?.());
});

function toArrayBuffer(buffer) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function pngResponse(bytes = FAKE_PNG) {
    return { ok: true, status: 200, statusText: 'OK', arrayBuffer: async () => toArrayBuffer(bytes), text: async () => '', json: async () => ({}), headers: { get: () => 'image/png' } };
}

function jsonResponse(obj) {
    return { ok: true, status: 200, statusText: 'OK', json: async () => obj, text: async () => JSON.stringify(obj), arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => 'application/json' } };
}

// One URL-aware mock that serves every vendor branch's expected response shape
function useVendorFetch() {
    fetchMock.mockImplementation(async (url) => {
        const u = String(url);
        let response;
        if (u.includes('server.pygmalion.chat/api/export/character/')) {
            response = jsonResponse({ character: { data: { avatar: 'https://cdn.pyg.test/avatar.png' } } });
        } else if (u.includes('api.jannyai.com/api/v1/download')) {
            response = jsonResponse({ status: 'ok', downloadUrl: 'https://cdn.janny.test/card.png' });
        } else if (u.includes('user.uploads.dev/file/')) {
            // Perchance download is a gzipped JSON character; avatar is a base64 PNG so write() succeeds
            response = pngResponse(zlib.gzipSync(Buffer.from(JSON.stringify({
                name: 'Perchance',
                avatar: { url: `data:image/png;base64,${MINIMAL_PNG_BASE64}` },
                data: {},
            }))));
        } else {
            // Avatars and all direct-PNG branches (AICC / Risu / generic)
            response = pngResponse();
        }
        // node-fetch responses expose the resolved url; downloadGenericPng reads result.url
        response.url = u;
        return response;
    });
}

function makeResponse() {
    return {
        statusCode: 200,
        headers: {},
        body: undefined,
        sent: false,
        set(key, value) { this.headers[String(key).toLowerCase()] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        send(body) { this.body = body; this.sent = true; return this; },
        sendStatus(code) { this.statusCode = code; this.sent = true; return this; },
    };
}

async function callImportUrl(url) {
    const response = makeResponse();
    await importUrlHandler({ body: { url } }, response);
    return response;
}

async function callImportUuid(url) {
    const response = makeResponse();
    await importUuidHandler({ body: { url } }, response);
    return response;
}

function fetchedUrls() {
    return fetchMock.mock.calls.map(call => String(call[0]));
}

describe('content importURL branch dispatch', () => {
    test('returns 400 when no url is provided', async () => {
        const response = await callImportUrl(undefined);
        expect(response.statusCode).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('dispatches pygmalion.chat urls to the pygmalion export endpoint', async () => {
        useVendorFetch();
        const response = await callImportUrl('https://pygmalion.chat/character/12345678-1234-1234-1234-123456789abc');
        expect(fetchedUrls().some(u => u.includes('server.pygmalion.chat/api/export/character/12345678-1234-1234-1234-123456789abc'))).toBe(true);
        expect(response.statusCode).toBe(200);
        expect(response.headers['x-custom-content-type']).toBe('character');
    });

    test('dispatches janitorai urls to the jannyai download endpoint', async () => {
        useVendorFetch();
        const response = await callImportUrl('https://janitorai.com/characters/12345678-1234-1234-1234-123456789abc_some-name');
        expect(fetchedUrls().some(u => u.includes('api.jannyai.com/api/v1/download'))).toBe(true);
        expect(response.statusCode).toBe(200);
    });

    test('dispatches aicharactercards urls to the pngapi endpoint with author/card', async () => {
        useVendorFetch();
        const response = await callImportUrl('https://aicharactercards.com/character-cards/SomeAuthor/some-card');
        expect(fetchedUrls().some(u => u.includes('aicharactercards.com/wp-json/pngapi/v1/image/SomeAuthor/some-card'))).toBe(true);
        expect(response.statusCode).toBe(200);
    });

    test('dispatches realm.risuai.net urls to the risu png-v3 download endpoint', async () => {
        useVendorFetch();
        const uuid = '7adb0ed8d81855c820b3506980fb40f054ceef010ff0c4bab73730c0ebe92279';
        const response = await callImportUrl(`https://realm.risuai.net/character/${uuid}`);
        expect(fetchedUrls().some(u => u.includes(`realm.risuai.net/api/v1/download/png-v3/${uuid}`))).toBe(true);
        expect(response.statusCode).toBe(200);
    });

    test('dispatches perchance.org urls to the user.uploads.dev file endpoint using the slug', async () => {
        useVendorFetch();
        // Asserts slug parsing + branch dispatch; the perchance-internal gz/avatar/embed pipeline is not mocked here
        await callImportUrl('https://perchance.org/ai-character-chat?data=Personality_Advisor~6903e991c90fd1dba52c036d917e99c6.gz');
        expect(fetchedUrls().some(u => u.includes('user.uploads.dev/file/6903e991c90fd1dba52c036d917e99c6.gz'))).toBe(true);
    });

    test('dispatches whitelisted generic urls to a direct download', async () => {
        useVendorFetch();
        const genericUrl = 'https://raw.githubusercontent.com/some-org/some-repo/main/character.png';
        const response = await callImportUrl(genericUrl);
        expect(fetchedUrls().some(u => u === genericUrl)).toBe(true);
        expect(response.statusCode).toBe(200);
        expect(response.headers['x-custom-content-type']).toBe('character');
    });

    test('dispatches chub urls through the chub downloader', async () => {
        useVendorFetch();
        const response = await callImportUrl('https://chub.ai/characters/author/char');
        expect(chubMocks.parseChubUrl).toHaveBeenCalled();
        expect(chubMocks.downloadChubCharacter).toHaveBeenCalled();
        expect(response.statusCode).toBe(200);
        expect(response.headers['x-custom-content-type']).toBe('character');
    });

    test('returns 404 for a non-whitelisted domain', async () => {
        useVendorFetch();
        const response = await callImportUrl('https://not-whitelisted.example/character.png');
        expect(response.statusCode).toBe(404);
    });

    test('returns 404 when a pygmalion url has no extractable uuid', async () => {
        useVendorFetch();
        const response = await callImportUrl('https://pygmalion.chat/character/not-a-uuid');
        expect(response.statusCode).toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('content importUUID branch dispatch', () => {
    test('returns 400 when no url is provided', async () => {
        const response = await callImportUuid(undefined);
        expect(response.statusCode).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('dispatches a 36-char uuid to the pygmalion downloader', async () => {
        useVendorFetch();
        const response = await callImportUuid('12345678-1234-1234-1234-123456789abc');
        expect(fetchedUrls().some(u => u.includes('server.pygmalion.chat/api/export/character/'))).toBe(true);
        expect(response.statusCode).toBe(200);
    });

    test('dispatches a _character suffixed id to the jannyai downloader', async () => {
        useVendorFetch();
        const response = await callImportUuid('janny-character-id_character');
        expect(fetchedUrls().some(u => u.includes('api.jannyai.com/api/v1/download'))).toBe(true);
        expect(response.statusCode).toBe(200);
    });

    test('dispatches an AICC/ prefixed id to the aicharactercards downloader', async () => {
        useVendorFetch();
        const response = await callImportUuid('AICC/SomeAuthor/some-card');
        expect(fetchedUrls().some(u => u.includes('aicharactercards.com/wp-json/pngapi/v1/image/SomeAuthor/some-card'))).toBe(true);
        expect(response.statusCode).toBe(200);
    });

    test('dispatches a perchance-style id to the perchance downloader', async () => {
        useVendorFetch();
        // Asserts perchance-id detection + branch dispatch; the perchance-internal download pipeline is not mocked here
        await callImportUuid('Personality_Advisor~6903e991c90fd1dba52c036d917e99c6.gz');
        expect(fetchedUrls().some(u => u.includes('user.uploads.dev/file/6903e991c90fd1dba52c036d917e99c6.gz'))).toBe(true);
    });

    test('dispatches any other id to the chub downloader', async () => {
        useVendorFetch();
        const response = await callImportUuid('author/some-chub-character');
        expect(chubMocks.downloadChubCharacter).toHaveBeenCalledWith('author/some-chub-character');
        expect(response.statusCode).toBe(200);
    });
});
