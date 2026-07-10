import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

jest.unstable_mockModule('../src/util.js', () => ({
    generateTimestamp: jest.fn(),
    getConfigValue: jest.fn((_key, defaultValue) => defaultValue),
    removeOldBackups: jest.fn(),
}));

jest.unstable_mockModule('../src/users.js', () => ({
    getAllUserHandles: jest.fn(),
    getUserDirectories: jest.fn(),
}));

let saveHandler;
const tempRoots = [];

beforeAll(async () => {
    const { router } = await import('../src/endpoints/settings.js');
    saveHandler = router.stack.find(layer => layer.route?.path === '/save').route.stack.at(-1).handle;
});

afterEach(() => {
    jest.restoreAllMocks();
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function createResponse() {
    return {
        statusCode: 200,
        send: jest.fn(function () { return this; }),
        sendStatus: jest.fn(function (code) {
            this.statusCode = code;
            return this;
        }),
    };
}

describe('settings save', () => {
    test('returns 500 when the settings file cannot be written', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-settings-save-'));
        const invalidRoot = path.join(root, 'not-a-directory');
        fs.writeFileSync(invalidRoot, 'file');
        tempRoots.push(root);
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const response = createResponse();

        saveHandler({ body: { theme: 'dark' }, user: { directories: { root: invalidRoot }, profile: { handle: 'user' } } }, response);

        expect(response.sendStatus).toHaveBeenCalledWith(500);
        expect(response.send).not.toHaveBeenCalled();
    });
});
