import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

let DataMaidService;
let deleteHandler;
const tempDirectories = [];

beforeAll(async () => {
    const { setConfigFilePath } = await import('../src/util.js');
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    const dataMaid = await import('../src/endpoints/data-maid.js');
    DataMaidService = dataMaid.DataMaidService;
    deleteHandler = dataMaid.router.stack.find(layer => layer.route?.path === '/delete').route.stack[0].handle;
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

function createToken(handle, filePath) {
    const token = DataMaidService.generateToken(handle, { files: [filePath] });
    const hash = DataMaidService.TOKENS.get(token).paths[0].hash;
    return { token, hash };
}

async function deleteFiles(directories, handle, token, hashes) {
    const response = createResponse();
    await deleteHandler({
        body: { token, hashes },
        user: { profile: { handle }, directories },
    }, response);
    return response;
}

describe('data maid cleanup token safety', () => {
    test('does not delete a different file recreated at the scanned path and consumes the token', async () => {
        const directories = createDirectories();
        const filePath = path.join(directories.files, 'recreated.txt');
        fs.writeFileSync(filePath, 'original');
        const { token, hash } = createToken('test-user', filePath);
        fs.unlinkSync(filePath);
        fs.writeFileSync(filePath, 'replacement');

        const response = await deleteFiles(directories, 'test-user', token, [hash]);

        expect(response.sendStatus).toHaveBeenCalledWith(204);
        expect(fs.readFileSync(filePath, 'utf8')).toBe('replacement');
        expect(DataMaidService.TOKENS.has(token)).toBe(false);
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
        expect(DataMaidService.TOKENS.has(token)).toBe(false);
    });

    test('deletes an unchanged loose file and prevents token replay', async () => {
        const directories = createDirectories();
        const filePath = path.join(directories.files, 'loose.txt');
        fs.writeFileSync(filePath, 'delete me');
        const { token, hash } = createToken('test-user', filePath);

        const firstResponse = await deleteFiles(directories, 'test-user', token, [hash]);
        const replayResponse = await deleteFiles(directories, 'test-user', token, [hash]);

        expect(firstResponse.sendStatus).toHaveBeenCalledWith(204);
        expect(fs.existsSync(filePath)).toBe(false);
        expect(replayResponse.sendStatus).toHaveBeenCalledWith(403);
    });
});
