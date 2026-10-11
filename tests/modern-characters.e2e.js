import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
import { createModernResourceFixture, gotoModern, mockBridgeFrame, mockModernWorkspace } from './modern-test-utils.js';

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

// ---- 角色卡内嵌世界书：详情里的状态行、导入并关联、重名处理、导入角色后的一次性提示 ----

function createLoreCharacter({ avatar = 'lore-alice.png', name = 'Lore Alice', world = '', bookName = 'Lore Alice Book', entries = 2 } = {}) {
    return createDisplayCharacter({
        avatar,
        name,
        creator: 'Modern E2E',
        world,
        extra: {
            data: {
                name,
                description: `${name} visible description.`,
                personality: '',
                scenario: '',
                first_mes: `Hello from ${name}.`,
                creator: 'Modern E2E',
                tags: [],
                extensions: { world, talkativeness: 0.5, fav: false, depth_prompt: { prompt: '', depth: 4, role: 'system' } },
                character_book: {
                    name: bookName,
                    extensions: {},
                    entries: Array.from({ length: entries }, (_, index) => ({
                        keys: [`key-${index + 1}`],
                        content: `Entry ${index + 1}`,
                        insertion_order: 10 * (index + 1),
                        enabled: true,
                        extensions: {},
                    })),
                },
            },
        },
    });
}

function mergeDeep(target, source) {
    const output = { ...target };
    for (const [key, value] of Object.entries(source || {})) {
        output[key] = value && typeof value === 'object' && !Array.isArray(value) && target?.[key] && typeof target[key] === 'object'
            ? mergeDeep(target[key], value)
            : value;
    }
    return output;
}

