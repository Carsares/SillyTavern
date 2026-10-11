import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

import { setConfigFilePath } from '../src/util.js';

// 1x1 PNG without any tEXt/zTXt/iTXt chunk: a valid image that carries no character card.
const PLAIN_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
// JPEG magic bytes saved under a .png name.
const JPEG_BYTES = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);

const tempRoots = [];
let importCharacterHandler;
let getCharacterImportErrorReason;

beforeAll(async () => {
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    const characters = await import('../src/endpoints/characters.js');
    getCharacterImportErrorReason = characters.getCharacterImportErrorReason;
    importCharacterHandler = characters.router.stack.find(layer => layer.route?.path === '/import').route.stack.at(-1).handle;
});

afterEach(() => {
    jest.restoreAllMocks();
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function createResponse() {
    const response = { statusCode: 200 };
    response.status = jest.fn(function (code) {
        this.statusCode = code;
        return this;
    });
    response.send = jest.fn(function () { return this; });
    response.sendStatus = jest.fn(function (code) {
        this.statusCode = code;
        return this;
    });
    return response;
}

async function importUpload(fileName, content, fileType) {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-character-import-'));
    tempRoots.push(root);
    fs.writeFileSync(path.join(root, fileName), content);
    const response = createResponse();

    await importCharacterHandler({
        body: { file_type: fileType },
        file: { destination: root, filename: fileName },
        user: { directories: {}, profile: { handle: 'test-user' } },
    }, response);

    return response;
}

describe('character import error reasons', () => {
    test('explains a PNG that carries no character card', async () => {
        const response = await importUpload('plain-image.png', PLAIN_PNG, 'png');

        expect(response.statusCode).toBe(200);
        expect(response.send).toHaveBeenCalledWith({ error: true, reason: 'no_card_data' });
    });

    test('explains a file with a .png name that is not a PNG image', async () => {
        const response = await importUpload('photo.png', JPEG_BYTES, 'png');

        expect(response.send).toHaveBeenCalledWith({ error: true, reason: 'invalid_png' });
    });

    test('explains a malformed JSON card', async () => {
        const response = await importUpload('broken.json', '{"name": ', 'json');

        expect(response.send).toHaveBeenCalledWith({ error: true, reason: 'invalid_json' });
    });

    test('explains an unsupported import format', async () => {
        const response = await importUpload('card.txt', 'not a card', 'txt');

        expect(response.send).toHaveBeenCalledWith({ error: true, reason: 'unsupported_format' });
    });

    test('maps parser failures without exposing their messages', () => {
        expect(getCharacterImportErrorReason(new Error('No PNG metadata.'), 'png')).toBe('no_card_data');
        expect(getCharacterImportErrorReason(new SyntaxError('Unexpected token'), 'png')).toBe('invalid_card_data');
        expect(getCharacterImportErrorReason(new Error('CRC values for IDAT header do not match, PNG file is likely corrupted'), 'png')).toBe('invalid_png');
        expect(getCharacterImportErrorReason(new Error('bad indentation'), 'yaml')).toBe('invalid_yaml');
        expect(getCharacterImportErrorReason(new Error('zip: missing card.json'), 'charx')).toBe('invalid_archive');
        expect(getCharacterImportErrorReason(new Error('EACCES: permission denied, open /secret/path'), 'png')).toBe('unknown');
    });
});
