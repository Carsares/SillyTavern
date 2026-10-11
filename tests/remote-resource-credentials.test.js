import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.unstable_mockModule('../src/util.js', () => ({
    color: {
        green: text => text,
        red: text => text,
    },
    getConfigValue: jest.fn((_key, defaultValue) => defaultValue),
    uuidv4: jest.fn()
        .mockReturnValueOnce('old-secret-id')
        .mockReturnValueOnce('new-secret-id'),
}));

let getRemoteCredentialState;
let getRemoteCredentialValue;
let removeRemoteCredential;
let saveRemoteCredential;

beforeAll(async () => {
    ({ getRemoteCredentialState, getRemoteCredentialValue, removeRemoteCredential, saveRemoteCredential } = await import('../src/remote-resources/credentials.js'));
});

describe('remote resource credentials', () => {
    let root;
    let directories;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-remote-credentials-'));
        directories = {
            root,
            backups: path.join(root, 'backups'),
        };
        fs.mkdirSync(directories.backups);
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('removing a credential clears all saved versions instead of reactivating an older value', () => {
        saveRemoteCredential(directories, 'github-extensions', 'token', 'old-token');
        saveRemoteCredential(directories, 'github-extensions', 'token', 'new-token');

        removeRemoteCredential(directories, 'github-extensions', 'token');

        expect(getRemoteCredentialValue(directories, 'github-extensions', 'token')).toBe('');
        expect(getRemoteCredentialState(directories)['github-extensions'][0].active).toBe(false);
    });
});
