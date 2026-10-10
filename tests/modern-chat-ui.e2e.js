import { test, expect } from '@playwright/test';
import { createModernResourceFixture, mockModernWorkspace } from './modern-test-utils.js';

/* global document, window, HTMLElement, requestAnimationFrame */

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
        await expect(page.locator('[data-request-message-delete]')).toBeInViewport();
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

function readSidebarList(page, selector) {
    return page.locator(selector).evaluate(list => {
        const active = list.querySelector('.resource-row.active');
        const listRect = list.getBoundingClientRect();
        const activeRect = active?.getBoundingClientRect();
        const visibleTop = listRect.top + list.clientTop;
        return {
            scrollTop: list.scrollTop,
            scrollable: list.scrollHeight - list.clientHeight,
            activeId: active?.getAttribute('data-select-character') || active?.getAttribute('data-select-chat') || '',
            activeVisible: !!activeRect
                && activeRect.top >= visibleTop - 1
                && activeRect.bottom <= visibleTop + list.clientHeight + 1,
        };
    });
}

function readPageScrollTop(page) {
    return page.evaluate(() => document.scrollingElement.scrollTop);
}

async function switchRoute(page, routeId) {
    await page.locator(`.nav-button[data-route="${routeId}"]`).click();
    await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', routeId);
}

// Entering the chat route reloads the chat list and messages and renders again once they arrive;
// positions are asserted after that, not on an intermediate render.
async function waitForChatRouteSettled(page, expectedMessage) {
    await expect(page.locator('[data-refresh-chat-list]')).toBeEnabled();
    await expect(page.locator('[data-refresh-chat-list] .fa-spin')).toHaveCount(0);
    await expect(page.locator('.message-list')).toContainText(expectedMessage);
}

async function expectSidebarListAt(page, selector, { activeId, scrollTop }) {
    await expect.poll(async () => {
        const list = await readSidebarList(page, selector);
        return { activeId: list.activeId, activeVisible: list.activeVisible, nearExpected: Math.abs(list.scrollTop - scrollTop) <= 2 };
    }).toEqual({ activeId, activeVisible: true, nearExpected: true });
}

