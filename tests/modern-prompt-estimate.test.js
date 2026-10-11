import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { BRIDGE_ACTIONS, BRIDGE_TIMEOUTS } from '../public/modern/core/bridge-protocol.js';
import { createBridgeReload, onBridgeReloadSettled } from '../public/modern/core/bridge-reload.js';
import {
    describePromptEstimateReason,
    getPromptEstimateSectionView,
    getValidPromptEstimate,
    normalizePromptEstimateReply,
} from '../public/modern/core/prompt-estimate.js';
import { createPromptEstimateActions } from '../public/modern/actions/prompt-estimate.js';
import { notifyGenerationFinished } from '../public/modern/actions/inspector-itemized.js';
import { getChatUsageView } from '../public/modern/components/chat-usage-label.js';

// 动作用 window.setTimeout，jest 的 node 环境没有 window
global.window = global;

const estimateData = (extra = {}) => ({
    available: true,
    estimated: true,
    mainApi: 'openai',
    tokenizer: 'tiktoken',
    maxContext: 31700,
    totalTokens: 12000,
    includesDraft: false,
    ...extra,
});

const lastSentData = (extra = {}) => ({ available: true, mainApi: 'openai', totalTokens: 9000, maxContext: 31700, ...extra });

function makeState({ estimate = {}, itemized = {}, selectedChat = 'chat-a', engine = {}, route = 'chat' } = {}) {
    return {
        route,
        selected: { chat: selectedChat },
        settings: { main_api: 'openai', oai_settings: { openai_max_context: 32000, openai_max_tokens: 300 } },
        chatMetadata: { 'a.png::chat-a': { integrity: 'int-9' } },
        engine: { ready: true, generating: false, checking: false, settingsSyncPending: 0, ...engine },
        inspector: {
            itemizedPrompt: { loaded: true, loading: false, error: '', chatId: 'chat-a', data: lastSentData(), ...itemized },
            promptEstimate: { loading: false, loaded: true, error: '', reason: '', message: '', chatId: 'chat-a', data: estimateData(), ...estimate },
        },
    };
}

describe('getValidPromptEstimate', () => {
    test('returns the estimate of the chat being viewed', () => {
        expect(getValidPromptEstimate(makeState())).toMatchObject({ totalTokens: 12000 });
    });

    test('is empty for another chat, a failed or unloaded estimate, and an answer without numbers', () => {
        expect(getValidPromptEstimate(makeState({ estimate: { chatId: 'chat-b' } }))).toBeNull();
        expect(getValidPromptEstimate(makeState({ estimate: { error: '估算失败' } }))).toBeNull();
        expect(getValidPromptEstimate(makeState({ estimate: { loaded: false } }))).toBeNull();
        expect(getValidPromptEstimate(makeState({ estimate: { data: null } }))).toBeNull();
        expect(getValidPromptEstimate(makeState({ estimate: { data: { available: false } } }))).toBeNull();
        expect(getValidPromptEstimate({ selected: {}, inspector: {} })).toBeNull();
    });
});

describe('normalizePromptEstimateReply', () => {
    test('keeps an available estimate that carries both numbers', () => {
        const reply = estimateData();
        expect(normalizePromptEstimateReply(reply)).toEqual({ data: reply, reason: '', message: '' });
    });

    test('turns everything else into a reason, defaulting to no-data', () => {
        expect(normalizePromptEstimateReply({ available: false, reason: 'group' })).toEqual({ data: null, reason: 'group', message: '' });
        expect(normalizePromptEstimateReply({ available: false, reason: 'budget', message: 'Not enough' })).toEqual({ data: null, reason: 'budget', message: 'Not enough' });
        // An engine that does not know the action answers { ok: true }
        expect(normalizePromptEstimateReply({ ok: true })).toEqual({ data: null, reason: 'no-data', message: '' });
        expect(normalizePromptEstimateReply(null)).toEqual({ data: null, reason: 'no-data', message: '' });
        expect(normalizePromptEstimateReply(estimateData({ totalTokens: 'many' }))).toMatchObject({ data: null, reason: 'no-data' });
        expect(normalizePromptEstimateReply(estimateData({ maxContext: undefined }))).toMatchObject({ data: null, reason: 'no-data' });
    });
});

