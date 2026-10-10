import { test, expect } from '@playwright/test';
import { createModernResourceFixture, mockModernWorkspace } from './modern-test-utils.js';

/* global document, window, HTMLElement */

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

function multipartFileName(bodyText, fieldName) {
    const match = new RegExp(`name="${fieldName}"; filename="([^"]+)"`).exec(bodyText);
    return match?.[1]?.trim() || '';
}

function multipartFieldValue(bodyText, fieldName) {
    const match = new RegExp(`name="${fieldName}"\\r?\\n\\r?\\n([^\\r\\n]*)`).exec(bodyText);
    return match?.[1]?.trim() || '';
}

function buildMessages(count, label = 'message') {
    const now = Date.now();
    return Array.from({ length: count }, (_, index) => ({
        name: index % 2 ? 'Alice Fixture' : 'Modern E2E User',
        is_user: index % 2 === 0,
        mes: `${label} ${index + 1}: ${'A long line of chat text that wraps inside the bubble. '.repeat(3)}`,
        send_date: now - (count - index) * 1000,
    }));
}

function createChatUiFixture({ messageCount = 30 } = {}) {
    const fixture = createModernResourceFixture();
    const now = Date.now();
    fixture.chatLists = {
        'alice.png': [
            { file_id: 'long-chat', file_name: 'long-chat.jsonl', chat_items: messageCount, file_size: '40 KB', last_mes: now },
            { file_id: 'short-chat', file_name: 'short-chat.jsonl', chat_items: 2, file_size: '1 KB', last_mes: now - 60_000 },
        ],
        'bruno.png': [
            { file_id: 'bruno-chat', file_name: 'bruno-chat.jsonl', chat_items: 2, file_size: '1 KB', last_mes: now },
        ],
    };
    fixture.messagesByChat = {
        'long-chat': buildMessages(messageCount),
        'short-chat': buildMessages(2, 'short'),
        'bruno-chat': buildMessages(2, 'bruno'),
    };
    fixture.backups = [
        { file_id: 'chat_alice_20260101-120000', file_name: 'chat_alice_20260101-120000.jsonl', chat_items: 3, file_size: '3 KB', last_mes: now - 1000 },
        { file_id: 'chat_alice_20260102-120000', file_name: 'chat_alice_20260102-120000.jsonl', chat_items: 0, file_size: '67 B', last_mes: now - 2000 },
        { file_id: 'chat_bruno_20260103-120000', file_name: 'chat_bruno_20260103-120000.jsonl', chat_items: 0, file_size: '67 B', last_mes: now - 3000 },
        { file_id: 'chat_alpha_chat_20260104-120000', file_name: 'chat_alpha_chat_20260104-120000.jsonl', chat_items: 4, file_size: '4 KB', last_mes: now - 4000 },
        {
            file_id: 'chat_rin_tohsaka_tohsaka_rin_chub_yuukikun_tohsaka_rin_extremely_long_card_name_20251001-121212',
            file_name: 'chat_rin_tohsaka_tohsaka_rin_chub_yuukikun_tohsaka_rin_extremely_long_card_name_20251001-121212.jsonl',
            chat_items: 5,
            file_size: '5 KB',
            last_mes: now - 5000,
        },
        // Not produced by the backend (copied in by hand): no recognisable owner.
        { file_id: 'chat_alice_manual-copy', file_name: 'chat_alice_manual-copy.jsonl', chat_items: 2, file_size: '2 KB', last_mes: now - 6000 },
    ];
    fixture.chatRequests = { imports: [], backupDownloads: [], bridge: [] };
    return fixture;
}

