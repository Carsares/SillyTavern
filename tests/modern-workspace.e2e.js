import { test, expect } from '@playwright/test';

const modernRoutes = [
    ['dashboard', '工作台'],
    ['chat', '聊天工作区'],
    ['characters', '角色库'],
    ['groups', '群组管理'],
    ['worldbooks', '世界书'],
    ['presets', '预设管理'],
    ['personas', '用户人设'],
    ['assets', '素材库'],
    ['api', 'API 连接管理'],
    ['extensions', '扩展'],
    ['activity', '活动与统计'],
    ['settings', '设置中心'],
];

test.describe('Modern workspace', () => {
    for (const [route, title] of modernRoutes) {
        test(`renders ${route}`, async ({ page }) => {
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => {
                if (message.type() === 'error') {
                    errors.push(message.text());
                }
            });

            await page.goto(`/modern/?view=${route}`);

            await expect(page.locator('.brand-title')).toHaveText('SillyTavern');
            await expect(page.locator('.page-title')).toHaveText(title);
            await expect(page.locator('.nav-button.active')).toBeVisible();
            expect(errors).toEqual([]);
        });
    }

    test('shows text completion API as read-only in the modern editor', async ({ page }) => {
        await page.goto('/modern/?view=api');

        await expect(page.locator('.page-title')).toHaveText('API 连接管理');
        await page.locator('[data-api-main]').selectOption('textgenerationwebui');

        await expect(page.locator('.form-section-title', { hasText: '文本补全档案' })).toBeVisible();
        await expect(page.locator('[data-save-api-connection]')).toHaveCount(0);
    });

    test('hides irrelevant API fields for SiliconFlow', async ({ page }) => {
        await page.goto('/modern/?view=api');

        await expect(page.locator('.page-title')).toHaveText('API 连接管理');
        await page.locator('[data-api-main]').selectOption('openai');
        await page.locator('[data-api-source]').selectOption('siliconflow');

        await expect(page.locator('[data-api-field="siliconflow-endpoint"]')).toBeVisible();
        await expect(page.locator('[data-api-field="custom-url"]')).toBeHidden();
    });

    test('shows API diagnostics, model suggestions, and test history', async ({ page }) => {
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'openai',
                chat_completion_source: 'siliconflow',
                oai_settings: {
                    chat_completion_source: 'siliconflow',
                    siliconflow_model: 'deepseek-ai/DeepSeek-V3',
                    siliconflow_endpoint: 'cn',
                    openai_max_tokens: 300,
                },
                textgenerationwebui_settings: {
                    type: 'openrouter',
                    openrouter_model: 'openrouter/model',
                },
            }),
            openai_setting_names: ['Default'],
            openai_settings: [JSON.stringify({ chat_completion_source: 'siliconflow' })],
        };

        await page.route('**/api/settings/get', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(settingsBundle),
        }));
        await page.route('**/api/backends/chat-completions/generate', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }),
        }));

        await page.goto('/modern/?view=api');

        await expect(page.locator('.api-diagnostic-card')).toHaveCount(6);
        await page.locator('[data-api-model-suggestion="deepseek-ai/DeepSeek-V4-Pro"]').click();
        await expect(page.locator('[data-api-model]')).toHaveValue('deepseek-ai/DeepSeek-V4-Pro');

        await page.locator('[data-test-api]').click();

        await expect(page.locator('.api-history-panel')).toContainText('可用');
        await expect(page.locator('.api-history-panel')).toContainText('deepseek-ai/DeepSeek-V4-Pro');

        await page.locator('[data-api-profile-main="textgenerationwebui"]').click();
        await expect(page.locator('.form-section-title', { hasText: '文本补全档案' })).toBeVisible();
        await expect(page.locator('[data-save-api-connection]')).toHaveCount(0);
    });

    test('does not show refresh toast on initial load', async ({ page }) => {
        await page.goto('/modern/?view=dashboard');

        await expect(page.locator('.page-title')).toHaveText('工作台');
        await expect(page.locator('.toast', { hasText: '刷新完成' })).toHaveCount(0);
    });

    test('shows generation engine controls on chat page', async ({ page }) => {
        await page.goto('/modern/?view=chat');

        await expect(page.locator('.page-title')).toHaveText('聊天工作区');
        await expect(page.locator('.engine-panel')).toBeVisible();
        await expect(page.locator('[data-check-generation-engine]')).toBeVisible();
    });

    test('prioritizes the chat thread on mobile', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/modern/?view=chat');

        await expect(page.locator('.page-title')).toHaveText('聊天工作区');
        await expect(page.locator('.chat-thread')).toBeVisible();
        await expect(page.locator('.chat-browser')).toHaveCount(0);
        await expect(page.locator('[data-toggle-chat-sidebar]', { hasText: '展开列表' })).toBeVisible();
    });

    test('loads more backgrounds instead of hard truncating asset grid', async ({ page }) => {
        const images = Array.from({ length: 30 }, (_, index) => ({
            filename: `mock-background-${index + 1}.jpg`,
            isAnimated: false,
        }));
        await page.route('**/api/backgrounds/all', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ images }),
        }));

        await page.goto('/modern/?view=assets');

        await expect(page.locator('.page-title')).toHaveText('素材库');
        await expect(page.locator('.background-card')).toHaveCount(24);
        await expect(page.locator('[data-load-more-backgrounds]')).toBeVisible();

        await page.locator('[data-load-more-backgrounds]').click();

        await expect(page.locator('.background-card')).toHaveCount(30);
        await expect(page.locator('[data-load-more-backgrounds]')).toHaveCount(0);
    });

    test('expands asset groups beyond the default preview size', async ({ page }) => {
        const tracks = Array.from({ length: 12 }, (_, index) => `assets/bgm/mock-track-${index + 1}.mp3`);
        await page.route('**/api/assets/get', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ bgm: tracks }),
        }));

        await page.goto('/modern/?view=assets');

        await expect(page.locator('.page-title')).toHaveText('素材库');
        await expect(page.locator('.asset-row')).toHaveCount(8);
        await expect(page.locator('[data-toggle-asset-group="bgm"]')).toBeVisible();

        await page.locator('[data-toggle-asset-group="bgm"]').click();

        await expect(page.locator('.asset-row')).toHaveCount(12);
        await expect(page.locator('[data-toggle-asset-group="bgm"]')).toContainText('收起资产');
    });

    test('uses a focused preset browser and saves selected preset JSON', async ({ page }) => {
        let savedPreset = null;
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'openai',
                chat_completion_source: 'siliconflow',
                oai_settings: {
                    preset_settings_openai: 'Preset A',
                    chat_completion_source: 'siliconflow',
                    siliconflow_model: 'deepseek-ai/DeepSeek-V4-Pro',
                },
            }),
            openai_setting_names: ['Preset A', 'Preset B'],
            openai_settings: [
                JSON.stringify({ chat_completion_source: 'siliconflow', siliconflow_model: 'model-a', temperature: 0.7 }),
                JSON.stringify({ chat_completion_source: 'siliconflow', siliconflow_model: 'model-b', temperature: 0.8 }),
            ],
            textgenerationwebui_preset_names: ['Text Preset'],
            textgenerationwebui_presets: [JSON.stringify({ temp: 0.5, max_length: 200 })],
        };

        await page.route('**/api/settings/get', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(settingsBundle),
        }));
        await page.route('**/api/presets/save', route => {
            savedPreset = route.request().postDataJSON();
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true }),
            });
        });

        await page.goto('/modern/?view=presets');

        await expect(page.locator('.page-title')).toHaveText('预设管理');
        await expect(page.locator('.preset-workspace')).toBeVisible();
        await expect(page.locator('[data-select-preset]')).toHaveCount(3);
        await expect(page.locator('[data-duplicate-preset]')).toHaveCount(1);

        await page.locator('[data-select-preset="Preset B"][data-preset-api="openai"]').click();
        await expect(page.locator('.preset-detail .detail-title')).toHaveText('Preset B');
        await expect(page.locator('[data-preset-json-input]')).toContainText('model-b');

        await page.locator('[data-preset-json-input]').fill(JSON.stringify({
            chat_completion_source: 'siliconflow',
            siliconflow_model: 'model-b-edited',
            temperature: 0.33,
        }, null, 2));
        await page.locator('[data-save-preset-json]').click();

        await expect.poll(() => savedPreset?.name).toBe('Preset B');
        expect(savedPreset).toMatchObject({
            apiId: 'openai',
            preset: {
                chat_completion_source: 'siliconflow',
                siliconflow_model: 'model-b-edited',
                temperature: 0.33,
            },
        });
    });

    test('edits advanced world entry fields without falling back to the legacy editor', async ({ page }) => {
        let savedWorldbook = null;
        const worldbookDetail = {
            entries: {
                1: {
                    uid: 1,
                    key: ['alpha'],
                    keysecondary: ['beta'],
                    comment: 'advanced entry',
                    content: 'lore content',
                    order: 100,
                    position: 4,
                    depth: 4,
                    role: 1,
                    probability: 80,
                    selectiveLogic: 2,
                    scanDepth: null,
                    caseSensitive: null,
                    matchWholeWords: true,
                    useGroupScoring: false,
                    addMemo: true,
                    constant: false,
                    vectorized: false,
                    selective: true,
                    useProbability: true,
                    disable: false,
                    ignoreBudget: false,
                    excludeRecursion: false,
                    preventRecursion: false,
                },
            },
            originalData: {
                entries: [{
                    uid: 1,
                    keys: ['alpha'],
                    secondary_keys: ['beta'],
                    comment: 'advanced entry',
                    content: 'lore content',
                    selectiveLogic: 2,
                    addMemo: true,
                    enabled: true,
                    extensions: {
                        position: 4,
                        depth: 4,
                        role: 1,
                        probability: 80,
                        match_whole_words: true,
                        use_group_scoring: false,
                    },
                }],
            },
        };

        await page.route('**/api/worldinfo/list', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([{ file_id: 'MockWorld', name: 'MockWorld' }]),
        }));
        await page.route('**/api/worldinfo/get', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(worldbookDetail),
        }));
        await page.route('**/api/worldinfo/edit', route => {
            savedWorldbook = route.request().postDataJSON();
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true }),
            });
        });

        await page.goto('/modern/?view=worldbooks');

        await expect(page.locator('.page-title')).toHaveText('世界书');
        await page.locator('[data-edit-world-entry="MockWorld"][data-world-entry-key="1"]').click();

        await expect(page.locator('[data-world-entry-field="selectiveLogic"]')).toHaveValue('2');
        await expect(page.locator('[data-world-entry-field="role"]')).toHaveValue('1');
        await expect(page.locator('[data-world-entry-field="scanDepth"]')).toHaveValue('');
        await expect(page.locator('[data-world-entry-field="matchWholeWords"]')).toHaveValue('true');

        await page.locator('[data-world-entry-field="selectiveLogic"]').selectOption('3');
        await page.locator('[data-world-entry-field="role"]').selectOption('2');
        await page.locator('[data-world-entry-field="scanDepth"]').fill('6');
        await page.locator('[data-world-entry-field="caseSensitive"]').selectOption('true');
        await page.locator('[data-world-entry-field="useGroupScoring"]').selectOption('true');
        await page.locator('[data-save-world-entry-edit]').click();

        await expect.poll(() => savedWorldbook?.data?.entries?.['1']?.selectiveLogic).toBe(3);
        expect(savedWorldbook.data.entries['1']).toMatchObject({
            role: 2,
            scanDepth: 6,
            caseSensitive: true,
            matchWholeWords: true,
            useGroupScoring: true,
            addMemo: true,
        });
        expect(savedWorldbook.data.originalData.entries[0]).toMatchObject({
            selectiveLogic: 3,
            addMemo: true,
            extensions: {
                role: 2,
                scan_depth: 6,
                case_sensitive: true,
                match_whole_words: true,
                use_group_scoring: true,
            },
        });
    });
});
