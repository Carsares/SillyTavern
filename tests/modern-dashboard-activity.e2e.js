import { test, expect } from '@playwright/test';

function fulfillJson(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

async function mockModernDashboardActivityWorkspace(page, settingsOverride = null) {
    const now = Date.now();
    const settingsPayload = settingsOverride || {
        name1: 'Modern User',
        main_api: 'openai',
        chat_completion_source: 'siliconflow',
        oai_settings: {
            chat_completion_source: 'siliconflow',
            siliconflow_model: 'deepseek-ai/DeepSeek-V3',
            preset_settings_openai: 'Dashboard Preset',
        },
    };
    const presetName = settingsPayload.oai_settings?.preset_settings_openai || settingsPayload.preset_settings_openai || settingsPayload.preset_settings || '';
    const chatCompletionSource = settingsPayload.oai_settings?.chat_completion_source || settingsPayload.chat_completion_source || '';
    const characters = [
        {
            avatar: 'alice.png',
            name: 'Alice Fixture',
            date_last_chat: now,
            data: {
                name: 'Alice Fixture',
                creator: 'Modern E2E',
            },
        },
        {
            avatar: 'bruno.png',
            name: 'Bruno Fixture',
            date_last_chat: now - 1000,
            data: {
                name: 'Bruno Fixture',
                creator: 'Modern E2E',
            },
        },
    ];
    const groups = [{
        id: 'group-alpha',
        name: 'Alpha Group',
        avatar_url: '',
        members: ['alice.png', 'bruno.png'],
        chats: ['group-alpha-chat.jsonl'],
        chat_size: 3072,
        date_last_chat: now - 500,
    }];
    const worldbooks = [{ file_id: 'ModernLore', name: 'ModernLore' }];
    const backgrounds = {
        images: [
            { filename: 'dashboard-bg.png', isAnimated: false },
            { filename: 'animated-city.webp', isAnimated: true },
        ],
    };
    const assets = {
        bgm: ['assets/bgm/dashboard-theme.mp3'],
    };
    const stats = {
        timestamp: now,
        'alice.png': {
            user_msg_count: 4,
            non_user_msg_count: 6,
            user_word_count: 200,
            non_user_word_count: 300,
            chat_size: 4096,
            total_swipe_count: 1,
            total_gen_time: 1200,
            date_last_chat: now,
        },
        'bruno.png': {
            user_msg_count: 2,
            non_user_msg_count: 2,
            user_word_count: 80,
            non_user_word_count: 120,
            chat_size: 2048,
            total_swipe_count: 0,
            total_gen_time: 600,
            date_last_chat: now - 1000,
        },
        'group-alpha': {
            user_msg_count: 3,
            non_user_msg_count: 5,
            user_word_count: 180,
            non_user_word_count: 260,
            chat_size: 3072,
            total_swipe_count: 2,
            total_gen_time: 900,
            date_last_chat: now - 500,
        },
    };

    await page.route('**/csrf-token', route => fulfillJson(route, { token: 'modern-dashboard-activity-token' }));
    await page.route('**/api/users/me', route => fulfillJson(route, { name: 'Modern User', handle: 'modern-user' }));
    await page.route('**/api/settings/get', route => fulfillJson(route, {
        settings: JSON.stringify(settingsPayload),
        openai_setting_names: presetName ? [presetName] : [],
        openai_settings: [JSON.stringify({ chat_completion_source: chatCompletionSource })],
        textgenerationwebui_preset_names: [],
        textgenerationwebui_presets: [],
    }));
    await page.route('**/api/characters/all', route => fulfillJson(route, characters));
    await page.route('**/api/groups/all', route => fulfillJson(route, groups));
    await page.route('**/api/worldinfo/list', route => fulfillJson(route, worldbooks));
    await page.route('**/api/worldinfo/get', route => {
        const payload = route.request().postDataJSON();
        return fulfillJson(route, {
            originalData: { name: payload.name },
            entries: {},
        });
    });
    await page.route('**/api/backgrounds/all', route => fulfillJson(route, backgrounds));
    await page.route('**/api/backgrounds/folders', route => fulfillJson(route, { folders: [], imageFolderMap: {} }));
    await page.route('**/api/assets/get', route => fulfillJson(route, assets));
    await page.route('**/api/extensions/discover', route => fulfillJson(route, []));
    await page.route('**/api/secrets/settings', route => fulfillJson(route, { allowKeysExposure: false }));
    await page.route('**/api/secrets/read', route => fulfillJson(route, {}));
    await page.route('**/api/stats/get', route => fulfillJson(route, stats));
    await page.route('**/api/characters/chats', route => {
        const payload = route.request().postDataJSON();
        const avatar = payload.avatar_url || 'alice.png';
        return fulfillJson(route, [{
            file_id: `${avatar}-chat`,
            file_name: `${avatar}-chat.jsonl`,
            chat_items: 2,
            file_size: '1 KB',
            last_mes: now,
        }]);
    });
    await page.route('**/api/chats/search', route => {
        const payload = route.request().postDataJSON();
        if (payload.group_id) {
            return fulfillJson(route, [{
                file_id: `${payload.group_id}-chat`,
                file_name: `${payload.group_id}-chat.jsonl`,
                chat_items: 2,
                file_size: '2 KB',
                last_mes: now,
            }]);
        }
        return fulfillJson(route, []);
    });
    await page.route('**/api/chats/get', route => {
        const payload = route.request().postDataJSON();
        const character = characters.find(item => item.avatar === payload.avatar_url) || characters[0];
        return fulfillJson(route, [
            { chat_metadata: {}, user_name: 'Modern User', character_name: character.name },
            { name: 'Modern User', is_user: true, mes: `hello ${character.name}`, send_date: now - 1000 },
            { name: character.name, is_user: false, mes: `reply ${character.name}`, send_date: now },
        ]);
    });
    await page.route('**/api/chats/group/get', route => {
        const payload = route.request().postDataJSON();
        return fulfillJson(route, [
            { chat_metadata: {}, group_name: 'Alpha Group' },
            { name: 'Modern User', is_user: true, mes: `hello ${payload.id}`, send_date: now - 1000 },
            { name: 'Alpha Group', is_user: false, mes: `reply ${payload.id}`, send_date: now },
        ]);
    });
}

test.describe('Modern dashboard and activity', () => {
    test('opens chat from dashboard and activity cards', async ({ page }) => {
        await mockModernDashboardActivityWorkspace(page);

        await page.goto('/modern/?view=dashboard');

        await expect(page.locator('.page-title')).toHaveText('工作台');
        await expect(page.locator('.action-card[data-route="activity"]')).toBeVisible();
        await page.locator('.page-head [data-route="chat"]').click();

        await expect(page).toHaveURL(/\/modern\/\?view=chat/);
        await expect(page.locator('.detail-title')).toHaveText('Alice Fixture');
        await expect(page.locator('[data-select-chat="alice.png-chat"]')).toBeVisible();

        await page.goto('/modern/?view=activity');

        await expect(page.locator('.page-title')).toHaveText('活动与统计');
        await expect(page.locator('[data-activity-filter]')).toBeVisible();
        await expect(page.locator('[data-activity-sort]')).toHaveValue('recent');

        await page.locator('[data-activity-filter]').fill('bruno');
        await expect(page.locator('.activity-card')).toHaveCount(1);
        await expect(page.locator('.activity-card')).toContainText('Bruno Fixture');

        await page.locator('[data-activity-sort]').selectOption('messages');
        await expect(page.locator('[data-activity-sort]')).toHaveValue('messages');
        await page.locator('.activity-card [data-command-route="characters"][data-command-id="bruno.png"]').click();

        await expect(page).toHaveURL(/\/modern\/\?view=characters/);
        await expect(page.locator('.detail-title')).toHaveText('Bruno Fixture');
        await expect(page.locator('[data-select-character="bruno.png"]')).toHaveClass(/active/);

        await page.goto('/modern/?view=activity');
        await page.locator('[data-activity-filter]').fill('bruno');
        await page.locator('.activity-card [data-open-character-chat="bruno.png"]').click();

        await expect(page).toHaveURL(/\/modern\/\?view=chat/);
        await expect(page.locator('.detail-title')).toHaveText('Bruno Fixture');
        await expect(page.locator('[data-select-chat="bruno.png-chat"]')).toBeVisible();
    });

    test('opens resource detail pages from activity cards', async ({ page }) => {
        await mockModernDashboardActivityWorkspace(page);

        await page.goto('/modern/?view=activity');

        await page.locator('[data-activity-filter]').fill('alpha');
        await expect(page.locator('.activity-card')).toHaveCount(1);
        await expect(page.locator('.activity-card')).toContainText('Alpha Group');
        await page.locator('.activity-card [data-command-route="groups"][data-command-id="group-alpha"]').click();

        await expect(page).toHaveURL(/\/modern\/\?view=groups/);
        await expect(page.locator('.detail-title')).toHaveText('Alpha Group');
        await expect(page.locator('[data-select-group="group-alpha"]')).toHaveClass(/active/);
    });

    test('opens resource overview items from dashboard', async ({ page }) => {
        await mockModernDashboardActivityWorkspace(page);

        await page.goto('/modern/?view=dashboard');

        await expect(page.locator('.page-title')).toHaveText('工作台');
        await page.locator('.dashboard-resource-row[data-command-route="characters"][data-command-id="alice.png"]').click();
        await expect(page).toHaveURL(/\/modern\/\?view=characters/);
        await expect(page.locator('.detail-title')).toHaveText('Alice Fixture');

        await page.goto('/modern/?view=dashboard');
        await page.locator('.dashboard-resource-row[data-command-route="groups"][data-command-id="group-alpha"]').click();
        await expect(page).toHaveURL(/\/modern\/\?view=groups/);
        await expect(page.locator('.detail-title')).toHaveText('Alpha Group');

        await page.goto('/modern/?view=dashboard');
        await page.locator('.dashboard-resource-row[data-command-route="worldbooks"][data-command-id="ModernLore"]').click();
        await expect(page).toHaveURL(/\/modern\/\?view=worldbooks/);
        await expect(page.locator('[data-select-worldbook="ModernLore"]')).toHaveClass(/active/);

        await page.goto('/modern/?view=dashboard');
        await page.locator('.dashboard-resource-row[data-command-route="assets"][data-command-id="dashboard-bg.png"]').click();
        await expect(page).toHaveURL(/\/modern\/\?view=assets/);
        await expect(page.locator('.background-card.selected[data-background-card="dashboard-bg.png"]')).toBeVisible();

        await page.goto('/modern/?view=dashboard');
        await page.locator('.dashboard-resource-item', { hasText: 'Bruno Fixture' }).locator('[data-open-character-chat="bruno.png"]').click();
        await expect(page).toHaveURL(/\/modern\/\?view=chat/);
        await expect(page.locator('.detail-title')).toHaveText('Bruno Fixture');
        await expect(page.locator('[data-select-chat="bruno.png-chat"]')).toBeVisible();

        await page.goto('/modern/?view=dashboard');
        await page.locator('.dashboard-resource-item', { hasText: 'Alpha Group' }).locator('[data-open-group-chat="group-alpha"]').click();
        await expect(page).toHaveURL(/\/modern\/\?view=chat/);
        await expect(page.locator('.detail-title')).toHaveText('Alpha Group');
        await expect(page.locator('[data-select-chat="group-alpha-chat"]')).toBeVisible();
    });

    test('surfaces incomplete API connection from dashboard', async ({ page }) => {
        await mockModernDashboardActivityWorkspace(page, {});

        await page.goto('/modern/?view=dashboard');

        const warning = page.locator('.dashboard-connection-warning');
        await expect(warning).toBeVisible();
        await expect(warning).toContainText('主 API 未选择');
        await expect(warning).toContainText('聊天补全来源未配置');
        await expect(warning).toContainText('模型未配置');

        await warning.locator('[data-route="api"]').click();

        await expect(page).toHaveURL(/\/modern\/\?view=api/);
        await expect(page.locator('.page-title')).toHaveText('API 连接管理');
    });
});
