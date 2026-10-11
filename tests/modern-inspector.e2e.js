import { test, expect } from '@playwright/test';
import { mockBridgeFrame } from './modern-test-utils.js';

/* global document, window */

function fulfillJson(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

// openPreference seeds the 设置「默认展开上下文抽屉」preference (the pre-upgrade single key) on every load;
// null leaves storage alone
async function mockModernInspectorWorkspace(page, { openPreference = 'true', oaiSettings = {} } = {}) {
    const now = Date.now();
    if (openPreference !== null) {
        await page.addInitScript(`localStorage.setItem("st-modern-inspector-open", "${openPreference}")`);
    }
    await page.route('**/csrf-token', route => fulfillJson(route, { token: 'modern-inspector-token' }));
    await page.route('**/api/users/me', route => fulfillJson(route, { name: 'Modern Inspector User', handle: 'inspector-user' }));
    await page.route('**/api/settings/get', route => fulfillJson(route, {
        settings: JSON.stringify({
            main_api: 'openai',
            chat_completion_source: 'siliconflow',
            power_user: {
                personas: {
                    'inspector-persona.png': 'Inspector Persona',
                },
                persona_descriptions: {
                    'inspector-persona.png': {
                        title: 'Inspector Title',
                        description: 'Persona description',
                    },
                },
                default_persona: 'inspector-persona.png',
            },
            oai_settings: {
                chat_completion_source: 'siliconflow',
                siliconflow_model: 'deepseek-ai/DeepSeek-V3',
                preset_settings_openai: 'Inspector Preset',
                ...oaiSettings,
            },
        }),
        openai_setting_names: ['Inspector Preset'],
        openai_settings: [JSON.stringify({ chat_completion_source: 'siliconflow' })],
        textgenerationwebui_preset_names: [],
        textgenerationwebui_presets: [],
        request_compression: {
            enabled: true,
        },
    }));
    await page.route('**/api/characters/all', route => fulfillJson(route, [{
        avatar: 'mock.png',
        name: 'Mock Character',
        data: {
            name: 'Mock Character',
            creator: 'Inspector E2E',
        },
    }]));
    await page.route('**/api/groups/all', route => fulfillJson(route, [{
        id: 'inspector-group',
        name: 'Inspector Group',
        members: ['mock.png', 'other.png'],
    }]));
    await page.route('**/api/worldinfo/list', route => fulfillJson(route, [{ file_id: 'InspectorWorld', name: 'InspectorWorld' }]));
    await page.route('**/api/worldinfo/get', route => fulfillJson(route, {
        entries: {
            1: { uid: 1, comment: 'enabled entry', disable: false },
            2: { uid: 2, comment: 'disabled entry', disable: true },
        },
    }));
    await page.route('**/api/backgrounds/all', route => fulfillJson(route, {
        images: [
            { filename: 'one.jpg', isAnimated: false },
            { filename: 'two.gif', isAnimated: true },
        ],
    }));
    await page.route('**/api/backgrounds/folders', route => fulfillJson(route, {
        folders: [{ id: 'folder-1', name: 'Scenes' }],
        imageFolderMap: {},
    }));
    await page.route('**/api/assets/get', route => fulfillJson(route, {
        bgm: ['assets/bgm/theme.mp3'],
        ambient: ['assets/ambient/rain.ogg'],
    }));
    await page.route('**/api/extensions/discover', route => fulfillJson(route, [
        { type: 'system', name: 'assets' },
        { type: 'local', name: 'third-party/inspector-extension' },
    ]));
    await page.route('**/api/secrets/settings', route => fulfillJson(route, { allowKeysExposure: false }));
    await page.route('**/api/secrets/read', route => fulfillJson(route, {}));
    await page.route('**/api/stats/get', route => fulfillJson(route, {}));
    await page.route('**/api/characters/chats', route => fulfillJson(route, [{
        file_id: 'existing-chat',
        file_name: 'existing-chat.jsonl',
        chat_items: 2,
        file_size: '1 KB',
        last_mes: now,
    }]));
    await page.route('**/api/chats/get', route => fulfillJson(route, [
        { chat_metadata: {}, user_name: 'Modern Inspector User', character_name: 'Mock Character' },
        { name: 'Modern Inspector User', is_user: true, mes: 'hello', send_date: now - 1000 },
        { name: 'Mock Character', is_user: false, mes: 'reply', send_date: now },
    ]));
}

const readStorage = (page, key) => page.evaluate(storageKey => window.localStorage.getItem(storageKey), key);

// At 1280px the open drawer overlays the dashboard's right column; a click there only landed while the
// drawer was still sliding in. Close it first, as a user would (Esc), and let the slide-out finish.
async function closeInspectorIfOpen(page) {
    const inspector = page.locator('#inspector');
    if (await inspector.evaluate(drawer => drawer.classList.contains('open'))) {
        await page.keyboard.press('Escape');
        await expect(inspector).not.toHaveClass(/open/);
    }
    await inspector.evaluate(drawer => Promise.all(drawer.getAnimations().map(animation => animation.finished)));
}

async function openInspectorFromTopbar(page) {
    await page.locator('.topbar [data-toggle-inspector]').click();
    await expect(page.locator('#inspector')).toHaveClass(/open/);
}

test.describe('Modern inspector', () => {
    test('toggles inspector drawer from modern shell controls', async ({ page }) => {
        await mockModernInspectorWorkspace(page);

        await page.goto('/modern/?view=dashboard');

        const inspector = page.locator('#inspector');
        const topbarToggle = page.locator('[data-toggle-inspector][aria-label="上下文"]');

        await expect(inspector).toHaveClass(/open/);
        await expect(inspector).toHaveAttribute('aria-hidden', 'false');
        await expect(topbarToggle).toHaveAttribute('aria-pressed', 'true');

        await page.locator('[data-toggle-inspector][title="关闭上下文"]').click();
        await expect(inspector).not.toHaveClass(/open/);
        await expect(inspector).toHaveAttribute('aria-hidden', 'true');
        await expect(topbarToggle).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => readStorage(page, 'st-modern-inspector-state')).toBe('closed');

        await topbarToggle.click();
        await expect(inspector).toHaveClass(/open/);
        await expect(inspector).toHaveAttribute('aria-hidden', 'false');
        await expect(topbarToggle).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => readStorage(page, 'st-modern-inspector-state')).toBe('open');
        // Toggling records the drawer state, not the 设置 preference
        expect(await readStorage(page, 'st-modern-inspector-open')).toBe('true');
    });

    test('shows route-specific context instead of a generic summary', async ({ page }) => {
        await mockModernInspectorWorkspace(page);

        await page.goto('/modern/?view=dashboard');
        const dashboardSection = page.locator('.inspector-section', { hasText: '工作台状态' });
        await expect(dashboardSection).toContainText('siliconflow');
        await expect(dashboardSection).toContainText('1 / 1');
        await expect(dashboardSection).toContainText('2 背景 / 2 文件');

        await page.goto('/modern/?view=chat');
        const chatSection = page.locator('.inspector-section', { hasText: '聊天状态' });
        await expect(chatSection).toContainText('Mock Character');
        await expect(chatSection).toContainText('existing-chat.jsonl');
        await expect(chatSection).toContainText('2 条');

        // The API page is now the 模型连接 tab of the settings center; the drawer keeps its connection diagnostics
        await page.goto('/modern/?view=api');
        await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'settings');
        const apiSection = page.locator('.inspector-section', { hasText: '连接诊断' });
        await expect(apiSection).toContainText('siliconflow');
        await expect(apiSection).toContainText('deepseek-ai/DeepSeek-V3');
        await expect(apiSection).toContainText('Inspector Preset');

        await page.goto('/modern/?view=worldbooks');
        const worldbookSection = page.locator('.inspector-section', { hasText: '世界书状态' });
        await expect(worldbookSection).toContainText('InspectorWorld');
        await expect(worldbookSection).toContainText('2 条');
        await expect(worldbookSection).toContainText('1 条');
        await page.locator('[data-world-entry-select="1"]').check();
        await expect(worldbookSection).toContainText('选中条目');
        await expect(worldbookSection).toContainText('1 条');

        await page.goto('/modern/?view=assets');
        const assetSection = page.locator('.inspector-section', { hasText: '素材状态' });
        await expect(assetSection).toContainText('背景数量');
        await expect(assetSection).toContainText('资产文件');
        await expect(assetSection).toContainText('2 个');
        await expect(assetSection).toContainText('当前背景');
        await expect(assetSection).toContainText('当前资产');

        await page.goto('/modern/?view=dashboard');
        const backgroundRow = page.locator('.dashboard-resource-row[data-command-route="assets"][data-command-id="one.jpg"]');
        await expect(backgroundRow).toBeVisible();
        await closeInspectorIfOpen(page);
        await backgroundRow.click();
        await expect(page).toHaveURL(/\/modern\/\?view=assets/);
        await openInspectorFromTopbar(page);
        await expect(assetSection).toContainText('one.jpg');

        await page.goto('/modern/?view=dashboard');
        const assetRow = page.locator('.dashboard-resource-row[data-command-route="assets"][data-command-id="bgm:assets/bgm/theme.mp3"]');
        await expect(assetRow).toBeVisible();
        await closeInspectorIfOpen(page);
        await assetRow.click();
        await expect(page).toHaveURL(/\/modern\/\?view=assets/);
        await openInspectorFromTopbar(page);
        await expect(assetSection).toContainText('theme.mp3');

        // Other settings tabs describe the settings center itself
        await page.goto('/modern/?view=settings');
        await expect(apiSection).toContainText('deepseek-ai/DeepSeek-V3');
        await closeInspectorIfOpen(page);
        await page.locator('.settings-tabs [data-settings-section="system"]').click();
        const settingsSection = page.locator('.inspector-section', { hasText: '设置状态' });
        const settingsRow = label => settingsSection.locator('.kv-row', { has: page.locator('.kv-key', { hasText: new RegExp(`^${label}$`) }) }).locator('.kv-value');
        await expect(settingsRow('当前分区')).toHaveText('system');
        await expect(settingsRow('上下文抽屉')).toHaveText('收起');
        await expect(settingsRow('保存状态')).toHaveText('改动会自动保存');
        await expect(apiSection).toHaveCount(0);

        await page.goto('/modern/?view=characters');
        const characterSection = page.locator('.inspector-section', { hasText: '角色状态' });
        await expect(characterSection).toContainText('Mock Character');
        await expect(characterSection).toContainText('Inspector E2E');

        await page.goto('/modern/?view=groups');
        const groupSection = page.locator('.inspector-section', { hasText: '群组状态' });
        await expect(groupSection).toContainText('Inspector Group');
        await expect(groupSection).toContainText('2 个');

        await page.goto('/modern/?view=personas');
        const personaSection = page.locator('.inspector-section', { hasText: '人设状态' });
        await expect(personaSection).toContainText('Inspector Persona');

        await page.goto('/modern/?view=presets');
        const presetSection = page.locator('.inspector-section', { hasText: '预设状态' });
        await expect(presetSection).toContainText('Inspector Preset');

        await page.goto('/modern/?view=extensions');
        const extensionSection = page.locator('.inspector-section', { hasText: '扩展状态' });
        await expect(extensionSection).toContainText('发现数量');
        await expect(extensionSection).toContainText('2 个');

        await page.goto('/modern/?view=activity');
        const activitySection = page.locator('.inspector-section', { hasText: '活动状态' });
        await expect(activitySection).toContainText('recent');
    });

    test('closes the drawer with Esc and outside clicks but keeps it open for inside clicks', async ({ page }) => {
        await mockModernInspectorWorkspace(page);

        await page.goto('/modern/?view=chat');

        const inspector = page.locator('#inspector');
        const topbarToggle = page.locator('.topbar [data-toggle-inspector]');
        await expect(inspector).toHaveClass(/open/);
        await expect(page.locator('.inspector-section', { hasText: '聊天状态' })).toContainText('existing-chat.jsonl');

        // A drawer control that re-renders the drawer (and detaches the clicked node) still counts as inside
        const itemizedToggle = page.locator('[data-toggle-itemized-prompt]');
        await expect(itemizedToggle).toHaveAttribute('aria-expanded', 'true');
        await itemizedToggle.locator('.inspector-title').click();
        await expect(itemizedToggle).toHaveAttribute('aria-expanded', 'false');
        await page.locator('.inspector-section', { hasText: '聊天状态' }).locator('.kv-row').first().click();
        await expect(inspector).toHaveClass(/open/);

        await page.keyboard.press('Escape');
        await expect(inspector).not.toHaveClass(/open/);
        await expect(inspector).toHaveAttribute('aria-hidden', 'true');
        await expect(topbarToggle).toHaveAttribute('aria-pressed', 'false');
        expect(await readStorage(page, 'st-modern-inspector-state')).toBe('closed');

        await topbarToggle.click();
        await expect(inspector).toHaveClass(/open/);
        await page.locator('.chat-thread').click({ position: { x: 4, y: 4 } });
        await expect(inspector).not.toHaveClass(/open/);

        // The command palette takes the first Esc; the drawer closes on the next one
        await topbarToggle.click();
        await expect(inspector).toHaveClass(/open/);
        await page.keyboard.press('ControlOrMeta+k');
        await expect(page.locator('#commandPalette')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#commandPalette')).toBeHidden();
        await expect(inspector).toHaveClass(/open/);
        await page.keyboard.press('Escape');
        await expect(inspector).not.toHaveClass(/open/);
    });

    test('keeps the topbar usable while the drawer is open', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await mockModernInspectorWorkspace(page);

        await page.goto('/modern/?view=dashboard');

        const inspector = page.locator('#inspector');
        await expect(inspector).toHaveClass(/open/);
        // Measure once the slide-in transition has finished
        await inspector.evaluate(drawer => Promise.all(drawer.getAnimations().map(animation => animation.finished)));

        const topbarBox = await page.locator('.topbar').boundingBox();
        await expect.poll(async () => (await inspector.boundingBox())?.y).toBeGreaterThanOrEqual(Math.floor(topbarBox.y + topbarBox.height));

        for (const selector of ['#refreshButton', '#themeButton', '.topbar [data-toggle-inspector]']) {
            const hit = await page.locator(selector).evaluate(button => {
                const box = button.getBoundingClientRect();
                const topmost = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                return Boolean(topmost && button.contains(topmost));
            });
            expect(hit, `${selector} is the topmost element at its center`).toBe(true);
        }

        const theme = await page.locator('html').getAttribute('data-theme');
        await page.locator('#themeButton').click();
        await expect(page.locator('html')).not.toHaveAttribute('data-theme', theme);
        // Topbar controls are part of the drawer's frame and do not dismiss it
        await expect(inspector).toHaveClass(/open/);

        await page.locator('.topbar [data-toggle-inspector]').click();
        await expect(inspector).not.toHaveClass(/open/);
        await expect.poll(() => readStorage(page, 'st-modern-inspector-state')).toBe('closed');
    });

    test('keeps the drawer closed after a reload whichever way it was closed', async ({ page }) => {
        await mockModernInspectorWorkspace(page);

        // An upgrading user only has the old key ('true'): the drawer opens as before
        await page.goto('/modern/?view=dashboard');
        const inspector = page.locator('#inspector');
        await expect(inspector).toHaveClass(/open/);
        expect(await readStorage(page, 'st-modern-inspector-state')).toBeNull();

        const closePaths = [
            ['Esc', () => page.keyboard.press('Escape')],
            ['close button', () => page.locator('#inspector [data-toggle-inspector]').click()],
            ['topbar toggle', () => page.locator('.topbar [data-toggle-inspector]').click()],
            ['outside click', () => page.locator('.page-title').click()],
        ];
        for (const [label, close] of closePaths) {
            await expect(inspector, `${label}: open before closing`).toHaveClass(/open/);
            await close();
            await expect(inspector, `${label}: closed`).not.toHaveClass(/open/);

            await page.reload();
            await expect(page.locator('.page-title')).toHaveText('工作台');
            await expect(inspector, `${label}: still closed after reload`).not.toHaveClass(/open/);
            // The 设置 preference is untouched; the recorded drawer state wins over it
            expect(await readStorage(page, 'st-modern-inspector-open')).toBe('true');

            await openInspectorFromTopbar(page);
            await page.reload();
            await expect(inspector, `${label}: reopened state survives reload`).toHaveClass(/open/);
        }
    });

    test('applies the saved 默认展开 preference on the next load', async ({ page }) => {
        await mockModernInspectorWorkspace(page, { openPreference: null });

        await page.goto('/modern/?view=settings');
        const inspector = page.locator('#inspector');
        const preference = page.locator('[data-modern-inspector-open]');
        const saveStatus = page.locator('[data-settings-save-status]');
        await expect(inspector).not.toHaveClass(/open/);
        await page.locator('.settings-tabs [data-settings-section="preferences"]').click();

        // Changing the box saves the preference at once. The saving click is not an outside click: the drawer stays
        // as it is in this view, and the saved preference decides the next load
        await openInspectorFromTopbar(page);
        await preference.check();
        await expect(saveStatus).toContainText('上下文抽屉默认状态已保存');
        await expect(inspector).toHaveClass(/open/);
        expect(await readStorage(page, 'st-modern-inspector-open')).toBe('true');
        expect(await readStorage(page, 'st-modern-inspector-state')).toBeNull();
        await page.reload();
        await expect(inspector).toHaveClass(/open/);

        // The settings center reopens on the same tab
        await expect(preference).toBeChecked();
        await preference.uncheck();
        await expect(saveStatus).toContainText('上下文抽屉默认状态已保存');
        await expect(inspector).toHaveClass(/open/);
        expect(await readStorage(page, 'st-modern-inspector-open')).toBe('false');
        expect(await readStorage(page, 'st-modern-inspector-state')).toBeNull();
        await page.reload();
        await expect(page.locator('.page-title')).toHaveText('设置中心');
        await expect(inspector).not.toHaveClass(/open/);
    });

    test('wraps long chat values inside the drawer', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await mockModernInspectorWorkspace(page);
        const now = Date.now();
        const longAvatar = 'an-extremely-long-character-card-file-name-that-would-not-fit-in-the-context-drawer-2026-10-10.png';
        const longChat = 'an-extremely-long-chat-file-name-created-by-a-very-long-session-title-2026-10-10@12h34m56s';
        await page.route('**/api/characters/all', route => fulfillJson(route, [{
            avatar: longAvatar,
            name: 'Mock Character',
            data: { name: 'Mock Character', creator: 'Inspector E2E' },
        }]));
        await page.route('**/api/characters/chats', route => fulfillJson(route, [{
            file_id: longChat,
            file_name: `${longChat}.jsonl`,
            chat_items: 2,
            file_size: '1 KB',
            last_mes: now,
        }]));

        await page.goto('/modern/?view=chat');

        const inspector = page.locator('#inspector');
        const chatSection = page.locator('.inspector-section', { hasText: '聊天状态' });
        await expect(chatSection).toContainText(`${longChat}.jsonl`);
        await expect(chatSection).toContainText(longAvatar);

        const layout = await inspector.evaluate(drawer => {
            const drawerBox = drawer.getBoundingClientRect();
            const section = [...drawer.querySelectorAll('.inspector-section')].find(item => item.textContent.includes('聊天状态'));
            const rows = [...section.querySelectorAll('.kv-row')].map(row => {
                const value = row.querySelector('.kv-value').getBoundingClientRect();
                return {
                    key: row.querySelector('.kv-key').textContent.trim(),
                    left: value.left,
                    right: value.right,
                    width: value.width,
                };
            });
            return {
                left: drawerBox.left,
                right: drawerBox.right,
                scrollWidth: drawer.scrollWidth,
                clientWidth: drawer.clientWidth,
                rows,
            };
        });

        expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
        for (const row of layout.rows) {
            expect(row.width, `${row.key} value is visible`).toBeGreaterThan(0);
            expect(row.left, `${row.key} value starts inside the drawer`).toBeGreaterThanOrEqual(layout.left);
            expect(row.right, `${row.key} value ends inside the drawer`).toBeLessThanOrEqual(layout.right + 0.5);
        }
        expect(layout.rows.map(row => row.key)).toEqual(expect.arrayContaining(['聊天类型', '当前对象', '会话数量']));
    });
});

