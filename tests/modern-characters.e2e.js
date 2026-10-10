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

function createDisplayCharacter({ avatar, name, creator, tags = [], world = '', extra = {} }) {
    return {
        avatar,
        name,
        description: `${name} visible description.`,
        data: {
            name,
            description: `${name} visible description.`,
            personality: '',
            scenario: '',
            first_mes: `Hello from ${name}.`,
            creator,
            tags,
            extensions: {
                world,
                talkativeness: 0.5,
                fav: false,
                depth_prompt: { prompt: '', depth: 4, role: 'system' },
            },
        },
        ...extra,
    };
}

function multipartField(bodyText, fieldName) {
    const match = new RegExp(`name="${fieldName}"\\r?\\n\\r?\\n([^\\r\\n]*)`).exec(bodyText);
    return match?.[1] ?? null;
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

        const deleteCharacterButton = page.locator('[data-delete-character="alice.png"]');
        await expect(deleteCharacterButton).toHaveText('删除');
        await expect(deleteCharacterButton).toHaveClass(/danger-action/);
        await expect(deleteCharacterButton.locator('.fa-trash-can')).toHaveCount(1);
        await deleteCharacterButton.click();
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
        expect(fixture.requests.characterImport[0].bodyText).not.toContain('name="preserved_name"');
    });

    test('migrates attached worldbooks from the saved world info settings when renaming a character', async ({ page }) => {
        const fixture = createModernResourceFixture({
            settings: {
                world_info_settings: {
                    world_info: {
                        charLore: [{ name: 'alice', extraBooks: ['ModernLore'] }],
                    },
                },
            },
        });
        await mockModernWorkspace(page, fixture);
        await page.route('**/api/characters/rename', async route => {
            const payload = route.request().postDataJSON();
            const previousAvatar = payload.avatar_url;
            const nextAvatar = 'renamed-alice.png';
            const character = fixture.characterDetails[previousAvatar];
            fixture.characters = fixture.characters.map(item => item.avatar === previousAvatar
                ? { ...item, avatar: nextAvatar, name: payload.new_name, data: { ...item.data, name: payload.new_name } }
                : item);
            fixture.characterDetails[nextAvatar] = { ...character, avatar: nextAvatar, name: payload.new_name, data: { ...character.data, name: payload.new_name } };
            delete fixture.characterDetails[previousAvatar];
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ avatar: nextAvatar }),
            });
        });

        await gotoModern(page, 'characters', '角色库');
        await page.locator('[data-rename-character="alice.png"]').click();
        await page.locator('[data-character-rename-input]').fill('Renamed Alice');
        await page.locator('[data-confirm-character-rename]').click();

        await expect(page.locator('[data-select-character="renamed-alice.png"]')).toBeVisible();
        await expect(page.locator('.detail-title')).toHaveText('Renamed Alice');
        expect(fixture.requests.settingsSave).toHaveLength(1);
        expect(fixture.requests.settingsSave[0].world_info_settings.world_info.charLore).toEqual([
            { name: 'renamed-alice', extraBooks: ['ModernLore'] },
        ]);
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

    test('keeps unsaved character edits across routes with a notice and an explicit discard', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);
        await page.setViewportSize({ width: 1280, height: 800 });

        await gotoModern(page, 'characters', '角色库');
        await page.locator('[data-edit-character="alice.png"]').click();

        const editActions = page.locator('[data-character-form-actions="edit"]');
        await expect(editActions).toHaveAttribute('data-dirty', 'false');
        await expect(editActions).toContainText('没有未保存的修改');

        const description = page.locator('[data-character-field="description"][data-character-scope="edit"]');
        await description.fill('Alice visible description. Unsaved addition.');
        await expect(editActions).toHaveAttribute('data-dirty', 'true');
        await expect(editActions).toContainText('有未保存的修改');
        await expect(description).toBeFocused();

        // 表单远高于视口时，操作栏贴在视口底部，不用滚到表单末尾也能保存或放弃。
        await page.locator('.page-title').evaluate(element => element.ownerDocument.defaultView.scrollTo(0, 0));
        const formBox = await page.locator('[data-character-edit-panel]').boundingBox();
        expect(formBox?.height || 0).toBeGreaterThan(800);
        await expect(editActions).toHaveCSS('position', 'sticky');
        const actionsBox = await editActions.boundingBox();
        expect(actionsBox).not.toBeNull();
        expect((actionsBox?.y || 0) + (actionsBox?.height || 0)).toBeLessThanOrEqual(801);
        expect(actionsBox?.y || 0).toBeGreaterThan(0);

        await page.locator('.nav-button[data-route="dashboard"]').click();
        await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'dashboard');
        await page.locator('.nav-button[data-route="characters"]').click();
        await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'characters');

        await expect(description).toHaveValue('Alice visible description. Unsaved addition.');
        await expect(editActions).toContainText('有未保存的修改');

        // 「收起」保留草稿：详情顶部出现提示，可以继续编辑。
        await editActions.locator('[data-cancel-character-edit]').click();
        const draftNotice = page.locator('[data-character-draft-notice="alice.png"]');
        await expect(draftNotice).toContainText('有未保存的修改');
        await expect(description).toHaveCount(0);
        await draftNotice.locator('[data-resume-character-draft="alice.png"]').click();
        await expect(description).toHaveValue('Alice visible description. Unsaved addition.');

        // 开始编辑另一个角色时，当前角色的修改转存为草稿。
        await page.locator('[data-select-character="bruno.png"]').click();
        await page.locator('[data-edit-character="bruno.png"]').click();
        await expect(page.locator('[data-character-form-actions="edit"]')).toHaveAttribute('data-dirty', 'false');
        await page.locator('[data-select-character="alice.png"]').click();
        await expect(draftNotice).toBeVisible();
        await draftNotice.locator('[data-resume-character-draft="alice.png"]').click();
        await expect(description).toHaveValue('Alice visible description. Unsaved addition.');

        await editActions.locator('[data-discard-character-draft="alice.png"]').click();
        await expect(page.locator('[data-character-edit-panel]')).toHaveCount(0);
        await expect(draftNotice).toHaveCount(0);
        await page.locator('[data-edit-character="alice.png"]').click();
        await expect(description).toHaveValue('Alice visible description.');
        await expect(editActions).toHaveAttribute('data-dirty', 'false');
        expect(fixture.requests.characterMerge).toHaveLength(0);
    });

    test('saves a restored character edit draft', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'characters', '角色库');
        await page.locator('[data-edit-character="alice.png"]').click();
        await page.locator('[data-character-field="personality"][data-character-scope="edit"]').fill('Draft personality.');
        await page.locator('[data-cancel-character-edit]').click();
        await page.locator('[data-resume-character-draft="alice.png"]').click();
        await page.locator('[data-save-character-edit]').click();

        await expect(page.locator('.toast', { hasText: '角色卡已保存' })).toBeVisible();
        await expect(page.locator('[data-character-draft-notice="alice.png"]')).toHaveCount(0);
        expect(fixture.requests.characterMerge[0]).toMatchObject({
            avatar: 'alice.png',
            personality: 'Draft personality.',
        });
    });

    test('keeps unsaved character edits when renaming the character', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);
        await page.route('**/api/characters/rename', async route => {
            const payload = route.request().postDataJSON();
            const nextAvatar = 'renamed-alice.png';
            const character = fixture.characterDetails[payload.avatar_url];
            const renamed = { ...character, avatar: nextAvatar, name: payload.new_name, data: { ...character.data, name: payload.new_name } };
            fixture.characters = fixture.characters.map(item => item.avatar === payload.avatar_url ? renamed : item);
            fixture.characterDetails[nextAvatar] = renamed;
            delete fixture.characterDetails[payload.avatar_url];
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ avatar: nextAvatar }) });
        });

        await gotoModern(page, 'characters', '角色库');
        await page.locator('[data-edit-character="alice.png"]').click();
        await page.locator('[data-character-field="scenario"][data-character-scope="edit"]').fill('Unsaved scenario.');
        await page.locator('[data-rename-character="alice.png"]').click();
        await page.locator('[data-character-rename-input]').fill('Renamed Alice');
        await page.locator('[data-confirm-character-rename]').click();

        await expect(page.locator('.detail-title')).toHaveText('Renamed Alice');
        await expect(page.locator('[data-character-field="scenario"][data-character-scope="edit"]')).toHaveValue('Unsaved scenario.');
        await expect(page.locator('[data-character-field="name"][data-character-scope="edit"]')).toHaveValue('Renamed Alice');
        await expect(page.locator('[data-character-form-actions="edit"]')).toContainText('有未保存的修改');

        await page.locator('[data-save-character-edit]').click();
        await expect(page.locator('.toast', { hasText: '角色卡已保存' })).toBeVisible();
        expect(fixture.requests.characterMerge[0]).toMatchObject({
            avatar: 'renamed-alice.png',
            name: 'Renamed Alice',
            scenario: 'Unsaved scenario.',
        });
    });

    test('keeps an unsaved new character form across routes', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'characters', '角色库');
        await page.locator('[data-create-character]').click();
        const createActions = page.locator('[data-character-form-actions="create"]');
        await expect(createActions).toHaveAttribute('data-dirty', 'false');
        await expect(createActions.locator('[data-cancel-character-create]')).toHaveText('取消');

        await page.locator('[data-character-field="name"][data-character-scope="create"]').fill('Draft Character');
        await expect(createActions).toHaveAttribute('data-dirty', 'true');
        await expect(createActions).toContainText('有未保存的修改');
        await expect(createActions.locator('[data-cancel-character-create]')).toHaveText('放弃修改');

        // 有内容的新建表单不会因为打开另一个角色的编辑而被清空。
        await page.locator('[data-edit-character="alice.png"]').click();
        await expect(page.locator('[data-character-field="name"][data-character-scope="create"]')).toHaveValue('Draft Character');

        await page.locator('.nav-button[data-route="dashboard"]').click();
        await page.locator('.nav-button[data-route="characters"]').click();
        await expect(page.locator('[data-character-field="name"][data-character-scope="create"]')).toHaveValue('Draft Character');
        await expect(createActions).toContainText('有未保存的修改');

        await page.locator('[data-create-character]').click();
        await expect(page.locator('[data-character-field="name"][data-character-scope="create"]')).toHaveValue('Draft Character');

        await createActions.locator('[data-cancel-character-create]').click();
        await expect(page.locator('[data-character-create-panel]')).toHaveCount(0);
        expect(fixture.requests.characterCreate).toHaveLength(0);
    });

    test('starts a chat with the selected character from its detail toolbar', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);
        const chatListRequests = [];
        await page.route('**/api/characters/chats', route => {
            chatListRequests.push(route.request().postDataJSON());
            return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        });

        await gotoModern(page, 'characters', '角色库');
        await page.locator('[data-select-character="bruno.png"]').click();

        const startChat = page.locator('[data-character-detail-panel] [data-open-character-chat="bruno.png"]');
        await expect(startChat).toHaveText('开始聊天');
        await expect(startChat).toHaveClass(/primary-button/);
        await startChat.click();

        await expect(page).toHaveURL(/\/modern\/\?view=chat/);
        await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'chat');
        await expect(page.locator('.detail-title')).toHaveText('Bruno Fixture');
        await expect.poll(() => chatListRequests.some(payload => payload?.avatar_url === 'bruno.png')).toBe(true);
    });
    test('cleans tags and authors and flags a missing worldbook without changing the card', async ({ page }) => {
        const amon = createDisplayCharacter({
            avatar: 'amon.png',
            name: 'Amon',
            creator: 'yuukikun,,yuukikun,',
            tags: ['Lord of Mysteries', 'Angel', ' ', ''],
            world: 'Beyonder World',
        });
        const fixture = createModernResourceFixture({
            characters: [
                amon,
                createDisplayCharacter({ avatar: 'hedona.png', name: 'Hedona', creator: 'Hedonã,' }),
                createDisplayCharacter({ avatar: 'commas.png', name: 'Commas Only', creator: ',,,' }),
                createDisplayCharacter({ avatar: 'otis.png', name: 'Otis', creator: 'OtisAlejandro,OtisAlejandro,OtisAlejandro,OtisAlejandro', world: 'ModernLore' }),
            ],
        });
        await mockModernWorkspace(page, fixture);

        await gotoModern(page, 'characters', '角色库');
        await page.locator('[data-select-character="amon.png"]').click();

        await expect(page.locator('.detail-title')).toHaveText('Amon');
        await expect(page.locator('.detail-tags .tag')).toHaveText(['Lord of Mysteries', 'Angel']);

        const creator = page.locator('[data-character-creator] .kv-value');
        await expect(creator).toHaveText('yuukikun');
        await expect(creator).toHaveAttribute('title', 'yuukikun（卡片原始值：yuukikun,,yuukikun,）');

        const world = page.locator('[data-character-world="missing"] .kv-value');
        await expect(world).toHaveText('Beyonder World（未找到）');
        await expect(world).toHaveClass(/is-warning/);
        await expect(world).toHaveAttribute('title', /世界书目录里没有「Beyonder World」/);

        await expect(page.locator('[data-select-character="hedona.png"] .row-subtitle')).toHaveText('作者 Hedonã');
        await expect(page.locator('[data-select-character="commas.png"] .row-subtitle')).not.toContainText('作者');
        await expect(page.locator('[data-select-character="otis.png"] .row-subtitle')).toHaveText('作者 OtisAlejandro');
        await expect(page.locator('[data-select-character="amon.png"] .row-subtitle')).toHaveText('作者 yuukikun');

        await page.locator('[data-select-character="commas.png"]').click();
        await expect(page.locator('[data-character-creator] .kv-value')).toHaveText('未知');
        await expect(page.locator('[data-character-world="none"] .kv-value')).toHaveText('未关联');

        await page.locator('[data-select-character="otis.png"]').click();
        await expect(page.locator('[data-character-creator] .kv-value')).toHaveText('OtisAlejandro');
        await expect(page.locator('[data-character-world="found"] .kv-value')).toHaveText('ModernLore');

        await page.locator('[data-select-character="amon.png"]').click();
        await page.locator('[data-edit-character="amon.png"]').click();
        await expect(page.locator('[data-character-field="world"][data-character-scope="edit"] option:checked')).toHaveText('Beyonder World（未找到）');
        await expect(page.locator('[data-character-field="tags"][data-character-scope="edit"]')).toHaveValue('Lord of Mysteries, Angel');

        // 只整理展示，不写回卡片。
        expect(fixture.requests.characterMerge).toHaveLength(0);
        expect(fixture.characters.find(character => character.avatar === 'amon.png').data.creator).toBe('yuukikun,,yuukikun,');
    });

    test('shows progress and the result when reading the full character card', async ({ page }) => {
        const shallow = {
            shallow: true,
            avatar: 'shallow.png',
            name: 'Shallow Character',
            data: { name: 'Shallow Character', creator: 'Modern E2E', tags: ['shallow'], extensions: { world: '', fav: false } },
        };
        const full = createDisplayCharacter({ avatar: 'shallow.png', name: 'Shallow Character', creator: 'Modern E2E', tags: ['shallow'] });
        const fixture = createModernResourceFixture({ characters: [shallow], characterDetails: { 'shallow.png': full } });
        await mockModernWorkspace(page, fixture);
        let releaseDetail;
        const detailGate = new Promise(resolve => {
            releaseDetail = resolve;
        });
        await page.route('**/api/characters/get', async route => {
            await detailGate;
            return route.fallback();
        });

        await gotoModern(page, 'characters', '角色库');

        const loadButton = page.locator('[data-load-character-detail="shallow.png"]');
        await expect(loadButton).toHaveAttribute('title', /重新读取全部字段/);
        await loadButton.click();
        await expect(loadButton).toBeDisabled();
        await expect(loadButton).toHaveAttribute('aria-busy', 'true');
        await expect(loadButton).toHaveText('读取中…');

        releaseDetail();
        const resultToast = page.locator('.toast', { hasText: '已读取完整卡' });
        await expect(resultToast).toContainText(/新增 \d+ 个字段/);
        await expect(loadButton).toBeEnabled();
        await expect(loadButton).toHaveText('读取完整卡');
        await expect(page.locator('.detail-text')).toContainText('Shallow Character visible description.');

        await loadButton.click();
        await expect(page.locator('.toast', { hasText: '已是完整数据' })).toBeVisible();
    });

    test('explains why a character file could not be imported', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);
        const responses = [
            { status: 200, body: { error: true, reason: 'no_card_data' } },
            { status: 200, body: { error: true } },
            { status: 400, body: 'Bad Request' },
        ];
        await page.route('**/api/characters/import', route => {
            const response = responses.shift();
            return route.fulfill({
                status: response.status,
                contentType: typeof response.body === 'string' ? 'text/plain' : 'application/json',
                body: typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
            });
        });

        await gotoModern(page, 'characters', '角色库');
        const importInput = page.locator('[data-character-import-file]');

        await importInput.setInputFiles({ name: 'plain-photo.png', mimeType: 'image/png', buffer: Buffer.from('plain image bytes') });
        await expect(page.locator('.toast', { hasText: '角色导入失败' }).filter({ hasText: 'plain-photo.png：这个 PNG 里没有角色卡数据' })).toBeVisible();

        await importInput.setInputFiles({ name: 'legacy-error.png', mimeType: 'image/png', buffer: Buffer.from('legacy error bytes') });
        await expect(page.locator('.toast', { hasText: 'legacy-error.png：这个 PNG 可能没有角色卡数据，或文件已损坏。' })).toBeVisible();

        await importInput.setInputFiles({ name: 'unknown-shape.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world"}') });
        await expect(page.locator('.toast', { hasText: 'unknown-shape.json：文件里没有可识别的角色卡内容' })).toBeVisible();

        await expect(page.locator('.toast', { hasText: '角色卡导入失败。' })).toHaveCount(0);
        await expect(page.locator('[data-select-character="alice.png"]')).toBeVisible();
    });

    test('uploads an optional avatar together with a new character', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);
        const createRequests = [];
        await page.route('**/api/characters/create', route => {
            const request = route.request();
            const bodyText = request.postData() || '';
            createRequests.push({ bodyText, contentType: request.headers()['content-type'] || '' });
            const avatar = 'avatar-character.png';
            const character = createDisplayCharacter({ avatar, name: multipartField(bodyText, 'ch_name'), creator: multipartField(bodyText, 'creator') });
            fixture.characters.push(character);
            fixture.characterDetails[avatar] = character;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(avatar) });
        });

        await gotoModern(page, 'characters', '角色库');
        await page.locator('[data-create-character]').click();

        const avatarField = page.locator('[data-character-create-avatar-field]');
        await expect(avatarField).toContainText('头像图片（可选）');
        await expect(avatarField).toContainText('不选择时使用默认头像');
        await page.locator('[data-character-field="name"][data-character-scope="create"]').fill('Avatar Character');
        await page.locator('[data-character-field="creator"][data-character-scope="create"]').fill('Modern E2E');
        await page.locator('[data-character-field="tags"][data-character-scope="create"]').fill('modern, avatar');
        await page.locator('[data-character-field="alternate_greetings"][data-character-scope="create"]').fill('First alternate\n---\nSecond alternate');

        await page.locator('[data-character-create-avatar]').setInputFiles({ name: 'discarded.png', mimeType: 'image/png', buffer: Buffer.from('discarded avatar') });
        await expect(page.locator('[data-character-create-avatar-selected]')).toContainText('已选择：discarded.png');
        await page.locator('[data-clear-character-create-avatar]').click();
        await expect(page.locator('[data-character-create-avatar-selected]')).toHaveCount(0);

        await page.locator('[data-character-create-avatar]').setInputFiles({ name: 'new-avatar.png', mimeType: 'image/png', buffer: Buffer.from('new character avatar') });
        await expect(page.locator('[data-character-create-avatar-selected]')).toContainText('已选择：new-avatar.png');
        await expect(page.locator('[data-character-field="name"][data-character-scope="create"]')).toHaveValue('Avatar Character');
        await page.locator('[data-save-character-create]').click();

        await expect(page.locator('.detail-title')).toHaveText('Avatar Character');
        expect(createRequests).toHaveLength(1);
        const [{ bodyText, contentType }] = createRequests;
        expect(contentType).toContain('multipart/form-data');
        expect(bodyText).toContain('name="avatar"; filename="new-avatar.png"');
        expect(multipartField(bodyText, 'ch_name')).toBe('Avatar Character');
        expect(multipartField(bodyText, 'tags')).toBe('modern,avatar');
        expect(multipartField(bodyText, 'fav')).toBe('false');
        expect(JSON.parse(multipartField(bodyText, 'extensions'))).toEqual({ talkativeness: 0.5 });
        expect(bodyText.match(/name="alternate_greetings"/g)).toHaveLength(2);
        expect(fixture.requests.characterCreate).toHaveLength(0);
    });
});
