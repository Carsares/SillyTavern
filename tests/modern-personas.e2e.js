import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
import { createModernResourceFixture, gotoModern, mockModernWorkspace } from './modern-test-utils.js';

test.describe('Modern persona resources', () => {
    test('edits a persona and changes the default persona in the modern workspace', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'personas', '用户人设');

        await expect(page.locator('[data-persona-card="persona-alpha.png"] [data-persona-badge="default"]')).toHaveText('默认');
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

        await expect(page.locator('[data-persona-card="persona-beta.png"] [data-persona-badge="default"]')).toHaveText('默认');
        await expect(page.locator('[data-persona-card="persona-alpha.png"] [data-persona-badge="default"]')).toHaveCount(0);
        expect(fixture.requests.settingsSave.at(-1).power_user.default_persona).toBe('persona-beta.png');
    });

    test('creates a persona with an uploaded avatar in the modern workspace', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'personas', '用户人设');

        await page.locator('[data-create-persona]').click();
        await page.locator('[data-persona-field="name"][data-persona-scope="create"]').fill('Created Persona');
        await page.locator('[data-persona-field="title"][data-persona-scope="create"]').fill('Created title');
        await page.locator('[data-persona-field="description"][data-persona-scope="create"]').fill('Created persona description.');
        await page.locator('[data-persona-create-file]').setInputFiles({
            name: 'created-persona.png',
            mimeType: 'image/png',
            buffer: Buffer.from('created persona avatar'),
        });
        await page.locator('[data-save-persona-create]').click();

        await expect(page.locator('.toast', { hasText: '用户人设已创建' })).toBeVisible();
        await expect(page.locator('.resource-card', { hasText: 'Created Persona' })).toContainText('Created persona description.');
        expect(fixture.requests.avatarUpload[0]).toMatchObject({
            fileName: 'created-persona.png',
            overwriteName: '',
            path: 'created-persona.png',
        });
        expect(fixture.requests.avatarUpload[0].bodyText).toContain('name="avatar"; filename="created-persona.png"');
        expect(fixture.requests.settingsSave[0].power_user.personas['created-persona.png']).toBe('Created Persona');
        expect(fixture.requests.settingsSave[0].power_user.persona_descriptions['created-persona.png']).toMatchObject({
            title: 'Created title',
            description: 'Created persona description.',
        });
        // 已有默认人设时新建人设不改动默认人设。
        expect(fixture.requests.settingsSave[0].power_user.default_persona).toBe('persona-alpha.png');
    });

    test('marks the active and default personas, names unnamed personas, and toggles the default off', async ({ page }) => {
        const fixture = createModernResourceFixture({
            settings: {
                user_avatar: 'user-one.png',
                power_user: {
                    personas: {
                        'user-one.png': '[Unnamed Persona]',
                        'user-two.png': '[Unnamed Persona]',
                    },
                    persona_descriptions: {
                        'user-one.png': { title: '', description: '' },
                        'user-two.png': { title: '', description: '' },
                    },
                    default_persona: null,
                },
            },
        });
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'personas', '用户人设');

        const firstCard = page.locator('[data-persona-card="user-one.png"]');
        const secondCard = page.locator('[data-persona-card="user-two.png"]');
        await expect(firstCard.locator('.card-title')).toHaveText('未命名人设');
        await expect(firstCard.locator('.card-meta')).toHaveText('user-one.png');
        await expect(secondCard.locator('.card-title')).toHaveText('未命名人设');
        await expect(secondCard.locator('.card-meta')).toHaveText('user-two.png');
        await expect(page.locator('text=[Unnamed Persona]')).toHaveCount(0);

        await expect(firstCard.locator('[data-persona-badge="active"]')).toHaveText('当前使用');
        await expect(secondCard.locator('[data-persona-badge="active"]')).toHaveCount(0);
        await expect(page.locator('[data-persona-badge="default"]')).toHaveCount(0);
        await expect(page.locator('[data-set-default-persona]')).toHaveCount(2);
        await expect(page.locator('[data-clear-default-persona]')).toHaveCount(0);

        await secondCard.locator('[data-set-default-persona="user-two.png"]').click();

        await expect(secondCard.locator('[data-persona-badge="default"]')).toHaveText('默认');
        await expect(firstCard.locator('[data-persona-badge="default"]')).toHaveCount(0);
        await expect(secondCard.locator('[data-clear-default-persona="user-two.png"]')).toHaveText('取消默认');
        await expect(secondCard.locator('[data-set-default-persona]')).toHaveCount(0);
        expect(fixture.requests.settingsSave.at(-1).power_user.default_persona).toBe('user-two.png');

        await secondCard.locator('[data-clear-default-persona="user-two.png"]').click();

        await expect(page.locator('.toast', { hasText: '已取消默认人设' })).toBeVisible();
        await expect(page.locator('[data-persona-badge="default"]')).toHaveCount(0);
        await expect(secondCard.locator('[data-set-default-persona="user-two.png"]')).toBeEnabled();
        expect(fixture.requests.settingsSave.at(-1).power_user.default_persona).toBeNull();
        // 「当前使用」来自 user_avatar，取消默认不影响它。
        await expect(firstCard.locator('[data-persona-badge="active"]')).toHaveText('当前使用');
    });

    test('does not make a newly created persona the default when none is set', async ({ page }) => {
        const fixture = createModernResourceFixture({
            settings: {
                power_user: {
                    personas: { 'persona-alpha.png': 'Alpha Persona' },
                    persona_descriptions: { 'persona-alpha.png': { title: '', description: '' } },
                    default_persona: null,
                },
            },
        });
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'personas', '用户人设');

        await page.locator('[data-create-persona]').click();
        await page.locator('[data-persona-field="name"][data-persona-scope="create"]').fill('Fresh Persona');
        await page.locator('[data-persona-create-file]').setInputFiles({
            name: 'fresh-persona.png',
            mimeType: 'image/png',
            buffer: Buffer.from('fresh persona avatar'),
        });
        await page.locator('[data-save-persona-create]').click();

        await expect(page.locator('.toast', { hasText: '用户人设已创建' })).toBeVisible();
        expect(fixture.requests.settingsSave).toHaveLength(1);
        expect(fixture.requests.settingsSave[0].power_user.personas['fresh-persona.png']).toBe('Fresh Persona');
        expect(fixture.requests.settingsSave[0].power_user.default_persona).toBeNull();
        await expect(page.locator('[data-persona-card="fresh-persona.png"] [data-persona-badge="default"]')).toHaveCount(0);
        await expect(page.locator('[data-set-default-persona="fresh-persona.png"]')).toBeEnabled();
    });

    test('creates a persona with the default avatar when no image is chosen', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'personas', '用户人设');

        await page.locator('[data-create-persona]').click();
        const createPanel = page.locator('.section-panel', { hasText: '新建用户人设' });
        await expect(createPanel).toBeVisible();
        // 头像是可选项，表单在提交前就说明不选时使用默认头像。
        await expect(createPanel.locator('.field-label', { has: page.locator('[data-persona-create-file]') })).toContainText('头像图片（可选）');
        await expect(page.locator('[data-persona-create-file-status]')).toHaveText('未选择时使用默认头像，创建后可以随时替换。');
        await page.locator('[data-persona-field="name"][data-persona-scope="create"]').fill('No Upload Persona');
        await page.locator('[data-persona-field="title"][data-persona-scope="create"]').fill('No upload');
        await page.locator('[data-save-persona-create]').click();

        await expect(page.locator('.toast', { hasText: '用户人设已创建' })).toBeVisible();
        expect(fixture.requests.avatarUpload).toHaveLength(1);
        expect(fixture.requests.avatarUpload[0]).toMatchObject({ fileName: 'avatar.png', overwriteName: '' });
        expect(fixture.requests.avatarUpload[0].bodyText).toContain('Content-Type: image/png');
        const avatarId = fixture.requests.avatarUpload[0].path;
        expect(fixture.requests.settingsSave[0].power_user.personas[avatarId]).toBe('No Upload Persona');
        expect(fixture.requests.settingsSave[0].power_user.persona_descriptions[avatarId]).toMatchObject({ title: 'No upload' });
        await expect(page.locator(`[data-persona-card="${avatarId}"]`)).toContainText('No Upload Persona');
    });

    test('opens create panel and requires confirmation before deleting a persona', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'personas', '用户人设');

        await page.locator('[data-create-persona]').click();
        await expect(page.locator('.section-panel', { hasText: '新建用户人设' })).toBeVisible();
        await expect(page.locator('[data-persona-create-file]')).toHaveCount(1);

        await page.locator('[data-cancel-persona-create]').click();
        expect(fixture.requests.settingsSave).toHaveLength(0);
        const deletePersonaButton = page.locator('[data-delete-persona="persona-beta.png"]');
        await expect(deletePersonaButton).toHaveText('删除');
        await expect(deletePersonaButton).toHaveClass(/danger-action/);
        await expect(deletePersonaButton.locator('.fa-trash-can')).toHaveCount(1);
        await deletePersonaButton.click();
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

    test('replaces a persona avatar through the avatar upload endpoint', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'personas', '用户人设');

        await page.locator('[data-persona-avatar-file="persona-beta.png"]').setInputFiles({
            name: 'beta-new-avatar.png',
            mimeType: 'image/png',
            buffer: Buffer.from('modern persona avatar'),
        });

        await expect(page.locator('.toast', { hasText: '头像已替换' })).toBeVisible();
        expect(fixture.requests.avatarUpload).toHaveLength(1);
        expect(fixture.requests.avatarUpload[0]).toMatchObject({
            fileName: 'beta-new-avatar.png',
            overwriteName: 'persona-beta.png',
            path: 'persona-beta.png',
        });
        expect(fixture.requests.avatarUpload[0].contentType).toContain('multipart/form-data');
        expect(fixture.requests.avatarUpload[0].bodyText).toContain('name="avatar"; filename="beta-new-avatar.png"');
        expect(fixture.requests.avatarUpload[0].bodyText).toContain('name="overwrite_name"');
    });
});
