/* global globalThis */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { unzipSync } from 'fflate';
import { setConfigFilePath } from '../src/util.js';

let createBackupArchive;
const tempRoots = [];

beforeAll(async () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    setConfigFilePath(path.resolve(testDirectory, '../config.yaml'));
    // Pin the default regardless of the local config.yaml; secrets.js reads it once on import.
    process.env.SILLYTAVERN_ALLOWKEYSEXPOSURE = 'false';
    ({ createBackupArchive } = await import('../src/users.js'));
});

afterEach(() => {
    for (const root of tempRoots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

function writeFile(root, relativePath, content) {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function createResponse() {
    const response = new PassThrough();
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.attachment = jest.fn();
    response.status = jest.fn(() => ({ send: jest.fn() }));
    const archive = new Promise((resolve, reject) => {
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
    });
    return { response, archive };
}

describe('account backup archive', () => {
    test('leaves out secrets and the Agent workspace when keys may not be exposed', async () => {
        const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'st-user-backup-'));
        tempRoots.push(dataRoot);
        globalThis.DATA_ROOT = dataRoot;
        const handle = 'backup-alice';
        const userRoot = path.join(dataRoot, handle);
        writeFile(userRoot, 'settings.json', '{}');
        writeFile(userRoot, 'chats/Alice/chat.jsonl', '{}\n');
        writeFile(userRoot, 'secrets.json', '{"api_key_openai":"sk-secret"}');
        writeFile(userRoot, 'backups/secrets_migration_1.json', '{"api_key_openai":"sk-secret"}');
        for (const file of ['store.sqlite', 'store.sqlite-wal', 'store.sqlite-shm', '.writer.lock', 'media/attachment.bin']) {
            writeFile(userRoot, path.join('conversation-v1', file), 'sk-secret');
        }

        const { response, archive } = createResponse();
        await createBackupArchive(handle, response);
        const entries = Object.keys(unzipSync(new Uint8Array(await archive)));

        expect(response.attachment).toHaveBeenCalledWith(expect.stringMatching(/^backup-alice-.+\.zip$/));
        expect(entries).toEqual(expect.arrayContaining(['settings.json', 'chats/Alice/chat.jsonl']));
        expect(entries.filter(entry => entry.startsWith('conversation-v1') || entry.includes('secrets'))).toEqual([]);
    });
});
