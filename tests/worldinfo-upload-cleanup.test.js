import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

let importHandler;
let editHandler;
const tempRoots = [];

beforeAll(async () => {
    const { router } = await import('../src/endpoints/worldinfo.js');
    importHandler = router.stack.find(layer => layer.route?.path === '/import').route.stack[0].handle;
    editHandler = router.stack.find(layer => layer.route?.path === '/edit').route.stack[0].handle;
});

afterEach(() => {
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function createRequest(convertedData, overwrite = undefined, originalname = 'Imported.json') {
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
            body: { convertedData, overwrite },
            file: {
                destination: uploads,
                filename: 'temporary',
                originalname,
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

function createEditRequest(data) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-worldinfo-edit-'));
    const worlds = path.join(root, 'worlds');
    fs.mkdirSync(worlds);
    tempRoots.push(root);
    return {
        root,
        request: {
            body: { name: 'Existing', data },
            user: { directories: { worlds } },
        },
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

    test('rejects imported World Info with an array or null entries', () => {
        for (const convertedData of ['[]', '{"entries":null}']) {
            const { root, request } = createRequest(convertedData);
            const response = createResponse();

            importHandler(request, response);

            expect(response.statusCode).toBe(400);
            expect(fs.readdirSync(path.join(root, 'worlds'))).toEqual([]);
            expect(fs.existsSync(path.join(root, 'uploads', 'temporary'))).toBe(false);
        }
    });

    test('does not overwrite an existing world without explicit permission', () => {
        const { root, request } = createRequest(JSON.stringify({ entries: { imported: true } }));
        const worldPath = path.join(root, 'worlds', 'Imported.json');
        fs.writeFileSync(worldPath, JSON.stringify({ entries: { original: true } }));
        const response = createResponse();

        importHandler(request, response);

        expect(response.statusCode).toBe(409);
        expect(JSON.parse(fs.readFileSync(worldPath, 'utf8'))).toEqual({ entries: { original: true } });
        expect(fs.existsSync(path.join(root, 'uploads', 'temporary'))).toBe(false);
    });

    test('overwrites an existing world only when explicitly requested', () => {
        const imported = { entries: { imported: true } };
        const { root, request } = createRequest(JSON.stringify(imported), 'true');
        const worldPath = path.join(root, 'worlds', 'Imported.json');
        fs.writeFileSync(worldPath, JSON.stringify({ entries: { original: true } }));
        const response = createResponse();

        importHandler(request, response);

        expect(response.body).toEqual({ name: 'Imported' });
        expect(JSON.parse(fs.readFileSync(worldPath, 'utf8'))).toEqual(imported);
        expect(fs.existsSync(path.join(root, 'uploads', 'temporary'))).toBe(false);
    });

    test('overwrites the exact existing name selected by the client without creating a case variant', () => {
        const imported = { entries: { imported: true } };
        const { root, request } = createRequest(JSON.stringify(imported), 'true', 'Résumé.json');
        const worldPath = path.join(root, 'worlds', 'Résumé.json');
        fs.writeFileSync(worldPath, JSON.stringify({ entries: { original: true } }));
        const response = createResponse();

        importHandler(request, response);

        expect(response.body).toEqual({ name: 'Résumé' });
        expect(JSON.parse(fs.readFileSync(worldPath, 'utf8'))).toEqual(imported);
        expect(fs.readdirSync(path.join(root, 'worlds'))).toEqual(['Résumé.json']);
    });

    test('does not overwrite an existing World Info with an array or null entries', () => {
        for (const data of [[], { entries: null }]) {
            const { root, request } = createEditRequest(data);
            const worldPath = path.join(root, 'worlds', 'Existing.json');
            const original = { entries: { original: true } };
            fs.writeFileSync(worldPath, JSON.stringify(original));
            const response = createResponse();

            editHandler(request, response);

            expect(response.statusCode).toBe(400);
            expect(JSON.parse(fs.readFileSync(worldPath, 'utf8'))).toEqual(original);
        }
    });

    test('edits an existing World Info with a valid entries object', () => {
        const updated = { entries: { updated: true } };
        const { root, request } = createEditRequest(updated);
        const worldPath = path.join(root, 'worlds', 'Existing.json');
        fs.writeFileSync(worldPath, JSON.stringify({ entries: { original: true } }));
        const response = createResponse();

        editHandler(request, response);

        expect(response.body).toEqual({ ok: true });
        expect(JSON.parse(fs.readFileSync(worldPath, 'utf8'))).toEqual(updated);
    });
});
