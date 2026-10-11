import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, jest, test } from '@jest/globals';

import { createCharacterEmbeddedWorldActions } from '../public/modern/actions/character-embedded-world.js';
import { createWorldbookDetailActions } from '../public/modern/actions/worldbook-details.js';
import {
    convertCharacterBook,
    findExistingWorldName,
    getEmbeddedBookInfo,
    pickAlternateWorldName,
} from '../public/modern/core/character-book.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- 对照旧版：直接从旧版源码里取出 convertCharacterBook 和它依赖的常量，在这里运行，旧版改了字段映射这组测试会失败 ----

function readSource(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function sliceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    if (start < 0) {
        throw new Error(`Legacy source marker not found: ${startMarker}`);
    }
    const end = source.indexOf(endMarker, start);
    if (end < 0) {
        throw new Error(`Legacy source end marker not found: ${endMarker}`);
    }
    return source.slice(start, end);
}

function extractConstant(source, name) {
    const match = new RegExp(`export const ${name} = (\\{[\\s\\S]*?\\n\\}|[0-9]+);`).exec(source);
    if (!match) {
        throw new Error(`Legacy constant not found: ${name}`);
    }
    return new Function(`return (${match[1]});`)();
}

function loadLegacyConverter() {
    const worldInfoSource = readSource('public/scripts/world-info.js');
    const scriptSource = readSource('public/script.js');
    const constants = {
        world_info_logic: extractConstant(worldInfoSource, 'world_info_logic'),
        world_info_position: extractConstant(worldInfoSource, 'world_info_position'),
        extension_prompt_roles: extractConstant(scriptSource, 'extension_prompt_roles'),
        DEFAULT_DEPTH: extractConstant(worldInfoSource, 'DEFAULT_DEPTH'),
        DEFAULT_WEIGHT: extractConstant(worldInfoSource, 'DEFAULT_WEIGHT'),
        GENERATION_TYPE_TRIGGERS: [],
    };
    const definition = sliceBetween(worldInfoSource, 'export const newWorldInfoEntryDefinition = {', '\n};\n') + '\n};\n';
    const template = sliceBetween(worldInfoSource, 'export const newWorldInfoEntryTemplate = ', '\n);\n') + '\n);\n';
    const converter = sliceBetween(worldInfoSource, 'export function convertCharacterBook(', 'export function setWorldInfoButtonClass');
    const names = Object.keys(constants);
    const factory = new Function(...names, `${(definition + template + converter).replaceAll('export ', '')}\nreturn { convertCharacterBook, newWorldInfoEntryTemplate };`);
    return factory(...names.map(name => constants[name]));
}

const legacy = loadLegacyConverter();

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
    }
    return value;
}

function richBook() {
    return {
        name: 'Rich Lore',
        description: 'desc',
        scan_depth: 4,
        token_budget: 512,
        recursive_scanning: true,
        extensions: {},
        entries: [
            {
                id: 7,
                keys: ['dragon', 'wyrm'],
                secondary_keys: ['fire'],
                comment: 'Dragons',
                content: 'Dragons breathe fire.',
                constant: true,
                selective: true,
                insertion_order: 50,
                enabled: true,
                position: 'after_char',
                extensions: {
                    position: 4,
                    depth: 2,
                    role: 1,
                    exclude_recursion: true,
                    prevent_recursion: true,
                    delay_until_recursion: true,
                    display_index: 9,
                    probability: 80,
                    useProbability: false,
                    selectiveLogic: 3,
                    outlet_name: 'outlet',
                    group: 'g1',
                    group_override: true,
                    group_weight: 40,
                    scan_depth: 6,
                    case_sensitive: true,
                    match_whole_words: false,
                    use_group_scoring: true,
                    automation_id: 'auto',
                    vectorized: true,
                    sticky: 3,
                    cooldown: 4,
                    delay: 5,
                    match_persona_description: true,
                    match_character_description: true,
                    match_character_personality: true,
                    match_character_depth_prompt: true,
                    match_scenario: true,
                    match_creator_notes: true,
                    triggers: ['normal', 'continue'],
                    ignore_budget: true,
                    custom_flag: 'kept',
                },
            },
            {
                id: 2,
                keys: ['castle'],
                secondary_keys: [],
                comment: '',
                content: 'A castle.',
                constant: false,
                selective: false,
                insertion_order: 100,
                enabled: false,
                position: 'before_char',
            },
        ],
    };
}

