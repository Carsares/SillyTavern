/* global globalThis */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, test } from '@jest/globals';
import { setConfigFilePath } from '../src/util.js';

let validateUserDataRoot;
const tempRoots = [];

beforeAll(async () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    setConfigFilePath(path.resolve(testDirectory, '../config.yaml'));
    ({ validateUserDataRoot } = await import('../src/users.js'));
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
