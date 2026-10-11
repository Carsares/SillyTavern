/* global globalThis */
import { test, expect } from '@playwright/test';
import { createChatGenerationActions } from '../public/modern/actions/chat-generation.js';

// updateModernChatMetadata is the one write path for chat-level settings kept in the chat file header (author's note,
// pinned background, ...). These tests drive the real action against a fake server that checks the integrity revision
// of every save the way src/endpoints/chats.js does.

const character = { avatar: 'alice.png', name: 'Alice' };
const group = { id: 'group-1', name: 'Group One' };

function createMessages() {
    return [
        { name: 'Alice', is_user: false, is_system: false, send_date: '2026-10-11T08:00:00.000Z', mes: 'hello', extra: {} },
        { name: 'You', is_user: true, is_system: false, send_date: '2026-10-11T08:00:01.000Z', mes: 'hi', extra: {} },
    ];
}

/**
 * A chat file as the server keeps it plus the modern state that mirrors it.
 * @param {object} [options] Fixture options
 * @param {boolean} [options.groupMode] Use the group chat endpoints
 * @param {boolean} [options.loaded] Whether the modern state already holds the chat
 * @param {object} [options.engine] Overrides for state.engine
 * @returns {object} state, server file, request log and the pieces tests poke at
 */
function createFixture({ groupMode = false, loaded = true, engine = {} } = {}) {
    const entity = groupMode ? group : character;
    const contextKey = groupMode ? `group:${group.id}` : character.avatar;
    const chatId = 'chat-a';
    const cacheKey = `${contextKey}::${chatId}`;
    const file = {
        metadata: { integrity: 'int-1', note_prompt: 'old note', custom: { keep: true } },
        messages: createMessages(),
        saves: 0,
    };
    const requests = [];
    const saveGates = [];
    const state = {
        characters: groupMode ? [] : [character],
        groups: groupMode ? [group] : [],
        chatMode: groupMode ? 'group' : 'character',
        selected: { character: groupMode ? '' : character.avatar, group: groupMode ? group.id : '', chat: chatId },
        chatLists: {},
        loadingChats: {},
        errors: [],
        chatSearch: { avatar: '', contextKey: '', query: '', searchedQuery: '', loading: false, results: [] },
        chatMessages: loaded ? { [cacheKey]: structuredClone(file.messages) } : {},
        chatMetadata: loaded ? { [cacheKey]: structuredClone(file.metadata) } : {},
        chatReadState: { cursors: {}, contexts: {} },
        chatMessageLimits: {},
        chatDrafts: {},
        settings: {},
        engine: { generating: false, checking: false, ready: false, status: '', error: '', detail: '', ...engine },
    };

    async function apiFetch(url, options = {}) {
        const body = options.body;
        requests.push({ url, body: structuredClone(body) });
        if (url === '/api/chats/get' || url === '/api/chats/group/get') {
            return [{ chat_metadata: structuredClone(file.metadata), user_name: 'unused', character_name: 'unused' }, ...structuredClone(file.messages)];
        }
        if (url === '/api/chats/save' || url === '/api/chats/group/save') {
            const gate = saveGates.shift();
            if (gate) {
                await gate;
            }
            const [header, ...messages] = body.chat;
            if (header.chat_metadata?.integrity !== file.metadata.integrity) {
                return { error: 'integrity' };
            }
            file.saves++;
            file.metadata = { ...structuredClone(header.chat_metadata), integrity: `int-${file.saves + 1}` };
            file.messages = structuredClone(messages);
            return { ok: true, integrity: file.metadata.integrity };
        }
        throw new Error(`Unexpected URL ${url}`);
    }

    return { entity, contextKey, chatId, cacheKey, file, requests, saveGates, state, apiFetch, groupMode };
}

/**
 * Builds the chat context actions with the globals the module reads at construction time stubbed out.
 * @param {ReturnType<typeof createFixture>} fixture Fixture to run against
 * @param {object} [overrides] Extra factory arguments (e.g. reloadChat)
 * @param {(actions: any) => Promise<void>} run Test body
 */
async function withChatActions(fixture, overrides, run) {
    const previousLocalStorage = globalThis.localStorage;
    const previousWindow = globalThis.window;
    globalThis.localStorage = { getItem: () => null, setItem: () => {} };
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    try {
        const { createChatContextActions } = await import('../public/modern/actions/chat-context.js');
        const actions = createChatContextActions({
            state: fixture.state,
            apiFetch: fixture.apiFetch,
            render: () => {},
            showToast: () => {},
            getCharacterAvatarUrl: () => '',
            ...overrides,
        });
        await run(actions);
    } finally {
        globalThis.localStorage = previousLocalStorage;
        globalThis.window = previousWindow;
    }
}

