import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

const fetchMock = jest.fn();

jest.unstable_mockModule('node-fetch', () => ({
    default: fetchMock,
}));

jest.unstable_mockModule('../src/util.js', () => ({
    clientRelativePath: (_root, file) => file,
    isValidUrl: () => true,
}));

jest.unstable_mockModule('../src/endpoints/content-manager.js', () => ({
    getHostFromUrl: () => 'assets.example.com',
    isHostWhitelisted: () => true,
}));

const tempRoots = [];
let downloadHandler;

beforeAll(async () => {
    const { router } = await import('../src/endpoints/assets.js');
    downloadHandler = router.stack.find(layer => layer.route?.path === '/download').route.stack.at(-1).handle;
});

beforeEach(() => {
    fetchMock.mockReset();
});

afterEach(() => {
    jest.restoreAllMocks();
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function createRequest(root, category, filename, url) {
    return {
        body: { category, filename, url },
        user: { directories: { assets: root } },
    };
}

function createResponse() {
    return {
        statusCode: 200,
        send: jest.fn(function () { return this; }),
        sendStatus: jest.fn(function (code) {
            this.statusCode = code;
            return this;
        }),
        setHeader: jest.fn(),
        status(code) {
            this.statusCode = code;
            return this;
        },
    };
}

function createDelayedResponse(content, delay) {
    const body = new PassThrough();
    setTimeout(() => body.end(content), delay);
    return { ok: true, body, statusText: 'OK' };
}

function createAssetsRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-assets-download-'));
    tempRoots.push(root);
    return root;
}

describe('asset downloads', () => {
    test('isolates concurrent downloads that use the same filename', async () => {
        const root = createAssetsRoot();
        fetchMock
            .mockImplementationOnce(async () => createDelayedResponse('first', 10))
            .mockImplementationOnce(async () => createDelayedResponse('second', 40));
        const firstResponse = createResponse();
        const secondResponse = createResponse();

        await Promise.all([
            downloadHandler(createRequest(root, 'bgm', 'shared.bin', 'https://assets.example.com/first'), firstResponse),
            downloadHandler(createRequest(root, 'ambient', 'shared.bin', 'https://assets.example.com/second'), secondResponse),
        ]);

        expect(firstResponse.statusCode).toBe(200);
        expect(secondResponse.statusCode).toBe(200);
        expect(fs.readFileSync(path.join(root, 'bgm', 'shared.bin'), 'utf8')).toBe('first');
        expect(fs.readFileSync(path.join(root, 'ambient', 'shared.bin'), 'utf8')).toBe('second');
        expect(fs.readdirSync(path.join(root, 'temp'))).toEqual([]);
    });

    test('cleans its temporary directory when final commit fails', async () => {
        const root = createAssetsRoot();
        fs.mkdirSync(path.join(root, 'bgm', 'blocked.bin'), { recursive: true });
        fetchMock.mockResolvedValue(createDelayedResponse('content', 0));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const response = createResponse();

        await downloadHandler(createRequest(root, 'bgm', 'blocked.bin', 'https://assets.example.com/blocked'), response);

        expect(response.statusCode).toBe(500);
        expect(fs.readdirSync(path.join(root, 'temp'))).toEqual([]);
    });
});
