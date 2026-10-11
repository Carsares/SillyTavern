import { test, expect } from '@playwright/test';

/* global localStorage */

function stripJsonlExtension(value) {
    return String(value || '').replace(/\.jsonl$/i, '');
}

function fulfillJson(route, body, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function chatItem(chatId, messages, lastMes) {
    return { file_id: chatId, file_name: `${chatId}.jsonl`, chat_items: messages.length, file_size: '1 KB', last_mes: lastMes };
}

function createFixture() {
    const now = Date.now();
    const messagesByChat = {
        'mock-newest': [
            { name: 'Modern User', is_user: true, mes: 'mock newest context', send_date: now - 6000 },
            { name: 'Mock Character', is_user: false, mes: 'mock newest reply', send_date: now - 5000 },
        ],
        'mock-used': [
            { name: 'Modern User', is_user: true, mes: 'mock used context', send_date: now - 8000 },
            { name: 'Mock Character', is_user: false, mes: 'mock used reply', send_date: now - 7000 },
        ],
        'second-newest': [
            { name: 'Modern User', is_user: true, mes: 'second newest context', send_date: now - 4000 },
            { name: 'Second Character', is_user: false, mes: 'second newest reply', send_date: now - 3000 },
        ],
        'second-older': [
            { name: 'Modern User', is_user: true, mes: 'second older context', send_date: now - 9000 },
            { name: 'Second Character', is_user: false, mes: 'second older reply', send_date: now - 8500 },
        ],
        'group-newest': [
            { name: 'Modern User', is_user: true, mes: 'group newest context', send_date: now - 2000 },
            { name: 'Mock Character', is_user: false, mes: 'group newest reply', send_date: now - 1000 },
        ],
        'group-older': [
            { name: 'Modern User', is_user: true, mes: 'group older context', send_date: now - 9500 },
            { name: 'Second Character', is_user: false, mes: 'group older reply', send_date: now - 9000 },
        ],
    };
    return {
        characters: [
            { avatar: 'mock.png', name: 'Mock Character', data: { name: 'Mock Character', first_mes: 'Hello from mock.', creator: 'Modern E2E' } },
            { avatar: 'second.png', name: 'Second Character', data: { name: 'Second Character', first_mes: 'Hello from second.', creator: 'Modern E2E' } },
        ],
        groups: [{
            id: 'group-alpha',
            name: 'Alpha Group',
            avatar_url: '',
            members: ['mock.png', 'second.png'],
            disabled_members: [],
            chats: ['group-newest', 'group-older'],
            chat_id: 'group-newest',
            activation_strategy: 0,
            generation_mode: 0,
        }],
        chatsByContext: {
            'mock.png': ['mock-newest', 'mock-used'],
            'second.png': ['second-newest', 'second-older'],
            'group:group-alpha': ['group-newest', 'group-older'],
        },
        lastMes: {
            'mock-newest': now - 5000,
            'mock-used': now - 7000,
            'second-newest': now - 3000,
            'second-older': now - 8500,
            'group-newest': now - 1000,
            'group-older': now - 9000,
        },
        messagesByChat,
        bridge: [],
    };
}

function listChats(fixture, contextKey) {
    return (fixture.chatsByContext[contextKey] || []).map(chatId => chatItem(chatId, fixture.messagesByChat[chatId] || [], fixture.lastMes[chatId]));
}

function chatResponse(fixture, chatId) {
    return [
        { chat_metadata: {}, user_name: 'Modern User', character_name: 'unused' },
        ...(fixture.messagesByChat[stripJsonlExtension(chatId)] || []),
    ];
}

async function mockChatWorkspace(page, fixture) {
    await page.route('**/csrf-token', route => fulfillJson(route, { token: 'modern-chat-stop-token' }));
    await page.route('**/api/users/me', route => fulfillJson(route, { name: 'Modern User', handle: 'modern-user' }));
    await page.route('**/api/settings/get', route => fulfillJson(route, {
        settings: JSON.stringify({ name1: 'Modern User' }),
        openai_setting_names: [],
        openai_settings: [],
        textgenerationwebui_preset_names: [],
        textgenerationwebui_presets: [],
    }));
    await page.route('**/api/characters/all', route => fulfillJson(route, fixture.characters));
    await page.route('**/api/groups/all', route => fulfillJson(route, fixture.groups));
    await page.route('**/api/worldinfo/list', route => fulfillJson(route, []));
    await page.route('**/api/backgrounds/all', route => fulfillJson(route, { images: [] }));
    await page.route('**/api/backgrounds/folders', route => fulfillJson(route, { folders: [], imageFolderMap: {} }));
    await page.route('**/api/assets/get', route => fulfillJson(route, {}));
    await page.route('**/api/extensions/discover', route => fulfillJson(route, []));
    await page.route('**/api/secrets/settings', route => fulfillJson(route, { allowKeysExposure: false }));
    await page.route('**/api/secrets/read', route => fulfillJson(route, {}));
    await page.route('**/api/stats/get', route => fulfillJson(route, {}));
    await page.route('**/api/backups/chat/get', route => fulfillJson(route, []));
    await page.route('**/api/characters/chats', route => fulfillJson(route, listChats(fixture, route.request().postDataJSON()?.avatar_url)));
    await page.route('**/api/chats/search', route => {
        const payload = route.request().postDataJSON();
        return fulfillJson(route, listChats(fixture, payload.group_id ? `group:${payload.group_id}` : payload.avatar_url));
    });
    await page.route('**/api/chats/get', route => fulfillJson(route, chatResponse(fixture, route.request().postDataJSON()?.file_name)));
    await page.route('**/api/chats/group/get', route => fulfillJson(route, chatResponse(fixture, route.request().postDataJSON()?.id)));
    await page.route('**/api/chats/save', route => {
        const payload = route.request().postDataJSON();
        fixture.messagesByChat[stripJsonlExtension(payload.file_name)] = payload.chat.filter(message => !message.chat_metadata);
        return fulfillJson(route, { ok: true });
    });
}

// The hidden engine frame is replaced by a stub that forwards each bridge request to `respond`.
async function mockBridge(page, fixture, respond) {
    await page.route(/.*\?modernBridge=1$/u, route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html>
            <html>
                <body>
                    <script>
                        window.addEventListener('message', async event => {
                            const message = event.data || {};
                            if (message.source !== 'sillytavern-modern-bridge' || !message.action) return;
                            const response = await fetch('/modern-test-bridge', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ action: message.action, payload: message.payload }),
                            });
                            parent.postMessage({ source: 'sillytavern-modern-bridge', id: message.id, result: await response.json() }, event.origin);
                        });
                    </script>
                </body>
            </html>`,
    }));
    await page.route('**/modern-test-bridge', async route => {
        const request = route.request().postDataJSON();
        fixture.bridge.push(request);
        return fulfillJson(route, await respond(request) ?? { ok: true });
    });
}

// A generate request that only answers once the composer's stop button reaches the engine, like a slow model.
function stopAwareBridge(fixture, onStop) {
    let releaseGenerate = () => {};
    const stopped = new Promise(resolve => {
        releaseGenerate = resolve;
    });
    return async request => {
        if (request.action === 'stop') {
            releaseGenerate();
            return { stopped: true };
        }
        if (request.action === 'generate') {
            await stopped;
            const chatId = stripJsonlExtension(request.payload.chat);
            return { chat: `${chatId}.jsonl`, messageCount: fixture.messagesByChat[chatId].length, saved: true, type: 'normal', stopped: true, ...onStop(chatId, request.payload) };
        }
        if (request.action === 'status') {
            return { chat: request.payload.chat, messageCount: 0 };
        }
        return { ok: true };
    };
}

async function sendAndStop(page, message) {
    await page.locator('[data-chat-input]').fill(message);
    await page.locator('[data-send-message]').click();
    await page.locator('[data-stop-generation]').click();
}

function urlParams(page) {
    return Object.fromEntries(new URL(page.url()).searchParams);
}

test.describe('Modern chat stop feedback', () => {
    // UX-009: stopping used to report「消息已生成」and left an assistant message with an empty `mes` in the chat file
    test('reports a stopped reply instead of a finished one and shows no empty message', async ({ page }) => {
        const fixture = createFixture();
        await mockChatWorkspace(page, fixture);
        await mockBridge(page, fixture, stopAwareBridge(fixture, (chatId, payload) => {
            // The engine drops the reply that had no visible text yet and saves only the user message
            fixture.messagesByChat[chatId].push({ name: 'Modern User', is_user: true, mes: payload.message, send_date: Date.now() });
            return { started: true, keptReplyChars: 0, removedEmptyReply: true };
        }));

        await page.goto('/modern/?view=chat');
        await expect(page.locator('.chat-thread')).toContainText('mock newest reply');
        await sendAndStop(page, 'please stop now');

        await expect(page.locator('.toast-stack')).toContainText('已停止生成');
        await expect(page.locator('.toast-stack')).toContainText('回复还没有可见内容，没有保存空消息。');
        await expect(page.locator('.toast-stack')).not.toContainText('消息已生成');
        await expect(page.locator('.chat-thread')).toContainText('please stop now');
        await expect(page.locator('.chat-thread .message', { hasText: '[空消息]' })).toHaveCount(0);
        await expect(page.locator('[data-stop-generation]')).toHaveCount(0);
        expect(fixture.bridge.map(request => request.action)).toEqual(['generate', 'stop']);
    });

    test('tells how much of a stopped reply was kept', async ({ page }) => {
        const fixture = createFixture();
        await mockChatWorkspace(page, fixture);
        await mockBridge(page, fixture, stopAwareBridge(fixture, (chatId, payload) => {
            fixture.messagesByChat[chatId].push(
                { name: 'Modern User', is_user: true, mes: payload.message, send_date: Date.now() - 10 },
                { name: 'Mock Character', is_user: false, mes: 'Partial', send_date: Date.now() },
            );
            return { started: true, keptReplyChars: 7, removedEmptyReply: false };
        }));

        await page.goto('/modern/?view=chat');
        await expect(page.locator('.chat-thread')).toContainText('mock newest reply');
        await sendAndStop(page, 'keep what you have');

        await expect(page.locator('.toast-stack')).toContainText('已保留 7 字的部分回复。');
        await expect(page.locator('.chat-thread')).toContainText('Partial');
    });

    test('gives the draft back when the stop lands before the engine starts', async ({ page }) => {
        const fixture = createFixture();
        await mockChatWorkspace(page, fixture);
        await mockBridge(page, fixture, stopAwareBridge(fixture, () => ({ started: false, keptReplyChars: 0, removedEmptyReply: false })));

        await page.goto('/modern/?view=chat');
        await expect(page.locator('.chat-thread')).toContainText('mock newest reply');
        await sendAndStop(page, 'not sent yet');

        await expect(page.locator('.toast-stack')).toContainText('生成尚未开始，聊天文件没有变化。');
        await expect(page.locator('[data-chat-input]')).toHaveValue('not sent yet');
        await expect(page.locator('.chat-thread .message', { hasText: 'not sent yet' })).toHaveCount(0);
    });
});

test.describe('Modern chat URL selection', () => {
    // UX-018: the URL only held ?view=chat, so a reload opened the first character instead of the chat in use
    test('restores the selected character chat after a reload', async ({ page }) => {
        const fixture = createFixture();
        await mockChatWorkspace(page, fixture);

        await page.goto('/modern/?view=chat&keep=1');
        await expect(page.locator('.detail-title')).toHaveText('Mock Character');
        await page.locator('[data-select-character="second.png"]').click();
        await page.locator('[data-select-chat="second-older"]').click();
        await expect(page.locator('.chat-thread')).toContainText('second older reply');
        await expect.poll(() => urlParams(page)).toEqual({ view: 'chat', keep: '1', char: 'second.png', chat: 'second-older' });

        await page.reload();

        await expect(page.locator('.detail-title')).toHaveText('Second Character');
        await expect(page.locator('[data-select-chat="second-older"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('second older reply');
        expect(urlParams(page)).toEqual({ view: 'chat', keep: '1', char: 'second.png', chat: 'second-older' });
    });

    test('restores the selected group chat after a reload', async ({ page }) => {
        const fixture = createFixture();
        await mockChatWorkspace(page, fixture);

        await page.goto('/modern/?view=chat');
        await page.locator('[data-chat-mode="group"]').click();
        await page.locator('[data-select-chat="group-older"]').click();
        await expect(page.locator('.chat-thread')).toContainText('group older reply');
        await expect.poll(() => urlParams(page)).toEqual({ view: 'chat', group: 'group-alpha', chat: 'group-older' });

        await page.reload();

        await expect(page.locator('[data-chat-mode="group"]')).toHaveClass(/active/);
        await expect(page.locator('.detail-title')).toHaveText('Alpha Group');
        await expect(page.locator('[data-select-chat="group-older"]')).toHaveClass(/active/);
        await expect(page.locator('.chat-thread')).toContainText('group older reply');
    });

    test('falls back to the stored selection when the URL names a missing character or chat', async ({ page }) => {
        const fixture = createFixture();
        await page.addInitScript(() => {
            localStorage.setItem('st-modern-chat-last-used:v1', JSON.stringify({ 'mock.png': 'mock-used', 'second.png': 'second-older' }));
        });
        await mockChatWorkspace(page, fixture);

        await page.goto('/modern/?view=chat&char=missing.png&chat=gone&keep=1');
        await expect(page.locator('.detail-title')).toHaveText('Mock Character');
        await expect(page.locator('[data-select-chat="mock-used"]')).toHaveClass(/active/);
        await expect.poll(() => urlParams(page)).toEqual({ view: 'chat', keep: '1', char: 'mock.png', chat: 'mock-used' });

        await page.goto('/modern/?view=chat&char=second.png&chat=gone');
        await expect(page.locator('.detail-title')).toHaveText('Second Character');
        await expect(page.locator('[data-select-chat="second-older"]')).toHaveClass(/active/);
        await expect.poll(() => urlParams(page)).toEqual({ view: 'chat', char: 'second.png', chat: 'second-older' });
    });

    test('keeps the selection when returning through the sidebar and through the root entry', async ({ page }) => {
        const fixture = createFixture();
        await mockChatWorkspace(page, fixture);

        await page.goto('/modern/?view=chat');
        await page.locator('[data-select-character="second.png"]').click();
        await page.locator('[data-select-chat="second-older"]').click();
        await expect(page.locator('.chat-thread')).toContainText('second older reply');

        await page.locator('.sidebar [data-route="dashboard"]').click();
        await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'dashboard');
        await page.locator('.sidebar [data-route="chat"]').click();

        await expect(page.locator('.detail-title')).toHaveText('Second Character');
        await expect(page.locator('[data-select-chat="second-older"]')).toHaveClass(/active/);
        await expect.poll(() => urlParams(page)).toEqual({ view: 'chat', char: 'second.png', chat: 'second-older' });

        // The root entry forwards its query to /modern/, so a saved link reopens the same chat
        await page.goto('/?view=chat&char=second.png&chat=second-older');
        await expect(page).toHaveURL(/\/modern\/\?view=chat&char=second\.png&chat=second-older$/);
        await expect(page.locator('.detail-title')).toHaveText('Second Character');
        await expect(page.locator('[data-select-chat="second-older"]')).toHaveClass(/active/);
    });
});
