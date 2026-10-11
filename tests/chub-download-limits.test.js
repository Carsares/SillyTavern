import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

const fetchMock = jest.fn();
const writeMock = jest.fn(() => Buffer.from('encoded-card'));

jest.unstable_mockModule('node-fetch', () => ({ default: fetchMock }));
jest.unstable_mockModule('../src/character-card-parser.js', () => ({ write: writeMock }));

const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
let downloadChubCharacter;
let downloadChubLorebook;

beforeAll(async () => {
    ({ downloadChubCharacter, downloadChubLorebook } = await import('../src/chub.js'));
});

beforeEach(() => {
    jest.clearAllMocks();
});

function createBody(chunks) {
    const state = { consumed: 0, destroyed: false };
    const body = {
        destroy: jest.fn(() => {
            state.destroyed = true;
        }),
        async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) {
                if (state.destroyed) {
                    return;
                }
                state.consumed++;
                yield chunk;
            }
        },
    };
    return { body, state };
}

function createResponse(chunks, { contentLength, contentType = 'application/octet-stream', ok = true } = {}) {
    const stream = createBody(chunks);
    return {
        ...stream,
        response: {
            ok,
            statusText: ok ? 'OK' : 'Bad Request',
            body: stream.body,
            headers: {
                get(name) {
                    if (name.toLowerCase() === 'content-length') return contentLength ?? null;
                    if (name.toLowerCase() === 'content-type') return contentType;
                    return null;
                },
            },
        },
    };
}

function createJsonResponse(value, options = {}) {
    const buffer = Buffer.from(JSON.stringify(value));
    return createResponse([buffer], { contentLength: String(buffer.length), contentType: 'application/json', ...options });
}

function createLorebookMetadata() {
    return createJsonResponse({ node: { id: 123 } });
}

function createCharacterMetadata() {
    return createJsonResponse({
        node: {
            definition: {
                name: 'Bounded Character',
                personality: '',
                tavern_personality: '',
                scenario: '',
                first_message: '',
                example_dialogs: '',
                description: '',
                system_prompt: '',
                post_history_instructions: '',
                alternate_greetings: [],
                embedded_lorebook: undefined,
                extensions: {},
            },
            topics: [],
            max_res_url: 'https://avatars.example.com/character.png',
        },
    });
}

describe('Chub response body limits', () => {
    test('rejects a declared oversized lorebook before consuming its body', async () => {
        const download = createResponse([Buffer.alloc(1)], { contentLength: String(MAX_JSON_BYTES + 1) });
        fetchMock.mockResolvedValueOnce(createLorebookMetadata().response).mockResolvedValueOnce(download.response);

        await expect(downloadChubLorebook('lorebooks/author/book'))
            .rejects
            .toThrow(`Chub lorebook exceeds the ${MAX_JSON_BYTES} byte limit`);

        expect(download.state.consumed).toBe(0);
        expect(download.body.destroy).toHaveBeenCalledTimes(1);
    });

    test('accepts a lorebook exactly at the response budget', async () => {
        const download = createResponse([Buffer.alloc(MAX_JSON_BYTES)], { contentLength: String(MAX_JSON_BYTES), contentType: 'application/json' });
        fetchMock.mockResolvedValueOnce(createLorebookMetadata().response).mockResolvedValueOnce(download.response);

        const result = await downloadChubLorebook('lorebooks/author/book');

        expect(result.buffer.length).toBe(MAX_JSON_BYTES);
        expect(download.body.destroy).not.toHaveBeenCalled();
    });

    test('enforces actual lorebook bytes when Content-Length is understated', async () => {
        const download = createResponse([Buffer.alloc(MAX_JSON_BYTES), Buffer.alloc(1), Buffer.alloc(32)], { contentLength: '1' });
        fetchMock.mockResolvedValueOnce(createLorebookMetadata().response).mockResolvedValueOnce(download.response);

        await expect(downloadChubLorebook('lorebooks/author/book'))
            .rejects
            .toThrow(`Chub lorebook exceeds the ${MAX_JSON_BYTES} byte limit`);

        expect(download.state.consumed).toBe(2);
        expect(download.body.destroy).toHaveBeenCalledTimes(1);
    });

    test('accepts a chunked lorebook exactly at the response budget', async () => {
        const download = createResponse([Buffer.alloc(MAX_JSON_BYTES - 1), Buffer.alloc(1)], { contentType: 'application/json' });
        fetchMock.mockResolvedValueOnce(createLorebookMetadata().response).mockResolvedValueOnce(download.response);

        const result = await downloadChubLorebook('lorebooks/author/book');

        expect(result.buffer.length).toBe(MAX_JSON_BYTES);
        expect(download.state.consumed).toBe(2);
    });

    test('rejects oversized character metadata before requesting an image', async () => {
        const metadata = createResponse([Buffer.alloc(1)], { contentLength: String(MAX_JSON_BYTES + 1), contentType: 'application/json' });
        fetchMock.mockResolvedValueOnce(metadata.response);

        await expect(downloadChubCharacter('author/character'))
            .rejects
            .toThrow(`Chub character metadata exceeds the ${MAX_JSON_BYTES} byte limit`);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(writeMock).not.toHaveBeenCalled();
    });

    test('rejects an oversized character image before encoding the card', async () => {
        const image = createResponse([Buffer.alloc(1)], { contentLength: String(MAX_IMAGE_BYTES + 1), contentType: 'image/png' });
        fetchMock.mockResolvedValueOnce(createCharacterMetadata().response).mockResolvedValueOnce(image.response);

        await expect(downloadChubCharacter('author/character'))
            .rejects
            .toThrow(`Chub character image exceeds the ${MAX_IMAGE_BYTES} byte limit`);

        expect(image.state.consumed).toBe(0);
        expect(image.body.destroy).toHaveBeenCalledTimes(1);
        expect(writeMock).not.toHaveBeenCalled();
    });

    test('accepts and encodes a character image exactly at its response budget', async () => {
        const image = createResponse([Buffer.alloc(MAX_IMAGE_BYTES)], { contentLength: String(MAX_IMAGE_BYTES), contentType: 'image/png' });
        fetchMock.mockResolvedValueOnce(createCharacterMetadata().response).mockResolvedValueOnce(image.response);

        const result = await downloadChubCharacter('author/character');

        expect(writeMock).toHaveBeenCalledTimes(1);
        expect(writeMock.mock.calls[0][0].length).toBe(MAX_IMAGE_BYTES);
        expect(result.buffer).toEqual(Buffer.from('encoded-card'));
    });
});
