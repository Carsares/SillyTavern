import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { createMaintenanceActions, ensureMaintenanceState, REPORT_MAX_AGE_MS } from '../public/modern/actions/maintenance.js';

const GREETING_ALICE = {
    hash: 'g-1',
    avatar: 'Alice.png',
    characterName: 'Alice',
    file: 'Alice - 2026-07-03@18h14m24s106ms.jsonl',
    size: 413,
    isCardChat: false,
    modern: { file: 'Modern 2026-07-03T10-14-22-467Z.jsonl' },
};
const GREETING_BRUNO = {
    hash: 'g-2',
    avatar: 'Bruno.png',
    characterName: 'Bruno',
    file: 'Bruno - 2026-07-03@18h15m00s000ms.jsonl',
    size: 380,
    isCardChat: true,
    modern: { file: 'Modern 2026-07-03T10-14-58-000Z.jsonl' },
};

/** The chat file barrier of actions/chat-context.js, reduced to what these tests look at. */
function createBarrierFake() {
    const barriers = new Map();
    const calls = [];
    async function deleteModernChatFile(contextKey, chatId, operation) {
        const key = `${contextKey}::${chatId}`;
        calls.push(key);
        if (barriers.has(key)) {
            throw new Error('聊天文件已删除、重命名或正在变更。');
        }
        barriers.set(key, '删除中');
        let confirmedUnchanged = false;
        try {
            const result = await operation({ confirmUnchanged: () => { confirmedUnchanged = true; } });
            barriers.set(key, '删除完成');
            return result;
        } catch (error) {
            if (confirmedUnchanged) {
                barriers.delete(key);
            }
            throw error;
        }
    }
    return { barriers, calls, deleteModernChatFile };
}

function createHarness({ apiFetch = jest.fn(async () => null) } = {}) {
    const barrier = createBarrierFake();
    const state = {
        engine: { generating: false },
        maintenance: {},
        me: { handle: 'user' },
        chatMessages: {},
        chatMessageLimits: {},
        chatMetadata: {},
        chatDrafts: {},
        chatLists: {},
        selected: { character: '', chat: '' },
    };
    const deleteChatReadState = jest.fn();
    const render = jest.fn();
    const showToast = jest.fn();
    const loadData = jest.fn(async () => {});
    const reloadCharacter = jest.fn(async () => ({ ok: true }));
    const actions = createMaintenanceActions(/** @type {any} */ ({
        state,
        apiFetch,
        apiFetchResponse: jest.fn(),
        loadData,
        render,
        showToast,
        bridgeReload: { reloadCharacter },
        actionRegistry: {
            chatContextActions: {
                deleteModernChatFile: barrier.deleteModernChatFile,
                getChatCacheKey: (avatar, chatId) => `${avatar}::${chatId}`,
                getChatId: chat => String(chat.file_id || '').replace(/\.jsonl$/i, ''),
                deleteChatReadState,
            },
            settingsActions: { loadSettingsSnapshots: jest.fn(async () => []) },
        },
    }));
    return { state, actions, apiFetch, barrier, deleteChatReadState, loadData, reloadCharacter, render, showToast, maintenance: () => ensureMaintenanceState(state) };
}

function loadDataMaidReport(harness, report, token = 'tok') {
    const dataMaid = harness.maintenance().dataMaid;
    dataMaid.report = report;
    dataMaid.token = token;
    dataMaid.scannedAt = Date.now();
}

function loadGreetings(harness, items) {
    const greetings = harness.maintenance().greetings;
    greetings.items = items;
    greetings.token = 'gtok';
    greetings.scannedAt = Date.now();
    greetings.selected = items.map(item => item.hash);
}

describe('maintenance state', () => {
    test('is created once from the empty skeleton and keeps what was set', () => {
        const state = { maintenance: {} };

        const first = ensureMaintenanceState(state);
        first.snapshots.keep = 7;
        const second = ensureMaintenanceState(state);

        expect(second).toBe(first);
        expect(second.snapshots.keep).toBe(7);
        expect(Object.keys(second)).toEqual(['storage', 'dataMaid', 'greetings', 'snapshots', 'chatBackups', 'exporting']);
    });
});

