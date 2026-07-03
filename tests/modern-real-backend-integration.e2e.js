import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoModern } from './modern-test-utils.js';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8000';
const userDataRoot = path.resolve('data/default-user');
const backupsDir = path.join(userDataRoot, 'backups');
const assetsDir = path.join(userDataRoot, 'assets');
const localExtensionsDir = path.join(userDataRoot, 'extensions');
const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l1S3PwAAAABJRU5ErkJggg==',
    'base64',
);

test.describe.configure({ mode: 'serial' });

function apiUrl(path) {
    return new URL(path, baseURL).toString();
}

function uniqueName(label) {
    return `ModernContract-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getPersonaAvatarByName(settings, name) {
    return Object.entries(settings.power_user?.personas || {}).find(([, personaName]) => personaName === name)?.[0] || '';
}

function stripJsonlExtension(value) {
    return String(value || '').replace(/\.jsonl$/iu, '');
}

function getChatBackupPrefixForName(name) {
    const baseName = String(name || '').replace(/\.png$/iu, '');
    return `chat_${baseName.replace(/[^a-z0-9]/giu, '_').toLowerCase()}_`;
}

function getChatBackupPrefix(avatar) {
    return getChatBackupPrefixForName(avatar);
}

function deleteBackupFile(name) {
    const fileName = path.basename(String(name || ''));
    if (!fileName || fileName !== name) {
        return;
    }
    fs.rmSync(path.join(backupsDir, fileName), { force: true });
}

function deleteChatBackupsByPrefix(prefix) {
    if (!prefix || !fs.existsSync(backupsDir)) {
        return;
    }
    for (const fileName of fs.readdirSync(backupsDir)) {
        if (fileName.startsWith(prefix)) {
            fs.rmSync(path.join(backupsDir, fileName), { force: true });
        }
    }
}

function getSecretIds(secretState, key) {
    return new Set((secretState?.[key] || []).map(secret => secret.id).filter(Boolean));
}

async function startServer(server, host = '127.0.0.1') {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, host, () => {
            server.off('error', reject);
            resolve();
        });
    });
    return server.address().port;
}

async function closeServer(server) {
    if (!server.listening) {
        return;
    }
    await new Promise(resolve => server.close(resolve));
}

async function startLocalAssetServer(body) {
    const server = createServer((request, response) => {
        if (request.method === 'GET' && request.url === '/asset.txt') {
            response.writeHead(200, { 'Content-Type': 'text/plain' });
            response.end(body);
            return;
        }
        response.writeHead(404);
        response.end();
    });
    const port = await startServer(server, 'localhost');
    return {
        url: `http://localhost:${port}/asset.txt`,
        close: () => closeServer(server),
    };
}

async function startLocalChatCompletionServer(replyText) {
    const requests = [];
    const server = createServer((request, response) => {
        let rawBody = '';
        request.on('data', chunk => {
            rawBody += chunk.toString();
        });
        request.on('end', () => {
            if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
                response.writeHead(404);
                response.end();
                return;
            }

            const body = rawBody ? JSON.parse(rawBody) : {};
            requests.push({
                body,
                headers: request.headers,
            });
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({
                choices: [
                    {
                        message: {
                            role: 'assistant',
                            content: replyText,
                        },
                    },
                ],
            }));
        });
    });
    const port = await startServer(server);
    return {
        url: `http://127.0.0.1:${port}/v1`,
        requests,
        close: () => closeServer(server),
    };
}

function trackApiRequests(page) {
    const requests = [];
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname === '/csrf-token' || url.pathname.startsWith('/api/')) {
            requests.push({
                method: request.method(),
                path: url.pathname,
                body: request.postData() || '',
            });
        }
    });

    return {
        count(path, method = 'POST') {
            return requests.filter(request => request.path === path && request.method === method).length;
        },
        lastJson(path, method = 'POST') {
            const request = requests.filter(item => item.path === path && item.method === method).at(-1);
            if (!request?.body) {
                return null;
            }
            try {
                return JSON.parse(request.body);
            } catch {
                return null;
            }
        },
        all: requests,
    };
}

async function expectFrontendRequest(tracker, path, method = 'POST') {
    await expect.poll(() => tracker.count(path, method), { message: `${method} ${path}` }).toBeGreaterThan(0);
}

async function waitForValue(producer) {
    let value = null;
    await expect.poll(async () => {
        value = await producer();
        return Boolean(value);
    }).toBe(true);
    return value;
}

async function getCsrfToken(page) {
    const response = await page.request.get(apiUrl('/csrf-token'));
    if (!response.ok()) {
        throw new Error(`/csrf-token failed: ${response.status()}`);
    }
    const data = await response.json();
    return data.token;
}

