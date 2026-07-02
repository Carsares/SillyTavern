import { test, expect } from '@playwright/test';

function fulfillJson(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

async function mockModernDashboardActivityWorkspace(page) {
    const now = Date.now();
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
    };

    await page.route('**/csrf-token', route => fulfillJson(route, { token: 'modern-dashboard-activity-token' }));
    await page.route('**/api/users/me', route => fulfillJson(route, { name: 'Modern User', handle: 'modern-user' }));
    await page.route('**/api/settings/get', route => fulfillJson(route, {
        settings: JSON.stringify({
            name1: 'Modern User',
            main_api: 'openai',
            chat_completion_source: 'siliconflow',
            oai_settings: {
                chat_completion_source: 'siliconflow',
                siliconflow_model: 'deepseek-ai/DeepSeek-V3',
                preset_settings_openai: 'Dashboard Preset',
            },
        }),
        openai_setting_names: ['Dashboard Preset'],
        openai_settings: [JSON.stringify({ chat_completion_source: 'siliconflow' })],
        textgenerationwebui_preset_names: [],
        textgenerationwebui_presets: [],
    }));
    await page.route('**/api/characters/all', route => fulfillJson(route, characters));
    await page.route('**/api/groups/all', route => fulfillJson(route, []));
    await page.route('**/api/worldinfo/list', route => fulfillJson(route, []));
    await page.route('**/api/backgrounds/all', route => fulfillJson(route, { images: [] }));
    await page.route('**/api/backgrounds/folders', route => fulfillJson(route, { folders: [], imageFolderMap: {} }));
    await page.route('**/api/assets/get', route => fulfillJson(route, {}));
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
    await page.route('**/api/chats/get', route => {
        const payload = route.request().postDataJSON();
        const character = characters.find(item => item.avatar === payload.avatar_url) || characters[0];
        return fulfillJson(route, [
            { chat_metadata: {}, user_name: 'Modern User', character_name: character.name },
            { name: 'Modern User', is_user: true, mes: `hello ${character.name}`, send_date: now - 1000 },
            { name: character.name, is_user: false, mes: `reply ${character.name}`, send_date: now },
        ]);
    });
}

test.describe('Modern dashboard and activity', () => {
    test('opens chat from dashboard and activity cards', async ({ page }) => {
        await mockModernDashboardActivityWorkspace(page);

        await page.goto('/modern/?view=dashboard');

        await expect(page.locator('.page-title')).toHaveText('工作台');
        await expect(page.locator('.action-card[data-route="activity"]')).toBeVisible();
        await page.locator('[data-open-character-chat="alice.png"]').click();

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
        await page.locator('.activity-card [data-open-character-chat="bruno.png"]').click();

        await expect(page).toHaveURL(/\/modern\/\?view=chat/);
        await expect(page.locator('.detail-title')).toHaveText('Bruno Fixture');
        await expect(page.locator('[data-select-chat="bruno.png-chat"]')).toBeVisible();
    });
});
