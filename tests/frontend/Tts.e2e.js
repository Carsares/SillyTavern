import { test, expect } from '@playwright/test';

/* global document */

test.describe('TTS settings', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('**/api/settings/save', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        await page.goto('/index.html?modernBridge=1');
        await page.waitForFunction(() => {
            const provider = document.getElementById('tts_provider');
            return document.readyState === 'complete' && provider && Array.from(provider.options).some(option => option.value === 'System');
        });
    });

    test('initializes the voice map when TTS is enabled after provider loading', async ({ page }) => {
        await page.evaluate(() => {
            const enabled = document.getElementById('tts_enabled');
            if (enabled.checked) {
                enabled.click();
            }

            const provider = document.getElementById('tts_provider');
            provider.value = 'System';
            provider.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await expect(page.locator('#system_tts_rate')).toBeAttached();
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
        await page.evaluate(() => document.getElementById('tts_voicemap_block').replaceChildren());
        await expect(page.locator('#tts_voicemap_block .tts_voicemap_block_char')).toHaveCount(0);

        await page.evaluate(() => document.getElementById('tts_enabled').click());

        await expect(page.locator('#tts_enabled')).toBeChecked();
        await expect(page.locator('#tts_voicemap_block .tts_voicemap_block_char')).not.toHaveCount(0);
        await expect(page.locator('#tts_status')).toContainText('TTS Provider Loaded');
    });
});