describe('convertCharacterBook parity with the legacy implementation', () => {
    test('maps every field the same way for entries that carry all required card fields', () => {
        const input = richBook();
        const expected = legacy.convertCharacterBook(structuredClone(input));
        const actual = convertCharacterBook(input);

        expect(actual.entries).toEqual(expected.entries);
        expect(actual.originalData).toEqual(expected.originalData);
    });

    test('matches legacy for entries without ids (index is the id) and for the position fallbacks', () => {
        const input = {
            name: 'No ids',
            extensions: {},
            entries: [
                { keys: ['a'], content: 'A', insertion_order: 1, enabled: true, position: 'before_char', extensions: {} },
                { keys: ['b'], content: 'B', insertion_order: 2, enabled: true, position: 'after_char' },
                { keys: ['c'], content: 'C', insertion_order: 3, enabled: true, extensions: { position: 6 } },
            ],
        };
        const expected = legacy.convertCharacterBook(structuredClone(input));
        const actual = convertCharacterBook(input);

        expect(Object.keys(actual.entries)).toEqual(['0', '1', '2']);
        expect(actual.entries).toEqual(expected.entries);
        expect(actual.originalData).toEqual(expected.originalData);
        expect(actual.entries[0].position).toBe(0);
        expect(actual.entries[1].position).toBe(1);
        expect(actual.entries[2].position).toBe(6);
    });
});

describe('convertCharacterBook', () => {
    test('does not modify the input book (legacy fills ids into the caller\'s entries)', () => {
        const input = deepFreeze({
            name: 'Frozen',
            extensions: {},
            entries: [{ keys: ['a'], content: 'A', insertion_order: 1, enabled: true, extensions: { depth: 3 } }],
        });
        const snapshot = structuredClone(input);

        const result = convertCharacterBook(input);

        expect(input).toEqual(snapshot);
        expect(input.entries[0].id).toBeUndefined();
        expect(result.originalData.entries[0].id).toBe(0);
        expect(result.originalData).not.toBe(input);
        expect(result.entries[0].extensions).not.toBe(input.entries[0].extensions);
    });

    test('maps disabled entries, constant and selective flags', () => {
        const { entries } = convertCharacterBook(richBook());

        expect(entries[7]).toMatchObject({ uid: 7, disable: false, constant: true, selective: true, order: 50, addMemo: true, comment: 'Dragons' });
        expect(entries[2]).toMatchObject({ uid: 2, disable: true, constant: false, selective: false, order: 100, addMemo: false, position: 0 });
    });

    test('maps position, depth, role, sticky and the other extension fields', () => {
        const { entries } = convertCharacterBook(richBook());

        expect(entries[7]).toMatchObject({
            position: 4,
            depth: 2,
            role: 1,
            sticky: 3,
            cooldown: 4,
            delay: 5,
            excludeRecursion: true,
            preventRecursion: true,
            delayUntilRecursion: true,
            displayIndex: 9,
            probability: 80,
            useProbability: false,
            selectiveLogic: 3,
            outletName: 'outlet',
            group: 'g1',
            groupOverride: true,
            groupWeight: 40,
            scanDepth: 6,
            caseSensitive: true,
            matchWholeWords: false,
            useGroupScoring: true,
            automationId: 'auto',
            vectorized: true,
            ignoreBudget: true,
            triggers: ['normal', 'continue'],
            matchPersonaDescription: true,
            matchCharacterDescription: true,
            matchCharacterPersonality: true,
            matchCharacterDepthPrompt: true,
            matchScenario: true,
            matchCreatorNotes: true,
        });
        expect(entries[7].extensions.custom_flag).toBe('kept');
        expect(entries[7].key).toEqual(['dragon', 'wyrm']);
        expect(entries[7].keysecondary).toEqual(['fire']);
    });

    test('uses the world book defaults for every extension field a plain entry does not have', () => {
        const { entries } = convertCharacterBook({ entries: [{ keys: ['x'], content: 'X', insertion_order: 10, enabled: true }] });

        expect(entries[0]).toMatchObject({
            depth: 4,
            role: 0,
            probability: 100,
            useProbability: true,
            selectiveLogic: 0,
            groupWeight: 100,
            scanDepth: null,
            caseSensitive: null,
            sticky: null,
            cooldown: null,
            delay: null,
            triggers: [],
            extensions: {},
            position: 1,
        });
    });

    test('normalizes missing fields instead of writing undefined', () => {
        const { entries } = convertCharacterBook({ entries: [{ comment: 'only a comment' }, { keys: 'a, b ,,c', content: 5 }] });

        expect(entries[0]).toMatchObject({ key: [], keysecondary: [], content: '', order: 100, disable: false });
        expect(entries[1]).toMatchObject({ key: ['a', 'b', 'c'], content: '5' });
        expect(Object.values(entries[0]).includes(undefined)).toBe(false);
    });

    test('keeps every entry when ids are missing or repeated (legacy lets the later entry overwrite the earlier one)', () => {
        const { entries, originalData } = convertCharacterBook({
            entries: [
                { id: 1, keys: ['a'], content: 'first with id 1' },
                { id: 1, keys: ['b'], content: 'second with id 1' },
                { keys: ['c'], content: 'no id, index 2' },
                { id: 0, keys: ['d'], content: 'id 0' },
            ],
        });

        expect(Object.keys(entries).sort()).toEqual(['0', '1', '2', '3']);
        expect(entries[1].content).toBe('first with id 1');
        expect(entries[0].content).toBe('id 0');
        expect(entries[2].content).toBe('no id, index 2');
        expect(entries[3].content).toBe('second with id 1');
        expect(originalData.entries.map(entry => entry.id)).toEqual([1, 3, 2, 0]);
    });

    test('tolerates a book without an entries array', () => {
        expect(convertCharacterBook({ name: 'Empty' }).entries).toEqual({});
        expect(convertCharacterBook(null).entries).toEqual({});
    });
});

