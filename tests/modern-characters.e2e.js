import { test, expect } from '@playwright/test';
import { createModernResourceFixture, gotoModern, mockModernWorkspace } from './modern-test-utils.js';

test.describe('Modern character resources', () => {
    test('creates and edits a character in the modern workspace', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'characters', '角色库');

        await expect(page.locator('label.file-action', { hasText: '导入文件' })).toBeVisible();
        await expect(page.locator('[data-character-import-file]')).toHaveCount(1);

        await page.locator('[data-create-character]').click();
        await expect(page.locator('.settings-form', { hasText: '新建角色' })).toBeVisible();
        await page.locator('[data-character-field="name"][data-character-scope="create"]').fill('Modern Test Character');
        await page.locator('[data-character-field="creator"][data-character-scope="create"]').fill('Modern E2E');
        await page.locator('[data-character-field="tags"][data-character-scope="create"]').fill('modern, resource');
        await page.locator('[data-character-field="description"][data-character-scope="create"]').fill('Created visible description.');
        await page.locator('[data-character-field="first_mes"][data-character-scope="create"]').fill('Created opening message.');
        await page.locator('[data-character-field="world"][data-character-scope="create"]').selectOption('ModernLore');
        await page.locator('[data-save-character-create]').click();

        await expect(page.locator('.detail-title')).toHaveText('Modern Test Character');
        await expect(page.locator('[data-select-character="modern-test-character.png"]')).toBeVisible();
        expect(fixture.requests.characterCreate[0]).toMatchObject({
            ch_name: 'Modern Test Character',
            creator: 'Modern E2E',
            tags: ['modern', 'resource'],
            world: 'ModernLore',
        });

        await page.locator('[data-edit-character="modern-test-character.png"]').click();
        await expect(page.locator('.settings-form', { hasText: '编辑角色卡' })).toBeVisible();
        await page.locator('[data-character-field="description"][data-character-scope="edit"]').fill('Edited visible description.');
        await page.locator('[data-character-field="personality"][data-character-scope="edit"]').fill('Edited personality.');
        await page.locator('[data-save-character-edit]').click();

        await expect(page.locator('.detail-text')).toContainText('Edited visible description.');
        expect(fixture.requests.characterMerge[0]).toMatchObject({
            avatar: 'modern-test-character.png',
            description: 'Edited visible description.',
            personality: 'Edited personality.',
        });
    });

    test('requires confirmation before deleting a character', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'characters', '角色库');

        await page.locator('[data-delete-character="alice.png"]').click();
        await expect(page.locator('.danger-panel', { hasText: '删除角色' })).toBeVisible();
        await page.locator('[data-character-delete-chats]').check();
        await page.locator('[data-cancel-character-delete]').click();

        await expect(page.locator('.danger-panel', { hasText: '删除角色' })).toHaveCount(0);
        expect(fixture.requests.characterDelete).toHaveLength(0);

        await page.locator('[data-delete-character="alice.png"]').click();
        await page.locator('[data-character-delete-chats]').check();
        await page.locator('[data-confirm-character-delete]').click();

        await expect(page.locator('[data-select-character="alice.png"]')).toHaveCount(0);
        await expect(page.locator('[data-select-character="bruno.png"]')).toBeVisible();
        expect(fixture.requests.characterDelete[0]).toMatchObject({
            avatar_url: 'alice.png',
            delete_chats: true,
        });
    });
});