async function apiFetch(page, path, body = undefined, method = 'POST') {
    const token = await getCsrfToken(page);
    const response = await page.request.fetch(apiUrl(path), {
        method,
        headers: {
            'X-CSRF-Token': token,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        data: body,
    });
    const text = await response.text();
    if (!response.ok()) {
        throw new Error(`${method} ${path} failed: ${response.status()} ${text}`);
    }
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function safeApiFetch(page, path, body = undefined, method = 'POST') {
    try {
        return await apiFetch(page, path, body, method);
    } catch {
        return null;
    }
}

async function getSettings(page) {
    const bundle = await apiFetch(page, '/api/settings/get');
    return JSON.parse(bundle.settings || '{}');
}

async function getSettingsSnapshots(page) {
    const snapshots = await apiFetch(page, '/api/settings/get-snapshots');
    return Array.isArray(snapshots) ? snapshots : [];
}

async function getSecretState(page) {
    return apiFetch(page, '/api/secrets/read');
}

async function restoreSettings(page, settings) {
    if (settings) {
        await safeApiFetch(page, '/api/settings/save', settings);
    }
}

async function findCharacterByName(page, name) {
    const characters = await apiFetch(page, '/api/characters/all');
    return characters.find(character => character.name === name || character.data?.name === name) || null;
}

async function findGroupByName(page, name) {
    const groups = await apiFetch(page, '/api/groups/all');
    return groups.find(group => group.name === name) || null;
}

async function findBackgroundFolderByName(page, name) {
    const data = await apiFetch(page, '/api/backgrounds/folders');
    return (data.folders || []).find(folder => folder.name === name) || null;
}

async function deleteCharacterByName(page, name) {
    const character = await findCharacterByName(page, name);
    if (character?.avatar) {
        await safeApiFetch(page, '/api/characters/delete', { avatar_url: character.avatar, delete_chats: true });
    }
}

async function createCharacter(page, name) {
    return apiFetch(page, '/api/characters/create', {
        ch_name: name,
        description: `${name} description`,
        first_mes: `Hello from ${name}.`,
        personality: 'Created for real backend integration.',
        scenario: '',
        mes_example: '',
        creator: 'Modern contract test',
        tags: ['modern-contract'],
    });
}

async function deleteGroupByName(page, name) {
    const group = await findGroupByName(page, name);
    if (group?.id) {
        await safeApiFetch(page, '/api/groups/delete', { id: group.id });
    }
}

async function deleteWorldbook(page, name) {
    await safeApiFetch(page, '/api/worldinfo/delete', { name });
}

async function deletePresetFromKnownApis(page, name) {
    for (const apiId of ['openai', 'textgenerationwebui', 'kobold', 'novel']) {
        await safeApiFetch(page, '/api/presets/delete', { apiId, name });
    }
}

async function deleteBackgroundFolderByName(page, name) {
    const folder = await findBackgroundFolderByName(page, name);
    if (folder?.id) {
        await safeApiFetch(page, '/api/image-metadata/folders/delete', { id: folder.id });
    }
}

async function deleteNewSecrets(page, key, beforeIds) {
    const secretState = await safeApiFetch(page, '/api/secrets/read');
    for (const secret of secretState?.[key] || []) {
        if (!beforeIds.has(secret.id)) {
            await safeApiFetch(page, '/api/secrets/delete', { key, id: secret.id });
        }
    }
}

test.describe('Modern real backend integration', () => {
    test('creates, edits, groups, and deletes character resources from the UI', async ({ page }) => {
        const tracker = trackApiRequests(page);
        const characterName = uniqueName('Character');
        const editedDescription = `${characterName} edited description`;
        const groupName = uniqueName('Group');
        let avatar = '';
        let groupId = '';

        try {
            await gotoModern(page, 'characters', '角色库');

            await page.locator('[data-create-character]').click();
            await page.locator('[data-character-field="name"][data-character-scope="create"]').fill(characterName);
            await page.locator('[data-character-field="creator"][data-character-scope="create"]').fill('Modern contract test');
            await page.locator('[data-character-field="description"][data-character-scope="create"]').fill(`${characterName} description`);
            await page.locator('[data-character-field="first_mes"][data-character-scope="create"]').fill('Hello from a real integration test.');
            await page.locator('[data-save-character-create]').click();

            await expectFrontendRequest(tracker, '/api/characters/create');
            await expect(page.locator('.detail-title')).toHaveText(characterName);
            const character = await waitForValue(() => findCharacterByName(page, characterName));
            avatar = character.avatar;

            await page.locator(`[data-edit-character="${avatar}"]`).click();
            await page.locator('[data-character-field="description"][data-character-scope="edit"]').fill(editedDescription);
            await page.locator('[data-character-field="personality"][data-character-scope="edit"]').fill('Edited through the modern real UI.');
            await page.locator('[data-save-character-edit]').click();

            await expectFrontendRequest(tracker, '/api/characters/merge-attributes');
            await expect(page.locator('.detail-text')).toContainText(editedDescription);
            const editedCharacter = await apiFetch(page, '/api/characters/get', { avatar_url: avatar });
            expect(editedCharacter.description || editedCharacter.data?.description).toBe(editedDescription);

            await gotoModern(page, 'groups', '群组管理');
            await page.locator('[data-create-group]').click();
            await page.locator('[data-group-field="name"][data-group-scope="create"]').fill(groupName);
            await page.locator(`[data-group-member="${avatar}"][data-group-scope="create"]`).check();
            await page.locator('[data-save-group-create]').click();

            await expectFrontendRequest(tracker, '/api/groups/create');
            await expect(page.locator('.detail-title')).toHaveText(groupName);
            const group = await waitForValue(() => findGroupByName(page, groupName));
            groupId = group.id;
            expect(group.members).toContain(avatar);

            await page.locator(`[data-edit-group="${groupId}"]`).click();
            await page.locator('[data-group-field="allow_self_responses"][data-group-scope="edit"]').check();
            await page.locator('[data-save-group-edit]').click();

            await expectFrontendRequest(tracker, '/api/groups/edit');
            const editedGroup = await findGroupByName(page, groupName);
            expect(editedGroup.allow_self_responses).toBe(true);

            await page.locator(`[data-delete-group="${groupId}"]`).click();
            await page.locator('[data-confirm-group-delete]').click();

            await expectFrontendRequest(tracker, '/api/groups/delete');
            await expect.poll(() => findGroupByName(page, groupName)).toBeNull();
            groupId = '';

            await gotoModern(page, 'characters', '角色库');
            await page.locator(`[data-select-character="${avatar}"]`).click();
            await page.locator(`[data-delete-character="${avatar}"]`).click();
            await page.locator('[data-character-delete-chats]').check();
            await page.locator('[data-confirm-character-delete]').click();

            await expectFrontendRequest(tracker, '/api/characters/delete');
            await expect.poll(() => findCharacterByName(page, characterName)).toBeNull();
            avatar = '';
        } finally {
            if (groupId) {
                await safeApiFetch(page, '/api/groups/delete', { id: groupId });
            }
            await deleteGroupByName(page, groupName);
            await deleteCharacterByName(page, characterName);
        }
    });

    test('creates, edits, and deletes a worldbook entry from the UI', async ({ page }) => {
        const tracker = trackApiRequests(page);
        const worldbookName = uniqueName('Worldbook');
        const entryKey = `${worldbookName}-key`;
        const entryComment = `${worldbookName} entry`;
        const entryContent = `${worldbookName} content from UI`;
        let worldbookDeleted = false;

        try {
            await gotoModern(page, 'worldbooks', '世界书');

            await page.locator('[data-create-worldbook]').click();
            await page.locator('[data-worldbook-create-name]').fill(worldbookName);
            await page.locator('[data-save-worldbook-create]').click();

            await expectFrontendRequest(tracker, '/api/worldinfo/edit');
            await expect(page.locator(`[data-select-worldbook="${worldbookName}"]`)).toBeVisible();

            await page.locator(`[data-create-world-entry="${worldbookName}"]`).click();
            await page.locator('[data-world-entry-field="key"]').fill(entryKey);
            await page.locator('[data-world-entry-field="comment"]').fill(entryComment);
            await page.locator('[data-world-entry-field="content"]').fill(entryContent);
            await page.locator('[data-save-world-entry-edit]').click();

            await expect.poll(() => tracker.count('/api/worldinfo/edit')).toBeGreaterThan(1);
            await expect(page.locator('.world-entry-card', { hasText: entryComment })).toContainText(entryContent);

            const detail = await apiFetch(page, '/api/worldinfo/get', { name: worldbookName });
            const entries = Object.values(detail.entries || {});
            expect(entries).toHaveLength(1);
            expect(entries[0]).toMatchObject({
                key: [entryKey],
                comment: entryComment,
                content: entryContent,
            });

            await page.locator(`[data-delete-worldbook="${worldbookName}"]`).click();
            await page.locator('[data-confirm-worldbook-delete]').click();

            await expectFrontendRequest(tracker, '/api/worldinfo/delete');
            await expect(page.locator(`[data-select-worldbook="${worldbookName}"]`)).toHaveCount(0);
            worldbookDeleted = true;
        } finally {
            if (!worldbookDeleted) {
                await deleteWorldbook(page, worldbookName);
            }
        }
    });

    test('imports and deletes a preset from the UI against the real backend', async ({ page }) => {
        const tracker = trackApiRequests(page);
        const presetName = uniqueName('Preset');

        try {
            await gotoModern(page, 'presets', '预设管理');

            await page.locator('[data-preset-import-file]').setInputFiles({
                name: `${presetName}.json`,
                mimeType: 'application/json',
                buffer: Buffer.from(JSON.stringify({
                    chat_completion_source: 'custom',
                    custom_model: `${presetName}-model`,
                    temperature: 0.42,
                })),
            });

            await expectFrontendRequest(tracker, '/api/presets/save');
            const presetButton = page.locator(`[data-select-preset="${presetName}"]`).first();
            await expect(presetButton).toBeVisible();
            const apiId = await presetButton.getAttribute('data-preset-api');
            expect(apiId).toBeTruthy();

            await presetButton.click();
            await expect(page.locator('[data-preset-json-input]')).toContainText(`${presetName}-model`);
            await page.locator(`[data-delete-preset="${presetName}"][data-preset-api="${apiId}"]`).click();
            await page.locator('[data-confirm-preset-delete]').click();

            await expectFrontendRequest(tracker, '/api/presets/delete');
            await expect(page.locator(`[data-select-preset="${presetName}"]`)).toHaveCount(0);
        } finally {
            await deletePresetFromKnownApis(page, presetName);
        }
    });

    test('creates and deletes a persona from the UI while restoring settings', async ({ page }) => {
        const tracker = trackApiRequests(page);
        const settingsBefore = await getSettings(page);
        const personaName = uniqueName('Persona');
        const avatarName = `${personaName}.png`;
        let createdAvatar = avatarName;
        let personaDeleted = false;

        try {
            await gotoModern(page, 'personas', '用户人设');

            await page.locator('[data-create-persona]').click();
            await page.locator('[data-persona-field="name"][data-persona-scope="create"]').fill(personaName);
            await page.locator('[data-persona-field="title"][data-persona-scope="create"]').fill('Real UI persona');
            await page.locator('[data-persona-field="description"][data-persona-scope="create"]').fill(`${personaName} description`);
            await page.locator('[data-persona-create-file]').setInputFiles({
                name: avatarName,
                mimeType: 'image/png',
                buffer: tinyPng,
            });
            await page.locator('[data-save-persona-create]').click();

            await expectFrontendRequest(tracker, '/api/avatars/upload');
            await expectFrontendRequest(tracker, '/api/settings/save');
            await expect(page.locator('.persona-card', { hasText: personaName })).toContainText(`${personaName} description`);

            createdAvatar = await waitForValue(async () => getPersonaAvatarByName(await getSettings(page), personaName));

            await page.locator(`[data-delete-persona="${createdAvatar}"]`).click();
            await page.locator('[data-confirm-persona-delete]').click();

            await expectFrontendRequest(tracker, '/api/avatars/delete');
            await expect(page.locator('.persona-card', { hasText: personaName })).toHaveCount(0);
            personaDeleted = true;
        } finally {
            if (!personaDeleted) {
                await safeApiFetch(page, '/api/avatars/delete', { avatar: createdAvatar });
                if (avatarName !== createdAvatar) {
                    await safeApiFetch(page, '/api/avatars/delete', { avatar: avatarName });
                }
            }
            await restoreSettings(page, settingsBefore);
        }
    });

    test('creates, previews, and restores a settings snapshot from the UI', async ({ page }) => {
        const tracker = trackApiRequests(page);
        const settingsBefore = await getSettings(page);
        const snapshotsBefore = await getSettingsSnapshots(page);
        const snapshotDatesBefore = new Map(snapshotsBefore.map(snapshot => [snapshot.name, Number(snapshot.date || 0)]));
        let snapshotName = '';

        try {
            await gotoModern(page, 'settings', '设置中心');
            await page.locator('[data-settings-section="snapshots"]').click();
            const createStartedAt = Date.now();
            await page.locator('[data-create-settings-snapshot]').click();

            await expectFrontendRequest(tracker, '/api/settings/make-snapshot');
            snapshotName = await waitForValue(async () => {
                const snapshots = await getSettingsSnapshots(page);
                return snapshots
                    .filter(snapshot => Number(snapshot.date || 0) >= createStartedAt - 1000
                        || Number(snapshot.date || 0) > (snapshotDatesBefore.get(snapshot.name) || 0))
                    .sort((a, b) => Number(b.date || 0) - Number(a.date || 0))[0]?.name || '';
            });
            await expect(page.locator(`[data-preview-settings-snapshot="${snapshotName}"]`)).toBeVisible();

            await page.locator(`[data-preview-settings-snapshot="${snapshotName}"]`).click();
            await expectFrontendRequest(tracker, '/api/settings/load-snapshot');
            await expect(page.locator('.backup-preview textarea')).toContainText('"main_api"');

            await page.locator(`[data-restore-settings-snapshot="${snapshotName}"]`).click();
            await page.locator('[data-confirm-settings-restore]').click();

            await expectFrontendRequest(tracker, '/api/settings/restore-snapshot');
            await expect.poll(async () => JSON.stringify(await getSettings(page))).toBe(JSON.stringify(settingsBefore));
        } finally {
            await restoreSettings(page, settingsBefore);
            deleteBackupFile(snapshotName);
        }
    });

    test('uploads, files, renames, folders, and deletes backgrounds from the UI', async ({ page }) => {
        const tracker = trackApiRequests(page);
        const backgroundName = `${uniqueName('Background')}.png`;
        const renamedBackgroundName = backgroundName.replace(/\.png$/u, '-renamed.png');
        const folderName = uniqueName('Folder');
        let folderId = '';
        let currentBackgroundName = '';

        try {
            await gotoModern(page, 'assets', '素材库');

            await page.locator('[data-background-upload-file]').setInputFiles({
                name: backgroundName,
                mimeType: 'image/png',
                buffer: tinyPng,
            });

            await expectFrontendRequest(tracker, '/api/backgrounds/upload');
            await expect(page.locator('.background-card', { hasText: backgroundName })).toBeVisible();
            currentBackgroundName = backgroundName;

            await page.locator('[data-toggle-background-folder-create]').click();
            await page.locator('[data-background-folder-create-name]').fill(folderName);
            await page.locator('[data-save-background-folder-create]').click();

            await expectFrontendRequest(tracker, '/api/image-metadata/folders/create');
            const folder = await waitForValue(() => findBackgroundFolderByName(page, folderName));
            folderId = folder.id;
            await expect(page.locator(`[data-background-folder-filter="${folderId}"]`)).toContainText(folderName);

            await page.locator('[data-background-folder-filter=""]').click();
            await page.locator('[data-toggle-background-selection]').click();
            await page.locator(`[data-background-select="${backgroundName}"]`).check();
            await page.locator('[data-background-folder-assignment]').selectOption(folderId);
            const assignResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/image-metadata/folders/assign');
            await page.locator('[data-assign-selected-backgrounds]').click();
            const assignResponse = await assignResponsePromise;
            expect(assignResponse.ok()).toBe(true);

            await expectFrontendRequest(tracker, '/api/image-metadata/folders/assign');
            expect(tracker.lastJson('/api/image-metadata/folders/assign')).toEqual({
                id: folderId,
                paths: [`backgrounds/${backgroundName}`],
            });
            await expect.poll(async () => {
                const foldersAfterAssign = await apiFetch(page, '/api/backgrounds/folders');
                return foldersAfterAssign.imageFolderMap?.[backgroundName]?.includes(folderId) || false;
            }).toBe(true);

            await page.locator('[data-toggle-background-selection]').click();
            await expect(page.locator(`[data-background-select="${backgroundName}"]`)).toHaveCount(0);
            await page.locator(`[data-background-rename="${backgroundName}"]`).click();
            await page.locator('[data-background-rename-input]').fill(renamedBackgroundName);
            await page.locator('[data-confirm-background-rename]').click();

            await expectFrontendRequest(tracker, '/api/backgrounds/rename');
            await expect(page.locator('.background-card', { hasText: renamedBackgroundName })).toBeVisible();
            currentBackgroundName = renamedBackgroundName;

            await page.locator(`[data-background-folder-filter="${folderId}"]`).click();
            await page.locator(`[data-delete-background-folder="${folderId}"]`).click();
            await page.locator('[data-confirm-background-folder-delete]').click();

            await expectFrontendRequest(tracker, '/api/image-metadata/folders/delete');
            await expect(page.locator(`[data-background-folder-filter="${folderId}"]`)).toHaveCount(0);
            folderId = '';

            await page.locator('[data-background-folder-filter=""]').click();
            if (await page.locator(`[data-background-select="${renamedBackgroundName}"]`).count() === 0) {
                await page.locator('[data-toggle-background-selection]').click();
            }
            await page.locator(`[data-background-select="${renamedBackgroundName}"]`).check();
            await page.locator('[data-delete-selected-backgrounds]').click();
            await page.locator('[data-confirm-background-delete]').click();

            await expectFrontendRequest(tracker, '/api/backgrounds/delete');
            await expect(page.locator('.background-card', { hasText: renamedBackgroundName })).toHaveCount(0);
            currentBackgroundName = '';
        } finally {
            if (folderId) {
                await safeApiFetch(page, '/api/image-metadata/folders/delete', { id: folderId });
            }
            await deleteBackgroundFolderByName(page, folderName);
            if (currentBackgroundName) {
                await safeApiFetch(page, '/api/backgrounds/delete', { bg: currentBackgroundName });
            }
        }
    });

    test('downloads and deletes an asset file from the UI against the real backend', async ({ page }) => {
        const tracker = trackApiRequests(page);
        const filename = `${uniqueName('Asset')}.txt`;
        const category = 'bgm';
        const assetBody = `asset fixture for ${filename}`;
        let assetServer = null;

        try {
            assetServer = await startLocalAssetServer(assetBody);
            await gotoModern(page, 'assets', '素材库');

            await page.locator('[data-toggle-asset-download]').click();
            await page.locator('[data-asset-download-url]').fill(assetServer.url);
            await page.locator('[data-asset-download-filename]').fill(filename);
            await page.locator('[data-asset-download-category]').selectOption(category);
            await page.locator('[data-download-asset]').click();

            await expectFrontendRequest(tracker, '/api/assets/download');
            await page.locator('[data-asset-tab="files"]').click();
            const row = page.locator(`[data-asset-row="${category}:assets/${category}/${filename}"]`);
            await expect(row).toBeVisible();
            expect(fs.readFileSync(path.join(assetsDir, category, filename), 'utf8')).toBe(assetBody);

            await page.locator(`[data-delete-asset][data-asset-category="${category}"][data-asset-filename="${filename}"]`).click();
            await page.locator('[data-confirm-asset-delete]').click();

            await expectFrontendRequest(tracker, '/api/assets/delete');
            await expect(row).toHaveCount(0);
        } finally {
            await safeApiFetch(page, '/api/assets/delete', { category, filename });
            fs.rmSync(path.join(assetsDir, category, filename), { force: true });
            if (assetServer) {
                await assetServer.close();
            }
        }
    });

    test('manages character chat files and messages from the UI against the real backend', async ({ page }) => {
        const tracker = trackApiRequests(page);
        const characterName = uniqueName('ChatCharacter');
        const importedMessage = `${characterName} imported message`;
        let avatar = '';
        let chatBackupName = '';
        let chatBackupPrefix = '';

        try {
            avatar = await createCharacter(page, characterName);
            chatBackupPrefix = getChatBackupPrefix(avatar);
            await page.addInitScript(() => window.localStorage.setItem('st-modern-chat-mode', 'character'));
            await gotoModern(page, 'chat', '聊天工作区');

            await page.locator(`[data-select-character="${avatar}"]`).click();
            await expect(page.locator('.detail-title')).toHaveText(characterName);
            await page.locator('[data-new-chat]').click();

            await expectFrontendRequest(tracker, '/api/chats/save');
            let chatId = tracker.lastJson('/api/chats/save')?.file_name || '';
            expect(chatId).toBeTruthy();
            await expect(page.locator(`[data-select-chat="${chatId}"]`)).toBeVisible();
            await expect(page.locator('.chat-thread')).toContainText(`Hello from ${characterName}.`);

            const editedMessage = `${characterName} edited greeting`;
            await page.locator('[data-delete-message="0"]').click();
            await page.locator('[data-edit-message="0"]').click();
            await page.locator('[data-edit-message-input="0"]').fill(editedMessage);
            await page.locator('[data-save-edit-message]').click();

            await expect.poll(() => tracker.count('/api/chats/save')).toBeGreaterThan(1);
            await expect(page.locator('.chat-thread')).toContainText(editedMessage);
            const savedChat = await apiFetch(page, '/api/chats/get', { avatar_url: avatar, file_name: chatId });
            expect(savedChat.some(message => message.mes === editedMessage)).toBe(true);

            chatBackupName = `${chatBackupPrefix}${Date.now()}.jsonl`;
            fs.mkdirSync(backupsDir, { recursive: true });
            fs.writeFileSync(path.join(backupsDir, chatBackupName), [
                JSON.stringify({ chat_metadata: {}, user_name: 'Modern User', character_name: characterName }),
                JSON.stringify({ name: characterName, is_user: false, mes: `${characterName} backup preview`, send_date: new Date().toISOString() }),
            ].join('\n'));
            await page.locator('[data-chat-backups-toggle]').click();
            await expectFrontendRequest(tracker, '/api/backups/chat/get');
            await expect(page.locator(`[data-view-chat-backup="${chatBackupName}"]`)).toBeVisible();
            await page.locator(`[data-view-chat-backup="${chatBackupName}"]`).click();
            await expectFrontendRequest(tracker, '/api/backups/chat/download');
            await expect(page.locator('.backup-preview textarea')).toContainText(`${characterName} backup preview`);
            await page.locator(`[data-delete-chat-backup="${chatBackupName}"]`).click();
            await page.locator('[data-confirm-chat-backup-delete]').click();
            await expectFrontendRequest(tracker, '/api/backups/chat/delete');
            await expect(page.locator(`[data-view-chat-backup="${chatBackupName}"]`)).toHaveCount(0);
            chatBackupName = '';
            await page.locator('[aria-label="关闭聊天备份"]').click({ position: { x: 10, y: 10 } });
            await expect(page.locator('.chat-tools-drawer')).toHaveCount(0);

            const renamedChatId = uniqueName('ChatFile');
            await page.locator('[data-delete-chat]').click();
            await page.locator('[data-rename-chat]').click();
            await page.locator('[data-chat-rename-input]').fill(renamedChatId);
            await page.locator('[data-save-chat-rename]').click();

            await expectFrontendRequest(tracker, '/api/chats/rename');
            chatId = stripJsonlExtension(renamedChatId);
            await expect(page.locator(`[data-select-chat="${chatId}"]`)).toBeVisible();

            await page.locator('[data-delete-chat]').click();
            const downloadPromise = page.waitForEvent('download');
            await page.locator('[data-export-chat="jsonl"]').click();
            const download = await downloadPromise;
            expect(download.suggestedFilename()).toBe(`${chatId}.jsonl`);
            await expectFrontendRequest(tracker, '/api/chats/export');

            await page.locator('[data-confirm-chat-delete]').click();

            await expectFrontendRequest(tracker, '/api/chats/delete');
            await expect(page.locator(`[data-select-chat="${chatId}"]`)).toHaveCount(0);

            await page.locator('[data-chat-import-file]').setInputFiles({
                name: `${uniqueName('ImportedChat')}.jsonl`,
                mimeType: 'application/jsonl',
                buffer: Buffer.from([
                    JSON.stringify({ chat_metadata: {}, user_name: 'Modern User', character_name: characterName }),
                    JSON.stringify({ name: 'Modern User', is_user: true, mes: importedMessage, send_date: new Date().toISOString() }),
                ].join('\n')),
            });

            await expectFrontendRequest(tracker, '/api/chats/import');
            await expect(page.locator('.chat-thread')).toContainText(importedMessage);
        } finally {
            if (chatBackupName) {
                await safeApiFetch(page, '/api/backups/chat/delete', { name: chatBackupName });
            }
            deleteChatBackupsByPrefix(chatBackupPrefix);
            await deleteCharacterByName(page, characterName);
            if (avatar) {
                await safeApiFetch(page, '/api/characters/delete', { avatar_url: avatar, delete_chats: true });
            }
        }
    });

    test('manages group chat files from the UI against the real backend', async ({ page }) => {
        const tracker = trackApiRequests(page);
        const characterName = uniqueName('GroupChatCharacter');
        const groupName = uniqueName('ChatGroup');
        const importedMessage = `${groupName} imported group message`;
        let avatar = '';
        let groupId = '';
        let chatId = '';
        let renamedChatId = '';
        let importedChatId = '';

        try {
            avatar = await createCharacter(page, characterName);
            const group = await apiFetch(page, '/api/groups/create', {
                name: groupName,
                members: [avatar],
                allow_self_responses: true,
                activation_strategy: 0,
                generation_mode: 0,
                chats: [],
                chat_id: '',
            });
            groupId = group.id;

            await page.addInitScript(() => window.localStorage.setItem('st-modern-chat-mode', 'group'));
            await gotoModern(page, 'chat', '聊天工作区');
            await page.locator('[data-chat-mode="group"]').click();
            await page.locator(`[data-select-group="${groupId}"]`).click();
            await expect(page.locator('.detail-title')).toHaveText(groupName);

            const groupEditCountBeforeCreate = tracker.count('/api/groups/edit');
            await page.locator('[data-new-chat]').click();
            await expectFrontendRequest(tracker, '/api/chats/group/save');
            await expect.poll(() => tracker.count('/api/groups/edit')).toBeGreaterThan(groupEditCountBeforeCreate);
            chatId = tracker.lastJson('/api/chats/group/save')?.id || '';
            expect(chatId).toBeTruthy();
            await expect(page.locator(`[data-select-chat="${chatId}"]`)).toBeVisible();
            await apiFetch(page, '/api/chats/group/get', { id: chatId });

            renamedChatId = uniqueName('GroupChatFile');
            const groupEditCountBeforeRename = tracker.count('/api/groups/edit');
            await page.locator('[data-delete-chat]').click();
            await page.locator('[data-rename-chat]').click();
            await page.locator('[data-chat-rename-input]').fill(renamedChatId);
            await page.locator('[data-save-chat-rename]').click();

            await expectFrontendRequest(tracker, '/api/chats/rename');
            await expect.poll(() => tracker.count('/api/groups/edit')).toBeGreaterThan(groupEditCountBeforeRename);
            expect(tracker.lastJson('/api/chats/rename')).toMatchObject({
                avatar_url: null,
                original_file: `${chatId}.jsonl`,
                renamed_file: `${renamedChatId}.jsonl`,
                is_group: true,
            });
            chatId = renamedChatId;
            await expect(page.locator(`[data-select-chat="${chatId}"]`)).toBeVisible();

            await page.locator('[data-delete-chat]').click();
            const downloadPromise = page.waitForEvent('download');
            await page.locator('[data-export-chat="jsonl"]').click();
            const download = await downloadPromise;
            expect(download.suggestedFilename()).toBe(`${chatId}.jsonl`);
            await expectFrontendRequest(tracker, '/api/chats/export');
            expect(tracker.lastJson('/api/chats/export')).toMatchObject({
                is_group: true,
                avatar_url: null,
                file: `${chatId}.jsonl`,
                exportfilename: `${chatId}.jsonl`,
                format: 'jsonl',
            });

            const groupEditCountBeforeDelete = tracker.count('/api/groups/edit');
            await page.locator('[data-confirm-chat-delete]').click();

            await expectFrontendRequest(tracker, '/api/chats/group/delete');
            await expect.poll(() => tracker.count('/api/groups/edit')).toBeGreaterThan(groupEditCountBeforeDelete);
            expect(tracker.lastJson('/api/chats/group/delete')).toEqual({ id: chatId });
            await expect(page.locator(`[data-select-chat="${chatId}"]`)).toHaveCount(0);
            deleteChatBackupsByPrefix(getChatBackupPrefixForName(chatId));
            chatId = '';

            const groupEditCountBeforeImport = tracker.count('/api/groups/edit');
            await page.locator('[data-chat-import-file]').setInputFiles({
                name: `${uniqueName('ImportedGroupChat')}.jsonl`,
                mimeType: 'application/jsonl',
                buffer: Buffer.from([
                    JSON.stringify({ chat_metadata: {}, user_name: 'Modern User', character_name: groupName }),
                    JSON.stringify({ name: 'Modern User', is_user: true, mes: importedMessage, send_date: new Date().toISOString() }),
                ].join('\n')),
            });

            await expectFrontendRequest(tracker, '/api/chats/group/import');
            await expect.poll(() => tracker.count('/api/groups/edit')).toBeGreaterThan(groupEditCountBeforeImport);
            importedChatId = tracker.lastJson('/api/groups/edit')?.chat_id || '';
            expect(importedChatId).toBeTruthy();
            await expect(page.locator(`[data-select-chat="${importedChatId}"]`)).toBeVisible();
            await expect(page.locator('.chat-thread')).toContainText(importedMessage);
        } finally {
            for (const id of [chatId, renamedChatId, importedChatId]) {
                if (id) {
                    await safeApiFetch(page, '/api/chats/group/delete', { id });
                    deleteChatBackupsByPrefix(getChatBackupPrefixForName(id));
                }
            }
            if (groupId) {
                await safeApiFetch(page, '/api/groups/delete', { id: groupId });
            }
            await deleteGroupByName(page, groupName);
            await deleteCharacterByName(page, characterName);
            if (avatar) {
                await safeApiFetch(page, '/api/characters/delete', { avatar_url: avatar, delete_chats: true });
            }
        }
    });

    test('reads and deletes a local extension directory from the UI against the real backend', async ({ page }) => {
        const tracker = trackApiRequests(page);
        const extensionName = uniqueName('Extension').toLowerCase();
        const extensionPath = path.join(localExtensionsDir, extensionName);

        try {
            fs.rmSync(extensionPath, { recursive: true, force: true });
            fs.mkdirSync(extensionPath, { recursive: true });
            fs.writeFileSync(path.join(extensionPath, 'manifest.json'), JSON.stringify({ display_name: extensionName }, null, 4));

            await gotoModern(page, 'extensions', '扩展');
            await page.locator('[data-extension-view="local"]').click();
            const card = page.locator(`[data-extension-card="local:${extensionName}"]`);
            await expect(card).toContainText(`third-party/${extensionName}`);

            await page.locator(`[data-extension-details="${extensionName}"][data-extension-type="local"]`).click();
            await expectFrontendRequest(tracker, '/api/extensions/version');
            await expect(card.locator('.extension-detail-panel')).toContainText('未配置');

            await page.locator(`[data-extension-action="delete"][data-extension-name="${extensionName}"][data-extension-type="local"]`).click();
            await page.locator('[data-confirm-extension-operation]').click();

            await expectFrontendRequest(tracker, '/api/extensions/delete');
            await expect(page.locator(`[data-extension-card="local:${extensionName}"]`)).toHaveCount(0);
            expect(fs.existsSync(extensionPath)).toBe(false);
        } finally {
            fs.rmSync(extensionPath, { recursive: true, force: true });
        }
    });

    test('saves API and request compression settings from the UI against the real backend', async ({ page }) => {
        const tracker = trackApiRequests(page);
        const settingsBefore = await getSettings(page);
        const modelName = uniqueName('ApiModel');

        try {
            await gotoModern(page, 'api', 'API 连接管理');

            await page.locator('[data-api-main]').selectOption('openai');
            await page.locator('[data-api-source]').selectOption('custom');
            await page.locator('[data-api-model]').fill(modelName);
            await page.locator('[data-api-custom-url]').fill('https://modern-contract.invalid/v1');
            await page.locator('[data-api-reverse-proxy]').fill('');
            await page.locator('[data-api-temperature]').fill('0.33');
            await page.locator('[data-api-max-tokens]').fill('321');
            await page.locator('[data-save-api-connection]').click();

            await expectFrontendRequest(tracker, '/api/settings/save');
            const savedApiSettings = await waitForValue(async () => {
                const settings = await getSettings(page);
                return settings.oai_settings?.custom_model === modelName ? settings : null;
            });
            expect(savedApiSettings).toMatchObject({
                main_api: 'openai',
                chat_completion_source: 'custom',
            });
            expect(savedApiSettings.oai_settings).toMatchObject({
                chat_completion_source: 'custom',
                custom_model: modelName,
                custom_url: 'https://modern-contract.invalid/v1',
                temp_openai: 0.33,
                openai_max_tokens: 321,
            });

            const saveCount = tracker.count('/api/settings/save');
            await gotoModern(page, 'settings', '设置中心');
            await page.locator('[data-request-compression-enabled]').check();
            await page.locator('[data-request-compression-min]').fill('2048');
            await page.locator('[data-request-compression-max]').fill('8192');
            await page.locator('[data-save-request-compression]').click();

            await expect.poll(() => tracker.count('/api/settings/save')).toBeGreaterThan(saveCount);
            const compressionSettings = await waitForValue(async () => {
                const settings = await getSettings(page);
                return settings.request_compression?.minPayloadSize === 2048 ? settings.request_compression : null;
            });
            expect(compressionSettings).toMatchObject({
                enabled: true,
                minPayloadSize: 2048,
                maxPayloadSize: 8192,
            });
        } finally {
            await restoreSettings(page, settingsBefore);
        }
    });

    test('tests a custom chat completion endpoint from the UI through the real backend', async ({ page }) => {
        const tracker = trackApiRequests(page);
        const settingsBefore = await getSettings(page);
        const secretStateBefore = await getSecretState(page);
        const customSecretIdsBefore = getSecretIds(secretStateBefore, 'api_key_custom');
        const modelName = uniqueName('ProviderModel');
        const apiKey = `sk-${uniqueName('ProviderKey')}`;
        const providerReply = `OK from ${modelName}`;
        let providerServer = null;

        try {
            providerServer = await startLocalChatCompletionServer(providerReply);
            await gotoModern(page, 'api', 'API 连接管理');

            await page.locator('[data-api-main]').selectOption('openai');
            await page.locator('[data-api-source]').selectOption('custom');
            await expect(page.locator('[data-api-custom-url]')).toBeVisible();
            await page.locator('[data-api-model]').fill(modelName);
            await page.locator('[data-api-custom-url]').fill(providerServer.url);
            await page.locator('[data-api-reverse-proxy]').fill('');
            await page.locator('[data-api-key]').fill(apiKey);
            await page.locator('[data-save-api-connection]').click();

            await expectFrontendRequest(tracker, '/api/secrets/write');
            await expectFrontendRequest(tracker, '/api/settings/save');
            await expect(page.locator('[data-api-secret-status]')).toContainText('密钥已保存');

            await page.locator('[data-test-api]').click();
            await expectFrontendRequest(tracker, '/api/backends/chat-completions/generate');
            await expect(page.locator('.api-history-panel')).toContainText(modelName);
            await expect(page.locator('.api-history-panel')).toContainText(providerReply);
            await expect.poll(() => providerServer.requests.length).toBe(1);

            expect(providerServer.requests[0].body).toMatchObject({
                model: modelName,
                max_tokens: 20,
                stream: false,
            });
            expect(providerServer.requests[0].body.messages).toEqual([
                { role: 'user', content: '请只回复 OK。' },
            ]);
            expect(providerServer.requests[0].headers.authorization).toBe(`Bearer ${apiKey}`);
        } finally {
            await restoreSettings(page, settingsBefore);
            await deleteNewSecrets(page, 'api_key_custom', customSecretIdsBefore);
            if (providerServer) {
                await providerServer.close();
            }
        }
    });
});