describe('getEmbeddedBookInfo', () => {
    test('reports the entry count and the legacy default name', () => {
        const info = getEmbeddedBookInfo({ name: 'Alice', data: { name: 'Alice', character_book: { entries: [{}, {}] } } });
        expect(info).toMatchObject({ has: true, entryCount: 2, bookName: '', suggestedName: 'Alice\'s Lorebook' });
        expect(getEmbeddedBookInfo({ name: 'Alice', data: { character_book: { name: ' Lore ', entries: [{}] } } }).suggestedName).toBe('Lore');
    });

    test('does not count a missing or empty book', () => {
        expect(getEmbeddedBookInfo({ name: 'A', data: {} }).has).toBe(false);
        expect(getEmbeddedBookInfo({ name: 'A', data: { character_book: { entries: [] } } })).toMatchObject({ has: false, entryCount: 0 });
        expect(getEmbeddedBookInfo({ name: 'A', data: { character_book: { entries: 'bad' } } }).has).toBe(false);
        expect(getEmbeddedBookInfo(null).has).toBe(false);
        // 懒加载列表的摘要里没有 character_book
        expect(getEmbeddedBookInfo({ shallow: true, name: 'A', data: { name: 'A' } }).has).toBe(false);
    });
});

describe('world book name helpers', () => {
    test('finds clashes ignoring case and accents and keeps the existing spelling', () => {
        expect(findExistingWorldName(['Café Lore', 'Other'], 'cafe lore')).toBe('Café Lore');
        expect(findExistingWorldName(new Set(['Alpha']), 'ALPHA')).toBe('Alpha');
        expect(findExistingWorldName(['Alpha'], 'Beta')).toBeUndefined();
    });

    test('picks the first free numbered name', () => {
        expect(pickAlternateWorldName('Lore', ['Lore'])).toBe('Lore (2)');
        expect(pickAlternateWorldName('Lore', ['Lore', 'lore (2)'])).toBe('Lore (3)');
    });
});

// ---- 导入动作（不经过浏览器，apiFetch 用替身记录请求顺序） ----

function createCard({ name = 'Alice', world = '', book = true, bookExtensions = true, avatar = 'alice.png' } = {}) {
    return {
        avatar,
        name,
        data: {
            name,
            extensions: { world },
            ...(book
                ? {
                    character_book: {
                        name: 'Alice Lore',
                        ...(bookExtensions ? { extensions: {} } : {}),
                        entries: [
                            { keys: ['a'], content: 'A', insertion_order: 10, enabled: true },
                            { keys: ['b'], content: 'B', insertion_order: 20, enabled: false },
                        ],
                    },
                }
                : {}),
        },
    };
}

