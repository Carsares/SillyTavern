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
const { createGroupActions } = await import('../public/modern/actions/groups.js');

// 新建群组（actions/groups.js 的 saveGroupCreate）：不经过浏览器，apiFetch 用替身记录请求；开场白用 chat-context.js 的真实实现，
// 与聊天页新建群聊（createModernChatFile）走同一构造

const header = { chat_metadata: {}, user_name: 'unused', character_name: 'unused' };

function createCharacter(avatar, name, data = {}) {
    return { avatar, name, data: { name, first_mes: `Hello from ${name}.`, ...data } };
}

function createHarness({ characters, handlers = {} } = {}) {
    const calls = [];
    const state = {
        characters: characters ?? [createCharacter('alice.png', 'Alice'), createCharacter('bruno.png', 'Bruno')],
        groups: [],
        settings: {},
        selected: { character: '', group: '', chat: 'previous chat' },
        chatMode: 'character',
        chatLists: {},
        chatMessages: {},
        chatMessageLimits: {},
        chatMetadata: {},
        chatDrafts: {},
        errors: [],
        groupCreating: { active: false, form: {} },
        groupEditing: { id: '', form: {} },
        groupDeleteConfirm: { id: '', name: '' },
    };
    const apiFetch = jest.fn(async (url, options = {}) => {
        calls.push({ url, body: options.body });
        if (handlers[url]) {
            return handlers[url](options.body);
        }
        if (url === '/api/chats/group/save' || url === '/api/chats/group/delete') {
            return { ok: true };
        }
        if (url === '/api/groups/create') {
            return { ...options.body, id: 'new-group' };
        }
        throw new Error(`Unexpected URL ${url}`);
    });
    const { createOpeningMessages } = createChatContextActions({
        state,
        apiFetch,
        render: () => {},
        showToast: () => {},
        getCharacterAvatarUrl: avatar => `/thumbnail?type=avatar&file=${avatar}`,
    });
    const toasts = [];
    const loadData = jest.fn(async () => {});
    const actions = createGroupActions({
        state,
        apiFetch,
        loadData,
        render: () => {},
        showToast: (...args) => toasts.push(args),
        ensureAvailableChatMode: () => {},
        updateGroupMetadata: async () => {
            throw new Error('not used');
        },
        deleteGroupMetadata: async () => {},
        createOpeningMessages,
    });
    return { actions, state, calls, toasts, loadData };
}

function fillCreateForm(harness, { name = 'New Group', members = ['alice.png', 'bruno.png'] } = {}) {
    harness.actions.beginGroupCreate();
    Object.assign(harness.state.groupCreating.form, { name, members });
}

describe('saveGroupCreate', () => {
    beforeEach(() => {
        storage.clear();
    });

    test('writes the first chat with each member\'s greeting after the header, then registers it in the new group', async () => {
        const harness = createHarness();
        fillCreateForm(harness);

        await harness.actions.saveGroupCreate();

        expect(harness.calls.map(call => call.url)).toEqual(['/api/chats/group/save', '/api/groups/create']);
        const save = harness.calls[0].body;
        expect(save.id).toMatch(/^Modern \d{4}-\d{2}-\d{2}T/);
        expect(save.chat[0]).toEqual(header);
        expect(save.chat.slice(1)).toEqual([
            expect.objectContaining({ name: 'Alice', is_user: false, mes: 'Hello from Alice.', original_avatar: 'alice.png' }),
            expect.objectContaining({ name: 'Bruno', is_user: false, mes: 'Hello from Bruno.', original_avatar: 'bruno.png' }),
        ]);
        expect(harness.calls[1].body).toMatchObject({ name: 'New Group', members: ['alice.png', 'bruno.png'], chat_id: save.id, chats: [save.id] });
        expect(harness.state.selected).toMatchObject({ group: 'new-group', chat: '' });
        expect(harness.state.chatMode).toBe('group');
    });

    test('skips members without a greeting, like a new group chat in the legacy UI', async () => {
        const harness = createHarness({
            characters: [createCharacter('alice.png', 'Alice', { first_mes: '' }), createCharacter('bruno.png', 'Bruno')],
        });
        fillCreateForm(harness);

        await harness.actions.saveGroupCreate();

        const chat = harness.calls[0].body.chat;
        expect(chat).toHaveLength(2);
        expect(chat[1]).toMatchObject({ name: 'Bruno', mes: 'Hello from Bruno.' });
    });

    test('reads the full card of a lazily loaded member before writing its greeting', async () => {
        const harness = createHarness({
            characters: [{ avatar: 'alice.png', name: 'Alice', shallow: true }],
            handlers: { '/api/characters/get': body => createCharacter(body.avatar_url, 'Alice', { first_mes: 'Full card hello.' }) },
        });
        fillCreateForm(harness, { members: ['alice.png'] });

        await harness.actions.saveGroupCreate();

        expect(harness.calls.map(call => call.url)).toEqual(['/api/characters/get', '/api/chats/group/save', '/api/groups/create']);
        expect(harness.calls[1].body.chat.slice(1)).toEqual([expect.objectContaining({ mes: 'Full card hello.' })]);
    });

    test('writes nothing and creates no group when a member card cannot be read', async () => {
        const harness = createHarness({
            characters: [{ avatar: 'alice.png', name: 'Alice', shallow: true }],
            handlers: { '/api/characters/get': () => { throw new Error('read failed'); } },
        });
        fillCreateForm(harness, { members: ['alice.png'] });

        await expect(harness.actions.saveGroupCreate()).rejects.toThrow('read failed');
        expect(harness.calls.map(call => call.url)).toEqual(['/api/characters/get']);
        expect(harness.state.groupCreating.active).toBe(true);
    });

    test('deletes the written chat file when the group is not created', async () => {
        const harness = createHarness({
            handlers: { '/api/groups/create': () => { throw new Error('create failed'); } },
        });
        fillCreateForm(harness);

        await expect(harness.actions.saveGroupCreate()).rejects.toThrow('create failed');
        const chatId = harness.calls[0].body.id;
        expect(harness.calls.map(call => call.url)).toEqual(['/api/chats/group/save', '/api/groups/create', '/api/chats/group/delete']);
        expect(harness.calls[2].body).toEqual({ id: chatId });
    });
});