async function mockChatUiRoutes(page, fixture) {
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
    await page.route('**/api/chats/import', route => {
        const bodyText = route.request().postData() || '';
        const fileName = multipartFileName(bodyText, 'avatar');
        const chatId = stripJsonlExtension(fileName);
        const avatarUrl = multipartFieldValue(bodyText, 'avatar_url');
        fixture.chatRequests.imports.push({ fileName, avatarUrl });
        fixture.messagesByChat[chatId] = buildMessages(2, `restored ${chatId}`);
        fixture.chatLists[avatarUrl] = [
            { file_id: chatId, file_name: `${chatId}.jsonl`, chat_items: 2, file_size: '1 KB', last_mes: Date.now() },
            ...(fixture.chatLists[avatarUrl] || []),
        ];
        return fulfillJson(route, { fileNames: [`${chatId}.jsonl`] });
    });
    await page.route('**/api/backups/chat/get', route => fulfillJson(route, fixture.backups));
    await page.route('**/api/backups/chat/download', route => {
        const payload = postJson(route);
        fixture.chatRequests.backupDownloads.push(payload);
        return route.fulfill({
            status: 200,
            contentType: 'application/jsonl',
            body: JSON.stringify({ name: 'Alice Fixture', is_user: false, mes: `preview of ${payload.name}`, send_date: Date.now() }),
        });
    });
}