describe('describePromptEstimateReason', () => {
    test('explains every reason the engine can give, in Chinese', () => {
        expect(describePromptEstimateReason('group')).toBe('群聊暂不支持估算。');
        expect(describePromptEstimateReason('no-character')).toContain('没有选中角色');
        expect(describePromptEstimateReason('unsupported-api')).toContain('Horde');
        expect(describePromptEstimateReason('budget')).toContain('超出提示词预算');
        expect(describePromptEstimateReason('no-data')).toContain('没能拼出提示词');
        expect(describePromptEstimateReason('failed')).toContain('重试');
        expect(describePromptEstimateReason('prompt-error', 'bad name')).toBe('拼装提示词时出错：bad name');
        expect(describePromptEstimateReason('prompt-error')).toBe('拼装提示词时出错。');
        expect(describePromptEstimateReason('something-new')).toBe('暂时无法估算。');
        expect(describePromptEstimateReason('')).toBe('');
    });
});

describe('usage label prefers the estimate over the last sent prompt', () => {
    test('shows the estimate with its own wording, kind and tooltip', () => {
        const view = getChatUsageView(makeState());
        expect(view.kind).toBe('estimate');
        expect(view.text).toBe('预估下次发送 12,000 / 预算 31,700 token');
        expect(view.percentText).toBe('37.9%');
        expect(view.level).toBe('');
        expect(view.title).toContain('按当前设置模拟一次发送');
        expect(view.title).toContain('不含输入框里未发送的文字');
        expect(view.title).toContain('提示词预算 = 上下文 32,000 − 回复上限 300');
        expect(view.title).not.toContain('上次生成');
    });

    test('warns on a nearly full or overfull estimate like it does for the last sent prompt', () => {
        expect(getChatUsageView(makeState({ estimate: { data: estimateData({ totalTokens: 29000 }) } })).level).toBe('is-high');
        expect(getChatUsageView(makeState({ estimate: { data: estimateData({ totalTokens: 31700 }) } })).level).toBe('is-over');
    });

    test('falls back to the last sent prompt when the estimate is missing, belongs to another chat, failed, or is not available', () => {
        for (const estimate of [{ data: null }, { chatId: 'chat-b' }, { error: '估算失败' }, { loaded: false }, { data: { available: false } }, { data: estimateData({ totalTokens: 'x' }) }]) {
            const view = getChatUsageView(makeState({ estimate }));
            expect(view.kind).toBe('last');
            expect(view.text).toBe('上次发送 9,000 / 预算 31,700 token');
            expect(view.title).toContain('上次生成的提示词共 9,000 token');
        }
    });

    test('shows the estimate even when there is no last sent snapshot, and nothing when there is neither', () => {
        expect(getChatUsageView(makeState({ itemized: { data: null, loaded: false } })).kind).toBe('estimate');
        expect(getChatUsageView(makeState({ estimate: { data: null }, itemized: { data: null } }))).toBeNull();
        // A state that never had the estimate slot (older tests build it by hand) keeps working
        const withoutSlot = makeState();
        delete withoutSlot.inspector.promptEstimate;
        expect(getChatUsageView(withoutSlot).kind).toBe('last');
    });

    test('an estimate for another chat does not hide a last sent prompt that belongs to this chat, and vice versa', () => {
        const view = getChatUsageView(makeState({ selectedChat: 'chat-b', estimate: { chatId: 'chat-a' }, itemized: { chatId: 'chat-b', data: lastSentData({ totalTokens: 500 }) } }));
        expect(view.text).toBe('上次发送 500 / 预算 31,700 token');
        expect(getChatUsageView(makeState({ selectedChat: 'chat-b', estimate: { chatId: 'chat-a' } }))).toBeNull();
    });
});