describe('data maid delete guards', () => {
    let harness;
    beforeEach(() => {
        harness = createHarness();
        loadDataMaidReport(harness, {
            images: [{ name: 'a.png', hash: 'h-1', size: 10 }],
            files: [],
            chats: [],
            groupChats: [],
            chatBackups: [{ name: 'chat_x_20260101-000000.jsonl', hash: 'h-cb', size: 5 }],
            settingsBackups: [{ name: 'settings_u_20260101-000000.json', hash: 'h-sb', size: 5 }],
        });
        harness.maintenance().dataMaid.selected = ['h-1'];
    });

    test('opening the confirmation sends nothing and needs a selection', () => {
        harness.maintenance().dataMaid.selected = [];
        expect(() => harness.actions.maintenanceBeginDataMaidDelete()).toThrow('请先勾选');

        harness.maintenance().dataMaid.selected = ['h-1'];
        harness.actions.maintenanceBeginDataMaidDelete();

        expect(harness.maintenance().dataMaid.confirming).toBe(true);
        expect(harness.apiFetch).not.toHaveBeenCalled();
    });

    test('refuses to start or confirm while a reply is being generated', async () => {
        harness.state.engine.generating = true;
        expect(() => harness.actions.maintenanceBeginDataMaidDelete()).toThrow('正在生成回复');

        harness.state.engine.generating = false;
        harness.actions.maintenanceBeginDataMaidDelete();
        harness.state.engine.generating = true;
        await expect(harness.actions.maintenanceConfirmDataMaidDelete()).rejects.toThrow('正在生成回复');
        expect(harness.apiFetch).not.toHaveBeenCalled();
    });

    test('refuses a report older than the allowed age', async () => {
        harness.maintenance().dataMaid.scannedAt = Date.now() - REPORT_MAX_AGE_MS - 1000;

        expect(() => harness.actions.maintenanceBeginDataMaidDelete()).toThrow('重新扫描');
        harness.maintenance().dataMaid.confirming = true;
        await expect(harness.actions.maintenanceConfirmDataMaidDelete()).rejects.toThrow('重新扫描');
        expect(harness.apiFetch).not.toHaveBeenCalled();
    });

    test('the confirm step cannot be skipped', async () => {
        await expect(harness.actions.maintenanceConfirmDataMaidDelete()).rejects.toThrow('请先点「删除所选」');
        expect(harness.apiFetch).not.toHaveBeenCalled();
    });

    test('cancelling closes the confirmation without a request', () => {
        harness.actions.maintenanceBeginDataMaidDelete();

        harness.actions.maintenanceCancelDataMaidDelete();

        expect(harness.maintenance().dataMaid.confirming).toBe(false);
        expect(harness.apiFetch).not.toHaveBeenCalled();
    });

    test('backup categories are never sent, even if their hashes are in the selection', async () => {
        harness.maintenance().dataMaid.selected = ['h-1', 'h-cb', 'h-sb'];
        harness.apiFetch.mockResolvedValue({ deleted: ['h-1'], skipped: [], freedBytes: 10 });
        harness.actions.maintenanceBeginDataMaidDelete();

        await harness.actions.maintenanceConfirmDataMaidDelete();

        expect(harness.apiFetch).toHaveBeenCalledTimes(1);
        expect(harness.apiFetch).toHaveBeenCalledWith('/api/data-maid/delete', { body: { token: 'tok', hashes: ['h-1'], detailed: true } });
    });

    test('an answer without details is reported as an error instead of being trusted', async () => {
        harness.apiFetch.mockResolvedValue(null);
        harness.actions.maintenanceBeginDataMaidDelete();

        await expect(harness.actions.maintenanceConfirmDataMaidDelete()).rejects.toThrow('没有返回删除明细');
        // The report keeps the file: nothing is removed from the list on a guess
        expect(harness.maintenance().dataMaid.report.images).toHaveLength(1);
    });

    test('leaving closes the report on the server once and forgets it locally', () => {
        harness.actions.maintenanceReleaseDataMaid({ quiet: true });
        harness.actions.maintenanceReleaseDataMaid({ quiet: true });

        expect(harness.apiFetch).toHaveBeenCalledTimes(1);
        expect(harness.apiFetch).toHaveBeenCalledWith('/api/data-maid/finalize', { body: { token: 'tok' } });
        expect(harness.maintenance().dataMaid.report).toBeNull();
        expect(harness.render).not.toHaveBeenCalled();
    });
});