// 世界书相关接口的模拟：重名返回 409，成功写入后同步世界书列表；log 按到达顺序记录每个写请求。
async function mockEmbeddedWorldApis(page, fixture) {
    const log = [];
    const edits = [];
    const merges = [];
    fixture.settingsBundle.world_names = fixture.worldbooks.map(worldbook => worldbook.file_id);
    await page.route('**/api/files/sanitize-filename', route => {
        log.push('sanitize-filename');
        const { fileName } = route.request().postDataJSON();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fileName: String(fileName).replace(/[\\/:*?"<>|]/g, '') }) });
    });
    await page.route('**/api/worldinfo/edit', route => {
        const body = route.request().postDataJSON();
        log.push('worldinfo/edit');
        edits.push(body);
        const exists = fixture.worldbooks.some(worldbook => worldbook.file_id === body.name);
        if (exists && body.overwrite === false) {
            return route.fulfill({ status: 409, contentType: 'text/plain', body: 'World info file already exists' });
        }
        if (!exists) {
            fixture.worldbooks.push({ file_id: body.name, name: body.name });
            fixture.settingsBundle.world_names = fixture.worldbooks.map(worldbook => worldbook.file_id);
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.route('**/api/characters/merge-attributes', route => {
        const body = route.request().postDataJSON();
        log.push('merge-attributes');
        merges.push(body);
        const previous = fixture.characterDetails[body.avatar] || fixture.characters.find(item => item.avatar === body.avatar);
        const next = mergeDeep(previous, { data: body.data });
        fixture.characterDetails[body.avatar] = next;
        fixture.characters = fixture.characters.map(item => item.avatar === body.avatar ? next : item);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    return { log, edits, merges };
}

function embeddedWorldRow(page) {
    return page.locator('[data-character-embedded-world]');
}

test.describe('Modern character embedded world books', () => {
    test('shows the embedded book state and imports it once: write, link, then reload the engine', async ({ page }) => {
        const fixture = createModernResourceFixture({ characters: [createDisplayCharacter({ avatar: 'plain.png', name: 'Plain Fixture', creator: 'Modern E2E' }), createLoreCharacter()] });
        await mockModernWorkspace(page, fixture);
        const { log, edits, merges } = await mockEmbeddedWorldApis(page, fixture);
        const bridgeCalls = await mockBridgeFrame(page);
        const dialogs = [];
        page.on('dialog', dialog => {
            dialogs.push(dialog.message());
            return dialog.dismiss();
        });

        await gotoModern(page, 'characters', '角色库');

        await page.locator('[data-select-character="plain.png"]').click();
        await expect(page.locator('.detail-title')).toHaveText('Plain Fixture');
        await expect(embeddedWorldRow(page)).toHaveCount(0);

        await page.locator('[data-select-character="lore-alice.png"]').click();
        await expect(page.locator('.detail-title')).toHaveText('Lore Alice');
        const row = embeddedWorldRow(page);
        await expect(row).toHaveAttribute('data-character-embedded-world', 'pending');
        await expect(row).toContainText('内嵌世界书');
        await expect(row).toContainText('2 条 · 未导入');
        const importButton = row.locator('[data-import-character-embedded-world]');
        await expect(importButton).toHaveText('导入并关联');
        await expect(page.locator('[data-character-world="none"]')).toBeVisible();

        await importButton.click();

        await expect(row).toHaveAttribute('data-character-embedded-world', 'linked');
        await expect(row).toContainText('2 条 · 已关联「Lore Alice Book」');
        await expect(row.locator('[data-import-character-embedded-world]')).toHaveCount(0);
        await expect(page.locator('[data-character-world="found"]')).toContainText('Lore Alice Book');
        await expect(page.locator('.toast', { hasText: '内嵌世界书已导入' })).toContainText('「Lore Alice Book」2 条，已关联到角色');

        // 请求顺序：清理文件名 → 写世界书（不覆盖）→ 写关联；引擎先重载角色再重载世界书
        expect(log).toEqual(['sanitize-filename', 'worldinfo/edit', 'merge-attributes']);
        expect(edits).toHaveLength(1);
        expect(edits[0]).toMatchObject({ name: 'Lore Alice Book', overwrite: false });
        expect(Object.values(edits[0].data.entries).map(entry => entry.content)).toEqual(['Entry 1', 'Entry 2']);
        expect(Object.keys(edits[0].data.entries)).toEqual(['0', '1']);
        expect(merges).toEqual([{ avatar: 'lore-alice.png', data: { extensions: { world: 'Lore Alice Book' } } }]);
        await expect.poll(() => bridgeCalls.map(call => call.action)).toEqual(expect.arrayContaining(['reloadCharacter', 'reloadWorldInfo']));
        const worldReload = bridgeCalls.find(call => call.action === 'reloadWorldInfo');
        expect(worldReload.payload).toEqual({ names: ['Lore Alice Book'] });
        expect(bridgeCalls.map(call => call.action).indexOf('reloadCharacter')).toBeLessThan(bridgeCalls.map(call => call.action).indexOf('reloadWorldInfo'));

        // 幂等：切换角色再回来、整页刷新数据后都不再出现按钮，也没有新的写请求
        await page.locator('[data-select-character="plain.png"]').click();
        await page.locator('[data-select-character="lore-alice.png"]').click();
        await expect(row).toHaveAttribute('data-character-embedded-world', 'linked');
        await expect(row.locator('[data-import-character-embedded-world]')).toHaveCount(0);
        expect(log).toHaveLength(3);
        expect(dialogs).toEqual([]);
    });

    test('a taken name offers save-as (2), overwrite and cancel inline without window.confirm', async ({ page }) => {
        const fixture = createModernResourceFixture({ characters: [createLoreCharacter({ bookName: 'modernlore' })] });
        await mockModernWorkspace(page, fixture);
        const { edits, merges } = await mockEmbeddedWorldApis(page, fixture);
        const dialogs = [];
        page.on('dialog', dialog => {
            dialogs.push(dialog.message());
            return dialog.dismiss();
        });

        await gotoModern(page, 'characters', '角色库');
        const importButton = embeddedWorldRow(page).locator('[data-import-character-embedded-world]');
        await importButton.click();

        // 与已有的 ModernLore 只差大小写，也算重名
        const conflict = page.locator('[data-character-embedded-world-conflict]');
        await expect(conflict).toContainText('已有同名世界书「ModernLore」');
        await expect(conflict.locator('[data-character-embedded-world-conflict-choice="rename"]')).toContainText('另存为「modernlore (2)」');
        await expect(conflict.locator('[data-character-embedded-world-conflict-choice="overwrite"]')).toContainText('覆盖「ModernLore」');
        await expect(importButton).toBeDisabled();
        expect(edits).toHaveLength(0);

        await conflict.locator('[data-character-embedded-world-conflict-choice="cancel"]').click();
        await expect(conflict).toHaveCount(0);
        await expect(page.locator('.toast', { hasText: '已取消导入' })).toBeVisible();
        await expect(importButton).toBeEnabled();
        expect(edits).toHaveLength(0);
        expect(merges).toHaveLength(0);

        await importButton.click();
        await page.locator('[data-character-embedded-world-conflict-choice="rename"]').click();

        await expect(embeddedWorldRow(page)).toContainText('已关联「modernlore (2)」');
        expect(edits).toHaveLength(1);
        expect(edits[0]).toMatchObject({ name: 'modernlore (2)', overwrite: false });
        expect(merges[0].data.extensions.world).toBe('modernlore (2)');
        expect(dialogs).toEqual([]);
    });

    test('overwrite writes into the existing world book file and links to it', async ({ page }) => {
        const fixture = createModernResourceFixture({ characters: [createLoreCharacter({ bookName: 'ModernLore' })] });
        await mockModernWorkspace(page, fixture);
        const { edits, merges } = await mockEmbeddedWorldApis(page, fixture);

        await gotoModern(page, 'characters', '角色库');
        await embeddedWorldRow(page).locator('[data-import-character-embedded-world]').click();
        await page.locator('[data-character-embedded-world-conflict-choice="overwrite"]').click();

        await expect(embeddedWorldRow(page)).toContainText('已关联「ModernLore」');
        expect(edits).toHaveLength(1);
        expect(edits[0]).toMatchObject({ name: 'ModernLore', overwrite: true });
        expect(merges[0].data.extensions.world).toBe('ModernLore');
        await expect(page.locator('.toast', { hasText: '内嵌世界书已导入' })).toContainText('已覆盖同名世界书');
    });

    test('restores a link that points at a missing world book under its original name', async ({ page }) => {
        const fixture = createModernResourceFixture({ characters: [createLoreCharacter({ world: 'Vanished Lore', bookName: 'Some Other Name' })] });
        await mockModernWorkspace(page, fixture);
        const { edits, merges } = await mockEmbeddedWorldApis(page, fixture);
        const bridgeCalls = await mockBridgeFrame(page);

        await gotoModern(page, 'characters', '角色库');
        await expect(page.locator('[data-character-world="missing"]')).toContainText('Vanished Lore（未找到）');
        const row = embeddedWorldRow(page);
        await expect(row).toContainText('未导入（原关联「Vanished Lore」未找到）');

        await row.locator('[data-import-character-embedded-world]').click();

        await expect(row).toHaveAttribute('data-character-embedded-world', 'linked');
        await expect(page.locator('[data-character-world="found"]')).toContainText('Vanished Lore');
        expect(edits).toHaveLength(1);
        expect(edits[0]).toMatchObject({ name: 'Vanished Lore', overwrite: false });
        // 关联名没有变化，不重写角色卡
        expect(merges).toHaveLength(0);
        await expect.poll(() => bridgeCalls.map(call => call.action)).toContain('reloadWorldInfo');
        expect(bridgeCalls.map(call => call.action)).not.toContain('reloadCharacter');
        expect(bridgeCalls.find(call => call.action === 'reloadWorldInfo').payload).toEqual({ names: ['Vanished Lore'] });
    });

    test('moving on to another character while a name clash is pending cancels that choice', async ({ page }) => {
        const fixture = createModernResourceFixture({
            characters: [
                createLoreCharacter({ avatar: 'clash.png', name: 'Clash Alice', bookName: 'ModernLore' }),
                createLoreCharacter({ avatar: 'free.png', name: 'Free Bruno', bookName: 'Free Lore' }),
            ],
        });
        await mockModernWorkspace(page, fixture);
        const { edits } = await mockEmbeddedWorldApis(page, fixture);

        await gotoModern(page, 'characters', '角色库');
        await embeddedWorldRow(page).locator('[data-import-character-embedded-world]').click();
        await expect(page.locator('[data-character-embedded-world-conflict]')).toBeVisible();

        await page.locator('[data-select-character="free.png"]').click();
        await expect(page.locator('.detail-title')).toHaveText('Free Bruno');
        const importButton = embeddedWorldRow(page).locator('[data-import-character-embedded-world]');
        await expect(importButton).toBeEnabled();
        await importButton.click();
        await expect(embeddedWorldRow(page)).toContainText('已关联「Free Lore」');

        await page.locator('[data-select-character="clash.png"]').click();
        await expect(page.locator('.detail-title')).toHaveText('Clash Alice');
        await expect(page.locator('[data-character-embedded-world-conflict]')).toHaveCount(0);
        await expect(embeddedWorldRow(page).locator('[data-import-character-embedded-world]')).toBeEnabled();
        expect(edits.map(edit => edit.name)).toEqual(['Free Lore']);
    });

    test('an open editor follows the new link so saving does not write the old one back', async ({ page }) => {
        const fixture = createModernResourceFixture({ characters: [createLoreCharacter()] });
        await mockModernWorkspace(page, fixture);
        const { merges } = await mockEmbeddedWorldApis(page, fixture);

        await gotoModern(page, 'characters', '角色库');
        await page.locator('[data-edit-character="lore-alice.png"]').click();
        const worldSelect = page.locator('[data-character-field="world"][data-character-scope="edit"]');
        await expect(worldSelect).toHaveValue('');
        await page.locator('[data-character-field="description"][data-character-scope="edit"]').fill('Edited while importing.');

        await embeddedWorldRow(page).locator('[data-import-character-embedded-world]').click();
        await expect(embeddedWorldRow(page)).toContainText('已关联「Lore Alice Book」');
        await expect(worldSelect).toHaveValue('Lore Alice Book');
        await expect(page.locator('[data-character-field="description"][data-character-scope="edit"]')).toHaveValue('Edited while importing.');

        await page.locator('[data-save-character-edit]').click();
        await expect.poll(() => merges.length).toBe(2);
        expect(merges[1].data.extensions.world).toBe('Lore Alice Book');
        expect(merges[1].data.description).toBe('Edited while importing.');
    });

    test('prompts once after importing a character file that carries a book, and shares the AlertWI marker', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);
        const { edits, merges } = await mockEmbeddedWorldApis(page, fixture);
        await page.route('**/api/characters/import', route => {
            const character = createLoreCharacter({ avatar: 'imported-lore.png', name: 'Imported Lore' });
            fixture.characters.push(character);
            fixture.characterDetails[character.avatar] = character;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ file_name: 'imported-lore.png' }) });
        });

        await gotoModern(page, 'characters', '角色库');
        const importInput = page.locator('[data-character-import-file]');
        await importInput.setInputFiles({ name: 'imported-lore.json', mimeType: 'application/json', buffer: Buffer.from('{}') });

        await expect(page.locator('.detail-title')).toHaveText('Imported Lore');
        const prompt = page.locator('[data-character-embedded-world-prompt="imported-lore.png"]');
        await expect(prompt).toContainText('这张角色卡带有内嵌世界书');
        await expect(prompt).toContainText('共 2 条');
        expect(edits).toHaveLength(0);
        // 与旧版共用的「只提示一次」标记已经写入设置
        await expect.poll(() => fixture.requests.settingsSave.at(-1)?.accountStorage?.['AlertWI_imported-lore.png']).toBe('true');

        await prompt.locator('[data-dismiss-character-embedded-world-prompt]').click();
        await expect(prompt).toHaveCount(0);
        await expect(embeddedWorldRow(page)).toContainText('2 条 · 未导入');
        expect(edits).toHaveLength(0);

        // 同一个头像再次导入不再提示（先清掉旧提示，下一条「角色已导入」一定来自第二次导入，此时询问逻辑已经跑完）
        await page.locator('.toast').evaluateAll(toasts => toasts.forEach(toast => toast.remove()));
        await importInput.setInputFiles({ name: 'imported-lore.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
        await expect(page.locator('.toast', { hasText: '角色已导入' })).toHaveCount(1);
        await expect(page.locator('[data-character-embedded-world-prompt]')).toHaveCount(0);

        // 按钮仍然可用
        await embeddedWorldRow(page).locator('[data-import-character-embedded-world]').click();
        await expect(embeddedWorldRow(page)).toContainText('已关联「Lore Alice Book」');
        expect(edits).toHaveLength(1);
        expect(merges).toHaveLength(1);
    });

    test('the prompt import button imports and clears the prompt; a card without a book gets no prompt', async ({ page }) => {
        const fixture = createModernResourceFixture();
        await mockModernWorkspace(page, fixture);
        const { edits } = await mockEmbeddedWorldApis(page, fixture);
        let importCount = 0;
        await page.route('**/api/characters/import', route => {
            importCount += 1;
            const character = importCount === 1
                ? createDisplayCharacter({ avatar: 'no-book.png', name: 'No Book', creator: 'Modern E2E' })
                : createLoreCharacter({ avatar: 'with-book.png', name: 'With Book' });
            fixture.characters.push(character);
            fixture.characterDetails[character.avatar] = character;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ file_name: character.avatar }) });
        });

        await gotoModern(page, 'characters', '角色库');
        const importInput = page.locator('[data-character-import-file]');
        await importInput.setInputFiles({ name: 'no-book.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
        await expect(page.locator('.detail-title')).toHaveText('No Book');
        await expect(page.locator('[data-character-embedded-world-prompt]')).toHaveCount(0);
        await expect(embeddedWorldRow(page)).toHaveCount(0);

        await importInput.setInputFiles({ name: 'with-book.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
        await expect(page.locator('.detail-title')).toHaveText('With Book');
        const prompt = page.locator('[data-character-embedded-world-prompt]');
        await expect(prompt).toBeVisible();
        await prompt.locator('[data-import-character-embedded-world]').click();

        await expect(embeddedWorldRow(page)).toContainText('已关联「Lore Alice Book」');
        await expect(prompt).toHaveCount(0);
        expect(edits).toHaveLength(1);
    });
});