function createHarness({ card = createCard(), worldNames = [], settings = { power_user: {} }, handlers = {}, deps = {} } = {}) {
    const calls = [];
    const state = {
        characters: [card],
        characterDetails: {},
        worldbooks: worldNames.map(file_id => ({ file_id, name: file_id })),
        settingsBundle: { world_names: [...worldNames] },
        worldDetails: {},
        settings,
        errors: [],
        characterEmbeddedWorld: { prompt: '', importing: '', conflict: null },
    };
    const toasts = [];
    const syncLog = [];
    const apiFetch = jest.fn(async (url, options = {}) => {
        calls.push({ url, body: options.body });
        if (handlers[url]) {
            return handlers[url](options.body, calls);
        }
        if (url === '/api/files/sanitize-filename') {
            return { fileName: String(options.body.fileName).replace(/[\\/:*?"<>|]/g, '') };
        }
        if (url === '/api/worldinfo/edit') {
            return { ok: true };
        }
        if (url === '/api/characters/merge-attributes') {
            return { ok: true };
        }
        if (url === '/api/settings/save') {
            return { ok: true };
        }
        if (url === '/api/worldinfo/list') {
            return state.worldbooks;
        }
        throw new Error(`Unexpected URL ${url}`);
    });
    const loadCharacterDetail = jest.fn(async avatar => {
        calls.push({ url: 'loadCharacterDetail', body: avatar });
        state.characterDetails[avatar] = structuredClone(card);
        return state.characterDetails[avatar];
    });
    const actions = createCharacterEmbeddedWorldActions({
        state,
        apiFetch,
        loadData: async () => {
            calls.push({ url: 'loadData' });
        },
        render: () => {},
        showToast: (...args) => toasts.push(args),
        loadCharacterDetail,
        reloadCharacter: async () => {
            syncLog.push('reloadCharacter');
            calls.push({ url: 'reloadCharacter' });
            return { ok: true };
        },
        reloadWorldInfo: async names => {
            syncLog.push(['reloadWorldInfo', names]);
            calls.push({ url: 'reloadWorldInfo', body: names });
            return { ok: true };
        },
        ...deps,
    });
    return { actions, state, calls, toasts, syncLog, apiFetch, loadCharacterDetail };
}

const urls = calls => calls.map(call => call.url);

describe('importEmbeddedWorldbook', () => {
    test('writes the world book without overwrite, links it with merge-attributes, then reloads the engine', async () => {
        const harness = createHarness({ worldNames: ['Other'] });

        const result = await harness.actions.importEmbeddedWorldbook('alice.png', { onConflict: () => 'cancel' });

        expect(result).toMatchObject({ ok: true, status: 'imported', worldName: 'Alice Lore', entryCount: 2, linked: true, renamed: false, overwritten: false });
        expect(urls(harness.calls)).toEqual([
            'loadCharacterDetail',
            '/api/files/sanitize-filename',
            '/api/worldinfo/edit',
            '/api/characters/merge-attributes',
            'reloadCharacter',
            'reloadWorldInfo',
            'loadData',
            'loadCharacterDetail',
        ]);
        const edit = harness.calls.find(call => call.url === '/api/worldinfo/edit').body;
        expect(edit).toMatchObject({ name: 'Alice Lore', overwrite: false });
        expect(edit.data.name).toBe('Alice Lore');
        expect(Object.keys(edit.data.entries)).toEqual(['0', '1']);
        expect(edit.data.entries[1].disable).toBe(true);
        expect(edit.data.originalData.entries[0].id).toBe(0);
        const merge = harness.calls.find(call => call.url === '/api/characters/merge-attributes').body;
        expect(merge).toEqual({ avatar: 'alice.png', data: { extensions: { world: 'Alice Lore' } } });
        expect(harness.syncLog).toEqual(['reloadCharacter', ['reloadWorldInfo', ['Alice Lore']]]);
    });

    test('adds an empty character_book.extensions to the link request when the card book lacks it', async () => {
        const harness = createHarness({ card: createCard({ bookExtensions: false }) });

        await harness.actions.importEmbeddedWorldbook('alice.png');

        const merge = harness.calls.find(call => call.url === '/api/characters/merge-attributes').body;
        expect(merge.data).toEqual({ extensions: { world: 'Alice Lore' }, character_book: { extensions: {} } });
    });

    test('is idempotent: a character already linked to an existing world book is left alone', async () => {
        const harness = createHarness({ card: createCard({ world: 'Alice Lore' }), worldNames: ['Alice Lore'] });

        const result = await harness.actions.importEmbeddedWorldbook('alice.png');

        expect(result).toMatchObject({ ok: true, status: 'already-linked', worldName: 'Alice Lore' });
        expect(urls(harness.calls)).toEqual(['loadCharacterDetail']);
    });

    test('shares one run between concurrent calls for the same character', async () => {
        const harness = createHarness();

        const [first, second] = await Promise.all([
            harness.actions.importEmbeddedWorldbook('alice.png'),
            harness.actions.importEmbeddedWorldbook('alice.png'),
        ]);

        expect(first).toBe(second);
        expect(harness.calls.filter(call => call.url === '/api/worldinfo/edit')).toHaveLength(1);
    });

    test('returns no-book without writing when the full card has no embedded world book', async () => {
        const harness = createHarness({ card: createCard({ book: false }) });

        const result = await harness.actions.importEmbeddedWorldbook('alice.png');

        expect(result.status).toBe('no-book');
        expect(urls(harness.calls)).toEqual(['loadCharacterDetail']);
    });

    test('restores a missing link under its original name and does not rewrite the card', async () => {
        const harness = createHarness({ card: createCard({ world: 'Gone Lore' }), worldNames: ['Other'] });

        const result = await harness.actions.importEmbeddedWorldbook('alice.png');

        expect(result).toMatchObject({ status: 'imported', worldName: 'Gone Lore', linked: false });
        expect(harness.calls.find(call => call.url === '/api/worldinfo/edit').body).toMatchObject({ name: 'Gone Lore', overwrite: false });
        expect(urls(harness.calls)).not.toContain('/api/characters/merge-attributes');
        expect(harness.syncLog).toEqual([['reloadWorldInfo', ['Gone Lore']]]);
    });

    test('a name clash without a decision writes nothing', async () => {
        const harness = createHarness({ worldNames: ['alice lore'] });

        const result = await harness.actions.importEmbeddedWorldbook('alice.png');

        expect(result).toMatchObject({ ok: false, status: 'conflict', existingName: 'alice lore', alternateName: 'Alice Lore (2)' });
        expect(urls(harness.calls)).not.toContain('/api/worldinfo/edit');
    });

    test('a name clash saved as a new name uses the (2) suffix and links to it', async () => {
        const harness = createHarness({ worldNames: ['Alice Lore', 'Alice Lore (2)'] });
        const onConflict = jest.fn(async () => 'rename');

        const result = await harness.actions.importEmbeddedWorldbook('alice.png', { onConflict });

        expect(onConflict).toHaveBeenCalledWith(expect.objectContaining({ existingName: 'Alice Lore', alternateName: 'Alice Lore (3)', entryCount: 2 }));
        expect(result).toMatchObject({ status: 'imported', worldName: 'Alice Lore (3)', renamed: true });
        expect(harness.calls.find(call => call.url === '/api/worldinfo/edit').body).toMatchObject({ name: 'Alice Lore (3)', overwrite: false });
        expect(harness.calls.find(call => call.url === '/api/characters/merge-attributes').body.data.extensions.world).toBe('Alice Lore (3)');
    });

    test('a name clash resolved as overwrite writes into the existing file with overwrite true', async () => {
        const harness = createHarness({ worldNames: ['ALICE LORE'] });

        const result = await harness.actions.importEmbeddedWorldbook('alice.png', { onConflict: () => 'overwrite' });

        expect(result).toMatchObject({ status: 'imported', worldName: 'ALICE LORE', overwritten: true });
        expect(harness.calls.find(call => call.url === '/api/worldinfo/edit').body).toMatchObject({ name: 'ALICE LORE', overwrite: true });
    });

    test('cancelling a name clash leaves the files and the card untouched', async () => {
        const harness = createHarness({ worldNames: ['Alice Lore'] });

        const result = await harness.actions.importEmbeddedWorldbook('alice.png', { onConflict: () => 'cancel' });

        expect(result).toMatchObject({ ok: false, status: 'cancelled' });
        expect(urls(harness.calls)).toEqual(['loadCharacterDetail', '/api/files/sanitize-filename']);
    });

    test('asks again when the file turns out to exist already (409) and uses the refreshed list', async () => {
        let editAttempts = 0;
        const harness = createHarness({
            handlers: {
                '/api/worldinfo/edit': () => {
                    editAttempts += 1;
                    if (editAttempts === 1) {
                        throw Object.assign(new Error('conflict'), { status: 409 });
                    }
                    return { ok: true };
                },
                '/api/worldinfo/list': () => [{ file_id: 'Alice Lore', name: 'Alice Lore' }],
            },
        });
        const onConflict = jest.fn(async () => 'rename');

        const result = await harness.actions.importEmbeddedWorldbook('alice.png', { onConflict });

        expect(onConflict).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ status: 'imported', worldName: 'Alice Lore (2)' });
        expect(harness.calls.filter(call => call.url === '/api/worldinfo/edit').map(call => call.body.name)).toEqual(['Alice Lore', 'Alice Lore (2)']);
    });

    test('keeps the written file and reports the link failure after refreshing and notifying the engine', async () => {
        const harness = createHarness({
            handlers: { '/api/characters/merge-attributes': () => { throw new Error('Validation failed'); } },
        });

        await expect(harness.actions.importEmbeddedWorldbook('alice.png')).rejects.toThrow('世界书「Alice Lore」已写入，但关联到角色失败：Validation failed');
        expect(urls(harness.calls)).toContain('loadData');
        expect(harness.syncLog).toEqual([['reloadWorldInfo', ['Alice Lore']]]);
    });

    test('does not wait for the engine and reports a failed engine sync in a separate toast', async () => {
        const harness = createHarness();
        let finishSync;
        const syncGate = new Promise(resolve => {
            finishSync = resolve;
        });
        const actions = createCharacterEmbeddedWorldActions({
            state: harness.state,
            apiFetch: harness.apiFetch,
            loadData: async () => {},
            render: () => {},
            showToast: (...args) => harness.toasts.push(args),
            loadCharacterDetail: harness.loadCharacterDetail,
            reloadCharacter: async () => ({ ok: true }),
            reloadWorldInfo: async () => {
                await syncGate;
                return { ok: false, error: '引擎超时' };
            },
        });

        const result = await actions.importEmbeddedWorldbook('alice.png');

        expect(result.status).toBe('imported');
        expect(harness.toasts).toEqual([]);
        finishSync();
        await result.engineSync;
        expect(harness.toasts).toHaveLength(1);
        expect(harness.toasts[0][0]).toBe('生成引擎未同步');
        expect(harness.toasts[0][1]).toContain('引擎超时');
    });

    test('moves a matching open editor form onto the new link through onWorldLinked', async () => {
        const harness = createHarness();
        const onWorldLinked = jest.fn();
        const actions = createCharacterEmbeddedWorldActions({
            state: harness.state,
            apiFetch: harness.apiFetch,
            loadData: async () => {},
            render: () => {},
            showToast: () => {},
            loadCharacterDetail: harness.loadCharacterDetail,
            onWorldLinked,
        });

        await actions.importEmbeddedWorldbook('alice.png');

        expect(onWorldLinked).toHaveBeenCalledWith('alice.png', '', 'Alice Lore');
    });
});

// 内嵌世界书导入与世界书页（actions/worldbook-details.js）共用删除屏障和内容缓存：导入写入的文件必须能在世界书页继续编辑、删除，
// 且编辑从导入后的内容出发，不能拿旧缓存整份写回
describe('importEmbeddedWorldbook and the world book page', () => {
    // 服务端的世界书文件用内存表模拟；世界书页的动作用真实实现，与导入共用 state 和 apiFetch
    function createWorldbookHarness({ card, worldNames = [], files = {} }) {
        let worldbookDetails = null;
        const harness = createHarness({
            card,
            worldNames,
            handlers: {
                '/api/worldinfo/get': body => structuredClone(files[body.name]),
                '/api/worldinfo/edit': body => {
                    files[body.name] = structuredClone(body.data);
                    return { ok: true };
                },
                '/api/worldinfo/delete': body => {
                    delete files[body.name];
                    return { ok: true };
                },
            },
            deps: {
                ensureWorldbookFileWriteAllowed: name => worldbookDetails.ensureWorldbookFileWriteAllowed(name),
                restoreWorldbookFile: name => worldbookDetails.restoreWorldbookFile(name),
            },
        });
        worldbookDetails = createWorldbookDetailActions({
            state: harness.state,
            apiFetch: harness.apiFetch,
            loadData: async () => {},
            showToast: () => {},
        });
        return { ...harness, worldbookDetails, files };
    }

    test('an overwrite import drops the cached detail, so the next entry edit starts from the imported entries', async () => {
        const files = { 'ALICE LORE': { name: 'ALICE LORE', entries: { 0: { uid: 0, content: 'stale entry' } } } };
        const harness = createWorldbookHarness({ worldNames: ['ALICE LORE'], files });
        // 世界书页先打开过这本世界书，内容已缓存
        await harness.worldbookDetails.loadWorldDetail('ALICE LORE');

        const result = await harness.actions.importEmbeddedWorldbook('alice.png', { onConflict: () => 'overwrite' });
        expect(result).toMatchObject({ status: 'imported', worldName: 'ALICE LORE', overwritten: true });
        expect(harness.state.worldDetails).not.toHaveProperty('ALICE LORE');

        await harness.worldbookDetails.updateWorldbookDetail('ALICE LORE', detail => {
            detail.entries[0].content = 'edited after import';
        });

        expect(Object.keys(files['ALICE LORE'].entries)).toEqual(['0', '1']);
        expect(files['ALICE LORE'].entries[0].content).toBe('edited after import');
        expect(files['ALICE LORE'].entries[1].content).toBe('B');
    });

    test('a world book deleted in this session and restored under its name can be edited and deleted again', async () => {
        const files = { 'Gone Lore': { name: 'Gone Lore', entries: { 0: { uid: 0, content: 'old' } } } };
        const harness = createWorldbookHarness({ card: createCard({ world: 'Gone Lore' }), files });
        await harness.worldbookDetails.deleteWorldbookFile('Gone Lore');
        await expect(harness.worldbookDetails.updateWorldbookDetail('Gone Lore', () => {})).rejects.toThrow('世界书已删除或正在删除');

        const result = await harness.actions.importEmbeddedWorldbook('alice.png');
        expect(result).toMatchObject({ status: 'imported', worldName: 'Gone Lore' });

        await harness.worldbookDetails.updateWorldbookDetail('Gone Lore', detail => {
            detail.entries[1].content = 'B edited';
        });
        expect(files['Gone Lore'].entries[1].content).toBe('B edited');
        await harness.worldbookDetails.deleteWorldbookFile('Gone Lore');
        expect(files).not.toHaveProperty('Gone Lore');
    });

    test('writes nothing while the same world book is being deleted', async () => {
        const harness = createHarness({
            card: createCard({ world: 'Gone Lore' }),
            deps: {
                ensureWorldbookFileWriteAllowed: () => {
                    throw new Error('世界书正在删除，无法创建或导入同名文件。');
                },
            },
        });

        await expect(harness.actions.importEmbeddedWorldbook('alice.png')).rejects.toThrow('世界书正在删除');
        expect(urls(harness.calls)).not.toContain('/api/worldinfo/edit');
        expect(harness.syncLog).toEqual([]);
    });

    test('a failed overwrite request also drops the cached detail and keeps the delete barrier', async () => {
        const restoreWorldbookFile = jest.fn();
        const harness = createHarness({
            worldNames: ['Alice Lore'],
            handlers: { '/api/worldinfo/edit': () => { throw new Error('socket hang up'); } },
            deps: { restoreWorldbookFile },
        });
        harness.state.worldDetails['Alice Lore'] = { entries: { 0: { content: 'stale entry' } } };

        await expect(harness.actions.importEmbeddedWorldbook('alice.png', { onConflict: () => 'overwrite' })).rejects.toThrow('socket hang up');
        expect(harness.state.worldDetails).not.toHaveProperty('Alice Lore');
        expect(restoreWorldbookFile).not.toHaveBeenCalled();
    });
});

describe('offerEmbeddedWorldAfterImport', () => {
    test('shows the inline prompt once per avatar and stores the shared AlertWI marker', async () => {
        const harness = createHarness();

        const first = await harness.actions.offerEmbeddedWorldAfterImport('alice.png', { source: 'file' });
        expect(first.offered).toBe(true);
        expect(harness.state.characterEmbeddedWorld.prompt).toBe('alice.png');
        expect(harness.state.settings.accountStorage).toEqual({ 'AlertWI_alice.png': 'true' });
        expect(harness.calls.find(call => call.url === '/api/settings/save').body.accountStorage['AlertWI_alice.png']).toBe('true');
        expect(harness.toasts).toHaveLength(0);

        harness.state.characterEmbeddedWorld.prompt = '';
        const second = await harness.actions.offerEmbeddedWorldAfterImport('alice.png', { source: 'file' });
        expect(second).toMatchObject({ offered: false, reason: 'already-alerted' });
        expect(harness.state.characterEmbeddedWorld.prompt).toBe('');
    });

    test('adds a toast for remote imports', async () => {
        const harness = createHarness();

        await harness.actions.offerEmbeddedWorldAfterImport('alice.png', { source: 'remote' });

        expect(harness.state.characterEmbeddedWorld.prompt).toBe('alice.png');
        expect(harness.toasts).toHaveLength(1);
        expect(harness.toasts[0][0]).toContain('Alice');
        expect(harness.toasts[0][1]).toContain('2 条');
    });

    test('only toasts when the legacy world_import_dialog preference is off', async () => {
        const harness = createHarness({ settings: { power_user: { world_import_dialog: false } } });

        const result = await harness.actions.offerEmbeddedWorldAfterImport('alice.png', { source: 'file' });

        expect(result.offered).toBe(true);
        expect(harness.state.characterEmbeddedWorld.prompt).toBe('');
        expect(harness.toasts).toHaveLength(1);
    });

    test('does not prompt for a card without a book, with a found link, or after a previous alert', async () => {
        const noBook = createHarness({ card: createCard({ book: false }) });
        expect(await noBook.actions.offerEmbeddedWorldAfterImport('alice.png')).toMatchObject({ offered: false, reason: 'no-book' });

        const linked = createHarness({ card: createCard({ world: 'Alice Lore' }), worldNames: ['Alice Lore'] });
        expect(await linked.actions.offerEmbeddedWorldAfterImport('alice.png')).toMatchObject({ offered: false, reason: 'linked' });

        const alerted = createHarness({ settings: { power_user: {}, accountStorage: { 'AlertWI_alice.png': 'true' } } });
        expect(await alerted.actions.offerEmbeddedWorldAfterImport('alice.png')).toMatchObject({ offered: false, reason: 'already-alerted' });
        expect(urls(alerted.calls)).not.toContain('/api/settings/save');
    });

    test('a link to a world book that no longer exists still counts as not imported', async () => {
        const harness = createHarness({ card: createCard({ world: 'Gone' }), worldNames: ['Other'] });

        expect((await harness.actions.offerEmbeddedWorldAfterImport('alice.png')).offered).toBe(true);
    });

    test('never saves incomplete settings and never throws', async () => {
        const harness = createHarness({ settings: {} });
        const result = await harness.actions.offerEmbeddedWorldAfterImport('alice.png');
        expect(result.offered).toBe(true);
        expect(urls(harness.calls)).not.toContain('/api/settings/save');

        const failing = createHarness();
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        failing.loadCharacterDetail.mockRejectedValueOnce(new Error('boom'));
        await expect(failing.actions.offerEmbeddedWorldAfterImport('alice.png')).resolves.toMatchObject({ offered: false, reason: 'error' });
        warn.mockRestore();
    });

    test('forgetEmbeddedWorldAlert clears the marker like the legacy character delete', async () => {
        const harness = createHarness({ settings: { power_user: {}, accountStorage: { 'AlertWI_alice.png': 'true', other: '1' } } });

        await harness.actions.forgetEmbeddedWorldAlert('alice.png');

        expect(harness.calls.find(call => call.url === '/api/settings/save').body.accountStorage).toEqual({ other: '1' });
        const quiet = createHarness();
        await quiet.actions.forgetEmbeddedWorldAlert('alice.png');
        expect(urls(quiet.calls)).not.toContain('/api/settings/save');
    });
});
