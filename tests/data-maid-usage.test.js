import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

let collectStorageUsage;
let usageHandler;
const tempDirectories = [];

beforeAll(async () => {
    const { setConfigFilePath } = await import('../src/util.js');
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    ({ collectStorageUsage } = await import('../src/data-usage.js'));
    const dataMaid = await import('../src/endpoints/data-maid.js');
    usageHandler = dataMaid.router.stack.find(layer => layer.route?.path === '/usage').route.stack[0].handle;
});

afterEach(() => {
    jest.restoreAllMocks();
    for (const directory of tempDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function tempDirectory(prefix) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirectories.push(directory);
    return directory;
}

/** Mirrors the user directory layout of `USER_DIRECTORY_TEMPLATE`, including the nested `user/images` and `thumbnails/*`. */
function createUserDirectories() {
    const root = tempDirectory('sillytavern-usage-');
    const relative = {
        thumbnails: 'thumbnails',
        thumbnailsBg: 'thumbnails/bg',
        thumbnailsAvatar: 'thumbnails/avatar',
        thumbnailsPersona: 'thumbnails/persona',
        user: 'user',
        userImages: 'user/images',
        files: 'user/files',
        comfyWorkflows: 'user/workflows',
        chats: 'chats',
        groupChats: 'group chats',
        characters: 'characters',
        backups: 'backups',
    };
    const directories = { root };
    for (const [key, value] of Object.entries(relative)) {
        directories[key] = path.join(root, value);
        fs.mkdirSync(directories[key], { recursive: true });
    }
    return directories;
}

function write(filePath, size) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.alloc(size, 1));
}

function entryOf(usage, key) {
    return usage.entries.find(entry => entry.key === key);
}