// 提示词分解快照里的 maxContext 是引擎算出的「上下文 − 回复上限」，即提示词预算；旧界面把它叫「最大上下文」，名不副实。
// 现在抽屉里分开显示上下文上限（来自设置）、提示词预算和占用，聊天输入框下方的标签读同一份缓存的快照。
test.describe('Modern inspector prompt usage', () => {
    const itemizedSnapshot = totalTokens => ({
        available: true,
        mesId: 3,
        mainApi: 'openai',
        apiFriendlyName: 'Chat Completion',
        modelUsed: 'deepseek-v4-flash',
        presetName: 'Inspector Preset',
        tokenizer: 'tiktoken',
        maxContext: 31700,
        totalTokens,
        parts: [
            { name: '聊天历史', tokens: totalTokens - 500 },
            { name: '主提示词', tokens: 500 },
        ],
    });
    const usageSettings = { chat_completion_source: 'custom', custom_model: 'deepseek-v4-flash', openai_max_context: 32000, openai_max_tokens: 300 };

    async function mockUsageWorkspace(page, { openPreference, replies = {} }) {
        const calls = await mockBridgeFrame(page, { replies });
        await mockModernInspectorWorkspace(page, { openPreference, oaiSettings: usageSettings });
        return calls;
    }

    const kvRow = (section, key) => section.locator('.kv-row', { has: section.page().locator('.kv-key', { hasText: key }) });

    test('names the prompt budget correctly and adds the context limit and the usage percent', async ({ page }) => {
        const calls = await mockUsageWorkspace(page, { openPreference: 'true', replies: { getItemizedPrompt: itemizedSnapshot(12345) } });

        await page.goto('/modern/?view=chat');
        const section = page.locator('.inspector-section', { hasText: '本次生成提示词分解' });
        await expect(section.locator('.kv-key', { hasText: '分词器' })).toHaveCount(0);

        await section.locator('[data-refresh-itemized-prompt]').click();
        await expect(section.locator('.kv-key', { hasText: '分词器' })).toHaveCount(1);

        await expect(kvRow(section, '上下文上限')).toContainText('32,000 tokens');
        await expect(kvRow(section, '提示词预算（上下文−回复上限）')).toContainText('31,700 tokens');
        await expect(kvRow(section, '提示词总量')).toContainText('12,345 tokens');
        await expect(kvRow(section, '占用')).toContainText('38.9%');
        await expect(section).not.toContainText('最大上下文');
        expect(calls.filter(call => call.action === 'getItemizedPrompt')).toHaveLength(1);

        // The composer label reads the same cached snapshot and appeared without re-rendering the chat page
        const label = page.locator('.composer [data-chat-usage-label]');
        await expect(label).toHaveText('上次发送 12,345 / 预算 31,700 token');
        await expect(label).toHaveAttribute('title', /占提示词预算的 38\.9%.*提示词预算 = 上下文 32,000 − 回复上限 300/);
        await expect(label).toHaveAttribute('data-usage-percent', '38.9%');
        await expect(page.locator('.composer [data-composer-meta]')).toHaveCount(1);
    });

    test('refreshes the usage label after a generation finishes without opening the drawer', async ({ page }) => {
        let itemizedReads = 0;
        const calls = await mockUsageWorkspace(page, {
            openPreference: 'false',
            replies: {
                generate: { chat: 'existing-chat.jsonl', messageCount: 4, saved: true, type: 'normal' },
                getItemizedPrompt: () => itemizedSnapshot(itemizedReads++ === 0 ? 12345 : 29000),
            },
        });

        await page.goto('/modern/?view=chat');
        await expect(page.locator('[data-select-chat="existing-chat"]')).toBeVisible();
        // Rendering the page, the composer and the closed drawer never asks the engine for the breakdown
        await expect(page.locator('.composer')).toBeVisible();
        await expect(page.locator('[data-chat-usage-label]')).toHaveCount(0);
        expect(calls.filter(call => call.action === 'getItemizedPrompt')).toHaveLength(0);

        await page.locator('[data-chat-input]').fill('first message');
        await page.locator('[data-send-message]').click();

        const label = page.locator('.composer [data-chat-usage-label]');
        await expect(label).toHaveText('上次发送 12,345 / 预算 31,700 token');
        expect(calls.map(call => call.action).filter(action => action === 'generate' || action === 'getItemizedPrompt'))
            .toEqual(['generate', 'getItemizedPrompt']);

        await page.locator('[data-chat-input]').fill('second message');
        await page.locator('[data-send-message]').click();
        await expect(label).toHaveText('上次发送 29,000 / 预算 31,700 token');
        // 29000 / 31700 is above 90%, so the label turns into a warning
        await expect(label).toHaveClass(/is-high/);
        expect(calls.filter(call => call.action === 'getItemizedPrompt')).toHaveLength(2);

        // Opening the drawer afterwards shows the same cached snapshot without asking again
        await page.locator('.topbar [data-toggle-inspector]').click();
        await expect(page.locator('#inspector')).toHaveClass(/open/);
        const section = page.locator('.inspector-section', { hasText: '本次生成提示词分解' });
        await expect(kvRow(section, '提示词总量')).toContainText('29,000 tokens');
        await expect(kvRow(section, '占用')).toContainText('91.5%');
        expect(calls.filter(call => call.action === 'getItemizedPrompt')).toHaveLength(2);
    });

    test('updates the label in place, keeping the draft, and sits beside the connection chip', async ({ page }) => {
        await page.addInitScript(() => {
            window.__modernTestFlags = { slotHtml: { chatConnectionChip: '<span data-test-chip>连接标签</span>' } };
        });
        let itemizedReads = 0;
        await mockUsageWorkspace(page, {
            openPreference: 'true',
            replies: { getItemizedPrompt: () => itemizedSnapshot(itemizedReads++ === 0 ? 1000 : 2000) },
        });

        await page.goto('/modern/?view=chat');
        const meta = page.locator('.composer [data-composer-meta]');
        await expect(meta.locator('[data-test-chip]')).toHaveText('连接标签');
        await expect(meta.locator('[data-chat-usage-label]')).toHaveCount(0);

        await page.locator('[data-chat-input]').fill('unsent draft');
        await page.locator('.inspector-section [data-refresh-itemized-prompt]').click();
        const label = meta.locator('[data-chat-usage-label]');
        await expect(label).toHaveText('上次发送 1,000 / 预算 31,700 token');
        // The chip stays first, the usage label comes after it
        await expect(meta.locator('> :first-child')).toHaveAttribute('data-test-chip', '');
        await expect(meta.locator('> :nth-child(2)')).toHaveAttribute('data-chat-usage-label', '');

        await page.locator('.inspector-section [data-refresh-itemized-prompt]').click();
        await expect(label).toHaveText('上次发送 2,000 / 预算 31,700 token');
        await expect(page.locator('[data-chat-input]')).toHaveValue('unsent draft');
    });

    test('keeps the label hidden when the engine has nothing to report', async ({ page }) => {
        await mockUsageWorkspace(page, { openPreference: 'true', replies: { getItemizedPrompt: { available: false } } });

        await page.goto('/modern/?view=chat');
        const section = page.locator('.inspector-section', { hasText: '本次生成提示词分解' });
        await section.locator('[data-refresh-itemized-prompt]').click();
        await expect(section).toContainText('暂无最近生成的提示词分解数据');
        await expect(page.locator('[data-chat-usage-label]')).toHaveCount(0);
        // The connection chip (B1) now fills the row; without a usage snapshot it is the only thing in it
        await expect(page.locator('[data-composer-meta] > :not([data-connection-switcher])')).toHaveCount(0);
    });
});
