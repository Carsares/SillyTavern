import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
import { createModernResourceFixture, gotoModern, mockModernWorkspace } from './modern-test-utils.js';

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function fulfillJson(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

const presetBundleFields = {
    openai: ['openai_setting_names', 'openai_settings'],
    textgenerationwebui: ['textgenerationwebui_preset_names', 'textgenerationwebui_presets'],
    kobold: ['koboldai_setting_names', 'koboldai_settings'],
    novel: ['novelai_setting_names', 'novelai_settings'],
};

function createPresetFixture() {
    const fixture = createModernResourceFixture({
        settings: {
            main_api: 'openai',
            chat_completion_source: 'siliconflow',
            oai_settings: {
                preset_settings_openai: 'Preset A',
                chat_completion_source: 'siliconflow',
                siliconflow_model: 'model-a',
                bind_preset_to_connection: true,
            },
        },
        settingsBundle: {
            openai_setting_names: ['Preset A', 'Preset B'],
            openai_settings: [
                JSON.stringify({ chat_completion_source: 'siliconflow', siliconflow_model: 'model-a', temperature: 0.7, openai_max_tokens: 111 }),
                JSON.stringify({ chat_completion_source: 'siliconflow', siliconflow_model: 'model-b', temperature: 0.8, openai_max_tokens: 222 }),
            ],
            textgenerationwebui_preset_names: ['Text Preset'],
            textgenerationwebui_presets: [JSON.stringify({ temp: 0.5, max_length: 200 })],
        },
    });

    fixture.defaultPresets = {
        'openai:Preset B': {
            chat_completion_source: 'siliconflow',
            siliconflow_model: 'model-b-default',
            temperature: 0.22,
            openai_max_tokens: 333,
        },
    };
    fixture.requests.presetWorkflows = {
        saves: [],
        restores: [],
        deletes: [],
    };

    return fixture;
}

function getPresetBundleFields(apiId) {
    return presetBundleFields[apiId] || presetBundleFields.openai;
}

function upsertPreset(fixture, apiId, name, preset) {
    const [namesKey, contentsKey] = getPresetBundleFields(apiId);
    const names = fixture.settingsBundle[namesKey] || [];
    const contents = fixture.settingsBundle[contentsKey] || [];
    const index = names.indexOf(name);
    const content = JSON.stringify(preset);

    if (index >= 0) {
        contents[index] = content;
    } else {
        names.push(name);
        contents.push(content);
    }

    fixture.settingsBundle[namesKey] = names;
    fixture.settingsBundle[contentsKey] = contents;
}

function deletePreset(fixture, apiId, name) {
    const [namesKey, contentsKey] = getPresetBundleFields(apiId);
    const names = fixture.settingsBundle[namesKey] || [];
    const contents = fixture.settingsBundle[contentsKey] || [];
    const index = names.indexOf(name);
    if (index < 0) {
        return;
    }

    names.splice(index, 1);
    contents.splice(index, 1);
    fixture.settingsBundle[namesKey] = names;
    fixture.settingsBundle[contentsKey] = contents;
}

async function mockModernPresetsWorkspace(page) {
    const fixture = createPresetFixture();
    const requests = fixture.requests.presetWorkflows;
    await mockModernWorkspace(page, fixture);

    await page.route('**/api/presets/save', route => {
        const payload = route.request().postDataJSON();
        requests.saves.push(clone(payload));
        upsertPreset(fixture, payload.apiId, payload.name, payload.preset);
        return fulfillJson(route, { ok: true });
    });

    await page.route('**/api/presets/restore', route => {
        const payload = route.request().postDataJSON();
        requests.restores.push(clone(payload));
        const preset = fixture.defaultPresets[`${payload.apiId}:${payload.name}`];
        return fulfillJson(route, preset ? { isDefault: true, preset } : { isDefault: false });
    });

    await page.route('**/api/presets/delete', route => {
        const payload = route.request().postDataJSON();
        requests.deletes.push(clone(payload));
        deletePreset(fixture, payload.apiId, payload.name);
        return fulfillJson(route, { ok: true });
    });

    return fixture;
}

test.describe('Modern presets page', () => {
    test('imports, duplicates, exports, restores, uses, and deletes presets', async ({ page }) => {
        const fixture = await mockModernPresetsWorkspace(page);
        const requests = fixture.requests.presetWorkflows;

        await gotoModern(page, 'presets', '预设管理');

        await page.locator('[data-preset-import-file]').setInputFiles({
            name: 'Imported Preset.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({
                chat_completion_source: 'siliconflow',
                siliconflow_model: 'imported-model',
                temperature: 0.44,
            })),
        });

        await expect.poll(() => requests.saves.length).toBe(1);
        expect(requests.saves[0]).toMatchObject({
            apiId: 'openai',
            name: 'Imported Preset',
            preset: {
                siliconflow_model: 'imported-model',
                temperature: 0.44,
            },
        });
        await expect(page.locator('[data-select-preset="Imported Preset"][data-preset-api="openai"]')).toBeVisible();

        await page.locator('[data-select-preset="Preset B"][data-preset-api="openai"]').click();
        await page.locator('[data-duplicate-preset="Preset B"][data-preset-api="openai"]').click();

        await expect.poll(() => requests.saves.length).toBe(2);
        expect(requests.saves[1]).toMatchObject({
            apiId: 'openai',
            name: 'Preset B copy',
            preset: {
                siliconflow_model: 'model-b',
                temperature: 0.8,
            },
        });
        await expect(page.locator('[data-select-preset="Preset B copy"][data-preset-api="openai"]')).toBeVisible();

        const downloadPromise = page.waitForEvent('download');
        await page.locator('[data-export-preset="Preset B copy"][data-preset-api="openai"]').click();
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe('openai-Preset B copy.json');

        await page.locator('[data-select-preset="Preset B"][data-preset-api="openai"]').click();
        await page.locator('[data-restore-preset="Preset B"][data-preset-api="openai"]').click();

        await expect.poll(() => requests.restores.length).toBe(1);
        expect(requests.restores[0]).toEqual({ apiId: 'openai', name: 'Preset B' });
        await expect.poll(() => requests.saves.length).toBe(3);
        expect(requests.saves[2]).toMatchObject({
            apiId: 'openai',
            name: 'Preset B',
            preset: {
                siliconflow_model: 'model-b-default',
                temperature: 0.22,
                openai_max_tokens: 333,
            },
        });
        await expect(page.locator('[data-preset-json-input]')).toContainText('model-b-default');

        await page.locator('[data-use-openai-preset="Preset B"]').click();

        await expect.poll(() => fixture.requests.settingsSave.length).toBe(1);
        expect(fixture.requests.settingsSave[0].oai_settings).toMatchObject({
            preset_settings_openai: 'Preset B',
            chat_completion_source: 'siliconflow',
            siliconflow_model: 'model-b-default',
            temp_openai: 0.22,
            openai_max_tokens: 333,
        });
        await expect(page.locator('[data-select-preset="Preset B"][data-preset-api="openai"]')).toContainText('当前');

        await page.locator('[data-select-preset="Preset B copy"][data-preset-api="openai"]').click();
        await page.locator('[data-delete-preset="Preset B copy"][data-preset-api="openai"]').click();
        await expect(page.locator('.danger-panel', { hasText: '删除预设' })).toBeVisible();
        await page.locator('[data-cancel-preset-delete]').click();
        expect(requests.deletes).toHaveLength(0);

        await page.locator('[data-delete-preset="Preset B copy"][data-preset-api="openai"]').click();
        await page.locator('[data-confirm-preset-delete]').click();

        await expect.poll(() => requests.deletes.length).toBe(1);
        expect(requests.deletes[0]).toEqual({ apiId: 'openai', name: 'Preset B copy' });
        await expect(page.locator('[data-select-preset="Preset B copy"][data-preset-api="openai"]')).toHaveCount(0);
    });
});
