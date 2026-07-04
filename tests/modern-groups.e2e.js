import { test, expect } from '@playwright/test';
import { createModernResourceFixture, gotoModern, mockModernWorkspace } from './modern-test-utils.js';

test.describe('Modern group resources', () => {
    test('opens group creation from the empty state call to action', async ({ page }) => {
        const fixture = createModernResourceFixture({ groups: [] });
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'groups', '群组管理');

        await expect(page.locator('.empty-state', { hasText: '暂无群组' })).toBeVisible();
        await page.locator('.empty-state [data-create-group]').click();

        await expect(page.locator('.settings-form', { hasText: '新建群组' })).toBeVisible();
        expect(fixture.requests.groupCreate).toHaveLength(0);
    });

    test('creates and edits a group in the modern workspace', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'groups', '群组管理');

        await page.locator('[data-create-group]').click();
        await expect(page.locator('.settings-form', { hasText: '新建群组' })).toBeVisible();
        await page.locator('[data-group-field="name"][data-group-scope="create"]').fill('Modern Test Group');
        await page.locator('[data-group-field="activation_strategy"][data-group-scope="create"]').selectOption('2');
        await page.locator('[data-group-member="alice.png"][data-group-scope="create"]').check();
        await page.locator('[data-group-member="bruno.png"][data-group-scope="create"]').check();
        await page.locator('[data-save-group-create]').click();

        await expect(page.locator('.detail-title')).toHaveText('Modern Test Group');
        await expect(page.locator('[data-select-group="modern-test-group"]')).toBeVisible();
        expect(fixture.requests.groupCreate[0]).toMatchObject({
            name: 'Modern Test Group',
            members: ['alice.png', 'bruno.png'],
            activation_strategy: 2,
        });

        await page.locator('[data-edit-group="modern-test-group"]').click();
        await expect(page.locator('.settings-form', { hasText: '编辑群组' })).toBeVisible();
        await page.locator('[data-group-field="name"][data-group-scope="edit"]').fill('Edited Modern Group');
        await page.locator('[data-group-field="allow_self_responses"][data-group-scope="edit"]').check();
        await page.locator('[data-group-field="generation_mode"][data-group-scope="edit"]').selectOption('1');
        await page.locator('[data-group-member="bruno.png"][data-group-scope="edit"]').uncheck();
        await page.locator('[data-save-group-edit]').click();

        await expect(page.locator('.detail-title')).toHaveText('Edited Modern Group');
        await expect(page.locator('.detail-tags')).toContainText('允许自回复');
        await expect(page.locator('.panel-subtitle').filter({ hasText: 'modern-test-group' })).toContainText('1 个成员');
        await expect(page.locator('.resource-row', { hasText: 'Bruno Fixture' })).toHaveCount(0);
        expect(fixture.requests.groupEdit[0]).toMatchObject({
            id: 'modern-test-group',
            name: 'Edited Modern Group',
            members: ['alice.png'],
            allow_self_responses: true,
            generation_mode: 1,
        });
    });

    test('requires confirmation before deleting a group', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'groups', '群组管理');

        await page.locator('[data-delete-group="group-alpha"]').click();
        await expect(page.locator('.danger-panel', { hasText: '删除群组' })).toBeVisible();
        await page.locator('[data-cancel-group-delete]').click();

        await expect(page.locator('.danger-panel', { hasText: '删除群组' })).toHaveCount(0);
        expect(fixture.requests.groupDelete).toHaveLength(0);

        await page.locator('[data-delete-group="group-alpha"]').click();
        await page.locator('[data-confirm-group-delete]').click();

        await expect(page.locator('[data-select-group="group-alpha"]')).toHaveCount(0);
        await expect(page.locator('[data-select-group="group-beta"]')).toBeVisible();
        expect(fixture.requests.groupDelete[0]).toMatchObject({ id: 'group-alpha' });
    });
});
