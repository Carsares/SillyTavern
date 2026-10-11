import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';

let duplicateGreetings;
let dataMaid;
let characterCardParser;
let fileIdentity;
let reportHandler;
let resolveHandler;
let seraphinaPng;
const tempDirectories = [];

const HANDLE = 'test-user';
const LEGACY_NAME = 'Alice - 2026-07-03@18h14m24s106ms.jsonl';
const LEGACY_SEND_DATE = '2026-07-03T10:14:24.106Z';
const MODERN_NAME = 'Modern 2026-07-03T10-14-22-467Z.jsonl';
const GREETING = 'Hello {{user}}, I am {{char}}.';

beforeAll(async () => {
    const { setConfigFilePath } = await import('../src/util.js');
    setConfigFilePath(fileURLToPath(new URL('../config.yaml', import.meta.url)));
    duplicateGreetings = await import('../src/data-maid-duplicate-greetings.js');
    dataMaid = await import('../src/endpoints/data-maid.js');
    characterCardParser = await import('../src/character-card-parser.js');
    fileIdentity = await import('../src/file-identity.js');
    reportHandler = dataMaid.router.stack.find(layer => layer.route?.path === '/duplicate-greetings').route.stack[0].handle;
    resolveHandler = dataMaid.router.stack.find(layer => layer.route?.path === '/duplicate-greetings/resolve').route.stack[0].handle;
    seraphinaPng = fs.readFileSync(fileURLToPath(new URL('../default/content/default_Seraphina.png', import.meta.url)));
});

