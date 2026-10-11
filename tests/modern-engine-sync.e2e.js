import { test, expect } from '@playwright/test';
import { BRIDGE_ACTIONS, BRIDGE_TIMEOUTS } from '../public/modern/core/bridge-protocol.js';
import { createBridgeReload, describeReloadFailure, noEngineSync } from '../public/modern/core/bridge-reload.js';
import { createChatGenerationActions } from '../public/modern/actions/chat-generation.js';
import { createWorldbookDetailActions } from '../public/modern/actions/worldbook-details.js';
import { createWorldbookFileActions } from '../public/modern/actions/worldbook-files.js';

// The modern side of the engine sync channel: reloadXxx return promises that settle when the hidden engine acknowledged,
// in-flight reloads are counted, and generation waits for them. The engine side is covered by modern-bridge-headless.e2e.js.

function createDeferred() {
    let resolve = () => {};
    let reject = () => {};
    const promise = new Promise((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

function silenceWarnings() {
    const original = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
    return { warnings, restore: () => { console.warn = original; } };
}

test.describe('Modern bridge reload helpers', () => {
    test('send the right action and payload and resolve with the engine acknowledgement', async () => {
        const calls = [];
        const reload = createBridgeReload(async (action, payload, timeoutMs) => {
            calls.push({ action, payload, timeoutMs });
            return { ok: true, echoed: action };
        });

        expect(await reload.reloadChat({ avatar: 'alice.png', chat: 'chat-a' })).toEqual({ ok: true, echoed: BRIDGE_ACTIONS.RELOAD_CHAT });
        expect(await reload.reloadCharacter()).toEqual({ ok: true, echoed: BRIDGE_ACTIONS.RELOAD_CHARACTER });
        expect(await reload.reloadSettings()).toEqual({ ok: true, echoed: BRIDGE_ACTIONS.RELOAD_SETTINGS });
        expect(await reload.reloadWorldInfo(['Lore', 'Lore', 'Other', ''], { refreshList: false })).toMatchObject({ ok: true });
        expect(await reload.reloadWorldInfo()).toMatchObject({ ok: true });

        expect(calls).toEqual([
            { action: 'reloadChat', payload: { avatar: 'alice.png', chat: 'chat-a' }, timeoutMs: BRIDGE_TIMEOUTS.RELOAD },
            { action: 'reloadCharacter', payload: {}, timeoutMs: BRIDGE_TIMEOUTS.RELOAD },
            { action: 'reloadSettings', payload: {}, timeoutMs: BRIDGE_TIMEOUTS.RELOAD },
            { action: 'reloadWorldInfo', payload: { names: ['Lore', 'Other'], refreshList: false }, timeoutMs: BRIDGE_TIMEOUTS.RELOAD },
            { action: 'reloadWorldInfo', payload: {}, timeoutMs: BRIDGE_TIMEOUTS.RELOAD },
        ]);
    });

    test('resolve to ok:false instead of rejecting when the engine fails, times out or reports a failure', async () => {
        const quiet = silenceWarnings();
        try {
            const failures = [
                () => { throw new Error('生成引擎响应超时。'); },
                () => Promise.reject(new Error('原版生成引擎无法重新加载设置。')),
                () => ({ ok: false, error: '引擎自己报告的失败' }),
            ];
            const outcomes = [];
            for (const failure of failures) {
                const reload = createBridgeReload(async () => failure());
                outcomes.push(await reload.reloadSettings());
            }

            expect(outcomes).toEqual([
                { ok: false, error: '生成引擎响应超时。' },
                { ok: false, error: '原版生成引擎无法重新加载设置。' },
                { ok: false, error: '引擎自己报告的失败' },
            ]);
            expect(quiet.warnings).toHaveLength(3);
            expect(describeReloadFailure(outcomes[0])).toContain('生成引擎未能同步：生成引擎响应超时。');
            expect(describeReloadFailure({ ok: true })).toBe('');
            expect(describeReloadFailure(undefined)).toBe('');
            expect(await noEngineSync('anything')).toEqual({ ok: true });
        } finally {
            quiet.restore();
        }
    });

    test('count in-flight reloads in state.engine.settingsSyncPending and can be waited for with a limit', async () => {
        const state = { engine: { settingsSyncPending: 0 } };
        const first = createDeferred();
        const second = createDeferred();
        const gates = [first, second];
        const reload = createBridgeReload(async () => gates.shift().promise, { state });

        const settingsReload = reload.reloadSettings();
        const worldReload = reload.reloadWorldInfo(['Lore']);
        expect(state.engine.settingsSyncPending).toBe(2);

        // A limit that expires first reports that reloads are still running instead of waiting for them
        expect(await reload.waitForPendingReloads({ timeoutMs: 20 })).toEqual({ settled: false });
        expect(state.engine.settingsSyncPending).toBe(2);

        const waiting = reload.waitForPendingReloads({ timeoutMs: 5000 });
        first.resolve({ ok: true });
        await settingsReload;
        expect(state.engine.settingsSyncPending).toBe(1);
        second.reject(new Error('engine closed'));
        const quiet = silenceWarnings();
        try {
            expect(await worldReload).toEqual({ ok: false, error: 'engine closed' });
            expect(await waiting).toEqual({ settled: true });
        } finally {
            quiet.restore();
        }
        expect(state.engine.settingsSyncPending).toBe(0);
        expect(await reload.waitForPendingReloads()).toEqual({ settled: true });
    });
});

function createGenerationFixture({ withSync = true } = {}) {
    const character = { avatar: 'alice.png', name: 'Alice' };
    const cacheKey = 'alice.png::chat-a';
    const state = {
        selected: { chat: 'chat-a' },
        engine: { generating: false, checking: false, ready: false, status: '', error: '', detail: '', settingsSyncPending: 0 },
        errors: [],
        chatDrafts: {},
        chatMessages: { [cacheKey]: [{ name: 'Alice', mes: 'context', send_date: '1' }] },
        chatMetadata: {},
    };
    const events = [];
    const sync = createDeferred();
    const actions = createChatGenerationActions({
        state,
        render: () => {},
        showToast: () => {},
        subscribeProgress: () => () => {},
        callLegacyBridge: async (action) => {
            events.push(`bridge ${action}`);
            return { chat: 'chat-a', saved: true, swipeId: 0, swipeCount: 1 };
        },
        formatNumber: String,
        getSelectedChatEntity: () => character,
        getChatContextKey: () => character.avatar,
        getChatEntityName: entity => entity.name,
        isGroupChatMode: () => false,
        getSelectedChatMessages: () => state.chatMessages[cacheKey] || [],
        getCurrentDraftKey: () => cacheKey,
        getChatCacheKey: (contextKey, chatId) => `${contextKey}::${chatId}`,
        getUserName: () => 'You',
        loadChatMessages: async () => {},
        refreshSelectedChatList: async () => {},
        createModernChatFile: async () => 'chat-a',
        runModernChatFileOperation: (_entity, _chatId, operation) => operation(),
        ...(withSync ? {
            waitForEngineSync: async () => {
                events.push('wait for engine sync');
                await sync.promise;
                events.push('engine sync done');
                return { settled: true };
            },
        } : {}),
    });
    return { actions, events, state, sync };
}

test.describe('Modern generation waits for engine sync', () => {
    test('a continue holds back the engine request until pending reloads finished', async () => {
        const { actions, events, state, sync } = createGenerationFixture();
        state.engine.settingsSyncPending = 1;

        const generation = actions.continueModernReply();
        await expect.poll(() => events).toEqual(['wait for engine sync']);
        expect(state.engine.generating).toBe(true);
        expect(state.engine.detail).toContain('同步');

        sync.resolve();
        await generation;
        expect(events).toEqual(['wait for engine sync', 'engine sync done', 'bridge generate']);
        expect(state.engine.generating).toBe(false);
    });

    test('a swipe waits as well', async () => {
        const { actions, events, sync } = createGenerationFixture();

        const swipe = actions.swipeModernMessage(0, 'right');
        await expect.poll(() => events).toEqual(['wait for engine sync']);
        sync.resolve();
        await swipe;
        expect(events).toEqual(['wait for engine sync', 'engine sync done', 'bridge swipe']);
    });

    test('a stop pressed while waiting ends the generation without ever reaching the engine as a generate', async () => {
        const { actions, events, state, sync } = createGenerationFixture();

        const generation = actions.continueModernReply();
        await expect.poll(() => events).toEqual(['wait for engine sync']);
        await actions.stopModernGeneration();
        sync.resolve();
        await generation;

        expect(events).toEqual(['wait for engine sync', 'bridge stop', 'engine sync done']);
        expect(state.engine.generating).toBe(false);
        expect(state.engine.status).toBe('已停止');
    });

    test('works unchanged where no engine sync is wired in', async () => {
        const { actions, events } = createGenerationFixture({ withSync: false });

        await actions.continueModernReply();

        expect(events).toEqual(['bridge generate']);
    });
});

// Chat summary (A6): after a successful generation the modern UI decides whether the engine should summarize; the engine side
// (SUMMARIZE, the extension's own trigger) is covered by modern-bridge-headless.e2e.js, the panel by modern-chat-summary.e2e.js.
function createSummaryGenerationFixture({ memory = {}, messageCount = 6, bridge = {} } = {}) {
    const character = { avatar: 'alice.png', name: 'Alice' };
    const cacheKey = 'alice.png::chat-a';
    const fileMessages = Array.from({ length: messageCount }, (_, index) => ({ name: 'Alice', mes: `m${index}`, send_date: String(index) }));
    const state = {
        selected: { chat: 'chat-a' },
        engine: { generating: false, checking: false, ready: false, status: '', error: '', detail: '', settingsSyncPending: 0 },
        errors: [],
        chatDrafts: {},
        chatMessages: { [cacheKey]: fileMessages },
        chatMetadata: { [cacheKey]: { integrity: 'int-7' } },
        chatSummary: {},
        settings: { extension_settings: { memory: { source: 'main', promptInterval: 4, promptForceWords: 0, memoryFrozen: false, ...memory } } },
    };
    const events = [];
    const toasts = [];
    const actions = createChatGenerationActions({
        state,
        render: () => {},
        showToast: (title, message) => toasts.push([title, message]),
        subscribeProgress: () => () => {},
        callLegacyBridge: async (action, payload, timeoutMs) => {
            events.push({ action, payload, timeoutMs, generating: state.engine.generating, status: state.engine.status });
            if (Object.hasOwn(bridge, action)) {
                return bridge[action](payload);
            }
            return { chat: 'chat-a', saved: true };
        },
        formatNumber: String,
        getSelectedChatEntity: () => character,
        getChatContextKey: () => character.avatar,
        getChatEntityName: entity => entity.name,
        isGroupChatMode: () => false,
        getSelectedChatMessages: () => state.chatMessages[cacheKey] || [],
        getCurrentDraftKey: () => cacheKey,
        getChatCacheKey: (contextKey, chatId) => `${contextKey}::${chatId}`,
        getUserName: () => 'You',
        // syncGeneratedChat drops the cached messages and reads the chat file again; the stand-in puts the same chat back
        loadChatMessages: async () => {
            events.push({ action: 'load messages', generating: state.engine.generating });
            state.chatMessages[cacheKey] = fileMessages;
            state.chatMetadata[cacheKey] = { integrity: 'int-7' };
        },
        refreshSelectedChatList: async () => {},
        createModernChatFile: async () => 'chat-a',
        runModernChatFileOperation: (_entity, _chatId, operation) => operation(),
    });
    return { actions, events, state, toasts, cacheKey };
}

test.describe('Modern chat summary after a generation', () => {
    test('asks the engine for an automatic summary after syncing the reply, while the chat is still locked', async () => {
        const { actions, events, state } = createSummaryGenerationFixture({
            bridge: { summarize: () => ({ due: true, summary: 'S', index: 4, saved: true, reason: '' }) },
        });

        await actions.continueModernReply();

        expect(events.map(event => event.action)).toEqual(['generate', 'load messages', 'summarize', 'load messages']);
        const summarize = events.find(event => event.action === 'summarize');
        expect(summarize).toMatchObject({
            payload: { avatar: 'alice.png', groupId: null, chat: 'chat-a', integrity: 'int-7', mode: 'auto' },
            timeoutMs: BRIDGE_TIMEOUTS.SUMMARIZE,
            generating: true,
            status: '摘要生成中',
        });
        expect(state.engine.generating).toBe(false);
        expect(state.engine.status).toBe('就绪');
        expect(state.chatSummary.running).toBe(false);
        expect(state.chatSummary.notice).toMatchObject({ key: 'alice.png::chat-a', kind: 'success' });
    });

    test('does not ask when the source is Extras, the summary is paused or off, the interval is not reached, or the extension is disabled', async () => {
        const cases = [
            { memory: { source: 'extras' } },
            { memory: { memoryFrozen: true } },
            { memory: { promptInterval: 0 } },
            { memory: { promptInterval: 50 } },
        ];
        for (const options of cases) {
            const { actions, events } = createSummaryGenerationFixture(options);
            await actions.continueModernReply();
            expect(events.map(event => event.action)).toEqual(['generate', 'load messages']);
        }

        const disabled = createSummaryGenerationFixture();
        disabled.state.settings.extension_settings.disabledExtensions = ['memory'];
        await disabled.actions.continueModernReply();
        expect(disabled.events.map(event => event.action)).toEqual(['generate', 'load messages']);
    });

    test('a summary that fails never fails the generation and leaves a quiet notice', async () => {
        const { actions, events, state, toasts } = createSummaryGenerationFixture({
            bridge: { summarize: () => { throw new Error('模型接口超时'); } },
        });

        const outcome = await actions.continueModernReply();

        expect(outcome).toBeUndefined();
        expect(events.map(event => event.action)).toEqual(['generate', 'load messages', 'summarize']);
        expect(state.engine.generating).toBe(false);
        expect(state.engine.error).toBe('');
        expect(state.engine.status).toBe('就绪');
        expect(state.chatSummary.notice).toMatchObject({ kind: 'warning', text: '摘要没有更新：模型接口超时' });
        expect(toasts.some(([title]) => title === '聊天摘要未更新')).toBe(true);
    });

    test('the engine saying "not due" or the summary not being saved is reported without marking the generation failed', async () => {
        const quiet = createSummaryGenerationFixture({ bridge: { summarize: () => ({ due: false, summary: '', index: -1, saved: false, reason: 'waiting' }) } });
        await quiet.actions.continueModernReply();
        expect(quiet.state.chatSummary.notice).toBeNull();
        expect(quiet.events.map(event => event.action)).toEqual(['generate', 'load messages', 'summarize']);

        const refused = createSummaryGenerationFixture({ bridge: { summarize: () => ({ due: true, summary: 'lost', index: 4, saved: false, reason: 'save-failed' }) } });
        await refused.actions.continueModernReply();
        expect(refused.state.chatSummary.notice).toMatchObject({ kind: 'warning' });
        // nothing was written, so the chat is not read again
        expect(refused.events.map(event => event.action)).toEqual(['generate', 'load messages', 'summarize']);
        expect(refused.state.engine.error).toBe('');
    });

    test('a stopped generation and a swipe are not followed by a summary request', async () => {
        const stopped = createSummaryGenerationFixture({ bridge: { generate: () => ({ chat: 'chat-a', saved: true, stopped: true, started: true }) } });
        await stopped.actions.continueModernReply();
        expect(stopped.events.map(event => event.action)).not.toContain('summarize');

        const swiped = createSummaryGenerationFixture({ bridge: { swipe: () => ({ chat: 'chat-a', saved: true, swipeId: 1, swipeCount: 2 }) } });
        await swiped.actions.swipeModernMessage(5, 'right');
        expect(swiped.events.map(event => event.action)).not.toContain('summarize');
    });

    test('a stop pressed during the automatic summary reaches the engine and ends in the stopped state', async () => {
        const gate = createDeferred();
        const { actions, events, state } = createSummaryGenerationFixture({
            bridge: {
                summarize: async () => {
                    await gate.promise;
                    return { due: true, summary: '', index: -1, saved: false, reason: 'stopped', stopped: true };
                },
                stop: () => {
                    gate.resolve();
                    return { stopped: true };
                },
            },
        });

        const generation = actions.continueModernReply();
        await expect.poll(() => events.some(event => event.action === 'summarize')).toBe(true);
        expect(state.chatSummary.running).toBe(true);
        await actions.stopModernGeneration();
        await generation;

        expect(events.map(event => event.action)).toContain('stop');
        expect(state.engine.generating).toBe(false);
        expect(state.engine.status).toBe('已停止');
        expect(state.engine.detail).toContain('摘要已停止');
        expect(state.chatSummary.running).toBe(false);
    });

    test('a manual summary is forced, refuses the Extras source before reaching the engine, and holds the busy state', async () => {
        const extras = createSummaryGenerationFixture({ memory: { source: 'extras' } });
        await expect(extras.actions.summarizeModernChat()).rejects.toThrow('Extras');
        expect(extras.events).toEqual([]);
        expect(extras.state.engine.generating).toBe(false);

        const gate = createDeferred();
        const { actions, events, state } = createSummaryGenerationFixture({
            memory: { promptInterval: 0, memoryFrozen: true },
            bridge: { summarize: async () => (await gate.promise, { due: true, summary: 'S', index: 4, saved: true, reason: '' }) },
        });
        const summary = actions.summarizeModernChat();
        await expect.poll(() => events.some(event => event.action === 'summarize')).toBe(true);
        expect(state.engine.generating).toBe(true);
        expect(state.chatSummary.running).toBe(true);
        // a second request while one runs does nothing
        expect(await actions.summarizeModernChat()).toBeNull();
        gate.resolve();
        expect(await summary).toMatchObject({ written: true, stopped: false });

        expect(events.filter(event => event.action === 'summarize')).toHaveLength(1);
        expect(events.find(event => event.action === 'summarize').payload).toEqual({ avatar: 'alice.png', groupId: null, chat: 'chat-a', integrity: 'int-7', mode: 'force' });
        expect(state.engine.generating).toBe(false);
        expect(state.chatSummary.running).toBe(false);
    });

    test('a failing manual summary reports the error, unlocks the chat and rethrows for the panel', async () => {
        const { actions, state } = createSummaryGenerationFixture({ bridge: { summarize: () => { throw new Error('boom'); } } });

        await expect(actions.summarizeModernChat()).rejects.toThrow('boom');

        expect(state.engine.generating).toBe(false);
        expect(state.chatSummary.running).toBe(false);
        expect(state.chatSummary.notice).toMatchObject({ kind: 'error', text: '摘要失败：boom' });
    });
});

function createWorldbookFixture({ reloadWorldInfo, apiFetch }) {
    const state = {
        worldDetails: { Lore: { name: 'Lore', entries: { 1: { uid: 1, comment: 'one' } } } },
        errors: [],
    };
    const requests = [];
    const detailActions = createWorldbookDetailActions({
        state,
        apiFetch: async (url, options = {}) => {
            requests.push({ url, body: structuredClone(options.body) });
            return apiFetch ? apiFetch(url, options) : { ok: true };
        },
        loadData: async () => {},
        showToast: () => {},
        reloadWorldInfo,
    });
    return { state, requests, detailActions };
}

test.describe('Modern worldbook changes reach the engine cache', () => {
    test('an entry save asks the engine to drop only that world, without refreshing the list or blocking the save', async () => {
        const calls = [];
        const { detailActions, requests } = createWorldbookFixture({
            // The engine never answers: the save must still complete
            reloadWorldInfo: (...args) => {
                calls.push(args);
                return new Promise(() => {});
            },
        });

        const result = await detailActions.updateWorldbookDetail('Lore', detail => {
            detail.entries[1].comment = 'edited';
            return { title: 'edited' };
        });

        expect(result).toEqual({ title: 'edited' });
        expect(requests.map(request => request.url)).toEqual(['/api/worldinfo/edit']);
        expect(calls).toEqual([[['Lore'], { refreshList: false }]]);
    });

    test('a save that fails before the response still invalidates, and a skipped save does not', async () => {
        const calls = [];
        const { detailActions } = createWorldbookFixture({
            reloadWorldInfo: async (...args) => (calls.push(args), { ok: true }),
            apiFetch: async url => {
                if (url === '/api/worldinfo/get') {
                    return { name: 'Lore', entries: { 1: { uid: 1, comment: 'one' } } };
                }
                throw new Error('response lost');
            },
        });

        await expect(detailActions.updateWorldbookDetail('Lore', detail => {
            detail.entries[1].comment = 'maybe saved';
        })).rejects.toThrow('response lost');
        expect(calls).toEqual([[['Lore'], { refreshList: false }]]);

        await detailActions.updateWorldbookDetail('Lore', () => ({ save: false }));
        expect(calls).toHaveLength(1);
    });

    test('deleting a world drops it and refreshes the list', async () => {
        const calls = [];
        const { detailActions, requests } = createWorldbookFixture({
            reloadWorldInfo: async (...args) => (calls.push(args), { ok: true }),
        });

        await detailActions.deleteWorldbookFile('Lore');

        expect(requests.map(request => request.url)).toEqual(['/api/worldinfo/delete']);
        expect(calls).toEqual([[['Lore'], {}]]);
    });

    test('creating a world drops its name so a recreated file is read fresh', async () => {
        const calls = [];
        const state = {
            worldbooks: [],
            settingsBundle: { world_names: [] },
            worldbookCreating: { active: true, name: 'Fresh Lore' },
            worldDetails: {},
            selected: { worldbook: '' },
        };
        const requests = [];
        const fileActions = createWorldbookFileActions({
            state,
            apiFetch: async (url, options = {}) => {
                requests.push({ url, body: structuredClone(options.body) });
                return url === '/api/files/sanitize-filename' ? { fileName: 'Fresh Lore' } : { ok: true };
            },
            loadData: async () => {},
            render: () => {},
            showToast: () => {},
            downloadFile: () => {},
            loadWorldDetail: async () => {},
            deleteWorldbookFile: async () => {},
            ensureWorldbookFileWriteAllowed: () => {},
            restoreWorldbookFile: () => {},
            getGlobalWorldNames: () => [],
            syncEngineWorldInfo: (...args) => calls.push(args),
        });

        await fileActions.saveWorldbookCreate();

        expect(requests.map(request => request.url)).toEqual(['/api/files/sanitize-filename', '/api/worldinfo/edit']);
        expect(calls).toEqual([[['Fresh Lore']]]);
    });
});
