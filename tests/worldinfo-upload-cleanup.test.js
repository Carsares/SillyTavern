import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

let importHandler;
const tempRoots = [];

beforeAll(async () => {
    const { router } = await import('../src/endpoints/worldinfo.js');
    importHandler = router.stack.find(layer => layer.route?.path === '/import').route.stack[0].handle;
});

afterEach(() => {
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function createRequest(convertedData) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-worldinfo-upload-'));
    const uploads = path.join(root, 'uploads');
    const worlds = path.join(root, 'worlds');
    fs.mkdirSync(uploads);
    fs.mkdirSync(worlds);
    const uploadPath = path.join(uploads, 'temporary');
    fs.writeFileSync(uploadPath, 'unused original upload');
    tempRoots.push(root);

    return {
        root,
        request: {
            body: { convertedData },
            file: {
                destination: uploads,
                filename: 'temporary',
                originalname: 'Imported.json',
                path: uploadPath,
            },
            user: { directories: { worlds } },
        },
    };
}

function createResponse() {
    return {
        statusCode: 200,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        send(body) {
            this.body = body;
            return this;
        },
        sendStatus: jest.fn(),
    };
}

describe('world info import upload cleanup', () => {
    test('removes the original upload when converted data is imported', () => {
        const { root, request } = createRequest(JSON.stringify({ entries: {} }));
        const response = createResponse();

        importHandler(request, response);

        expect(response.body).toEqual({ name: 'Imported' });
        expect(fs.existsSync(path.join(root, 'uploads', 'temporary'))).toBe(false);
        expect(fs.existsSync(path.join(root, 'worlds', 'Imported.json'))).toBe(true);
    });

    test('removes the original upload when converted data is invalid', () => {
        const { root, request } = createRequest('{invalid');
        const response = createResponse();

        importHandler(request, response);

        expect(response.statusCode).toBe(400);
        expect(fs.existsSync(path.join(root, 'uploads', 'temporary'))).toBe(false);
    });
});
