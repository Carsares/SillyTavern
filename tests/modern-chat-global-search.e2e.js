import { test, expect } from '@playwright/test';

/* global window, requestAnimationFrame */

import { mockBridgeFrame } from './modern-test-utils.js';

function fulfillJson(route, body, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function stripJsonlExtension(value) {
    return String(value || '').replace(/\.jsonl$/i, '');
}

function chatItem(chatId, messages, lastMes) {
    return { file_id: chatId, file_name: `${chatId}.jsonl`, chat_items: messages.length, file_size: '1 KB', last_mes: lastMes };
}

function snippet(text, highlights, extra = {}) {
    return { index: 1, name: 'Mock Character', is_user: false, send_date: '2026-01-02T03:04:05.000Z', text, highlights, ...extra };
}

function hit(overrides) {
    return {
        kind: 'character',
        avatar: 'mock.png',
        entityName: 'mock',
        file_id: 'mock-newest',
        file_name: 'mock-newest.jsonl',
        file_size: '1 KB',
        message_count: 2,
        last_mes: '2026-01-02T03:04:05.000Z',
        fileNameMatch: false,
        matchCount: 1,
        snippets: [snippet('a dragon appears', [[2, 8]])],
        ...overrides,
    };
}

function searchAllResponse(results, overrides = {}) {
    return { results, scannedFiles: 6, totalFiles: 6, partial: false, partialReason: '', elapsedMs: 42, ...overrides };
}

function createFixture() {
    const now = Date.now();
    const messagesByChat = {
        'mock-newest': [
            { name: 'Modern User', is_user: true, mes: 'mock newest context', send_date: now - 6000 },
            { name: 'Mock Character', is_user: false, mes: 'mock newest reply', send_date: now - 5000 },
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
            'mock.png': ['mock-newest'],
            'second.png': ['second-older'],
            'group:group-alpha': ['group-newest', 'group-older'],
        },
        lastMes: { 'mock-newest': now - 5000, 'second-older': now - 8500, 'group-newest': now - 1000, 'group-older': now - 9000 },
        messagesByChat,
        // What POST /api/chats/search-all answers: an object, or a function (body) => object | Promise<object>
        searchAll: searchAllResponse([]),
        requests: { searchAll: [], search: [], chatGet: [], groupGet: [] },
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
    await mockBridgeFrame(page);
    await page.route('**/csrf-token', route => fulfillJson(route, { token: 'modern-chat-search-token' }));
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
        fixture.requests.search.push(payload);
        return fulfillJson(route, listChats(fixture, payload.group_id ? `group:${payload.group_id}` : payload.avatar_url));
    });
    await page.route('**/api/chats/search-all', async route => {
        const body = route.request().postDataJSON();
        fixture.requests.searchAll.push(body);
        const answer = typeof fixture.searchAll === 'function' ? await fixture.searchAll(body) : fixture.searchAll;
        // A request the page gave up on (stale search) can't be answered any more
        await fulfillJson(route, answer, fixture.searchAllStatus || 200).catch(() => {});
    });
    await page.route('**/api/chats/get', route => {
        const payload = route.request().postDataJSON();
        fixture.requests.chatGet.push(payload);
        return fulfillJson(route, chatResponse(fixture, payload?.file_name));
    });
    await page.route('**/api/chats/group/get', route => {
        const payload = route.request().postDataJSON();
        fixture.requests.groupGet.push(payload);
        return fulfillJson(route, chatResponse(fixture, payload?.id));
    });
}

function urlParams(page) {
    return Object.fromEntries(new URL(page.url()).searchParams);
}

async function openChatPage(page) {
    await page.goto('/modern/?view=chat');
    await expect(page.locator('.chat-thread')).toContainText('mock newest reply');
}

async function searchAll(page, query) {
    await page.locator('[data-chat-search-scope="all"]').click();
    await page.locator('[data-chat-search-input]').fill(query);
    await page.locator('[data-chat-search-input]').press('Enter');
}

