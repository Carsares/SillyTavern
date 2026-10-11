import { test, expect } from '@playwright/test';
import { createModernResourceFixture, mockBridgeFrame, mockModernWorkspace } from './modern-test-utils.js';

/* global localStorage, document */

// 聊天输入框旁的连接标签（B1）：显示当前连接，点开后切换连接档案和最近用过的模型。业务规则（映射、精确匹配、跳过原因）由
// tests/modern-connection-profiles.test.js 覆盖，这里验证界面、保存请求、密钥切换，以及「先同步引擎再生成」的顺序。
// 页面在生成结束约 800 毫秒后会向引擎请求一次 getItemizedPrompt，所以对桥接调用只做过滤和先后比较，不断言整个列表。

const desktopViewport = { width: 1440, height: 900 };

function fulfillJson(route, body, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function postJson(route) {
    try {
        return route.request().postDataJSON();
    } catch {
        return {};
    }
}

function createDeferred() {
    /** @type {(value?: unknown) => void} */
    let resolve = () => {};
    const promise = new Promise(settle => {
        resolve = settle;
    });
    return { promise, resolve };
}

const claudeProfile = {
    id: 'p-claude',
    mode: 'cc',
    name: 'Claude 日常',
    api: 'claude',
    preset: 'Writer',
    model: 'claude-sonnet-4',
    'secret-id': 'claude-2',
    exclude: [],
};

const oobaProfile = {
    id: 'p-ooba',
    mode: 'tc',
    name: '本地 Ooba',
    api: 'ooba',
    'api-url': 'http://127.0.0.1:5001',
    model: 'local-model',
    instruct: 'ChatML',
    context: 'ChatML',
    exclude: [],
};

function baseSettings({ profiles = [claudeProfile, oobaProfile], selectedProfile = null, mainApi = 'openai' } = {}) {
    return {
        main_api: mainApi,
        chat_completion_source: 'custom',
        oai_settings: {
            chat_completion_source: 'custom',
            custom_model: 'deepseek-v4-flash',
            custom_url: 'https://api.example/v1',
            claude_model: 'claude-old',
            preset_settings_openai: 'Default',
            openai_max_tokens: 300,
            openai_max_context: 32000,
            temp_openai: 1,
            reverse_proxy: '',
        },
        textgenerationwebui_settings: {
            type: 'ooba',
            server_urls: { ooba: 'http://127.0.0.1:5000' },
            custom_model: 'local-model',
        },
        power_user: {
            personas: { 'persona-alpha.png': 'Alpha Persona' },
            persona_descriptions: { 'persona-alpha.png': { title: 'Primary identity', description: 'Default modern persona.' } },
            default_persona: 'persona-alpha.png',
        },
        extension_settings: { connectionManager: { profiles: structuredClone(profiles), selectedProfile } },
    };
}

function buildChatMessages(name) {
    const base = Date.now() - 60_000;
    const iso = offset => new Date(base + offset * 1000).toISOString();
    return [
        { name, is_user: false, is_system: false, send_date: iso(0), mes: 'Opening line.' },
        { name: 'Modern E2E User', is_user: true, is_system: false, send_date: iso(1), mes: 'first user message' },
        { name, is_user: false, is_system: false, send_date: iso(2), mes: 'first reply' },
    ];
}

function createConnectionFixture({ settings = baseSettings() } = {}) {
    const fixture = createModernResourceFixture();
    fixture.settings = settings;
    fixture.settingsBundle = {
        openai_setting_names: ['Default', 'Writer'],
        openai_settings: [
            JSON.stringify({ temperature: 1, openai_max_tokens: 300 }),
            JSON.stringify({ temperature: 0.7, openai_max_tokens: 800 }),
        ],
    };
    fixture.secretState = {
        api_key_custom: [{ id: 'custom-1', label: 'main', value: '****', active: true }],
        api_key_claude: [
            { id: 'claude-1', label: 'first', value: '****', active: true },
            { id: 'claude-2', label: 'backup', value: '****', active: false },
        ],
    };
    fixture.rotations = [];
    return fixture;
}

async function mockConnectionWorkspace(page, fixture) {
    await mockModernWorkspace(page, fixture);
    const now = Date.now();
    await page.route('**/api/characters/chats', route => fulfillJson(route, postJson(route).avatar_url === 'alice.png'
        ? [{ file_id: 'conn-chat', file_name: 'conn-chat.jsonl', chat_items: 3, file_size: '1 KB', last_mes: now }]
        : []));
    await page.route('**/api/chats/search', route => fulfillJson(route, []));
    await page.route('**/api/backups/chat/get', route => fulfillJson(route, []));
    await page.route('**/api/chats/get', route => fulfillJson(route, [
        { chat_metadata: { integrity: 'int-1' }, user_name: 'Modern E2E User', character_name: 'unused' },
        ...buildChatMessages('Alice Fixture'),
    ]));
    await page.route('**/api/chats/save', route => fulfillJson(route, { ok: true, integrity: 'int-2' }));
    await page.route('**/api/secrets/rotate', route => {
        const { key, id } = postJson(route);
        fixture.rotations.push({ key, id });
        // 与服务端一致：只有存在的 id 才会变成当前密钥
        if (fixture.secretState[key]?.some(item => item.id === id)) {
            fixture.secretState[key] = fixture.secretState[key].map(item => ({ ...item, active: item.id === id }));
        }
        return route.fulfill({ status: 204 });
    });
}

async function openChat(page) {
    await page.goto('/modern/?view=chat');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'chat');
    await expect(page.locator('.page-title')).toHaveText('聊天工作区');
    await expect(page.locator('[data-delete-chat]')).toBeVisible();
}

