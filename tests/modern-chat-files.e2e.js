import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';

/* global document, localStorage, requestAnimationFrame, window */

function stripJsonlExtension(value) {
    return String(value || '').replace(/\.jsonl$/i, '');
}

function chatFileName(chatId) {
    return `${stripJsonlExtension(chatId)}.jsonl`;
}

function multipartFieldValue(bodyText, fieldName) {
    const match = new RegExp(`name="${fieldName}"\\r?\\n\\r?\\n([^\\r\\n]*)`).exec(bodyText);
    return match?.[1]?.trim() || '';
}

function multipartFileName(bodyText, fieldName) {
    const match = new RegExp(`name="${fieldName}"; filename="([^"]+)"`).exec(bodyText);
    return match?.[1]?.trim() || '';
}

function createDeferred() {
    /** @type {(value?: unknown) => void} */
    let resolve;
    /** @type {(reason?: unknown) => void} */
    let reject;
    const promise = new Promise((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

function createChatFixture() {
    const now = Date.now();
    return {
        character: {
            avatar: 'mock.png',
            name: 'Mock Character',
            data: {
                name: 'Mock Character',
                first_mes: 'Hello {{user}}.',
                creator: 'Modern E2E',
            },
        },
        chats: [
            { file_id: 'existing-chat', file_name: 'existing-chat.jsonl', chat_items: 2, file_size: '1 KB', last_mes: now },
        ],
        groups: [],
        groupChats: [],
        messagesByChat: {
            'existing-chat': [
                { name: 'Modern User', is_user: true, mes: 'hello', send_date: now - 1000 },
                { name: 'Mock Character', is_user: false, mes: 'reply', send_date: now },
            ],
        },
        backups: [
            { file_id: 'backup-chat', file_name: 'backup-chat.jsonl', chat_items: 2, file_size: '2 KB', last_mes: now },
        ],
        requests: {
            characterChats: [],
            chatGets: [],
            saves: [],
            renames: [],
            deletes: [],
            imports: [],
            exports: [],
            backupDownloads: [],
            backupDeletes: [],
            bridge: [],
            searches: [],
            groupSaves: [],
            groupDeletes: [],
            groupImports: [],
            groupEdits: [],
        },
    };
}

function upsertChat(fixture, chatId, messages) {
    const fileName = chatFileName(chatId);
    const item = {
        file_id: stripJsonlExtension(chatId),
        file_name: fileName,
        chat_items: messages.length,
        file_size: `${Math.max(messages.length, 1)} KB`,
        last_mes: Date.now(),
    };
    fixture.messagesByChat[item.file_id] = messages;
    fixture.chats = [
        item,
        ...fixture.chats.filter(chat => stripJsonlExtension(chat.file_id || chat.file_name) !== item.file_id),
    ];
}

function chatResponse(fixture, chatId) {
    return [
        { chat_metadata: {}, user_name: 'Modern User', character_name: fixture.character.name },
        ...(fixture.messagesByChat[stripJsonlExtension(chatId)] || []),
    ];
}

function upsertGroupChat(fixture, chatId, messages) {
    const fileName = chatFileName(chatId);
    const item = {
        file_id: stripJsonlExtension(chatId),
        file_name: fileName,
        chat_items: messages.length,
        file_size: `${Math.max(messages.length, 1)} KB`,
        last_mes: Date.now(),
    };
    fixture.messagesByChat[item.file_id] = messages;
    fixture.groupChats = [
        item,
        ...fixture.groupChats.filter(chat => stripJsonlExtension(chat.file_id || chat.file_name) !== item.file_id),
    ];
}

function fulfillJson(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

async function mockModernChatWorkspace(page, fixture = createChatFixture(), { beforeChatResponse = null } = {}) {
    await page.route('**/csrf-token', route => fulfillJson(route, { token: 'modern-chat-files-token' }));
    await page.route('**/api/users/me', route => fulfillJson(route, { name: 'Modern User', handle: 'modern-user' }));
    await page.route('**/api/settings/get', route => fulfillJson(route, {
        settings: JSON.stringify({
            name1: 'Modern User',
        }),
        openai_setting_names: [],
        openai_settings: [],
        textgenerationwebui_preset_names: [],
        textgenerationwebui_presets: [],
    }));
    await page.route('**/api/characters/all', route => fulfillJson(route, [fixture.character]));
    await page.route('**/api/groups/all', route => fulfillJson(route, fixture.groups));
    await page.route('**/api/groups/edit', route => {
        const payload = route.request().postDataJSON();
        fixture.requests.groupEdits.push(payload);
        fixture.groups = fixture.groups.map(group => group.id === payload.id ? { ...group, ...payload } : group);
        return fulfillJson(route, { ok: true });
    });
    await page.route('**/api/worldinfo/list', route => fulfillJson(route, []));
    await page.route('**/api/backgrounds/all', route => fulfillJson(route, { images: [] }));
    await page.route('**/api/backgrounds/folders', route => fulfillJson(route, { folders: [], imageFolderMap: {} }));
    await page.route('**/api/assets/get', route => fulfillJson(route, {}));
    await page.route('**/api/extensions/discover', route => fulfillJson(route, []));
    await page.route('**/api/secrets/settings', route => fulfillJson(route, { allowKeysExposure: false }));
    await page.route('**/api/secrets/read', route => fulfillJson(route, {}));
    await page.route('**/api/stats/get', route => fulfillJson(route, {}));
    await page.route('**/api/characters/chats', route => {
        fixture.requests.characterChats.push({ failed: Boolean(fixture.failCharacterChats) });
        if (fixture.failCharacterChats) {
            return fulfillJson(route, { error: 'chat list unavailable' }, 500);
        }
        return fulfillJson(route, fixture.chats);
    });
    await page.route('**/api/chats/search', route => {
        const payload = route.request().postDataJSON();
        fixture.requests.searches.push(payload);
        const source = payload.group_id ? fixture.groupChats : fixture.chats;
        const query = String(payload.query || '').toLowerCase();
        const chats = query
            ? source.filter(chat => String(chat.file_name || chat.file_id || '').toLowerCase().includes(query))
            : source;
        return fulfillJson(route, chats);
    });
    await page.route('**/api/chats/get', async route => {
        const payload = route.request().postDataJSON();
        fixture.requests.chatGets.push(payload);
        await beforeChatResponse?.(payload);
        return fulfillJson(route, chatResponse(fixture, payload.file_name));
    });
    await page.route('**/api/chats/group/get', route => {
        const payload = route.request().postDataJSON();
        return fulfillJson(route, chatResponse(fixture, payload.id));
    });
    await page.route('**/api/chats/save', route => {
        const payload = route.request().postDataJSON();
        fixture.requests.saves.push(payload);
        upsertChat(fixture, payload.file_name, payload.chat.filter(message => !message.chat_metadata));
        return fulfillJson(route, { ok: true });
    });
    await page.route('**/api/chats/group/save', route => {
        const payload = route.request().postDataJSON();
        fixture.requests.groupSaves.push(payload);
        upsertGroupChat(fixture, payload.id, payload.chat.filter(message => !message.chat_metadata));
        return fulfillJson(route, { ok: true });
    });
    await page.route('**/api/chats/rename', route => {
        const payload = route.request().postDataJSON();
        const oldId = stripJsonlExtension(payload.original_file);
        const newId = stripJsonlExtension(payload.renamed_file);
        fixture.requests.renames.push(payload);
        const messages = fixture.messagesByChat[oldId] || [];
        delete fixture.messagesByChat[oldId];
        fixture.messagesByChat[newId] = messages;
        fixture.chats = fixture.chats.map(chat => {
            const chatId = stripJsonlExtension(chat.file_id || chat.file_name);
            return chatId === oldId ? { ...chat, file_id: newId, file_name: chatFileName(newId) } : chat;
        });
        return fulfillJson(route, { sanitizedFileName: newId });
    });
    await page.route('**/api/chats/delete', route => {
        const payload = route.request().postDataJSON();
        const chatId = stripJsonlExtension(payload.chatfile);
        fixture.requests.deletes.push(payload);
        fixture.chats = fixture.chats.filter(chat => stripJsonlExtension(chat.file_id || chat.file_name) !== chatId);
        delete fixture.messagesByChat[chatId];
        return fulfillJson(route, { ok: true });
    });
    await page.route('**/api/chats/group/delete', route => {
        const payload = route.request().postDataJSON();
        const chatId = stripJsonlExtension(payload.id);
        fixture.requests.groupDeletes.push(payload);
        fixture.groupChats = fixture.groupChats.filter(chat => stripJsonlExtension(chat.file_id || chat.file_name) !== chatId);
        delete fixture.messagesByChat[chatId];
        return fulfillJson(route, { ok: true });
    });
    await page.route('**/api/chats/import', route => {
        const bodyText = route.request().postData() || '';
        const fileName = multipartFileName(bodyText, 'avatar');
        const chatId = stripJsonlExtension(fileName);
        fixture.requests.imports.push({
            bodyText,
            contentType: route.request().headers()['content-type'] || '',
            fileName,
            fileType: multipartFieldValue(bodyText, 'file_type'),
            avatarUrl: multipartFieldValue(bodyText, 'avatar_url'),
            userName: multipartFieldValue(bodyText, 'user_name'),
            characterName: multipartFieldValue(bodyText, 'character_name'),
        });
        upsertChat(fixture, chatId, [
            { name: 'Modern User', is_user: true, mes: `imported ${chatId}`, send_date: Date.now() },
        ]);
        return fulfillJson(route, { fileNames: [chatFileName(chatId)] });
    });
    await page.route('**/api/chats/group/import', route => {
        const bodyText = route.request().postData() || '';
        const fileName = multipartFileName(bodyText, 'avatar');
        const chatId = stripJsonlExtension(fileName);
        fixture.requests.groupImports.push({
            bodyText,
            contentType: route.request().headers()['content-type'] || '',
            fileName,
            fileType: multipartFieldValue(bodyText, 'file_type'),
            avatarUrl: multipartFieldValue(bodyText, 'avatar_url'),
            userName: multipartFieldValue(bodyText, 'user_name'),
            characterName: multipartFieldValue(bodyText, 'character_name'),
        });
        upsertGroupChat(fixture, chatId, [
            { name: 'Modern User', is_user: true, mes: `imported ${chatId}`, send_date: Date.now() },
        ]);
        return fulfillJson(route, { res: chatFileName(chatId) });
    });
    await page.route('**/api/chats/export', route => {
        const payload = route.request().postDataJSON();
        fixture.requests.exports.push(payload);
        return fulfillJson(route, { result: `exported ${payload.file} as ${payload.format}` });
    });
    await page.route('**/api/backups/chat/get', route => fulfillJson(route, fixture.backups));
    await page.route('**/api/backups/chat/download', route => {
        const payload = route.request().postDataJSON();
        fixture.requests.backupDownloads.push(payload);
        return route.fulfill({
            status: 200,
            contentType: 'application/jsonl',
            body: [
                JSON.stringify({ name: 'Modern User', is_user: true, mes: 'backup hello', send_date: Date.now() - 1000 }),
                JSON.stringify({ name: 'Mock Character', is_user: false, mes: 'backup reply', send_date: Date.now() }),
            ].join('\n'),
        });
    });
    await page.route('**/api/backups/chat/delete', route => {
        const payload = route.request().postDataJSON();
        fixture.requests.backupDeletes.push(payload);
        fixture.backups = fixture.backups.filter(backup => backup.file_name !== payload.name);
        return fulfillJson(route, { ok: true });
    });

    return fixture;
}

async function mockLegacyGenerationBridge(page, fixture, { beforeGenerateResponse = null, beforeSwipeResponse = null } = {}) {
    await page.route(/.*\?modernBridge=1$/u, route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html>
            <html>
                <body>
                    <script>
                        window.addEventListener('message', async event => {
                            const message = event.data || {};
                            if (message.source !== 'sillytavern-modern-bridge') return;
                            try {
                                const response = await fetch('/modern-test-bridge', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ action: message.action, payload: message.payload }),
                                });
                                const result = await response.json();
                                parent.postMessage({ source: 'sillytavern-modern-bridge', id: message.id, result }, event.origin);
                            } catch (error) {
                                parent.postMessage({ source: 'sillytavern-modern-bridge', id: message.id, error: { message: error.message } }, event.origin);
                            }
                        });
                    </script>
                </body>
            </html>`,
    }));

    await page.route('**/modern-test-bridge', async route => {
        const request = route.request().postDataJSON();
        const payload = request.payload || {};
        fixture.requests.bridge.push(request);

        if (request.action === 'generate') {
            await beforeGenerateResponse?.(request);
            const chatId = stripJsonlExtension(payload.chat);
            const currentMessages = fixture.messagesByChat[chatId] || [];
            let messages = [];
            if (payload.type === 'regenerate') {
                messages = currentMessages.map((message, index) => {
                    if (index !== currentMessages.length - 1) return message;
                    return {
                        ...message,
                        mes: 'regenerated bridge reply',
                        swipes: ['regenerated bridge reply', 'alternate regenerated reply'],
                        swipe_id: 0,
                    };
                });
            } else if (payload.type === 'continue') {
                messages = currentMessages.map((message, index) => {
                    if (index !== currentMessages.length - 1) return message;
                    return { ...message, mes: `${message.mes} continued by bridge` };
                });
            } else {
                messages = [
                    ...currentMessages,
                    { name: 'Modern User', is_user: true, mes: payload.message || '', send_date: Date.now() - 1000 },
                    { name: fixture.character.name, is_user: false, mes: `generated reply to ${payload.message}`, send_date: Date.now() },
                ];
            }
            upsertChat(fixture, chatId, messages);
            return fulfillJson(route, { chat: chatFileName(chatId), messageCount: messages.length });
        }

        if (request.action === 'swipe') {
            await beforeSwipeResponse?.(request);
            const chatId = stripJsonlExtension(payload.chat);
            const messages = (fixture.messagesByChat[chatId] || []).map((message, index) => {
                if (index !== Number(payload.messageIndex)) return message;
                const swipes = Array.isArray(message.swipes) && message.swipes.length ? message.swipes : [message.mes || ''];
                const currentSwipeId = Number(message.swipe_id) || 0;
                const swipeId = payload.direction === 'left'
                    ? (currentSwipeId + swipes.length - 1) % swipes.length
                    : (currentSwipeId + 1) % swipes.length;
                return { ...message, mes: swipes[swipeId], swipe_id: swipeId, swipes };
            });
            const swipedMessage = messages[Number(payload.messageIndex)] || {};
            upsertChat(fixture, chatId, messages);
            return fulfillJson(route, { chat: chatFileName(chatId), swipeId: swipedMessage.swipe_id || 0, swipeCount: swipedMessage.swipes?.length || 1 });
        }

        if (request.action === 'status') {
            const chatId = stripJsonlExtension(payload.chat);
            return fulfillJson(route, { chat: chatFileName(chatId), messageCount: (fixture.messagesByChat[chatId] || []).length });
        }

        return fulfillJson(route, { ok: true });
    });
}

test.describe('Modern chat files', () => {
    test('shows unread counts and clears them after opening the chat file', async ({ page }) => {
        const fixture = createChatFixture();
        const now = Date.now();
        fixture.chats = [
            { file_id: 'existing-chat', file_name: 'existing-chat.jsonl', chat_items: 2, file_size: '1 KB', last_mes: now + 2000 },
            { file_id: 'unread-chat', file_name: 'unread-chat.jsonl', chat_items: 3, file_size: '3 KB', last_mes: now + 1000 },
        ];
        fixture.messagesByChat = {
            'existing-chat': [
                { name: 'Modern User', is_user: true, mes: 'hello', send_date: now - 3000 },
                { name: 'Mock Character', is_user: false, mes: 'reply', send_date: now - 2000 },
            ],
            'unread-chat': [
                { name: 'Modern User', is_user: true, mes: 'older unread context', send_date: now - 3000 },
                { name: 'Mock Character', is_user: false, mes: 'first unread reply', send_date: now - 1000 },
                { name: 'Mock Character', is_user: false, mes: 'second unread reply', send_date: now },
            ],
        };
        await page.addInitScript(({ storageKey, readState }) => {
            localStorage.setItem(storageKey, JSON.stringify(readState));
        }, {
            storageKey: 'st-modern-chat-read-state:v1',
            readState: {
                cursors: {
                    'mock.png::existing-chat': { messageCount: 2, lastMes: now - 2000 },
                    'mock.png::unread-chat': { messageCount: 1, lastMes: now - 3000 },
                },
                contexts: { 'mock.png': true },
            },
        });
        await mockModernChatWorkspace(page, fixture);

        await page.goto('/modern/?view=chat');

        await expect(page.locator('[data-select-character="mock.png"] .unread-badge')).toHaveText('2');
        await expect(page.locator('[data-select-chat="unread-chat"] .unread-badge')).toHaveText('2');

        await page.locator('[data-select-chat="unread-chat"]').click();

        await expect(page.locator('.chat-thread')).toContainText('second unread reply');
        await expect(page.locator('[data-select-chat="unread-chat"] .unread-badge')).toHaveCount(0);
        await expect(page.locator('[data-select-character="mock.png"] .unread-badge')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('st-modern-chat-read-state:v1') || '{}')?.cursors?.['mock.png::unread-chat']?.messageCount)).toBe(3);
    });

    test('opens the latest unread chat when selecting an unread character', async ({ page }) => {
        const fixture = createChatFixture();
        const now = Date.now();
        fixture.chats = [
            { file_id: 'read-chat', file_name: 'read-chat.jsonl', chat_items: 2, file_size: '2 KB', last_mes: now + 3000 },
            { file_id: 'latest-unread', file_name: 'latest-unread.jsonl', chat_items: 3, file_size: '3 KB', last_mes: now + 2000 },
            { file_id: 'older-unread', file_name: 'older-unread.jsonl', chat_items: 2, file_size: '2 KB', last_mes: now + 1000 },
        ];
        fixture.messagesByChat = {
            'read-chat': [
                { name: 'Modern User', is_user: true, mes: 'read context', send_date: now - 4000 },
                { name: 'Mock Character', is_user: false, mes: 'read reply', send_date: now - 3000 },
            ],
            'latest-unread': [
                { name: 'Modern User', is_user: true, mes: 'latest unread context', send_date: now - 3000 },
                { name: 'Mock Character', is_user: false, mes: 'latest unread reply one', send_date: now - 2000 },
                { name: 'Mock Character', is_user: false, mes: 'latest unread reply two', send_date: now - 1000 },
            ],
            'older-unread': [
                { name: 'Modern User', is_user: true, mes: 'older unread context', send_date: now - 3000 },
                { name: 'Mock Character', is_user: false, mes: 'older unread reply', send_date: now - 2000 },
            ],
        };
        await page.addInitScript(({ storageKey, readState }) => {
            localStorage.setItem(storageKey, JSON.stringify(readState));
        }, {
            storageKey: 'st-modern-chat-read-state:v1',
            readState: {
                cursors: {
                    'mock.png::read-chat': { messageCount: 2, lastMes: now - 3000 },
                    'mock.png::latest-unread': { messageCount: 1, lastMes: now - 3000 },
                    'mock.png::older-unread': { messageCount: 1, lastMes: now - 3000 },
                },
                contexts: { 'mock.png': true },
            },
        });
        await mockModernChatWorkspace(page, fixture);

        await page.goto('/modern/?view=chat');

        await expect(page.locator('[data-select-chat="read-chat"]')).toHaveClass(/active/);
        await expect(page.locator('[data-select-character="mock.png"] .unread-badge')).toHaveText('3');

        await page.locator('[data-select-character="mock.png"]').click();

        await expect(page.locator('[data-select-chat="latest-unread"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('latest unread reply two');
        await expect(page.locator('[data-select-chat="latest-unread"] .unread-badge')).toHaveCount(0);
        await expect(page.locator('[data-select-chat="older-unread"] .unread-badge')).toHaveText('1');
        await expect(page.locator('[data-select-character="mock.png"] .unread-badge')).toHaveText('1');
        await expect(page.locator('[data-route="chat"] .nav-unread-badge')).toHaveText('1');
    });

    test('keeps a chat unread when another chat is selected before its messages load', async ({ page }) => {
        const fixture = createChatFixture();
        const now = Date.now();
        fixture.chats = [
            { file_id: 'existing-chat', file_name: 'existing-chat.jsonl', chat_items: 2, file_size: '1 KB', last_mes: now + 2000 },
            { file_id: 'unread-chat', file_name: 'unread-chat.jsonl', chat_items: 3, file_size: '3 KB', last_mes: now + 1000 },
            { file_id: 'other-chat', file_name: 'other-chat.jsonl', chat_items: 2, file_size: '2 KB', last_mes: now },
        ];
        fixture.messagesByChat['unread-chat'] = [
            { name: 'Modern User', is_user: true, mes: 'unread context', send_date: now - 2000 },
            { name: 'Mock Character', is_user: false, mes: 'unread reply one', send_date: now - 1000 },
            { name: 'Mock Character', is_user: false, mes: 'unread reply two', send_date: now },
        ];
        fixture.messagesByChat['other-chat'] = [
            { name: 'Modern User', is_user: true, mes: 'other context', send_date: now - 1000 },
            { name: 'Mock Character', is_user: false, mes: 'other current reply', send_date: now },
        ];
        await page.addInitScript(({ storageKey, readState }) => {
            localStorage.setItem(storageKey, JSON.stringify(readState));
        }, {
            storageKey: 'st-modern-chat-read-state:v1',
            readState: {
                cursors: {
                    'mock.png::existing-chat': { messageCount: 2, lastMes: now - 3000 },
                    'mock.png::unread-chat': { messageCount: 1, lastMes: now - 2000 },
                    'mock.png::other-chat': { messageCount: 2, lastMes: now },
                },
                contexts: { 'mock.png': true },
            },
        });
        const unreadResponseGate = createDeferred();
        let unreadLoadStarted = false;
        await mockModernChatWorkspace(page, fixture, {
            beforeChatResponse: payload => {
                if (stripJsonlExtension(payload.file_name) === 'unread-chat') {
                    unreadLoadStarted = true;
                    return unreadResponseGate.promise;
                }
            },
        });

        await page.goto('/modern/?view=chat');
        await expect(page.locator('[data-select-chat="unread-chat"] .unread-badge')).toHaveText('2');
        await page.locator('[data-select-chat="unread-chat"]').click();
        await expect.poll(() => unreadLoadStarted).toBe(true);

        await page.locator('[data-select-chat="other-chat"]').click();
        await expect(page.locator('[data-select-chat="other-chat"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('other current reply');

        const unreadResponse = page.waitForResponse(response => response.url().endsWith('/api/chats/get') && stripJsonlExtension(response.request().postDataJSON().file_name) === 'unread-chat');
        unreadResponseGate.resolve();
        await unreadResponse;
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

        await expect(page.locator('[data-select-chat="unread-chat"] .unread-badge')).toHaveText('2');
        const readState = await page.evaluate(() => JSON.parse(localStorage.getItem('st-modern-chat-read-state:v1') || '{}'));
        expect(readState.cursors['mock.png::unread-chat']).toMatchObject({ messageCount: 1 });
        await expect(page.locator('[data-select-chat="other-chat"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('other current reply');
    });

    test('keeps total unread count across character and group chat modes', async ({ page }) => {
        const fixture = createChatFixture();
        const now = Date.now();
        fixture.groups = [{
            id: 'group-alpha',
            name: 'Mock Group',
            members: ['mock.png'],
            chats: ['group-chat', 'group-unread'],
            chat_id: 'group-chat',
        }];
        fixture.chats = [
            { file_id: 'existing-chat', file_name: 'existing-chat.jsonl', chat_items: 2, file_size: '1 KB', last_mes: now + 3000 },
            { file_id: 'character-unread', file_name: 'character-unread.jsonl', chat_items: 3, file_size: '3 KB', last_mes: now + 2000 },
        ];
        fixture.groupChats = [
            { file_id: 'group-chat', file_name: 'group-chat.jsonl', chat_items: 2, file_size: '1 KB', last_mes: now + 3000 },
            { file_id: 'group-unread', file_name: 'group-unread.jsonl', chat_items: 2, file_size: '2 KB', last_mes: now + 1000 },
        ];
        fixture.messagesByChat = {
            'existing-chat': [
                { name: 'Modern User', is_user: true, mes: 'hello', send_date: now - 3000 },
                { name: 'Mock Character', is_user: false, mes: 'reply', send_date: now - 2000 },
            ],
            'character-unread': [
                { name: 'Modern User', is_user: true, mes: 'older character context', send_date: now - 3000 },
                { name: 'Mock Character', is_user: false, mes: 'first character unread', send_date: now - 1000 },
                { name: 'Mock Character', is_user: false, mes: 'second character unread', send_date: now },
            ],
            'group-chat': [
                { name: 'Modern User', is_user: true, mes: 'group hello', send_date: now - 3000 },
                { name: 'Mock Group', is_user: false, mes: 'group reply', send_date: now - 2000 },
            ],
            'group-unread': [
                { name: 'Modern User', is_user: true, mes: 'older group context', send_date: now - 3000 },
                { name: 'Mock Group', is_user: false, mes: 'group unread reply', send_date: now },
            ],
        };
        await page.addInitScript(({ storageKey, readState }) => {
            localStorage.setItem(storageKey, JSON.stringify(readState));
        }, {
            storageKey: 'st-modern-chat-read-state:v1',
            readState: {
                cursors: {
                    'mock.png::existing-chat': { messageCount: 2, lastMes: now - 2000 },
                    'mock.png::character-unread': { messageCount: 1, lastMes: now - 3000 },
                    'group:group-alpha::group-chat': { messageCount: 2, lastMes: now - 2000 },
                    'group:group-alpha::group-unread': { messageCount: 0, lastMes: now - 3000 },
                },
                contexts: { 'mock.png': true, 'group:group-alpha': true },
            },
        });
        await mockModernChatWorkspace(page, fixture);

        await page.goto('/modern/?view=chat');

        await expect(page.locator('[data-route="chat"] .nav-unread-badge')).toHaveText('2');

        await page.locator('[data-chat-mode="group"]').click();

        await expect(page.locator('[data-select-group="group-alpha"] .unread-badge')).toHaveText('2');
        await expect(page.locator('[data-select-chat="group-unread"] .unread-badge')).toHaveText('2');
        await expect(page.locator('[data-route="chat"] .nav-unread-badge')).toHaveText('4');

        await page.locator('[data-select-group="group-alpha"]').click();

        await expect(page.locator('[data-select-chat="group-unread"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('group unread reply');
        await expect(page.locator('[data-route="chat"] .nav-unread-badge')).toHaveText('2');
    });

    test('opens global unread chats in newest-first order from the chat navigation', async ({ page }) => {
        const fixture = createChatFixture();
        const now = Date.now();
        fixture.groups = [{
            id: 'group-alpha',
            name: 'Mock Group',
            members: ['mock.png'],
            chats: ['group-chat', 'group-unread'],
            chat_id: 'group-chat',
        }];
        fixture.chats = [
            { file_id: 'character-chat', file_name: 'character-chat.jsonl', chat_items: 2, file_size: '2 KB', last_mes: now + 4000 },
            { file_id: 'character-unread', file_name: 'character-unread.jsonl', chat_items: 3, file_size: '3 KB', last_mes: now + 3000 },
        ];
        fixture.groupChats = [
            { file_id: 'group-chat', file_name: 'group-chat.jsonl', chat_items: 2, file_size: '2 KB', last_mes: now + 2000 },
            { file_id: 'group-unread', file_name: 'group-unread.jsonl', chat_items: 2, file_size: '2 KB', last_mes: now + 1000 },
        ];
        fixture.messagesByChat = {
            'character-chat': [
                { name: 'Modern User', is_user: true, mes: 'character context', send_date: now - 4000 },
                { name: 'Mock Character', is_user: false, mes: 'character reply', send_date: now - 3000 },
            ],
            'character-unread': [
                { name: 'Modern User', is_user: true, mes: 'character unread context', send_date: now - 3000 },
                { name: 'Mock Character', is_user: false, mes: 'character unread reply one', send_date: now - 2000 },
                { name: 'Mock Character', is_user: false, mes: 'character unread reply two', send_date: now - 1000 },
            ],
            'group-chat': [
                { name: 'Modern User', is_user: true, mes: 'group context', send_date: now - 4000 },
                { name: 'Mock Group', is_user: false, mes: 'group reply', send_date: now - 3000 },
            ],
            'group-unread': [
                { name: 'Modern User', is_user: true, mes: 'group unread context', send_date: now - 2000 },
                { name: 'Mock Group', is_user: false, mes: 'group unread reply', send_date: now - 1000 },
            ],
        };
        await page.addInitScript(({ storageKey, readState }) => {
            localStorage.setItem(storageKey, JSON.stringify(readState));
        }, {
            storageKey: 'st-modern-chat-read-state:v1',
            readState: {
                cursors: {
                    'mock.png::character-chat': { messageCount: 2, lastMes: now - 3000 },
                    'mock.png::character-unread': { messageCount: 1, lastMes: now - 3000 },
                    'group:group-alpha::group-chat': { messageCount: 2, lastMes: now - 3000 },
                    'group:group-alpha::group-unread': { messageCount: 0, lastMes: now - 3000 },
                },
                contexts: { 'mock.png': true, 'group:group-alpha': true },
            },
        });
        await mockModernChatWorkspace(page, fixture);

        await page.goto('/modern/?view=chat');
        await page.locator('[data-chat-mode="group"]').click();
        await expect(page.locator('[data-route="chat"] .nav-unread-badge')).toHaveText('4');
        await page.locator('[data-route="dashboard"]').click();

        await page.locator('.sidebar [data-route="chat"]').click();

        await expect(page.locator('[data-chat-mode="character"]')).toHaveClass(/active/);
        await expect(page.locator('[data-select-chat="character-unread"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('character unread reply two');
        await expect(page.locator('[data-route="chat"] .nav-unread-badge')).toHaveText('2');

        await page.locator('.sidebar [data-route="chat"]').click();

        await expect(page.locator('[data-chat-mode="group"]')).toHaveClass(/active/);
        await expect(page.locator('[data-select-chat="group-unread"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('group unread reply');
        await expect(page.locator('[data-route="chat"] .nav-unread-badge')).toHaveCount(0);
    });

    test('refreshes unread counts without reloading the page', async ({ page }) => {
        const fixture = createChatFixture();
        const now = Date.now();
        fixture.chats = [
            { file_id: 'existing-chat', file_name: 'existing-chat.jsonl', chat_items: 2, file_size: '1 KB', last_mes: now + 2000 },
            { file_id: 'later-chat', file_name: 'later-chat.jsonl', chat_items: 1, file_size: '1 KB', last_mes: now + 1000 },
        ];
        fixture.messagesByChat = {
            'existing-chat': [
                { name: 'Modern User', is_user: true, mes: 'hello', send_date: now - 3000 },
                { name: 'Mock Character', is_user: false, mes: 'reply', send_date: now - 2000 },
            ],
            'later-chat': [
                { name: 'Modern User', is_user: true, mes: 'read baseline', send_date: now - 1000 },
            ],
        };
        await mockModernChatWorkspace(page, fixture);

        await page.goto('/modern/?view=chat');

        await expect(page.locator('[data-select-chat="later-chat"]')).toBeVisible();
        await expect.poll(() => fixture.requests.characterChats.length).toBe(1);
        await expect(page.locator('[data-select-chat="later-chat"] .unread-badge')).toHaveCount(0);

        fixture.messagesByChat['later-chat'].push(
            { name: 'Mock Character', is_user: false, mes: 'new reply without page reload', send_date: now + 3000 },
            { name: 'Mock Character', is_user: false, mes: 'second new reply without page reload', send_date: now + 4000 },
        );
        fixture.chats = fixture.chats.map(chat => chat.file_id === 'later-chat'
            ? { ...chat, chat_items: 3, file_size: '3 KB', last_mes: now + 4000 }
            : chat);

        await page.locator('[data-refresh-chat-list]').click();

        await expect.poll(() => fixture.requests.characterChats.length).toBe(2);
        await expect(page.locator('[data-select-character="mock.png"] .unread-badge')).toHaveText('2');
        await expect(page.locator('[data-select-chat="later-chat"] .unread-badge')).toHaveText('2');
        await expect(page.locator('[data-route="chat"] .nav-unread-badge')).toHaveText('2');

        await page.locator('[data-select-chat="later-chat"]').click();

        await expect(page.locator('.chat-thread')).toContainText('second new reply without page reload');
        await expect(page.locator('[data-select-chat="later-chat"] .unread-badge')).toHaveCount(0);
    });

    test('polls unread counts and updates chat navigation automatically', async ({ page }) => {
        const fixture = createChatFixture();
        const now = Date.now();
        fixture.chats = [
            { file_id: 'existing-chat', file_name: 'existing-chat.jsonl', chat_items: 2, file_size: '1 KB', last_mes: now + 2000 },
            { file_id: 'watched-chat', file_name: 'watched-chat.jsonl', chat_items: 1, file_size: '1 KB', last_mes: now + 1000 },
        ];
        fixture.messagesByChat = {
            'existing-chat': [
                { name: 'Modern User', is_user: true, mes: 'hello', send_date: now - 3000 },
                { name: 'Mock Character', is_user: false, mes: 'reply', send_date: now - 2000 },
            ],
            'watched-chat': [
                { name: 'Modern User', is_user: true, mes: 'read baseline', send_date: now - 1000 },
            ],
        };
        await mockModernChatWorkspace(page, fixture);

        await page.goto('/modern/?view=chat');

        await expect(page.locator('[data-select-chat="watched-chat"]')).toBeVisible();
        await expect.poll(() => fixture.requests.characterChats.length).toBe(1);
        await expect(page.locator('[data-route="chat"] .nav-unread-badge')).toHaveCount(0);
        fixture.messagesByChat['watched-chat'].push(
            { name: 'Mock Character', is_user: false, mes: 'polled reply', send_date: now + 3000 },
            { name: 'Mock Character', is_user: false, mes: 'second polled reply', send_date: now + 4000 },
        );
        fixture.chats = fixture.chats.map(chat => chat.file_id === 'watched-chat'
            ? { ...chat, chat_items: 3, file_size: '3 KB', last_mes: now + 4000 }
            : chat);

        await expect.poll(() => fixture.requests.characterChats.length, { timeout: 7000 }).toBe(2);
        await expect(page.locator('[data-route="chat"] .nav-unread-badge')).toHaveText('2', { timeout: 7000 });
        await expect(page.locator('[data-select-character="mock.png"] .unread-badge')).toHaveText('2');
        await expect(page.locator('[data-select-chat="watched-chat"] .unread-badge')).toHaveText('2');
    });

    test('selects the first available chat when refreshed list removes the selected chat', async ({ page }) => {
        const fixture = createChatFixture();
        const now = Date.now();
        fixture.chats = [
            { file_id: 'removed-chat', file_name: 'removed-chat.jsonl', chat_items: 2, file_size: '2 KB', last_mes: now + 2000 },
            { file_id: 'remaining-chat', file_name: 'remaining-chat.jsonl', chat_items: 1, file_size: '1 KB', last_mes: now + 1000 },
        ];
        fixture.messagesByChat = {
            'removed-chat': [
                { name: 'Modern User', is_user: true, mes: 'removed hello', send_date: now - 1000 },
                { name: 'Mock Character', is_user: false, mes: 'removed reply', send_date: now },
            ],
            'remaining-chat': [
                { name: 'Mock Character', is_user: false, mes: 'remaining reply', send_date: now },
            ],
        };
        await mockModernChatWorkspace(page, fixture);

        await page.goto('/modern/?view=chat');

        await expect(page.locator('[data-select-chat="removed-chat"]')).toBeVisible();
        await expect(page.locator('.chat-thread')).toContainText('removed reply');

        fixture.chats = fixture.chats.filter(chat => chat.file_id !== 'removed-chat');
        delete fixture.messagesByChat['removed-chat'];

        await page.locator('[data-refresh-chat-list]').click();

        await expect(page.locator('[data-select-chat="removed-chat"]')).toHaveCount(0);
        await expect(page.locator('[data-select-chat="remaining-chat"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('remaining reply');
    });

    test('does not reuse stale chat list when non-quiet refresh fails after delete', async ({ page }) => {
        const fixture = createChatFixture();
        const now = Date.now();
        fixture.chats = [
            { file_id: 'deleted-chat', file_name: 'deleted-chat.jsonl', chat_items: 2, file_size: '2 KB', last_mes: now + 2000 },
            { file_id: 'next-chat', file_name: 'next-chat.jsonl', chat_items: 1, file_size: '1 KB', last_mes: now + 1000 },
        ];
        fixture.messagesByChat = {
            'deleted-chat': [
                { name: 'Modern User', is_user: true, mes: 'deleted hello', send_date: now - 1000 },
                { name: 'Mock Character', is_user: false, mes: 'deleted reply', send_date: now },
            ],
            'next-chat': [
                { name: 'Mock Character', is_user: false, mes: 'next reply', send_date: now },
            ],
        };
        await mockModernChatWorkspace(page, fixture);

        await page.goto('/modern/?view=chat');

        await expect(page.locator('[data-select-chat="deleted-chat"]')).toBeVisible();
        await expect(page.locator('.chat-thread')).toContainText('deleted reply');
        await expect.poll(() => fixture.requests.characterChats.length).toBe(1);

        fixture.failCharacterChats = true;
        await page.locator('[data-delete-chat]').click();
        await page.locator('[data-confirm-chat-delete]').click();

        await expect.poll(() => fixture.requests.deletes.length).toBe(1);
        await expect.poll(() => fixture.requests.characterChats.filter(request => request.failed).length).toBe(1);
        await expect(page.locator('[data-select-chat="deleted-chat"]')).toHaveCount(0);
        await expect(page.locator('.chat-thread')).not.toContainText('deleted reply');
    });

    test('keeps cached chat list when quiet unread refresh fails', async ({ page }) => {
        const fixture = createChatFixture();
        await page.addInitScript('localStorage.setItem("st-modern-inspector-open", "true")');
        await mockModernChatWorkspace(page, fixture);

        await page.goto('/modern/?view=chat');

        await expect(page.locator('[data-select-chat="existing-chat"]')).toBeVisible();
        await expect(page.locator('#inspector')).toContainText('暂无错误。');

        fixture.failCharacterChats = true;
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await expect.poll(() => fixture.requests.characterChats.filter(request => request.failed).length).toBe(1);
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await expect.poll(() => fixture.requests.characterChats.filter(request => request.failed).length).toBe(2);

        await expect(page.locator('[data-select-chat="existing-chat"]')).toBeVisible();
        await expect(page.locator('#inspector')).toContainText('暂无错误。');
    });

    test('searches and clears character chat files inside the modern workspace', async ({ page }) => {
        const fixture = createChatFixture();
        const now = Date.now();
        fixture.chats.push({
            file_id: 'needle-chat',
            file_name: 'needle-chat.jsonl',
            chat_items: 2,
            file_size: '2 KB',
            last_mes: now + 1000,
        });
        fixture.messagesByChat['needle-chat'] = [
            { name: 'Modern User', is_user: true, mes: 'find this conversation', send_date: now },
            { name: 'Mock Character', is_user: false, mes: 'needle reply', send_date: now + 1000 },
        ];
        await mockModernChatWorkspace(page, fixture);

        await page.goto('/modern/?view=chat');

        await expect(page.locator('[data-select-chat="existing-chat"]')).toBeVisible();
        await expect(page.locator('[data-select-chat="needle-chat"]')).toBeVisible();

        await page.locator('[data-chat-search-input]').fill('needle');
        await page.locator('[data-chat-search-run]').click();

        await expect.poll(() => fixture.requests.searches.length).toBe(1);
        expect(fixture.requests.searches[0]).toMatchObject({
            query: 'needle',
            avatar_url: 'mock.png',
            group_id: null,
        });
        await expect(page.locator('[data-select-chat="needle-chat"]')).toBeVisible();
        await expect(page.locator('[data-select-chat="existing-chat"]')).toHaveCount(0);
        await expect(page.locator('.panel-subtitle').filter({ hasText: '搜索结果' })).toContainText('1 个搜索结果 / 2 个会话');

        await page.locator('[data-select-chat="needle-chat"]').click();
        await expect(page.locator('.chat-thread')).toContainText('needle reply');

        await page.locator('[data-chat-search-input]').fill('existing');
        await page.locator('[data-chat-search-input]').press('Enter');

        await expect.poll(() => fixture.requests.searches.length).toBe(2);
        expect(fixture.requests.searches[1]).toMatchObject({
            query: 'existing',
            avatar_url: 'mock.png',
            group_id: null,
        });
        await expect(page.locator('[data-select-chat="existing-chat"]')).toBeVisible();
        await expect(page.locator('[data-select-chat="needle-chat"]')).toHaveCount(0);

        await page.locator('[data-chat-search-clear]').click();
        await expect(page.locator('[data-select-chat="existing-chat"]')).toBeVisible();
        await expect(page.locator('[data-select-chat="needle-chat"]')).toBeVisible();
        await expect(page.locator('[data-chat-search-input]')).toHaveValue('');
    });

    test('edits and copies chat messages inside the modern workspace', async ({ page }) => {
        const fixture = await mockModernChatWorkspace(page);
        const clipboardWrites = [];
        await page.exposeFunction('recordModernClipboardWrite', value => {
            clipboardWrites.push(value);
        });
        await page.addInitScript(`
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: {
                    writeText: async value => {
                        window.recordModernClipboardWrite(value);
                    },
                },
            });
        `);

        await page.goto('/modern/?view=chat');

        await expect(page.locator('.chat-thread')).toContainText('hello');
        await page.locator('[data-delete-message="0"]').click();
        await expect(page.locator('.message-delete-panel')).toBeVisible();
        await page.locator('[data-edit-message="0"]').click();
        await expect(page.locator('[data-edit-message-input="0"]')).toHaveValue('hello');

        await page.locator('[data-edit-message-input="0"]').fill('edited hello from modern');
        await page.locator('[data-save-edit-message]').click();

        await expect.poll(() => fixture.requests.saves.length).toBe(1);
        const savedMessages = fixture.requests.saves[0].chat.filter(message => !message.chat_metadata);
        expect(savedMessages).toEqual([
            { name: 'Modern User', is_user: true, mes: 'edited hello from modern', send_date: expect.any(Number) },
            { name: 'Mock Character', is_user: false, mes: 'reply', send_date: expect.any(Number) },
        ]);
        await expect(page.locator('[data-edit-message-input="0"]')).toHaveCount(0);
        await expect(page.locator('.chat-thread')).toContainText('edited hello from modern');

        await page.locator('[data-copy-message="0"]').click();
        await expect.poll(() => clipboardWrites).toEqual(['edited hello from modern']);
        await expect(page.locator('.toast-stack')).toContainText('消息已复制');
    });

    test('renders roleplay emphasis markers as plain text in the modern workspace', async ({ page }) => {
        const fixture = await mockModernChatWorkspace(page);
        fixture.messagesByChat['existing-chat'][1] = {
            ...fixture.messagesByChat['existing-chat'][1],
            mes: '*gentle action* "plain dialogue" _quiet thought_',
        };

        await page.goto('/modern/?view=chat');

        const characterMessage = page.locator('.message').nth(1);
        await expect(characterMessage.locator('.message-body')).toContainText('gentle action "plain dialogue" quiet thought');
        await expect(characterMessage.locator('.message-body em')).toHaveCount(0);
    });

    test('sanitizes unsafe markup and renders code blocks in the modern workspace', async ({ page }) => {
        const fixture = await mockModernChatWorkspace(page);
        fixture.messagesByChat['existing-chat'][1] = {
            ...fixture.messagesByChat['existing-chat'][1],
            mes: 'Danger <script>window.__modernXss = 1;</script> <img src="x" onerror="window.__modernXss = 1"> [evil](javascript:alert(1)) **bold survives**\n\n```js\nconst code = 1;\n```',
        };

        await page.goto('/modern/?view=chat');

        const messageBody = page.locator('.message').nth(1).locator('.message-body');
        await expect(messageBody.locator('script')).toHaveCount(0);
        await expect(messageBody.locator('img[onerror]')).toHaveCount(0);
        await expect(messageBody.locator('a[href^="javascript:"]')).toHaveCount(0);
        await expect(messageBody.locator('strong')).toContainText('bold survives');
        await expect(messageBody.locator('pre code')).toContainText('const code = 1;');
        expect(await page.evaluate(() => window.__modernXss)).toBeUndefined();
    });

    test('collapses the first character message as an opening message', async ({ page }) => {
        const fixture = await mockModernChatWorkspace(page);
        const longOpeningMessage = Array.from({ length: 14 }, (_, index) => `Opening scene sentence ${index + 1} keeps enough character greeting text to span multiple visible lines.`).join(' ');
        fixture.messagesByChat['existing-chat'] = [
            { name: fixture.character.name, is_user: false, mes: longOpeningMessage, send_date: Date.now() - 2000 },
            { name: 'Modern User', is_user: true, mes: 'hello after opening', send_date: Date.now() - 1000 },
            { name: fixture.character.name, is_user: false, mes: 'normal character reply should stay plain', send_date: Date.now() },
        ];

        await page.setViewportSize({ width: 1600, height: 900 });
        await page.goto('/modern/?view=chat');

        const openingMessage = page.locator('.message-opening');
        const openingBody = openingMessage.locator('.message-body');
        await expect(openingMessage).toHaveCount(1);
        await expect(openingMessage.locator('.message-opening-title')).toHaveText('开场消息');
        await expect(openingBody).toContainText('Opening scene sentence 1');
        await expect(openingMessage.locator('.message-opening-expand')).toBeVisible();
        await expect(openingMessage.locator('.message-opening-collapse')).toBeHidden();
        await expect.poll(() => openingBody.evaluate(element => element.ownerDocument.defaultView.getComputedStyle(element).webkitLineClamp)).toBe('5');
        const collapsedBox = await openingBody.boundingBox();

        await openingMessage.locator('[data-toggle-opening-message]').click();

        await expect(openingMessage.locator('[data-opening-message-toggle]')).toBeChecked();
        await expect(openingMessage.locator('.message-opening-collapse')).toBeVisible();
        await expect.poll(() => openingBody.evaluate(element => element.ownerDocument.defaultView.getComputedStyle(element).webkitLineClamp)).toBe('none');
        const expandedBox = await openingBody.boundingBox();
        expect(expandedBox?.height).toBeGreaterThan(collapsedBox?.height || 0);
        await expect(page.locator('.message').last().locator('.message-opening')).toHaveCount(0);
    });

    test('uses bridge controls to regenerate, continue, and switch response candidates', async ({ page }) => {
        const fixture = await mockModernChatWorkspace(page);
        fixture.messagesByChat['existing-chat'][1] = {
            ...fixture.messagesByChat['existing-chat'][1],
            swipes: ['reply', 'alternate bridge reply'],
            swipe_id: 0,
        };
        await mockLegacyGenerationBridge(page, fixture);

        await page.goto('/modern/?view=chat');

        await expect(page.locator('.message-foot')).toContainText('候选 1/2');
        await page.locator('[data-swipe-message="1"][data-swipe-direction="right"]').click();
        await expect.poll(() => fixture.requests.bridge.at(-1)).toMatchObject({
            action: 'swipe',
            payload: {
                avatar: 'mock.png',
                chat: 'existing-chat',
                messageIndex: 1,
                direction: 'right',
            },
        });
        await expect(page.locator('.chat-thread')).toContainText('alternate bridge reply');
        await expect(page.locator('.message-foot')).toContainText('候选 2/2');

        await page.locator('[data-regenerate-message]').click();
        await expect.poll(() => fixture.requests.bridge.at(-1)).toMatchObject({
            action: 'generate',
            payload: {
                chat: 'existing-chat',
                type: 'regenerate',
            },
        });
        await expect(page.locator('.chat-thread')).toContainText('regenerated bridge reply');

        await page.locator('[data-continue-message]').click();
        await expect.poll(() => fixture.requests.bridge.at(-1)).toMatchObject({
            action: 'generate',
            payload: {
                chat: 'existing-chat',
                type: 'continue',
            },
        });
        await expect(page.locator('.chat-thread')).toContainText('regenerated bridge reply continued by bridge');
    });

    test('sends a message through the modern generation bridge', async ({ page }) => {
        const fixture = await mockModernChatWorkspace(page);
        const bridgeResponse = createDeferred();
        await mockLegacyGenerationBridge(page, fixture, { beforeGenerateResponse: () => bridgeResponse.promise });

        await page.goto('/modern/?view=chat');

        await expect(page.locator('[data-select-chat="existing-chat"]')).toBeVisible();
        await page.locator('[data-chat-input]').fill('hello bridge generation');
        await page.locator('[data-send-message]').click();

        await expect.poll(() => fixture.requests.bridge.map(request => request.action)).toContain('generate');
        expect(fixture.requests.bridge.at(-1)).toMatchObject({
            action: 'generate',
            payload: {
                avatar: 'mock.png',
                chat: 'existing-chat',
                type: 'normal',
                message: 'hello bridge generation',
            },
        });
        await expect(page.locator('.message.user').last()).toContainText('hello bridge generation');
        await expect(page.locator('.chat-thread')).not.toContainText('generated reply to hello bridge generation');
        bridgeResponse.resolve();
        await expect(page.locator('.chat-thread')).toContainText('generated reply to hello bridge generation');
        await expect(page.locator('[data-chat-input]')).toHaveValue('');
        await expect(page.locator('[data-send-message]')).toBeDisabled();
        await expect(page.locator('[data-composer-status]')).toContainText('空消息不会提交');
    });

    test('keeps a newly selected group context when a character generation finishes', async ({ page }) => {
        const fixture = createChatFixture();
        const now = Date.now();
        fixture.groups = [{ id: 'group-alpha', name: 'Mock Group', members: ['mock.png'], chats: ['group-chat'], chat_id: 'group-chat' }];
        fixture.groupChats = [{ file_id: 'group-chat', file_name: 'group-chat.jsonl', chat_items: 2, file_size: '2 KB', last_mes: now }];
        fixture.messagesByChat['group-chat'] = [
            { name: 'Modern User', is_user: true, mes: 'group hello', send_date: now - 1000 },
            { name: 'Mock Group', is_user: false, mes: 'group reply stays visible', send_date: now },
        ];
        const bridgeResponse = createDeferred();
        await mockModernChatWorkspace(page, fixture);
        await mockLegacyGenerationBridge(page, fixture, { beforeGenerateResponse: () => bridgeResponse.promise });

        await page.goto('/modern/?view=chat');
        await page.locator('[data-chat-input]').fill('character reply must stay in its original context');
        await page.locator('[data-send-message]').click();
        await expect.poll(() => fixture.requests.bridge.at(-1)?.action).toBe('generate');

        await page.locator('[data-chat-mode="group"]').click();
        await expect(page.locator('[data-select-chat="group-chat"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('group reply stays visible');

        bridgeResponse.resolve();
        await expect(page.locator('[data-stop-generation]')).toHaveCount(0);
        await expect(page.locator('[data-chat-mode="group"]')).toHaveClass(/active/);
        await expect(page.locator('[data-select-chat="group-chat"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('group reply stays visible');
        await expect(page.locator('.chat-thread')).not.toContainText('generated reply to character reply must stay in its original context');
    });

    test('keeps a newly selected group context when a character swipe finishes', async ({ page }) => {
        const fixture = createChatFixture();
        const now = Date.now();
        fixture.messagesByChat['existing-chat'][1] = {
            ...fixture.messagesByChat['existing-chat'][1],
            swipes: ['reply', 'alternate character reply'],
            swipe_id: 0,
        };
        fixture.groups = [{ id: 'group-alpha', name: 'Mock Group', members: ['mock.png'], chats: ['group-chat'], chat_id: 'group-chat' }];
        fixture.groupChats = [{ file_id: 'group-chat', file_name: 'group-chat.jsonl', chat_items: 2, file_size: '2 KB', last_mes: now }];
        fixture.messagesByChat['group-chat'] = [
            { name: 'Modern User', is_user: true, mes: 'group hello', send_date: now - 1000 },
            { name: 'Mock Group', is_user: false, mes: 'group reply stays visible', send_date: now },
        ];
        const bridgeResponse = createDeferred();
        await mockModernChatWorkspace(page, fixture);
        await mockLegacyGenerationBridge(page, fixture, { beforeSwipeResponse: () => bridgeResponse.promise });

        await page.goto('/modern/?view=chat');
        await page.locator('[data-swipe-message="1"][data-swipe-direction="right"]').click();
        await expect.poll(() => fixture.requests.bridge.at(-1)?.action).toBe('swipe');

        await page.locator('[data-chat-mode="group"]').click();
        await expect(page.locator('[data-select-chat="group-chat"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('group reply stays visible');

        bridgeResponse.resolve();
        await expect(page.locator('[data-stop-generation]')).toHaveCount(0);
        await expect(page.locator('[data-chat-mode="group"]')).toHaveClass(/active/);
        await expect(page.locator('[data-select-chat="group-chat"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('group reply stays visible');
        await expect(page.locator('.chat-thread')).not.toContainText('alternate character reply');
    });

    test('does not mark the generated chat read when another chat is selected during message reload', async ({ page }) => {
        const fixture = createChatFixture();
        fixture.chats.push({
            file_id: 'other-chat',
            file_name: 'other-chat.jsonl',
            chat_items: 2,
            file_size: '1 KB',
            last_mes: Date.now() - 10_000,
        });
        fixture.messagesByChat['other-chat'] = [
            { name: 'Modern User', is_user: true, mes: 'other hello', send_date: Date.now() - 11_000 },
            { name: 'Mock Character', is_user: false, mes: 'other reply stays visible', send_date: Date.now() - 10_000 },
        ];
        const chatResponseGate = createDeferred();
        let blockGeneratedChat = false;
        let generatedChatLoadStarted = false;
        await mockModernChatWorkspace(page, fixture, {
            beforeChatResponse: payload => {
                if (blockGeneratedChat && !generatedChatLoadStarted && stripJsonlExtension(payload.file_name) === 'existing-chat') {
                    generatedChatLoadStarted = true;
                    return chatResponseGate.promise;
                }
            },
        });
        await mockLegacyGenerationBridge(page, fixture);

        await page.goto('/modern/?view=chat');
        await expect(page.locator('[data-chat-input]')).toBeVisible();
        blockGeneratedChat = true;
        await page.locator('[data-chat-input]').fill('generated reply should remain unread after switching chats');
        await page.locator('[data-send-message]').click();
        await expect.poll(() => generatedChatLoadStarted).toBe(true);

        await page.locator('[data-select-chat="other-chat"]').click();
        await expect(page.locator('[data-select-chat="other-chat"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('other reply stays visible');

        chatResponseGate.resolve();
        await expect(page.locator('[data-stop-generation]')).toHaveCount(0);
        const readState = await page.evaluate(() => JSON.parse(localStorage.getItem('st-modern-chat-read-state:v1') || '{}'));
        expect(readState.cursors['mock.png::existing-chat']).toMatchObject({ messageCount: 2 });
        await expect(page.locator('[data-select-chat="other-chat"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('other reply stays visible');
    });

    test('does not write generated chat read state into a new mode during message reload', async ({ page }) => {
        const fixture = createChatFixture();
        const now = Date.now();
        fixture.groups = [{ id: 'group-alpha', name: 'Mock Group', members: ['mock.png'], chats: ['group-chat'], chat_id: 'group-chat' }];
        fixture.groupChats = [{ file_id: 'group-chat', file_name: 'group-chat.jsonl', chat_items: 2, file_size: '2 KB', last_mes: now }];
        fixture.messagesByChat['group-chat'] = [
            { name: 'Modern User', is_user: true, mes: 'group hello', send_date: now - 1000 },
            { name: 'Mock Group', is_user: false, mes: 'group reply stays visible', send_date: now },
        ];
        const chatResponseGate = createDeferred();
        let blockGeneratedChat = false;
        let generatedChatLoadStarted = false;
        await mockModernChatWorkspace(page, fixture, {
            beforeChatResponse: payload => {
                if (blockGeneratedChat && !generatedChatLoadStarted && stripJsonlExtension(payload.file_name) === 'existing-chat') {
                    generatedChatLoadStarted = true;
                    return chatResponseGate.promise;
                }
            },
        });
        await mockLegacyGenerationBridge(page, fixture);

        await page.goto('/modern/?view=chat');
        await expect(page.locator('[data-chat-input]')).toBeVisible();
        blockGeneratedChat = true;
        await page.locator('[data-chat-input]').fill('generated reply must keep its original read context');
        await page.locator('[data-send-message]').click();
        await expect.poll(() => generatedChatLoadStarted).toBe(true);

        await page.locator('[data-chat-mode="group"]').click();
        await expect(page.locator('[data-select-chat="group-chat"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('group reply stays visible');

        chatResponseGate.resolve();
        await expect(page.locator('[data-stop-generation]')).toHaveCount(0);
        const readState = await page.evaluate(() => JSON.parse(localStorage.getItem('st-modern-chat-read-state:v1') || '{}'));
        expect(readState.cursors['mock.png::existing-chat']).toMatchObject({ messageCount: 2 });
        expect(readState.cursors['group:::existing-chat']).toBeUndefined();
        expect(readState.contexts['group:']).toBeUndefined();
        await expect(page.locator('[data-select-chat="group-chat"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('group reply stays visible');
    });

    test('sends a message with the composer keyboard shortcut', async ({ page }) => {
        const fixture = await mockModernChatWorkspace(page);
        await mockLegacyGenerationBridge(page, fixture);

        await page.goto('/modern/?view=chat');

        await page.locator('[data-chat-input]').fill('keyboard bridge generation');
        await page.locator('[data-chat-input]').press('Control+Enter');

        await expect.poll(() => fixture.requests.bridge.map(request => request.action)).toContain('generate');
        expect(fixture.requests.bridge.at(-1)).toMatchObject({
            action: 'generate',
            payload: {
                avatar: 'mock.png',
                chat: 'existing-chat',
                type: 'normal',
                message: 'keyboard bridge generation',
            },
        });
        await expect(page.locator('.chat-thread')).toContainText('keyboard bridge generation');
        await expect(page.locator('.chat-thread')).toContainText('generated reply to keyboard bridge generation');
    });

    test('keeps the composer compact when a chat has no messages', async ({ page }) => {
        const fixture = createChatFixture();
        const now = Date.now();
        fixture.chats = [
            { file_id: 'empty-chat', file_name: 'empty-chat.jsonl', chat_items: 0, file_size: '0 B', last_mes: now },
        ];
        fixture.messagesByChat = {
            'empty-chat': [],
        };
        await mockModernChatWorkspace(page, fixture);

        await page.setViewportSize({ width: 2048, height: 1049 });
        await page.goto('/modern/?view=chat');

        await expect(page.locator('.empty-state')).toBeVisible();
        await expect(page.locator('[data-chat-input]')).toBeVisible();
        const detailHeroBox = await page.locator('.detail-hero').boundingBox();
        const composerBox = await page.locator('.composer').boundingBox();
        expect(detailHeroBox?.height).toBeLessThan(160);
        expect(composerBox?.height).toBeLessThan(180);
    });

    test('manages group chat files through group endpoints', async ({ page }) => {
        const fixture = createChatFixture();
        const now = Date.now();
        fixture.groups = [{
            id: 'group-alpha',
            name: 'Mock Group',
            members: ['mock.png'],
            chats: ['group-chat'],
            chat_id: 'group-chat',
        }];
        fixture.groupChats = [
            { file_id: 'group-chat', file_name: 'group-chat.jsonl', chat_items: 2, file_size: '3 KB', last_mes: now },
        ];
        fixture.messagesByChat['group-chat'] = [
            { name: 'Modern User', is_user: true, mes: 'group hello', send_date: now - 1000 },
            { name: 'Mock Group', is_user: false, mes: 'group reply', send_date: now },
        ];
        await mockModernChatWorkspace(page, fixture);

        await page.goto('/modern/?view=chat');
        await page.locator('[data-chat-mode="group"]').click();

        await expect(page.locator('.detail-title')).toHaveText('Mock Group');
        await expect(page.locator('[data-select-chat="group-chat"]')).toBeVisible();
        await expect(page.locator('.chat-thread')).toContainText('group reply');

        await page.locator('[data-delete-chat]').click();
        const jsonlDownloadPromise = page.waitForEvent('download');
        await page.locator('[data-export-chat="jsonl"]').click();
        const jsonlDownload = await jsonlDownloadPromise;
        expect(jsonlDownload.suggestedFilename()).toBe('group-chat.jsonl');
        expect(fixture.requests.exports[0]).toMatchObject({
            is_group: true,
            avatar_url: null,
            file: 'group-chat.jsonl',
            exportfilename: 'group-chat.jsonl',
            format: 'jsonl',
        });

        await page.locator('[data-confirm-chat-delete]').click();
        await expect.poll(() => fixture.requests.groupDeletes.length).toBe(1);
        expect(fixture.requests.groupDeletes[0]).toEqual({ id: 'group-chat' });
        await expect.poll(() => fixture.requests.groupEdits.length).toBe(1);
        expect(fixture.requests.groupEdits[0]).toMatchObject({
            id: 'group-alpha',
            chats: [],
            chat_id: '',
        });
        await expect(page.locator('[data-select-chat="group-chat"]')).toHaveCount(0);

        await page.locator('[data-chat-import-file]').setInputFiles({
            name: 'imported-group-chat.jsonl',
            mimeType: 'application/jsonl',
            buffer: Buffer.from(JSON.stringify({ name: 'Modern User', mes: 'Imported group hello' })),
        });

        await expect.poll(() => fixture.requests.groupImports.length).toBe(1);
        expect(fixture.requests.groupImports[0]).toMatchObject({
            fileName: 'imported-group-chat.jsonl',
            fileType: 'jsonl',
            avatarUrl: '',
            userName: 'Modern User',
            characterName: 'Mock Group',
        });
        await expect.poll(() => fixture.requests.groupEdits.length).toBe(2);
        expect(fixture.requests.groupEdits[1]).toMatchObject({
            id: 'group-alpha',
            chats: ['imported-group-chat'],
            chat_id: 'imported-group-chat',
        });
        await expect(page.locator('[data-select-chat="imported-group-chat"]')).toBeVisible();
        await expect(page.locator('.chat-thread')).toContainText('imported imported-group-chat');
    });

    test('manages character chat files and backups inside the modern workspace', async ({ page }) => {
        const fixture = await mockModernChatWorkspace(page);

        await page.goto('/modern/?view=chat');

        await expect(page.locator('.page-title')).toHaveText('聊天工作区');
        await expect(page.locator('[data-select-chat="existing-chat"]')).toBeVisible();
        await expect(page.locator('.detail-title')).toHaveText('Mock Character');
        await expect(page.locator('[data-send-message]')).toBeDisabled();
        await expect(page.locator('[data-composer-status]')).toContainText('空消息不会提交');

        await page.locator('[data-chat-input]').fill('hello modern composer');
        await expect(page.locator('[data-send-message]')).toBeEnabled();
        await expect(page.locator('[data-composer-status]')).toContainText('准备发送');
        await page.locator('[data-chat-input]').fill('');
        await expect(page.locator('[data-send-message]')).toBeDisabled();

        await page.locator('[data-new-chat]').click();
        await expect.poll(() => fixture.requests.saves.length).toBe(1);
        const createdChatId = fixture.requests.saves[0].file_name;
        await expect(page.locator('[data-select-chat]').filter({ hasText: chatFileName(createdChatId) })).toBeVisible();

        await page.locator('[data-delete-chat]').click();
        await expect(page.locator('.chat-manage-panel', { hasText: '聊天文件管理' })).toBeVisible();
        await page.locator('[data-rename-chat]').click();
        await page.locator('[data-chat-rename-input]').fill('renamed-modern-chat');
        await page.locator('[data-save-chat-rename]').click();

        await expect.poll(() => fixture.requests.renames.length).toBe(1);
        expect(fixture.requests.renames[0]).toMatchObject({
            avatar_url: 'mock.png',
            original_file: chatFileName(createdChatId),
            renamed_file: 'renamed-modern-chat.jsonl',
            is_group: false,
        });
        await expect(page.locator('[data-select-chat="renamed-modern-chat"]')).toBeVisible();

        await page.locator('[data-delete-chat]').click();
        const txtDownloadPromise = page.waitForEvent('download');
        await page.locator('[data-export-chat="txt"]').click();
        const txtDownload = await txtDownloadPromise;
        expect(txtDownload.suggestedFilename()).toBe('renamed-modern-chat.txt');
        expect(fixture.requests.exports[0]).toMatchObject({
            is_group: false,
            avatar_url: 'mock.png',
            file: 'renamed-modern-chat.jsonl',
            exportfilename: 'renamed-modern-chat.txt',
            format: 'txt',
        });

        const jsonlDownloadPromise = page.waitForEvent('download');
        await page.locator('[data-export-chat="jsonl"]').click();
        const jsonlDownload = await jsonlDownloadPromise;
        expect(jsonlDownload.suggestedFilename()).toBe('renamed-modern-chat.jsonl');
        expect(fixture.requests.exports[1]).toMatchObject({
            file: 'renamed-modern-chat.jsonl',
            exportfilename: 'renamed-modern-chat.jsonl',
            format: 'jsonl',
        });

        await expect(page.locator('.chat-manage-panel', { hasText: 'renamed-modern-chat.jsonl' })).toBeVisible();
        await page.locator('[data-cancel-chat-delete]').click();
        await expect(page.locator('.chat-manage-panel', { hasText: 'renamed-modern-chat.jsonl' })).toHaveCount(0);
        expect(fixture.requests.deletes).toHaveLength(0);

        await page.locator('[data-delete-chat]').click();
        await page.locator('[data-confirm-chat-delete]').click();
        await expect.poll(() => fixture.requests.deletes.length).toBe(1);
        expect(fixture.requests.deletes[0]).toMatchObject({
            avatar_url: 'mock.png',
            chatfile: 'renamed-modern-chat.jsonl',
        });
        await expect(page.locator('[data-select-chat="renamed-modern-chat"]')).toHaveCount(0);

        await page.locator('[data-chat-import-file]').setInputFiles({
            name: 'imported-modern-chat.jsonl',
            mimeType: 'application/jsonl',
            buffer: Buffer.from(JSON.stringify({ name: 'Modern User', mes: 'Imported hello' })),
        });

        await expect.poll(() => fixture.requests.imports.length).toBe(1);
        expect(fixture.requests.imports[0]).toMatchObject({
            fileName: 'imported-modern-chat.jsonl',
            fileType: 'jsonl',
            avatarUrl: 'mock.png',
            userName: 'Modern User',
            characterName: 'Mock Character',
        });
        expect(fixture.requests.imports[0].contentType).toContain('multipart/form-data');
        await expect(page.locator('[data-select-chat="imported-modern-chat"]')).toBeVisible();
        await expect(page.locator('.message')).toContainText('imported imported-modern-chat');

        await page.locator('[data-chat-backups-toggle]').click();
        await expect(page.locator('.chat-tool-panel')).toBeVisible();
        await expect(page.locator('.backup-row', { hasText: 'backup-chat.jsonl' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.chat-tool-panel')).toHaveCount(0);

        await page.locator('[data-chat-backups-toggle]').click();
        await expect(page.locator('.chat-tool-panel')).toBeVisible();
        await expect(page.locator('.backup-row', { hasText: 'backup-chat.jsonl' })).toBeVisible();

        await page.locator('[data-view-chat-backup="backup-chat.jsonl"]').click();
        await expect.poll(() => fixture.requests.backupDownloads.length).toBe(1);
        await expect(page.locator('.backup-preview textarea')).toContainText('backup reply');

        await page.locator('[data-restore-chat-backup="backup-chat.jsonl"]').click();
        await expect.poll(() => fixture.requests.imports.length).toBe(2);
        expect(fixture.requests.backupDownloads).toHaveLength(2);
        expect(fixture.requests.imports[1]).toMatchObject({
            fileName: 'backup-chat.jsonl',
            fileType: 'jsonl',
            avatarUrl: 'mock.png',
        });
        await expect(page.locator('[data-select-chat="backup-chat"]')).toBeVisible();

        await page.locator('[data-delete-chat-backup="backup-chat.jsonl"]').click();
        await page.locator('[data-confirm-chat-backup-delete]').click();
        await expect.poll(() => fixture.requests.backupDeletes.length).toBe(1);
        expect(fixture.requests.backupDeletes[0]).toEqual({ name: 'backup-chat.jsonl' });
        await expect(page.locator('.backup-row', { hasText: 'backup-chat.jsonl' })).toHaveCount(0);
    });
});
