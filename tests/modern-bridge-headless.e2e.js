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
async function routeStubbedChatCompletion(page, reply, { patchSettings = null } = {}) {
    const generateRequests = [];
    await page.route('**/api/settings/get', async route => {
        const response = await route.fetch();
        const body = await response.json();
        const settings = JSON.parse(body.settings || '{}');
        settings.main_api = 'openai';
        settings.oai_settings = { ...(settings.oai_settings || {}), chat_completion_source: 'openai', stream_openai: false };
        patchSettings?.(settings);
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
async function routeOpenStreamingChatCompletion(page, chunks, { patchSettings = null } = {}) {
    await page.route('**/api/settings/get', async route => {
        const response = await route.fetch();
        const body = await response.json();
        const settings = JSON.parse(body.settings || '{}');
        settings.main_api = 'openai';
        settings.oai_settings = { ...(settings.oai_settings || {}), chat_completion_source: 'deepseek', stream_openai: true, show_thoughts: true };
        patchSettings?.(settings);
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
                    window.bridgeReplyTimes = window.bridgeReplyTimes || {};
                    window.bridgeReplyTimes[requestId] = performance.now();
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

// Whether the reply of a call started with startBridgeCall has arrived yet, without waiting for it.
function hasBridgeReply(page, id) {
    return page.evaluate(requestId => Object.hasOwn(window.bridgeReplyTimes || {}, requestId), id);
}

function getBridgeReplyTime(page, id) {
    return page.evaluate(requestId => window.bridgeReplyTimes[requestId], id);
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


// Rewrites the settings bundle the managed server answers with, once per request, so a test can change what the
// engine reads between two reloads. `patch(settings, body)` mutates the parsed settings and the bundle around them.
async function routePatchedSettings(page, patch) {
    const fetches = { count: 0 };
    await page.route('**/api/settings/get', async route => {
        fetches.count++;
        const response = await route.fetch();
        const body = await response.json();
        const settings = JSON.parse(body.settings || '{}');
        patch(settings, body);
        body.settings = JSON.stringify(settings);
        return route.fulfill({ response, json: body });
    });
    return fetches;
}

// One character whose single chat file behaves like the server for integrity: every save is checked against the
// revision the file holds and issues a new one, and a save that carries an older revision is rejected.
async function routeIntegrityFixture(page) {
    const character = createBridgeCharacter();
    const chatId = 'Modern 2026-10-11T09-00-00-000Z';
    const greeting = { name: character.name, is_user: false, is_system: false, send_date: '2026-10-11T09:00:00.000Z', mes: character.first_mes, extra: {} };
    const reply = { name: character.name, is_user: false, is_system: false, send_date: '2026-10-11T09:00:01.000Z', mes: 'only candidate', swipe_id: 0, swipes: ['only candidate'], swipe_info: [{}], extra: {} };
    const file = { integrity: 'int-1' };
    const chatLoads = [];
    const chatSaves = [];
    let savedCardChat = '';

    await page.route('**/api/characters/all', route => fulfillJson(route, [character]));
    await page.route('**/api/characters/get', route => fulfillJson(route, savedCardChat ? { ...character, chat: savedCardChat } : character));
    await page.route('**/api/characters/edit', route => {
        savedCardChat = multipartFieldValue(route.request().postData() || '', 'chat');
        return route.fulfill({ status: 200, contentType: 'text/plain', body: 'OK' });
    });
    await page.route('**/api/groups/all', route => fulfillJson(route, []));
    await page.route('**/api/chats/get', route => {
        const fileName = stripJsonlExtension(postJson(route)?.file_name);
        if (fileName !== chatId) {
            return fulfillJson(route, []);
        }
        chatLoads.push(file.integrity);
        return fulfillJson(route, [{ chat_metadata: { integrity: file.integrity }, user_name: 'unused', character_name: 'unused' }, greeting, reply]);
    });
    await page.route('**/api/chats/save', route => {
        const payload = postJson(route);
        if (!payload || stripJsonlExtension(payload.file_name) !== chatId) {
            return fulfillJson(route, { ok: true });
        }
        const sentIntegrity = payload.chat[0]?.chat_metadata?.integrity;
        if (sentIntegrity !== file.integrity) {
            chatSaves.push({ sentIntegrity, rejected: true });
            return fulfillJson(route, { error: 'integrity' }, 400);
        }
        file.integrity = `int-saved-${chatSaves.length + 1}`;
        chatSaves.push({ sentIntegrity, rejected: false, issued: file.integrity });
        return fulfillJson(route, { ok: true, integrity: file.integrity });
    });
    return { character, chatId, file, chatLoads, chatSaves };
}

test.describe('Modern bridge engine sync', () => {
    // The engine caches every world it loads, so a world book the modern UI edited stayed stale until a page reload.
    test('reloadWorldInfo drops only the named worlds from the engine cache', async ({ page }) => {
        test.setTimeout(90_000);

        const worldLoads = {};
        let worldNames = ['book-a', 'book-b'];
        const settingsFetches = await routePatchedSettings(page, (settings, body) => {
            body.world_names = worldNames;
        });
        await page.route('**/api/worldinfo/get', route => {
            const name = postJson(route)?.name;
            worldLoads[name] = (worldLoads[name] || 0) + 1;
            return fulfillJson(route, { entries: {}, extensions: {}, marker: worldLoads[name] });
        });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        // A reload only answers once the engine has finished booting, so it doubles as a ready barrier
        expect((await callBridge(page, 'reloadCharacter', {}, 'world-boot')).error).toBeFalsy();

        const loadWorld = name => page.evaluate(world => window.SillyTavern.getContext().loadWorldInfo(world), name);
        expect((await loadWorld('book-a')).marker).toBe(1);
        expect((await loadWorld('book-a')).marker).toBe(1);
        expect((await loadWorld('book-b')).marker).toBe(1);
        const fetchesBefore = settingsFetches.count;

        // Named worlds only, without refreshing the name list: a content edit changes no file name
        const named = await callBridge(page, 'reloadWorldInfo', { names: ['book-a', 'book-a'], refreshList: false }, 'world-named');
        expect(named.error).toBeFalsy();
        expect(named.result).toEqual({ ok: true, all: false, names: ['book-a'], refreshedList: false });
        expect(settingsFetches.count).toBe(fetchesBefore);
        expect((await loadWorld('book-a')).marker).toBe(2);
        expect((await loadWorld('book-b')).marker).toBe(1);

        // No names: every cached world goes, and the list of world names is read again
        worldNames = ['book-a', 'book-b', 'book-c'];
        const everything = await callBridge(page, 'reloadWorldInfo', {}, 'world-all');
        expect(everything.error).toBeFalsy();
        expect(everything.result).toEqual({ ok: true, all: true, names: [], refreshedList: true });
        expect(settingsFetches.count).toBe(fetchesBefore + 1);
        expect(await page.evaluate(() => window.SillyTavern.getContext().getWorldInfoNames())).toEqual(worldNames);
        expect((await loadWorld('book-a')).marker).toBe(3);
        expect((await loadWorld('book-b')).marker).toBe(2);
    });

    test('answers a malformed reloadWorldInfo payload with a bridge error and keeps serving', async ({ page }) => {
        test.setTimeout(90_000);

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        expect((await callBridge(page, 'reloadCharacter', {}, 'world-error-boot')).error).toBeFalsy();

        const malformedPayloads = [{ names: 'book-a' }, { names: ['book-a', 3] }, { names: [''] }, { names: { 0: 'book-a' } }];
        for (const [index, payload] of malformedPayloads.entries()) {
            const rejected = await callBridge(page, 'reloadWorldInfo', payload, `world-error-${index}`);
            expect(rejected.result).toBeNull();
            expect(rejected.error?.message).toContain('names');
        }

        const accepted = await callBridge(page, 'reloadWorldInfo', { names: ['book-a'], refreshList: false }, 'world-error-valid');
        expect(accepted.error).toBeFalsy();
        expect(accepted.result).toMatchObject({ ok: true, names: ['book-a'] });
    });

    // reloadSettings used to leave extension_settings alone, so memory, translate, connection profiles and the author's
    // note defaults the modern UI saved only reached the engine after a page reload.
    test('reloadSettings copies the whitelisted extension settings and leaves the rest alone', async ({ page }) => {
        test.setTimeout(90_000);

        const saved = {
            memory: { depth: 7, position: 1, role: 2, template: '<<{{summary}}>>' },
            translate: { provider: 'bing', target_language: 'ja' },
            connectionManager: { selectedProfile: 'profile-1', profiles: [{ id: 'profile-1', name: 'Fast' }] },
            note: { default: 'global note', defaultDepth: 9 },
            caption: { refine_mode: true },
        };
        await routePatchedSettings(page, settings => {
            settings.extension_settings = { ...(settings.extension_settings || {}), ...structuredClone(saved) };
        });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        expect((await callBridge(page, 'reloadCharacter', {}, 'extension-boot')).error).toBeFalsy();

        // The boot already applied everything the server returned; put the engine back to its own values first, so the
        // reload below has real work to do, and remember the objects other code may hold references to
        await page.evaluate(() => {
            const context = window.SillyTavern.getContext();
            const settings = context.extensionSettings;
            window.extensionReferences = { memory: settings.memory, note: settings.note };
            Object.assign(settings.memory, { depth: 2, position: 0, role: 0, template: '[Summary: {{summary}}]' });
            settings.translate.provider = 'google';
            settings.connectionManager.profiles = [];
            settings.connectionManager.selectedProfile = '';
            settings.note.defaultDepth = 4;
            settings.caption.refine_mode = false;
            window.$('#memory_contents').val('story so far');
        });

        const reload = await callBridge(page, 'reloadSettings', {}, 'extension-reload');
        expect(reload.error).toBeFalsy();
        expect(reload.result).toMatchObject({ ok: true });

        const engine = await page.evaluate(() => {
            const context = window.SillyTavern.getContext();
            const settings = context.extensionSettings;
            return {
                memory: { depth: settings.memory.depth, position: settings.memory.position, role: settings.memory.role, template: settings.memory.template },
                translateProvider: settings.translate.provider,
                translateLanguage: settings.translate.target_language,
                connectionManager: settings.connectionManager,
                noteDefault: settings.note.default,
                noteDepth: settings.note.defaultDepth,
                captionRefine: settings.caption.refine_mode,
                sameMemoryObject: settings.memory === window.extensionReferences.memory,
                sameNoteObject: settings.note === window.extensionReferences.note,
                memoryPrompt: context.extensionPrompts['1_memory'],
            };
        });
        expect(engine.memory).toEqual(saved.memory);
        expect(engine.translateProvider).toBe('bing');
        expect(engine.translateLanguage).toBe('ja');
        expect(engine.connectionManager).toEqual(saved.connectionManager);
        expect(engine.noteDefault).toBe('global note');
        expect(engine.noteDepth).toBe(9);
        // Not on the whitelist: the engine keeps its own value
        expect(engine.captionRefine).toBe(false);
        // Merged into the existing objects instead of replacing them
        expect(engine.sameMemoryObject).toBe(true);
        expect(engine.sameNoteObject).toBe(true);
        // The memory prompt was inserted again with the new position, depth, role and template
        expect(engine.memoryPrompt).toMatchObject({ value: '<<story so far>>', position: 1, depth: 7, role: 2 });
    });

    test('repeated reloadSettings calls do not pile up engine listeners', async ({ page }) => {
        test.setTimeout(90_000);

        await routePatchedSettings(page, settings => {
            settings.extension_settings = { ...(settings.extension_settings || {}), memory: { depth: 5 }, note: { default: 'note' } };
        });
        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        expect((await callBridge(page, 'reloadCharacter', {}, 'listener-boot')).error).toBeFalsy();

        const countListeners = () => page.evaluate(() => {
            const { events } = window.SillyTavern.getContext().eventSource;
            return Object.values(events).reduce((total, listeners) => total + listeners.length, 0);
        });

        // The first reload may register what a cold engine still lacks; later ones must not add anything
        expect((await callBridge(page, 'reloadSettings', {}, 'listener-reload-0')).error).toBeFalsy();
        const afterFirst = await countListeners();
        for (const index of [1, 2, 3]) {
            const reload = await callBridge(page, 'reloadSettings', {}, `listener-reload-${index}`);
            expect(reload.error).toBeFalsy();
        }
        expect(await countListeners()).toBe(afterFirst);
    });

    // A chat file the modern UI saved carries a new integrity revision; an engine still holding the older copy would have
    // its next save rejected. The payload's integrity lets the engine notice and open the chat again first.
    test('opens the chat again when the payload integrity differs from the engine copy', async ({ page }) => {
        test.setTimeout(90_000);

        const { character, chatId, file, chatLoads, chatSaves } = await routeIntegrityFixture(page);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        const opened = await callBridge(page, 'status', { avatar: character.avatar, groupId: null, chat: chatId }, 'integrity-open');
        expect(opened.error).toBeFalsy();
        expect(chatLoads).toEqual(['int-1']);

        // The engine already holds the revision the modern UI reports: the chat stays open and the save is accepted
        const matching = await callBridge(page, 'swipe', { avatar: character.avatar, groupId: null, chat: chatId, integrity: 'int-1', messageIndex: 1, direction: 'left' }, 'integrity-match');
        expect(matching.error).toBeFalsy();
        expect(matching.result).toMatchObject({ saved: true });
        expect(chatLoads).toEqual(['int-1']);
        expect(chatSaves).toEqual([{ sentIntegrity: 'int-1', rejected: false, issued: 'int-saved-1' }]);

        // The modern UI saved the chat in the meantime: the file moved to a revision the engine has not seen
        file.integrity = 'int-modern';

        // Without a known integrity the engine behaves as before and its stale save is rejected
        const legacy = await callBridge(page, 'swipe', { avatar: character.avatar, groupId: null, chat: chatId, messageIndex: 1, direction: 'left' }, 'integrity-missing');
        expect(legacy.error).toBeFalsy();
        expect(legacy.result).toMatchObject({ saved: false });
        expect(chatLoads).toEqual(['int-1']);

        // With it, the engine notices it is behind, opens the chat from the file and saves against the new revision
        const mismatching = await callBridge(page, 'swipe', { avatar: character.avatar, groupId: null, chat: chatId, integrity: 'int-modern', messageIndex: 1, direction: 'left' }, 'integrity-mismatch');
        expect(mismatching.error).toBeFalsy();
        expect(mismatching.result).toMatchObject({ saved: true });
        expect(chatLoads).toEqual(['int-1', 'int-modern']);
        expect(chatSaves.at(-1)).toMatchObject({ sentIntegrity: 'int-modern', rejected: false });

        // The reopened copy follows the file: the next payload with the issued revision does not open it a third time
        const followUp = await callBridge(page, 'swipe', { avatar: character.avatar, groupId: null, chat: chatId, integrity: file.integrity, messageIndex: 1, direction: 'left' }, 'integrity-follow-up');
        expect(followUp.result).toMatchObject({ saved: true });
        expect(chatLoads).toEqual(['int-1', 'int-modern']);
        expect(errors).toEqual([]);
    });

    test('opens a group chat again when the payload integrity differs from the engine copy', async ({ page }) => {
        test.setTimeout(90_000);

        const member = createBridgeCharacter({ name: 'Integrity Member', avatar: 'integrity-member.png' });
        const groupId = 'integrity-group';
        const chatId = 'Modern 2026-10-11T09-30-00-000Z';
        const group = {
            id: groupId,
            name: 'Integrity Group',
            avatar_url: '',
            members: [member.avatar],
            disabled_members: [],
            chats: [chatId],
            chat_id: chatId,
            allow_self_responses: false,
            activation_strategy: 0,
            generation_mode: 0,
            fav: false,
        };
        const messages = [
            { name: member.name, is_user: false, is_system: false, send_date: '2026-10-11T09:30:00.000Z', mes: 'group greeting', extra: {} },
            { name: member.name, is_user: false, is_system: false, send_date: '2026-10-11T09:30:01.000Z', mes: 'only candidate', swipe_id: 0, swipes: ['only candidate'], swipe_info: [{}], extra: {} },
        ];
        const file = { integrity: 'int-1' };
        const chatLoads = [];
        const chatSaves = [];
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        await page.route('**/api/characters/all', route => fulfillJson(route, [member]));
        await page.route('**/api/characters/get', route => fulfillJson(route, member));
        await page.route('**/api/groups/all', route => fulfillJson(route, [group]));
        await page.route('**/api/groups/edit', route => {
            Object.assign(group, postJson(route) || {});
            return fulfillJson(route, { ok: true });
        });
        await page.route('**/api/chats/group/get', route => {
            chatLoads.push(file.integrity);
            return fulfillJson(route, [{ chat_metadata: { integrity: file.integrity }, user_name: 'unused', character_name: 'unused' }, ...messages]);
        });
        await page.route('**/api/chats/group/save', route => {
            const sentIntegrity = postJson(route)?.chat?.[0]?.chat_metadata?.integrity;
            if (sentIntegrity !== file.integrity) {
                chatSaves.push({ sentIntegrity, rejected: true });
                return fulfillJson(route, { error: 'integrity' }, 400);
            }
            file.integrity = `int-saved-${chatSaves.length + 1}`;
            chatSaves.push({ sentIntegrity, rejected: false });
            return fulfillJson(route, { ok: true, integrity: file.integrity });
        });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        const opened = await callBridge(page, 'status', { avatar: null, groupId, chat: chatId }, 'group-integrity-open');
        expect(opened.error).toBeFalsy();
        expect(chatLoads).toEqual(['int-1']);

        const matching = await callBridge(page, 'swipe', { avatar: null, groupId, chat: chatId, integrity: 'int-1', messageIndex: 1, direction: 'left' }, 'group-integrity-match');
        expect(matching.error).toBeFalsy();
        expect(matching.result).toMatchObject({ groupId, saved: true });
        expect(chatLoads).toEqual(['int-1']);

        // The modern UI saved the group chat: the engine copy is one revision behind
        file.integrity = 'int-modern';
        const mismatching = await callBridge(page, 'swipe', { avatar: null, groupId, chat: chatId, integrity: 'int-modern', messageIndex: 1, direction: 'left' }, 'group-integrity-mismatch');
        expect(mismatching.error).toBeFalsy();
        expect(mismatching.result).toMatchObject({ groupId, saved: true });
        expect(chatLoads).toEqual(['int-1', 'int-modern']);
        expect(chatSaves.at(-1)).toMatchObject({ sentIntegrity: 'int-modern', rejected: false });
        expect(chatSaves.filter(save => save.rejected)).toEqual([]);
        expect(errors).toEqual([]);
    });

    // A reload posted before a generate must finish before it starts, so a preset or API save followed by an immediate
    // send generates with the new settings.
    test('a reloadSettings posted right before a generate finishes first and the generation uses its settings', async ({ page }) => {
        test.setTimeout(120_000);

        let temperature = 0.2;
        const { character, chatId, errors } = await routeStopFixture(page);
        const modelRequests = await routeStubbedChatCompletion(page, 'serialized reply', {
            patchSettings: settings => {
                settings.oai_settings.temp_openai = temperature;
            },
        });

        // A slow settings read: a generate that did not wait for the reload would start with the old temperature
        let settingsDelayMs = 0;
        await page.route('**/api/settings/get', async route => {
            await delay(settingsDelayMs);
            return route.fallback();
        });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        expect((await callBridge(page, 'reloadCharacter', {}, 'order-boot')).error).toBeFalsy();

        temperature = 0.9;
        settingsDelayMs = 1200;
        await startBridgeCall(page, 'reloadSettings', {}, 'order-reload');
        await startBridgeCall(page, 'generate', { avatar: character.avatar, groupId: null, chat: chatId, type: 'normal', message: 'send right after the save' }, 'order-generate');
        const reload = await awaitBridgeReply(page, 'order-reload');
        const generate = await awaitBridgeReply(page, 'order-generate');

        expect(reload.error).toBeFalsy();
        expect(generate.error).toBeFalsy();
        expect(generate.result).toMatchObject({ saved: true });
        expect(await getBridgeReplyTime(page, 'order-reload')).toBeLessThan(await getBridgeReplyTime(page, 'order-generate'));
        expect(modelRequests).toHaveLength(1);
        expect(modelRequests[0].temperature).toBe(0.9);
        expect(errors).toEqual([]);
    });

    // A reload must never interleave with a running generation, while stop has to reach it at once even though a
    // generate is still holding the engine.
    test('queues reloads behind a running generation and lets stop through', async ({ page }) => {
        test.setTimeout(120_000);

        const { character, chatId, errors } = await routeStopFixture(page);
        await routeOpenStreamingChatCompletion(page, [{ content: 'Partial answer' }]);
        let settingsFetches = 0;
        page.on('request', request => {
            if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/settings/get') {
                settingsFetches++;
            }
        });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        await countStreamTokens(page);
        await startBridgeCall(page, 'generate', { avatar: character.avatar, groupId: null, chat: chatId, type: 'normal', message: 'hold the engine' }, 'queue-generate');
        await page.waitForFunction(() => window.bridgeStreamOpened === true && window.bridgeStreamTokens >= 1);

        const fetchesDuringGeneration = settingsFetches;
        await startBridgeCall(page, 'reloadSettings', {}, 'queue-settings-1');
        await startBridgeCall(page, 'reloadSettings', {}, 'queue-settings-2');
        await startBridgeCall(page, 'reloadCharacter', {}, 'queue-character');
        // Intentional wait: the point is that nothing answers or runs while the reply is still streaming
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(1500);
        expect(await hasBridgeReply(page, 'queue-settings-1')).toBe(false);
        expect(await hasBridgeReply(page, 'queue-settings-2')).toBe(false);
        expect(await hasBridgeReply(page, 'queue-character')).toBe(false);
        expect(settingsFetches).toBe(fetchesDuringGeneration);

        // The stream never ends on its own: if stop waited behind the generate, this call would time out
        const stop = await callBridge(page, 'stop', {}, 'queue-stop');
        expect(stop.error).toBeFalsy();
        expect(stop.result).toMatchObject({ stopped: true });

        const generate = await awaitBridgeReply(page, 'queue-generate');
        const settingsOne = await awaitBridgeReply(page, 'queue-settings-1');
        const settingsTwo = await awaitBridgeReply(page, 'queue-settings-2');
        const character_ = await awaitBridgeReply(page, 'queue-character');
        expect(generate.error).toBeFalsy();
        expect(generate.result).toMatchObject({ stopped: true, saved: true });
        for (const reply of [settingsOne, settingsTwo, character_]) {
            expect(reply.error).toBeFalsy();
            expect(reply.result).toMatchObject({ ok: true });
        }

        // They ran after the generation, in arrival order, and the two identical reloadSettings shared one run
        const generateTime = await getBridgeReplyTime(page, 'queue-generate');
        const settingsTime = await getBridgeReplyTime(page, 'queue-settings-1');
        expect(generateTime).toBeLessThan(settingsTime);
        expect(Math.abs(await getBridgeReplyTime(page, 'queue-settings-2') - settingsTime)).toBeLessThan(100);
        expect(await getBridgeReplyTime(page, 'queue-character')).toBeGreaterThanOrEqual(settingsTime);
        expect(settingsFetches - fetchesDuringGeneration).toBe(1);
        expect(errors).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// Chat summary (A6): the SUMMARIZE action and the memory extension's behavior inside the bridge
// ---------------------------------------------------------------------------------------------------------------------

// One character with a chat of `messageCount` messages (the greeting first, then alternating user and character).
// Saves behave like the server: a save that carries an older revision is rejected, an accepted one issues a new revision
// and replaces the file, so a test can read back what the engine wrote.
async function routeSummaryFixture(page, { messageCount = 6, memories = {} } = {}) {
    const character = createBridgeCharacter({ name: 'Summary Fixture', avatar: 'summary-fixture.png' });
    const chatId = 'Modern 2026-10-11T10-00-00-000Z';
    const messages = Array.from({ length: messageCount }, (_, index) => {
        const isUser = index % 2 === 1;
        return {
            name: isUser ? 'You' : character.name,
            is_user: isUser,
            is_system: false,
            send_date: `2026-10-11T10:00:0${index}.000Z`,
            mes: index === 0 ? character.first_mes : `${isUser ? 'user' : 'reply'} message ${index}`,
            extra: memories[index] ? { memory: memories[index] } : {},
        };
    });
    const file = { integrity: 'int-1', messages, rejectSaves: false };
    const chatSaves = [];
    const chatLoads = [];
    const errors = [];
    let savedCardChat = '';
    page.on('pageerror', error => errors.push(error.message));

    await page.route('**/api/characters/all', route => fulfillJson(route, [character]));
    await page.route('**/api/characters/get', route => fulfillJson(route, savedCardChat ? { ...character, chat: savedCardChat } : character));
    await page.route('**/api/characters/edit', route => {
        savedCardChat = multipartFieldValue(route.request().postData() || '', 'chat');
        return route.fulfill({ status: 200, contentType: 'text/plain', body: 'OK' });
    });
    await page.route('**/api/groups/all', route => fulfillJson(route, []));
    await page.route('**/api/chats/get', route => {
        if (stripJsonlExtension(postJson(route)?.file_name) !== chatId) {
            return fulfillJson(route, []);
        }
        chatLoads.push(file.integrity);
        return fulfillJson(route, [{ chat_metadata: { integrity: file.integrity }, user_name: 'unused', character_name: 'unused' }, ...structuredClone(file.messages)]);
    });
    await page.route('**/api/chats/save', route => {
        const payload = postJson(route);
        if (!payload || stripJsonlExtension(payload.file_name) !== chatId) {
            return fulfillJson(route, { ok: true });
        }
        const sentIntegrity = payload.chat[0]?.chat_metadata?.integrity;
        const savedMessages = payload.chat.slice(1);
        if (file.rejectSaves || sentIntegrity !== file.integrity) {
            chatSaves.push({ sentIntegrity, rejected: true, messages: savedMessages });
            return fulfillJson(route, { error: 'integrity' }, 400);
        }
        file.integrity = `int-saved-${chatSaves.length + 1}`;
        file.messages = savedMessages;
        chatSaves.push({ sentIntegrity, rejected: false, issued: file.integrity, messages: savedMessages });
        return fulfillJson(route, { ok: true, integrity: file.integrity });
    });
    return { character, chatId, file, chatSaves, chatLoads, errors };
}

const summaryMemory = (memory = {}) => settings => {
    settings.extension_settings = {
        ...(settings.extension_settings || {}),
        memory: { ...(settings.extension_settings?.memory || {}), source: 'main', promptInterval: 4, promptForceWords: 0, prompt_builder: 0, memoryFrozen: false, ...memory },
    };
};

const summaryPayload = (fixture, mode, extra = {}) => ({ avatar: fixture.character.avatar, groupId: null, chat: fixture.chatId, mode, ...extra });

test.describe('Modern bridge summaries', () => {
    test('answers a malformed or unsupported summarize request with a bridge error and keeps serving', async ({ page }) => {
        test.setTimeout(90_000);

        const fixture = await routeSummaryFixture(page);
        // No patch: the default settings carry the Extras source, which is what the user has today
        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        expect((await callBridge(page, 'reloadCharacter', {}, 'summary-error-boot')).error).toBeFalsy();

        for (const mode of [undefined, 'sometimes', 'FORCE']) {
            const rejected = await callBridge(page, 'summarize', summaryPayload(fixture, mode), `summary-error-mode-${mode}`);
            expect(rejected.result).toBeNull();
            expect(rejected.error?.message).toContain('mode');
        }

        // No chat selected: neither a character nor a group, or no chat file
        const noTarget = await callBridge(page, 'summarize', { mode: 'force' }, 'summary-error-target');
        expect(noTarget.result).toBeNull();
        expect(noTarget.error?.message).toContain('指定角色或群聊');
        const noChat = await callBridge(page, 'summarize', { mode: 'auto', avatar: fixture.character.avatar }, 'summary-error-chat');
        expect(noChat.error?.message).toContain('聊天文件');

        // The Extras source needs an Extras server, which is not connected: a structured error, in both modes
        for (const mode of ['force', 'auto']) {
            const extras = await callBridge(page, 'summarize', summaryPayload(fixture, mode), `summary-error-extras-${mode}`);
            expect(extras.result).toBeNull();
            expect(extras.error?.message).toContain('Extras');
            expect(extras.error?.message).toContain('切换为主模型');
        }

        // Still serving, and nothing was saved
        const status = await callBridge(page, 'status', {}, 'summary-error-status');
        expect(status.error).toBeFalsy();
        expect(fixture.chatSaves).toEqual([]);
        expect(fixture.errors).toEqual([]);
    });

    test('refuses to summarize when the summary extension is disabled', async ({ page }) => {
        test.setTimeout(90_000);

        const fixture = await routeSummaryFixture(page);
        await routePatchedSettings(page, settings => {
            summaryMemory()(settings);
            settings.extension_settings.disabledExtensions = [...(settings.extension_settings.disabledExtensions || []), 'memory'];
        });
        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        expect((await callBridge(page, 'reloadCharacter', {}, 'summary-disabled-boot')).error).toBeFalsy();

        const disabled = await callBridge(page, 'summarize', summaryPayload(fixture, 'force'), 'summary-disabled');
        expect(disabled.result).toBeNull();
        expect(disabled.error?.message).toContain('已被禁用');
        expect(fixture.errors).toEqual([]);
    });

    test('a forced summary is written on the pre-last message, saved at once, and leaves the prompt breakdown alone', async ({ page }) => {
        test.setTimeout(120_000);

        const fixture = await routeSummaryFixture(page, { memories: { 2: 'an older summary' } });
        const modelRequests = await routeStubbedChatCompletion(page, 'The knight swore an oath.', { patchSettings: summaryMemory() });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        expect((await callBridge(page, 'status', { avatar: fixture.character.avatar, groupId: null, chat: fixture.chatId }, 'summary-force-open')).error).toBeFalsy();
        expect((await callBridge(page, 'getItemizedPrompt', {}, 'summary-force-itemized-before')).result).toEqual({ available: false });

        const summary = await callBridge(page, 'summarize', summaryPayload(fixture, 'force', { integrity: 'int-1' }), 'summary-force');
        expect(summary.error).toBeFalsy();
        // 6 messages: the summary goes on the pre-last one, index 4. It was saved before the reply was sent.
        expect(summary.result).toMatchObject({
            chat: fixture.chatId,
            messageCount: 6,
            due: true,
            summary: 'The knight swore an oath.',
            index: 4,
            saved: true,
            reason: '',
        });
        expect(fixture.chatSaves).toHaveLength(1);
        expect(fixture.chatSaves[0]).toMatchObject({ sentIntegrity: 'int-1', rejected: false });
        // The older summary stays where it was (legacy keeps earlier summaries; clearing the new one restores it)
        expect(fixture.file.messages.map(message => message.extra?.memory || '')).toEqual(['', '', 'an older summary', '', 'The knight swore an oath.', '']);

        // The main model got the summary instruction (the classic builder adds it to the regular prompt)
        expect(modelRequests).toHaveLength(1);
        expect(JSON.stringify(modelRequests[0])).toContain('Summarize the most important facts');
        // The next generation injects the new summary
        const injected = await page.evaluate(() => window.SillyTavern.getContext().extensionPrompts['1_memory']?.value);
        expect(injected).toBe('[Summary: The knight swore an oath.]');
        // The summary request itself must not become "the last prompt breakdown" the modern UI shows
        expect((await callBridge(page, 'getItemizedPrompt', {}, 'summary-force-itemized-after')).result).toEqual({ available: false });

        // A second forced summary writes on the same message again instead of creating a third summary
        const again = await callBridge(page, 'summarize', summaryPayload(fixture, 'force', { integrity: fixture.file.integrity }), 'summary-force-again');
        expect(again.error).toBeFalsy();
        expect(again.result).toMatchObject({ index: 4, saved: true, reason: '' });
        expect(fixture.file.messages.filter(message => message.extra?.memory)).toHaveLength(2);
        expect(fixture.errors).toEqual([]);
    });

    test('an automatic summary runs the extension\'s own due check and only calls the model when it is due', async ({ page }) => {
        test.setTimeout(120_000);

        const fixture = await routeSummaryFixture(page);
        let memory = { promptInterval: 10 };
        const modelRequests = await routeStubbedChatCompletion(page, 'Auto summary.', { patchSettings: settings => summaryMemory(memory)(settings) });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        expect((await callBridge(page, 'status', { avatar: fixture.character.avatar, groupId: null, chat: fixture.chatId }, 'summary-auto-open')).error).toBeFalsy();

        // Fewer messages than the interval: answered at once, no model call, no save
        const early = await callBridge(page, 'summarize', summaryPayload(fixture, 'auto', { integrity: 'int-1' }), 'summary-auto-early');
        expect(early.error).toBeFalsy();
        expect(early.result).toMatchObject({ due: false, reason: 'too-short', summary: '', index: -1, saved: false, messagesSince: 6 });
        expect(modelRequests).toHaveLength(0);
        expect(fixture.chatSaves).toHaveLength(0);

        // Interval 0 switches the automatic summary off, paused likewise
        memory = { promptInterval: 0 };
        expect((await callBridge(page, 'reloadSettings', {}, 'summary-auto-off-reload')).error).toBeFalsy();
        expect((await callBridge(page, 'summarize', summaryPayload(fixture, 'auto'), 'summary-auto-off')).result).toMatchObject({ due: false, reason: 'off' });
        memory = { promptInterval: 4, memoryFrozen: true };
        expect((await callBridge(page, 'reloadSettings', {}, 'summary-auto-frozen-reload')).error).toBeFalsy();
        expect((await callBridge(page, 'summarize', summaryPayload(fixture, 'auto'), 'summary-auto-frozen')).result).toMatchObject({ due: false, reason: 'frozen' });
        expect(modelRequests).toHaveLength(0);

        // Due: the same call now summarizes. A forced summary ignores the pause.
        memory = { promptInterval: 4 };
        expect((await callBridge(page, 'reloadSettings', {}, 'summary-auto-due-reload')).error).toBeFalsy();
        const due = await callBridge(page, 'summarize', summaryPayload(fixture, 'auto', { integrity: 'int-1' }), 'summary-auto-due');
        expect(due.error).toBeFalsy();
        expect(due.result).toMatchObject({ due: true, summary: 'Auto summary.', index: 4, saved: true, reason: '' });
        expect(modelRequests).toHaveLength(1);

        // Right after the summary only 1 message follows it: not due again until the interval has passed
        const after = await callBridge(page, 'summarize', summaryPayload(fixture, 'auto', { integrity: fixture.file.integrity }), 'summary-auto-after');
        expect(after.result).toMatchObject({ due: false, reason: 'waiting', messagesSince: 1 });
        expect(modelRequests).toHaveLength(1);
        expect(fixture.errors).toEqual([]);
    });

    test('rolls the summary back when the chat file does not take it, so the engine never injects a summary the file lacks', async ({ page }) => {
        test.setTimeout(120_000);

        const fixture = await routeSummaryFixture(page);
        await routeStubbedChatCompletion(page, 'A summary the file will refuse.', { patchSettings: summaryMemory() });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        expect((await callBridge(page, 'status', { avatar: fixture.character.avatar, groupId: null, chat: fixture.chatId }, 'summary-rollback-open')).error).toBeFalsy();

        // Someone else saved the chat meanwhile: the engine's save carries an older revision and is rejected
        fixture.file.rejectSaves = true;
        const refused = await callBridge(page, 'summarize', summaryPayload(fixture, 'force', { integrity: 'int-1' }), 'summary-rollback');
        expect(refused.error).toBeFalsy();
        expect(refused.result).toMatchObject({ due: true, saved: false, reason: 'save-failed', index: 4, summary: 'A summary the file will refuse.' });
        expect(fixture.chatSaves.at(-1)).toMatchObject({ rejected: true });
        const engine = await page.evaluate(() => {
            const context = window.SillyTavern.getContext();
            return { memories: context.chat.map(message => message.extra?.memory || ''), injected: context.extensionPrompts['1_memory']?.value };
        });
        expect(engine.memories.every(memory => memory === '')).toBe(true);
        expect(engine.injected).toBe('');
        expect(fixture.errors).toEqual([]);
    });

    // The extension used to summarize on its own after every reply and save the chat 1 second later. In the bridge that save
    // would carry whatever revision the engine knew back then and either be rejected or make the modern UI's next save fail.
    test('the extension never summarizes on its own in the bridge, so a reply is followed by no model call and no save', async ({ page }) => {
        test.setTimeout(120_000);

        const fixture = await routeSummaryFixture(page, { messageCount: 4 });
        const modelRequests = await routeStubbedChatCompletion(page, 'a reply', { patchSettings: summaryMemory({ promptInterval: 2 }) });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        expect((await callBridge(page, 'status', { avatar: fixture.character.avatar, groupId: null, chat: fixture.chatId }, 'summary-own-open')).error).toBeFalsy();

        // The extension's listeners: the chat-changed one that re-inserts a stored summary is there, the triggering ones are not
        const listeners = await page.evaluate(() => {
            const { eventSource, eventTypes } = window.SillyTavern.getContext();
            const names = type => (eventSource.events[type] || []).map(listener => listener.name);
            return {
                chatChanged: names(eventTypes.CHAT_CHANGED),
                rendered: names(eventTypes.CHARACTER_MESSAGE_RENDERED),
                deleted: names(eventTypes.MESSAGE_DELETED),
                updated: names(eventTypes.MESSAGE_UPDATED),
                swiped: names(eventTypes.MESSAGE_SWIPED),
            };
        });
        expect(listeners.chatChanged).toContain('onChatChanged');
        for (const triggers of [listeners.rendered, listeners.deleted, listeners.updated, listeners.swiped]) {
            expect(triggers).not.toContain('onChatEvent');
        }

        // In the old behavior this reply (chat of 6 messages, interval 2) would be followed by a summary request
        const generate = await callBridge(page, 'generate', summaryPayload(fixture, 'normal', { type: 'normal', message: 'keep going', integrity: 'int-1' }), 'summary-own-generate');
        expect(generate.error).toBeFalsy();
        expect(generate.result).toMatchObject({ saved: true, messageCount: 6 });
        const savesAfterGenerate = fixture.chatSaves.length;
        // Intentional wait: we assert the ABSENCE of a late summary request and save, so let the debounce window pass
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(3000);
        expect(modelRequests).toHaveLength(1);
        expect(fixture.chatSaves).toHaveLength(savesAfterGenerate);
        expect(fixture.file.messages.some(message => message.extra?.memory)).toBe(false);
        expect(fixture.errors).toEqual([]);
    });

    test('a summarize request waits behind a running generation, and stop reaches it', async ({ page }) => {
        test.setTimeout(120_000);

        const fixture = await routeSummaryFixture(page, { messageCount: 4 });
        await routeOpenStreamingChatCompletion(page, [{ content: 'Partial answer' }], { patchSettings: summaryMemory({ promptInterval: 50 }) });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        await countStreamTokens(page);
        await startBridgeCall(page, 'generate', summaryPayload(fixture, 'normal', { type: 'normal', message: 'hold the engine' }), 'summary-queue-generate');
        await page.waitForFunction(() => window.bridgeStreamOpened === true && window.bridgeStreamTokens >= 1);
        await startBridgeCall(page, 'summarize', summaryPayload(fixture, 'auto'), 'summary-queue-summarize');
        // Intentional wait: the point is that nothing answers while the reply is still streaming
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(1500);
        expect(await hasBridgeReply(page, 'summary-queue-summarize')).toBe(false);

        const stop = await callBridge(page, 'stop', {}, 'summary-queue-stop');
        expect(stop.error).toBeFalsy();
        const generate = await awaitBridgeReply(page, 'summary-queue-generate');
        const summarize = await awaitBridgeReply(page, 'summary-queue-summarize');
        expect(generate.result).toMatchObject({ stopped: true, saved: true });
        // It ran after the generation and carries the stop mark, like a queued generate would
        expect(summarize.error).toBeFalsy();
        expect(summarize.result).toMatchObject({ stopped: true, due: false });
        expect(await getBridgeReplyTime(page, 'summary-queue-generate')).toBeLessThan(await getBridgeReplyTime(page, 'summary-queue-summarize'));
        expect(fixture.errors).toEqual([]);
    });

    test('a stop that arrives while the summary request is running ends it without writing anything', async ({ page }) => {
        test.setTimeout(120_000);

        const fixture = await routeSummaryFixture(page);
        // A non-streaming chat completion that never answers until the request is aborted
        await page.route('**/api/settings/get', async route => {
            const response = await route.fetch();
            const body = await response.json();
            const settings = JSON.parse(body.settings || '{}');
            settings.main_api = 'openai';
            settings.oai_settings = { ...(settings.oai_settings || {}), chat_completion_source: 'openai', stream_openai: false };
            summaryMemory()(settings);
            return route.fulfill({ response, json: { ...body, settings: JSON.stringify(settings) } });
        });
        let modelRequestStarted = false;
        await page.route('**/api/backends/**', route => {
            if (route.request().url().endsWith('/chat-completions/generate')) {
                modelRequestStarted = true;
                return new Promise(() => {});
            }
            return fulfillJson(route, route.request().url().endsWith('/chat-completions/status') ? { data: [{ id: 'gpt-4-turbo' }] } : {});
        });
        await page.route('**/api/horde/**', route => fulfillJson(route, { error: 'horde disabled in tests' }, 500));

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        await startBridgeCall(page, 'summarize', summaryPayload(fixture, 'force'), 'summary-stop');
        await expect.poll(() => modelRequestStarted, { timeout: 30_000 }).toBe(true);
        const stop = await callBridge(page, 'stop', {}, 'summary-stop-call');
        expect(stop.error).toBeFalsy();
        const summarize = await awaitBridgeReply(page, 'summary-stop');

        expect(summarize.error).toBeFalsy();
        expect(summarize.result).toMatchObject({ stopped: true, summary: '', saved: false, reason: 'stopped' });
        expect(fixture.chatSaves).toEqual([]);
        const engine = await page.evaluate(() => window.SillyTavern.getContext().chat.some(message => message.extra?.memory));
        expect(engine).toBe(false);
        expect(fixture.errors).toEqual([]);
    });

    test('summarizes a group chat and saves it through the group chat file', async ({ page }) => {
        test.setTimeout(120_000);

        const member = createBridgeCharacter({ name: 'Summary Member', avatar: 'summary-member.png' });
        const groupId = 'summary-group';
        const chatId = 'Modern 2026-10-11T11-00-00-000Z';
        const group = {
            id: groupId,
            name: 'Summary Group',
            avatar_url: '',
            members: [member.avatar],
            disabled_members: [],
            chats: [chatId],
            chat_id: chatId,
            allow_self_responses: false,
            activation_strategy: 0,
            generation_mode: 0,
            fav: false,
        };
        const messages = Array.from({ length: 5 }, (_, index) => ({
            name: index % 2 ? 'You' : member.name,
            is_user: index % 2 === 1,
            is_system: false,
            send_date: `2026-10-11T11:00:0${index}.000Z`,
            mes: `group message ${index}`,
            extra: {},
        }));
        const file = { integrity: 'int-1', messages };
        const saves = [];
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        const modelRequests = await routeStubbedChatCompletion(page, 'Group summary.', { patchSettings: summaryMemory() });
        await page.route('**/api/characters/all', route => fulfillJson(route, [member]));
        await page.route('**/api/characters/get', route => fulfillJson(route, member));
        await page.route('**/api/groups/all', route => fulfillJson(route, [group]));
        await page.route('**/api/groups/edit', route => {
            Object.assign(group, postJson(route) || {});
            return fulfillJson(route, { ok: true });
        });
        await page.route('**/api/chats/group/get', route => fulfillJson(route, [{ chat_metadata: { integrity: file.integrity }, user_name: 'unused', character_name: 'unused' }, ...structuredClone(file.messages)]));
        await page.route('**/api/chats/group/save', route => {
            const payload = postJson(route);
            const sentIntegrity = payload?.chat?.[0]?.chat_metadata?.integrity;
            if (sentIntegrity !== file.integrity) {
                saves.push({ sentIntegrity, rejected: true });
                return fulfillJson(route, { error: 'integrity' }, 400);
            }
            file.integrity = `int-saved-${saves.length + 1}`;
            file.messages = payload.chat.slice(1);
            saves.push({ sentIntegrity, rejected: false });
            return fulfillJson(route, { ok: true, integrity: file.integrity });
        });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        const summary = await callBridge(page, 'summarize', { avatar: null, groupId, chat: chatId, mode: 'force', integrity: 'int-1' }, 'summary-group');

        expect(summary.error).toBeFalsy();
        expect(summary.result).toMatchObject({ groupId, chat: chatId, due: true, summary: 'Group summary.', index: 3, saved: true, reason: '' });
        expect(modelRequests).toHaveLength(1);
        expect(saves).toEqual([{ sentIntegrity: 'int-1', rejected: false }]);
        expect(file.messages.map(message => message.extra?.memory || '')).toEqual(['', '', '', 'Group summary.', '']);
        expect(errors).toEqual([]);
    });

    // The one-click「切换为主模型」saves the settings and reloads them into the engine: it must accept summaries right after
    test('after reloadSettings changes the source from Extras to the main model, summarize is accepted, and repeating the reload changes nothing', async ({ page }) => {
        test.setTimeout(120_000);

        const fixture = await routeSummaryFixture(page);
        let source = 'extras';
        await routeStubbedChatCompletion(page, 'unused', {
            patchSettings: settings => summaryMemory({ source, promptInterval: 50 })(settings),
        });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        expect((await callBridge(page, 'status', { avatar: fixture.character.avatar, groupId: null, chat: fixture.chatId }, 'summary-switch-open')).error).toBeFalsy();
        const before = await callBridge(page, 'summarize', summaryPayload(fixture, 'auto'), 'summary-switch-before');
        expect(before.error?.message).toContain('Extras');

        source = 'main';
        const readMemory = () => page.evaluate(() => {
            const context = window.SillyTavern.getContext();
            const { source: memorySource, promptInterval, position, depth } = context.extensionSettings.memory;
            return { source: memorySource, promptInterval, position, depth, prompt: context.extensionPrompts['1_memory'] };
        });
        expect((await callBridge(page, 'reloadSettings', {}, 'summary-switch-reload')).error).toBeFalsy();
        const first = await readMemory();
        expect(first.source).toBe('main');
        const after = await callBridge(page, 'summarize', summaryPayload(fixture, 'auto'), 'summary-switch-after');
        expect(after.error).toBeFalsy();
        expect(after.result).toMatchObject({ due: false, reason: 'too-short' });

        // Reloading again is a no-op for the memory settings and the inserted prompt
        expect((await callBridge(page, 'reloadSettings', {}, 'summary-switch-reload-2')).error).toBeFalsy();
        expect((await callBridge(page, 'reloadSettings', {}, 'summary-switch-reload-3')).error).toBeFalsy();
        expect(await readMemory()).toEqual(first);
        expect(fixture.errors).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// Prompt estimate (A1 phase 2): the ESTIMATE_PROMPT action runs the legacy dry run and must leave no trace
// ---------------------------------------------------------------------------------------------------------------------

const estimatePayload = (fixture, extra = {}) => ({ avatar: fixture.character.avatar, groupId: null, chat: fixture.chatId, ...extra });

// What the engine holds about the open chat, as plain data, so a test can compare it before and after an estimate
const readEngineChat = page => page.evaluate(() => {
    const context = window.SillyTavern.getContext();
    return {
        chat: JSON.parse(JSON.stringify(context.chat)),
        chatMetadata: JSON.parse(JSON.stringify(context.chatMetadata)),
        extensionPrompts: Object.keys(context.extensionPrompts).sort(),
        globalVariables: JSON.parse(JSON.stringify(context.extensionSettings.variables?.global ?? null)),
    };
});

test.describe('Modern bridge prompt estimate', () => {
    test('estimates the next prompt with the legacy dry run and leaves the chat, its file, the prompt breakdown and the model untouched', async ({ page }) => {
        test.setTimeout(120_000);

        const fixture = await routeSummaryFixture(page, { messageCount: 6 });
        const modelRequests = await routeStubbedChatCompletion(page, 'never requested', {
            patchSettings: settings => {
                settings.oai_settings.openai_max_context = 8000;
                settings.oai_settings.openai_max_tokens = 500;
            },
        });
        let settingsSaves = 0;
        await page.route('**/api/settings/save', route => {
            settingsSaves++;
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        expect((await callBridge(page, 'status', estimatePayload(fixture), 'estimate-open')).error).toBeFalsy();
        expect((await callBridge(page, 'getItemizedPrompt', {}, 'estimate-itemized-before')).result).toEqual({ available: false });
        // Variable macros ({{setvar}}, {{incvar}}) in a prompt are the one thing that writes while a prompt is assembled: they change the
        // chat metadata and the global variables, and schedule a debounced chat save. A listener does the same during the dry run.
        await page.evaluate(() => {
            const { eventSource, eventTypes } = window.SillyTavern.getContext();
            window.estimateDryRuns = [];
            eventSource.on(eventTypes.CHAT_COMPLETION_PROMPT_READY, data => {
                const { variables } = window.SillyTavern.getContext();
                variables.local.set('estimateCounter', 1);
                variables.global.set('estimateGlobal', 'seen');
                window.estimateDryRuns.push({ dryRun: data.dryRun });
            });
        });
        // An error left behind by an earlier generation must not be taken for the result of this dry run, and must still be there afterwards
        await page.evaluate(async () => {
            (await import('/scripts/openai.js')).promptManager.error = 'left over from an earlier generation';
        });
        const before = await readEngineChat(page);
        expect(before.chatMetadata.variables).toBeUndefined();
        expect(before.globalVariables).toEqual({});

        const estimate = await callBridge(page, 'estimatePrompt', estimatePayload(fixture, { integrity: 'int-1' }), 'estimate-run');
        expect(estimate.error).toBeFalsy();
        expect(estimate.result).toMatchObject({
            available: true,
            estimated: true,
            mainApi: 'openai',
            maxContext: 7500,
            includesDraft: false,
        });
        expect(estimate.result.totalTokens).toBeGreaterThan(0);
        expect(estimate.result.totalTokens).toBeLessThan(7500);
        expect(typeof estimate.result.tokenizer).toBe('string');

        // The listener ran during the dry run, so the variables were written there and must have been put back
        expect(await page.evaluate(() => window.estimateDryRuns)).toEqual([{ dryRun: true }]);
        expect(await page.evaluate(async () => (await import('/scripts/openai.js')).promptManager.error)).toBe('left over from an earlier generation');

        // Nothing changed in memory: messages, metadata (variables, tainted flag, in-context marker) and the extension prompt keys
        expect(await readEngineChat(page)).toEqual(before);
        expect((await readEngineChat(page)).chatMetadata.tainted).toBeUndefined();
        expect((await callBridge(page, 'getItemizedPrompt', {}, 'estimate-itemized-after')).result).toEqual({ available: false });

        // The debounced save a variable macro schedules must not fire: wait out the debounce window, then check the file and the requests
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(3000);
        expect(fixture.chatSaves).toEqual([]);
        expect(fixture.file.messages).toHaveLength(6);
        expect(fixture.file.integrity).toBe('int-1');
        expect(settingsSaves).toBe(0);
        expect(modelRequests).toEqual([]);

        // A second estimate of the unchanged chat gives the same number
        const again = await callBridge(page, 'estimatePrompt', estimatePayload(fixture), 'estimate-run-again');
        expect(again.result).toMatchObject({ available: true, totalTokens: estimate.result.totalTokens });
        expect(fixture.errors).toEqual([]);
    });

    // The chat completion path reads the prompt manager's token total; every other API counts the assembled prompt string itself.
    // Its dry run also moves the in-context marker (a chat metadata field that the next save would carry away).
    test('counts the assembled prompt string for a text completion API and puts back the in-context marker', async ({ page }) => {
        test.setTimeout(120_000);

        const fixture = await routeSummaryFixture(page, { messageCount: 6 });
        await routeStubbedChatCompletion(page, 'unused', {
            patchSettings: settings => {
                settings.main_api = 'novel';
            },
        });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        expect((await callBridge(page, 'status', estimatePayload(fixture), 'estimate-text-open')).error).toBeFalsy();
        await page.evaluate(() => {
            window.SillyTavern.getContext().chatMetadata.lastInContextMessageId = 'before the estimate';
        });
        const before = await readEngineChat(page);

        const estimate = await callBridge(page, 'estimatePrompt', estimatePayload(fixture), 'estimate-text');
        expect(estimate.error).toBeFalsy();
        expect(estimate.result).toMatchObject({ available: true, estimated: true, mainApi: 'novel', includesDraft: false });
        expect(estimate.result.totalTokens).toBeGreaterThan(0);
        const expectedBudget = await page.evaluate(async () => (await import('/script.js')).getMaxPromptTokens());
        expect(estimate.result.maxContext).toBe(expectedBudget);

        expect(await readEngineChat(page)).toEqual(before);
        expect(fixture.chatSaves).toEqual([]);
        expect(fixture.errors).toEqual([]);
    });

    // The point of the estimate is to predict what the next send weighs: with an empty draft, the generation that follows sends the same
    // prompt, so the prompt breakdown it records must report the same total and the same budget.
    for (const mainApi of ['openai', 'novel']) {
        test(`the ${mainApi} estimate equals the size of the prompt the next generation sends`, async ({ page }) => {
            test.setTimeout(120_000);

            const fixture = await routeSummaryFixture(page, { messageCount: 6 });
            await routeStubbedChatCompletion(page, 'a reply', {
                patchSettings: settings => {
                    settings.main_api = mainApi;
                },
            });
            await page.route('**/api/novelai/generate', route => fulfillJson(route, { output: 'a reply' }));

            await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
            const estimate = await callBridge(page, 'estimatePrompt', estimatePayload(fixture), `estimate-compare-${mainApi}`);
            expect(estimate.error).toBeFalsy();
            expect(estimate.result).toMatchObject({ available: true, mainApi });
            expect(fixture.chatSaves).toEqual([]);

            const generate = await callBridge(page, 'generate', estimatePayload(fixture, { type: 'normal', message: '' }), `estimate-compare-generate-${mainApi}`);
            expect(generate.error).toBeFalsy();
            expect(generate.result).toMatchObject({ saved: true, messageCount: 7 });

            const itemized = await callBridge(page, 'getItemizedPrompt', {}, `estimate-compare-itemized-${mainApi}`);
            expect(itemized.result).toMatchObject({
                available: true,
                mainApi,
                totalTokens: estimate.result.totalTokens,
                maxContext: estimate.result.maxContext,
                tokenizer: estimate.result.tokenizer,
                presetName: estimate.result.presetName,
                modelUsed: estimate.result.modelUsed,
            });
            expect(fixture.errors).toEqual([]);
        });
    }

    test('a group payload is reported as unsupported without switching the engine to the group', async ({ page }) => {
        test.setTimeout(90_000);

        const fixture = await routeSummaryFixture(page);
        await routeStubbedChatCompletion(page, 'unused');

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        expect((await callBridge(page, 'status', estimatePayload(fixture), 'estimate-group-open')).error).toBeFalsy();

        const group = await callBridge(page, 'estimatePrompt', { avatar: null, groupId: 'unknown-group', chat: 'any chat' }, 'estimate-group');
        expect(group.error).toBeFalsy();
        expect(group.result).toEqual({ available: false, reason: 'group' });

        // The engine still sits on the character chat: an unknown group would have thrown while switching
        const status = await callBridge(page, 'status', {}, 'estimate-group-status');
        expect(status.result).toMatchObject({ avatar: fixture.character.avatar, groupId: '', chat: fixture.chatId, messageCount: 6 });

        // A request that names neither a group nor a complete character chat is a bridge error and the engine keeps serving
        const incomplete = await callBridge(page, 'estimatePrompt', { avatar: fixture.character.avatar }, 'estimate-incomplete');
        expect(incomplete.result).toBeNull();
        expect(incomplete.error?.message).toContain('聊天文件');
        expect((await callBridge(page, 'estimatePrompt', estimatePayload(fixture), 'estimate-after-error')).result).toMatchObject({ available: true });
        expect(fixture.chatSaves).toEqual([]);
        expect(fixture.errors).toEqual([]);
    });

    test('reports mandatory prompts that do not fit the budget as unavailable and leaves the prompt manager error alone', async ({ page }) => {
        test.setTimeout(90_000);

        const fixture = await routeSummaryFixture(page);
        await routeStubbedChatCompletion(page, 'unused', {
            // A prompt budget of one token: the mandatory prompts cannot fit
            patchSettings: settings => {
                settings.oai_settings.openai_max_context = 500;
                settings.oai_settings.openai_max_tokens = 499;
            },
        });

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        const budget = await callBridge(page, 'estimatePrompt', estimatePayload(fixture), 'estimate-budget');
        expect(budget.error).toBeFalsy();
        expect(budget.result).toMatchObject({ available: false, reason: 'budget' });
        expect(budget.result.message).toContain('mandatory prompts');

        // The legacy error flag is restored so the prompt manager does not show an error that no generation produced
        const promptError = await page.evaluate(async () => (await import('/scripts/openai.js')).promptManager.error);
        expect(promptError).toBeNull();
        expect(fixture.chatSaves).toEqual([]);
        expect(fixture.errors).toEqual([]);
    });

    test('an estimate requested during a generation waits for it, runs afterwards, and stop does not reach it', async ({ page }) => {
        test.setTimeout(120_000);

        const fixture = await routeSummaryFixture(page, { messageCount: 4 });
        await routeOpenStreamingChatCompletion(page, [{ content: 'Partial answer' }]);

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        await countStreamTokens(page);
        await startBridgeCall(page, 'generate', estimatePayload(fixture, { type: 'normal', message: 'hold the engine' }), 'estimate-queue-generate');
        await page.waitForFunction(() => window.bridgeStreamOpened === true && window.bridgeStreamTokens >= 1);
        await startBridgeCall(page, 'estimatePrompt', estimatePayload(fixture), 'estimate-queue-estimate');
        // Intentional wait: the point is that nothing answers while the reply is still streaming
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(1500);
        expect(await hasBridgeReply(page, 'estimate-queue-estimate')).toBe(false);

        const stop = await callBridge(page, 'stop', {}, 'estimate-queue-stop');
        expect(stop.error).toBeFalsy();
        const generate = await awaitBridgeReply(page, 'estimate-queue-generate');
        const estimate = await awaitBridgeReply(page, 'estimate-queue-estimate');
        expect(generate.result).toMatchObject({ stopped: true, saved: true });
        // It ran after the generation, on the chat as the generation left it: the user message is part of the prompt
        expect(estimate.error).toBeFalsy();
        expect(estimate.result).toMatchObject({ available: true, estimated: true });
        expect(await getBridgeReplyTime(page, 'estimate-queue-generate')).toBeLessThan(await getBridgeReplyTime(page, 'estimate-queue-estimate'));
        expect(fixture.errors).toEqual([]);
    });
});