const saveRequests = fixture => fixture.requests.filter(request => request.url.endsWith('/save'));

test.describe('Modern chat metadata write path', () => {
    test('saves the changed metadata with the existing messages and keeps the issued integrity', async () => {
        const fixture = createFixture();
        const reloads = [];
        await withChatActions(fixture, { reloadChat: async payload => (reloads.push(payload), { ok: true }) }, async actions => {
            const outcome = await actions.updateModernChatMetadata(fixture.entity, fixture.chatId, metadata => {
                metadata.note_prompt = 'new note';
                metadata.note_interval = 3;
                return 'mutated';
            }, { groupMode: false });

            const [save] = saveRequests(fixture);
            expect(save.url).toBe('/api/chats/save');
            expect(save.body).toMatchObject({ ch_name: 'Alice', file_name: 'chat-a', avatar_url: 'alice.png' });
            const [header, ...messages] = save.body.chat;
            expect(header.chat_metadata).toEqual({ integrity: 'int-1', note_prompt: 'new note', note_interval: 3, custom: { keep: true } });
            expect(messages).toEqual(createMessages());

            expect(outcome.result).toBe('mutated');
            expect(outcome.reload).toEqual({ ok: true });
            // The server issued int-2: the modern state follows the file instead of the revision it sent
            expect(outcome.metadata).toMatchObject({ integrity: 'int-2', note_prompt: 'new note', note_interval: 3 });
            expect(fixture.state.chatMetadata[fixture.cacheKey]).toEqual(fixture.file.metadata);
            expect(fixture.state.chatMessages[fixture.cacheKey]).toEqual(createMessages());
            expect(reloads).toEqual([{ avatar: 'alice.png', chat: 'chat-a' }]);

            // A second write is accepted only because the first one's revision was stored
            await actions.updateModernChatMetadata(fixture.entity, fixture.chatId, metadata => {
                metadata.note_interval = 5;
            }, { groupMode: false });
            expect(saveRequests(fixture)[1].body.chat[0].chat_metadata.integrity).toBe('int-2');
            expect(fixture.file.metadata).toMatchObject({ integrity: 'int-3', note_interval: 5, note_prompt: 'new note' });
        });
    });

    test('does not resolve before the engine finished reloading the chat and reports a failed reload', async () => {
        const fixture = createFixture();
        let releaseReload = () => {};
        const reloadGate = new Promise(resolve => {
            releaseReload = resolve;
        });
        const events = [];
        let reloadResult = { ok: true };
        await withChatActions(fixture, {
            reloadChat: async () => {
                events.push('reload started');
                await reloadGate;
                events.push('reload finished');
                return reloadResult;
            },
        }, async actions => {
            const update = actions.updateModernChatMetadata(fixture.entity, fixture.chatId, metadata => {
                metadata.note_prompt = 'pending';
            }, { groupMode: false }).then(outcome => {
                events.push('update resolved');
                return outcome;
            });

            await expect.poll(() => events).toEqual(['reload started']);
            // Intentional wait: the update must stay unresolved while the engine is still reloading
            // eslint-disable-next-line playwright/no-wait-for-timeout
            await new Promise(resolve => setTimeout(resolve, 150));
            expect(events).toEqual(['reload started']);
            // The file is already saved at this point; only the engine has not caught up
            expect(fixture.file.metadata.note_prompt).toBe('pending');

            releaseReload();
            expect((await update).reload).toEqual({ ok: true });
            expect(events).toEqual(['reload started', 'reload finished', 'update resolved']);

            reloadResult = { ok: false, error: 'engine unavailable' };
            const failed = await actions.updateModernChatMetadata(fixture.entity, fixture.chatId, metadata => {
                metadata.note_prompt = 'still saved';
            }, { groupMode: false });
            expect(failed.reload).toEqual({ ok: false, error: 'engine unavailable' });
            expect(fixture.file.metadata.note_prompt).toBe('still saved');
        });
    });

    test('refuses while a generation is running and sends nothing', async () => {
        const fixture = createFixture({ engine: { generating: true } });
        const reloads = [];
        await withChatActions(fixture, { reloadChat: async payload => (reloads.push(payload), { ok: true }) }, async actions => {
            await expect(actions.updateModernChatMetadata(fixture.entity, fixture.chatId, metadata => {
                metadata.note_prompt = 'blocked';
            }, { groupMode: false })).rejects.toThrow('生成中不能修改聊天设置');

            expect(fixture.requests).toEqual([]);
            expect(reloads).toEqual([]);
            expect(fixture.state.chatMetadata[fixture.cacheKey].note_prompt).toBe('old note');
        });
    });

    test('ignores a changed integrity and saves nothing when the update throws', async () => {
        const fixture = createFixture();
        const reloads = [];
        await withChatActions(fixture, { reloadChat: async payload => (reloads.push(payload), { ok: true }) }, async actions => {
            await actions.updateModernChatMetadata(fixture.entity, fixture.chatId, metadata => {
                metadata.integrity = 'forged';
                metadata.note_prompt = 'kept';
            }, { groupMode: false });
            expect(saveRequests(fixture)[0].body.chat[0].chat_metadata.integrity).toBe('int-1');
            expect(fixture.file.metadata).toMatchObject({ integrity: 'int-2', note_prompt: 'kept' });

            await expect(actions.updateModernChatMetadata(fixture.entity, fixture.chatId, () => {
                throw new Error('invalid note');
            }, { groupMode: false })).rejects.toThrow('invalid note');
            expect(saveRequests(fixture)).toHaveLength(1);
            expect(reloads).toHaveLength(1);

            await expect(actions.updateModernChatMetadata(fixture.entity, fixture.chatId, 'not a function', { groupMode: false }))
                .rejects.toThrow('聊天元数据更新方法无效');
        });
    });

    test('surfaces an integrity conflict instead of overwriting a newer chat file', async () => {
        const fixture = createFixture();
        const reloads = [];
        await withChatActions(fixture, { reloadChat: async payload => (reloads.push(payload), { ok: true }) }, async actions => {
            // Someone else saved the chat after the modern UI read it
            fixture.file.metadata.integrity = 'int-elsewhere';

            await expect(actions.updateModernChatMetadata(fixture.entity, fixture.chatId, metadata => {
                metadata.note_prompt = 'lost update';
            }, { groupMode: false })).rejects.toThrow('聊天文件已被其他会话修改');

            expect(fixture.file.metadata.note_prompt).toBe('old note');
            expect(fixture.state.chatMetadata[fixture.cacheKey]).toMatchObject({ integrity: 'int-1', note_prompt: 'old note' });
            expect(reloads).toEqual([]);
        });
    });

    test('reads the chat first when the modern UI never loaded it, so no message is lost', async () => {
        const fixture = createFixture({ loaded: false });
        await withChatActions(fixture, {}, async actions => {
            await actions.updateModernChatMetadata(fixture.entity, fixture.chatId, metadata => {
                metadata.note_prompt = 'after load';
            }, { groupMode: false });

            expect(fixture.requests.map(request => request.url)).toEqual(['/api/chats/get', '/api/chats/save']);
            const [header, ...messages] = saveRequests(fixture)[0].body.chat;
            expect(header.chat_metadata).toMatchObject({ integrity: 'int-1', note_prompt: 'after load' });
            expect(messages).toEqual(createMessages());
            expect(fixture.file.messages).toEqual(createMessages());
        });
    });

    test('writes group chat metadata through the group endpoints and reloads the group chat', async () => {
        const fixture = createFixture({ groupMode: true });
        const reloads = [];
        await withChatActions(fixture, { reloadChat: async payload => (reloads.push(payload), { ok: true }) }, async actions => {
            await actions.updateModernChatMetadata(fixture.entity, fixture.chatId, metadata => {
                metadata.note_prompt = 'group note';
            }, { groupMode: true });

            const [save] = saveRequests(fixture);
            expect(save.url).toBe('/api/chats/group/save');
            expect(save.body.id).toBe('chat-a');
            expect(save.body.chat[0].chat_metadata).toMatchObject({ integrity: 'int-1', note_prompt: 'group note' });
            expect(reloads).toEqual([{ groupId: 'group-1', chat: 'chat-a' }]);
            expect(fixture.state.chatMetadata[fixture.cacheKey].integrity).toBe('int-2');
        });
    });

    test('waits for an earlier message save of the same chat and builds on its revision and messages', async () => {
        const fixture = createFixture();
        let releaseFirstSave = () => {};
        fixture.saveGates.push(new Promise(resolve => {
            releaseFirstSave = resolve;
        }));
        await withChatActions(fixture, {}, async actions => {
            const messageEdit = actions.updateModernChat(fixture.entity, fixture.chatId, messages => {
                messages.push({ name: 'You', is_user: true, is_system: false, send_date: '2026-10-11T08:00:02.000Z', mes: 'edited in between', extra: {} });
            }, { groupMode: false });
            await expect.poll(() => saveRequests(fixture).length).toBe(1);
            const metadataUpdate = actions.updateModernChatMetadata(fixture.entity, fixture.chatId, metadata => {
                metadata.note_prompt = 'second';
            }, { groupMode: false });
            // Intentional wait: the metadata write must not start while the first save is in flight
            // eslint-disable-next-line playwright/no-wait-for-timeout
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(saveRequests(fixture)).toHaveLength(1);

            releaseFirstSave();
            await Promise.all([messageEdit, metadataUpdate]);

            const saves = saveRequests(fixture);
            expect(saves).toHaveLength(2);
            expect(saves[1].body.chat[0].chat_metadata.integrity).toBe('int-2');
            expect(saves[1].body.chat.at(-1).mes).toBe('edited in between');
            expect(fixture.file.metadata).toMatchObject({ integrity: 'int-3', note_prompt: 'second' });
        });
    });
});

