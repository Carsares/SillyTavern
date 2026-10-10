/* global window, location, document */
import { test, expect } from '@playwright/test';

const bridgeSource = 'sillytavern-modern-bridge';

function stripJsonlExtension(value) {
    return String(value || '').replace(/\.jsonl$/i, '');
}

function fulfillJson(route, body, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function postJson(route) {
    try {
        return route.request().postDataJSON();
    } catch {
        return null;
    }
}

function multipartFieldValue(bodyText, fieldName) {
    const match = new RegExp(`name="${fieldName}"\\r?\\n\\r?\\n([^\\r\\n]*)`).exec(bodyText);
    return match?.[1]?.trim() || '';
}

// A downloaded card that was never chatted with: no `chat` field, so the legacy engine invents a
// "<name> - <timestamp>" default chat whose file does not exist yet.
function createBridgeCharacter({ name = 'Bridge Fixture', avatar = 'bridge-fixture.png' } = {}) {
    const data = {
        name,
        description: 'Bridge fixture description.',
        personality: '',
        scenario: '',
        first_mes: `Hello from ${name}.`,
        mes_example: '',
        creator_notes: '',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        tags: [],
        creator: 'Modern E2E',
        character_version: '',
        extensions: {
            talkativeness: '0.5',
            fav: false,
            world: '',
            depth_prompt: { prompt: '', depth: 4, role: 'system' },
        },
    };
    return {
        name: data.name,
        avatar,
        description: data.description,
        personality: '',
        scenario: '',
        first_mes: data.first_mes,
        mes_example: '',
        creatorcomment: '',
        tags: [],
        talkativeness: '0.5',
        fav: false,
        create_date: '2026-10-10T12:00:00.000Z',
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data,
    };
}

function chatHeader() {
    return { chat_metadata: {}, user_name: 'unused', character_name: 'unused' };
}


function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Points the engine at a stubbed, non-streaming chat-completion backend so `generate` runs end to end
// without a model: the managed server's settings are patched in flight, and every backend call is answered here.
async function routeStubbedChatCompletion(page, reply) {
    const generateRequests = [];
    await page.route('**/api/settings/get', async route => {
        const response = await route.fetch();
        const body = await response.json();
        const settings = JSON.parse(body.settings || '{}');
        settings.main_api = 'openai';
        settings.oai_settings = { ...(settings.oai_settings || {}), chat_completion_source: 'openai', stream_openai: false };
        return route.fulfill({ response, json: { ...body, settings: JSON.stringify(settings) } });
    });
    await page.route('**/api/backends/**', route => {
        const url = route.request().url();
        if (url.endsWith('/chat-completions/generate')) {
            generateRequests.push(postJson(route));
            return fulfillJson(route, { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: reply } }] });
        }
        if (url.endsWith('/chat-completions/status')) {
            return fulfillJson(route, { data: [{ id: 'gpt-4-turbo' }] });
        }
        return fulfillJson(route, {});
    });
    await page.route('**/api/horde/**', route => fulfillJson(route, { error: 'horde disabled in tests' }, 500));
    return generateRequests;
}