describe('duplicate greeting resolve', () => {
    function resolveResponse(moved, skipped = []) {
        return {
            quarantine: 'backups/quarantine-20260102-030405',
            moved: moved.map(item => ({ hash: item.hash, avatar: item.avatar, file: item.file, from: `chats/x/${item.file}`, to: `backups/quarantine-20260102-030405/chats/x/${item.file}` })),
            skipped,
        };
    }

    test('repoints the card of a flagged chat first, then moves everything with one request under chat file barriers', async () => {
        const order = [];
        const apiFetch = jest.fn(async (url, options) => {
            order.push(url);
            if (url === '/api/data-maid/duplicate-greetings/resolve') {
                return resolveResponse([GREETING_ALICE, GREETING_BRUNO]);
            }
            if (url === '/api/data-maid/duplicate-greetings') {
                return { token: 'gtok-2', items: [], stats: {}, truncated: false };
            }
            return options && null;
        });
        const harness = createHarness({ apiFetch });
        loadGreetings(harness, [GREETING_ALICE, GREETING_BRUNO]);
        harness.state.chatMessages['Alice.png::Alice - 2026-07-03@18h14m24s106ms'] = [{ mes: 'x' }];
        harness.state.chatMessages['Bruno.png::Bruno - 2026-07-03@18h15m00s000ms'] = [{ mes: 'x' }];
        harness.state.chatMessages['Alice.png::Modern 2026-07-03T10-14-22-467Z'] = [{ mes: 'kept' }];
        harness.state.chatLists['Alice.png'] = [{ file_id: 'Alice - 2026-07-03@18h14m24s106ms' }, { file_id: 'Modern 2026-07-03T10-14-22-467Z' }];
        harness.state.selected = { character: 'Alice.png', chat: 'Alice - 2026-07-03@18h14m24s106ms' };
        harness.actions.maintenanceBeginGreetingResolve();

        await harness.actions.maintenanceConfirmGreetingResolve();

        expect(order.slice(0, 2)).toEqual(['/api/characters/merge-attributes', '/api/data-maid/duplicate-greetings/resolve']);
        expect(apiFetch).toHaveBeenCalledWith('/api/characters/merge-attributes', { body: { avatar: 'Bruno.png', chat: 'Modern 2026-07-03T10-14-58-000Z' } });
        expect(apiFetch).toHaveBeenCalledWith('/api/data-maid/duplicate-greetings/resolve', { body: { token: 'gtok', hashes: ['g-1', 'g-2'] } });
        // Both chats stay blocked for writes in this page, like a deleted chat
        expect([...harness.barrier.barriers.values()]).toEqual(['删除完成', '删除完成']);
        // The moved chats leave every Modern cache; the kept Modern chat does not
        expect(harness.state.chatMessages).toEqual({ 'Alice.png::Modern 2026-07-03T10-14-22-467Z': [{ mes: 'kept' }] });
        expect(harness.state.chatLists['Alice.png']).toEqual([{ file_id: 'Modern 2026-07-03T10-14-22-467Z' }]);
        expect(harness.state.selected.chat).toBe('');
        expect(harness.deleteChatReadState).toHaveBeenCalledWith('Alice.png', 'Alice - 2026-07-03@18h14m24s106ms');
        // The card changed, so data is reloaded and the engine is told
        expect(harness.loadData).toHaveBeenCalled();
        expect(harness.reloadCharacter).toHaveBeenCalledTimes(1);
        expect(harness.maintenance().greetings.result.moved).toHaveLength(2);
    });

    test('lifts the barrier of a chat the server did not move and keeps it for the one it moved', async () => {
        const apiFetch = jest.fn(async url => {
            if (url === '/api/data-maid/duplicate-greetings/resolve') {
                return resolveResponse([GREETING_ALICE], [{ hash: 'g-2', reason: 'changed', file: GREETING_BRUNO.file }]);
            }
            return { token: 't', items: [] };
        });
        const harness = createHarness({ apiFetch });
        loadGreetings(harness, [GREETING_ALICE, { ...GREETING_BRUNO, isCardChat: false }]);
        harness.actions.maintenanceBeginGreetingResolve();

        await harness.actions.maintenanceConfirmGreetingResolve();

        expect(harness.barrier.barriers.get('Alice.png::Alice - 2026-07-03@18h14m24s106ms')).toBe('删除完成');
        expect(harness.barrier.barriers.has('Bruno.png::Bruno - 2026-07-03@18h15m00s000ms')).toBe(false);
        expect(harness.maintenance().greetings.result.skipped).toEqual([{ hash: 'g-2', file: GREETING_BRUNO.file, reason: 'changed' }]);
        expect(harness.reloadCharacter).not.toHaveBeenCalled();
    });

    test('a request the server rejected up front (400) lifts every barrier and moves nothing', async () => {
        const apiFetch = jest.fn(async url => {
            if (url === '/api/data-maid/duplicate-greetings/resolve') {
                throw Object.assign(new Error('bad request'), { status: 400 });
            }
            return { token: 't', items: [] };
        });
        const harness = createHarness({ apiFetch });
        loadGreetings(harness, [GREETING_ALICE, { ...GREETING_BRUNO, isCardChat: false }]);
        harness.actions.maintenanceBeginGreetingResolve();

        await harness.actions.maintenanceConfirmGreetingResolve();

        expect(harness.barrier.barriers.size).toBe(0);
        expect(harness.maintenance().greetings.result.moved).toEqual([]);
        expect(harness.maintenance().greetings.result.skipped).toHaveLength(2);
    });

    test('an unknown outcome (network error) keeps the barriers so nothing is saved over a possibly moved file', async () => {
        const apiFetch = jest.fn(async url => {
            if (url === '/api/data-maid/duplicate-greetings/resolve') {
                throw new Error('network down');
            }
            return { token: 't', items: [] };
        });
        const harness = createHarness({ apiFetch });
        loadGreetings(harness, [GREETING_ALICE]);
        harness.actions.maintenanceBeginGreetingResolve();

        await harness.actions.maintenanceConfirmGreetingResolve();

        expect(harness.barrier.barriers.get('Alice.png::Alice - 2026-07-03@18h14m24s106ms')).toBe('删除中');
        expect(harness.maintenance().greetings.result.skipped).toEqual([expect.objectContaining({ hash: 'g-1', reason: 'failed' })]);
    });

    test('a chat whose card cannot be repointed is not moved', async () => {
        const apiFetch = jest.fn(async url => {
            if (url === '/api/characters/merge-attributes') {
                throw new Error('validation failed');
            }
            return { token: 't', items: [] };
        });
        const harness = createHarness({ apiFetch });
        loadGreetings(harness, [GREETING_BRUNO]);
        harness.actions.maintenanceBeginGreetingResolve();

        await harness.actions.maintenanceConfirmGreetingResolve();

        expect(apiFetch).not.toHaveBeenCalledWith('/api/data-maid/duplicate-greetings/resolve', expect.anything());
        expect(harness.barrier.calls).toEqual([]);
        expect(harness.maintenance().greetings.result.skipped).toEqual([expect.objectContaining({ hash: 'g-2', reason: 'repoint-failed' })]);
    });

    test('is refused while generating, with a stale report, or without the confirmation step', async () => {
        const harness = createHarness();
        loadGreetings(harness, [GREETING_ALICE]);

        await expect(harness.actions.maintenanceConfirmGreetingResolve()).rejects.toThrow('请先点「隔离所选」');

        harness.state.engine.generating = true;
        expect(() => harness.actions.maintenanceBeginGreetingResolve()).toThrow('正在生成回复');

        harness.state.engine.generating = false;
        harness.maintenance().greetings.scannedAt = Date.now() - REPORT_MAX_AGE_MS - 1000;
        expect(() => harness.actions.maintenanceBeginGreetingResolve()).toThrow('重新扫描');
        expect(harness.apiFetch).not.toHaveBeenCalled();
        expect(harness.barrier.calls).toEqual([]);
    });
});

