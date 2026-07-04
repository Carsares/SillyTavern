import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
import { createModernResourceFixture, gotoModern, mockModernWorkspace } from './modern-test-utils.js';

function createScrollableCharacters(count = 32) {
    return Array.from({ length: count }, (_, index) => {
        const name = `Scroll Character ${index + 1}`;
        return {
            avatar: `scroll-character-${index + 1}.png`,
            name,
            description: `${name} visible description.`,
            data: {
                name,
                description: `${name} visible description.`,
                personality: 'Keeps the list stable.',
                scenario: 'Modern scroll fixture scenario.',
                first_mes: `Hello from ${name}.`,
                creator: 'Modern E2E',
                tags: ['fixture', 'scroll'],
                extensions: {
                    world: '',
                    talkativeness: 0.5,
                    fav: false,
                    depth_prompt: {
                        prompt: '',
                        depth: 4,
                        role: 'system',
                    },
                },
            },
        };
    });
}

function createCharacterWithDescription(description) {
    return {
        avatar: 'long-description.png',
        name: 'Long Description Character',
        description,
        data: {
            name: 'Long Description Character',
            description,
            personality: 'Keeps long lore readable.',
            scenario: 'Modern long description fixture scenario.',
            first_mes: 'Hello from the long description character.',
            creator: 'Modern E2E',
            tags: ['fixture', 'description'],
            extensions: {
                world: '',
                talkativeness: 0.5,
                fav: false,
                depth_prompt: {
                    prompt: '',
                    depth: 4,
                    role: 'system',
                },
            },
        },
    };
}