// Streams a chat-completion reply through a fetch the page controls: the chunks are delivered at once, then the
// stream stays open until the request is aborted, the way a slow model looks when the user presses stop.
async function routeOpenStreamingChatCompletion(page, chunks) {
    await page.route('**/api/settings/get', async route => {
        const response = await route.fetch();
        const body = await response.json();
        const settings = JSON.parse(body.settings || '{}');
        settings.main_api = 'openai';
        settings.oai_settings = { ...(settings.oai_settings || {}), chat_completion_source: 'deepseek', stream_openai: true, show_thoughts: true };
        return route.fulfill({ response, json: { ...body, settings: JSON.stringify(settings) } });
    });
    await page.route('**/api/backends/**', route => fulfillJson(route, {}));
    await page.addInitScript(streamChunks => {
        const originalFetch = window.fetch;
        window.fetch = function (input, init) {
            const url = typeof input === 'string' ? input : input?.url || '';
            if (!url.includes('/api/backends/chat-completions/generate')) {
                return originalFetch.apply(this, arguments);
            }
            const signal = init?.signal;
            const encoder = new TextEncoder();
            const body = new ReadableStream({
                start(controller) {
                    for (const delta of streamChunks) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`));
                    }
                    window.bridgeStreamOpened = true;
                    signal?.addEventListener('abort', () => controller.error(new DOMException('The user aborted a request.', 'AbortError')));
                },
            });
            return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
        };
    }, chunks);
}

// Counts streamed tokens the engine has processed, so a test can stop a reply at a known point.
function countStreamTokens(page) {
    return page.evaluate(() => {
        const context = window.SillyTavern.getContext();
        window.bridgeStreamTokens = 0;
        context.eventSource.on(context.eventTypes.STREAM_TOKEN_RECEIVED, () => {
            window.bridgeStreamTokens++;
        });
    });
}

// Starts a bridge call without waiting for its reply; awaitBridgeReply() collects it later.
function startBridgeCall(page, action, payload, id) {
    return page.evaluate(({ source, bridgeAction, bridgePayload, requestId }) => {
        window.bridgeReplies = window.bridgeReplies || {};
        window.bridgeReplies[requestId] = new Promise(resolve => {
            window.addEventListener('message', function onMessage(event) {
                if (event.data && event.data.source === source && event.data.id === requestId && !('action' in event.data)) {
                    window.removeEventListener('message', onMessage);
                    resolve({ error: event.data.error, result: event.data.result });
                }
            });
        });
        window.postMessage({ source, id: requestId, action: bridgeAction, payload: bridgePayload }, location.origin);
    }, { source: bridgeSource, bridgeAction: action, bridgePayload: payload, requestId: id });
}

function awaitBridgeReply(page, id) {
    return page.evaluate(requestId => window.bridgeReplies[requestId], id);
}

function callBridge(page, action, payload, id) {
    return page.evaluate(({ source, bridgeAction, bridgePayload, requestId }) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`bridge ${bridgeAction} timeout`)), 60000);
        window.addEventListener('message', function onMessage(event) {
            if (event.data && event.data.source === source && event.data.id === requestId && !('action' in event.data)) {
                window.removeEventListener('message', onMessage);
                clearTimeout(timer);
                resolve({ error: event.data.error, result: event.data.result });
            }
        });
        window.postMessage({ source, id: requestId, action: bridgeAction, payload: bridgePayload }, location.origin);
    }), { source: bridgeSource, bridgeAction: action, bridgePayload: payload, requestId: id });
}

// One character with a chat that holds its greeting (plus an optional reply), as the modern UI leaves it before a send.
async function routeStopFixture(page, { reply = null } = {}) {
    const character = createBridgeCharacter();
    const chatId = 'Modern 2026-10-10T15-00-00-000Z';
    const greeting = { name: character.name, is_user: false, is_system: false, send_date: '2026-10-10T15:00:00.000Z', mes: character.first_mes, extra: {} };
    const chatSaves = [];
    let savedCardChat = '';
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.route('**/api/characters/all', route => fulfillJson(route, [character]));
    await page.route('**/api/characters/get', route => fulfillJson(route, savedCardChat ? { ...character, chat: savedCardChat } : character));
    await page.route('**/api/characters/edit', route => {
        savedCardChat = multipartFieldValue(route.request().postData() || '', 'chat');
        return route.fulfill({ status: 200, contentType: 'text/plain', body: 'OK' });
    });
    await page.route('**/api/groups/all', route => fulfillJson(route, []));
    await page.route('**/api/chats/get', route => {
        const fileName = stripJsonlExtension(postJson(route)?.file_name);
        return fulfillJson(route, fileName === chatId ? [chatHeader(), greeting, ...(reply ? [reply] : [])] : []);
    });
    await page.route('**/api/chats/save', route => {
        const payload = postJson(route);
        if (payload && stripJsonlExtension(payload.file_name) === chatId) {
            chatSaves.push(payload.chat);
        }
        return fulfillJson(route, { ok: true });
    });
    return { character, chatId, chatSaves, errors };
}

// The modern UI reuses the legacy generation engine through a hidden /index.html?modernBridge=1 iframe.
// This smoke protects that headless entrypoint: the legacy app must boot cleanly in bridge mode and
// answer a bridge RPC, so future headless hardening can't silently break the modern generation path.
test.describe('Modern legacy bridge headless entry', () => {
    test('waits for the first iframe load before sending concurrent bridge calls', async ({ page }) => {
        await page.goto('/modern/');

        await page.evaluate(async () => {
            const { createLegacyBridge } = await import('./core/legacy-bridge.js');
            const originalCreateElement = document.createElement;
            const originalAppend = document.body.append;
            const listeners = {};
            const testState = { sent: [], triggerLoad: () => listeners.load(), done: null };
            window.bridgeConcurrencyTest = testState;
            const frame = {
                hidden: false,
                title: '',
                src: '',
                style: {},
                contentWindow: {
                    postMessage: message => {
                        testState.sent.push(message.action);
                        window.dispatchEvent(new MessageEvent('message', {
                            origin: window.location.origin,
                            data: { source: message.source, id: message.id, result: message.action },
                        }));
                    },
                },
                addEventListener: (type, listener) => {
                    listeners[type] = listener;
                },
                remove: () => {},
            };
            document.createElement = tagName => tagName === 'iframe' ? frame : originalCreateElement.call(document, tagName);
            document.body.append = () => {};

            const bridge = createLegacyBridge({ loadTimeoutMs: 5000, defaultTimeoutMs: 5000 });
            const calls = [
                bridge.callLegacyBridge('first'),
                bridge.callLegacyBridge('second'),
            ];
            document.createElement = originalCreateElement;
            document.body.append = originalAppend;
            testState.done = Promise.all(calls).finally(() => bridge.disposeLegacyBridge());
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(await page.evaluate(() => window.bridgeConcurrencyTest.sent)).toEqual([]);
        await page.evaluate(() => window.bridgeConcurrencyTest.triggerLoad());
        expect(await page.evaluate(() => window.bridgeConcurrencyTest.done)).toEqual(['first', 'second']);
        expect(await page.evaluate(() => window.bridgeConcurrencyTest.sent)).toEqual(['first', 'second']);
    });

    test('boots the legacy engine headlessly and answers a bridge status call', async ({ page }) => {
        test.setTimeout(90_000);

        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });

        const status = await page.evaluate(() => new Promise((resolve, reject) => {
            const source = 'sillytavern-modern-bridge';
            const id = 'headless-smoke';
            const timer = setTimeout(() => reject(new Error('bridge status timeout')), 60000);
            window.addEventListener('message', function onMessage(event) {
                // The reply carries result/error and (unlike the request) has no action field
                if (event.data && event.data.source === source && event.data.id === id && !('action' in event.data)) {
                    window.removeEventListener('message', onMessage);
                    clearTimeout(timer);
                    resolve({ error: event.data.error, result: event.data.result });
                }
            });
            window.postMessage({ source, id, action: 'status', payload: {} }, location.origin);
        }));

        expect(status.error).toBeFalsy();
        expect(status.result).toBeTruthy();
        expect(errors).toEqual([]);
    });

    // The hidden iframe holds a boot-time settings snapshot, so any settings write-back would revert
    // what the modern UI just saved. saveSettings is short-circuited in bridge mode; assert that even an
    // explicit debounced save never reaches /api/settings/save.
    test('never writes settings back from the bridge iframe', async ({ page }) => {
        test.setTimeout(90_000);

        let settingsSaveCount = 0;
        await page.route('**/api/settings/save', route => {
            settingsSaveCount++;
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });

        // Force an immediate settings save through the exposed context; the bridge guard must swallow it.
        await page.evaluate(async () => {
            const save = window.SillyTavern?.getContext?.().saveSettingsDebounced;
            if (typeof save === 'function') {
                save();
                if (typeof save.flush === 'function') {
                    save.flush();
                }
            }
        });
        // Intentional wait: we assert the ABSENCE of a settings POST, so allow the debounce window to elapse.
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(2500);

        expect(settingsSaveCount).toBe(0);
    });

    // The sync channel lets the modern UI push reloads into the iframe. reloadSettings re-applies the
    // generation config subset and reloadCharacter reloads the character list; both must complete without
    // error in the real engine (reloadChat needs a selected chat context and is exercised elsewhere).
    test('answers reload sync actions without error', async ({ page }) => {
        test.setTimeout(90_000);

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });

        const roundTrip = action => page.evaluate(bridgeAction => new Promise((resolve, reject) => {
            const source = 'sillytavern-modern-bridge';
            const id = `reload-smoke-${bridgeAction}`;
            const timer = setTimeout(() => reject(new Error(`bridge ${bridgeAction} timeout`)), 60000);
            window.addEventListener('message', function onMessage(event) {
                if (event.data && event.data.source === source && event.data.id === id && !('action' in event.data)) {
                    window.removeEventListener('message', onMessage);
                    clearTimeout(timer);
                    resolve({ error: event.data.error, result: event.data.result });
                }
            });
            window.postMessage({ source, id, action: bridgeAction, payload: {} }, location.origin);
        }), action);

        const settingsReload = await roundTrip('reloadSettings');
        expect(settingsReload.error).toBeFalsy();
        expect(settingsReload.result).toMatchObject({ ok: true });

        const characterReload = await roundTrip('reloadCharacter');
        expect(characterReload.error).toBeFalsy();
        expect(characterReload.result).toMatchObject({ ok: true });
    });

    // UX-001: the first modern send for a character without chats creates "Modern <ts>" and asks the engine to
    // generate there. Switching the engine to the character used to open the card's default chat first; that file
    // did not exist, so the engine saved a second, greeting-only chat next to the modern one.
    test('switches a chat-less character straight to the modern chat without saving a default chat', async ({ page }) => {
        test.setTimeout(90_000);

        const character = createBridgeCharacter();
        const modernChatId = 'Modern 2026-10-10T12-04-43-020Z';
        const greeting = { name: character.name, is_user: false, is_system: false, send_date: '2026-10-10T12:04:43.020Z', mes: character.first_mes, extra: {} };
        const chatSaves = [];
        let savedCardChat = '';
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        await page.route('**/api/characters/all', route => fulfillJson(route, [character]));
        await page.route('**/api/characters/get', route => fulfillJson(route, savedCardChat ? { ...character, chat: savedCardChat } : character));
        await page.route('**/api/characters/edit', route => {
            savedCardChat = multipartFieldValue(route.request().postData() || '', 'chat');
            return route.fulfill({ status: 200, contentType: 'text/plain', body: 'OK' });
        });
        await page.route('**/api/groups/all', route => fulfillJson(route, []));
        await page.route('**/api/chats/get', route => {
            // Only the modern-created chat exists; every other chat name is a missing file
            const fileName = stripJsonlExtension(postJson(route)?.file_name);
            return fulfillJson(route, fileName === modernChatId ? [chatHeader(), greeting] : []);
        });
        await page.route('**/api/chats/save', route => {
            const payload = postJson(route);
            chatSaves.push(payload ? stripJsonlExtension(payload.file_name) : '<unparsed>');
            return fulfillJson(route, { ok: true });
        });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });

        // generate/swipe/status share this context switch; status exercises it without calling a model
        const status = await callBridge(page, 'status', { avatar: character.avatar, groupId: null, chat: modernChatId }, 'first-send-context');

        expect(status.error).toBeFalsy();
        expect(status.result).toMatchObject({ avatar: character.avatar, chat: modernChatId, messageCount: 1 });
        expect(chatSaves.filter(chatId => chatId !== modernChatId)).toEqual([]);
        // Same persistence as switching through openCharacterChat: the card now points at the modern chat
        expect(savedCardChat).toBe(modernChatId);
        expect(errors).toEqual([]);
    });

    test('switches group chats on fresh metadata without saving the missing default group chat', async ({ page }) => {
        test.setTimeout(90_000);

        const character = createBridgeCharacter();
        const groupId = 'bridge-group';
        const firstChatId = 'Modern 2026-10-10T12-10-00-000Z';
        const newChatId = 'Modern 2026-10-10T12-20-00-000Z';
        // The group's default chat (named after the group id) was never written to disk
        const group = {
            id: groupId,
            name: 'Bridge Group',
            avatar_url: '',
            members: [character.avatar],
            disabled_members: [],
            chats: [groupId, firstChatId],
            chat_id: groupId,
            allow_self_responses: false,
            activation_strategy: 0,
            generation_mode: 0,
            fav: false,
        };
        const groupChats = {
            [firstChatId]: [
                chatHeader(),
                { name: 'Modern User', is_user: true, is_system: false, send_date: '2026-10-10T12:10:01.000Z', mes: 'group hello', extra: {} },
                { name: character.name, is_user: false, is_system: false, send_date: '2026-10-10T12:10:02.000Z', mes: 'group reply', extra: {} },
            ],
        };
        const groupChatSaves = [];
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        await page.route('**/api/characters/all', route => fulfillJson(route, [character]));
        await page.route('**/api/characters/get', route => fulfillJson(route, character));
        await page.route('**/api/groups/all', route => fulfillJson(route, [group]));
        await page.route('**/api/groups/edit', route => {
            const payload = postJson(route);
            if (payload?.id === groupId) {
                Object.assign(group, payload);
            }
            return fulfillJson(route, { ok: true });
        });
        await page.route('**/api/chats/group/get', route => fulfillJson(route, groupChats[stripJsonlExtension(postJson(route)?.id)] || []));
        await page.route('**/api/chats/group/save', route => {
            const payload = postJson(route);
            groupChatSaves.push(payload ? stripJsonlExtension(payload.id) : '<unparsed>');
            return fulfillJson(route, { ok: true });
        });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });

        // Known chat while group.chat_id points at a missing file: the switch must load the requested chat directly
        const first = await callBridge(page, 'status', { avatar: null, groupId, chat: firstChatId }, 'group-known-chat');
        expect(first.error).toBeFalsy();
        expect(first.result).toMatchObject({ groupId, chat: firstChatId, messageCount: 2 });
        expect(groupChatSaves.filter(chatId => chatId !== firstChatId)).toEqual([]);

        // Modern creates a new group chat after the frame booted (as createModernChatFile does), leaving the frame's metadata stale
        groupChats[newChatId] = [chatHeader()];
        group.chats = [...group.chats, newChatId];
        group.chat_id = newChatId;

        const second = await callBridge(page, 'status', { avatar: null, groupId, chat: newChatId }, 'group-new-chat');
        expect(second.error).toBeFalsy();
        // messageCount 0 proves the frame reopened the new, empty chat instead of keeping the previous chat in memory
        expect(second.result).toMatchObject({ groupId, chat: newChatId, messageCount: 0 });
        expect(groupChatSaves.filter(chatId => chatId !== firstChatId && chatId !== newChatId)).toEqual([]);
        expect(errors).toEqual([]);
    });

    // A cold iframe reports settingsReady before its first character list arrives (groups load at the end of that
    // list). A bridge action in that window used to open the group against an empty character list, and
    // validateGroup() removed every member and saved the group.
    test('generates in a group chat on a cold iframe without pruning members while characters load slowly', async ({ page }) => {
        test.setTimeout(120_000);

        const memberA = createBridgeCharacter({ name: 'Cold Member A', avatar: 'cold-member-a.png' });
        const memberB = createBridgeCharacter({ name: 'Cold Member B', avatar: 'cold-member-b.png' });
        const groupId = 'cold-group';
        const chatId = 'Modern 2026-10-10T14-25-46-105Z';
        const userMessage = 'first message to a cold group';
        const reply = 'cold group reply';
        // As createModernChatFile leaves it right before the first send: an empty chat already published in the metadata
        const group = {
            id: groupId,
            name: 'Cold Group',
            avatar_url: '',
            members: [memberA.avatar, memberB.avatar],
            disabled_members: [],
            chats: [groupId, chatId],
            chat_id: chatId,
            allow_self_responses: false,
            activation_strategy: 0,
            generation_mode: 0,
            fav: false,
        };
        const groupChats = { [chatId]: [chatHeader()] };
        const groupEdits = [];
        const groupChatSaves = [];
        let characterListRequests = 0;
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        const modelRequests = await routeStubbedChatCompletion(page, reply);
        await page.route('**/api/characters/all', async route => {
            characterListRequests++;
            // Groups answer at once while the character list is slow, as on a cold start with many cards
            await delay(3000);
            return fulfillJson(route, [memberA, memberB]);
        });
        await page.route('**/api/characters/get', route => {
            const avatar = postJson(route)?.avatar_url;
            return fulfillJson(route, [memberA, memberB].find(character => character.avatar === avatar) || {});
        });
        await page.route('**/api/groups/all', route => fulfillJson(route, [group]));
        await page.route('**/api/groups/edit', route => {
            const payload = postJson(route);
            groupEdits.push(payload);
            if (payload?.id === groupId) {
                Object.assign(group, payload);
            }
            return fulfillJson(route, { ok: true });
        });
        await page.route('**/api/chats/group/get', route => fulfillJson(route, groupChats[stripJsonlExtension(postJson(route)?.id)] || []));
        await page.route('**/api/chats/group/save', route => {
            const payload = postJson(route);
            const savedChatId = payload ? stripJsonlExtension(payload.id) : '<unparsed>';
            groupChatSaves.push(savedChatId);
            if (payload) {
                groupChats[savedChatId] = payload.chat;
            }
            return fulfillJson(route, { ok: true });
        });

        // Like the modern UI, send the action as soon as the lazily created frame fires `load`
        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        const result = await callBridge(page, 'generate', { avatar: null, groupId, chat: chatId, type: 'normal', message: userMessage }, 'cold-group-generate');

        expect(result.error).toBeFalsy();
        expect(result.result).toMatchObject({ groupId, chat: chatId, saved: true });
        expect(group.members).toEqual([memberA.avatar, memberB.avatar]);
        expect(groupEdits.filter(edit => edit?.id === groupId && !(edit.members?.includes(memberA.avatar) && edit.members?.includes(memberB.avatar)))).toEqual([]);
        expect(characterListRequests).toBe(1);
        expect(modelRequests.length).toBeGreaterThan(0);
        const savedMessages = groupChats[chatId].filter(message => !message.chat_metadata);
        expect(savedMessages.filter(message => message.is_user).map(message => message.mes)).toEqual([userMessage]);
        expect(savedMessages.some(message => !message.is_user && message.mes === reply)).toBe(true);
        expect(groupChatSaves.filter(savedChatId => savedChatId !== chatId)).toEqual([]);
        expect(errors).toEqual([]);
    });

    // A member the frame still cannot find after reloading the character list must stop the action: letting
    // validateGroup() run would remove the member and save the group from the bridge path.
    test('refuses to open a group whose member is missing instead of removing it', async ({ page }) => {
        test.setTimeout(90_000);

        const member = createBridgeCharacter({ name: 'Present Member', avatar: 'present-member.png' });
        const missingAvatar = 'missing-member.png';
        const groupId = 'partial-group';
        const chatId = 'Modern 2026-10-10T14-40-00-000Z';
        const group = {
            id: groupId,
            name: 'Partial Group',
            avatar_url: '',
            members: [member.avatar, missingAvatar],
            disabled_members: [],
            chats: [chatId],
            chat_id: chatId,
            allow_self_responses: false,
            activation_strategy: 0,
            generation_mode: 0,
            fav: false,
        };
        const groupEdits = [];
        const groupChatSaves = [];
        let characterListRequests = 0;

        await page.route('**/api/characters/all', route => {
            characterListRequests++;
            return fulfillJson(route, [member]);
        });
        await page.route('**/api/characters/get', route => fulfillJson(route, member));
        await page.route('**/api/groups/all', route => fulfillJson(route, [group]));
        await page.route('**/api/groups/edit', route => {
            groupEdits.push(postJson(route));
            return fulfillJson(route, { ok: true });
        });
        await page.route('**/api/chats/group/get', route => fulfillJson(route, [chatHeader()]));
        await page.route('**/api/chats/group/save', route => {
            groupChatSaves.push(postJson(route)?.id);
            return fulfillJson(route, { ok: true });
        });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        const status = await callBridge(page, 'status', { avatar: null, groupId, chat: chatId }, 'partial-group-status');

        expect(status.error?.message).toContain(`找不到群聊成员：${missingAvatar}`);
        // Initial load plus one refresh before giving up
        expect(characterListRequests).toBe(2);
        expect(groupEdits).toEqual([]);
        expect(groupChatSaves).toEqual([]);
    });

    // The bridge used to start its own character load when the cold frame's first list had not arrived yet. Two
    // overlapping loads could leave the list briefly empty for the lookup ("找不到当前选择的角色").
    test('waits for the initial character list on a cold iframe instead of loading it a second time', async ({ page }) => {
        test.setTimeout(90_000);

        const character = createBridgeCharacter();
        const chatId = 'Modern 2026-10-10T14-30-00-000Z';
        const greeting = { name: character.name, is_user: false, is_system: false, send_date: '2026-10-10T14:30:00.000Z', mes: character.first_mes, extra: {} };
        const chatSaves = [];
        let characterListRequests = 0;
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        await page.route('**/api/characters/all', async route => {
            characterListRequests++;
            await delay(3000);
            return fulfillJson(route, [character]);
        });
        let savedCardChat = '';
        await page.route('**/api/characters/get', route => fulfillJson(route, savedCardChat ? { ...character, chat: savedCardChat } : character));
        await page.route('**/api/characters/edit', route => {
            savedCardChat = multipartFieldValue(route.request().postData() || '', 'chat');
            return route.fulfill({ status: 200, contentType: 'text/plain', body: 'OK' });
        });
        await page.route('**/api/groups/all', route => fulfillJson(route, []));
        await page.route('**/api/chats/get', route => {
            const fileName = stripJsonlExtension(postJson(route)?.file_name);
            return fulfillJson(route, fileName === chatId ? [chatHeader(), greeting] : []);
        });
        await page.route('**/api/chats/save', route => {
            const payload = postJson(route);
            chatSaves.push(payload ? stripJsonlExtension(payload.file_name) : '<unparsed>');
            return fulfillJson(route, { ok: true });
        });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        const status = await callBridge(page, 'status', { avatar: character.avatar, groupId: null, chat: chatId }, 'cold-character-status');

        expect(status.error).toBeFalsy();
        expect(status.result).toMatchObject({ avatar: character.avatar, chat: chatId, messageCount: 1 });
        expect(characterListRequests).toBe(1);
        expect(chatSaves.filter(savedChatId => savedChatId !== chatId)).toEqual([]);
        expect(errors).toEqual([]);
    });
    // UX-009: stopping a reply that has only reasoning so far used to save an assistant message with an empty `mes` and
    // reported a finished generation. The stopped reply is dropped, the user message stays, and the result says it stopped.
    test('drops a stopped reply that has no visible text yet and reports the stop', async ({ page }) => {
        test.setTimeout(120_000);

        const { character, chatId, chatSaves, errors } = await routeStopFixture(page);
        await routeOpenStreamingChatCompletion(page, [{ reasoning_content: 'Thinking about the answer.' }]);

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        await countStreamTokens(page);
        await startBridgeCall(page, 'generate', { avatar: character.avatar, groupId: null, chat: chatId, type: 'normal', message: 'stop before any text' }, 'stop-empty-generate');
        await page.waitForFunction(() => window.bridgeStreamOpened === true && window.bridgeStreamTokens >= 1);
        const stop = await callBridge(page, 'stop', {}, 'stop-empty-stop');
        const generate = await awaitBridgeReply(page, 'stop-empty-generate');

        expect(stop.error).toBeFalsy();
        expect(generate.error).toBeFalsy();
        expect(generate.result).toMatchObject({ chat: chatId, saved: true, stopped: true, started: true, keptReplyChars: 0, removedEmptyReply: true });
        const savedMessages = chatSaves.at(-1).filter(message => !message.chat_metadata);
        expect(savedMessages.map(message => [message.is_user, message.mes])).toEqual([
            [false, character.first_mes],
            [true, 'stop before any text'],
        ]);
        expect(errors).toEqual([]);
    });

    test('keeps the partial text of a stopped reply', async ({ page }) => {
        test.setTimeout(120_000);

        const { character, chatId, chatSaves, errors } = await routeStopFixture(page);
        await routeOpenStreamingChatCompletion(page, [{ reasoning_content: 'Planning.' }, { content: 'Partial answer' }]);

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        await countStreamTokens(page);
        await startBridgeCall(page, 'generate', { avatar: character.avatar, groupId: null, chat: chatId, type: 'normal', message: 'stop after some text' }, 'stop-partial-generate');
        await page.waitForFunction(() => window.bridgeStreamOpened === true && window.bridgeStreamTokens >= 2);
        await callBridge(page, 'stop', {}, 'stop-partial-stop');
        const generate = await awaitBridgeReply(page, 'stop-partial-generate');

        expect(generate.error).toBeFalsy();
        expect(generate.result).toMatchObject({ saved: true, stopped: true, keptReplyChars: 'Partial answer'.length, removedEmptyReply: false });
        const savedMessages = chatSaves.at(-1).filter(message => !message.chat_metadata);
        expect(savedMessages.at(-1)).toMatchObject({ is_user: false, mes: 'Partial answer' });
        expect(savedMessages.at(-2)).toMatchObject({ is_user: true, mes: 'stop after some text' });
        expect(errors).toEqual([]);
    });

    // Swiping past the last candidate generates a new one; stopping it before any visible text drops that empty candidate
    test('drops an empty candidate when a swipe generation is stopped', async ({ page }) => {
        test.setTimeout(120_000);

        const { character, chatId, chatSaves, errors } = await routeStopFixture(page, {
            reply: { name: 'Bridge Fixture', is_user: false, is_system: false, send_date: '2026-10-10T15:00:01.000Z', mes: 'first candidate', swipe_id: 0, swipes: ['first candidate'], swipe_info: [{}], extra: {} },
        });
        await routeOpenStreamingChatCompletion(page, [{ reasoning_content: 'Reconsidering.' }]);

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        await countStreamTokens(page);
        await startBridgeCall(page, 'swipe', { avatar: character.avatar, groupId: null, chat: chatId, messageIndex: 1, direction: 'right' }, 'stop-swipe');
        await page.waitForFunction(() => window.bridgeStreamOpened === true && window.bridgeStreamTokens >= 1);
        await callBridge(page, 'stop', {}, 'stop-swipe-stop');
        const swipe = await awaitBridgeReply(page, 'stop-swipe');

        expect(swipe.error).toBeFalsy();
        expect(swipe.result).toMatchObject({ saved: true, stopped: true, removedEmptyReply: true, swipeId: 0, swipeCount: 1 });
        expect(chatSaves.at(-1).filter(message => !message.chat_metadata).at(-1)).toMatchObject({ mes: 'first candidate', swipes: ['first candidate'] });
        expect(errors).toEqual([]);
    });

    // UX-021: the bridge page is served at /index.html?modernBridge=1 under <base href="/">, so jQuery UI took the background
    // tabs for remote tabs and loaded the page into a panel. Its scripts ran twice, the second jQuery broke `instanceof
    // jQuery`, and every swipe that ended on the same candidate threw "S.easing[this.easing] is not a function" per frame.
    test('swipes without reloading its own scripts, animation errors, or missing icons', async ({ page }) => {
        test.setTimeout(120_000);

        const { character, chatId, chatSaves, errors } = await routeStopFixture(page, {
            reply: { name: 'Bridge Fixture', is_user: false, is_system: false, send_date: '2026-10-10T12:00:01.000Z', mes: 'only candidate', swipe_id: 0, swipes: ['only candidate'], swipe_info: [{}], extra: { api: 'modern' } },
        });
        const warnings = [];
        const missingAssets = [];
        page.on('console', message => {
            if (message.type() === 'warning' && /animation|easing/i.test(message.text())) {
                warnings.push(message.text());
            }
        });
        page.on('response', response => {
            if (response.status() === 404 && new URL(response.url()).pathname.startsWith('/img/')) {
                missingAssets.push(new URL(response.url()).pathname);
            }
        });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        // Left from the only candidate stays on it: the engine shakes the message and flashes the counter
        const swipe = await callBridge(page, 'swipe', { avatar: character.avatar, groupId: null, chat: chatId, messageIndex: 1, direction: 'left' }, 'same-candidate-swipe');
        // Intentional wait: the broken animation threw on every frame after the swipe returned
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(1000);

        expect(swipe.error).toBeFalsy();
        expect(swipe.result).toMatchObject({ chat: chatId, swipeId: 0, swipeCount: 1, saved: true });
        expect(await page.evaluate(() => document.querySelectorAll('script[src*="jquery-3.5.1"]').length)).toBe(1);
        expect(await page.evaluate(() => document.querySelectorAll('#bg_tabs > [role="tabpanel"]:not(#bg_global_tab):not(#bg_chat_tab)').length)).toBe(0);
        expect(chatSaves.length).toBeGreaterThan(0);
        expect(errors).toEqual([]);
        expect(warnings).toEqual([]);
        expect(missingAssets).toEqual([]);
    });
});