afterEach(() => {
    dataMaid.DUPLICATE_GREETING_TOKENS.clear();
    jest.restoreAllMocks();
    for (const directory of tempDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function jsonl(...entries) {
    return entries.map(entry => JSON.stringify(entry)).join('\n');
}

function header(metadata = { integrity: 'abc-123' }) {
    return { chat_metadata: metadata, user_name: 'unused', character_name: 'unused' };
}

function greetingMessage(overrides = {}) {
    return {
        name: 'Alice',
        is_user: false,
        is_system: false,
        send_date: LEGACY_SEND_DATE,
        mes: GREETING,
        extra: {},
        ...overrides,
    };
}

function writeCard(directories, avatarBase, overrides = {}) {
    const card = {
        name: 'Alice',
        first_mes: GREETING,
        chat: 'Alice - elsewhere',
        data: { name: 'Alice', first_mes: GREETING, alternate_greetings: ['Hi there, {{user}}!'] },
        ...overrides,
    };
    fs.writeFileSync(path.join(directories.characters, `${avatarBase}.png`), characterCardParser.write(seraphinaPng, JSON.stringify(card)));
}

/**
 * Builds a user directory with one character ("Alice.png"), a legacy greeting-only chat and its Modern sibling.
 * Each part can be replaced or dropped through the options.
 */
function createFixture({ card = {}, legacy, modern, modernFileName = MODERN_NAME, noModern = false, noCharacter = false, settings } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sillytavern-duplicate-greetings-'));
    tempDirectories.push(root);
    const directories = {
        root,
        chats: path.join(root, 'chats'),
        characters: path.join(root, 'characters'),
        backups: path.join(root, 'backups'),
    };
    Object.values(directories).filter(directory => directory !== root).forEach(directory => fs.mkdirSync(directory));
    const chatDirectory = path.join(directories.chats, 'Alice');
    fs.mkdirSync(chatDirectory);

    if (!noCharacter) {
        writeCard(directories, 'Alice', card);
    }
    const legacyPath = path.join(chatDirectory, LEGACY_NAME);
    fs.writeFileSync(legacyPath, legacy ?? jsonl(header(), greetingMessage()));
    const modernPath = path.join(chatDirectory, modernFileName);
    if (!noModern) {
        fs.writeFileSync(modernPath, modern ?? jsonl(header(), greetingMessage({ extra: { api: 'modern' } }), { name: 'You', is_user: true, mes: 'hi', send_date: LEGACY_SEND_DATE }));
    }
    if (settings) {
        fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify(settings));
    }
    return { directories, chatDirectory, legacyPath, modernPath };
}

async function findCandidates(directories) {
    return (await duplicateGreetings.findDuplicateGreetingChats(directories)).candidates;
}

function createResponse() {
    return {
        statusCode: 200,
        body: undefined,
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

async function callReport(directories, handle = HANDLE) {
    const response = createResponse();
    await reportHandler({ body: {}, user: { profile: { handle }, directories } }, response);
    return response;
}

async function callResolve(directories, body, handle = HANDLE) {
    const response = createResponse();
    await resolveHandler({ body, user: { profile: { handle }, directories } }, response);
    return response;
}

describe('duplicate greeting-only chat detection', () => {
    test('lists a legacy greeting-only chat that has a Modern sibling and describes both files', async () => {
        const { directories } = createFixture();

        const candidates = await findCandidates(directories);

        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({
            avatarBase: 'Alice',
            fileName: LEGACY_NAME,
            characterName: 'Alice',
            isCardChat: false,
            swipeCount: 1,
            modern: { fileName: MODERN_NAME, messageCount: 2, startsWithSameGreeting: true },
        });
        expect(candidates[0].modern.timeDeltaMs).toBeLessThan(5000);
    });

    test('accepts a greeting stored after {{char}} / {{user}} substitution, using the persona names from settings', async () => {
        const { directories } = createFixture({
            legacy: jsonl(header(), greetingMessage({ mes: 'Hello Bob, I am Alice.' })),
            settings: { username: 'Bob', power_user: { personas: { 'p.png': 'Carol' } } },
        });
        expect(await findCandidates(directories)).toHaveLength(1);

        const stranger = createFixture({ legacy: jsonl(header(), greetingMessage({ mes: 'Hello Mallory, I am Alice.' })) });
        expect(await findCandidates(stranger.directories)).toHaveLength(0);
    });

    test('accepts swipes made only of the card greetings and rejects a swipe that is not one', async () => {
        const swipes = [GREETING, 'Hi there, {{user}}!'];
        const swipeInfo = swipes.map(() => ({ send_date: LEGACY_SEND_DATE, extra: {} }));
        const good = createFixture({ legacy: jsonl(header(), greetingMessage({ swipes, swipe_id: 0, swipe_info: swipeInfo })) });
        const candidates = await findCandidates(good.directories);
        expect(candidates).toHaveLength(1);
        expect(candidates[0].swipeCount).toBe(2);

        const custom = createFixture({ legacy: jsonl(header(), greetingMessage({ swipes: [GREETING, 'My own reroll'], swipe_id: 0 })) });
        expect(await findCandidates(custom.directories)).toHaveLength(0);
    });

    const rejectedChats = [
        ['a user message', 'user-or-system', { legacy: jsonl(header(), greetingMessage({ is_user: true })) }],
        ['a system message', 'user-or-system', { legacy: jsonl(header(), greetingMessage({ is_system: true })) }],
        ['a Modern-sourced message (extra.api = modern)', 'modern-source', { legacy: jsonl(header(), greetingMessage({ extra: { api: 'modern' } })) }],
        ['media on the message', 'media-or-extra', { legacy: jsonl(header(), greetingMessage({ extra: { media: [{ url: 'user/images/a.png' }] } })) }],
        ['an image on the message', 'media-or-extra', { legacy: jsonl(header(), greetingMessage({ extra: { image: 'user/images/a.png' } })) }],
        ['an attachment on the message', 'media-or-extra', { legacy: jsonl(header(), greetingMessage({ extra: { files: [{ url: 'user/files/a.txt' }] } })) }],
        ['text that is not a greeting of the card', 'not-greeting', { legacy: jsonl(header(), greetingMessage({ mes: 'Something the user typed into the greeting' })) }],
        ['a second message', 'message-count', { legacy: jsonl(header(), greetingMessage(), greetingMessage({ mes: 'More' })) }],
        ['no message', 'message-count', { legacy: jsonl(header()) }],
        ['no chat header', 'no-header', { legacy: jsonl(greetingMessage()) }],
        ['a broken line', 'unparseable', { legacy: `${jsonl(header())}\n{not json` }],
        ['an unparseable send date', 'send-date', { legacy: jsonl(header(), greetingMessage({ send_date: 'July 3, 2026 6:14pm' })) }],
        ['a locked chat background', 'metadata', { legacy: jsonl(header({ integrity: 'x', custom_background: 'url("backgrounds/a.png")' }), greetingMessage()) }],
        ['chat background files', 'metadata', { legacy: jsonl(header({ integrity: 'x', chat_backgrounds: ['user/images/a.png'] }), greetingMessage()) }],
        ['attachments in the metadata', 'metadata', { legacy: jsonl(header({ integrity: 'x', attachments: [{ url: 'user/files/a.txt' }] }), greetingMessage()) }],
        ['a written author\'s note', 'metadata', { legacy: jsonl(header({ integrity: 'x', note_prompt: 'Keep it short' }), greetingMessage()) }],
        ['an unknown metadata key with content', 'metadata', { legacy: jsonl(header({ integrity: 'x', tainted: true }), greetingMessage()) }],
        ['no Modern sibling', 'no-modern-sibling', { noModern: true }],
        ['a Modern sibling more than 30 minutes away', 'no-modern-sibling', { modern: jsonl(header(), greetingMessage({ extra: { api: 'modern' } })), modernFileName: 'Modern 2026-07-03T08-14-22-467Z.jsonl' }],
        ['a Modern sibling with one message that is not the greeting', 'no-modern-sibling', { modern: jsonl(header(), greetingMessage({ mes: 'Hi there, {{user}}!', extra: { api: 'modern' } })) }],
        ['a card that does not exist', 'no-character', { noCharacter: true }],
        ['a card with another name', 'name-mismatch', { card: { name: 'Alicia', data: { name: 'Alicia', first_mes: GREETING } } }],
    ];
    for (const [label, reason, options] of rejectedChats) {
        test(`does not list a chat with ${label}`, async () => {
            const { directories } = createFixture(options);

            expect(await findCandidates(directories)).toHaveLength(0);
            // It is the named condition that rejects the file, not an unrelated problem of the fixture
            const verdict = await duplicateGreetings.createDuplicateGreetingInspector(directories).inspect('Alice', LEGACY_NAME);
            expect(verdict).toEqual({ ok: false, reason });
        });
    }

    test('lists a chat that the character card points at and flags it', async () => {
        const { directories } = createFixture({ card: { chat: LEGACY_NAME.replace(/\.jsonl$/, '') } });

        const candidates = await findCandidates(directories);

        expect(candidates).toHaveLength(1);
        expect(candidates[0].isCardChat).toBe(true);
    });

    test('accepts a Modern sibling of one message when it starts with the same greeting, within the window either side', async () => {
        const { directories, chatDirectory, modernPath } = createFixture({ modern: jsonl(header(), greetingMessage({ extra: { api: 'modern' } })) });
        expect(await findCandidates(directories)).toHaveLength(1);

        // 29 minutes after the greeting counts, the file name time is UTC and independent of the local time in the legacy file name
        fs.renameSync(modernPath, path.join(chatDirectory, 'Modern 2026-07-03T10-43-24-106Z.jsonl'));
        expect(await findCandidates(directories)).toHaveLength(1);
        fs.renameSync(path.join(chatDirectory, 'Modern 2026-07-03T10-43-24-106Z.jsonl'), path.join(chatDirectory, 'Modern 2026-07-03T10-45-24-106Z.jsonl'));
        expect(await findCandidates(directories)).toHaveLength(0);
    });

    test('never follows a symbolic link to a chat folder or a chat file', async () => {
        const { directories, chatDirectory, legacyPath } = createFixture();
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sillytavern-duplicate-outside-'));
        tempDirectories.push(outside);
        fs.writeFileSync(path.join(outside, LEGACY_NAME), jsonl(header(), greetingMessage()));
        fs.rmSync(legacyPath);
        fs.symlinkSync(path.join(outside, LEGACY_NAME), legacyPath);
        expect(await findCandidates(directories)).toHaveLength(0);

        fs.rmSync(chatDirectory, { recursive: true });
        fs.symlinkSync(outside, path.join(directories.chats, 'Alice'));
        fs.writeFileSync(path.join(outside, MODERN_NAME), jsonl(header(), greetingMessage()));
        expect(await findCandidates(directories)).toHaveLength(0);
    });
});

describe('duplicate greeting-only chat resolve', () => {
    async function reportFor(directories) {
        const response = await callReport(directories);
        if (response.statusCode !== 200) {
            throw new Error(`The report was refused with ${response.statusCode}`);
        }
        return response.body;
    }

    test('the report hides absolute paths and the token is kept apart from the clean-up tokens', async () => {
        const { directories } = createFixture();
        const cleanupToken = dataMaid.DataMaidService.generateToken(HANDLE, { files: [] });

        const report = await reportFor(directories);

        expect(report.items).toHaveLength(1);
        expect(JSON.stringify(report)).not.toContain(directories.root);
        expect(report.items[0]).toMatchObject({ avatar: 'Alice.png', file: LEGACY_NAME, isCardChat: false, modern: { file: MODERN_NAME } });
        expect(dataMaid.DataMaidService.TOKENS.has(cleanupToken)).toBe(true);
        dataMaid.DataMaidService.TOKENS.delete(cleanupToken);
    });

    test('moves the file into a quarantine folder with a manifest and deletes nothing', async () => {
        const { directories, legacyPath, modernPath } = createFixture();
        const original = fs.readFileSync(legacyPath, 'utf8');
        const modernContent = fs.readFileSync(modernPath, 'utf8');
        const { token, items } = await reportFor(directories);

        const response = await callResolve(directories, { token, hashes: [items[0].hash] });

        expect(response.statusCode).toBe(200);
        expect(response.body.skipped).toEqual([]);
        expect(response.body.moved).toHaveLength(1);
        const moved = response.body.moved[0];
        expect(moved.from).toBe(`chats/Alice/${LEGACY_NAME}`);
        expect(moved.to).toMatch(/^backups\/quarantine-\d{8}-\d{6}(-\d+)?\/chats\/Alice\//);
        expect(response.body.quarantine).toBe(moved.to.split('/').slice(0, 2).join('/'));
        expect(fs.existsSync(legacyPath)).toBe(false);
        expect(fs.readFileSync(path.join(directories.root, moved.to), 'utf8')).toBe(original);
        expect(fs.readFileSync(modernPath, 'utf8')).toBe(modernContent);

        const manifest = JSON.parse(fs.readFileSync(path.join(directories.root, response.body.quarantine, 'manifest.json'), 'utf8'));
        expect(manifest.items).toEqual([expect.objectContaining({ avatar: 'Alice.png', file: LEGACY_NAME, from: moved.from, to: moved.to, modern: MODERN_NAME })]);
    });

    test('skips a file that was replaced after the report and keeps it', async () => {
        const { directories, legacyPath } = createFixture();
        const { token, items } = await reportFor(directories);
        fs.rmSync(legacyPath);
        fs.writeFileSync(legacyPath, jsonl(header({ integrity: 'new' }), greetingMessage()));

        const response = await callResolve(directories, { token, hashes: [items[0].hash] });

        expect(response.body.moved).toEqual([]);
        expect(response.body.skipped).toEqual([expect.objectContaining({ hash: items[0].hash, reason: 'changed' })]);
        expect(fs.existsSync(legacyPath)).toBe(true);
        expect(fs.readdirSync(directories.backups)).toEqual([]);
    });

    test('re-checks the rule at resolve time even when the file identity still matches', async () => {
        const { directories, legacyPath } = createFixture();
        const { token, items } = await reportFor(directories);
        // The user chatted in the file after the report; the token is made to hold the new identity so only the rule can stop the move
        fs.appendFileSync(legacyPath, `\n${JSON.stringify({ name: 'You', is_user: true, mes: 'hi', send_date: LEGACY_SEND_DATE })}`);
        dataMaid.DUPLICATE_GREETING_TOKENS.get(token).items.get(items[0].hash).identity = fileIdentity.getFileIdentity(legacyPath);

        const response = await callResolve(directories, { token, hashes: [items[0].hash] });

        expect(response.body.moved).toEqual([]);
        expect(response.body.skipped).toEqual([expect.objectContaining({ reason: 'message-count' })]);
        expect(fs.existsSync(legacyPath)).toBe(true);
    });

    test('re-checks the rule at resolve time: a Modern sibling that disappeared blocks the move', async () => {
        const { directories, legacyPath, modernPath } = createFixture();
        const { token, items } = await reportFor(directories);
        fs.rmSync(modernPath);

        const response = await callResolve(directories, { token, hashes: [items[0].hash] });

        expect(response.body.moved).toEqual([]);
        expect(response.body.skipped).toEqual([expect.objectContaining({ reason: 'no-modern-sibling' })]);
        expect(fs.existsSync(legacyPath)).toBe(true);
    });

    test('a chat that the card points at is skipped until the card is repointed', async () => {
        const { directories, legacyPath } = createFixture({ card: { chat: LEGACY_NAME.replace(/\.jsonl$/, '') } });
        const report = await reportFor(directories);
        expect(report.items[0].isCardChat).toBe(true);

        const blocked = await callResolve(directories, { token: report.token, hashes: [report.items[0].hash] });
        expect(blocked.body.moved).toEqual([]);
        expect(blocked.body.skipped).toEqual([expect.objectContaining({ reason: 'card-chat' })]);
        expect(fs.existsSync(legacyPath)).toBe(true);
        expect(fs.readdirSync(directories.backups)).toEqual([]);

        writeCard(directories, 'Alice', { chat: MODERN_NAME.replace(/\.jsonl$/, '') });
        const second = await reportFor(directories);
        expect(second.items[0].isCardChat).toBe(false);
        const moved = await callResolve(directories, { token: second.token, hashes: [second.items[0].hash] });
        expect(moved.body.moved).toHaveLength(1);
        expect(fs.existsSync(legacyPath)).toBe(false);
    });

    test('a hash can be used once, an unknown hash is reported, and another user cannot use the token', async () => {
        const { directories } = createFixture();
        const { token, items } = await reportFor(directories);

        const intruder = await callResolve(directories, { token, hashes: [items[0].hash] }, 'someone-else');
        expect(intruder.statusCode).toBe(403);
        expect(fs.readdirSync(directories.backups)).toEqual([]);

        const first = await callResolve(directories, { token, hashes: [items[0].hash, 'f'.repeat(64)] });
        expect(first.body.moved).toHaveLength(1);
        expect(first.body.skipped).toEqual([{ hash: 'f'.repeat(64), reason: 'unknown' }]);

        const replay = await callResolve(directories, { token, hashes: [items[0].hash] });
        expect(replay.body.moved).toEqual([]);
        expect(replay.body.skipped).toEqual([{ hash: items[0].hash, reason: 'unknown' }]);
    });

    test('rejects malformed requests and expired or unknown tokens without touching files', async () => {
        const { directories, legacyPath } = createFixture();
        const { token, items } = await reportFor(directories);

        expect((await callResolve(directories, { token })).statusCode).toBe(400);
        expect((await callResolve(directories, { token, hashes: [] })).statusCode).toBe(400);
        expect((await callResolve(directories, { token, hashes: [42] })).statusCode).toBe(400);
        expect((await callResolve(directories, { token: 'nope', hashes: [items[0].hash] })).statusCode).toBe(403);

        dataMaid.DUPLICATE_GREETING_TOKENS.get(token).createdAt = Date.now() - duplicateGreetings.DUPLICATE_GREETING_TOKEN_TTL_MS - 1000;
        expect((await callResolve(directories, { token, hashes: [items[0].hash] })).statusCode).toBe(403);
        expect(fs.existsSync(legacyPath)).toBe(true);
    });

    test('a new report replaces the previous token of the same user only', async () => {
        const { directories } = createFixture();
        const first = await reportFor(directories);
        dataMaid.DUPLICATE_GREETING_TOKENS.set('other-user-token', { handle: 'other', createdAt: Date.now(), items: new Map() });

        const second = await reportFor(directories);

        expect(dataMaid.DUPLICATE_GREETING_TOKENS.has(first.token)).toBe(false);
        expect(dataMaid.DUPLICATE_GREETING_TOKENS.has(second.token)).toBe(true);
        expect(dataMaid.DUPLICATE_GREETING_TOKENS.has('other-user-token')).toBe(true);
    });

    test('a file swapped for a symbolic link is neither moved nor followed', async () => {
        const { directories, legacyPath } = createFixture();
        const { token, items } = await reportFor(directories);
        const outside = path.join(os.tmpdir(), `sillytavern-duplicate-link-target-${process.pid}.jsonl`);
        fs.writeFileSync(outside, 'outside content');
        tempDirectories.push(outside);
        fs.rmSync(legacyPath);
        fs.symlinkSync(outside, legacyPath);

        const response = await callResolve(directories, { token, hashes: [items[0].hash] });

        expect(response.body.moved).toEqual([]);
        expect(fs.readFileSync(outside, 'utf8')).toBe('outside content');
        expect(fs.lstatSync(legacyPath).isSymbolicLink()).toBe(true);
        expect(fs.readdirSync(directories.backups)).toEqual([]);
    });

    test('moves several files in one quarantine folder and reports a failed move without stopping', async () => {
        const { directories, chatDirectory } = createFixture();
        const secondName = 'Alice - 2026-07-03@18h14m25s000ms.jsonl';
        fs.writeFileSync(path.join(chatDirectory, secondName), jsonl(header({ integrity: 'second' }), greetingMessage({ send_date: '2026-07-03T10:14:25.000Z' })));
        const { token, items } = await reportFor(directories);
        expect(items).toHaveLength(2);
        const realRename = fs.promises.rename;
        let calls = 0;
        jest.spyOn(fs.promises, 'rename').mockImplementation(async (...args) => {
            calls++;
            if (calls === 1) {
                throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
            }
            return realRename(...args);
        });
        jest.spyOn(console, 'error').mockImplementation(() => {});

        const response = await callResolve(directories, { token, hashes: items.map(item => item.hash) });

        expect(response.body.moved).toHaveLength(1);
        expect(response.body.skipped).toEqual([expect.objectContaining({ reason: 'failed' })]);
        const remaining = fs.readdirSync(chatDirectory).filter(name => duplicateGreetings.LEGACY_CHAT_FILE_REGEXP.test(name));
        expect(remaining).toHaveLength(1);
        expect(fs.readdirSync(directories.backups)).toHaveLength(1);
    });
});