const chip = page => page.locator('[data-connection-chip]');
const popover = page => page.locator('[data-connection-popover]');

async function openPopover(page) {
    await chip(page).click();
    await expect(popover(page)).toBeVisible();
}

const lastSettingsSave = fixture => fixture.requests.settingsSave.at(-1);

test.describe('Chat connection chip', () => {
    test.use({ viewport: desktopViewport });

    test('shows the current connection in the composer meta row, ahead of the usage label', async ({ page }) => {
        const fixture = createConnectionFixture();
        await mockConnectionWorkspace(page, fixture);
        await mockBridgeFrame(page, {
            replies: {
                getItemizedPrompt: {
                    available: true,
                    mesId: 2,
                    mainApi: 'openai',
                    apiFriendlyName: 'Chat Completion',
                    modelUsed: 'deepseek-v4-flash',
                    presetName: 'Default',
                    tokenizer: 'tiktoken',
                    maxContext: 31700,
                    totalTokens: 1200,
                    parts: [{ name: '聊天历史', tokens: 700 }, { name: '主提示词', tokens: 500 }],
                },
            },
        });
        await page.addInitScript('localStorage.setItem("st-modern-inspector-open", "true")');
        await openChat(page);

        const meta = page.locator('.composer [data-composer-meta]');
        await expect(meta.locator('> :first-child')).toHaveAttribute('data-connection-switcher', '');
        await expect(chip(page)).toContainText('Custom OpenAI-compatible · deepseek-v4-flash');
        await expect(chip(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(chip(page)).toBeEnabled();
        await expect(chip(page)).toHaveAttribute('title', /main_api/);

        // 用量标签（A1）出现在同一行，排在连接标签之后，互不影响
        await page.locator('[data-chat-input]').fill('draft stays');
        await page.locator('.inspector-section [data-refresh-itemized-prompt]').click();
        await expect(meta.locator('[data-chat-usage-label]')).toContainText('上次发送');
        await expect(meta.locator('> :nth-child(2)')).toHaveAttribute('data-chat-usage-label', '');
        await expect(chip(page)).toContainText('deepseek-v4-flash');
        await expect(page.locator('[data-chat-input]')).toHaveValue('draft stays');
    });

    test('lists the profiles with the current one marked, the recent models, the create button and the API link', async ({ page }) => {
        const fixture = createConnectionFixture({ settings: baseSettings({ selectedProfile: 'p-claude' }) });
        await mockConnectionWorkspace(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openPopover(page);

        await expect(chip(page)).toHaveAttribute('aria-expanded', 'true');
        const claude = page.locator('[data-connection-profile-apply="p-claude"]');
        const ooba = page.locator('[data-connection-profile-apply="p-ooba"]');
        await expect(claude).toContainText('Claude 日常');
        await expect(claude).toContainText('Claude · claude-sonnet-4 · 预设 Writer');
        await expect(claude).toContainText('当前');
        await expect(claude).toHaveAttribute('aria-current', 'true');
        await expect(ooba).toContainText('本地 Ooba');
        await expect(ooba).toContainText('Text Generation WebUI / Ooba · local-model');
        await expect(ooba).not.toContainText('当前');

        // 当前来源（custom）的模型：没有记录时只有正在用的那个
        const currentModel = page.locator('[data-connection-model="deepseek-v4-flash"]');
        await expect(currentModel).toBeDisabled();
        await expect(currentModel).toContainText('当前');
        await expect(popover(page)).toContainText('Custom OpenAI-compatible');
        await expect(page.locator('[data-connection-create-open]')).toContainText('从当前连接创建档案');
        await expect(popover(page).locator('[data-route="api"]')).toContainText('打开 API 页');
        // 与旧版的差异写在界面上
        await expect(popover(page)).toContainText('精确匹配');
    });

    test('the popover opens above the composer, inside the window, and nothing covers it', async ({ page }) => {
        const fixture = createConnectionFixture();
        await mockConnectionWorkspace(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openPopover(page);

        const popoverBox = await popover(page).boundingBox();
        const inputBox = await page.locator('[data-chat-input]').boundingBox();
        expect(popoverBox.y).toBeGreaterThanOrEqual(0);
        // 展开在整个输入框上方，不盖住输入框
        expect(popoverBox.y + popoverBox.height).toBeLessThanOrEqual(inputBox.y);
        expect(popoverBox.x).toBeGreaterThanOrEqual(0);
        expect(popoverBox.x + popoverBox.width).toBeLessThanOrEqual(desktopViewport.width);

        const covered = await page.evaluate(({ x, y }) => {
            const element = document.elementFromPoint(x, y);
            return Boolean(element?.closest('[data-connection-popover]'));
        }, { x: popoverBox.x + popoverBox.width / 2, y: popoverBox.y + 24 });
        expect(covered).toBe(true);
    });

    test('opens and closes from the keyboard, with Esc, the close button and an outside click', async ({ page }) => {
        const fixture = createConnectionFixture();
        await mockConnectionWorkspace(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);

        await chip(page).focus();
        await page.keyboard.press('Enter');
        await expect(popover(page)).toBeVisible();
        // 焦点进入弹层，第一个可操作项是第一个档案
        await expect(page.locator('[data-connection-profile-apply="p-claude"]')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('[data-connection-profile-apply="p-ooba"]')).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('[data-connection-create-open]')).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(page.locator('[data-connection-profile-apply="p-ooba"]')).toBeFocused();

        await page.keyboard.press('Escape');
        await expect(popover(page)).toHaveCount(0);
        await expect(chip(page)).toBeFocused();
        await expect(chip(page)).toHaveAttribute('aria-expanded', 'false');

        await openPopover(page);
        await page.locator('[data-connection-close]').click();
        await expect(popover(page)).toHaveCount(0);
        await expect(chip(page)).toBeFocused();

        await openPopover(page);
        await chip(page).click();
        await expect(popover(page)).toHaveCount(0);

        await openPopover(page);
        await page.locator('.page-title').click();
        await expect(popover(page)).toHaveCount(0);
        // 点别处不会把焦点抢回标签
        await expect(chip(page)).not.toBeFocused();

        // 点输入框同样收起，并且点击本身照常生效
        await openPopover(page);
        await page.locator('[data-chat-input]').click();
        await expect(popover(page)).toHaveCount(0);
        await expect(page.locator('[data-chat-input]')).toBeFocused();
    });

    test('keeps the draft in the input when the popover opens and closes', async ({ page }) => {
        const fixture = createConnectionFixture();
        await mockConnectionWorkspace(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);

        await page.locator('[data-chat-input]').fill('half-written message');
        await openPopover(page);
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-chat-input]')).toHaveValue('half-written message');
    });

    test('an empty profile list explains itself and offers to create one', async ({ page }) => {
        const fixture = createConnectionFixture({ settings: baseSettings({ profiles: [] }) });
        await mockConnectionWorkspace(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openPopover(page);

        await expect(popover(page)).toContainText('还没有连接档案');
        await expect(page.locator('[data-connection-profile-apply]')).toHaveCount(0);
        await expect(page.locator('[data-connection-create-open]')).toBeVisible();
    });

    test('the link to the API page leaves the popover closed when coming back', async ({ page }) => {
        const fixture = createConnectionFixture();
        await mockConnectionWorkspace(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openPopover(page);

        await popover(page).locator('[data-route="api"]').click();
        await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'api');
        await page.locator('.nav [data-route="chat"], nav [data-route="chat"]').first().click();
        await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'chat');
        await expect(chip(page)).toBeVisible();
        await expect(popover(page)).toHaveCount(0);
    });

    test('is not rendered while no main API is selected', async ({ page }) => {
        const settings = baseSettings();
        delete settings.main_api;
        const fixture = createConnectionFixture({ settings });
        await mockConnectionWorkspace(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);

        await expect(page.locator('[data-connection-switcher]')).toHaveCount(0);
        await expect(page.locator('[data-composer-meta]')).toHaveCount(0);
    });
});

test.describe('Applying a connection profile from the chat', () => {
    test.use({ viewport: desktopViewport });

    test('saves the settings, switches the secret, syncs the engine and lists what was applied and skipped', async ({ page }) => {
        const fixture = createConnectionFixture();
        await mockConnectionWorkspace(page, fixture);
        const calls = await mockBridgeFrame(page);
        await openChat(page);
        await openPopover(page);

        await page.locator('[data-connection-profile-apply="p-claude"]').click();
        const result = page.locator('[data-connection-result]');
        await expect(result).toContainText('档案“Claude 日常”');
        await expect(result).toContainText('已应用 4 项');
        await expect(result.locator('.is-applied')).toHaveCount(4);
        await expect(result.locator('.is-applied', { hasText: '模型' })).toContainText('claude-sonnet-4');
        await expect(result.locator('.is-applied', { hasText: '密钥' })).toContainText('backup');
        await expect(result.locator('.is-skipped')).toHaveCount(0);

        const body = lastSettingsSave(fixture);
        expect(body.main_api).toBe('openai');
        expect(body.chat_completion_source).toBe('claude');
        expect(body.oai_settings).toMatchObject({
            chat_completion_source: 'claude',
            claude_model: 'claude-sonnet-4',
            preset_settings_openai: 'Writer',
            temp_openai: 0.7,
            openai_max_tokens: 800,
            custom_model: 'deepseek-v4-flash',
        });
        expect(body.extension_settings.connectionManager.selectedProfile).toBe('p-claude');
        expect(body.extension_settings.connectionManager.profiles).toHaveLength(2);
        expect(fixture.rotations).toEqual([{ key: 'api_key_claude', id: 'claude-2' }]);
        await expect.poll(() => calls.filter(call => call.action === 'reloadSettings').length).toBe(1);

        // 标签、弹层里的当前标记跟着更新，焦点回到刚点的档案
        await expect(chip(page)).toContainText('Claude · claude-sonnet-4');
        await expect(page.locator('[data-connection-profile-apply="p-claude"]')).toContainText('当前');
        await expect(page.locator('[data-connection-profile-apply="p-claude"]')).toBeFocused();
        await expect(page.locator('.toast, [role="status"]').filter({ hasText: '已切换到“Claude 日常”' }).first()).toBeVisible();
        // 切到的模型进了最近使用
        const recent = await page.evaluate(() => JSON.parse(localStorage.getItem('st-modern-recent-models') || '{}'));
        expect(recent['openai:claude']).toEqual(['claude-sonnet-4']);
    });

    test('lists the skipped items with their reasons and keeps the current profile unmarked when nothing matched', async ({ page }) => {
        const fixture = createConnectionFixture();
        await mockConnectionWorkspace(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openPopover(page);

        await page.locator('[data-connection-profile-apply="p-ooba"]').click();
        const result = page.locator('[data-connection-result]');
        await expect(result).toContainText('档案“本地 Ooba”');
        await expect(result).toContainText('已应用 3 项，跳过 2 项');
        await expect(result.locator('.is-skipped')).toHaveCount(2);
        const skippedItem = label => result.locator('.is-skipped', { has: page.locator('strong', { hasText: new RegExp(`^${label}$`) }) });
        await expect(skippedItem('指令模板')).toContainText('暂不支持');
        await expect(skippedItem('上下文模板')).toContainText('暂不支持');

        const body = lastSettingsSave(fixture);
        expect(body.main_api).toBe('textgenerationwebui');
        expect(body.textgenerationwebui_settings).toMatchObject({
            type: 'ooba',
            custom_model: 'local-model',
            server_urls: { ooba: 'http://127.0.0.1:5001' },
        });
        expect(fixture.rotations).toEqual([]);
        await expect(chip(page)).toContainText('Text Generation WebUI / Ooba · local-model');

        await result.locator('[data-connection-result-dismiss]').click();
        await expect(page.locator('[data-connection-result]')).toHaveCount(0);
    });

    test('warns next to the success when the engine could not be synced', async ({ page }) => {
        const fixture = createConnectionFixture();
        await mockConnectionWorkspace(page, fixture);
        await mockBridgeFrame(page, { replies: { reloadSettings: () => { throw new Error('engine offline'); } } });
        await openChat(page);
        await openPopover(page);

        await page.locator('[data-connection-profile-apply="p-claude"]').click();
        await expect(page.locator('[data-connection-result]')).toContainText('生成引擎未能同步：engine offline');
        expect(lastSettingsSave(fixture).oai_settings.claude_model).toBe('claude-sonnet-4');
    });

    test('the engine reload finishes before the next generate is posted, even when it is triggered by the keyboard', async ({ page }) => {
        const fixture = createConnectionFixture();
        await mockConnectionWorkspace(page, fixture);
        const reloadGate = createDeferred();
        const calls = await mockBridgeFrame(page, {
            replies: {
                reloadSettings: () => reloadGate.promise,
                generate: () => ({ chat: 'conn-chat.jsonl', messageCount: 4, saved: true }),
            },
        });
        await openChat(page);
        await openPopover(page);

        await page.locator('[data-connection-profile-apply="p-claude"]').click();
        await expect.poll(() => calls.filter(call => call.action === 'reloadSettings').length).toBe(1);

        // 切换进行中：标签禁用并说明原因，发送按钮禁用，状态行提示
        await expect(chip(page)).toBeDisabled();
        await expect(page.locator('[data-connection-chip-note]')).toHaveText('切换中');
        await expect(page.locator('[data-send-message]')).toBeDisabled();
        await expect(page.locator('[data-composer-status]')).toContainText('正在切换到“Claude 日常”');

        // 快捷键仍然可以发送：消息要等引擎同步完才会交给引擎
        await page.locator('[data-chat-input]').fill('use the new model');
        await page.locator('[data-chat-input]').press('Control+Enter');
        // Intentional wait: the assertion is that the engine request is NOT posted while the reload is still pending
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(400);
        expect(calls.filter(call => call.action === 'generate')).toHaveLength(0);

        reloadGate.resolve({ ok: true });
        await expect.poll(() => calls.filter(call => call.action === 'generate').length).toBe(1);
        const actions = calls.map(call => call.action);
        expect(actions.indexOf('reloadSettings')).toBeGreaterThanOrEqual(0);
        expect(actions.indexOf('reloadSettings')).toBeLessThan(actions.indexOf('generate'));
        await expect(chip(page)).toBeEnabled();
        // 新配置已经在保存的设置里，生成用的是它
        expect(lastSettingsSave(fixture).oai_settings.claude_model).toBe('claude-sonnet-4');
    });

    test('the chip is disabled with a reason while a reply is being generated', async ({ page }) => {
        const fixture = createConnectionFixture();
        await mockConnectionWorkspace(page, fixture);
        const generateGate = createDeferred();
        const calls = await mockBridgeFrame(page, {
            replies: { generate: async () => (await generateGate.promise, { chat: 'conn-chat.jsonl', messageCount: 4, saved: true }) },
        });
        await openChat(page);
        await openPopover(page);

        await page.locator('[data-chat-input]').fill('please answer');
        await page.locator('[data-send-message]').click();
        await expect.poll(() => calls.filter(call => call.action === 'generate').length).toBe(1);

        // 生成开始时展开着的弹层被收起，标签禁用并写明原因
        await expect(popover(page)).toHaveCount(0);
        await expect(chip(page)).toBeDisabled();
        await expect(page.locator('[data-connection-chip-note]')).toHaveText('生成中不可切换');
        await expect(chip(page)).toHaveAttribute('title', /生成中，等当前回复结束后再切换连接/);

        generateGate.resolve();
        await expect(chip(page)).toBeEnabled();
        await expect(page.locator('[data-connection-chip-note]')).toHaveCount(0);
        await openPopover(page);
        expect(fixture.requests.settingsSave).toHaveLength(0);
    });

    test('moves the secret back to skipped when the server did not confirm the switch', async ({ page }) => {
        const fixture = createConnectionFixture();
        await mockConnectionWorkspace(page, fixture);
        // 覆盖掉默认的 rotate 路由：回 204 但什么也不改（服务端对不存在的 id 就是这样）
        await page.route('**/api/secrets/rotate', route => {
            fixture.rotations.push(postJson(route));
            return route.fulfill({ status: 204 });
        });
        await mockBridgeFrame(page);
        await openChat(page);
        await openPopover(page);

        await page.locator('[data-connection-profile-apply="p-claude"]').click();
        const result = page.locator('[data-connection-result]');
        await expect(result.locator('.is-skipped', { hasText: '密钥' })).toContainText('没有确认');
        await expect(result.locator('.is-applied', { hasText: '密钥' })).toHaveCount(0);
    });
});

test.describe('Switching the model from the chat', () => {
    test.use({ viewport: desktopViewport });

    test('lists the recent models of the current source and switches to one on click', async ({ page }) => {
        const fixture = createConnectionFixture();
        await mockConnectionWorkspace(page, fixture);
        const calls = await mockBridgeFrame(page);
        await page.addInitScript(() => {
            localStorage.setItem('st-modern-recent-models', JSON.stringify({
                'openai:custom': ['deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-x'],
                'openai:claude': ['claude-other'],
            }));
        });
        await openChat(page);
        await openPopover(page);

        const models = popover(page).locator('[data-connection-model]');
        await expect(models).toHaveCount(3);
        // 正在用的排第一并标明当前，别的来源的记录不出现
        await expect(models.nth(0)).toHaveAttribute('data-connection-model', 'deepseek-v4-flash');
        await expect(models.nth(0)).toBeDisabled();
        await expect(models.nth(1)).toHaveAttribute('data-connection-model', 'deepseek-v4-pro');
        await expect(models.nth(2)).toHaveAttribute('data-connection-model', 'gpt-x');
        await expect(popover(page)).not.toContainText('claude-other');

        await models.nth(1).click();
        await expect(chip(page)).toContainText('Custom OpenAI-compatible · deepseek-v4-pro');
        const body = lastSettingsSave(fixture);
        expect(body.oai_settings.custom_model).toBe('deepseek-v4-pro');
        expect(body.oai_settings.claude_model).toBe('claude-old');
        expect(body.main_api).toBe('openai');
        await expect.poll(() => calls.filter(call => call.action === 'reloadSettings').length).toBe(1);

        await expect(page.locator('[data-connection-result]')).toContainText('已切换到 deepseek-v4-pro');
        const recent = await page.evaluate(() => JSON.parse(localStorage.getItem('st-modern-recent-models')));
        expect(recent['openai:custom']).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash', 'gpt-x']);
        expect(recent['openai:claude']).toEqual(['claude-other']);
    });

    test('works for text completion too, and says so when the API has no model field to switch', async ({ page }) => {
        const fixture = createConnectionFixture({ settings: baseSettings({ mainApi: 'textgenerationwebui' }) });
        await mockConnectionWorkspace(page, fixture);
        await mockBridgeFrame(page);
        await page.addInitScript(() => {
            localStorage.setItem('st-modern-recent-models', JSON.stringify({ 'textgenerationwebui:ooba': ['local-big', 'local-model'] }));
        });
        await openChat(page);
        await expect(chip(page)).toContainText('Text Generation WebUI / Ooba · local-model');
        await openPopover(page);

        await page.locator('[data-connection-model="local-big"]').click();
        await expect(chip(page)).toContainText('local-big');
        expect(lastSettingsSave(fixture).textgenerationwebui_settings.custom_model).toBe('local-big');
        expect(lastSettingsSave(fixture).oai_settings.custom_model).toBe('deepseek-v4-flash');
    });

    test('an API without a model field only offers the API page', async ({ page }) => {
        const settings = baseSettings({ mainApi: 'novel' });
        const fixture = createConnectionFixture({ settings });
        await mockConnectionWorkspace(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openPopover(page);

        await expect(popover(page)).toContainText('当前 API 不能在这里换模型');
        await expect(page.locator('[data-connection-model]')).toHaveCount(0);
    });
});

test.describe('Creating a profile from the current connection in the chat', () => {
    test.use({ viewport: desktopViewport });

    test('validates the name inline, saves the profile, selects it and marks it as current', async ({ page }) => {
        const fixture = createConnectionFixture();
        await mockConnectionWorkspace(page, fixture);
        const calls = await mockBridgeFrame(page);
        await openChat(page);
        await openPopover(page);

        await page.locator('[data-connection-create-open]').click();
        const nameInput = page.locator('[data-connection-create-name]');
        await expect(nameInput).toBeFocused();
        await expect(nameInput).toHaveValue('custom deepseek-v4-flash - Default');

        // 空名称和重名都在表单里提示，不发请求，也没有 window.confirm / alert
        page.on('dialog', dialog => {
            throw new Error(`unexpected dialog: ${dialog.message()}`);
        });
        await nameInput.fill('   ');
        await nameInput.press('Enter');
        await expect(page.locator('[data-connection-error]')).toContainText('请填写档案名称');
        await expect(nameInput).toHaveAttribute('aria-invalid', 'true');
        await nameInput.fill('Claude 日常');
        await nameInput.press('Enter');
        await expect(page.locator('[data-connection-error]')).toContainText('已经有名为“Claude 日常”的档案');
        expect(fixture.requests.settingsSave).toHaveLength(0);

        // 重新输入就撤掉错误提示
        await nameInput.fill('我的 DeepSeek');
        await expect(page.locator('[data-connection-error]')).toHaveCount(0);
        await nameInput.press('Enter');

        await expect(page.locator('[data-connection-profile-apply]')).toHaveCount(3);
        const created = page.locator('.connection-option', { hasText: '我的 DeepSeek' });
        await expect(created).toContainText('当前');
        await expect(created).toContainText('Custom OpenAI-compatible · deepseek-v4-flash · 预设 Default');

        const manager = lastSettingsSave(fixture).extension_settings.connectionManager;
        expect(manager.profiles).toHaveLength(3);
        const profile = manager.profiles.at(-1);
        expect(profile).toMatchObject({
            name: '我的 DeepSeek',
            mode: 'cc',
            api: 'custom',
            preset: 'Default',
            model: 'deepseek-v4-flash',
            'api-url': 'https://api.example/v1',
            'secret-id': 'custom-1',
            exclude: [],
        });
        expect(profile.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(manager.selectedProfile).toBe(profile.id);
        // 其他设置原样保留
        expect(lastSettingsSave(fixture).oai_settings.custom_model).toBe('deepseek-v4-flash');
        await expect.poll(() => calls.filter(call => call.action === 'reloadSettings').length).toBe(1);
        await expect(page.locator('[data-connection-create-open]')).toBeFocused();
    });

    test('cancel closes the form without saving', async ({ page }) => {
        const fixture = createConnectionFixture();
        await mockConnectionWorkspace(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openPopover(page);

        await page.locator('[data-connection-create-open]').click();
        await expect(page.locator('[data-connection-create-name]')).toBeVisible();
        await page.locator('[data-connection-create-cancel]').click();
        await expect(page.locator('[data-connection-create-name]')).toHaveCount(0);
        await expect(page.locator('[data-connection-create-open]')).toBeFocused();
        expect(fixture.requests.settingsSave).toHaveLength(0);

        // Esc 在表单里直接收起整个弹层
        await page.locator('[data-connection-create-open]').click();
        await page.keyboard.press('Escape');
        await expect(popover(page)).toHaveCount(0);
        await openPopover(page);
        await expect(page.locator('[data-connection-create-name]')).toHaveCount(0);
    });
});