// Minimal legacy-bridge stand-in: the hidden iframe relays bridge calls to a routed endpoint that
// appends a user message and a generated reply to the mocked chat.
async function mockGenerationBridge(page, fixture) {
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
                                const response = await fetch('/modern-chat-ui-bridge', {
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

    await page.route('**/modern-chat-ui-bridge', route => {
        const request = postJson(route);
        const payload = request.payload || {};
        fixture.chatRequests.bridge.push(request);
        const chatId = stripJsonlExtension(payload.chat);
        if (request.action === 'generate') {
            const messages = [
                ...(fixture.messagesByChat[chatId] || []),
                { name: 'Modern E2E User', is_user: true, mes: payload.message || '', send_date: Date.now() - 500 },
                { name: 'Alice Fixture', is_user: false, mes: `generated reply to ${payload.message}`, send_date: Date.now() },
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

function readMessageListScroll(page) {
    return page.locator('.message-list').evaluate(list => ({
        scrollTop: list.scrollTop,
        scrollable: list.scrollHeight - list.clientHeight,
        distanceFromBottom: list.scrollHeight - list.scrollTop - list.clientHeight,
    }));
}

function readDocumentOverflow(page) {
    return page.evaluate(() => document.scrollingElement.scrollHeight - window.innerHeight);
}

async function expectLastMessageAboveComposer(page) {
    const lastMessage = page.locator('.message-list > .message').last();
    const lastBox = await lastMessage.boundingBox();
    const listBox = await page.locator('.message-list').boundingBox();
    const composerBox = await page.locator('.composer').boundingBox();
    expect(lastBox && listBox && composerBox).toBeTruthy();
    // The newest message ends inside the visible list, and the list ends above the composer.
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(listBox.y + listBox.height + 1);
    expect(listBox.y + listBox.height).toBeLessThanOrEqual(composerBox.y + 1);
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(composerBox.y);
}

test.describe('Modern chat layout and scrolling', () => {
    test.use({ viewport: desktopViewport });

    test('fits the viewport and opens chats at the newest message', async ({ page }) => {
        const fixture = createChatUiFixture();
        await mockChatUiRoutes(page, fixture);
        await openChat(page);

        await expect(page.locator('.message-list')).toContainText('message 30:');
        expect(await readDocumentOverflow(page)).toBeLessThanOrEqual(1);
        await expect.poll(async () => (await readMessageListScroll(page)).distanceFromBottom).toBeLessThanOrEqual(1);
        const scroll = await readMessageListScroll(page);
        expect(scroll.scrollable).toBeGreaterThan(200);
        expect(scroll.scrollTop).toBeGreaterThan(200);
        await expectLastMessageAboveComposer(page);
        await expect(page.locator('[data-scroll-to-latest]')).toBeHidden();

        // Switching chats lands on the newest message of the other chat as well.
        await page.locator('[data-select-chat="short-chat"]').click();
        await expect(page.locator('.message-list')).toContainText('short 2:');
        await page.locator('[data-select-chat="long-chat"]').click();
        await expect(page.locator('.message-list')).toContainText('message 30:');
        await expect.poll(async () => (await readMessageListScroll(page)).distanceFromBottom).toBeLessThanOrEqual(1);
        expect(await readDocumentOverflow(page)).toBeLessThanOrEqual(1);
    });

    test('keeps a reader who scrolled up in place and offers a jump to the newest message', async ({ page }) => {
        const fixture = createChatUiFixture();
        await mockChatUiRoutes(page, fixture);
        await openChat(page);
        await expect.poll(async () => (await readMessageListScroll(page)).distanceFromBottom).toBeLessThanOrEqual(1);

        // Pinned at the bottom: a re-render (opening the last message's manage panel) stays pinned.
        await page.locator('[data-delete-message="29"]').click();
        await expect(page.locator('.message-manage-panel')).toBeVisible();
        await expect.poll(async () => (await readMessageListScroll(page)).distanceFromBottom).toBeLessThanOrEqual(1);
        await expect(page.locator('[data-confirm-message-delete]')).toBeInViewport();
        await page.locator('[data-cancel-message-delete]').click();
        await expect(page.locator('.message-manage-panel')).toHaveCount(0);

        // Scrolled up to read history: the jump button appears and re-renders keep the position.
        await page.locator('.message-list').evaluate(list => {
            list.scrollTop = 0;
        });
        await expect(page.locator('[data-scroll-to-latest]')).toBeVisible();
        await expect(page.locator('[data-scroll-to-latest]')).toContainText('最新消息');
        await page.locator('[data-delete-message="1"]').click();
        await expect(page.locator('.message-manage-panel')).toBeVisible();
        expect((await readMessageListScroll(page)).scrollTop).toBeLessThanOrEqual(2);
        await expect(page.locator('[data-scroll-to-latest]')).toBeVisible();
        await page.locator('[data-cancel-message-delete]').click();
        await expect(page.locator('.message-manage-panel')).toHaveCount(0);
        // Playwright may nudge the list a few pixels to reveal the clicked button; it must not jump to the bottom.
        const afterCancel = await readMessageListScroll(page);
        expect(afterCancel.scrollTop).toBeLessThanOrEqual(40);
        expect(afterCancel.distanceFromBottom).toBeGreaterThan(200);

        await page.locator('[data-scroll-to-latest]').click();
        await expect.poll(async () => (await readMessageListScroll(page)).distanceFromBottom).toBeLessThanOrEqual(1);
        await expect(page.locator('[data-scroll-to-latest]')).toBeHidden();
        await expectLastMessageAboveComposer(page);
    });

    test('shows the generated reply above the composer after sending', async ({ page }) => {
        const fixture = createChatUiFixture();
        await mockChatUiRoutes(page, fixture);
        await mockGenerationBridge(page, fixture);
        await openChat(page);
        await expect.poll(async () => (await readMessageListScroll(page)).distanceFromBottom).toBeLessThanOrEqual(1);

        await page.locator('[data-chat-input]').fill('pinned hello');
        await page.locator('[data-send-message]').click();
        await expect(page.locator('.message-list')).toContainText('generated reply to pinned hello');
        await expect(page.locator('[data-send-message]')).toContainText('发送');
        await expect.poll(async () => (await readMessageListScroll(page)).distanceFromBottom).toBeLessThanOrEqual(1);
        await expect(page.locator('.message-list > .message').last()).toContainText('generated reply to pinned hello');
        await expectLastMessageAboveComposer(page);
        expect(await readDocumentOverflow(page)).toBeLessThanOrEqual(1);
    });

    test('keeps the visible messages in place when loading earlier messages', async ({ page }) => {
        const fixture = createChatUiFixture({ messageCount: 100 });
        await mockChatUiRoutes(page, fixture);
        await openChat(page);

        await expect(page.locator('[data-load-earlier-messages]')).toContainText('加载更早消息 20');
        await page.locator('.message-list').evaluate(list => {
            list.scrollTop = 0;
        });
        const anchor = page.locator('.message-list > .message', { hasText: 'message 21:' });
        const before = await anchor.boundingBox();
        await page.locator('[data-load-earlier-messages]').click();
        await expect(page.locator('.message-list')).toContainText('message 1:');
        await expect(page.locator('[data-load-earlier-messages]')).toHaveCount(0);
        const after = await anchor.boundingBox();
        expect(before && after).toBeTruthy();
        expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(4);
    });
});

test.describe('Modern chat backups drawer', () => {
    test.use({ viewport: desktopViewport });

    test('filters backups to the current character and keeps rows readable', async ({ page }) => {
        const fixture = createChatUiFixture();
        await mockChatUiRoutes(page, fixture);
        await openChat(page);

        await page.locator('.page-head [data-chat-backups-toggle]').click();
        const drawer = page.locator('.chat-tools-drawer');
        await expect(drawer).toBeVisible();
        const rows = drawer.locator('.backup-row');

        // Default: only Alice's non-empty backups.
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('chat_alice_20260101-120000.jsonl');
        await expect(drawer.locator('[data-chat-backup-summary]')).toContainText('全部 6 个');
        await expect(drawer.locator('[data-chat-backup-summary]')).toContainText('其中 1 个无法识别归属（勾选「显示全部角色」查看）');

        await drawer.locator('[data-chat-backup-show-empty]').check();
        await expect(rows).toHaveCount(2);
        await expect(drawer.locator('.backup-row', { hasText: 'chat_alice_20260102-120000.jsonl' })).toContainText('0 条消息');

        await drawer.locator('[data-chat-backup-show-all]').check();
        await expect(rows).toHaveCount(6);
        await expect(drawer.locator('.backup-row', { hasText: 'chat_alice_manual-copy.jsonl' })).toContainText('无法识别归属');
        await expect(drawer.locator('.backup-row', { hasText: 'chat_bruno_20260103-120000.jsonl' })).toContainText('角色「Bruno Fixture」');
        await expect(drawer.locator('.backup-row', { hasText: 'chat_alpha_chat_20260104-120000.jsonl' })).toContainText('群聊「Alpha Group」');

        // Names never sit under the action buttons, and the full name stays available in title.
        for (const row of await rows.all()) {
            const title = row.locator('.backup-row-title');
            const titleBox = await title.boundingBox();
            const actionsBox = await row.locator('.backup-row-actions').boundingBox();
            const rowBox = await row.boundingBox();
            expect(titleBox && actionsBox && rowBox).toBeTruthy();
            expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(actionsBox.y + 0.5);
            expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
            expect(await title.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
            await expect(title).toHaveAttribute('title', /\.jsonl$/);
        }

        // The list uses the drawer's height instead of stopping half-way.
        const listBox = await drawer.locator('.backup-list').boundingBox();
        const panelBox = await drawer.locator('.chat-tool-panel').boundingBox();
        expect(listBox && panelBox).toBeTruthy();
        expect(panelBox.y + panelBox.height - (listBox.y + listBox.height)).toBeLessThanOrEqual(40);
        expect(listBox.height).toBeGreaterThan(500);

        const search = drawer.locator('[data-chat-backup-search]');
        await search.fill('bruno');
        await expect(rows).toHaveCount(1);
        await expect(search).toBeFocused();
        await expect(rows.first()).toContainText('chat_bruno_20260103-120000.jsonl');
        await search.fill('no-such-backup');
        await expect(rows).toHaveCount(0);
        await expect(drawer.locator('.backup-list')).toContainText('没有匹配的备份');
        await search.fill('');
        await expect(rows).toHaveCount(6);

        await drawer.locator('[data-chat-backups-close]').click();
        await expect(drawer).toHaveCount(0);
        await page.locator('.page-head [data-chat-backups-toggle]').click();
        await expect(page.locator('.chat-tools-drawer')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.chat-tools-drawer')).toHaveCount(0);
        expect(await readDocumentOverflow(page)).toBeLessThanOrEqual(1);
    });

    test('shows an empty state for a character without backups and filters group backups', async ({ page }) => {
        const fixture = createChatUiFixture();
        await mockChatUiRoutes(page, fixture);
        await openChat(page);

        await page.locator('[data-select-character="bruno.png"]').click();
        await expect(page.locator('.detail-title')).toHaveText('Bruno Fixture');
        await page.locator('.page-head [data-chat-backups-toggle]').click();
        const drawer = page.locator('.chat-tools-drawer');
        await expect(drawer.locator('.backup-row')).toHaveCount(0);
        await expect(drawer.locator('.backup-list')).toContainText('角色「Bruno Fixture」暂无聊天备份');
        await expect(drawer.locator('.backup-list')).toContainText('已隐藏 1 个空备份');
        await drawer.locator('[data-chat-backups-close]').click();

        await page.locator('[data-chat-mode="group"]').click();
        await expect(page.locator('.detail-title')).toHaveText('Alpha Group');
        await page.locator('.page-head [data-chat-backups-toggle]').click();
        await expect(drawer.locator('.backup-row')).toHaveCount(1);
        await expect(drawer.locator('.backup-row')).toContainText('chat_alpha_chat_20260104-120000.jsonl');
        await expect(drawer.locator('[data-chat-backup-show-all]')).not.toBeChecked();
    });

    test('asks for confirmation before restoring another character\'s backup', async ({ page }) => {
        const fixture = createChatUiFixture();
        await mockChatUiRoutes(page, fixture);
        await openChat(page);

        await page.locator('.page-head [data-chat-backups-toggle]').click();
        const drawer = page.locator('.chat-tools-drawer');

        // Own backup: restores straight away.
        await drawer.locator('[data-restore-chat-backup="chat_alice_20260101-120000.jsonl"]').click();
        await expect.poll(() => fixture.chatRequests.imports.length).toBe(1);
        expect(fixture.chatRequests.imports[0]).toEqual({ fileName: 'chat_alice_20260101-120000.jsonl', avatarUrl: 'alice.png' });

        // Another character's backup: needs an explicit confirmation naming both characters.
        await drawer.locator('[data-chat-backup-show-all]').check();
        await drawer.locator('[data-chat-backup-show-empty]').check();
        await drawer.locator('[data-restore-chat-backup="chat_bruno_20260103-120000.jsonl"]').click();
        const confirm = drawer.locator('[data-chat-backup-restore-confirm]');
        await expect(confirm).toBeVisible();
        await expect(confirm).toContainText('角色「Bruno Fixture」');
        await expect(confirm).toContainText('「Alice Fixture」');
        // The confirmation is shown before any download/import request is made.
        expect(fixture.chatRequests.imports).toHaveLength(1);

        await drawer.locator('[data-cancel-chat-backup-restore]').click();
        await expect(confirm).toHaveCount(0);
        expect(fixture.chatRequests.imports).toHaveLength(1);

        await drawer.locator('[data-restore-chat-backup="chat_bruno_20260103-120000.jsonl"]').click();
        await drawer.locator('[data-confirm-chat-backup-restore="chat_bruno_20260103-120000.jsonl"]').click();
        await expect.poll(() => fixture.chatRequests.imports.length).toBe(2);
        expect(fixture.chatRequests.imports[1]).toEqual({ fileName: 'chat_bruno_20260103-120000.jsonl', avatarUrl: 'alice.png' });
        await expect(confirm).toHaveCount(0);
    });
});

test.describe('Modern chat layout on narrow screens', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('keeps the single page scroll and a static composer on mobile', async ({ page }) => {
        const fixture = createChatUiFixture();
        await mockChatUiRoutes(page, fixture);
        await openChat(page);
        // Narrow screens start with the chat list overlay closed, so the thread is reachable directly.
        await expect(page.locator('.chat-sidebar-scrim')).toHaveCount(0);
        await expect(page.locator('.message-list')).toContainText('message 30:');
        const styles = await page.locator('.message-list').evaluate(list => ({
            overflowY: window.getComputedStyle(list).overflowY,
            composerPosition: window.getComputedStyle(document.querySelector('.composer') || list).position,
            isElement: list instanceof HTMLElement,
        }));
        expect(styles.isElement).toBe(true);
        expect(styles.overflowY).toBe('visible');
        expect(styles.composerPosition).toBe('static');
        await expect(page.locator('[data-scroll-to-latest]')).toBeHidden();
    });
});
