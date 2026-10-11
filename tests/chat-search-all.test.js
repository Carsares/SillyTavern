import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

let chatRouter;
let parseChatSearchAllRequest;

const tempDirectories = [];

beforeAll(async () => {
    const { setConfigFilePath } = await import('../src/util.js');
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    ({ router: chatRouter, parseChatSearchAllRequest } = await import('../src/endpoints/chats.js'));
});

afterEach(() => {
    jest.restoreAllMocks();
    for (const directory of tempDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function getRouteHandler(router, routePath) {
    const route = router.stack.find(layer => layer.route?.path === routePath)?.route;
    if (!route) {
        throw new Error(`Route not found: ${routePath}`);
    }
    return route.stack[route.stack.length - 1].handle;
}

function createResponse() {
    const response = { handlers: {} };
    response.send = jest.fn(value => value);
    response.sendStatus = jest.fn(value => value);
    response.status = jest.fn(() => response);
    response.json = jest.fn(value => value);
    response.on = jest.fn((event, handler) => {
        response.handlers[event] = handler;
        return response;
    });
    return response;
}

/**
 * A user data tree with two characters (alice, bruno) and one group (group-one) that owns the chats listed in `groupChats`.
 */
function createLibrary() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sillytavern-chat-search-all-'));
    tempDirectories.push(root);
    const userRoot = path.join(root, 'user');
    const directories = {
        characters: path.join(userRoot, 'characters'),
        chats: path.join(userRoot, 'chats'),
        groups: path.join(userRoot, 'groups'),
        groupChats: path.join(userRoot, 'group chats'),
    };
    Object.values(directories).forEach(directory => fs.mkdirSync(directory, { recursive: true }));
    // The card contents don't matter: the search only needs to know that the card exists
    fs.writeFileSync(path.join(directories.characters, 'alice.png'), 'png');
    fs.writeFileSync(path.join(directories.characters, 'bruno.png'), 'png');
    fs.mkdirSync(path.join(directories.chats, 'alice'));
    fs.mkdirSync(path.join(directories.chats, 'bruno'));

    let clock = Date.now() - 100_000_000;
    // Every file written gets a later modification time than the previous one
    const touch = (filePath) => {
        clock += 60_000;
        fs.utimesSync(filePath, new Date(clock), new Date(clock));
    };

    return {
        root,
        directories,
        writeCharacterChat(avatarName, fileName, messages, { raw = null } = {}) {
            const filePath = path.join(directories.chats, avatarName, `${fileName}.jsonl`);
            fs.writeFileSync(filePath, raw ?? serializeChat(messages));
            touch(filePath);
            return filePath;
        },
        writeGroupChat(chatId, messages, { raw = null } = {}) {
            const filePath = path.join(directories.groupChats, `${chatId}.jsonl`);
            fs.writeFileSync(filePath, raw ?? serializeChat(messages));
            touch(filePath);
            return filePath;
        },
        writeGroup(group) {
            fs.writeFileSync(path.join(directories.groups, `${group.id}.json`), JSON.stringify(group));
        },
    };
}

function serializeChat(messages) {
    const header = { chat_metadata: { integrity: 'test' }, user_name: 'unused', character_name: 'unused' };
    return [header, ...messages].map(entry => JSON.stringify(entry)).join('\n');
}

function message(text, { name = 'Alice', isUser = false, sendDate = '2026-01-02T03:04:05.000Z' } = {}) {
    return { name, is_user: isUser, send_date: sendDate, mes: text, extra: {} };
}

async function searchAll(library, body) {
    const response = createResponse();
    await getRouteHandler(chatRouter, '/search-all')({ body, user: { directories: library.directories } }, response);
    return response;
}

async function searchAllResult(library, body) {
    const response = await searchAll(library, body);
    expect(response.status).not.toHaveBeenCalled();
    return response.send.mock.calls[0][0];
}

function highlightedTexts(snippet) {
    return snippet.highlights.map(([start, end]) => snippet.text.slice(start, end));
}

describe('chat search across characters and groups', () => {
    test('finds matches in character and group chats and reports the owner of each', async () => {
        const library = createLibrary();
        library.writeCharacterChat('alice', 'alice-chat', [message('The dragon sleeps under the castle.')]);
        library.writeCharacterChat('bruno', 'bruno-chat', [message('Nothing relevant here.')]);
        library.writeGroupChat('group-chat-1', [message('A dragon appears in the group.', { name: 'Bruno' })]);
        library.writeGroup({ id: 'group-one', name: 'Dragon Hunters', chats: ['group-chat-1'] });

        const result = await searchAllResult(library, { query: 'dragon' });

        expect(Object.keys(result).sort()).toEqual(['elapsedMs', 'partial', 'partialReason', 'results', 'scannedFiles', 'totalFiles']);
        expect(result).toMatchObject({ partial: false, partialReason: '', scannedFiles: 3, totalFiles: 3 });
        expect(result.results).toHaveLength(2);

        const characterHit = result.results.find(hit => hit.kind === 'character');
        expect(characterHit).toMatchObject({
            avatar: 'alice.png',
            entityName: 'alice',
            file_id: 'alice-chat',
            file_name: 'alice-chat.jsonl',
            message_count: 1,
            last_mes: '2026-01-02T03:04:05.000Z',
            fileNameMatch: false,
            matchCount: 1,
        });
        expect(characterHit.groupId).toBeUndefined();
        expect(typeof characterHit.file_size).toBe('string');
        expect(characterHit.snippets).toHaveLength(1);
        expect(characterHit.snippets[0]).toMatchObject({ index: 0, name: 'Alice', is_user: false, send_date: '2026-01-02T03:04:05.000Z', text: 'The dragon sleeps under the castle.' });
        expect(highlightedTexts(characterHit.snippets[0])).toEqual(['dragon']);

        const groupHit = result.results.find(hit => hit.kind === 'group');
        expect(groupHit).toMatchObject({ groupId: 'group-one', entityName: 'Dragon Hunters', file_id: 'group-chat-1', matchCount: 1 });
        expect(groupHit.avatar).toBeUndefined();

        // Nothing in the response reveals where the data lives
        expect(JSON.stringify(result)).not.toContain(library.root);
        expect(JSON.stringify(result)).not.toContain(path.sep + 'user' + path.sep);
    });

    test('lists the newest chats first', async () => {
        const library = createLibrary();
        library.writeCharacterChat('alice', 'oldest', [message('dragon one')]);
        library.writeGroupChat('middle', [message('dragon two')]);
        library.writeGroup({ id: 'group-one', name: 'G', chats: ['middle'] });
        library.writeCharacterChat('bruno', 'newest', [message('dragon three')]);

        const result = await searchAllResult(library, { query: 'dragon' });

        expect(result.results.map(hit => hit.file_id)).toEqual(['newest', 'middle', 'oldest']);
    });

    test('requires every word, spread over different messages, or a file name that holds them all', async () => {
        const library = createLibrary();
        library.writeCharacterChat('alice', 'both-words', [
            message('A dragon flies over.'),
            message('Unrelated text.'),
            message('The castle burns.'),
        ]);
        library.writeCharacterChat('alice', 'one-word', [message('Only a dragon here.')]);
        library.writeCharacterChat('alice', 'dragon castle plans', [message('Empty of both words.')]);
        library.writeCharacterChat('bruno', 'header-only-notes', []);

        const result = await searchAllResult(library, { query: 'dragon   castle' });
        const hits = Object.fromEntries(result.results.map(hit => [hit.file_id, hit]));

        expect(Object.keys(hits).sort()).toEqual(['both-words', 'dragon castle plans']);
        expect(hits['both-words']).toMatchObject({ fileNameMatch: false, matchCount: 2, message_count: 3 });
        expect(hits['both-words'].snippets.map(snippet => snippet.index)).toEqual([0, 2]);
        expect(hits['dragon castle plans']).toMatchObject({ fileNameMatch: true, matchCount: 0, snippets: [] });
    });

    test('lists a header-only chat when its file name matches', async () => {
        const library = createLibrary();
        library.writeCharacterChat('bruno', 'castle-dragon-notes', []);
        library.writeCharacterChat('bruno', 'empty', []);

        const result = await searchAllResult(library, { query: 'castle dragon' });

        expect(result.results).toHaveLength(1);
        expect(result.results[0]).toMatchObject({ file_id: 'castle-dragon-notes', fileNameMatch: true, message_count: 0, matchCount: 0, snippets: [] });
        expect(typeof result.results[0].last_mes).toBe('number');
    });

    test('ignores case, supports CJK text and a one-character CJK query', async () => {
        const library = createLibrary();
        library.writeCharacterChat('alice', 'english', [message('The DRAGON roars. A Dragon answers.')]);
        library.writeCharacterChat('alice', 'chinese', [message('远处的龙在山谷里沉睡，龙息温暖。')]);

        const english = await searchAllResult(library, { query: 'Dragon' });
        expect(english.results).toHaveLength(1);
        expect(english.results[0].matchCount).toBe(1);
        // Highlights keep the case of the message
        expect(highlightedTexts(english.results[0].snippets[0])).toEqual(['DRAGON', 'Dragon']);

        const chinese = await searchAllResult(library, { query: '龙' });
        expect(chinese.results.map(hit => hit.file_id)).toEqual(['chinese']);
        expect(highlightedTexts(chinese.results[0].snippets[0])).toEqual(['龙', '龙']);

        const phrase = await searchAllResult(library, { query: '龙息' });
        expect(highlightedTexts(phrase.results[0].snippets[0])).toEqual(['龙息']);
    });

    test('cuts long messages around the first hit and keeps the highlight ranges valid', async () => {
        const library = createLibrary();
        const filler = 'lorem ipsum '.repeat(30);
        library.writeCharacterChat('alice', 'long', [message(`${filler}the Dragon is here, and another dragon too. ${filler}`)]);

        const result = await searchAllResult(library, { query: 'dragon' });
        const [snippet] = result.results[0].snippets;

        expect(snippet.text.startsWith('…')).toBe(true);
        expect(snippet.text.endsWith('…')).toBe(true);
        expect(snippet.text.length).toBeLessThan(200);
        expect(highlightedTexts(snippet)).toEqual(['Dragon', 'dragon']);
        for (const [start, end] of snippet.highlights) {
            expect(snippet.text.slice(start, end).toLowerCase()).toBe('dragon');
        }
    });

    test('merges overlapping highlights, turns line breaks into spaces and never splits an emoji', async () => {
        const library = createLibrary();
        library.writeCharacterChat('alice', 'overlap', [message('First line\nsecond line has dragonfly and fly\r\nthird')]);
        const emojiPadding = '😀'.repeat(60);
        // The odd number of single-unit characters around the word puts both cut points inside an emoji
        library.writeCharacterChat('alice', 'emoji', [message(`${emojiPadding}xdragony${emojiPadding}`)]);

        const overlap = await searchAllResult(library, { query: 'dragon dragonfly' });
        const overlapSnippet = overlap.results.find(hit => hit.file_id === 'overlap').snippets[0];
        expect(overlapSnippet.text).toBe('First line second line has dragonfly and fly  third');
        expect(highlightedTexts(overlapSnippet)).toEqual(['dragonfly']);

        const emoji = await searchAllResult(library, { query: 'dragon' });
        const emojiSnippet = emoji.results.find(hit => hit.file_id === 'emoji').snippets[0];
        expect(emojiSnippet.text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
        expect(highlightedTexts(emojiSnippet)).toEqual(['dragon']);
    });

    test('keeps the newest matching chats when the limit truncates the result', async () => {
        const library = createLibrary();
        for (let index = 1; index <= 5; index++) {
            library.writeCharacterChat('alice', `chat-${index}`, [message(`dragon number ${index}`)]);
        }

        const result = await searchAllResult(library, { query: 'dragon', limit: 2 });

        expect(result.results.map(hit => hit.file_id)).toEqual(['chat-5', 'chat-4']);
        expect(result).toMatchObject({ partial: true, partialReason: 'limit', totalFiles: 5 });

        const exact = await searchAllResult(library, { query: 'dragon', limit: 5 });
        expect(exact.results).toHaveLength(5);
        expect(exact.partial).toBe(false);
    });

    test('limits the snippets of a chat but still counts every matching message', async () => {
        const library = createLibrary();
        library.writeCharacterChat('alice', 'many', Array.from({ length: 6 }, (_, index) => message(`dragon sighting ${index}`)));

        const defaults = await searchAllResult(library, { query: 'dragon' });
        expect(defaults.results[0].matchCount).toBe(6);
        expect(defaults.results[0].snippets.map(snippet => snippet.index)).toEqual([0, 1, 2]);

        const two = await searchAllResult(library, { query: 'dragon', snippetsPerChat: 2 });
        expect(two.results[0].snippets).toHaveLength(2);

        const none = await searchAllResult(library, { query: 'dragon', snippetsPerChat: 0 });
        expect(none.results[0]).toMatchObject({ matchCount: 6, snippets: [] });
    });

    test('returns a partial result when the time budget is spent', async () => {
        const library = createLibrary();
        for (let index = 1; index <= 8; index++) {
            library.writeCharacterChat('alice', `chat-${index}`, [message('dragon')]);
        }
        // The first reading is the start of the search; every later one is long after the 1 ms budget
        let firstReading = true;
        jest.spyOn(Date, 'now').mockImplementation(() => {
            if (firstReading) {
                firstReading = false;
                return 0;
            }
            return 1_000_000;
        });

        const result = await searchAllResult(library, { query: 'dragon', timeoutMs: 1 });
        jest.restoreAllMocks();

        expect(result).toMatchObject({ partial: true, partialReason: 'timeout', scannedFiles: 0, totalFiles: 8, results: [] });
    });

    test('stops quietly when the client disconnects', async () => {
        const library = createLibrary();
        for (let index = 1; index <= 4; index++) {
            library.writeCharacterChat('alice', `chat-${index}`, [message('dragon')]);
        }
        const response = createResponse();

        const pending = getRouteHandler(chatRouter, '/search-all')({ body: { query: 'dragon' }, user: { directories: library.directories } }, response);
        expect(response.on).toHaveBeenCalledWith('close', expect.any(Function));
        // The response was not finished: this is a real disconnect
        response.handlers.close();
        await pending;

        expect(response.send).not.toHaveBeenCalled();
        expect(response.status).not.toHaveBeenCalled();
    });

    test('ignores group chat IDs that point outside the group chats directory', async () => {
        const library = createLibrary();
        const outsidePath = path.resolve(library.directories.groupChats, '../../victim.jsonl');
        fs.writeFileSync(outsidePath, serializeChat([message('outside secret dragon')]));
        library.writeGroupChat('inside', [message('inside dragon')]);
        library.writeGroup({ id: 'group-one', name: 'G', chats: ['../../victim', '..', 'inside', 12, null] });

        const result = await searchAllResult(library, { query: 'dragon' });

        expect(outsidePath.startsWith(library.root)).toBe(true);
        expect(result.totalFiles).toBe(1);
        expect(result.results.map(hit => hit.file_id)).toEqual(['inside']);
        expect(JSON.stringify(result)).not.toContain('outside secret');
    });

    test('skips corrupted lines and does not match text outside the message body', async () => {
        const library = createLibrary();
        const header = JSON.stringify({ chat_metadata: {}, user_name: 'unused', character_name: 'unused' });
        const valid = JSON.stringify(message('a valid dragon line'));
        library.writeCharacterChat('alice', 'with-corruption', null, {
            raw: [header, '{"name":"Alice","mes":"a truncated dragon', valid, 'not json at all dragon', ''].join('\n'),
        });
        library.writeCharacterChat('alice', 'only-corruption', null, {
            raw: [header, '{"name":"Alice","mes":"a truncated dragon', 'dragon dragon'].join('\n'),
        });
        // The word occurs in the speaker name, but not in what was said
        library.writeCharacterChat('alice', 'speaker-only', [message('hello there', { name: 'Dragonfly' })]);

        const result = await searchAllResult(library, { query: 'dragon' });

        expect(result.results.map(hit => hit.file_id)).toEqual(['with-corruption']);
        expect(result.results[0]).toMatchObject({ matchCount: 1 });
        expect(result.results[0].snippets[0].text).toBe('a valid dragon line');
    });

    test('finds terms that JSON escapes in the stored line', async () => {
        const library = createLibrary();
        library.writeCharacterChat('alice', 'quotes', [message('She said "hello dragon" loudly.')]);
        library.writeCharacterChat('alice', 'backslash', [message('Path C:\\games\\dragon')]);

        const quoted = await searchAllResult(library, { query: '"hello' });
        expect(quoted.results.map(hit => hit.file_id)).toEqual(['quotes']);
        expect(highlightedTexts(quoted.results[0].snippets[0])).toEqual(['"hello']);

        const slashed = await searchAllResult(library, { query: 'c:\\games' });
        expect(slashed.results.map(hit => hit.file_id)).toEqual(['backslash']);
    });

    test('only searches the requested kind of chats', async () => {
        const library = createLibrary();
        library.writeCharacterChat('alice', 'alice-chat', [message('dragon')]);
        library.writeGroupChat('group-chat', [message('dragon')]);
        library.writeGroup({ id: 'group-one', name: 'G', chats: ['group-chat'] });
        // A chat lying directly in the chats directory has no owner to open it with
        fs.writeFileSync(path.join(library.directories.chats, 'stray.jsonl'), serializeChat([message('dragon')]));

        const all = await searchAllResult(library, { query: 'dragon' });
        const characters = await searchAllResult(library, { query: 'dragon', scope: 'characters' });
        const groups = await searchAllResult(library, { query: 'dragon', scope: 'groups' });

        expect(all.results.map(hit => hit.kind).sort()).toEqual(['character', 'group']);
        expect(all.totalFiles).toBe(2);
        expect(characters.results.map(hit => hit.kind)).toEqual(['character']);
        expect(groups.results.map(hit => hit.kind)).toEqual(['group']);
    });

    test('ignores chat folders whose character card no longer exists', async () => {
        const library = createLibrary();
        fs.mkdirSync(path.join(library.directories.chats, 'deleted'));
        fs.writeFileSync(path.join(library.directories.chats, 'deleted', 'old.jsonl'), serializeChat([message('dragon')]));
        library.writeCharacterChat('alice', 'kept', [message('dragon')]);

        const result = await searchAllResult(library, { query: 'dragon' });

        expect(result.results.map(hit => hit.file_id)).toEqual(['kept']);
    });

    test('rejects invalid requests with a 400 error code', async () => {
        const library = createLibrary();
        library.writeCharacterChat('alice', 'chat', [message('a dragon')]);

        for (const [body, error] of [
            [{ query: 'a' }, 'query_too_short'],
            [{ query: '   ' }, 'query_required'],
            [{}, 'query_required'],
            [{ query: 42 }, 'query_required'],
            [{ query: 'x'.repeat(201) }, 'query_too_long'],
            [{ query: 'a b c d e f g h i j k' }, 'too_many_terms'],
            [{ query: 'dragon', scope: 'everything' }, 'invalid_scope'],
        ]) {
            const response = await searchAll(library, body);
            expect(response.status).toHaveBeenCalledWith(400);
            expect(response.send).toHaveBeenCalledWith({ error, message: expect.any(String) });
        }
    });
});

describe('chat search request parsing', () => {
    test('accepts a single CJK character but not a single Latin character', () => {
        expect(parseChatSearchAllRequest({ query: '龙' }).ok).toBe(true);
        expect(parseChatSearchAllRequest({ query: 'あ' }).ok).toBe(true);
        expect(parseChatSearchAllRequest({ query: '한' }).ok).toBe(true);
        expect(parseChatSearchAllRequest({ query: 'a' })).toMatchObject({ ok: false, error: 'query_too_short' });
        expect(parseChatSearchAllRequest({ query: '😀' })).toMatchObject({ ok: false, error: 'query_too_short' });
        expect(parseChatSearchAllRequest({ query: 'ab' }).ok).toBe(true);
    });

    test('applies defaults, clamps the numbers and de-duplicates the words', () => {
        expect(parseChatSearchAllRequest({ query: ' Dragon  CASTLE dragon ' })).toEqual({
            ok: true,
            options: { terms: ['dragon', 'castle'], scope: 'all', limit: 50, snippetsPerChat: 3, timeoutMs: 8000 },
        });
        expect(parseChatSearchAllRequest({ query: 'ab', limit: 9999, snippetsPerChat: 99, timeoutMs: 999999 }).options)
            .toMatchObject({ limit: 200, snippetsPerChat: 10, timeoutMs: 15000 });
        expect(parseChatSearchAllRequest({ query: 'ab', limit: 0, snippetsPerChat: -1, timeoutMs: -5 }).options)
            .toMatchObject({ limit: 1, snippetsPerChat: 0, timeoutMs: 1 });
        expect(parseChatSearchAllRequest({ query: 'ab', limit: 'abc', snippetsPerChat: null, timeoutMs: {} }).options)
            .toMatchObject({ limit: 50, snippetsPerChat: 3, timeoutMs: 8000 });
        expect(parseChatSearchAllRequest({ query: 'ab', limit: '7' }).options.limit).toBe(7);
    });
});

describe('recent chats keep their shape after the shared listing helper was extracted', () => {
    test('lists character, group and root chats with their owners', async () => {
        const library = createLibrary();
        library.writeCharacterChat('alice', 'alice-chat', [message('hello')]);
        library.writeGroupChat('group-chat', [message('hello group')]);
        library.writeGroup({ id: 'group-one', name: 'G', chats: ['group-chat', '../../escape'] });
        fs.writeFileSync(path.join(library.directories.chats, 'stray.jsonl'), serializeChat([message('stray hello')]));
        fs.mkdirSync(path.join(library.directories.chats, 'no-card'));
        fs.writeFileSync(path.join(library.directories.chats, 'no-card', 'old.jsonl'), serializeChat([message('no card')]));

        const response = createResponse();
        await getRouteHandler(chatRouter, '/recent')({ body: {}, user: { directories: library.directories } }, response);
        const recent = response.send.mock.calls[0][0];

        expect(recent.map(chat => chat.file_id).sort()).toEqual(['alice-chat', 'group-chat', 'stray']);
        expect(recent.find(chat => chat.file_id === 'alice-chat')).toMatchObject({ avatar: 'alice.png', chat_items: 1, mes: 'hello' });
        expect(recent.find(chat => chat.file_id === 'group-chat')).toMatchObject({ group: 'group-one', chat_items: 1 });
        expect(recent.find(chat => chat.file_id === 'stray').avatar).toBeUndefined();
    });
});