test.describe('Modern chat message hints and management', () => {
    test.use({ viewport: desktopViewport });

    test('explains an empty reply whose tokens went to reasoning and normalizes empty previews', async ({ page }) => {
        const fixture = createChatUiFixture();
        fixture.settings.main_api = 'openai';
        fixture.settings.oai_settings = { openai_max_tokens: 300 };
        const now = Date.now();
        fixture.messagesByChat['short-chat'] = [
            { name: 'Modern E2E User', is_user: true, mes: 'hello', send_date: now - 3000 },
            { name: 'Alice Fixture', is_user: false, mes: '', send_date: now - 2000, extra: { reasoning: 'Thinking about the answer. '.repeat(30) } },
            { name: 'Modern E2E User', is_user: true, mes: 'again', send_date: now - 1000 },
            { name: 'Alice Fixture', is_user: false, mes: '', send_date: now, extra: {} },
        ];
        await mockChatUiRoutes(page, fixture);
        // The backend's chat summary fills an empty last message with an English placeholder.
        await page.route('**/api/chats/search', route => {
            const payload = postJson(route);
            if (!payload.query) {
                return fulfillJson(route, []);
            }
            return fulfillJson(route, [
                { file_name: 'short-chat', file_size: '1 KB', message_count: 4, last_mes: now, preview_message: '[The message is empty]' },
            ]);
        });
        await openChat(page);
        await page.locator('[data-select-chat="short-chat"]').click();
        await expect(page.locator('.message-list')).toContainText('again');

        // Only the reply with reasoning but no text gets the hint; an empty reply without reasoning does not.
        const hint = page.locator('[data-empty-reply-hint]');
        await expect(hint).toHaveCount(1);
        await expect(hint).toContainText('回复正文为空：推理内容可能用完了 Max Tokens（当前 300）。可在 API 页调高后重生成。');
        const hintedMessage = page.locator('.message-list > .message', { has: hint });
        await expect(hintedMessage.locator('.message-body').first()).toHaveText('[空消息]');
        await expect(hintedMessage.locator('.message-reasoning summary')).toHaveText('推理内容');

        // Search results show the same placeholder as the message bubbles.
        await page.locator('[data-chat-search-input]').fill('again');
        await page.locator('[data-chat-search-run]').click();
        const preview = page.locator('[data-select-chat="short-chat"] .chat-preview');
        await expect(preview).toHaveText('[空消息]');
        await expect(page.locator('.chat-browser')).not.toContainText('The message is empty');

        await hint.locator('[data-route="api"]').click();
        await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'api');
    });

    test('separates editing from deleting and confirms a delete inline', async ({ page }) => {
        const fixture = createChatUiFixture();
        fixture.chatRequests.saves = [];
        await mockChatUiRoutes(page, fixture);
        await mockGenerationBridge(page, fixture);
        await page.route('**/api/chats/save', route => {
            const payload = postJson(route);
            fixture.chatRequests.saves.push(payload);
            fixture.messagesByChat[stripJsonlExtension(payload.file_name)] = payload.chat.filter(message => !message.chat_metadata);
            return fulfillJson(route, { ok: true });
        });
        await openChat(page);
        await page.locator('[data-select-chat="short-chat"]').click();
        await expect(page.locator('.message-list')).toContainText('short 2:');

        const manageButton = page.locator('[data-delete-message="1"]');
        await expect(manageButton).toHaveAttribute('title', '编辑或删除消息');
        await manageButton.click();
        const panel = page.locator('.message-manage-panel');
        await expect(panel).toContainText('编辑或删除消息');
        const deleteButton = panel.locator('[data-request-message-delete]');
        const question = panel.getByText('确认删除这条消息？');
        await expect(panel.locator('[data-edit-message="1"]')).toBeVisible();
        await expect(deleteButton).toBeVisible();
        await expect(deleteButton).toContainText('删除消息');
        await expect(deleteButton).toHaveClass(/danger-action/);
        // The danger action is not offered until 删除消息 was chosen.
        await expect(question).toBeHidden();
        await expect(panel.locator('[data-confirm-message-delete]')).toBeHidden();

        await deleteButton.click();
        await expect(question).toBeVisible();
        await expect(panel.locator('[data-confirm-message-delete]')).toBeVisible();
        await expect(panel.locator('[data-confirm-message-delete]')).toContainText('确认删除');
        await expect(panel.locator('[data-cancel-message-delete]')).toBeVisible();
        await expect(panel.locator('[data-edit-message="1"]')).toBeHidden();
        await expect(deleteButton).toBeHidden();

        // A re-render (opening and closing the backups drawer) keeps the confirmation open.
        await page.locator('.page-head [data-chat-backups-toggle]').click();
        await expect(page.locator('.chat-tools-drawer')).toBeVisible();
        await expect(panel.locator('[data-confirm-message-delete]')).toBeVisible();
        await page.locator('[data-chat-backups-close]').click();
        await expect(page.locator('.chat-tools-drawer')).toHaveCount(0);
        await expect(panel.locator('[data-confirm-message-delete]')).toBeVisible();

        await panel.locator('[data-cancel-message-delete]').click();
        await expect(panel).toHaveCount(0);
        expect(fixture.chatRequests.saves).toHaveLength(0);

        // Reopening starts at the first step again; the keyboard reaches the delete step too.
        await manageButton.click();
        await expect(panel.locator('[data-confirm-message-delete]')).toBeHidden();
        await panel.locator('[data-request-message-delete]').focus();
        await page.keyboard.press('Enter');
        await expect(question).toBeVisible();
        await panel.locator('[data-confirm-message-delete]').click();
        await expect.poll(() => fixture.chatRequests.saves.length).toBe(1);
        const savedMessages = fixture.chatRequests.saves[0].chat.filter(message => !message.chat_metadata);
        expect(savedMessages).toHaveLength(1);
        expect(savedMessages[0].mes).toContain('short 1:');
        await expect(panel).toHaveCount(0);
    });
});