test.describe('Modern character resources', () => {
    test('shows field errors for missing character names without marking data load failed', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'characters', '角色库');

        await page.locator('[data-create-character]').click();
        await page.locator('[data-save-character-create]').click();

        const createName = page.locator('[data-character-field="name"][data-character-scope="create"]');
        await expect(createName).toHaveAttribute('aria-invalid', 'true');
        await expect(page.locator('#character-create-name-error')).toHaveText('请输入角色名称。');
        await expect(createName).toBeFocused();
        await expect(page.locator('#connectionStatus')).not.toContainText('部分失败');
        expect(fixture.requests.characterCreate).toHaveLength(0);

        await page.locator('[data-cancel-character-create]').click();
        await page.locator('[data-edit-character="alice.png"]').click();
        const editName = page.locator('[data-character-field="name"][data-character-scope="edit"]');
        await editName.fill('');
        await page.locator('[data-save-character-edit]').click();

        await expect(editName).toHaveAttribute('aria-invalid', 'true');
        await expect(page.locator('#character-edit-name-error')).toHaveText('请输入角色名称。');
        await expect(editName).toBeFocused();
        await expect(page.locator('#connectionStatus')).not.toContainText('部分失败');
        expect(fixture.requests.characterMerge).toHaveLength(0);
    });

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

    test('imports a character file through the upload endpoint', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'characters', '角色库');

        await page.locator('[data-character-import-file]').setInputFiles({
            name: 'Imported Modern Character.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({
                spec: 'chara_card_v2',
                data: {
                    name: 'Imported Modern Character',
                    description: 'Imported character visible description.',
                },
            })),
        });

        await expect(page.locator('[data-select-character="imported-modern-character.png"]')).toBeVisible();
        await expect(page.locator('.detail-title')).toHaveText('Imported Modern Character');
        await expect(page.locator('.detail-text')).toContainText('Imported character visible description.');

        expect(fixture.requests.characterImport).toHaveLength(1);
        expect(fixture.requests.characterImport[0]).toMatchObject({
            fileName: 'Imported Modern Character.json',
            fileType: 'json',
            preservedName: 'Imported Modern Character.json',
        });
        expect(fixture.requests.characterImport[0].contentType).toContain('multipart/form-data');
        expect(fixture.requests.characterImport[0].bodyText).toContain('name="avatar"; filename="Imported Modern Character.json"');
        expect(fixture.requests.characterImport[0].bodyText).toContain('name="file_type"');
        expect(fixture.requests.characterImport[0].bodyText).toContain('name="preserved_name"');
    });

    test('replaces a character avatar through the avatar edit endpoint', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'characters', '角色库');

        await page.locator('[data-character-avatar-file="alice.png"]').setInputFiles({
            name: 'alice-new-avatar.png',
            mimeType: 'image/png',
            buffer: Buffer.from('modern character avatar'),
        });

        await expect(page.locator('.toast', { hasText: '角色头像已替换' })).toBeVisible();
        expect(fixture.requests.characterAvatarEdit).toHaveLength(1);
        expect(fixture.requests.characterAvatarEdit[0]).toMatchObject({
            avatar: 'alice.png',
            fileName: 'alice-new-avatar.png',
        });
        expect(fixture.requests.characterAvatarEdit[0].contentType).toContain('multipart/form-data');
        expect(fixture.requests.characterAvatarEdit[0].bodyText).toContain('name="avatar"; filename="alice-new-avatar.png"');
        expect(fixture.requests.characterAvatarEdit[0].bodyText).toContain('name="avatar_url"');
    });

    test('collapses long character descriptions behind a labelled section', async ({ page }) => {
        const longDescription = Array.from({ length: 16 }, (_, index) => `Long description sentence ${index + 1} keeps enough text in the role card to require multiple visible lines.`).join(' ');
        const fixture = createModernResourceFixture({
            characters: [createCharacterWithDescription(longDescription)],
        });
        await mockModernWorkspace(page, fixture);

        await page.setViewportSize({ width: 1600, height: 900 });
        await gotoModern(page, 'characters', '角色库');

        const descriptionText = page.locator('.detail-description .detail-text');
        await expect(page.locator('.detail-description-title')).toHaveText('角色描述');
        await expect(descriptionText).toContainText('Long description sentence 1');
        await expect(page.locator('.detail-description-expand')).toBeVisible();
        await expect(page.locator('.detail-description-collapse')).toBeHidden();
        await expect.poll(() => descriptionText.evaluate(element => element.ownerDocument.defaultView.getComputedStyle(element).webkitLineClamp)).toBe('5');
        const collapsedBox = await descriptionText.boundingBox();

        await page.locator('[data-toggle-character-description]').click();

        await expect(page.locator('[data-character-description-toggle]')).toBeChecked();
        await expect(page.locator('.detail-description-collapse')).toBeVisible();
        await expect.poll(() => descriptionText.evaluate(element => element.ownerDocument.defaultView.getComputedStyle(element).webkitLineClamp)).toBe('none');
        const expandedBox = await descriptionText.boundingBox();
        expect(expandedBox?.height).toBeGreaterThan(collapsedBox?.height || 0);
    });

    test('keeps the character list scroll position when selecting a character', async ({ page }) => {
        const fixture = createModernResourceFixture({
            characters: createScrollableCharacters(),
        });
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'characters', '角色库');

        const list = page.locator('[data-character-list]');
        await expect(list).toBeVisible();
        await expect.poll(() => list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);

        const target = page.locator('[data-select-character="scroll-character-28.png"]');
        await target.scrollIntoViewIfNeeded();
        const beforeSelectScrollTop = await list.evaluate(element => element.scrollTop);
        expect(beforeSelectScrollTop).toBeGreaterThan(0);

        await target.click();

        await expect(page.locator('.detail-title')).toHaveText('Scroll Character 28');
        await expect(target).toHaveClass(/active/);
        const afterSelectScrollTop = await list.evaluate(element => element.scrollTop);
        expect(afterSelectScrollTop).toBeGreaterThan(0);
        expect(Math.abs(afterSelectScrollTop - beforeSelectScrollTop)).toBeLessThan(8);
    });
});