test.describe('Modern chat search across characters and groups', () => {
    test('groups the results by character and group and shows highlighted, escaped snippets', async ({ page }) => {
        const fixture = createFixture();
        fixture.searchAll = searchAllResponse([
            hit({
                snippets: [
                    snippet('<img src=x onerror="window.__chatSearchXss=1"> a dragon & <b>bold</b>', [[49, 55], [56, 57]]),
                    snippet('another dragon', [[8, 14]], { name: 'Modern User', is_user: true }),
                ],
                matchCount: 4,
            }),
            hit({ avatar: 'second.png', entityName: 'second', file_id: 'second-older', file_name: 'second-older.jsonl', message_count: 7, snippets: [snippet('dragon in second', [[0, 6]])] }),
            hit({ kind: 'group', avatar: undefined, groupId: 'group-alpha', entityName: 'Alpha Group', file_id: 'group-older', file_name: 'group-older.jsonl', snippets: [snippet('group dragon', [[6, 12]])] }),
            hit({ avatar: 'second.png', entityName: 'second', file_id: 'second-notes-dragon', file_name: 'second-notes-dragon.jsonl', fileNameMatch: true, matchCount: 0, snippets: [] }),
        ]);
        await mockChatWorkspace(page, fixture);
        await openChatPage(page);

        // The current scope keeps the old behavior until the switch is used
        await expect(page.locator('[data-chat-search-scope="current"]')).toHaveClass(/active/u);
        await expect(page.locator('[data-chat-search-input]')).toHaveAttribute('placeholder', '搜索文件名和消息内容');

        await searchAll(page, 'dragon');

        await expect.poll(() => fixture.requests.searchAll).toEqual([{ query: 'dragon', limit: 50, snippetsPerChat: 3 }]);
        await expect(page.locator('[data-chat-search-scope="all"]')).toHaveClass(/active/u);
        await expect(page.locator('.chat-global-results')).toBeVisible();
        // The sidebar is rebuilt while searching; the cursor stays in the search box so the keyword can be refined
        await expect(page.locator('[data-chat-search-input]')).toBeFocused();
        await expect(page.locator('.chat-browser-panel').nth(1).locator('.panel-title')).toHaveText('全部聊天');
        await expect(page.locator('.chat-browser-panel').nth(1).locator('.panel-subtitle')).toHaveText('4 个会话');
        await expect(page.locator('[data-chat-global-summary]')).toContainText('已扫描 6 个聊天文件 · 用时 42 毫秒');
        await expect(page.locator('[data-chat-global-partial]')).toHaveCount(0);

        // The character name comes from the loaded cards, not from the file name the backend sends
        await expect(page.locator('[data-chat-global-entity]')).toHaveCount(3);
        const mockGroup = page.locator('[data-chat-global-entity="character:mock.png"]');
        await expect(mockGroup.locator('.chat-global-group-title')).toContainText('Mock Character');
        await expect(mockGroup.locator('.chat-global-group-title')).toContainText('1 个会话');
        const secondGroup = page.locator('[data-chat-global-entity="character:second.png"]');
        await expect(secondGroup.locator('.chat-global-group-title')).toContainText('Second Character');
        await expect(secondGroup.locator('.chat-global-hit')).toHaveCount(2);
        await expect(page.locator('[data-chat-global-entity="group:group-alpha"] .chat-global-group-title')).toContainText('Alpha Group');

        // Snippet text is escaped; only the backend's ranges become <mark>
        const firstHit = mockGroup.locator('.chat-global-hit');
        await expect(firstHit.locator('.chat-global-snippet').first()).toContainText('<img src=x onerror="window.__chatSearchXss=1">');
        await expect(firstHit.locator('.chat-global-snippet').first()).toContainText('& <b>bold</b>');
        await expect(firstHit.locator('.chat-global-snippet').first().locator('mark')).toHaveText(['dragon', '&']);
        await expect(firstHit.locator('.chat-global-snippet').nth(1).locator('mark')).toHaveText('dragon');
        await expect(firstHit.locator('.chat-global-snippet-name').nth(1)).toHaveText('Modern User');
        await expect(firstHit).toContainText('命中 4 条消息');
        await expect(firstHit).toContainText('还有 2 条命中消息');
        await expect(page.locator('.chat-global-results img[src="x"], .chat-global-results b')).toHaveCount(0);
        expect(await page.evaluate(() => window.__chatSearchXss)).toBeUndefined();

        // A chat found only by its file name says so
        await expect(secondGroup.locator('.chat-global-hit', { hasText: 'second-notes-dragon' })).toContainText('文件名匹配');
        await expect(secondGroup.locator('.chat-global-hit', { hasText: 'second-notes-dragon' }).locator('.chat-global-snippet')).toHaveCount(0);
    });

    test('opens a character result and a group result with the matching URL and chat request', async ({ page }) => {
        const fixture = createFixture();
        fixture.searchAll = searchAllResponse([
            hit({ avatar: 'second.png', entityName: 'second', file_id: 'second-older', file_name: 'second-older.jsonl' }),
            hit({ kind: 'group', avatar: undefined, groupId: 'group-alpha', entityName: 'Alpha Group', file_id: 'group-older', file_name: 'group-older.jsonl' }),
        ]);
        await mockChatWorkspace(page, fixture);
        await openChatPage(page);
        expect(urlParams(page)).toMatchObject({ view: 'chat', char: 'mock.png', chat: 'mock-newest' });
        fixture.requests.chatGet.length = 0;

        await searchAll(page, 'dragon');
        await page.locator('[data-open-character-chat="second.png"][data-open-chat-file="second-older"]').click();

        await expect(page.locator('.chat-thread')).toContainText('second older reply');
        await expect.poll(() => urlParams(page)).toMatchObject({ view: 'chat', char: 'second.png', chat: 'second-older' });
        expect(fixture.requests.chatGet.at(-1)).toMatchObject({ avatar_url: 'second.png', file_name: 'second-older' });
        // The results stay in the sidebar so the next hit is one click away, and the opened chat is marked
        await expect(page.locator('[data-chat-search-scope="all"]')).toHaveClass(/active/u);
        await expect(page.locator('[data-open-chat-file="second-older"]')).toHaveClass(/active/u);

        await page.locator('[data-open-group-chat="group-alpha"][data-open-chat-file="group-older"]').click();

        await expect(page.locator('.chat-thread')).toContainText('group older reply');
        await expect.poll(() => urlParams(page)).toEqual({ view: 'chat', group: 'group-alpha', chat: 'group-older' });
        expect(fixture.requests.groupGet.at(-1)).toEqual({ id: 'group-older' });
        await expect(page.locator('[data-open-chat-file="group-older"]')).toHaveClass(/active/u);
        await expect(page.locator('[data-open-chat-file="second-older"]')).not.toHaveClass(/active/u);

        // Reloading restores the chat that was opened from the results
        await page.reload();
        await expect(page.locator('.chat-thread')).toContainText('group older reply');
    });

    test('ignores the response of a search that was replaced by a newer one', async ({ page }) => {
        const fixture = createFixture();
        let releaseSlow = () => {};
        let slowAnswered = false;
        const slowGate = new Promise((resolve) => {
            releaseSlow = resolve;
        });
        const answers = {
            slow: async () => {
                await slowGate;
                slowAnswered = true;
                return searchAllResponse([hit({ file_id: 'slow-chat', file_name: 'slow-chat.jsonl' })]);
            },
            fast: async () => searchAllResponse([hit({ avatar: 'second.png', entityName: 'second', file_id: 'second-older', file_name: 'second-older.jsonl' })]),
        };
        fixture.searchAll = body => answers[body.query]();
        await mockChatWorkspace(page, fixture);
        await openChatPage(page);

        await searchAll(page, 'slow');
        await expect(page.locator('.chat-global-status')).toContainText('正在扫描');
        await expect.poll(() => fixture.requests.searchAll.map(body => body.query)).toEqual(['slow']);

        await page.locator('[data-chat-search-input]').fill('fast');
        await page.locator('[data-chat-search-input]').press('Enter');
        await expect(page.locator('[data-open-chat-file="second-older"]')).toBeVisible();
        await expect(page.locator('[data-chat-search-input]')).toHaveValue('fast');

        releaseSlow();
        // Give the late response a chance to (wrongly) replace the results: let the page render twice after it was sent
        await expect.poll(() => slowAnswered).toBe(true);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

        await expect(page.locator('[data-open-chat-file="slow-chat"]')).toHaveCount(0);
        await expect(page.locator('[data-open-chat-file="second-older"]')).toBeVisible();
        await expect(page.locator('.chat-global-status')).toHaveCount(0);
        expect(fixture.requests.searchAll.map(body => body.query)).toEqual(['slow', 'fast']);
    });

    test('tells when the results are incomplete', async ({ page }) => {
        const fixture = createFixture();
        fixture.searchAll = searchAllResponse([hit({})], { partial: true, partialReason: 'timeout', scannedFiles: 120, totalFiles: 900, elapsedMs: 8002 });
        await mockChatWorkspace(page, fixture);
        await openChatPage(page);

        await searchAll(page, 'dragon');

        await expect(page.locator('[data-chat-global-partial]')).toContainText('结果不完整');
        await expect(page.locator('[data-chat-global-partial]')).toContainText('只扫描了 120 / 900 个聊天文件');
        await expect(page.locator('[data-chat-global-summary]')).toHaveText('已扫描 120 / 900 个聊天文件 · 用时 8.0 秒');
        await expect(page.locator('[data-chat-global-entity]')).toHaveCount(1);

        fixture.searchAll = searchAllResponse([hit({})], { partial: true, partialReason: 'limit', scannedFiles: 300, totalFiles: 900 });
        await page.locator('[data-chat-search-run]').click();
        await expect(page.locator('[data-chat-global-partial]')).toContainText('显示上限');

        fixture.searchAll = searchAllResponse([], { partial: true, partialReason: 'timeout', scannedFiles: 10, totalFiles: 900 });
        await page.locator('[data-chat-search-run]').click();
        await expect(page.locator('[data-chat-global-partial]')).toContainText('结果不完整');
        await expect(page.locator('.chat-global-results')).toContainText('没有找到包含“dragon”的聊天');

        fixture.searchAll = searchAllResponse([hit({})]);
        await page.locator('[data-chat-search-run]').click();
        await expect(page.locator('[data-chat-global-entity]')).toHaveCount(1);
        await expect(page.locator('[data-chat-global-partial]')).toHaveCount(0);
    });

    test('checks the keyword before searching and reports a failed search', async ({ page }) => {
        const fixture = createFixture();
        await mockChatWorkspace(page, fixture);
        await openChatPage(page);

        await searchAll(page, 'a');
        await expect(page.locator('.chat-global-notice.is-error')).toContainText('至少输入 2 个字符');
        expect(fixture.requests.searchAll).toEqual([]);

        // One CJK character is a word of its own
        fixture.searchAll = searchAllResponse([hit({ snippets: [snippet('远处的龙在沉睡', [[3, 4]])] })]);
        await page.locator('[data-chat-search-input]').fill('龙');
        await page.locator('[data-chat-search-input]').press('Enter');
        await expect(page.locator('.chat-global-snippet mark')).toHaveText('龙');
        expect(fixture.requests.searchAll.map(body => body.query)).toEqual(['龙']);

        fixture.searchAllStatus = 500;
        fixture.searchAll = { error: 'Search failed' };
        await page.locator('[data-chat-search-input]').fill('dragon');
        await page.locator('[data-chat-search-input]').press('Enter');
        await expect(page.locator('.chat-global-notice.is-error')).toBeVisible();
        await expect(page.locator('.toast-stack')).toContainText('全部聊天搜索失败');

        await page.locator('[data-chat-search-clear]').click();
        await expect(page.locator('[data-chat-search-input]')).toHaveValue('');
        await expect(page.locator('.chat-global-results')).toContainText('输入关键词');
    });

    test('keeps the current-scope search and the two keywords apart', async ({ page }) => {
        const fixture = createFixture();
        await mockChatWorkspace(page, fixture);
        await openChatPage(page);

        await page.locator('[data-chat-search-input]').fill('newest');
        await page.locator('[data-chat-search-input]').press('Enter');
        await expect.poll(() => fixture.requests.search.at(-1)).toEqual({ query: 'newest', avatar_url: 'mock.png', group_id: null });
        expect(fixture.requests.searchAll).toEqual([]);

        // Switching to「全部」starts from the keyword that was typed, but searches only on request
        await page.locator('[data-chat-search-scope="all"]').click();
        await expect(page.locator('[data-chat-search-input]')).toHaveValue('newest');
        await expect(page.locator('.chat-global-results')).toContainText('输入关键词');
        expect(fixture.requests.searchAll).toEqual([]);

        fixture.searchAll = searchAllResponse([hit({})]);
        await page.locator('[data-chat-search-input]').fill('dragon');
        await page.locator('[data-chat-search-run]').click();
        await expect(page.locator('[data-chat-global-entity]')).toHaveCount(1);

        await page.locator('[data-chat-search-scope="current"]').click();
        await expect(page.locator('[data-chat-search-input]')).toHaveValue('newest');
        await expect(page.locator('[data-chat-file-list="mock.png"]')).toBeVisible();
        await expect(page.locator('[data-chat-global-entity]')).toHaveCount(0);

        await page.locator('[data-chat-search-scope="all"]').click();
        await expect(page.locator('[data-chat-search-input]')).toHaveValue('dragon');
        await expect(page.locator('[data-chat-global-entity]')).toHaveCount(1);
    });
});

