import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
import { gotoModern } from './modern-test-utils.js';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8000';
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

    test('manages character chat files and messages from the UI against the real backend', async ({ page }) => {
        const tracker = trackApiRequests(page);
        const characterName = uniqueName('ChatCharacter');
        const importedMessage = `${characterName} imported message`;
        let avatar = '';

        try {
            avatar = await createCharacter(page, characterName);
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
            await deleteCharacterByName(page, characterName);
            if (avatar) {
                await safeApiFetch(page, '/api/characters/delete', { avatar_url: avatar, delete_chats: true });
            }
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
});