describe('prompt budget section view', () => {
    test('shows the estimate with the button enabled', () => {
        const view = getPromptEstimateSectionView(makeState());
        expect(view).toMatchObject({ kind: 'estimate', buttonDisabled: false });
        expect(view.data.totalTokens).toBe(12000);
    });

    test('says group chats are unsupported and disables the button', () => {
        const view = getPromptEstimateSectionView(makeState({ estimate: { data: null } }), { groupMode: true });
        expect(view).toMatchObject({ kind: 'group', text: '群聊暂不支持估算。', buttonDisabled: true, buttonTitle: '群聊暂不支持估算。' });
    });

    test('shows loading only while there is no estimate to show, and blocks the button while loading or generating', () => {
        expect(getPromptEstimateSectionView(makeState({ estimate: { loading: true, data: null, loaded: false } }))).toMatchObject({ kind: 'loading', buttonDisabled: true });
        expect(getPromptEstimateSectionView(makeState({ estimate: { loading: true } }))).toMatchObject({ kind: 'estimate', buttonDisabled: true });
        const generating = getPromptEstimateSectionView(makeState({ engine: { generating: true } }));
        expect(generating.buttonDisabled).toBe(true);
        expect(generating.buttonTitle).toContain('正在生成');
    });

    test('shows a manual failure, then the engine reason, then the idle hint', () => {
        expect(getPromptEstimateSectionView(makeState({ estimate: { data: null, loaded: false, error: '生成引擎响应超时。' } })))
            .toMatchObject({ kind: 'error', text: '估算失败：生成引擎响应超时。' });
        expect(getPromptEstimateSectionView(makeState({ estimate: { data: null, reason: 'budget' } })))
            .toMatchObject({ kind: 'reason', text: expect.stringContaining('超出提示词预算') });
        expect(getPromptEstimateSectionView(makeState({ estimate: { data: null, loaded: false, reason: 'failed' } })))
            .toMatchObject({ kind: 'reason', text: expect.stringContaining('自动估算没有成功') });
        // A reason that belongs to another chat is not shown
        expect(getPromptEstimateSectionView(makeState({ estimate: { data: null, reason: 'budget', chatId: 'chat-b' } })).kind).toBe('idle');
        expect(getPromptEstimateSectionView(makeState({ estimate: { data: null, loaded: false, chatId: '' } })).kind).toBe('idle');
    });
});

describe('onBridgeReloadSettled', () => {
    test('tells subscribers about every reload the engine confirmed, after it left the pending count', async () => {
        const state = { engine: { settingsSyncPending: 0 } };
        const results = { reloadSettings: { ok: true }, reloadCharacter: { ok: false, error: 'no' }, reloadChat: new Error('gone') };
        const reload = createBridgeReload(async action => {
            const result = results[action];
            if (result instanceof Error) {
                throw result;
            }
            return result;
        }, { state });
        const events = [];
        const pendingWhenTold = [];
        const unsubscribe = onBridgeReloadSettled(event => {
            events.push(event);
            pendingWhenTold.push(state.engine.settingsSyncPending);
        });
        const throwing = onBridgeReloadSettled(() => {
            throw new Error('a broken subscriber');
        });
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        try {
            expect(await reload.reloadSettings()).toMatchObject({ ok: true });
            expect(await reload.reloadCharacter()).toMatchObject({ ok: false });
            expect(await reload.reloadChat({})).toMatchObject({ ok: false });
            expect(events).toEqual([{ action: BRIDGE_ACTIONS.RELOAD_SETTINGS }]);
            expect(pendingWhenTold).toEqual([0]);

            unsubscribe();
            throwing();
            await reload.reloadSettings();
            expect(events).toHaveLength(1);
        } finally {
            unsubscribe();
            throwing();
            warn.mockRestore();
        }
    });
});

