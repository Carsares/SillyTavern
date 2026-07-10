import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

let getChatInfo;
let chatRouter;
let groupRouter;

const tempDirectories = [];

beforeAll(async () => {
    const { setConfigFilePath } = await import('../src/util.js');
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    ({ getChatInfo, router: chatRouter } = await import('../src/endpoints/chats.js'));
    ({ router: groupRouter } = await import('../src/endpoints/groups.js'));
});

afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function createTempDirectory() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sillytavern-chat-safety-'));
    tempDirectories.push(directory);
    return directory;
}

function getRouteHandler(router, routePath) {
    const route = router.stack.find(layer => layer.route?.path === routePath)?.route;
    if (!route) {
        throw new Error(`Route not found: ${routePath}`);
    }
    return route.stack[route.stack.length - 1].handle;
}

function createResponse() {
    const response = {};
    response.send = jest.fn(value => value);
    response.sendStatus = jest.fn(value => value);
    response.status = jest.fn(() => response);
    response.json = jest.fn(value => value);
    return response;
}

function createGroupChatDirectories() {
    const root = createTempDirectory();
    const userRoot = path.join(root, 'user');
    const directories = {
        characters: path.join(userRoot, 'characters'),
        chats: path.join(userRoot, 'chats'),
        groups: path.join(userRoot, 'groups'),
        groupChats: path.join(userRoot, 'group chats'),
    };
    Object.values(directories).forEach(directory => fs.mkdirSync(directory, { recursive: true }));
    return { root, directories };
}

