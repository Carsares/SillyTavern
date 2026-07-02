import { test, expect } from '@playwright/test';
import { createModernResourceFixture, gotoModern, mockModernWorkspace } from './modern-test-utils.js';

test.describe('Modern persona resources', () => {
    test('edits a persona and changes the default persona in the modern workspace', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'personas', '用户人设');

        await expect(page.locator('.resource-card', { hasText: 'Alpha Persona' })).toContainText('默认');
        await page.locator('[data-edit-persona="persona-beta.png"]').click();
        await expect(page.locator('.settings-form', { hasText: '保存' })).toBeVisible();
        await page.locator('[data-persona-field="name"][data-persona-scope="edit"]').fill('Edited Persona');
        await page.locator('[data-persona-field="title"][data-persona-scope="edit"]').fill('Edited title');
        await page.locator('[data-persona-field="description"][data-persona-scope="edit"]').fill('Edited persona description.');
        await page.locator('[data-save-persona-edit]').click();

        await expect(page.locator('.resource-card', { hasText: 'Edited Persona' })).toContainText('Edited persona description.');
        expect(fixture.requests.settingsSave[0].power_user.personas['persona-beta.png']).toBe('Edited Persona');
        expect(fixture.requests.settingsSave[0].power_user.persona_descriptions['persona-beta.png']).toMatchObject({
            title: 'Edited title',
            description: 'Edited persona description.',
        });

        await page.locator('[data-set-default-persona="persona-beta.png"]').click();

        await expect(page.locator('.resource-card', { hasText: 'Edited Persona' })).toContainText('默认');
        expect(fixture.requests.settingsSave.at(-1).power_user.default_persona).toBe('persona-beta.png');
    });

    test('opens create panel and requires confirmation before deleting a persona', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'personas', '用户人设');

        await page.locator('[data-create-persona]').click();
        await expect(page.locator('.section-panel', { hasText: '新建用户人设' })).toBeVisible();
        await page.locator('[data-persona-field="name"][data-persona-scope="create"]').fill('No Upload Persona');
        await page.locator('[data-persona-field="title"][data-persona-scope="create"]').fill('No upload');
        await expect(page.locator('[data-persona-create-file]')).toHaveCount(1);
        await page.locator('[data-save-persona-create]').click();

        await expect(page.locator('.toast', { hasText: '请先选择头像图片。' })).toBeVisible();
        expect(fixture.requests.settingsSave).toHaveLength(0);

        await page.locator('[data-cancel-persona-create]').click();
        await page.locator('[data-delete-persona="persona-beta.png"]').click();
        await expect(page.locator('.danger-panel', { hasText: '删除用户人设' })).toBeVisible();
        await page.locator('[data-cancel-persona-delete]').click();

        await expect(page.locator('.danger-panel', { hasText: '删除用户人设' })).toHaveCount(0);
        expect(fixture.requests.avatarDelete).toHaveLength(0);

        await page.locator('[data-delete-persona="persona-beta.png"]').click();
        await page.locator('[data-confirm-persona-delete]').click();

        await expect(page.locator('.resource-card', { hasText: 'Beta Persona' })).toHaveCount(0);
        expect(fixture.requests.avatarDelete[0]).toMatchObject({ avatar: 'persona-beta.png' });
        expect(fixture.requests.settingsSave.at(-1).power_user.personas['persona-beta.png']).toBeUndefined();
    });
});