function createGenerationActions(fixture, { bridgeRequests, waitForEngineSync } = {}) {
    return createChatGenerationActions({
        state: fixture.state,
        render: () => {},
        showToast: () => {},
        subscribeProgress: () => () => {},
        callLegacyBridge: async (action, payload) => {
            bridgeRequests.push({ action, payload });
            return { chat: payload.chat, saved: true, swipeId: 0, swipeCount: 1 };
        },
        formatNumber: String,
        getSelectedChatEntity: () => fixture.entity,
        getChatContextKey: () => fixture.contextKey,
        getChatEntityName: entity => entity.name,
        isGroupChatMode: () => fixture.groupMode,
        getSelectedChatMessages: () => fixture.state.chatMessages[fixture.cacheKey] || [],
        getCurrentDraftKey: () => fixture.cacheKey,
        getChatCacheKey: (contextKey, chatId) => `${contextKey}::${chatId}`,
        getUserName: () => 'You',
        loadChatMessages: async () => {},
        refreshSelectedChatList: async () => {},
        createModernChatFile: async () => fixture.chatId,
        runModernChatFileOperation: (_entity, _chatId, operation) => operation(),
        ...(waitForEngineSync ? { waitForEngineSync } : {}),
    });
}

test.describe('Modern generation payload integrity', () => {
    test('generate and swipe carry the integrity of the chat file the modern UI knows', async () => {
        const fixture = createFixture();
        const bridgeRequests = [];
        const actions = createGenerationActions(fixture, { bridgeRequests });

        // A finished generation drops the cached chat and the real loader reads it again; the stub loader does not
        const restoreChat = integrity => {
            fixture.state.chatMessages[fixture.cacheKey] = createMessages();
            fixture.state.chatMetadata[fixture.cacheKey] = { ...fixture.file.metadata, integrity };
        };

        await actions.continueModernReply();
        restoreChat('int-1');
        await actions.swipeModernMessage(0, 'right');

        expect(bridgeRequests.map(request => request.action)).toEqual(['generate', 'swipe']);
        expect(bridgeRequests[0].payload).toMatchObject({ avatar: 'alice.png', chat: 'chat-a', type: 'continue', integrity: 'int-1' });
        expect(bridgeRequests[1].payload).toMatchObject({ avatar: 'alice.png', chat: 'chat-a', messageIndex: 0, direction: 'right', integrity: 'int-1' });

        // After a metadata save the modern state holds the newly issued revision, and the next payload follows it
        restoreChat('int-2');
        await actions.continueModernReply();
        expect(bridgeRequests[2].payload.integrity).toBe('int-2');
    });

    test('leaves integrity out when the modern UI has not read the chat header', async () => {
        const fixture = createFixture({ loaded: false });
        fixture.state.chatMessages[fixture.cacheKey] = createMessages();
        const bridgeRequests = [];
        const actions = createGenerationActions(fixture, { bridgeRequests });

        await actions.continueModernReply();

        expect(bridgeRequests).toHaveLength(1);
        expect(bridgeRequests[0].payload.integrity).toBeUndefined();
    });
});