describe('chat data safety', () => {
    test('missing group chat info returns a controlled 404', async () => {
        const groupChats = createTempDirectory();
        const response = createResponse();
        const handler = getRouteHandler(chatRouter, '/group/info');

        await handler({ body: { id: 'missing' }, user: { directories: { groupChats } } }, response);

        expect(response.sendStatus).toHaveBeenCalledWith(404);
        await expect(getChatInfo(path.join(groupChats, 'missing.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    test('chat rename distinguishes a missing source from an unchanged destination conflict', async () => {
        const chats = createTempDirectory();
        const characterChats = path.join(chats, 'avatar');
        fs.mkdirSync(characterChats, { recursive: true });
        const handler = getRouteHandler(chatRouter, '/rename');

        const missingResponse = createResponse();
        await handler({
            body: { avatar_url: 'avatar.png', original_file: 'missing.jsonl', renamed_file: 'renamed.jsonl', is_group: false },
            user: { directories: { chats } },
        }, missingResponse);

        expect(missingResponse.status).toHaveBeenCalledWith(404);
        expect(missingResponse.send).toHaveBeenCalledWith({ error: 'source_missing' });

        fs.writeFileSync(path.join(characterChats, 'source.jsonl'), 'source');
        fs.writeFileSync(path.join(characterChats, 'destination.jsonl'), 'destination');
        const conflictResponse = createResponse();
        await handler({
            body: { avatar_url: 'avatar.png', original_file: 'source.jsonl', renamed_file: 'destination.jsonl', is_group: false },
            user: { directories: { chats } },
        }, conflictResponse);

        expect(conflictResponse.status).toHaveBeenCalledWith(409);
        expect(conflictResponse.send).toHaveBeenCalledWith({ error: 'destination_exists' });
        expect(fs.readFileSync(path.join(characterChats, 'source.jsonl'), 'utf8')).toBe('source');
        expect(fs.readFileSync(path.join(characterChats, 'destination.jsonl'), 'utf8')).toBe('destination');
    });

    test('character and group chat deletion are idempotent when the file is already missing', () => {
        const chats = createTempDirectory();
        const groupChats = createTempDirectory();
        const characterResponse = createResponse();
        const groupResponse = createResponse();

        getRouteHandler(chatRouter, '/delete')({
            body: { avatar_url: 'avatar.png', chatfile: 'missing.jsonl' },
            user: { directories: { chats } },
        }, characterResponse);
        getRouteHandler(chatRouter, '/group/delete')({
            body: { id: 'missing' },
            user: { directories: { groupChats } },
        }, groupResponse);

        expect(characterResponse.send).toHaveBeenCalledWith({ ok: true, missing: true });
        expect(characterResponse.sendStatus).not.toHaveBeenCalled();
        expect(groupResponse.send).toHaveBeenCalledWith({ ok: true, missing: true });
        expect(groupResponse.sendStatus).not.toHaveBeenCalled();
    });

    test('chat deletion reports a server failure when a failed delete leaves the file present', () => {
        const chats = createTempDirectory();
        const response = createResponse();
        const existsSync = jest.spyOn(fs, 'existsSync')
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            getRouteHandler(chatRouter, '/delete')({
                body: { avatar_url: 'avatar.png', chatfile: 'still-present.jsonl' },
                user: { directories: { chats } },
            }, response);
        } finally {
            existsSync.mockRestore();
            consoleError.mockRestore();
        }

        expect(response.sendStatus).toHaveBeenCalledWith(500);
        expect(response.send).not.toHaveBeenCalled();
    });

    test('returns one controlled error when text export encounters malformed JSONL', async () => {
        const chats = createTempDirectory();
        const characterChats = path.join(chats, 'avatar');
        fs.mkdirSync(characterChats, { recursive: true });
        fs.writeFileSync(path.join(characterChats, 'broken.jsonl'), '{"name":"User","mes":"valid"}\n{invalid');
        const response = createResponse();
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        try {
            await getRouteHandler(chatRouter, '/export')({
                body: { file: 'broken.jsonl', avatar_url: 'avatar.png', is_group: false, format: 'txt', exportfilename: 'broken.txt' },
                user: { directories: { chats } },
            }, response);
        } finally {
            consoleError.mockRestore();
        }

        expect(response.sendStatus).toHaveBeenCalledTimes(1);
        expect(response.sendStatus).toHaveBeenCalledWith(400);
        expect(response.json).not.toHaveBeenCalled();
    });

    test('completes a valid text export exactly once', async () => {
        const chats = createTempDirectory();
        const characterChats = path.join(chats, 'avatar');
        fs.mkdirSync(characterChats, { recursive: true });
        fs.writeFileSync(path.join(characterChats, 'valid.jsonl'), [
            JSON.stringify({ name: 'User', mes: 'Hello' }),
            JSON.stringify({ name: 'System', mes: 'hidden', is_system: true }),
            JSON.stringify({ name: 'Character', mes: 'Hi' }),
        ].join('\n'));
        const response = createResponse();

        await getRouteHandler(chatRouter, '/export')({
            body: { file: 'valid.jsonl', avatar_url: 'avatar.png', is_group: false, format: 'txt', exportfilename: 'valid.txt' },
            user: { directories: { chats } },
        }, response);

        expect(response.status).toHaveBeenCalledTimes(1);
        expect(response.status).toHaveBeenCalledWith(200);
        expect(response.json).toHaveBeenCalledTimes(1);
        expect(response.json).toHaveBeenCalledWith({
            message: 'Chat saved to valid.txt',
            result: 'User: Hello\n\nCharacter: Hi\n\n',
        });
        expect(response.sendStatus).not.toHaveBeenCalled();
    });

    test('imports every non-empty CAI Tools history', () => {
        const root = createTempDirectory();
        const chats = path.join(root, 'chats');
        const characterChats = path.join(chats, 'avatar');
        const uploadDirectory = path.join(root, 'uploads');
        fs.mkdirSync(characterChats, { recursive: true });
        fs.mkdirSync(uploadDirectory, { recursive: true });
        const uploadName = 'cai-tools.json';
        fs.writeFileSync(path.join(uploadDirectory, uploadName), JSON.stringify({
            histories: {
                histories: [
                    { msgs: [{ src: { is_human: true }, text: 'Hello' }, { src: { is_human: false }, text: 'Hi' }] },
                    { msgs: [{ src: { is_human: false }, text: 'Second history' }] },
                ],
            },
        }));
        const response = createResponse();
        const now = jest.spyOn(Date, 'now');
        let timestamp = 1_700_000_000_000;
        now.mockImplementation(() => timestamp++);

        getRouteHandler(chatRouter, '/import')({
            body: { file_type: 'json', avatar_url: 'avatar.png', character_name: 'Character', user_name: 'User' },
            file: { destination: uploadDirectory, filename: uploadName },
            user: { directories: { chats } },
        }, response);
        now.mockRestore();

        const result = response.send.mock.calls[0][0];
        expect(result).toEqual({ res: true, fileNames: expect.any(Array) });
        expect(result.fileNames).toHaveLength(2);
        expect(result.fileNames.map(fileName => fs.readFileSync(path.join(characterChats, fileName), 'utf8').split('\n').map(line => JSON.parse(line)))).toEqual([
            [
                { chat_metadata: {}, user_name: 'unused', character_name: 'unused' },
                { name: 'User', is_user: true, send_date: expect.any(String), mes: 'Hello', extra: {} },
                { name: 'Character', is_user: false, send_date: expect.any(String), mes: 'Hi', extra: {} },
            ],
            [
                { chat_metadata: {}, user_name: 'unused', character_name: 'unused' },
                { name: 'Character', is_user: false, send_date: expect.any(String), mes: 'Second history', extra: {} },
            ],
        ]);
    });

    test('rejects path separators in group chat IDs on create and edit', () => {
        const groups = createTempDirectory();
        const user = { directories: { groups } };
        const createResponseResult = createResponse();
        const editResponseResult = createResponse();

        getRouteHandler(groupRouter, '/create')({ body: { chats: ['../../victim'] }, user }, createResponseResult);
        getRouteHandler(groupRouter, '/edit')({ body: { id: 'group', chats: ['..\\victim'] }, user }, editResponseResult);

        expect(createResponseResult.sendStatus).toHaveBeenCalledWith(400);
        expect(editResponseResult.sendStatus).toHaveBeenCalledWith(400);
        expect(fs.readdirSync(groups)).toEqual([]);
    });

    test('keeps valid group chat IDs unchanged', () => {
        const groups = createTempDirectory();
        const response = createResponse();
        const chatId = '2026-07-10@12h00m00s000ms';

        getRouteHandler(groupRouter, '/create')({ body: { chats: [chatId], chat_id: chatId }, user: { directories: { groups } } }, response);

        expect(response.send).toHaveBeenCalledWith(expect.objectContaining({ chats: [chatId], chat_id: chatId }));
        expect(fs.readdirSync(groups)).toHaveLength(1);
    });

    test('group edit cannot recreate a group after deletion', () => {
        const groups = createTempDirectory();
        const response = createResponse();

        getRouteHandler(groupRouter, '/edit')({
            body: { id: 'deleted-group', name: 'stale edit' },
            user: { directories: { groups } },
        }, response);

        expect(response.sendStatus).toHaveBeenCalledWith(404);
        expect(fs.readdirSync(groups)).toEqual([]);
    });

    test('search and recent ignore escaped paths in existing group data', async () => {
        const { root, directories } = createGroupChatDirectories();
        const escapedChatId = '../../victim';
        const escapedChatPath = path.resolve(directories.groupChats, `${escapedChatId}.jsonl`);
        const chat = [
            { chat_metadata: {}, user_name: 'unused', character_name: 'unused' },
            { name: 'Character', is_user: false, send_date: new Date().toISOString(), mes: 'outside secret', extra: {} },
        ];
        fs.writeFileSync(escapedChatPath, chat.map(message => JSON.stringify(message)).join('\n'));
        fs.writeFileSync(path.join(directories.groups, 'group.json'), JSON.stringify({ id: 'group', chats: [escapedChatId] }));

        const searchResponse = createResponse();
        await getRouteHandler(chatRouter, '/search')({
            body: { query: 'outside secret', avatar_url: '', group_id: 'group' },
            user: { directories },
        }, searchResponse);

        const recentResponse = createResponse();
        await getRouteHandler(chatRouter, '/recent')({
            body: {},
            user: { directories },
        }, recentResponse);

        expect(escapedChatPath.startsWith(root)).toBe(true);
        expect(searchResponse.send).toHaveBeenCalledWith([]);
        expect(recentResponse.send).toHaveBeenCalledWith([]);
    });
});
