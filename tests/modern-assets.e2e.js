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

function slug(value, fallback) {
    const result = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return result || fallback;
}

function getBackgroundFilename(background) {
    return typeof background === 'string' ? background : background?.filename || '';
}

function multipartFileName(bodyText, fieldName) {
    const match = new RegExp(`name="${fieldName}"; filename="([^"]+)"`).exec(bodyText);
    return match?.[1]?.trim() || '';
}

function backgroundPathToFilename(path) {
    return String(path || '').replace(/^backgrounds\//u, '');
}

function createAssetFixture() {
    const fixture = createModernResourceFixture({
        backgrounds: {
            images: [
                { filename: 'castle.png', isAnimated: false },
                { filename: 'city.png', isAnimated: true },
                { filename: 'forest.webp', isAnimated: false },
            ],
        },
        backgroundFolders: {
            folders: [{ id: 'favorites', name: 'Favorites' }],
            imageFolderMap: {
                'castle.png': ['favorites'],
            },
        },
        assets: {
            bgm: ['assets/bgm/theme.mp3', 'assets/bgm/nested/readonly.mp3'],
            ambient: ['assets/ambient/rain.ogg'],
            live2d: {
                demo: ['assets/live2d/demo/model.json'],
            },
        },
    });

    fixture.requests.assetWorkflows = {
        folderCreate: [],
        folderRename: [],
        folderDelete: [],
        folderAssign: [],
        folderUnassign: [],
        backgroundUploads: [],
        backgroundRenames: [],
        backgroundDeletes: [],
        assetDownloads: [],
        assetDeletes: [],
    };

    return fixture;
}

function setImageFolderMap(fixture, filename, folderIds) {
    const uniqueIds = [...new Set(folderIds.filter(Boolean))];
    if (uniqueIds.length) {
        fixture.backgroundFolders.imageFolderMap[filename] = uniqueIds;
    } else {
        delete fixture.backgroundFolders.imageFolderMap[filename];
    }
}

function renameBackgroundInFixture(fixture, oldName, newName) {
    fixture.backgrounds.images = fixture.backgrounds.images.map(background => {
        if (getBackgroundFilename(background) !== oldName) {
            return background;
        }
        return typeof background === 'string' ? newName : { ...background, filename: newName };
    });

    const folderIds = fixture.backgroundFolders.imageFolderMap[oldName] || [];
    delete fixture.backgroundFolders.imageFolderMap[oldName];
    setImageFolderMap(fixture, newName, folderIds);
}

async function mockModernAssetsWorkspace(page) {
    const fixture = createAssetFixture();
    const requests = fixture.requests.assetWorkflows;
    await mockModernWorkspace(page, fixture);

    await page.route('**/api/image-metadata/folders/create', route => {
        const payload = route.request().postDataJSON();
        requests.folderCreate.push(clone(payload));
        const folder = { id: slug(payload.name, `folder-${requests.folderCreate.length}`), name: payload.name };
        fixture.backgroundFolders.folders.push(folder);
        return fulfillJson(route, folder);
    });

    await page.route('**/api/image-metadata/folders/update', route => {
        const payload = route.request().postDataJSON();
        requests.folderRename.push(clone(payload));
        fixture.backgroundFolders.folders = fixture.backgroundFolders.folders.map(folder => (
            folder.id === payload.id ? { ...folder, name: payload.name } : folder
        ));
        return fulfillJson(route, { ok: true });
    });

    await page.route('**/api/image-metadata/folders/delete', route => {
        const payload = route.request().postDataJSON();
        requests.folderDelete.push(clone(payload));
        fixture.backgroundFolders.folders = fixture.backgroundFolders.folders.filter(folder => folder.id !== payload.id);
        for (const [filename, folderIds] of Object.entries(fixture.backgroundFolders.imageFolderMap)) {
            setImageFolderMap(fixture, filename, folderIds.filter(folderId => folderId !== payload.id));
        }
        return fulfillJson(route, { ok: true });
    });

    await page.route('**/api/image-metadata/folders/assign', route => {
        const payload = route.request().postDataJSON();
        requests.folderAssign.push(clone(payload));
        for (const path of payload.paths || []) {
            const filename = backgroundPathToFilename(path);
            const folderIds = fixture.backgroundFolders.imageFolderMap[filename] || [];
            setImageFolderMap(fixture, filename, [...folderIds, payload.id]);
        }
        return fulfillJson(route, { ok: true });
    });

    await page.route('**/api/image-metadata/folders/unassign', route => {
        const payload = route.request().postDataJSON();
        requests.folderUnassign.push(clone(payload));
        for (const path of payload.paths || []) {
            const filename = backgroundPathToFilename(path);
            const folderIds = fixture.backgroundFolders.imageFolderMap[filename] || [];
            setImageFolderMap(fixture, filename, folderIds.filter(folderId => folderId !== payload.id));
        }
        return fulfillJson(route, { ok: true });
    });

    await page.route('**/api/backgrounds/upload', route => {
        const bodyText = route.request().postData() || '';
        const filename = multipartFileName(bodyText, 'avatar') || `uploaded-${requests.backgroundUploads.length + 1}.png`;
        requests.backgroundUploads.push({
            bodyText,
            contentType: route.request().headers()['content-type'] || '',
            filename,
        });
        fixture.backgrounds.images.push({ filename, isAnimated: false });
        return fulfillJson(route, filename);
    });

    await page.route('**/api/backgrounds/rename', route => {
        const payload = route.request().postDataJSON();
        requests.backgroundRenames.push(clone(payload));
        renameBackgroundInFixture(fixture, payload.old_bg, payload.new_bg);
        return fulfillJson(route, { ok: true });
    });

    await page.route('**/api/backgrounds/delete', route => {
        const payload = route.request().postDataJSON();
        requests.backgroundDeletes.push(clone(payload));
        fixture.backgrounds.images = fixture.backgrounds.images.filter(background => getBackgroundFilename(background) !== payload.bg);
        delete fixture.backgroundFolders.imageFolderMap[payload.bg];
        return fulfillJson(route, { ok: true });
    });

    await page.route('**/api/assets/download', route => {
        const payload = route.request().postDataJSON();
        requests.assetDownloads.push(clone(payload));
        fixture.assets[payload.category] = fixture.assets[payload.category] || [];
        fixture.assets[payload.category].push(`assets/${payload.category}/${payload.filename}`);
        return fulfillJson(route, { ok: true });
    });

    await page.route('**/api/assets/delete', route => {
        const payload = route.request().postDataJSON();
        requests.assetDeletes.push(clone(payload));
        const assetPath = `assets/${payload.category}/${payload.filename}`;
        fixture.assets[payload.category] = (fixture.assets[payload.category] || []).filter(item => item !== assetPath);
        return fulfillJson(route, { ok: true });
    });

    return fixture;
}

test.describe('Modern assets page', () => {
    test('creates, assigns, renames, unassigns, and deletes background folders', async ({ page }) => {
        const fixture = await mockModernAssetsWorkspace(page);
        const requests = fixture.requests.assetWorkflows;

        await gotoModern(page, 'assets', '素材库');

        await expect(page.locator('.background-card', { hasText: 'castle.png' })).toContainText('Favorites');

        await page.locator('[data-toggle-background-folder-create]').click();
        await page.locator('[data-background-folder-create-name]').fill('Modern Set');
        await page.locator('[data-save-background-folder-create]').click();

        await expect.poll(() => requests.folderCreate.length).toBe(1);
        expect(requests.folderCreate[0]).toEqual({ name: 'Modern Set' });
        await expect(page.locator('[data-background-folder-filter="modern-set"]')).toContainText('Modern Set');

        await page.locator('[data-background-folder-filter=""]').click();
        await page.locator('[data-toggle-background-selection]').click();
        await page.locator('[data-background-select="castle.png"]').check();
        await page.locator('[data-assign-selected-backgrounds]').click();

        await expect.poll(() => requests.folderAssign.length).toBe(1);
        expect(requests.folderAssign[0]).toEqual({
            id: 'modern-set',
            paths: ['backgrounds/castle.png'],
        });
        await expect(page.locator('.background-card', { hasText: 'castle.png' })).toContainText('Modern Set');

        await page.locator('[data-background-folder-filter="modern-set"]').click();
        await expect(page.locator('.background-card')).toHaveCount(1);
        await expect(page.locator('.background-card')).toContainText('castle.png');

        await page.locator('[data-rename-background-folder="modern-set"]').click();
        await page.locator('[data-background-folder-rename-name]').fill('Renamed Set');
        await page.locator('[data-confirm-background-folder-rename]').click();

        await expect.poll(() => requests.folderRename.length).toBe(1);
        expect(requests.folderRename[0]).toEqual({ id: 'modern-set', name: 'Renamed Set' });
        await expect(page.locator('[data-background-folder-filter="modern-set"]')).toContainText('Renamed Set');

        await page.locator('[data-unassign-selected-backgrounds]').click();

        await expect.poll(() => requests.folderUnassign.length).toBe(1);
        expect(requests.folderUnassign[0]).toEqual({
            id: 'modern-set',
            paths: ['backgrounds/castle.png'],
        });
        await expect(page.locator('.background-card')).toHaveCount(0);

        await page.locator('[data-delete-background-folder="modern-set"]').click();
        await page.locator('[data-confirm-background-folder-delete]').click();

        await expect.poll(() => requests.folderDelete.length).toBe(1);
        expect(requests.folderDelete[0]).toEqual({ id: 'modern-set' });
        await expect(page.locator('[data-background-folder-filter="modern-set"]')).toHaveCount(0);
        await expect(page.locator('[data-background-folder-filter=""]')).toContainText('全部背景');
    });

    test('uploads, renames, selects, and deletes background files', async ({ page }) => {
        const fixture = await mockModernAssetsWorkspace(page);
        const requests = fixture.requests.assetWorkflows;

        await gotoModern(page, 'assets', '素材库');

        await page.locator('[data-background-upload-file]').setInputFiles({
            name: 'uploaded-bg.png',
            mimeType: 'image/png',
            buffer: Buffer.from('mock image'),
        });

        await expect.poll(() => requests.backgroundUploads.length).toBe(1);
        expect(requests.backgroundUploads[0].filename).toBe('uploaded-bg.png');
        expect(requests.backgroundUploads[0].contentType).toContain('multipart/form-data');
        expect(requests.backgroundUploads[0].bodyText).toContain('name="avatar"; filename="uploaded-bg.png"');
        await expect(page.locator('.background-card', { hasText: 'uploaded-bg.png' })).toBeVisible();

        await page.locator('.background-card', { hasText: 'uploaded-bg.png' }).locator('[data-background-rename]').click();
        await page.locator('[data-background-rename-input]').fill('renamed-upload.png');
        await page.locator('[data-confirm-background-rename]').click();

        await expect.poll(() => requests.backgroundRenames.length).toBe(1);
        expect(requests.backgroundRenames[0]).toEqual({
            old_bg: 'uploaded-bg.png',
            new_bg: 'renamed-upload.png',
        });
        await expect(page.locator('.background-card', { hasText: 'uploaded-bg.png' })).toHaveCount(0);
        await expect(page.locator('.background-card', { hasText: 'renamed-upload.png' })).toBeVisible();

        await page.locator('[data-toggle-background-selection]').click();
        await page.locator('[data-background-select="city.png"]').check();
        await page.locator('[data-background-select="forest.webp"]').check();
        await page.locator('[data-delete-selected-backgrounds]').click();
        await expect(page.locator('.danger-panel', { hasText: '删除所选背景' })).toBeVisible();
        await page.locator('[data-confirm-background-delete]').click();

        await expect.poll(() => requests.backgroundDeletes.length).toBe(2);
        expect(requests.backgroundDeletes).toEqual([{ bg: 'city.png' }, { bg: 'forest.webp' }]);
        await expect(page.locator('.background-card', { hasText: 'city.png' })).toHaveCount(0);
        await expect(page.locator('.background-card', { hasText: 'forest.webp' })).toHaveCount(0);
        await expect(page.locator('.background-card', { hasText: 'renamed-upload.png' })).toBeVisible();
        await expect(page.locator('[data-background-select]')).toHaveCount(0);
    });

    test('downloads and deletes managed asset files', async ({ page }) => {
        const fixture = await mockModernAssetsWorkspace(page);
        const requests = fixture.requests.assetWorkflows;

        await gotoModern(page, 'assets', '素材库');

        await page.locator('[data-asset-tab="files"]').click();
        await expect(page.locator('.asset-row', { hasText: 'theme.mp3' })).toBeVisible();
        await expect(page.locator('.asset-row', { hasText: 'nested/readonly.mp3' })).toContainText('嵌套资源需在资源目录管理');

        await page.locator('[data-toggle-asset-download]').click();
        await page.locator('[data-asset-download-url]').fill('https://example.com/new-theme.mp3');
        await page.locator('[data-asset-download-filename]').fill('new-theme.mp3');
        await page.locator('[data-asset-download-category]').selectOption('bgm');
        await page.locator('[data-download-asset]').click();

        await expect.poll(() => requests.assetDownloads.length).toBe(1);
        expect(requests.assetDownloads[0]).toEqual({
            url: 'https://example.com/new-theme.mp3',
            category: 'bgm',
            filename: 'new-theme.mp3',
        });
        await expect(page.locator('.asset-row', { hasText: 'new-theme.mp3' })).toBeVisible();

        await page.locator('[data-delete-asset][data-asset-category="bgm"][data-asset-filename="new-theme.mp3"]').click();
        await page.locator('[data-confirm-asset-delete]').click();

        await expect.poll(() => requests.assetDeletes.length).toBe(1);
        expect(requests.assetDeletes[0]).toEqual({ category: 'bgm', filename: 'new-theme.mp3' });
        await expect(page.locator('.asset-row', { hasText: 'new-theme.mp3' })).toHaveCount(0);
        await expect(page.locator('.asset-row', { hasText: 'theme.mp3' })).toBeVisible();
    });
});
