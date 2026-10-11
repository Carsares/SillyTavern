import { describe, expect, jest, test } from '@jest/globals';

import { createChatGenerationActions } from '../public/modern/actions/chat-generation.js';

// 手动「重新摘要」（summarizeModernChat → requestChatSummary）：引擎写入摘要后服务端签发了新的 integrity，Modern 手里的聊天缓存
// 就过期了。仍在这份聊天时从文件重读；已切到别的聊天时丢掉缓存，切回时重读，不能继续拿旧 integrity 保存。

const contextKey = 'hero.png';
const cacheKey = chatId => `${contextKey}::${chatId}`;

function createHarness({ bridgeResult = { summary: 'Summary text', saved: true, index: 0 }, onSummarize = () => {} } = {}) {
    const messages = [
        { name: 'User', is_user: true, mes: 'Hi', send_date: '2026-10-01T00:00:00.000Z' },
        { name: 'Hero', is_user: false, mes: 'Hello', send_date: '2026-10-01T00:00:01.000Z' },
    ];
    const state = {
        // 摘要来源是主模型（默认的 Extras 来源在 Modern 里不能手动摘要）
        settings: { extension_settings: { memory: { source: 'main' } } },
        selected: { character: contextKey, chat: 'chat-a' },
        engine: { generating: false, settingsSyncPending: 0, status: '', detail: '', error: '', streaming: { text: '', chatId: '' } },
        chatSummary: { running: false, notice: null },
        chatMessages: {
            [cacheKey('chat-a')]: structuredClone(messages),
            [cacheKey('chat-b')]: structuredClone(messages),
        },
        chatMetadata: {
            [cacheKey('chat-a')]: { integrity: 'integrity-before-summary' },
            [cacheKey('chat-b')]: { integrity: 'other-chat' },
        },
    };
    const entity = { avatar: contextKey, name: 'Hero' };
    const callLegacyBridge = jest.fn(async (action, payload) => {
        await onSummarize(state, payload);
        return bridgeResult;
    });
    const loadChatMessages = jest.fn(async (_entity, chatId) => {
        state.chatMessages[cacheKey(chatId)] = structuredClone(messages);
        state.chatMetadata[cacheKey(chatId)] = { integrity: 'integrity-after-summary' };
        return state.chatMessages[cacheKey(chatId)];
    });
    const actions = createChatGenerationActions({
        state,
        apiFetch: async () => {
            throw new Error('not used');
        },
        render: () => {},
        showToast: () => {},
        callLegacyBridge,
        subscribeProgress: () => () => {},
        formatNumber: String,
        getSelectedChatEntity: () => entity,
        getChatContextKey: () => state.selected.character,
        getChatEntityName: item => item.name,
        isGroupChatMode: () => false,
        getSelectedChatMessages: () => state.chatMessages[cacheKey(state.selected.chat)] || [],
        getCurrentDraftKey: () => cacheKey(state.selected.chat),
        getChatCacheKey: (key, chatId) => `${key}::${chatId}`,
        getUserName: () => 'User',
        loadChatMessages,
        refreshSelectedChatList: async () => {},
        createModernChatFile: async () => {
            throw new Error('not used');
        },
        runModernChatFileOperation: async (_entity, chatId, operation) => operation({ contextKey, chatId }),
    });
    return { actions, state, callLegacyBridge, loadChatMessages };
}

describe('summarizeModernChat keeps the chat cache in step with the file the engine wrote', () => {
    test('rereads the chat when it is still open after the summary was written', async () => {
        const harness = createHarness();

        const outcome = await harness.actions.summarizeModernChat();

        expect(outcome).toMatchObject({ stopped: false, written: true });
        expect(harness.callLegacyBridge.mock.calls[0][1]).toMatchObject({ chat: 'chat-a', integrity: 'integrity-before-summary', mode: 'force' });
        expect(harness.loadChatMessages).toHaveBeenCalledWith(expect.anything(), 'chat-a', expect.objectContaining({ force: true }));
        expect(harness.state.chatMetadata[cacheKey('chat-a')].integrity).toBe('integrity-after-summary');
    });

    test('drops the cache of a chat the user left while it was being summarized, and leaves the open chat alone', async () => {
        const harness = createHarness({
            onSummarize: state => {
                state.selected.chat = 'chat-b';
            },
        });

        const outcome = await harness.actions.summarizeModernChat();

        expect(outcome).toMatchObject({ written: true });
        expect(harness.loadChatMessages).not.toHaveBeenCalled();
        // 缓存键里有「.」，toHaveProperty 要用数组形式，否则会被当成嵌套路径
        expect(harness.state.chatMessages).not.toHaveProperty([cacheKey('chat-a')]);
        expect(harness.state.chatMetadata).not.toHaveProperty([cacheKey('chat-a')]);
        expect(harness.state.chatMessages[cacheKey('chat-b')]).toHaveLength(2);
        expect(harness.state.chatMetadata[cacheKey('chat-b')]).toEqual({ integrity: 'other-chat' });
    });

    test('keeps the cache when the engine wrote nothing', async () => {
        const harness = createHarness({
            bridgeResult: { reason: 'save-failed', summary: 'Summary text', saved: false },
            onSummarize: state => {
                state.selected.chat = 'chat-b';
            },
        });

        const outcome = await harness.actions.summarizeModernChat();

        expect(outcome).toMatchObject({ written: false });
        expect(harness.state.chatMetadata[cacheKey('chat-a')]).toEqual({ integrity: 'integrity-before-summary' });
        expect(harness.state.chatMessages[cacheKey('chat-a')]).toHaveLength(2);
    });
});
