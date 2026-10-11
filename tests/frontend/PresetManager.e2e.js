import { test, expect } from '@playwright/test';

/* global document */

test.describe('Preset manager', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('**/api/settings/save', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        await page.goto('/index.html?modernBridge=1');
        await page.waitForFunction('document.readyState === "complete"');
        await expect.poll(() => page.evaluate(async () => Boolean((await import('./scripts/preset-manager.js')).getPresetManager('instruct')))).toBe(true);
    });

    test('keeps both presets and reports failure when rename cannot delete the old preset', async ({ page }) => {
        const requestOrder = [];
        await page.route('**/api/presets/save', route => {
            requestOrder.push('save');
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{"name":"New Preset"}' });
        });
        await page.route('**/api/presets/delete', route => {
            requestOrder.push('delete');
            return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        });

        const state = await page.evaluate(async () => {
            const { instruct_presets } = await import('./scripts/instruct-mode.js');
            const { getPresetManager } = await import('./scripts/preset-manager.js');
            const manager = getPresetManager('instruct');
            instruct_presets.splice(0, instruct_presets.length, { name: 'Old Preset', input_sequence: '', output_sequence: '' });

            const select = manager.select[0];
            const option = document.createElement('option');
            option.value = 'Old Preset';
            option.textContent = 'Old Preset';
            option.selected = true;
            select.replaceChildren(option);

            let failed = false;
            try {
                await manager.renamePreset('New Preset');
            } catch {
                failed = true;
            }

            return {
                failed,
                presetNames: instruct_presets.map(preset => preset.name),
                options: Array.from(select.options).map(presetOption => presetOption.textContent),
                selected: manager.getSelectedPresetName(),
            };
        });

        expect(requestOrder).toEqual(['save', 'delete']);
        expect(state).toEqual({
            failed: true,
            presetNames: ['Old Preset', 'New Preset'],
            options: ['Old Preset', 'New Preset'],
            selected: 'New Preset',
        });
    });
});
