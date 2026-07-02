import { test, expect } from '@playwright/test';

function fulfillJson(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

async function mockModernInspectorWorkspace(page) {
    const now = Date.now();
    await page.addInitScript('localStorage.setItem("st-modern-inspector-open", "true")');
    await page.route('**/csrf-token', route => fulfillJson(route, { token: 'modern-inspector-token' }));
    await page.route('**/api/users/me', route => fulfillJson(route, { name: 'Modern Inspector User', handle: 'inspector-user' }));
    await page.route('**/api/settings/get', route => fulfillJson(route, {
        settings: JSON.stringify({
            main_api: 'openai',
            chat_completion_source: 'siliconflow',
            request_compression: {
                enabled: true,
            },
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
            },
        }),
        openai_setting_names: ['Inspector Preset'],
        openai_settings: [JSON.stringify({ chat_completion_source: 'siliconflow' })],
        textgenerationwebui_preset_names: [],
        textgenerationwebui_presets: [],
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

test.describe('Modern inspector', () => {
    test('shows route-specific context instead of a generic summary', async ({ page }) => {
        await mockModernInspectorWorkspace(page);

        await page.goto('/modern/?view=chat');
        const chatSection = page.locator('.inspector-section', { hasText: '聊天状态' });
        await expect(chatSection).toContainText('Mock Character');
        await expect(chatSection).toContainText('existing-chat.jsonl');
        await expect(chatSection).toContainText('2 条');

        await page.goto('/modern/?view=api');
        const apiSection = page.locator('.inspector-section', { hasText: '连接诊断' });
        await expect(apiSection).toContainText('siliconflow');
        await expect(apiSection).toContainText('deepseek-ai/DeepSeek-V3');
        await expect(apiSection).toContainText('Inspector Preset');

        await page.goto('/modern/?view=assets');
        const assetSection = page.locator('.inspector-section', { hasText: '素材状态' });
        await expect(assetSection).toContainText('背景数量');
        await expect(assetSection).toContainText('资产文件');
        await expect(assetSection).toContainText('2 个');

        await page.goto('/modern/?view=settings');
        const settingsSection = page.locator('.inspector-section', { hasText: '设置状态' });
        await expect(settingsSection).toContainText('请求压缩');
        await expect(settingsSection).toContainText('已开启');

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
});
