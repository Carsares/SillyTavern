/* global globalThis */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { setConfigFilePath } from '../src/util.js';

let validateUserDataRoot;
let extensionRouteHandler;
const tempRoots = [];

beforeAll(async () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    setConfigFilePath(path.resolve(testDirectory, '../config.yaml'));
    const users = await import('../src/users.js');
    validateUserDataRoot = users.validateUserDataRoot;
    extensionRouteHandler = users.router.stack
        .filter(layer => layer.regexp.test('/scripts/extensions/third-party/test.js'))
        .at(-1).handle;
});

afterEach(() => {
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function createTempRoot(prefix) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempRoots.push(root);
    return root;
}

describe('user data root validation', () => {
    test('accepts an existing user directory strictly below DATA_ROOT', async () => {
        const dataRoot = createTempRoot('st-user-data-');
        const userRoot = path.join(dataRoot, 'alice');
        fs.mkdirSync(userRoot);
        globalThis.DATA_ROOT = dataRoot;

        await expect(validateUserDataRoot(userRoot)).resolves.toBeUndefined();
    });

    test('rejects DATA_ROOT itself and lexical traversal outside it', async () => {
        const dataRoot = createTempRoot('st-user-data-');
        globalThis.DATA_ROOT = dataRoot;

        await expect(validateUserDataRoot(dataRoot)).rejects.toThrow('Invalid user data root');
        await expect(validateUserDataRoot(path.join(dataRoot, '..', 'escaped'))).rejects.toThrow('Invalid user data root');
    });

    test('rejects a user directory symlink that resolves outside DATA_ROOT', async () => {
        const dataRoot = createTempRoot('st-user-data-');
        const outsideRoot = createTempRoot('st-user-outside-');
        const linkedRoot = path.join(dataRoot, 'linked');
        fs.symlinkSync(outsideRoot, linkedRoot);
        globalThis.DATA_ROOT = dataRoot;

        await expect(validateUserDataRoot(linkedRoot)).rejects.toThrow('Invalid user data root');
    });
});

describe('extension file routing', () => {
    test('rejects a symlink that resolves outside the extension directory', async () => {
        const extensionRoot = createTempRoot('st-user-extensions-');
        const outsideRoot = createTempRoot('st-extension-outside-');
        const outsideFile = path.join(outsideRoot, 'secret.txt');
        const linkedFile = path.join(extensionRoot, 'linked.txt');
        fs.writeFileSync(outsideFile, 'secret');
        fs.symlinkSync(outsideFile, linkedFile);
        const response = {
            sendFile: jest.fn(),
            sendStatus: jest.fn(function (status) {
                this.statusCode = status;
                return this;
            }),
        };

        await extensionRouteHandler({
            params: ['linked.txt'],
            user: { directories: { extensions: extensionRoot } },
        }, response);

        expect(response.statusCode).toBe(403);
        expect(response.sendFile).not.toHaveBeenCalled();
    });
});
