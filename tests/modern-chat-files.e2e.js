import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';

function stripJsonlExtension(value) {
    return String(value || '').replace(/\.jsonl$/i, '');
}

function chatFileName(chatId) {
    return `${stripJsonlExtension(chatId)}.jsonl`;
}

function multipartFieldValue(bodyText, fieldName) {
    const match = new RegExp(`name="${fieldName}"\\r?\\n\\r?\\n([^\\r\\n]*)`).exec(bodyText);
    return match?.[1]?.trim() || '';
}

function multipartFileName(bodyText, fieldName) {
    const match = new RegExp(`name="${fieldName}"; filename="([^"]+)"`).exec(bodyText);
    return match?.[1]?.trim() || '';
}

function createChatFixture() {
    const now = Date.now();
    return {
        character: {
            avatar: 'mock.png',
            name: 'Mock Character',
            data: {
                name: 'Mock Character',
                first_mes: 'Hello {{user}}.',
                creator: 'Modern E2E',
            },
        },
        chats: [
            { file_id: 'existing-chat', file_name: 'existing-chat.jsonl', chat_items: 2, file_size: '1 KB', last_mes: now },
        ],
        messagesByChat: {
            'existing-chat': [
                { name: 'Modern User', is_user: true, mes: 'hello', send_date: now - 1000 },
                { name: 'Mock Character', is_user: false, mes: 'reply', send_date: now },
            ],
        },
        backups: [
            { file_id: 'backup-chat', file_name: 'backup-chat.jsonl', chat_items: 2, file_size: '2 KB', last_mes: now },
        ],
        requests: {
            saves: [],
            renames: [],
            deletes: [],
            imports: [],
            exports: [],
            backupDownloads: [],
            backupDeletes: [],
        },
    };
}

function upsertChat(fixture, chatId, messages) {
    const fileName = chatFileName(chatId);
    const item = {
        file_id: stripJsonlExtension(chatId),
        file_name: fileName,
        chat_items: messages.length,
        file_size: `${Math.max(messages.length, 1)} KB`,
        last_mes: Date.now(),
    };
    fixture.messagesByChat[item.file_id] = messages;
    fixture.chats = [
        item,
        ...fixture.chats.filter(chat => stripJsonlExtension(chat.file_id || chat.file_name) !== item.file_id),
    ];
}

function chatResponse(fixture, chatId) {
    return [
        { chat_metadata: {}, user_name: 'Modern User', character_name: fixture.character.name },
        ...(fixture.messagesByChat[stripJsonlExtension(chatId)] || []),
    ];
}