describe('snapshot and backup confirmation steps', () => {
    test('deleting a snapshot needs the begin step and sends only the chosen name', async () => {
        const apiFetch = jest.fn(async () => ({ ok: true, size: 5 }));
        const harness = createHarness({ apiFetch });

        await expect(harness.actions.maintenanceConfirmSnapshotDelete()).rejects.toThrow('请先选择');
        expect(apiFetch).not.toHaveBeenCalled();

        harness.actions.maintenanceBeginSnapshotDelete('settings_user_20260101-000000.json');
        harness.actions.maintenanceCancelSnapshotDelete();
        await expect(harness.actions.maintenanceConfirmSnapshotDelete()).rejects.toThrow('请先选择');
        expect(apiFetch).not.toHaveBeenCalled();

        harness.actions.maintenanceBeginSnapshotDelete('settings_user_20260101-000000.json');
        await harness.actions.maintenanceConfirmSnapshotDelete();
        expect(apiFetch).toHaveBeenCalledWith('/api/settings/delete-snapshot', { body: { name: 'settings_user_20260101-000000.json' } });
    });

    test('pruning snapshots sends the previewed names and is impossible without a preview', async () => {
        const apiFetch = jest.fn(async (_url, { body }) => (body.dryRun
            ? { keep: body.keep, total: 4, kept: 2, candidates: [{ name: 'a', size: 1, date: 1 }, { name: 'b', size: 1, date: 1 }] }
            : { deleted: ['a', 'b'], skipped: [], freedBytes: 2 }));
        const harness = createHarness({ apiFetch });

        await expect(harness.actions.maintenanceConfirmSnapshotPrune()).rejects.toThrow('请先预览');
        harness.actions.maintenanceSetSnapshotKeep(2);
        await harness.actions.maintenancePreviewSnapshotPrune();
        expect(apiFetch).toHaveBeenLastCalledWith('/api/settings/prune-snapshots', { body: { keep: 2, dryRun: true } });

        await harness.actions.maintenanceConfirmSnapshotPrune();

        expect(apiFetch).toHaveBeenCalledWith('/api/settings/prune-snapshots', { body: { keep: 2, dryRun: false, names: ['a', 'b'] } });
    });

    test('changing the keep value discards a stale preview', async () => {
        const apiFetch = jest.fn(async (_url, { body }) => ({ keep: body.keep, total: 4, kept: 2, candidates: [{ name: 'a', size: 1, date: 1 }] }));
        const harness = createHarness({ apiFetch });
        harness.actions.maintenanceSetSnapshotKeep(2);
        await harness.actions.maintenancePreviewSnapshotPrune();
        expect(harness.maintenance().snapshots.preview).not.toBeNull();

        harness.actions.maintenanceSetSnapshotKeep(1);

        expect(harness.maintenance().snapshots.preview).toBeNull();
        await expect(harness.actions.maintenanceConfirmSnapshotPrune()).rejects.toThrow('请先预览');
    });

    test('chat backup delete re-reads the list and deletes only what is still old and was previewed', async () => {
        const calls = [];
        const apiFetch = jest.fn(async (url, { body }) => {
            calls.push([url, body]);
            if (url === '/api/backups/chat/stats') {
                return { total: { files: 0, bytes: 0 }, series: [], unrecognized: { files: 0, bytes: 0 }, olderThan: { names: ['chat_a_20250101-000000.jsonl', 'chat_c_20250101-000000.jsonl'] } };
            }
            return 'OK';
        });
        const harness = createHarness({ apiFetch });
        const backups = harness.maintenance().chatBackups;
        backups.preview = { days: 30, files: 3, bytes: 3, names: ['chat_a_20250101-000000.jsonl', 'chat_b_20250101-000000.jsonl', 'chat_c_20250101-000000.jsonl'] };

        await harness.actions.maintenanceConfirmChatBackupPrune();

        const deletes = calls.filter(([url]) => url === '/api/backups/chat/delete').map(([, body]) => body.name);
        expect(deletes).toEqual(['chat_a_20250101-000000.jsonl', 'chat_c_20250101-000000.jsonl']);
        expect(backups.result).toMatchObject({ days: 30, skippedChanged: 1 });
        expect(backups.result.deleted).toEqual(deletes);
    });

    test('a failed backup delete is reported per file and does not stop the others', async () => {
        const apiFetch = jest.fn(async (url, { body }) => {
            if (url === '/api/backups/chat/stats') {
                return { total: { files: 0, bytes: 0 }, series: [], unrecognized: { files: 0, bytes: 0 }, olderThan: { names: ['chat_a_20250101-000000.jsonl', 'chat_b_20250101-000000.jsonl'] } };
            }
            if (body.name === 'chat_a_20250101-000000.jsonl') {
                throw new Error('busy');
            }
            return 'OK';
        });
        const harness = createHarness({ apiFetch });
        const backups = harness.maintenance().chatBackups;
        backups.preview = { days: 30, files: 2, bytes: 2, names: ['chat_a_20250101-000000.jsonl', 'chat_b_20250101-000000.jsonl'] };

        await harness.actions.maintenanceConfirmChatBackupPrune();

        expect(backups.result.deleted).toEqual(['chat_b_20250101-000000.jsonl']);
        expect(backups.result.failed).toEqual([{ name: 'chat_a_20250101-000000.jsonl', message: 'busy' }]);
    });
});
