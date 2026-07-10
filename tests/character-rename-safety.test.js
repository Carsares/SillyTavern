import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';

const writeCharacterCard = jest.fn(() => {
    throw new Error('Simulated character write failure');
});

jest.unstable_mockModule('../src/character-card-parser.js', () => ({
    parse: jest.fn(async () => JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        name: 'Original',
        data: {
            name: 'Original',
            description: '',
            personality: '',
            scenario: '',
            first_mes: '',
            mes_example: '',
            tags: [],
            extensions: { talkativeness: 0.5, fav: false },
        },
    })),
    read: jest.fn(),
    write: writeCharacterCard,
}));

jest.unstable_mockModule('../src/jimp.js', () => {
    class MockJimp {
        bitmap = { width: 1, height: 1 };

        static async read() {
            return new MockJimp();
        }

        static async fromBuffer() {
            return new MockJimp();
        }

        crop() {}

        cover() {}

        async getBuffer() {
            return Buffer.from('image');
        }
    }

    return { Jimp: MockJimp, JimpMime: { png: 'image/png' } };
});

let characterRouter;
let diskCache;
let root;
let previousDataRoot;

beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sillytavern-character-rename-'));
    previousDataRoot = global.DATA_ROOT;
    global.DATA_ROOT = root;
    const { setConfigFilePath } = await import('../src/util.js');
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    ({ router: characterRouter, diskCache } = await import('../src/endpoints/characters.js'));
});

afterAll(() => {
    diskCache?.dispose();
    fs.rmSync(root, { recursive: true, force: true });
    global.DATA_ROOT = previousDataRoot;
});

function getRouteHandler(routePath) {
    const route = characterRouter.stack.find(layer => layer.route?.path === routePath)?.route;
    if (!route) {
        throw new Error(`Character route not found: ${routePath}`);
    }
    return route.stack[route.stack.length - 1].handle;
}

function createResponse() {
    const response = {};
    response.send = jest.fn(value => value);
    response.sendStatus = jest.fn(value => value);
    return response;
}

describe('character rename safety', () => {
    test('keeps the original character and chats when writing the renamed card fails', async () => {
        const characters = path.join(root, 'characters');
        const chats = path.join(root, 'chats');
        const oldAvatarPath = path.join(characters, 'Original.png');
        const oldChatsPath = path.join(chats, 'Original');
        fs.mkdirSync(oldChatsPath, { recursive: true });
        fs.writeFileSync(path.join(oldChatsPath, 'chat.jsonl'), '{}');
        fs.mkdirSync(characters, { recursive: true });
        fs.writeFileSync(oldAvatarPath, 'original character image');
        writeCharacterCard.mockClear();
        const response = createResponse();
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            await getRouteHandler('/rename')({
                body: { avatar_url: 'Original.png', new_name: 'Renamed' },
                user: { profile: { handle: 'test-user' }, directories: { characters, chats } },
            }, response);
        } finally {
            consoleError.mockRestore();
        }

        expect(writeCharacterCard).toHaveBeenCalled();
        expect(response.sendStatus).toHaveBeenCalledWith(500);
        expect(fs.existsSync(oldAvatarPath)).toBe(true);
        expect(fs.existsSync(path.join(characters, 'Renamed.png'))).toBe(false);
        expect(fs.existsSync(path.join(oldChatsPath, 'chat.jsonl'))).toBe(true);
    });

    test('rejects a final avatar file name that exceeds the file-system component limit', async () => {
        const characters = path.join(root, 'long-name-characters');
        const chats = path.join(root, 'long-name-chats');
        const oldAvatarPath = path.join(characters, 'Original.png');
        fs.mkdirSync(characters, { recursive: true });
        fs.mkdirSync(chats, { recursive: true });
        fs.writeFileSync(oldAvatarPath, 'original');
        writeCharacterCard.mockClear();
        const response = createResponse();

        await getRouteHandler('/rename')({
            body: { avatar_url: 'Original.png', new_name: 'a'.repeat(300) },
            user: { profile: { handle: 'test-user' }, directories: { characters, chats } },
        }, response);

        expect(response.sendStatus).toHaveBeenCalledWith(400);
        expect(writeCharacterCard).not.toHaveBeenCalled();
        expect(fs.readFileSync(oldAvatarPath, 'utf8')).toBe('original');
    });

    test('does not report success or leave a chat directory when character creation fails', async () => {
        const characters = path.join(root, 'create-characters');
        const chats = path.join(root, 'create-chats');
        fs.mkdirSync(characters, { recursive: true });
        fs.mkdirSync(chats, { recursive: true });
        writeCharacterCard.mockClear();
        const response = createResponse();
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            await getRouteHandler('/create')({
                body: { ch_name: 'Failed Character', user_name: 'User' },
                user: { profile: { handle: 'test-user' }, directories: { characters, chats } },
            }, response);
        } finally {
            consoleError.mockRestore();
        }

        expect(writeCharacterCard).toHaveBeenCalled();
        expect(response.send).not.toHaveBeenCalled();
        expect(response.sendStatus).toHaveBeenCalledWith(500);
        expect(fs.existsSync(path.join(chats, 'Failed Character'))).toBe(false);
        expect(fs.existsSync(path.join(characters, 'Failed Character.png'))).toBe(false);
    });

    test('rejects an overlong character file name before creating its chat directory', async () => {
        const characters = path.join(root, 'long-create-characters');
        const chats = path.join(root, 'long-create-chats');
        fs.mkdirSync(characters, { recursive: true });
        fs.mkdirSync(chats, { recursive: true });
        writeCharacterCard.mockClear();
        const response = createResponse();

        await getRouteHandler('/create')({
            body: { ch_name: 'a'.repeat(300), user_name: 'User' },
            user: { profile: { handle: 'test-user' }, directories: { characters, chats } },
        }, response);

        expect(response.sendStatus).toHaveBeenCalledWith(400);
        expect(writeCharacterCard).not.toHaveBeenCalled();
        expect(fs.readdirSync(chats)).toEqual([]);
        expect(fs.readdirSync(characters)).toEqual([]);
    });
});