test.describe('Modern command palette entry for the chat search across characters and groups', () => {
    test('adds a first row that searches all chats once the query has two characters', async ({ page }) => {
        const fixture = createFixture();
        fixture.searchAll = searchAllResponse([hit({})]);
        await mockChatWorkspace(page, fixture);
        await page.goto('/modern/?view=dashboard');
        await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');

        await page.keyboard.press('Control+K');
        await page.locator('#paletteSearch').fill('d');
        await expect(page.locator('#paletteResults [data-command-search-all]')).toHaveCount(0);

        await page.locator('#paletteSearch').fill('dragon');
        const row = page.locator('#paletteResults .command-row').first();
        await expect(row).toHaveAttribute('data-command-search-all', 'dragon');
        await expect(row).toContainText('在全部聊天中搜索 “dragon”');

        await row.click();

        await expect(page.locator('#commandPalette')).toBeHidden();
        await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'chat');
        await expect(page.locator('[data-chat-search-scope="all"]')).toHaveClass(/active/u);
        await expect(page.locator('[data-chat-search-input]')).toHaveValue('dragon');
        await expect(page.locator('[data-chat-global-entity]')).toHaveCount(1);
        expect(fixture.requests.searchAll).toEqual([{ query: 'dragon', limit: 50, snippetsPerChat: 3 }]);

        // The query text is shown as text, not parsed as HTML
        await page.keyboard.press('Control+K');
        await page.locator('#paletteSearch').fill('<b>x</b>');
        await expect(page.locator('#paletteResults .command-row').first()).toContainText('在全部聊天中搜索 “<b>x</b>”');
        await expect(page.locator('#paletteResults b')).toHaveCount(0);
    });

    test('keeps Enter on the first matching command and searches on Enter when nothing matches', async ({ page }) => {
        const fixture = createFixture();
        fixture.searchAll = searchAllResponse([hit({})]);
        await mockChatWorkspace(page, fixture);
        await page.goto('/modern/?view=dashboard');
        await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');

        await page.keyboard.press('Control+K');
        await page.locator('#paletteSearch').fill('Mock Char');
        await expect(page.locator('#paletteResults [data-command-route="characters"]')).toContainText('Mock Character');
        await expect(page.locator('#paletteResults [data-command-search-all]')).not.toHaveAttribute('data-command-route', /.*/u);
        await page.keyboard.press('Enter');
        await expect(page.locator('#commandPalette')).toBeHidden();
        await expect(page.locator('.page-title')).toHaveText('角色库');
        expect(fixture.requests.searchAll).toEqual([]);

        await page.keyboard.press('Control+K');
        await page.locator('#paletteSearch').fill('zzzz nothing matches');
        await expect(page.locator('#paletteResults .command-row')).toHaveCount(1);
        await page.keyboard.press('Enter');
        await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'chat');
        await expect(page.locator('[data-chat-global-entity]')).toHaveCount(1);
        expect(fixture.requests.searchAll).toEqual([{ query: 'zzzz nothing matches', limit: 50, snippetsPerChat: 3 }]);
    });
});
