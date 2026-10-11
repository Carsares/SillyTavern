/* global globalThis */

import { beforeEach, describe, expect, jest, test } from '@jest/globals';

// chat-context.js 引入的 core/state.js 在加载时就读 localStorage 和 window.matchMedia：先放好替身再加载
const storage = new Map();
globalThis.localStorage = /** @type {any} */ ({
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
});
globalThis.window = /** @type {any} */ ({ matchMedia: () => ({ matches: false }) });
const { createChatContextActions } = await import('../public/modern/actions/chat-context.js');
const { countSinceLastSummary, getSummaryProgress } = await import('../public/modern/core/chat-summary.js');
const { buildImageMessage, isImageMessage } = await import('../public/modern/core/image-message.js');

// 设计文档 docs/image-generation/FRONTEND-DESIGN.md 第 6 节的两处既有问题：
//   1. 服务端用 HTTP 400 + {"error":"integrity"} 拒绝过期 integrity 的保存，saveModernChatNow 要给出友好提示；
//   2. 自动摘要的计数不算 is_system 消息（图片消息、隐藏的消息）。

const INTEGRITY_MESSAGE = '聊天文件已被其他会话修改，请刷新后重试。';

/** 与 core/api-client.js 的 fetchWithCsrf 抛出的错误同形：message、status、body（响应体前 2000 字）。 */
function httpError(path, status, body) {
    const error = /** @type {Error & { status?: number, body?: string }} */ (new Error(`${path} failed: ${status}`));
    error.status = status;
    error.body = body;
    return error;
}

function createHarness(respond) {
    const character = { avatar: 'alice.png', name: 'Alice', data: { name: 'Alice' } };
    const group = { id: 'g1', name: 'Group', members: ['alice.png'] };
    const state = {
        characters: [character],
        groups: [group],
        settings: {},
        selected: { character: 'alice.png', group: '', chat: 'chat-1' },
        chatMode: 'character',
        chatLists: {},
        chatMessages: {
            'alice.png::chat-1': [{ name: 'Alice', mes: 'before' }],
            'group:g1::chat-1': [{ name: 'Alice', mes: 'before' }],
        },
        chatMessageLimits: {},
        chatMetadata: {
            'alice.png::chat-1': { integrity: 'int-1' },
            'group:g1::chat-1': { integrity: 'int-1' },
        },
        chatDrafts: {},
        errors: [],
    };
    const calls = [];
    const apiFetch = jest.fn(async (url, options = {}) => {
        calls.push({ url, body: options.body });
        return respond(url, options.body);
    });
    const actions = createChatContextActions({
        state,
        apiFetch,
        render: () => {},
        showToast: () => {},
        getCharacterAvatarUrl: avatar => `/thumbnail?type=avatar&file=${avatar}`,
    });
    return { actions, state, calls, character, group };
}

const nextMessages = [{ name: 'Alice', mes: 'before' }, { name: 'You', is_user: true, mes: 'after' }];

describe('saveModernChatNow surfaces an integrity conflict as a friendly message', () => {
    beforeEach(() => {
        storage.clear();
    });

    test('a 400 with {"error":"integrity"} from /api/chats/save becomes the friendly message, keeping status and body', async () => {
        const original = httpError('/api/chats/save', 400, '{"error":"integrity"}');
        const harness = createHarness(() => {
            throw original;
        });

        const failure = await harness.actions.saveModernChat(harness.character, 'chat-1', nextMessages, { groupMode: false }).catch(error => error);

        expect(failure).toBeInstanceOf(Error);
        expect(failure.message).toBe(INTEGRITY_MESSAGE);
        expect(failure.status).toBe(400);
        expect(failure.body).toBe('{"error":"integrity"}');
        expect(failure.cause).toBe(original);
        expect(harness.calls.map(call => call.url)).toEqual(['/api/chats/save']);
        // 保存失败：缓存的消息和 integrity 都保持原样
        expect(harness.state.chatMessages['alice.png::chat-1']).toEqual([{ name: 'Alice', mes: 'before' }]);
        expect(harness.state.chatMetadata['alice.png::chat-1']).toEqual({ integrity: 'int-1' });
    });

    test('the group save endpoint gets the same friendly message', async () => {
        const harness = createHarness(url => {
            throw httpError(url, 400, '{"error":"integrity"}');
        });

        await expect(harness.actions.saveModernChat(harness.group, 'chat-1', nextMessages, { groupMode: true }))
            .rejects.toThrow(INTEGRITY_MESSAGE);
        expect(harness.calls.map(call => call.url)).toEqual(['/api/chats/group/save']);
        expect(harness.state.chatMessages['group:g1::chat-1']).toEqual([{ name: 'Alice', mes: 'before' }]);
    });

    test('updateModernChat (the path image writes use) reports the conflict the same way', async () => {
        const harness = createHarness(url => {
            throw httpError(url, 400, '{"error":"integrity"}');
        });

        await expect(harness.actions.updateModernChat(harness.character, 'chat-1', messages => {
            messages.push({ name: 'Alice', is_system: true, mes: '' });
        }, { groupMode: false })).rejects.toThrow(INTEGRITY_MESSAGE);
        expect(harness.state.chatMessages['alice.png::chat-1']).toEqual([{ name: 'Alice', mes: 'before' }]);
    });

    test('the existing branch for a 200 response carrying {"error":"integrity"} still gives the friendly message', async () => {
        const harness = createHarness(() => ({ error: 'integrity' }));

        await expect(harness.actions.saveModernChat(harness.character, 'chat-1', nextMessages, { groupMode: false }))
            .rejects.toThrow(INTEGRITY_MESSAGE);
    });

    test.each([
        ['another 400 error', 400, '{"error":"The request\'s body.chat is not an array."}'],
        ['a 400 with a body that is not JSON', 400, 'Bad Request'],
        ['a 400 with an empty body', 400, ''],
        ['a 400 whose JSON body is null', 400, 'null'],
        ['a 500 that mentions integrity', 500, '{"error":"integrity"}'],
    ])('%s is rethrown unchanged', async (_label, status, body) => {
        const original = httpError('/api/chats/save', status, body);
        const harness = createHarness(() => {
            throw original;
        });

        const failure = await harness.actions.saveModernChat(harness.character, 'chat-1', nextMessages, { groupMode: false }).catch(error => error);

        expect(failure).toBe(original);
    });

    test('a successful save still stores the messages and the newly issued integrity', async () => {
        const harness = createHarness(() => ({ ok: true, integrity: 'int-2' }));

        await harness.actions.saveModernChat(harness.character, 'chat-1', nextMessages, { groupMode: false });

        expect(harness.state.chatMessages['alice.png::chat-1']).toEqual(nextMessages);
        expect(harness.state.chatMetadata['alice.png::chat-1']).toEqual({ integrity: 'int-2' });
        expect(harness.calls[0].body.chat[0].chat_metadata).toEqual({ integrity: 'int-1' });
    });
});

