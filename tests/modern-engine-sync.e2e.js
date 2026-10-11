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
