import { test, expect } from '@playwright/test';
import { createModernResourceFixture, mockModernWorkspace } from './modern-test-utils.js';

/* global document */

function fulfillJson(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

const customDeepSeekSettings = {
    main_api: 'openai',
    oai_settings: {
        chat_completion_source: 'custom',
        custom_model: 'deepseek-v4-flash',
        custom_url: 'https://api.deepseek.com',
        openai_max_tokens: 300,
    },
};

async function mockShellWorkspace(page, settings, secretState = {}) {
    const now = Date.now();
    const fixture = createModernResourceFixture({ settings, secretState });
    await mockModernWorkspace(page, fixture);
    await page.route('**/api/characters/chats', route => fulfillJson(route, [{
        file_id: 'alice-chat',
        file_name: 'alice-chat.jsonl',
        chat_items: 2,
        file_size: '1 KB',
        last_mes: now,
    }]));
    await page.route('**/api/chats/get', route => fulfillJson(route, [
        { chat_metadata: {}, user_name: 'Modern User', character_name: 'Alice Fixture' },
        { name: 'Modern User', is_user: true, mes: 'hello alice', send_date: now - 1000 },
        { name: 'Alice Fixture', is_user: false, mes: 'reply from alice', send_date: now },
    ]));
    await page.route('**/api/chats/search', route => fulfillJson(route, []));
    return fixture;
}

function boxesOverlap(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test.describe('Modern shell feedback', () => {
    test('names the effective chat completion provider in the topbar and dashboard', async ({ page }) => {
        await mockShellWorkspace(page, customDeepSeekSettings);

        await page.goto('/modern/?view=dashboard');

        const status = page.locator('#connectionStatus');
        await expect(status).toHaveText('Custom OpenAI-compatible · deepseek-v4-flash');
        await expect(status).toHaveAttribute('title', /主 API（main_api）：openai/);
        await expect(status).toHaveAttribute('title', /来源：custom/);
        await expect(status).toHaveAttribute('title', /模型：deepseek-v4-flash/);
        await expect(status).toHaveAttribute('title', /端点：https:\/\/api\.deepseek\.com/);

        const rows = page.locator('.connection-summary-list .kv-row');
        await expect(rows.nth(0)).toContainText('当前连接');
        await expect(rows.nth(0).locator('.kv-value')).toHaveText('Custom OpenAI-compatible · deepseek-v4-flash');
        await expect(rows.nth(0).locator('.kv-value')).toHaveAttribute('title', /main_api/);
        await expect(rows.nth(1)).toContainText('聊天补全（openai）');
        await expect(rows.nth(2)).toContainText('Custom OpenAI-compatible（custom）');
        await expect(page.locator('.dashboard-connection-warning')).toHaveCount(0);

        // The chip ellipsizes instead of squeezing the search box
        const chipFits = await status.evaluate(chip => chip.getBoundingClientRect().width <= 360.5);
        expect(chipFits).toBe(true);
    });

    test('names the text completion type and model in the topbar', async ({ page }) => {
        await mockShellWorkspace(page, {
            main_api: 'textgenerationwebui',
            chat_completion_source: 'openai',
            textgenerationwebui_settings: {
                type: 'ollama',
                ollama_model: 'llama3.1:8b',
                server_urls: { ollama: 'http://127.0.0.1:11434' },
            },
        });

        await page.goto('/modern/?view=dashboard');

        const status = page.locator('#connectionStatus');
        await expect(status).toHaveText('Ollama · llama3.1:8b');
        await expect(status).toHaveAttribute('title', /主 API（main_api）：textgenerationwebui/);
        await expect(status).toHaveAttribute('title', /来源：ollama/);
        await expect(page.locator('.connection-summary-list')).toContainText('文本补全（textgenerationwebui）');
        // A text completion connection has no chat completion source to miss
        await expect(page.locator('.dashboard-connection-warning')).toHaveCount(0);
    });

    test('reports configured settings separately from a passed connection test', async ({ page }) => {
        await mockShellWorkspace(page, customDeepSeekSettings, {
            api_key_custom: [{ id: 'saved', value: '********seek', label: 'saved', active: true }],
        });
        const generateResponses = [
            { choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] },
            { error: { message: 'Unauthorized' } },
        ];
        let generateCount = 0;
        await page.route('**/api/backends/chat-completions/generate', route => {
            const body = generateResponses[Math.min(generateCount, generateResponses.length - 1)];
            generateCount += 1;
            return fulfillJson(route, body);
        });

        await page.goto('/modern/?view=api');

        const diagnostics = page.locator('.api-diagnostic-list');
        const card = label => diagnostics.locator('.api-diagnostic-card', { has: page.locator('strong', { hasText: new RegExp(`^${label}$`) }) });
        await expect(card('连接测试').locator('.status-text')).toHaveText('未测试');
        await expect(card('主 API').locator('.status-text')).toHaveText('已配置');
        await expect(card('主 API')).toContainText('聊天补全（openai）');
        await expect(card('模型').locator('.status-text')).toHaveText('已配置');
        await expect(card('当前来源密钥').locator('.status-text')).toHaveText('已配置');
        await expect(diagnostics.locator('.status-text.success')).toHaveCount(0);
        await expect(diagnostics).not.toContainText('正常');
        await expect(page.locator('.panel', { hasText: '当前连接' }).first().locator('.panel-header .badge')).toHaveText('Custom OpenAI-compatible');

        await page.locator('[data-test-api]').click();
        await expect(card('连接测试').locator('.status-text')).toHaveText('可用');
        await expect(card('连接测试').locator('.status-text')).toHaveClass(/success/);
        await expect(card('主 API').locator('.status-text')).toHaveText('已配置');

        await page.locator('[data-test-api]').click();
        await expect(card('连接测试').locator('.status-text')).toHaveText('失败');
        await expect(card('连接测试').locator('.status-text')).toHaveClass(/danger/);
        await expect(card('连接测试')).toHaveClass(/needs-attention/);
        await expect(card('连接测试')).toContainText('Unauthorized');
    });

    for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }]) {
        test(`keeps toasts off the chat composer at ${viewport.width}x${viewport.height}`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await page.addInitScript(`
                Object.defineProperty(navigator, 'clipboard', {
                    configurable: true,
                    value: { writeText: async () => {} },
                });
            `);
            await mockShellWorkspace(page, customDeepSeekSettings);

            await page.goto('/modern/?view=chat');
            await expect(page.locator('.chat-thread')).toContainText('reply from alice');

            await page.locator('[data-copy-message="1"]').click();
            await page.locator('[data-copy-message="0"]').click();
            await expect(page.locator('.toast')).toHaveCount(2);
            // The narrow layout scrolls the page; visible toasts follow the composer when it scrolls into view
            await page.locator('.composer').scrollIntoViewIfNeeded();

            await expect.poll(async () => {
                const stackBox = await page.locator('#toastStack').boundingBox();
                const composerBox = await page.locator('.composer').boundingBox();
                return boxesOverlap(stackBox, composerBox);
            }, { message: 'toast stack does not cover the composer' }).toBe(false);

            for (const selector of ['[data-send-message]', '[data-continue-message]', '[data-regenerate-message]']) {
                const reachable = await page.locator(selector).evaluate(button => {
                    const box = button.getBoundingClientRect();
                    const topmost = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                    return Boolean(topmost && button.contains(topmost));
                });
                expect(reachable, `${selector} stays clickable while toasts are shown`).toBe(true);
            }
        });
    }

    test('keeps toasts in the bottom corner on routes without bottom actions', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await mockShellWorkspace(page, customDeepSeekSettings);

        await page.goto('/modern/?view=settings');
        await page.locator('[data-save-modern-preferences]').click();
        await expect(page.locator('.toast', { hasText: '界面偏好已保存' })).toBeVisible();

        const stackBox = await page.locator('#toastStack').boundingBox();
        expect(Math.round(900 - (stackBox.y + stackBox.height))).toBe(18);
    });
});
