import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

let DataMaidService;
let deleteHandler;
let finalizeHandler;
const tempDirectories = [];

beforeAll(async () => {
    const { setConfigFilePath } = await import('../src/util.js');
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    const dataMaid = await import('../src/endpoints/data-maid.js');
    DataMaidService = dataMaid.DataMaidService;
    deleteHandler = dataMaid.router.stack.find(layer => layer.route?.path === '/delete').route.stack[0].handle;
    finalizeHandler = dataMaid.router.stack.find(layer => layer.route?.path === '/finalize').route.stack[0].handle;
});

afterEach(() => {
    jest.restoreAllMocks();
    DataMaidService.TOKENS.clear();
    for (const directory of tempDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function createDirectories() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sillytavern-data-maid-'));
    tempDirectories.push(root);
    const directories = {
        root,
        userImages: path.join(root, 'user-images'),
        files: path.join(root, 'files'),
        chats: path.join(root, 'chats'),
        groupChats: path.join(root, 'group-chats'),
        characters: path.join(root, 'characters'),
        groups: path.join(root, 'groups'),
        thumbnailsAvatar: path.join(root, 'thumbnails-avatar'),
        backgrounds: path.join(root, 'backgrounds'),
        thumbnailsBg: path.join(root, 'thumbnails-bg'),
        avatars: path.join(root, 'avatars'),
        thumbnailsPersona: path.join(root, 'thumbnails-persona'),
        backups: path.join(root, 'backups'),
    };
    Object.values(directories).filter(directory => directory !== root).forEach(directory => fs.mkdirSync(directory));
    return directories;
}

function createResponse() {
    return {
        sendStatus: jest.fn(value => value),
        json: jest.fn(value => value),
    };
}

function createToken(handle, ...filePaths) {
    const token = DataMaidService.generateToken(handle, { files: filePaths });
    const hashes = DataMaidService.TOKENS.get(token).paths.map(entry => entry.hash);
    return { token, hash: hashes[0], hashes };
}

async function deleteFiles(directories, handle, token, hashes, extraBody = {}) {
    const response = createResponse();
    await deleteHandler({
        body: { token, hashes, ...extraBody },
        user: { profile: { handle }, directories },
    }, response);
    return response;
}

async function finalizeToken(directories, handle, token) {
    const response = createResponse();
    await finalizeHandler({
        body: { token },
        user: { profile: { handle }, directories },
    }, response);
    return response;
}

describe('data maid cleanup token safety', () => {
    test('does not delete a different file recreated at the scanned path and consumes the hash', async () => {
        const directories = createDirectories();
        const filePath = path.join(directories.files, 'recreated.txt');
        fs.writeFileSync(filePath, 'original');
        const { token, hash } = createToken('test-user', filePath);
        fs.unlinkSync(filePath);
        fs.writeFileSync(filePath, 'replacement');

        const response = await deleteFiles(directories, 'test-user', token, [hash]);

        expect(response.sendStatus).toHaveBeenCalledWith(204);
        expect(fs.readFileSync(filePath, 'utf8')).toBe('replacement');
        expect(DataMaidService.TOKENS.get(token).paths).toHaveLength(0);
    });

    test('does not delete a file that became referenced after the scan', async () => {
        const directories = createDirectories();
        const filePath = path.join(directories.files, 'referenced.txt');
        fs.writeFileSync(filePath, 'keep me');
        const { token, hash } = createToken('test-user', filePath);
        fs.writeFileSync(path.join(directories.root, 'settings.json'), JSON.stringify({
            extension_settings: { attachments: [{ url: path.relative(directories.root, filePath) }] },
        }));

        const response = await deleteFiles(directories, 'test-user', token, [hash]);

        expect(response.sendStatus).toHaveBeenCalledWith(204);
        expect(fs.readFileSync(filePath, 'utf8')).toBe('keep me');
        expect(DataMaidService.TOKENS.get(token).paths).toHaveLength(0);
    });

    test('deletes two files separately, prevents hash replay, and keeps the token until finalization', async () => {
        const directories = createDirectories();
        const firstPath = path.join(directories.files, 'first.txt');
        const secondPath = path.join(directories.files, 'second.txt');
        fs.writeFileSync(firstPath, 'delete first');
        fs.writeFileSync(secondPath, 'delete second');
        const { token, hashes: [firstHash, secondHash] } = createToken('test-user', firstPath, secondPath);

        const firstResponse = await deleteFiles(directories, 'test-user', token, [firstHash]);
        fs.writeFileSync(firstPath, 'replacement');
        const replayResponse = await deleteFiles(directories, 'test-user', token, [firstHash]);

        expect(firstResponse.sendStatus).toHaveBeenCalledWith(204);
        expect(replayResponse.sendStatus).toHaveBeenCalledWith(204);
        expect(fs.readFileSync(firstPath, 'utf8')).toBe('replacement');
        expect(fs.existsSync(secondPath)).toBe(true);
        expect(DataMaidService.TOKENS.get(token).paths.map(entry => entry.hash)).toEqual([secondHash]);

        const secondResponse = await deleteFiles(directories, 'test-user', token, [secondHash]);

        expect(secondResponse.sendStatus).toHaveBeenCalledWith(204);
        expect(fs.existsSync(secondPath)).toBe(false);
        expect(DataMaidService.TOKENS.get(token).paths).toHaveLength(0);

        const finalizeResponse = await finalizeToken(directories, 'test-user', token);

        expect(finalizeResponse.sendStatus).toHaveBeenCalledWith(204);
        expect(DataMaidService.TOKENS.has(token)).toBe(false);
    });
});

describe('data maid detailed delete', () => {
    test('answers with the deleted hashes, the skipped ones and a reason for each, while the default stays 204', async () => {
        const directories = createDirectories();
        const deletable = path.join(directories.files, 'deletable.txt');
        const replaced = path.join(directories.files, 'replaced.txt');
        const referenced = path.join(directories.files, 'referenced.txt');
        const vanished = path.join(directories.files, 'vanished.txt');
        for (const filePath of [deletable, replaced, referenced, vanished]) {
            fs.writeFileSync(filePath, path.basename(filePath));
        }
        const { token, hashes: [deletableHash, replacedHash, referencedHash, vanishedHash] } = createToken('test-user', deletable, replaced, referenced, vanished);
        fs.unlinkSync(replaced);
        fs.writeFileSync(replaced, 'something else now');
        fs.unlinkSync(vanished);
        fs.writeFileSync(path.join(directories.root, 'settings.json'), JSON.stringify({
            extension_settings: { attachments: [{ url: path.relative(directories.root, referenced) }] },
        }));

        const response = await deleteFiles(directories, 'test-user', token, [deletableHash, replacedHash, referencedHash, vanishedHash, 'e'.repeat(64)], { detailed: true });

        expect(response.sendStatus).not.toHaveBeenCalled();
        const [body] = response.json.mock.calls[0];
        expect(body.deleted).toEqual([deletableHash]);
        expect(body.freedBytes).toBe('deletable.txt'.length);
        expect(body.skipped).toEqual(expect.arrayContaining([
            { hash: replacedHash, reason: 'changed' },
            { hash: referencedHash, reason: 'referenced' },
            { hash: vanishedHash, reason: 'missing' },
            { hash: 'e'.repeat(64), reason: 'unknown' },
        ]));
        expect(body.skipped).toHaveLength(4);
        expect(fs.existsSync(deletable)).toBe(false);
        expect(fs.readFileSync(replaced, 'utf8')).toBe('something else now');
        expect(fs.existsSync(referenced)).toBe(true);
    });

    test('reports a file that cannot be removed and still handles the files after it', async () => {
        const directories = createDirectories();
        const firstPath = path.join(directories.files, 'first.txt');
        const secondPath = path.join(directories.files, 'second.txt');
        fs.writeFileSync(firstPath, 'first');
        fs.writeFileSync(secondPath, 'second');
        const { token, hashes: [firstHash, secondHash] } = createToken('test-user', firstPath, secondPath);
        const realUnlink = fs.promises.unlink;
        jest.spyOn(fs.promises, 'unlink').mockImplementation(async filePath => {
            if (filePath === firstPath) {
                throw Object.assign(new Error('busy'), { code: 'EBUSY' });
            }
            return realUnlink(filePath);
        });
        jest.spyOn(console, 'error').mockImplementation(() => {});

        const response = await deleteFiles(directories, 'test-user', token, [firstHash, secondHash], { detailed: true });

        const [body] = response.json.mock.calls[0];
        expect(body.deleted).toEqual([secondHash]);
        expect(body.skipped).toEqual([{ hash: firstHash, reason: 'failed' }]);
        expect(fs.existsSync(firstPath)).toBe(true);
        expect(fs.existsSync(secondPath)).toBe(false);
    });

    test('without the flag a removal failure still ends the request with 500 and no body, as before', async () => {
        const directories = createDirectories();
        const filePath = path.join(directories.files, 'stuck.txt');
        fs.writeFileSync(filePath, 'stuck');
        const { token, hash } = createToken('test-user', filePath);
        jest.spyOn(fs.promises, 'unlink').mockRejectedValue(Object.assign(new Error('busy'), { code: 'EBUSY' }));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        const response = await deleteFiles(directories, 'test-user', token, [hash]);

        expect(response.sendStatus).toHaveBeenCalledWith(500);
        expect(response.json).not.toHaveBeenCalled();
    });

    test('only a literal true switches the detailed answer on', async () => {
        const directories = createDirectories();
        const filePath = path.join(directories.files, 'plain.txt');
        fs.writeFileSync(filePath, 'plain');
        const { token, hash } = createToken('test-user', filePath);

        const response = await deleteFiles(directories, 'test-user', token, [hash], { detailed: 'true' });

        expect(response.sendStatus).toHaveBeenCalledWith(204);
        expect(response.json).not.toHaveBeenCalled();
        expect(fs.existsSync(filePath)).toBe(false);
    });

    test('a detailed request with another user\'s token or without hashes is refused like before', async () => {
        const directories = createDirectories();
        const filePath = path.join(directories.files, 'kept.txt');
        fs.writeFileSync(filePath, 'kept');
        const { token, hash } = createToken('test-user', filePath);

        const intruder = await deleteFiles(directories, 'other-user', token, [hash], { detailed: true });
        const empty = await deleteFiles(directories, 'test-user', token, [], { detailed: true });

        expect(intruder.sendStatus).toHaveBeenCalledWith(403);
        expect(empty.sendStatus).toHaveBeenCalledWith(400);
        expect(fs.existsSync(filePath)).toBe(true);
    });
});