const msg = (mes, extra = {}) => ({ name: 'N', mes, ...extra });
const hidden = (mes, extra = {}) => ({ name: 'N', mes, is_system: true, ...extra });
const image = () => buildImageMessage({
    name: 'Alice',
    sendDate: '2026-10-12T00:00:00.000Z',
    images: [{ path: '/user/images/Alice/one.png', width: 1024, height: 1024, mimeType: 'image/png' }],
    meta: { prompt: 'a cat on a sofa', provider: 'openai', model: 'gpt-image-1', requestId: 'req-1' },
});

describe('auto-summary counting ignores is_system messages', () => {
    test('the image message contract is is_system, so these tests cover the real message shape', () => {
        const message = image();
        expect(isImageMessage(message)).toBe(true);
        expect(message).toMatchObject({ is_system: true, mes: '' });
    });

    test('image messages and hidden messages count neither as messages nor as words since the latest summary', () => {
        const messages = [
            msg('old', { extra: { memory: 'summary' } }),
            msg('one two'),
            image(),
            hidden('these hidden words do not count'),
            msg('three'),
            image(),
        ];
        expect(countSinceLastSummary(messages)).toEqual({ messagesSince: 2, wordsSince: 3 });
    });

    test('a summary held by an is_system message still ends the count', () => {
        const messages = [msg('a'), hidden('holder', { extra: { memory: 'summary' } }), msg('b c'), image()];
        expect(countSinceLastSummary(messages)).toEqual({ messagesSince: 1, wordsSince: 2 });
    });

    test('ordinary chats count exactly as before', () => {
        expect(countSinceLastSummary([msg('a b'), msg('c', { extra: { memory: 's' } }), msg('d e f'), msg('g')]))
            .toEqual({ messagesSince: 2, wordsSince: 4 });
    });

    test('generating images does not make the interval due', () => {
        const memory = { promptInterval: 4, promptForceWords: 0 };
        const messages = [msg('hi'), msg('hello'), msg('draw a cat'), image(), image(), image()];

        // Six messages in total, but only three are conversation: still too short for an interval of four
        expect(getSummaryProgress(messages, memory)).toMatchObject({ due: false, reason: 'too-short', messagesSince: 3, remainingMessages: 1 });

        messages.push(msg('thanks'));
        expect(getSummaryProgress(messages, memory)).toMatchObject({ due: true, reason: 'interval', messagesSince: 4 });
    });

    test('after a summary, only conversation messages move the counter toward the interval', () => {
        const memory = { promptInterval: 3, promptForceWords: 0 };
        const messages = [msg('a'), msg('b'), msg('c', { extra: { memory: 's' } }), msg('d'), image(), image(), image(), msg('e')];

        expect(getSummaryProgress(messages, memory)).toMatchObject({ due: false, reason: 'waiting', messagesSince: 2, remainingMessages: 1 });
    });

    test('hidden words do not reach the word threshold', () => {
        const memory = { promptInterval: 3, promptForceWords: 5 };
        const head = [msg('a'), msg('b'), msg('c', { extra: { memory: 's' } }), msg('one')];

        expect(getSummaryProgress([...head, hidden('two three four five six')], memory))
            .toMatchObject({ due: false, reason: 'waiting', messagesSince: 1, wordsSince: 1 });
        // The same words in a visible message do reach it
        expect(getSummaryProgress([...head, msg('two three four five six')], memory))
            .toMatchObject({ due: true, reason: 'words', messagesSince: 2, wordsSince: 6 });
    });

    test('a chat that holds only is_system messages is too short, not empty', () => {
        expect(getSummaryProgress([image(), image()], { promptInterval: 2, promptForceWords: 0 }))
            .toMatchObject({ due: false, reason: 'too-short', messagesSince: 0, remainingMessages: 2 });
        expect(getSummaryProgress([], { promptInterval: 2, promptForceWords: 0 })).toMatchObject({ due: false, reason: 'empty' });
    });
});