test.describe('Modern chat sidebar list positions', () => {
    test.use({ viewport: desktopViewport });

    test('keeps the character and chat lists in place across sends and route switches', async ({ page }) => {
        const fixture = createChatUiFixture();
        const now = Date.now();
        for (let index = 1; index <= 36; index += 1) {
            const id = String(index).padStart(2, '0');
            const avatar = `filler-${id}.png`;
            fixture.characters.push({ avatar, name: `Filler ${id}`, data: { name: `Filler ${id}`, creator: 'Modern E2E' } });
            fixture.chatLists[avatar] = Array.from({ length: 14 }, (_, chatIndex) => {
                const chatId = `filler-${id}-chat-${String(chatIndex + 1).padStart(2, '0')}`;
                fixture.messagesByChat[chatId] = buildMessages(2, chatId);
                return { file_id: chatId, file_name: `${chatId}.jsonl`, chat_items: 2, file_size: '1 KB', last_mes: now - chatIndex * 60_000 };
            });
        }
        await mockChatUiRoutes(page, fixture);
        await mockGenerationBridge(page, fixture);
        await openChat(page);

        const entityList = '[data-chat-entity-list]';
        const fileList = '[data-chat-file-list]';
        await expect(page.locator(entityList)).toContainText('Filler 36');
        const target = await page.locator(entityList).evaluate(list => {
            list.scrollTop = 600;
            const listTop = list.getBoundingClientRect().top;
            const row = [...list.querySelectorAll('[data-select-character]')]
                .find(item => item.getBoundingClientRect().top - listTop >= 60);
            return { scrollTop: list.scrollTop, avatar: row?.getAttribute('data-select-character') || '' };
        });
        expect(target.scrollTop).toBeGreaterThan(300);
        expect(target.avatar).toMatch(/^filler-/);

        await page.locator(`[data-select-character="${target.avatar}"]`).click();
        const targetChat = `${target.avatar.replace('.png', '')}-chat-01`;
        await expect(page.locator(`[data-select-chat="${targetChat}"]`)).toHaveClass(/active/);
        await expect.poll(async () => (await readSidebarList(page, entityList)).activeId).toBe(target.avatar);
        expect(Math.abs((await readSidebarList(page, entityList)).scrollTop - target.scrollTop)).toBeLessThanOrEqual(2);

        // Scroll the chat-file list too, then send: neither list jumps back to the top.
        const fileScrollTop = await page.locator(fileList).evaluate(list => {
            list.scrollTop = 90;
            return list.scrollTop;
        });
        expect(fileScrollTop).toBeGreaterThan(40);
        await page.locator('[data-chat-input]').fill('keep my place');
        await page.locator('[data-send-message]').click();
        await expect(page.locator('.message-list')).toContainText('generated reply to keep my place');
        await expect(page.locator('[data-send-message]')).toContainText('发送');
        await waitForChatRouteSettled(page, 'generated reply to keep my place');
        expect(Math.abs((await readSidebarList(page, entityList)).scrollTop - target.scrollTop)).toBeLessThanOrEqual(2);
        expect(Math.abs((await readSidebarList(page, fileList)).scrollTop - fileScrollTop)).toBeLessThanOrEqual(2);

        // Leaving the route and coming back restores the character list and shows the active rows.
        await switchRoute(page, 'dashboard');
        await switchRoute(page, 'chat');
        await waitForChatRouteSettled(page, 'generated reply to keep my place');
        await expectSidebarListAt(page, entityList, { activeId: target.avatar, scrollTop: target.scrollTop });
        await expect.poll(async () => (await readSidebarList(page, fileList)).activeVisible).toBe(true);
        expect(await readPageScrollTop(page)).toBe(0);

        // Even when the active character had been scrolled out of view, re-entering reveals it in the list only.
        await page.locator(entityList).evaluate(list => {
            list.scrollTop = 0;
        });
        expect((await readSidebarList(page, entityList)).activeVisible).toBe(false);
        await switchRoute(page, 'dashboard');
        await switchRoute(page, 'chat');
        await waitForChatRouteSettled(page, 'generated reply to keep my place');
        await expect.poll(async () => (await readSidebarList(page, entityList)).activeVisible).toBe(true);
        expect((await readSidebarList(page, entityList)).scrollTop).toBeGreaterThan(0);
        expect(await readPageScrollTop(page)).toBe(0);
        expect(await readDocumentOverflow(page)).toBeLessThanOrEqual(1);
    });

    // The scroll controller on its own, on a synthetic list: positions this controller sets or the
    // browser clamps must never replace the reader's position.
    test('keeps the reader position through clamped restores and transient active rows', async ({ page }) => {
        await page.route('**/modern/chat-scroll-harness.html', route => route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><html><body style="margin:0"><div id="host"></div></body></html>',
        }));
        await page.goto('/modern/chat-scroll-harness.html');
        await page.evaluate(async () => {
            const { createChatScrollController } = await import('/modern/routes/chat-scroll.js');
            const host = document.getElementById('host');
            const controller = createChatScrollController({ root: document });
            const rows = active => Array.from({ length: 40 }, (_, index) => (
                `<button class="resource-row ${index === active ? 'active' : ''}" type="button" style="display:block;box-sizing:border-box;width:100%;height:50px;margin:0">row ${index}</button>`
            )).join('');
            // The chat route render: snapshot, then new markup (scrollTop 0) like innerHTML in the renderer.
            window.renderChatList = ({ active = 20, height = '300px' } = {}) => {
                controller.beforeRender();
                host.innerHTML = `<div class="resource-list" data-chat-entity-list="character" style="height:${height};overflow:auto">${rows(active)}</div>`;
            };
            // Another route replaces the content without the chat route's render.
            window.leaveChatRoute = () => {
                host.innerHTML = '<p>dashboard</p>';
            };
        });
        const list = page.locator('[data-chat-entity-list]');
        const readList = () => list.evaluate(element => {
            const active = element.querySelector('.resource-row.active');
            const top = active.offsetTop - element.scrollTop;
            return { scrollTop: element.scrollTop, activeVisible: top >= 0 && top + active.offsetHeight <= element.clientHeight };
        });
        const nextFrames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

        await page.evaluate(() => window.renderChatList());
        await list.evaluate(element => {
            element.scrollTop = 900;
        });
        await nextFrames();
        await page.evaluate(() => window.renderChatList());
        await expect.poll(readList).toEqual({ scrollTop: 900, activeVisible: true });

        // Re-entering while the list is not height-constrained yet: the browser clamps to 0. Neither
        // that render nor the next one may take 0 as the reader's position, and once the layout is
        // final the remembered position comes back without another render.
        await page.evaluate(() => window.leaveChatRoute());
        await page.evaluate(() => window.renderChatList({ height: 'auto' }));
        await nextFrames();
        expect((await readList()).scrollTop).toBe(0);
        await page.evaluate(() => window.renderChatList({ height: 'auto' }));
        await nextFrames();
        await list.evaluate(element => {
            element.style.height = '300px';
        });
        await expect.poll(readList).toEqual({ scrollTop: 900, activeVisible: true });
        await page.evaluate(() => window.renderChatList());
        await expect.poll(readList).toEqual({ scrollTop: 900, activeVisible: true });

        // A first render after re-entering that briefly marks another row active (selection still
        // being resolved) must not move the list away from the reader's position for good.
        await page.evaluate(() => window.leaveChatRoute());
        await page.evaluate(() => window.renderChatList({ active: 0 }));
        await nextFrames();
        await page.evaluate(() => window.renderChatList({ active: 20 }));
        await expect.poll(readList).toEqual({ scrollTop: 900, activeVisible: true });

        // A reader scroll away from the active row is kept within the route; re-entering reveals the row.
        await list.evaluate(element => {
            element.scrollTop = 0;
        });
        await nextFrames();
        await page.evaluate(() => window.renderChatList());
        await expect.poll(readList).toEqual({ scrollTop: 0, activeVisible: false });
        await page.evaluate(() => window.leaveChatRoute());
        await page.evaluate(() => window.renderChatList());
        await expect.poll(readList).toEqual({ scrollTop: 750, activeVisible: true });
    });
});

