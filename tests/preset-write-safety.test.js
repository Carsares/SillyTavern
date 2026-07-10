import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

import { setConfigFilePath } from '../src/util.js';

const temporaryDirectories = [];
let router;

beforeAll(async () => {
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    ({ router } = await import('../src/endpoints/presets.js'));
});

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function getSaveHandler() {
    return router.stack.find(layer => layer.route?.path === '/save')?.route?.stack.at(-1)?.handle;
}

function createResponse() {
    const response = {};
    response.status = jest.fn(() => response);
    response.send = jest.fn(value => value);
    response.sendStatus = jest.fn(value => value);
    return response;
}

function createRequest(directory, body) {
    return {
        body,
        user: { directories: { openAI_Settings: directory } },
    };
}

describe('preset write safety', () => {
    test('create-only save rejects a sanitized-name collision without overwriting', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'st-preset-'));
        temporaryDirectories.push(directory);
        const handler = getSaveHandler();
        expect(handler).toBeDefined();

        const firstResponse = createResponse();
        handler(createRequest(directory, {
            apiId: 'openai',
            name: 'Preset /A',
            preset: { temperature: 0.4 },
            overwrite: false,
        }), firstResponse);
        expect(firstResponse.send).toHaveBeenCalledWith({ name: 'Preset A' });

        const secondResponse = createResponse();
        handler(createRequest(directory, {
            apiId: 'openai',
            name: 'Preset A',
            preset: { temperature: 0.9 },
            overwrite: false,
        }), secondResponse);
        expect(secondResponse.status).toHaveBeenCalledWith(409);
        expect(JSON.parse(fs.readFileSync(path.join(directory, 'Preset A.json'), 'utf8'))).toEqual({ temperature: 0.4 });
    });

    test('ordinary save keeps backward-compatible overwrite behavior', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'st-preset-'));
        temporaryDirectories.push(directory);
        fs.writeFileSync(path.join(directory, 'Preset.json'), JSON.stringify({ temperature: 0.4 }));
        const handler = getSaveHandler();
        const response = createResponse();

        handler(createRequest(directory, {
            apiId: 'openai',
            name: 'Preset',
            preset: { temperature: 0.9 },
        }), response);

        expect(response.send).toHaveBeenCalledWith({ name: 'Preset' });
        expect(JSON.parse(fs.readFileSync(path.join(directory, 'Preset.json'), 'utf8'))).toEqual({ temperature: 0.9 });
    });
});
