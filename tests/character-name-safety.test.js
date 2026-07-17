import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

const writeCharacterCard = jest.fn((_image, data) => Buffer.from(data));

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
let testIndex = 0;

beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sillytavern-character-name-'));
    previousDataRoot = global.DATA_ROOT;
    global.DATA_ROOT = root;
    const { setConfigFilePath } = await import('../src/util.js');
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    ({ router: characterRouter, diskCache } = await import('../src/endpoints/characters.js'));
});

afterEach(() => {
    jest.restoreAllMocks();
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

function createDirectories() {
    const testRoot = path.join(root, `case-${testIndex++}`);
    const directories = {
        root: testRoot,
        characters: path.join(testRoot, 'characters'),
        chats: path.join(testRoot, 'chats'),
        thumbnailsAvatar: path.join(testRoot, 'thumbnails', 'avatar'),
    };
    fs.mkdirSync(directories.characters, { recursive: true });
    fs.mkdirSync(directories.chats, { recursive: true });
    fs.mkdirSync(directories.thumbnailsAvatar, { recursive: true });
    return directories;
}

function createResponse() {
    return {
        statusCode: 200,
        send: jest.fn(value => value),
        sendStatus: jest.fn(function (code) { this.statusCode = code; return this; }),
        status: jest.fn(function (code) { this.statusCode = code; return this; }),
    };
}

function createCharacterRequest(directories, name, extra = {}) {
    return {
        body: { ch_name: name, user_name: 'User' },
        query: {},
        user: { profile: { handle: 'test-user' }, directories },
        ...extra,
    };
}

function seedCharacter(directories, internalName) {
    const avatarPath = path.join(directories.characters, `${internalName}.png`);
    const chatsPath = path.join(directories.chats, internalName);
    fs.writeFileSync(avatarPath, 'character');
    fs.mkdirSync(chatsPath, { recursive: true });
    fs.writeFileSync(path.join(chatsPath, 'chat.jsonl'), '{}');
    return { avatarPath, chatsPath };
}

describe('character name safety', () => {
    test('serializes duplicate character deletion without rejecting either request', async () => {
        const directories = createDirectories();
        const avatarPath = path.join(directories.characters, 'Duplicate.png');
        fs.writeFileSync(avatarPath, 'character');
        const firstResponse = createResponse();
        const secondResponse = createResponse();
        const request = {
            body: { avatar_url: 'Duplicate.png' },
            user: { directories },
        };

        await expect(Promise.all([
            getRouteHandler('/delete')(request, firstResponse),
            getRouteHandler('/delete')(request, secondResponse),
        ])).resolves.toBeDefined();

        const statuses = [firstResponse, secondResponse]
            .flatMap(response => response.sendStatus.mock.calls.map(([status]) => status))
            .toSorted();
        expect(statuses).toEqual([200, 400]);
        expect(fs.existsSync(avatarPath)).toBe(false);
    });

    test('keeps both concurrent same-name creations without avatars', async () => {
        const directories = createDirectories();
        const firstResponse = createResponse();
        const secondResponse = createResponse();

        await Promise.all([
            getRouteHandler('/create')(createCharacterRequest(directories, 'Concurrent'), firstResponse),
            getRouteHandler('/create')(createCharacterRequest(directories, 'Concurrent'), secondResponse),
        ]);

        const avatarNames = [firstResponse.send.mock.calls[0][0], secondResponse.send.mock.calls[0][0]].toSorted();
        expect(avatarNames).toEqual(['Concurrent.png', 'Concurrent1.png']);
        for (const avatarName of avatarNames) {
            const internalName = path.parse(avatarName).name;
            expect(fs.existsSync(path.join(directories.characters, avatarName))).toBe(true);
            expect(fs.existsSync(path.join(directories.chats, internalName))).toBe(true);
        }
    });

    test('reuses the base name after a queued create fails and cleans its chat directory', async () => {
        const directories = createDirectories();
        const firstResponse = createResponse();
        const secondResponse = createResponse();
        writeCharacterCard.mockImplementationOnce(() => {
            throw new Error('write failed');
        });
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await Promise.all([
            getRouteHandler('/create')(createCharacterRequest(directories, 'Retry'), firstResponse),
            getRouteHandler('/create')(createCharacterRequest(directories, 'Retry'), secondResponse),
        ]);

        expect(firstResponse.sendStatus).toHaveBeenCalledWith(500);
        expect(secondResponse.send).toHaveBeenCalledWith('Retry.png');
        expect(fs.readdirSync(directories.characters)).toEqual(['Retry.png']);
        expect(fs.readdirSync(directories.chats)).toEqual(['Retry']);
    });

    test('keeps both concurrent same-name creations with uploaded avatars', async () => {
        const directories = createDirectories();
        const uploads = path.join(directories.root, 'uploads');
        fs.mkdirSync(uploads);
        fs.writeFileSync(path.join(uploads, 'first'), 'first');
        fs.writeFileSync(path.join(uploads, 'second'), 'second');
        const firstResponse = createResponse();
        const secondResponse = createResponse();

        await Promise.all([
            getRouteHandler('/create')(createCharacterRequest(directories, 'Avatar', { file: { destination: uploads, filename: 'first' } }), firstResponse),
            getRouteHandler('/create')(createCharacterRequest(directories, 'Avatar', { file: { destination: uploads, filename: 'second' } }), secondResponse),
        ]);

        expect([firstResponse.send.mock.calls[0][0], secondResponse.send.mock.calls[0][0]].toSorted()).toEqual(['Avatar.png', 'Avatar1.png']);
        expect(fs.readdirSync(directories.characters).toSorted()).toEqual(['Avatar.png', 'Avatar1.png']);
        expect(fs.readdirSync(directories.chats).toSorted()).toEqual(['Avatar', 'Avatar1']);
        expect(fs.readdirSync(uploads)).toEqual([]);
    });

    test('does not attach a new character to a retained same-name chat directory', async () => {
        const directories = createDirectories();
        const retainedChats = path.join(directories.chats, 'Retained');
        fs.mkdirSync(retainedChats);
        fs.writeFileSync(path.join(retainedChats, 'old.jsonl'), 'old');
        const response = createResponse();

        await getRouteHandler('/create')(createCharacterRequest(directories, 'Retained'), response);

        expect(response.send).toHaveBeenCalledWith('Retained1.png');
        expect(fs.readFileSync(path.join(retainedChats, 'old.jsonl'), 'utf8')).toBe('old');
        expect(fs.existsSync(path.join(directories.chats, 'Retained1'))).toBe(true);
    });

    test('does not attach an imported character to a retained same-name chat directory', async () => {
        const directories = createDirectories();
        const retainedChats = path.join(directories.chats, 'Imported');
        const uploads = path.join(directories.root, 'uploads');
        fs.mkdirSync(retainedChats);
        fs.mkdirSync(uploads);
        fs.writeFileSync(path.join(retainedChats, 'old.jsonl'), 'old');
        fs.writeFileSync(path.join(uploads, 'character.json'), JSON.stringify({ name: 'Imported' }));
        const response = createResponse();

        await getRouteHandler('/import')({
            body: { file_type: 'json', user_name: 'User' },
            file: { destination: uploads, filename: 'character.json' },
            user: { profile: { handle: 'test-user' }, directories },
        }, response);

        expect(response.send).toHaveBeenCalledWith({ file_name: 'Imported1' });
        expect(fs.existsSync(path.join(directories.characters, 'Imported1.png'))).toBe(true);
        expect(fs.readFileSync(path.join(retainedChats, 'old.jsonl'), 'utf8')).toBe('old');
    });

    test('keeps both concurrent same-name JSON imports', async () => {
        const directories = createDirectories();
        const uploads = path.join(directories.root, 'uploads');
        fs.mkdirSync(uploads);
        fs.writeFileSync(path.join(uploads, 'first.json'), JSON.stringify({ name: 'Imported Concurrent' }));
        fs.writeFileSync(path.join(uploads, 'second.json'), JSON.stringify({ name: 'Imported Concurrent' }));
        const firstResponse = createResponse();
        const secondResponse = createResponse();

        await Promise.all([
            getRouteHandler('/import')({
                body: { file_type: 'json', user_name: 'User' },
                file: { destination: uploads, filename: 'first.json' },
                user: { profile: { handle: 'test-user' }, directories },
            }, firstResponse),
            getRouteHandler('/import')({
                body: { file_type: 'json', user_name: 'User' },
                file: { destination: uploads, filename: 'second.json' },
                user: { profile: { handle: 'test-user' }, directories },
            }, secondResponse),
        ]);

        const internalNames = [firstResponse.send.mock.calls[0][0].file_name, secondResponse.send.mock.calls[0][0].file_name].toSorted();
        expect(internalNames).toEqual(['Imported Concurrent', 'Imported Concurrent1']);
        expect(fs.readdirSync(directories.characters).toSorted()).toEqual(['Imported Concurrent.png', 'Imported Concurrent1.png']);
    });

    test('keeps cross-base imports when their unique-name candidates converge', async () => {
        const directories = createDirectories();
        const uploads = path.join(directories.root, 'uploads');
        fs.mkdirSync(uploads);
        fs.writeFileSync(path.join(directories.characters, 'A.png'), 'existing');
        fs.writeFileSync(path.join(uploads, 'a.json'), JSON.stringify({ name: 'A' }));
        fs.writeFileSync(path.join(uploads, 'a1.json'), JSON.stringify({ name: 'A1' }));
        const firstResponse = createResponse();
        const secondResponse = createResponse();

        await Promise.all([
            getRouteHandler('/import')({
                body: { file_type: 'json', user_name: 'User' },
                file: { destination: uploads, filename: 'a.json' },
                user: { profile: { handle: 'test-user' }, directories },
            }, firstResponse),
            getRouteHandler('/import')({
                body: { file_type: 'json', user_name: 'User' },
                file: { destination: uploads, filename: 'a1.json' },
                user: { profile: { handle: 'test-user' }, directories },
            }, secondResponse),
        ]);

        const internalNames = [firstResponse.send.mock.calls[0][0].file_name, secondResponse.send.mock.calls[0][0].file_name].toSorted();
        expect(internalNames).toEqual(['A1', 'A11']);
        expect(fs.readdirSync(directories.characters).toSorted()).toEqual(['A.png', 'A1.png', 'A11.png']);
    });

    test('keeps explicit preserved import names as overwrite targets', async () => {
        const directories = createDirectories();
        const uploads = path.join(directories.root, 'uploads');
        fs.mkdirSync(uploads);
        fs.writeFileSync(path.join(directories.characters, 'Pinned.png'), 'old');
        fs.mkdirSync(path.join(directories.chats, 'Pinned'));
        fs.writeFileSync(path.join(uploads, 'character.json'), JSON.stringify({ name: 'Different' }));
        const response = createResponse();

        await getRouteHandler('/import')({
            body: { file_type: 'json', preserved_name: 'Pinned.png', user_name: 'User' },
            file: { destination: uploads, filename: 'character.json' },
            user: { profile: { handle: 'test-user' }, directories },
        }, response);

        expect(response.send).toHaveBeenCalledWith({ file_name: 'Pinned' });
        expect(fs.existsSync(path.join(directories.characters, 'Pinned.png'))).toBe(true);
        expect(fs.existsSync(path.join(directories.characters, 'Different.png'))).toBe(false);
    });

    test('renames to a free suffix when the requested chat directory already exists', async () => {
        const directories = createDirectories();
        const { avatarPath, chatsPath } = seedCharacter(directories, 'Original');
        const retainedTargetChats = path.join(directories.chats, 'Renamed');
        fs.mkdirSync(retainedTargetChats);
        fs.writeFileSync(path.join(retainedTargetChats, 'retained.jsonl'), 'retained');
        const response = createResponse();

        await getRouteHandler('/rename')({
            body: { avatar_url: 'Original.png', new_name: 'Renamed' },
            user: { profile: { handle: 'test-user' }, directories },
        }, response);

        expect(response.send).toHaveBeenCalledWith({ avatar: 'Renamed1.png' });
        expect(fs.existsSync(avatarPath)).toBe(false);
        expect(fs.existsSync(chatsPath)).toBe(false);
        expect(fs.existsSync(path.join(directories.characters, 'Renamed1.png'))).toBe(true);
        expect(fs.existsSync(path.join(directories.chats, 'Renamed1', 'chat.jsonl'))).toBe(true);
        expect(fs.readFileSync(path.join(retainedTargetChats, 'retained.jsonl'), 'utf8')).toBe('retained');
    });

    test('keeps the original card and chats when chat migration fails', async () => {
        const directories = createDirectories();
        const { avatarPath, chatsPath } = seedCharacter(directories, 'Original');
        const response = createResponse();
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(fs, 'cpSync').mockImplementation(() => {
            throw new Error('copy failed');
        });

        await getRouteHandler('/rename')({
            body: { avatar_url: 'Original.png', new_name: 'Renamed' },
            user: { profile: { handle: 'test-user' }, directories },
        }, response);

        expect(consoleError).toHaveBeenCalled();
        expect(response.sendStatus).toHaveBeenCalledWith(500);
        expect(fs.existsSync(avatarPath)).toBe(true);
        expect(fs.existsSync(path.join(chatsPath, 'chat.jsonl'))).toBe(true);
        expect(fs.existsSync(path.join(directories.characters, 'Renamed.png'))).toBe(false);
        expect(fs.existsSync(path.join(directories.chats, 'Renamed'))).toBe(false);
    });

    test('keeps the original card and chats when deleting the old card fails', async () => {
        const directories = createDirectories();
        const { avatarPath, chatsPath } = seedCharacter(directories, 'Original');
        const response = createResponse();
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        const unlinkSync = fs.unlinkSync.bind(fs);
        jest.spyOn(fs, 'unlinkSync').mockImplementation((filePath) => {
            if (filePath === avatarPath) {
                throw new Error('delete failed');
            }
            return unlinkSync(filePath);
        });

        await getRouteHandler('/rename')({
            body: { avatar_url: 'Original.png', new_name: 'Renamed' },
            user: { profile: { handle: 'test-user' }, directories },
        }, response);

        expect(consoleError).toHaveBeenCalled();
        expect(response.sendStatus).toHaveBeenCalledWith(500);
        expect(fs.existsSync(avatarPath)).toBe(true);
        expect(fs.existsSync(path.join(chatsPath, 'chat.jsonl'))).toBe(true);
        expect(fs.existsSync(path.join(directories.characters, 'Renamed.png'))).toBe(false);
        expect(fs.existsSync(path.join(directories.chats, 'Renamed'))).toBe(false);
    });
});

describe('character write failure contract', () => {
    test('POST /edit reports a failed write as 500 instead of 200', async () => {
        const directories = createDirectories();
        seedCharacter(directories, 'Hero');
        const response = createResponse();
        writeCharacterCard.mockImplementationOnce(() => {
            throw new Error('disk full');
        });

        await getRouteHandler('/edit')({
            body: { ch_name: 'Hero', avatar_url: 'Hero.png', chat: 'chat', create_date: '2024-01-01' },
            query: {},
            user: { profile: { handle: 'test-user' }, directories },
        }, response);

        expect(response.sendStatus).toHaveBeenCalledWith(500);
        expect(response.sendStatus).not.toHaveBeenCalledWith(200);
    });

    test('POST /edit-attribute reports a failed write as 500 instead of 200', async () => {
        const directories = createDirectories();
        seedCharacter(directories, 'Hero');
        const response = createResponse();
        writeCharacterCard.mockImplementationOnce(() => {
            throw new Error('disk full');
        });

        await getRouteHandler('/edit-attribute')({
            body: { ch_name: 'Hero', avatar_url: 'Hero.png', field: 'description', value: 'updated' },
            query: {},
            user: { profile: { handle: 'test-user' }, directories },
        }, response);

        expect(response.sendStatus).toHaveBeenCalledWith(500);
        expect(response.sendStatus).not.toHaveBeenCalledWith(200);
    });

    test('POST /merge-attributes reports a failed write as 500, not a 400 validation error', async () => {
        const directories = createDirectories();
        seedCharacter(directories, 'Hero');
        const response = createResponse();
        writeCharacterCard.mockImplementationOnce(() => {
            throw new Error('disk full');
        });

        await getRouteHandler('/merge-attributes')({
            // Fill the remaining required v2 fields so the merged card validates and the write is actually attempted
            body: {
                avatar: 'Hero.png',
                data: {
                    description: 'merged',
                    creator_notes: '', system_prompt: '', post_history_instructions: '',
                    alternate_greetings: [], creator: '', character_version: '',
                },
            },
            query: {},
            user: { profile: { handle: 'test-user' }, directories },
        }, response);

        expect(response.status).toHaveBeenCalledWith(500);
        expect(response.status).not.toHaveBeenCalledWith(400);
    });
});