describe('storage usage', () => {
    test('counts bytes and files per directory, each file once, and puts loose root files under "other"', async () => {
        const directories = createUserDirectories();
        write(path.join(directories.characters, 'a.png'), 100);
        write(path.join(directories.chats, 'Alice', 'one.jsonl'), 30);
        write(path.join(directories.chats, 'Alice', 'two.jsonl'), 20);
        write(path.join(directories.userImages, 'x', 'i.png'), 7);
        write(path.join(directories.files, 'f.txt'), 5);
        write(path.join(directories.user, 'extra.bin'), 3);
        write(path.join(directories.thumbnailsAvatar, 't.jpg'), 11);
        write(path.join(directories.root, 'settings.json'), 13);
        write(path.join(directories.root, 'cache', 'c.bin'), 17);

        const usage = await collectStorageUsage(directories);

        expect(entryOf(usage, 'characters')).toMatchObject({ bytes: 100, files: 1 });
        expect(entryOf(usage, 'chats')).toMatchObject({ bytes: 50, files: 2 });
        // user/images and user/files are reported on their own, not again inside "user"
        expect(entryOf(usage, 'userImages')).toMatchObject({ bytes: 7, files: 1 });
        expect(entryOf(usage, 'files')).toMatchObject({ bytes: 5, files: 1 });
        expect(entryOf(usage, 'user')).toMatchObject({ bytes: 3, files: 1 });
        expect(entryOf(usage, 'thumbnailsAvatar')).toMatchObject({ bytes: 11, files: 1 });
        expect(entryOf(usage, 'thumbnails')).toMatchObject({ bytes: 0, files: 0 });
        expect(entryOf(usage, 'other')).toMatchObject({ bytes: 30, files: 2 });
        expect(usage.totalBytes).toBe(100 + 50 + 7 + 5 + 3 + 11 + 30);
        expect(usage.totalFiles).toBe(1 + 2 + 1 + 1 + 1 + 1 + 2);
        expect(usage.truncated).toBe(false);
    });

    test('reports a directory that does not exist as missing and measures free space when the platform allows it', async () => {
        const directories = createUserDirectories();
        fs.rmSync(directories.groupChats, { recursive: true });

        const usage = await collectStorageUsage(directories);

        expect(entryOf(usage, 'groupChats')).toMatchObject({ bytes: 0, files: 0, missing: true });
        // statfs may be unavailable (null); when it is there the numbers must make sense
        expect(usage.disk === null || (usage.disk.freeBytes > 0 && usage.disk.totalBytes >= usage.disk.freeBytes)).toBe(true);
    });

    test('does not follow symbolic links to files or directories, nor a linked listed directory', async () => {
        const directories = createUserDirectories();
        const outside = tempDirectory('sillytavern-usage-outside-');
        write(path.join(outside, 'big.bin'), 5000);
        write(path.join(outside, 'nested', 'bigger.bin'), 6000);
        write(path.join(directories.characters, 'real.png'), 10);
        fs.symlinkSync(path.join(outside, 'big.bin'), path.join(directories.characters, 'link-to-file.png'));
        fs.symlinkSync(path.join(outside, 'nested'), path.join(directories.characters, 'link-to-dir'));
        // A listed directory that is itself a link is not entered
        fs.rmSync(directories.backups, { recursive: true });
        fs.symlinkSync(outside, directories.backups);
        // A link at the user root is not entered either
        fs.symlinkSync(outside, path.join(directories.root, 'linked-root-dir'));

        const usage = await collectStorageUsage(directories);

        expect(entryOf(usage, 'characters')).toMatchObject({ bytes: 10, files: 1, symlinks: 2 });
        expect(entryOf(usage, 'backups')).toMatchObject({ bytes: 0, files: 0, symlinks: 1 });
        expect(entryOf(usage, 'other')).toMatchObject({ bytes: 0, files: 0, symlinks: 1 });
        expect(usage.totalBytes).toBe(10);
    });

    test('stops at the entry limit and marks the result as a lower bound', async () => {
        const directories = createUserDirectories();
        for (let index = 0; index < 40; index++) {
            write(path.join(directories.chats, 'Alice', `chat-${index}.jsonl`), 1);
        }

        const usage = await collectStorageUsage(directories, { maxEntries: 10 });

        expect(usage.truncated).toBe(true);
        expect(entryOf(usage, 'chats').truncated).toBe(true);
        expect(usage.totalFiles).toBeLessThan(40);
        expect(usage.limits.maxEntries).toBe(10);
    });

    test('stops at the time limit', async () => {
        const directories = createUserDirectories();
        write(path.join(directories.chats, 'Alice', 'one.jsonl'), 1);
        let clock = 1000;
        const now = () => {
            clock += 600;
            return clock;
        };

        const usage = await collectStorageUsage(directories, { timeoutMs: 1000, now });

        expect(usage.truncated).toBe(true);
    });
});

describe('storage usage endpoint', () => {
    function createResponse() {
        return {
            body: undefined,
            statusCode: 200,
            sendStatus: jest.fn(function (code) {
                this.statusCode = code;
                return this;
            }),
            json: jest.fn(function (value) {
                this.body = value;
                return this;
            }),
        };
    }

    test('refuses a request without a user and answers with the entries otherwise', async () => {
        const denied = createResponse();
        await usageHandler({ body: {} }, denied);
        expect(denied.sendStatus).toHaveBeenCalledWith(403);

        const directories = createUserDirectories();
        write(path.join(directories.characters, 'a.png'), 42);
        const ok = createResponse();
        await usageHandler({ body: {}, user: { profile: { handle: 'usage-user' }, directories } }, ok);
        expect(ok.statusCode).toBe(200);
        expect(entryOf(ok.body, 'characters')).toMatchObject({ bytes: 42, files: 1 });
    });

    test('shares one running scan between concurrent requests of the same user', async () => {
        const directories = createUserDirectories();
        write(path.join(directories.characters, 'a.png'), 1);
        const readdirSpy = jest.spyOn(fs.promises, 'readdir');
        const request = { body: {}, user: { profile: { handle: 'usage-user' }, directories } };

        const [first, second] = [createResponse(), createResponse()];
        await Promise.all([usageHandler(request, first), usageHandler(request, second)]);

        expect(first.body).toEqual(second.body);
        const scannedRoots = readdirSpy.mock.calls.filter(([directory]) => directory === directories.root);
        expect(scannedRoots).toHaveLength(1);
    });
});
