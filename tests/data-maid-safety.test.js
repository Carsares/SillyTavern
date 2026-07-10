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
    return { sendStatus: jest.fn(value => value) };
}

function createToken(handle, ...filePaths) {
    const token = DataMaidService.generateToken(handle, { files: filePaths });
    const hashes = DataMaidService.TOKENS.get(token).paths.map(entry => entry.hash);
    return { token, hash: hashes[0], hashes };
}

async function deleteFiles(directories, handle, token, hashes) {
    const response = createResponse();
    await deleteHandler({
        body: { token, hashes },
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
