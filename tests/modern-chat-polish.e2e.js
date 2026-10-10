import { test, expect } from '@playwright/test';
import { createModernResourceFixture, mockModernWorkspace } from './modern-test-utils.js';

/* global window */

const desktopViewport = { width: 1440, height: 900 };

function stripJsonlExtension(value) {
    return String(value || '').replace(/\.jsonl$/i, '');
}

function fulfillJson(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

function postJson(route) {
    try {
        return route.request().postDataJSON();
    } catch {
        return {};
    }
}

function createDeferred() {
    let resolve;
    const promise = new Promise(next => {
        resolve = next;
    });
    return { promise, resolve };
}

function buildMessages(count, label) {
    const now = Date.now();
    return Array.from({ length: count }, (_, index) => ({
        name: index % 2 ? 'Alice Fixture' : 'Modern E2E User',
        is_user: index % 2 === 0,
        mes: `${label} ${index + 1}: ${'A long line of chat text that wraps inside the bubble. '.repeat(3)}`,
        send_date: now - (count - index) * 1000,
    }));
}

function createPolishFixture(overrides = {}) {
    const fixture = createModernResourceFixture(overrides);
    const now = Date.now();
    fixture.chatLists = {
        'alice.png': [
            { file_id: 'polish-chat', file_name: 'polish-chat.jsonl', chat_items: 30, file_size: '30 KB', last_mes: now },
        ],
    };
    fixture.messagesByChat = { 'polish-chat': buildMessages(30, 'polish') };
    fixture.backups = [
        { file_id: 'chat_alice_20260101-120000', file_name: 'chat_alice_20260101-120000.jsonl', chat_items: 3, file_size: '3 KB', last_mes: now - 1000 },
    ];
    fixture.chatRequests = { saves: [], bridge: [], backupDeletes: [] };
    return fixture;
}

async function mockChatRoutes(page, fixture) {
    await mockModernWorkspace(page, fixture);
    await page.route('**/api/characters/chats', route => {
        const payload = postJson(route);
        return fulfillJson(route, fixture.chatLists[payload.avatar_url] || []);
    });
    await page.route('**/api/chats/search', route => fulfillJson(route, []));
    await page.route('**/api/chats/get', route => {
        const payload = postJson(route);
        const chatId = stripJsonlExtension(payload.file_name);
        return fulfillJson(route, [
            { chat_metadata: {}, user_name: 'Modern E2E User', character_name: payload.ch_name },
            ...(fixture.messagesByChat[chatId] || []),
        ]);
    });
    await page.route('**/api/chats/save', route => {
        const payload = postJson(route);
        const chatId = stripJsonlExtension(payload.file_name);
        const messages = Array.isArray(payload.chat) ? payload.chat.slice(1) : [];
        fixture.chatRequests.saves.push(payload);
        fixture.messagesByChat[chatId] = messages;
        fixture.chatLists[payload.avatar_url] = [
            { file_id: chatId, file_name: `${chatId}.jsonl`, chat_items: messages.length, file_size: '1 KB', last_mes: Date.now() },
            ...(fixture.chatLists[payload.avatar_url] || []).filter(chat => chat.file_id !== chatId),
        ];
        return fulfillJson(route, { ok: true });
    });
    await page.route('**/api/backups/chat/get', route => fulfillJson(route, fixture.backups));
    await page.route('**/api/backups/chat/delete', route => {
        const payload = postJson(route);
        fixture.chatRequests.backupDeletes.push(payload);
        fixture.backups = fixture.backups.filter(backup => backup.file_name !== payload.name);
        return fulfillJson(route, { ok: true });
    });
}

// Minimal legacy-bridge stand-in: the hidden iframe relays bridge calls to a routed endpoint that
// appends the user message and a generated reply to the mocked chat.
async function mockGenerationBridge(page, fixture, { beforeGenerateResponse } = {}) {
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
                                const response = await fetch('/modern-chat-polish-bridge', {
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

    await page.route('**/modern-chat-polish-bridge', async route => {
        const request = postJson(route);
        const payload = request.payload || {};
        fixture.chatRequests.bridge.push(request);
        const chatId = stripJsonlExtension(payload.chat);
        if (request.action === 'generate') {
            await beforeGenerateResponse?.();
            const messages = [
                ...(fixture.messagesByChat[chatId] || []),
                { name: 'Modern E2E User', is_user: true, mes: payload.message || '', send_date: Date.now() - 500 },
                { name: 'Alice Fixture', is_user: false, mes: `generated reply to ${String(payload.message || '').split('\n')[0]}`, send_date: Date.now() },
            ];
            fixture.messagesByChat[chatId] = messages;
            fixture.chatLists['alice.png'] = fixture.chatLists['alice.png'].map(chat => (
                chat.file_id === chatId ? { ...chat, chat_items: messages.length, last_mes: Date.now() } : chat
            ));
            return fulfillJson(route, { chat: `${chatId}.jsonl`, messageCount: messages.length });
        }
        if (request.action === 'status') {
            return fulfillJson(route, { chat: `${chatId}.jsonl`, messageCount: (fixture.messagesByChat[chatId] || []).length });
        }
        return fulfillJson(route, { ok: true });
    });
}

async function openChat(page) {
    await page.goto('/modern/?view=chat');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'chat');
    await expect(page.locator('.page-title')).toHaveText('聊天工作区');
}

function readComposerInput(page) {
    return page.locator('[data-chat-input]').evaluate(input => ({
        height: input.getBoundingClientRect().height,
        clientHeight: input.clientHeight,
        scrollHeight: input.scrollHeight,
    }));
}

function readListDistanceFromBottom(page) {
    return page.locator('.message-list').evaluate(list => list.scrollHeight - list.scrollTop - list.clientHeight);
}

function countGenerateRequests(fixture) {
    return fixture.chatRequests.bridge.filter(request => request.action === 'generate').length;
}

const eightLines = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join('\n');

test.describe('Modern chat composer', () => {
    test.use({ viewport: desktopViewport });

    test('grows with the draft up to a cap, keeps Enter for new lines and shrinks after sending', async ({ page }) => {
        const fixture = createPolishFixture();
        await mockChatRoutes(page, fixture);
        const generation = createDeferred();
        await mockGenerationBridge(page, fixture, { beforeGenerateResponse: () => generation.promise });
        await openChat(page);
        await expect(page.locator('.message-list')).toContainText('polish 30:');

        const input = page.locator('[data-chat-input]');
        // Idle: a single-line box and no helper line under it (the placeholder already explains sending).
        await expect(input).toHaveAttribute('placeholder', '输入消息，按 Ctrl/⌘ + Enter 发送');
        await expect(page.locator('[data-composer-status]')).toHaveCount(0);
        await expect(page.locator('.composer')).not.toContainText('空消息不会提交');
        const idle = await readComposerInput(page);
        expect(idle.height).toBeLessThanOrEqual(50);

        // Enter inserts a new line instead of sending; the box grows so every line stays visible.
        await input.click();
        await page.keyboard.type('line 1');
        for (let line = 2; line <= 8; line++) {
            await page.keyboard.press('Enter');
            await page.keyboard.type(`line ${line}`);
        }
        await expect(input).toHaveValue(eightLines);
        expect(countGenerateRequests(fixture)).toBe(0);
        const grown = await readComposerInput(page);
        expect(grown.height).toBeGreaterThan(150);
        expect(grown.height).toBeLessThanOrEqual(200.5);
        expect(grown.scrollHeight).toBeLessThanOrEqual(grown.clientHeight + 1);
        // The message list gave up the room and still ends at the newest message.
        await expect.poll(() => readListDistanceFromBottom(page)).toBeLessThanOrEqual(1);

        // Past the cap the box stops growing and scrolls inside.
        await input.fill(Array.from({ length: 24 }, (_, index) => `row ${index + 1}`).join('\n'));
        const capped = await readComposerInput(page);
        expect(capped.height).toBeLessThanOrEqual(200.5);
        expect(capped.height).toBeGreaterThan(190);
        expect(capped.scrollHeight).toBeGreaterThan(capped.clientHeight);

        // Deleting text shrinks it again without a render.
        await input.fill('short');
        expect((await readComposerInput(page)).height).toBeLessThanOrEqual(idle.height + 1);

        // Ctrl+Enter sends; while generating the status line explains the wait.
        await input.fill(eightLines);
        await input.press('Control+Enter');
        await expect.poll(() => countGenerateRequests(fixture)).toBe(1);
        expect(fixture.chatRequests.bridge.find(request => request.action === 'generate').payload.message).toBe(eightLines);
        await expect(page.locator('[data-composer-status]')).toBeVisible();
        await expect(page.locator('[data-composer-status]')).not.toBeEmpty();
        generation.resolve();

        await expect(page.locator('.message-list')).toContainText('generated reply to line 1');
        await expect(input).toHaveValue('');
        await expect(page.locator('[data-composer-status]')).toHaveCount(0);
        await expect.poll(async () => (await readComposerInput(page)).height).toBeLessThanOrEqual(idle.height + 1);
        await expect.poll(() => readListDistanceFromBottom(page)).toBeLessThanOrEqual(1);
    });

    test('restores the height of a long draft after a re-render', async ({ page }) => {
        const fixture = createPolishFixture();
        await mockChatRoutes(page, fixture);
        await openChat(page);
        await expect(page.locator('.message-list')).toContainText('polish 30:');

        await page.locator('[data-chat-input]').fill(eightLines);
        const grown = await readComposerInput(page);
        // Opening a message's manage panel re-renders the whole chat route, composer included.
        await page.locator('[data-delete-message="29"]').click();
        await expect(page.locator('.message-manage-panel')).toBeVisible();
        await expect(page.locator('[data-chat-input]')).toHaveValue(eightLines);
        await expect.poll(async () => Math.round((await readComposerInput(page)).height)).toBe(Math.round(grown.height));
    });
});

test.describe('Modern chat polish', () => {
    test.use({ viewport: desktopViewport });

    test('labels messages with the model name and hides internal source markers', async ({ page }) => {
        const fixture = createPolishFixture();
        const now = Date.now();
        fixture.messagesByChat['polish-chat'] = [
            { name: 'Alice Fixture', is_user: false, is_system: false, mes: 'Hello from Alice.', send_date: now - 5000, extra: { api: 'modern', model: '' } },
            { name: 'Modern E2E User', is_user: true, mes: 'hi there', send_date: now - 4000, extra: {} },
            { name: 'Alice Fixture', is_user: false, mes: 'inserted by a slash command', send_date: now - 3000, extra: { api: 'manual' } },
            { name: 'Alice Fixture', is_user: false, mes: 'reply without a model name', send_date: now - 2000, extra: { api: 'koboldhorde' } },
            { name: 'Alice Fixture', is_user: false, mes: 'reply with a model name', send_date: now - 1000, extra: { api: 'openai', model: 'deepseek-v4-flash' } },
        ];
        await mockChatRoutes(page, fixture);
        await openChat(page);

        const messages = page.locator('.message-list > .message');
        await expect(messages).toHaveCount(5);
        await expect(messages.nth(0).locator('.message-foot')).toHaveCount(0);
        await expect(messages.nth(2).locator('.message-foot')).toHaveCount(0);
        await expect(messages.nth(3).locator('.message-foot')).toHaveText('koboldhorde');
        await expect(messages.nth(4).locator('.message-foot')).toHaveText('deepseek-v4-flash');
        await expect(page.locator('.message-foot', { hasText: /^modern$/ })).toHaveCount(0);
    });

    test('shows no source label under a new chat greeting and keeps its stored marker', async ({ page }) => {
        const fixture = createPolishFixture();
        fixture.chatLists = { 'alice.png': [] };
        fixture.messagesByChat = {};
        await mockChatRoutes(page, fixture);
        await openChat(page);
        await expect(page.locator('.chat-thread')).toContainText('暂无聊天记录');

        await page.locator('[data-new-chat]').click();
        await expect.poll(() => fixture.chatRequests.saves.length).toBe(1);
        // Stored data is unchanged: the greeting still carries the Modern source marker.
        expect(fixture.chatRequests.saves[0].chat[1]).toMatchObject({ mes: 'Hello from Alice.', extra: { api: 'modern' } });
        await expect(page.locator('.message-opening')).toContainText('Hello from Alice.');
        await expect(page.locator('.message-list .message-foot')).toHaveCount(0);
    });

    test('offers creating a group when the group chat list is empty', async ({ page }) => {
        const fixture = createPolishFixture({ groups: [] });
        await mockChatRoutes(page, fixture);
        await openChat(page);

        await page.locator('[data-chat-mode="group"]').click();
        const emptyState = page.locator('.chat-thread .empty-state');
        await expect(emptyState).toContainText('没有可用群聊');
        const createButton = emptyState.getByRole('button', { name: '新建群组' });
        await expect(createButton).toBeVisible();
        // The button icon keeps the button's text size instead of the empty-state illustration style.
        const sizes = await createButton.evaluate(button => ({
            button: window.getComputedStyle(button).fontSize,
            icon: window.getComputedStyle(button.querySelector('.fa-plus')).fontSize,
        }));
        expect(sizes.icon).toBe(sizes.button);

        await createButton.click();
        await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'groups');
        await expect(page).toHaveURL(/[?&]view=groups/);
        await expect(page.locator('.page-title')).toHaveText('群组管理');
        await expect(page.locator('[data-save-group-create]')).toBeVisible();
        await expect(page.locator('.settings-form', { hasText: '新建群组' })).toBeVisible();
    });

    test('offers creating a character when the character list is empty', async ({ page }) => {
        // No groups either: with groups present the chat route opens the group side instead.
        const fixture = createPolishFixture({ characters: [], groups: [] });
        await mockChatRoutes(page, fixture);
        await openChat(page);

        const emptyState = page.locator('.chat-thread .empty-state');
        await expect(emptyState).toContainText('没有可用角色');
        await emptyState.getByRole('button', { name: '新建角色' }).click();
        await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'characters');
        await expect(page.locator('[data-character-create-panel]')).toBeVisible();
    });

    test('shows cleaned-up author names in the chat character list and header', async ({ page }) => {
        const fixture = createPolishFixture();
        fixture.characters = fixture.characters.map(character => ({
            ...character,
            data: { ...character.data, creator: character.avatar === 'alice.png' ? 'yuukikun,,yuukikun,' : ',,,' },
        }));
        fixture.chatLists = { 'alice.png': [] };
        await mockChatRoutes(page, fixture);
        await openChat(page);

        const aliceRow = page.locator('[data-select-character="alice.png"]');
        const brunoRow = page.locator('[data-select-character="bruno.png"]');
        await expect(aliceRow).toContainText('作者 yuukikun');
        await expect(aliceRow).not.toContainText(',');
        await expect(brunoRow).not.toContainText('作者');
        await expect(brunoRow).not.toContainText(',');
        // Without a chat file the header subtitle names the author, cleaned up the same way.
        await expect(page.locator('.detail-hero .panel-subtitle')).toHaveText('yuukikun');
    });

    test('labels the backup delete action and still confirms it', async ({ page }) => {
        const fixture = createPolishFixture();
        await mockChatRoutes(page, fixture);
        await openChat(page);

        await page.locator('.page-head [data-chat-backups-toggle]').click();
        const row = page.locator('.backup-row', { hasText: 'chat_alice_20260101-120000.jsonl' });
        await expect(row).toBeVisible();
        const deleteButton = row.locator('[data-delete-chat-backup]');
        await expect(deleteButton).toHaveText('删除');
        await expect(deleteButton).toHaveClass(/danger-action/);
        await expect(deleteButton.locator('.fa-trash')).toHaveCount(1);
        await expect(row).not.toContainText('管理');

        // The first click only asks; cancelling brings the button back.
        await deleteButton.click();
        await expect(row.locator('[data-confirm-chat-backup-delete]')).toHaveText('确认删除');
        expect(fixture.chatRequests.backupDeletes).toHaveLength(0);
        await row.locator('[data-cancel-chat-backup-delete]').click();
        await expect(row.locator('[data-delete-chat-backup]')).toHaveText('删除');

        await row.locator('[data-delete-chat-backup]').click();
        await row.locator('[data-confirm-chat-backup-delete]').click();
        await expect.poll(() => fixture.chatRequests.backupDeletes.length).toBe(1);
        expect(fixture.chatRequests.backupDeletes[0]).toEqual({ name: 'chat_alice_20260101-120000.jsonl' });
        await expect(page.locator('.backup-row', { hasText: 'chat_alice_20260101-120000.jsonl' })).toHaveCount(0);
    });

    test('shows the generation engine state once, in the engine panel', async ({ page }) => {
        const fixture = createPolishFixture();
        await mockChatRoutes(page, fixture);
        await openChat(page);
        await expect(page.locator('.message-list')).toContainText('polish 30:');

        const engineStatus = await page.locator('.engine-panel .badge').innerText();
        expect(engineStatus.trim()).not.toBe('');
        await expect(page.locator('.detail-tags')).not.toContainText(engineStatus.trim());
        await expect(page.locator('.chat-thread').getByText(engineStatus.trim(), { exact: true })).toHaveCount(1);
        await expect(page.locator('.engine-panel')).toContainText('生成引擎');
        await expect(page.locator('[data-check-generation-engine]')).toBeVisible();
        await expect(page.locator('.detail-tags')).toContainText('条消息');
    });
});

test.describe('Modern chat composer on mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('grows the composer without trapping the page scroll', async ({ page }) => {
        const fixture = createPolishFixture();
        await mockChatRoutes(page, fixture);
        await openChat(page);
        await expect(page.locator('.message-list')).toContainText('polish 30:');

        await page.locator('[data-chat-input]').fill(eightLines);
        const grown = await readComposerInput(page);
        // 40% of an 844 px viewport is above the 200 px cap, so the cap applies here too.
        expect(grown.height).toBeGreaterThan(150);
        expect(grown.height).toBeLessThanOrEqual(200.5);
        const composerPosition = await page.locator('.composer').evaluate(element => window.getComputedStyle(element).position);
        expect(composerPosition).toBe('static');
    });
});
