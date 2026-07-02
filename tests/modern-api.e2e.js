import { test, expect } from '@playwright/test';

async function mockModernApiShell(page, settingsBundle, secretState = {}) {
    await page.route('**/csrf-token', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'modern-api-test' }),
    }));

    await page.route('**/api/users/me', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ handle: 'modern-test' }),
    }));

    await page.route('**/api/settings/get', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(settingsBundle),
    }));

    await page.route('**/api/characters/all', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
    }));

    await page.route('**/api/groups/all', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
    }));

    await page.route('**/api/worldinfo/list', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
    }));

    await page.route('**/api/backgrounds/all', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
    }));

    await page.route('**/api/backgrounds/folders', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ folders: [], imageFolderMap: {} }),
    }));

    await page.route('**/api/assets/get', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
    }));

    await page.route('**/api/extensions/discover', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
    }));

    await page.route('**/api/secrets/settings', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ allowKeysExposure: false }),
    }));

    await page.route('**/api/secrets/read', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(secretState),
    }));

    await page.route('**/api/stats/get', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
    }));
}

test.describe('Modern API page', () => {
    test('edits and tests text completion connection without exposing secrets', async ({ page }) => {
        let savedSettings = null;
        let writtenSecret = null;
        let statusBody = null;
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'textgenerationwebui',
                textgenerationwebui_settings: {
                    type: 'openrouter',
                    server_urls: {
                        openrouter: 'https://openrouter.ai/api',
                    },
                    openrouter_model: 'openrouter/auto',
                    preset: 'Text Preset A',
                },
            }),
            textgenerationwebui_preset_names: ['Text Preset A', 'Text Preset B'],
            textgenerationwebui_presets: [
                JSON.stringify({ temp: 0.7 }),
                JSON.stringify({ temp: 0.8 }),
            ],
            openai_setting_names: [],
            openai_settings: [],
        };

        await mockModernApiShell(page, settingsBundle, {
            api_key_openrouter: [{ id: 'saved', value: '********ret', label: 'saved', active: true }],
        });

        await page.route('**/api/secrets/write', route => {
            writtenSecret = route.request().postDataJSON();
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true }),
            });
        });

        await page.route('**/api/settings/save', route => {
            savedSettings = route.request().postDataJSON();
            settingsBundle.settings = JSON.stringify(savedSettings);
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true }),
            });
        });

        await page.route('**/api/backends/text-completions/status', route => {
            statusBody = route.request().postDataJSON();
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ result: 'openrouter/new-model', data: [{ id: 'openrouter/new-model' }] }),
            });
        });

        await page.goto('/modern/?view=api');

        await expect(page.locator('[data-textgen-type]')).toHaveValue('openrouter');
        await expect(page.locator('[data-textgen-endpoint]')).toHaveValue('https://openrouter.ai/api');
        await expect(page.locator('[data-textgen-model]')).toHaveValue('openrouter/auto');
        await expect(page.locator('[data-textgen-secret-status]')).toHaveText('密钥已保存');
        await expect(page.locator('body')).not.toContainText('sk-secret');

        await page.locator('[data-textgen-endpoint]').fill('https://openrouter.ai/api/v1');
        await page.locator('[data-textgen-model]').fill('openrouter/new-model');
        await page.locator('[data-textgen-preset]').selectOption('Text Preset B');
        await page.locator('[data-textgen-api-key]').fill('sk-secret-textgen');
        await page.locator('[data-save-api-connection]').click();

        await expect.poll(() => savedSettings?.textgenerationwebui_settings?.openrouter_model).toBe('openrouter/new-model');
        expect(savedSettings.main_api).toBe('textgenerationwebui');
        expect(savedSettings.textgenerationwebui_settings.type).toBe('openrouter');
        expect(savedSettings.textgenerationwebui_settings.server_urls.openrouter).toBe('https://openrouter.ai/api/v1');
        expect(savedSettings.textgenerationwebui_settings.preset).toBe('Text Preset B');
        expect(writtenSecret).toMatchObject({
            key: 'api_key_openrouter',
            value: 'sk-secret-textgen',
        });
        await expect(page.locator('body')).not.toContainText('sk-secret-textgen');

        await page.locator('[data-test-api]').click();

        await expect.poll(() => statusBody).toMatchObject({
            api_server: 'https://openrouter.ai/api/v1',
            api_type: 'openrouter',
        });
        await expect(page.locator('.api-history-panel')).toContainText('openrouter/new-model');
    });
});