function fulfillJson(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

async function mockModernChatWorkspace(page, fixture = createChatFixture()) {
    await page.route('**/csrf-token', route => fulfillJson(route, { token: 'modern-chat-files-token' }));
    await page.route('**/api/users/me', route => fulfillJson(route, { name: 'Modern User', handle: 'modern-user' }));
    await page.route('**/api/settings/get', route => fulfillJson(route, {
        settings: JSON.stringify({
            name1: 'Modern User',
        }),
        openai_setting_names: [],
        openai_settings: [],
        textgenerationwebui_preset_names: [],
        textgenerationwebui_presets: [],
    }));
    await page.route('**/api/characters/all', route => fulfillJson(route, [fixture.character]));
    await page.route('**/api/groups/all', route => fulfillJson(route, []));
    await page.route('**/api/worldinfo/list', route => fulfillJson(route, []));
    await page.route('**/api/backgrounds/all', route => fulfillJson(route, { images: [] }));
    await page.route('**/api/backgrounds/folders', route => fulfillJson(route, { folders: [], imageFolderMap: {} }));
    await page.route('**/api/assets/get', route => fulfillJson(route, {}));
    await page.route('**/api/extensions/discover', route => fulfillJson(route, []));
    await page.route('**/api/secrets/settings', route => fulfillJson(route, { allowKeysExposure: false }));
    await page.route('**/api/secrets/read', route => fulfillJson(route, {}));
    await page.route('**/api/stats/get', route => fulfillJson(route, {}));
    await page.route('**/api/characters/chats', route => fulfillJson(route, fixture.chats));
    await page.route('**/api/chats/get', route => {
        const payload = route.request().postDataJSON();
        return fulfillJson(route, chatResponse(fixture, payload.file_name));
    });
    await page.route('**/api/chats/save', route => {
        const payload = route.request().postDataJSON();
        fixture.requests.saves.push(payload);
        upsertChat(fixture, payload.file_name, payload.chat.filter(message => !message.chat_metadata));
        return fulfillJson(route, { ok: true });
    });
    await page.route('**/api/chats/rename', route => {
        const payload = route.request().postDataJSON();
        const oldId = stripJsonlExtension(payload.original_file);
        const newId = stripJsonlExtension(payload.renamed_file);
        fixture.requests.renames.push(payload);
        const messages = fixture.messagesByChat[oldId] || [];
        delete fixture.messagesByChat[oldId];
        fixture.messagesByChat[newId] = messages;
        fixture.chats = fixture.chats.map(chat => {
            const chatId = stripJsonlExtension(chat.file_id || chat.file_name);
            return chatId === oldId ? { ...chat, file_id: newId, file_name: chatFileName(newId) } : chat;
        });
        return fulfillJson(route, { sanitizedFileName: newId });
    });
    await page.route('**/api/chats/delete', route => {
        const payload = route.request().postDataJSON();
        const chatId = stripJsonlExtension(payload.chatfile);
        fixture.requests.deletes.push(payload);
        fixture.chats = fixture.chats.filter(chat => stripJsonlExtension(chat.file_id || chat.file_name) !== chatId);
        delete fixture.messagesByChat[chatId];
        return fulfillJson(route, { ok: true });
    });
    await page.route('**/api/chats/import', route => {
        const bodyText = route.request().postData() || '';
        const fileName = multipartFileName(bodyText, 'avatar');
        const chatId = stripJsonlExtension(fileName);
        fixture.requests.imports.push({
            bodyText,
            contentType: route.request().headers()['content-type'] || '',
            fileName,
            fileType: multipartFieldValue(bodyText, 'file_type'),
            avatarUrl: multipartFieldValue(bodyText, 'avatar_url'),
            userName: multipartFieldValue(bodyText, 'user_name'),
            characterName: multipartFieldValue(bodyText, 'character_name'),
        });
        upsertChat(fixture, chatId, [
            { name: 'Modern User', is_user: true, mes: `imported ${chatId}`, send_date: Date.now() },
        ]);
        return fulfillJson(route, { fileNames: [chatFileName(chatId)] });
    });
    await page.route('**/api/chats/export', route => {
        const payload = route.request().postDataJSON();
        fixture.requests.exports.push(payload);
        return fulfillJson(route, { result: `exported ${payload.file} as ${payload.format}` });
    });
    await page.route('**/api/backups/chat/get', route => fulfillJson(route, fixture.backups));
    await page.route('**/api/backups/chat/download', route => {
        const payload = route.request().postDataJSON();
        fixture.requests.backupDownloads.push(payload);
        return route.fulfill({
            status: 200,
            contentType: 'application/jsonl',
            body: [
                JSON.stringify({ name: 'Modern User', is_user: true, mes: 'backup hello', send_date: Date.now() - 1000 }),
                JSON.stringify({ name: 'Mock Character', is_user: false, mes: 'backup reply', send_date: Date.now() }),
            ].join('\n'),
        });
    });
    await page.route('**/api/backups/chat/delete', route => {
        const payload = route.request().postDataJSON();
        fixture.requests.backupDeletes.push(payload);
        fixture.backups = fixture.backups.filter(backup => backup.file_name !== payload.name);
        return fulfillJson(route, { ok: true });
    });

    return fixture;
}

test.describe('Modern chat files', () => {
    test('manages character chat files and backups inside the modern workspace', async ({ page }) => {
        const fixture = await mockModernChatWorkspace(page);

        await page.goto('/modern/?view=chat');

        await expect(page.locator('.page-title')).toHaveText('聊天工作区');
        await expect(page.locator('[data-select-chat="existing-chat"]')).toBeVisible();
        await expect(page.locator('.detail-title')).toHaveText('Mock Character');
        await expect(page.locator('[data-send-message]')).toBeDisabled();
        await expect(page.locator('[data-composer-status]')).toContainText('空消息不会提交');

        await page.locator('[data-chat-input]').fill('hello modern composer');
        await expect(page.locator('[data-send-message]')).toBeEnabled();
        await expect(page.locator('[data-composer-status]')).toContainText('准备发送');
        await page.locator('[data-chat-input]').fill('');
        await expect(page.locator('[data-send-message]')).toBeDisabled();

        await page.locator('[data-new-chat]').click();
        await expect.poll(() => fixture.requests.saves.length).toBe(1);
        const createdChatId = fixture.requests.saves[0].file_name;
        await expect(page.locator('[data-select-chat]').filter({ hasText: chatFileName(createdChatId) })).toBeVisible();

        await page.locator('[data-rename-chat]').click();
        await page.locator('[data-chat-rename-input]').fill('renamed-modern-chat');
        await page.locator('[data-save-chat-rename]').click();

        await expect.poll(() => fixture.requests.renames.length).toBe(1);
        expect(fixture.requests.renames[0]).toMatchObject({
            avatar_url: 'mock.png',
            original_file: chatFileName(createdChatId),
            renamed_file: 'renamed-modern-chat.jsonl',
            is_group: false,
        });
        await expect(page.locator('[data-select-chat="renamed-modern-chat"]')).toBeVisible();

        const txtDownloadPromise = page.waitForEvent('download');
        await page.locator('[data-export-chat="txt"]').click();
        const txtDownload = await txtDownloadPromise;
        expect(txtDownload.suggestedFilename()).toBe('renamed-modern-chat.txt');
        expect(fixture.requests.exports[0]).toMatchObject({
            is_group: false,
            avatar_url: 'mock.png',
            file: 'renamed-modern-chat.jsonl',
            exportfilename: 'renamed-modern-chat.txt',
            format: 'txt',
        });

        const jsonlDownloadPromise = page.waitForEvent('download');
        await page.locator('[data-export-chat="jsonl"]').click();
        const jsonlDownload = await jsonlDownloadPromise;
        expect(jsonlDownload.suggestedFilename()).toBe('renamed-modern-chat.jsonl');
        expect(fixture.requests.exports[1]).toMatchObject({
            file: 'renamed-modern-chat.jsonl',
            exportfilename: 'renamed-modern-chat.jsonl',
            format: 'jsonl',
        });

        await page.locator('[data-delete-chat]').click();
        await expect(page.locator('.danger-panel', { hasText: '删除聊天文件' })).toBeVisible();
        await page.locator('[data-cancel-chat-delete]').click();
        await expect(page.locator('.danger-panel', { hasText: '删除聊天文件' })).toHaveCount(0);
        expect(fixture.requests.deletes).toHaveLength(0);

        await page.locator('[data-delete-chat]').click();
        await page.locator('[data-confirm-chat-delete]').click();
        await expect.poll(() => fixture.requests.deletes.length).toBe(1);
        expect(fixture.requests.deletes[0]).toMatchObject({
            avatar_url: 'mock.png',
            chatfile: 'renamed-modern-chat.jsonl',
        });
        await expect(page.locator('[data-select-chat="renamed-modern-chat"]')).toHaveCount(0);

        await page.locator('[data-chat-import-file]').setInputFiles({
            name: 'imported-modern-chat.jsonl',
            mimeType: 'application/jsonl',
            buffer: Buffer.from(JSON.stringify({ name: 'Modern User', mes: 'Imported hello' })),
        });

        await expect.poll(() => fixture.requests.imports.length).toBe(1);
        expect(fixture.requests.imports[0]).toMatchObject({
            fileName: 'imported-modern-chat.jsonl',
            fileType: 'jsonl',
            avatarUrl: 'mock.png',
            userName: 'Modern User',
            characterName: 'Mock Character',
        });
        expect(fixture.requests.imports[0].contentType).toContain('multipart/form-data');
        await expect(page.locator('[data-select-chat="imported-modern-chat"]')).toBeVisible();
        await expect(page.locator('.message')).toContainText('imported imported-modern-chat');

        await page.locator('[data-chat-backups-toggle]').click();
        await expect(page.locator('.chat-tool-panel')).toBeVisible();
        await expect(page.locator('.backup-row', { hasText: 'backup-chat.jsonl' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.chat-tool-panel')).toHaveCount(0);

        await page.locator('[data-chat-backups-toggle]').click();
        await expect(page.locator('.chat-tool-panel')).toBeVisible();
        await expect(page.locator('.backup-row', { hasText: 'backup-chat.jsonl' })).toBeVisible();

        await page.locator('[data-view-chat-backup="backup-chat.jsonl"]').click();
        await expect.poll(() => fixture.requests.backupDownloads.length).toBe(1);
        await expect(page.locator('.backup-preview textarea')).toContainText('backup reply');

        await page.locator('[data-restore-chat-backup="backup-chat.jsonl"]').click();
        await expect.poll(() => fixture.requests.imports.length).toBe(2);
        expect(fixture.requests.backupDownloads).toHaveLength(2);
        expect(fixture.requests.imports[1]).toMatchObject({
            fileName: 'backup-chat.jsonl',
            fileType: 'jsonl',
            avatarUrl: 'mock.png',
        });
        await expect(page.locator('[data-select-chat="backup-chat"]')).toBeVisible();

        await page.locator('[data-delete-chat-backup="backup-chat.jsonl"]').click();
        await page.locator('[data-confirm-chat-backup-delete]').click();
        await expect.poll(() => fixture.requests.backupDeletes.length).toBe(1);
        expect(fixture.requests.backupDeletes[0]).toEqual({ name: 'backup-chat.jsonl' });
        await expect(page.locator('.backup-row', { hasText: 'backup-chat.jsonl' })).toHaveCount(0);
    });
});