describe('prompt estimate actions', () => {
    let world;
    let bridgeCalls;
    let bridgeReply;
    let renders;
    let waits;
    let actions;

    function setup({ stateOptions = {}, groupMode = false, reply = () => estimateData(), onWait = () => {} } = {}) {
        // The subscription registries are shared by the whole module: a previous instance must not keep listening
        actions?.disposePromptEstimate();
        const state = makeState({ estimate: { loaded: false, data: null, chatId: '' }, ...stateOptions });
        world = { avatar: 'a.png', groupMode };
        bridgeCalls = [];
        bridgeReply = reply;
        renders = 0;
        waits = 0;
        const actionRegistry = {
            getSelectedChatEntity: () => (world.groupMode ? { id: 'g1' } : { avatar: world.avatar }),
            isGroupChatMode: () => world.groupMode,
            getChatContextKey: (entity, groupMode) => (groupMode ? `group:${entity.id}` : entity.avatar),
            chatContextActions: { getChatCacheKey: (contextKey, chatId) => `${contextKey}::${chatId}` },
        };
        actions = createPromptEstimateActions({
            state,
            actionRegistry,
            renderInspector: () => {
                renders++;
            },
            bridgeReload: {
                waitForPendingReloads: async () => {
                    waits++;
                    onWait();
                    return { settled: true };
                },
            },
            callLegacyBridge: async (action, payload, timeoutMs) => {
                bridgeCalls.push({ action, payload, timeoutMs });
                return bridgeReply(payload);
            },
        });
        return state;
    }

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
        actions?.disposePromptEstimate();
        jest.useRealTimers();
    });

    test('a manual estimate sends the chat, its integrity and the longer timeout, and stores the answer for this chat', async () => {
        const state = setup();
        await actions.estimatePrompt({ manual: true });

        expect(bridgeCalls).toEqual([{
            action: BRIDGE_ACTIONS.ESTIMATE_PROMPT,
            payload: { avatar: 'a.png', groupId: null, chat: 'chat-a', integrity: 'int-9' },
            timeoutMs: BRIDGE_TIMEOUTS.ESTIMATE,
        }]);
        expect(waits).toBe(1);
        expect(state.inspector.promptEstimate).toMatchObject({ loading: false, loaded: true, chatId: 'chat-a', reason: '', error: '' });
        expect(state.inspector.promptEstimate.data.totalTokens).toBe(12000);
        expect(renders).toBeGreaterThanOrEqual(2);
    });

    test('records the engine reason when there is no estimate to give', async () => {
        const state = setup({ reply: () => ({ available: false, reason: 'budget', message: 'Not enough free tokens' }) });
        await actions.estimatePrompt({ manual: true });
        expect(state.inspector.promptEstimate).toMatchObject({ loaded: true, data: null, reason: 'budget', message: 'Not enough free tokens', error: '' });
    });

    test('a group chat sends nothing and records that it is unsupported', async () => {
        const state = setup({ groupMode: true });
        await actions.estimatePrompt({ manual: true });
        expect(bridgeCalls).toEqual([]);
        expect(state.inspector.promptEstimate).toMatchObject({ loaded: true, reason: 'group', data: null });
    });

    test('never estimates during a generation, even when asked', async () => {
        const state = setup({ stateOptions: { engine: { generating: true } } });
        await actions.estimatePrompt({ manual: true });
        expect(bridgeCalls).toEqual([]);
        expect(state.inspector.promptEstimate.loading).toBe(false);
    });

    test('drops the answer when the viewed chat changed while the engine was working', async () => {
        let state;
        state = setup({ reply: () => {
            state.selected.chat = 'chat-b';
            return estimateData();
        } });
        await actions.estimatePrompt({ manual: true });
        expect(bridgeCalls).toHaveLength(1);
        expect(state.inspector.promptEstimate).toMatchObject({ loading: false, loaded: false, data: null });
        // The last sent prompt belongs to the other chat too, so there is nothing to show
        expect(getChatUsageView(state)).toBeNull();

        // Same for another character that happens to have a chat of the same name
        state = setup({ reply: () => {
            world.avatar = 'b.png';
            return estimateData();
        } });
        await actions.estimatePrompt({ manual: true });
        expect(state.inspector.promptEstimate).toMatchObject({ loaded: false, data: null });
    });

    test('does not send when the chat changed while it waited for pending engine syncs', async () => {
        let state;
        state = setup({ onWait: () => {
            state.selected.chat = 'chat-b';
        } });
        await actions.estimatePrompt({ manual: true });
        expect(waits).toBe(1);
        expect(bridgeCalls).toEqual([]);
        expect(state.inspector.promptEstimate).toMatchObject({ loading: false, loaded: false, data: null });
    });

    test('a manual failure is shown as an error, an automatic one only leaves a reason', async () => {
        const failing = () => {
            throw new Error('生成引擎响应超时。');
        };
        let state = setup({ reply: failing });
        await actions.estimatePrompt({ manual: true });
        expect(state.inspector.promptEstimate).toMatchObject({ loading: false, loaded: false, data: null, error: '生成引擎响应超时。', reason: '' });
        expect(getChatUsageView(state)?.kind).toBe('last');

        state = setup({ reply: failing });
        await actions.estimatePrompt({ manual: false });
        expect(state.inspector.promptEstimate).toMatchObject({ loading: false, loaded: false, data: null, error: '', reason: 'failed' });

        // A later success clears the failure again
        bridgeReply = () => estimateData();
        await actions.estimatePrompt({ manual: false });
        expect(state.inspector.promptEstimate).toMatchObject({ loaded: true, reason: '', error: '' });
    });

    test('a request that comes in while one is running is sent once more afterwards, keeping the manual mark', async () => {
        let release;
        let calls = 0;
        const state = setup({ reply: () => {
            calls++;
            return calls === 1 ? new Promise(resolve => {
                release = () => resolve(estimateData({ totalTokens: 100 }));
            }) : estimateData({ totalTokens: 200 });
        } });
        const first = actions.estimatePrompt({ manual: false });
        await jest.advanceTimersByTimeAsync(0);
        expect(state.inspector.promptEstimate.loading).toBe(true);

        await actions.estimatePrompt({ manual: false });
        await actions.estimatePrompt({ manual: true });
        expect(bridgeCalls).toHaveLength(1);

        release();
        await first;
        // One follow-up for the two requests that arrived meanwhile, with the newest answer in the end
        expect(bridgeCalls).toHaveLength(2);
        expect(state.inspector.promptEstimate.data.totalTokens).toBe(200);
        expect(state.inspector.promptEstimate.loading).toBe(false);
    });

    describe('automatic triggers', () => {
        test('opening the drawer estimates once for a chat that has no estimate, and never again for the same chat', async () => {
            const state = setup();
            actions.estimatePromptOnInspectorOpen();
            await jest.advanceTimersByTimeAsync(0);
            expect(bridgeCalls).toHaveLength(1);
            expect(state.inspector.promptEstimate).toMatchObject({ loaded: true, chatId: 'chat-a' });

            actions.estimatePromptOnInspectorOpen();
            await jest.advanceTimersByTimeAsync(0);
            expect(bridgeCalls).toHaveLength(1);

            // Another chat gets its own estimate
            state.selected.chat = 'chat-b';
            actions.estimatePromptOnInspectorOpen();
            await jest.advanceTimersByTimeAsync(0);
            expect(bridgeCalls).toHaveLength(2);
        });

        test('opening the drawer never wakes an engine that was not loaded, and never estimates a group, the wrong route, or a running generation', async () => {
            for (const options of [
                { stateOptions: { engine: { ready: false } } },
                { stateOptions: { engine: { generating: true } } },
                { stateOptions: { engine: { checking: true } } },
                { stateOptions: { route: 'dashboard' } },
                { groupMode: true },
            ]) {
                const state = setup(options);
                actions.estimatePromptOnInspectorOpen();
                await jest.advanceTimersByTimeAsync(2000);
                expect(bridgeCalls).toEqual([]);
                expect(state.inspector.promptEstimate.loaded).toBe(false);
                actions.disposePromptEstimate();
            }
        });

        test('a successful settings sync estimates once, a second later, however many syncs came', async () => {
            setup();
            const reload = createBridgeReload(async () => ({ ok: true }));
            await reload.reloadSettings();
            await jest.advanceTimersByTimeAsync(600);
            await reload.reloadSettings();
            await jest.advanceTimersByTimeAsync(600);
            expect(bridgeCalls).toEqual([]);
            await jest.advanceTimersByTimeAsync(500);
            expect(bridgeCalls).toHaveLength(1);

            // Other reloads and failed ones do not trigger anything
            await reload.reloadCharacter();
            await reload.reloadWorldInfo();
            const failing = createBridgeReload(async () => ({ ok: false, error: 'no' }));
            await failing.reloadSettings();
            await jest.advanceTimersByTimeAsync(3000);
            expect(bridgeCalls).toHaveLength(1);
        });

        test('what the engine was synced with makes an existing estimate stale: it is dropped, or kept until the new one arrives after a settings sync', async () => {
            const state = setup({ stateOptions: { estimate: { loaded: true, chatId: 'chat-a', data: estimateData() } } });
            const reload = createBridgeReload(async () => ({ ok: true }));

            // A chat, character or world book sync cannot be re-estimated by itself: the number no longer matches, so the label goes back to the last sent prompt
            await reload.reloadChat({});
            expect(state.inspector.promptEstimate).toMatchObject({ loaded: false, data: null });
            expect(getChatUsageView(state).kind).toBe('last');
            await jest.advanceTimersByTimeAsync(3000);
            expect(bridgeCalls).toEqual([]);

            // A settings sync that will be re-estimated keeps the old number until the new one replaces it
            state.inspector.promptEstimate = { loading: false, loaded: true, error: '', reason: '', message: '', chatId: 'chat-a', data: estimateData() };
            await reload.reloadSettings();
            expect(getChatUsageView(state).kind).toBe('estimate');
            await jest.advanceTimersByTimeAsync(1100);
            expect(bridgeCalls).toHaveLength(1);
            expect(state.inspector.promptEstimate.data.totalTokens).toBe(12000);

            // The same sync with the engine not loaded cannot be re-estimated, so the stale number goes
            state.engine.ready = false;
            await reload.reloadSettings();
            expect(state.inspector.promptEstimate).toMatchObject({ loaded: false, data: null });
        });

        test('a settings sync does nothing for an unloaded engine, another route or a group, and nothing is sent if one of those became true during the wait', async () => {
            for (const options of [{ stateOptions: { engine: { ready: false } } }, { stateOptions: { route: 'api' } }, { groupMode: true }]) {
                setup(options);
                await createBridgeReload(async () => ({ ok: true })).reloadSettings();
                await jest.advanceTimersByTimeAsync(3000);
                expect(bridgeCalls).toEqual([]);
                actions.disposePromptEstimate();
            }

            const state = setup();
            await createBridgeReload(async () => ({ ok: true })).reloadSettings();
            await jest.advanceTimersByTimeAsync(500);
            state.engine.generating = true;
            await jest.advanceTimersByTimeAsync(1000);
            expect(bridgeCalls).toEqual([]);
        });

        test('a finished generation invalidates the estimate, cancels a pending settings estimate and discards an answer still on its way', async () => {
            const state = setup({ stateOptions: {} });
            await actions.estimatePrompt({ manual: true });
            expect(getChatUsageView(state).kind).toBe('estimate');
            const rendersBefore = renders;

            notifyGenerationFinished();
            expect(state.inspector.promptEstimate).toMatchObject({ loaded: false, data: null, reason: '', error: '' });
            expect(renders).toBeGreaterThan(rendersBefore);
            expect(getChatUsageView(state).kind).toBe('last');

            // A settings estimate that was waiting is cancelled
            await createBridgeReload(async () => ({ ok: true })).reloadSettings();
            await jest.advanceTimersByTimeAsync(500);
            notifyGenerationFinished();
            await jest.advanceTimersByTimeAsync(2000);
            expect(bridgeCalls).toHaveLength(1);

            // An answer for a request sent before the generation finished is not taken
            let release;
            bridgeReply = () => new Promise(resolve => {
                release = () => resolve(estimateData());
            });
            const inFlight = actions.estimatePrompt({ manual: true });
            await jest.advanceTimersByTimeAsync(0);
            notifyGenerationFinished();
            release();
            await inFlight;
            expect(state.inspector.promptEstimate).toMatchObject({ loading: false, loaded: false, data: null });
        });
    });
});