test.describe('Modern chat backups with indistinguishable owners', () => {
    test.use({ viewport: desktopViewport });

    test('labels backups whose file name fits several characters and confirms before restoring', async ({ page }) => {
        const fixture = createChatUiFixture();
        const now = Date.now();
        fixture.characters.push(
            { avatar: '钟离.png', name: '钟离', data: { name: '钟离', creator: 'Modern E2E' } },
            { avatar: '胡桃.png', name: '胡桃', data: { name: '胡桃', creator: 'Modern E2E' } },
            { avatar: 'UI自检角色A.png', name: 'UI自检角色A', data: { name: 'UI自检角色A', creator: 'Modern E2E' } },
        );
        fixture.chatLists['钟离.png'] = [{ file_id: 'zhongli-chat', file_name: 'zhongli-chat.jsonl', chat_items: 2, file_size: '1 KB', last_mes: now }];
        fixture.messagesByChat['zhongli-chat'] = buildMessages(2, 'zhongli');
        // The backend turns every character outside [a-z0-9] into '_': 钟离 and 胡桃 both become "__" (chat_ + __ + _ + timestamp).
        fixture.backups.push(
            { file_id: 'chat____20261010-120000', file_name: 'chat____20261010-120000.jsonl', chat_items: 4, file_size: '4 KB', last_mes: now - 500 },
            { file_id: 'chat_ui____a_20261010-130000', file_name: 'chat_ui____a_20261010-130000.jsonl', chat_items: 3, file_size: '3 KB', last_mes: now - 700 },
        );
        await mockChatUiRoutes(page, fixture);
        await openChat(page);

        await page.locator('[data-select-character="钟离.png"]').click();
        await expect(page.locator('.detail-title')).toHaveText('钟离');
        await page.locator('.page-head [data-chat-backups-toggle]').click();
        const drawer = page.locator('.chat-tools-drawer');
        const rows = drawer.locator('.backup-row');
        const shared = drawer.locator('[data-chat-backup-row="chat____20261010-120000.jsonl"]');
        // Still shown by default, but labelled with every possible owner.
        await expect(rows).toHaveCount(1);
        await expect(shared).toHaveAttribute('data-chat-backup-ambiguous', '');
        await expect(shared.locator('.backup-row-owner')).toHaveText('可能属于：角色「钟离」、角色「胡桃」');
        await expect(drawer.locator('[data-chat-backup-summary]')).toContainText('1 个与其他角色或群聊的备份文件名相同，无法确定归属');

        await shared.locator('[data-restore-chat-backup]').click();
        const confirm = drawer.locator('[data-chat-backup-restore-confirm]');
        await expect(confirm).toBeVisible();
        await expect(confirm).toContainText('可能属于：角色「钟离」、角色「胡桃」');
        await expect(confirm).toContainText('当前选中的是角色「钟离」');
        expect(fixture.chatRequests.imports).toHaveLength(0);
        await drawer.locator('[data-confirm-chat-backup-restore="chat____20261010-120000.jsonl"]').click();
        await expect.poll(() => fixture.chatRequests.imports.length).toBe(1);
        expect(fixture.chatRequests.imports[0]).toEqual({ fileName: 'chat____20261010-120000.jsonl', avatarUrl: '钟离.png' });
        await drawer.locator('[data-chat-backups-close]').click();

        // The other owner sees the same backup with itself listed first.
        await page.locator('[data-select-character="胡桃.png"]').click();
        await expect(page.locator('.detail-title')).toHaveText('胡桃');
        await page.locator('.page-head [data-chat-backups-toggle]').click();
        await expect(shared.locator('.backup-row-owner')).toHaveText('可能属于：角色「胡桃」、角色「钟离」');
        await drawer.locator('[data-chat-backups-close]').click();

        // A key that only one character produces stays unlabelled and restores directly.
        await page.locator('[data-select-character="UI自检角色A.png"]').click();
        await expect(page.locator('.detail-title')).toHaveText('UI自检角色A');
        await page.locator('.page-head [data-chat-backups-toggle]').click();
        const own = drawer.locator('[data-chat-backup-row="chat_ui____a_20261010-130000.jsonl"]');
        await expect(rows).toHaveCount(1);
        await expect(own.locator('.backup-row-owner')).toHaveCount(0);
        await expect(drawer.locator('[data-chat-backup-summary]')).not.toContainText('无法确定归属');
        await own.locator('[data-restore-chat-backup]').click();
        await expect.poll(() => fixture.chatRequests.imports.length).toBe(2);
        expect(fixture.chatRequests.imports[1]).toEqual({ fileName: 'chat_ui____a_20261010-130000.jsonl', avatarUrl: 'UI自检角色A.png' });
        await expect(drawer.locator('[data-chat-backup-restore-confirm]')).toHaveCount(0);
    });
});
