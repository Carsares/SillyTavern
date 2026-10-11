import { test, expect } from '@playwright/test';
import { createModernResourceFixture, mockBridgeFrame, mockModernWorkspace } from './modern-test-utils.js';
import {
    buildAuthorsNotePatch,
    countUserMessages,
    describeAuthorsNoteSchedule,
    getAuthorsNoteDefaults,
    parseAuthorsNoteDraft,
    resolveAuthorsNoteValues,
    toAuthorsNoteDraft,
} from '../public/modern/actions/chat-authors-note.js';

/* global document */

const desktopViewport = { width: 1440, height: 900 };

// ---------------------------------------------------------------------------------------------------------------------
// 纯函数：默认值、取值、校验、补丁、插入时间（对照旧版 public/scripts/authors-note.js）
// ---------------------------------------------------------------------------------------------------------------------

test.describe('Author\'s note helpers', () => {
    test('reads the global defaults and falls back to the legacy constants', () => {
        expect(getAuthorsNoteDefaults({})).toEqual({ prompt: '', interval: 1, position: 1, depth: 4, role: 0 });
        expect(getAuthorsNoteDefaults({
            extension_settings: { note: { default: 'D', defaultInterval: 3, defaultPosition: 2, defaultDepth: 9, defaultRole: 2 } },
        })).toEqual({ prompt: 'D', interval: 3, position: 2, depth: 9, role: 2 });
    });

    test('treats missing and null keys as unset, like the legacy ?? merge, and keeps explicit values', () => {
        const defaults = { prompt: 'D', interval: 1, position: 1, depth: 4, role: 0 };
        const resolved = resolveAuthorsNoteValues({ note_prompt: '', note_interval: 0, note_depth: null, note_position: 2 }, defaults);

        expect(resolved.values).toEqual({ prompt: '', interval: 0, position: 2, depth: 4, role: 0 });
        expect(resolved.isDefault).toEqual({ prompt: false, interval: false, position: false, depth: true, role: true });
        expect(resolveAuthorsNoteValues(undefined, defaults).isDefault).toEqual({ prompt: true, interval: true, position: true, depth: true, role: true });
    });

    test('validates the draft and ignores depth and role outside the in-chat position', () => {
        const fallback = { prompt: '', interval: 1, position: 1, depth: 4, role: 0 };
        const valid = parseAuthorsNoteDraft({ prompt: 'p', interval: '3', position: '1', depth: '6', role: '2' }, fallback);
        expect(valid).toMatchObject({ ok: true, values: { prompt: 'p', interval: 3, position: 1, depth: 6, role: 2 }, errors: {} });

        const invalid = parseAuthorsNoteDraft({ prompt: '', interval: '-1', position: '1', depth: '', role: '7' }, fallback);
        expect(invalid.ok).toBe(false);
        expect(Object.keys(invalid.errors).sort()).toEqual(['depth', 'interval', 'role']);

        const tooBig = parseAuthorsNoteDraft({ prompt: '', interval: '10000', position: '0', depth: 'abc', role: 'x' }, fallback);
        expect(Object.keys(tooBig.errors)).toEqual(['interval']);
        expect(tooBig.values).toMatchObject({ position: 0, depth: 4, role: 0 });

        expect(parseAuthorsNoteDraft({ prompt: '', interval: '1', position: '5', depth: '1', role: '1' }, fallback).errors).toEqual({ position: '请选择插入位置。' });
        expect(parseAuthorsNoteDraft({ prompt: '', interval: '1.5', position: '0', depth: '1', role: '1' }, fallback).errors).toHaveProperty('interval');
    });

    test('writes only the keys that changed', () => {
        const baseline = { prompt: 'D', interval: 1, position: 1, depth: 4, role: 0 };

        expect(buildAuthorsNotePatch(baseline, baseline)).toEqual({});
        expect(buildAuthorsNotePatch({ ...baseline, prompt: '', interval: 3 }, baseline)).toEqual({ prompt: '', interval: 3 });
        expect(toAuthorsNoteDraft(baseline)).toEqual({ prompt: 'D', interval: '1', position: '1', depth: '4', role: '0' });
    });

    test('counts only user messages', () => {
        expect(countUserMessages([{ is_user: true }, { is_user: false }, { is_user: true, is_system: true }, {}])).toBe(2);
        expect(countUserMessages(undefined)).toBe(0);
    });

    test('describes when the note is inserted next, following the legacy insertion rule', () => {
        expect(describeAuthorsNoteSchedule(0, 5)).toMatchObject({ kind: 'disabled' });
        expect(describeAuthorsNoteSchedule(1, 0)).toMatchObject({ kind: 'always' });
        // interval 3: the note goes in when the user-message count (including the one being sent) is a multiple of 3
        expect(describeAuthorsNoteSchedule(3, 0)).toMatchObject({ kind: 'pending', remaining: 3, text: '还有 3 条用户消息才插入。' });
        expect(describeAuthorsNoteSchedule(3, 1).remaining).toBe(2);
        expect(describeAuthorsNoteSchedule(3, 2).remaining).toBe(1);
        expect(describeAuthorsNoteSchedule(3, 3).remaining).toBe(3);
        expect(describeAuthorsNoteSchedule(3, 4).remaining).toBe(2);
        expect(describeAuthorsNoteSchedule(3, 5).remaining).toBe(1);
        expect(describeAuthorsNoteSchedule(5, 7).remaining).toBe(3);
        expect(describeAuthorsNoteSchedule(3, 2).detail).toBe('这个聊天已有 2 条用户消息，发出新的第 1 条时会带上作者注释。');
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 界面：聊天工具抽屉里的「作者注释」面板
// ---------------------------------------------------------------------------------------------------------------------

function fulfillJson(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

function postJson(route) {
    try {
        return route.request().postDataJSON();
    } catch {
        return {};
    }
}

function stripJsonlExtension(value) {
    return String(value || '').replace(/\.jsonl$/i, '');
}

function createDeferred() {
    /** @type {(value?: unknown) => void} */
    let resolve = () => {};
    const promise = new Promise(settle => {
        resolve = settle;
    });
    return { promise, resolve };
}

const defaultNote = {
    default: 'Default note text',
    chara: [],
    wiAddition: [],
    defaultInterval: 3,
    defaultDepth: 6,
    defaultPosition: 1,
    defaultRole: 1,
    allowWIScan: false,
};

function buildChatMessages(name) {
    const base = Date.now() - 60_000;
    const iso = offset => new Date(base + offset * 1000).toISOString();
    return [
        { name, is_user: false, is_system: false, send_date: iso(0), mes: 'Opening line.' },
        { name: 'Modern E2E User', is_user: true, is_system: false, send_date: iso(1), mes: 'first user message' },
        { name, is_user: false, is_system: false, send_date: iso(2), mes: 'first reply' },
        { name: 'Modern E2E User', is_user: true, is_system: false, send_date: iso(3), mes: 'second user message' },
        { name, is_user: false, is_system: false, send_date: iso(4), mes: 'second reply' },
    ];
}

function createNoteFixture({ metadata = {}, note = defaultNote } = {}) {
    const fixture = createModernResourceFixture();
    const now = Date.now();
    fixture.settings.extension_settings = { note: structuredClone(note) };
    fixture.chatLists = {
        'alice.png': [{ file_id: 'note-chat', file_name: 'note-chat.jsonl', chat_items: 5, file_size: '2 KB', last_mes: now }],
        'bruno.png': [],
    };
    fixture.groupChatList = [{ file_id: 'alpha-chat', file_name: 'alpha-chat.jsonl', chat_items: 5, file_size: '2 KB', last_mes: now }];
    fixture.files = {
        'note-chat': { metadata: { integrity: 'int-1', ...metadata }, messages: buildChatMessages('Alice Fixture'), saves: 0 },
        'alpha-chat': { metadata: { integrity: 'int-1' }, messages: buildChatMessages('Alpha Group'), saves: 0 },
    };
    fixture.chatSaves = [];
    fixture.failSave = null;
    return fixture;
}

async function mockNoteChatRoutes(page, fixture) {
    await mockModernWorkspace(page, fixture);
    await page.route('**/api/characters/chats', route => fulfillJson(route, fixture.chatLists[postJson(route).avatar_url] || []));
    await page.route('**/api/chats/search', route => fulfillJson(route, postJson(route).group_id ? fixture.groupChatList : []));
    await page.route('**/api/backups/chat/get', route => fulfillJson(route, []));

    const readChat = (route, chatId) => {
        const file = fixture.files[stripJsonlExtension(chatId)];
        return fulfillJson(route, [
            { chat_metadata: structuredClone(file.metadata), user_name: 'Modern E2E User', character_name: 'unused' },
            ...structuredClone(file.messages),
        ]);
    };
    // Saves check the revision like src/endpoints/chats.js: a header carrying an older integrity is rejected
    const saveChat = (route, chatId, chat, kind) => {
        const file = fixture.files[stripJsonlExtension(chatId)];
        const [header, ...messages] = chat;
        fixture.chatSaves.push({ kind, chatId, header: structuredClone(header), messages: structuredClone(messages) });
        if (fixture.failSave) {
            return fulfillJson(route, { error: fixture.failSave }, 500);
        }
        if (header.chat_metadata?.integrity !== file.metadata.integrity) {
            return fulfillJson(route, { error: 'integrity' });
        }
        file.saves += 1;
        file.metadata = { ...structuredClone(header.chat_metadata), integrity: `int-${file.saves + 1}` };
        file.messages = structuredClone(messages);
        return fulfillJson(route, { ok: true, integrity: file.metadata.integrity });
    };
    await page.route('**/api/chats/get', route => readChat(route, postJson(route).file_name));
    await page.route('**/api/chats/group/get', route => readChat(route, postJson(route).id));
    await page.route('**/api/chats/save', route => {
        const payload = postJson(route);
        return saveChat(route, payload.file_name, payload.chat, 'character');
    });
    await page.route('**/api/chats/group/save', route => {
        const payload = postJson(route);
        return saveChat(route, payload.id, payload.chat, 'group');
    });
}

async function openChat(page) {
    await page.goto('/modern/?view=chat');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'chat');
    await expect(page.locator('.page-title')).toHaveText('聊天工作区');
    await expect(page.locator('[data-delete-chat]')).toBeVisible();
}

async function openAuthorsNote(page) {
    await page.locator('.detail-actions [data-chat-tools-toggle]').click();
    await expect(page.locator('.chat-tools-drawer')).toBeVisible();
    await page.locator('[data-chat-tools-tab="authors-note"]').click();
    await expect(page.locator('[data-authors-note]')).toBeVisible();
}

const chatField = (page, field) => page.locator(`[data-an-scope="chat"][data-an-field="${field}"]`);
const chatSave = page => page.locator('[data-an-save="chat"]');
const messageBox = (page, kind) => page.locator(`[data-an-message="${kind}"]`);

test.describe('Author\'s note panel', () => {
    test.use({ viewport: desktopViewport });

    test('shows the global defaults for unset keys, marks them as default and counts down to the next insertion', async ({ page }) => {
        const fixture = createNoteFixture();
        await mockNoteChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openAuthorsNote(page);

        await expect(chatField(page, 'prompt')).toHaveValue('Default note text');
        await expect(chatField(page, 'interval')).toHaveValue('3');
        await expect(page.locator('input[name="an-position-chat"][value="1"]')).toBeChecked();
        await expect(chatField(page, 'depth')).toHaveValue('6');
        await expect(chatField(page, 'role')).toHaveValue('1');
        for (const field of ['prompt', 'interval', 'position', 'depth', 'role']) {
            await expect(page.locator(`.authors-note-form[data-an-scope="chat"] [data-an-chip="${field}"]`)).toBeVisible();
            await expect(page.locator(`.authors-note-form[data-an-scope="chat"] [data-an-chip="${field}"]`)).toHaveText('默认');
        }
        // two user messages, interval 3: the next user message is the third and gets the note
        await expect(page.locator('[data-an-schedule-text]')).toHaveText('还有 1 条用户消息才插入。');
        await expect(page.locator('[data-an-schedule-detail]')).toContainText('已有 2 条用户消息');
        await expect(page.locator('[data-an-dirty]')).toBeHidden();
    });

    test('shows no default marker for keys the chat file already holds', async ({ page }) => {
        const fixture = createNoteFixture({
            metadata: { note_prompt: 'Own note', note_interval: 0, note_position: 0, note_depth: 2, note_role: 2 },
        });
        await mockNoteChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openAuthorsNote(page);

        await expect(chatField(page, 'prompt')).toHaveValue('Own note');
        await expect(chatField(page, 'interval')).toHaveValue('0');
        await expect(page.locator('input[name="an-position-chat"][value="0"]')).toBeChecked();
        await expect(page.locator('[data-an-depth-group]')).toBeHidden();
        await expect(page.locator('[data-an-schedule-text]')).toHaveText('插入频率为 0，作者注释已关闭。');
        await expect(page.locator('.authors-note-form[data-an-scope="chat"] [data-an-chip]:visible')).toHaveCount(0);
    });

    test('updates the schedule and the depth fields while typing, without losing focus', async ({ page }) => {
        const fixture = createNoteFixture();
        await mockNoteChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openAuthorsNote(page);

        await chatField(page, 'interval').fill('4');
        await expect(page.locator('[data-an-schedule-text]')).toHaveText('还有 2 条用户消息才插入。');
        await expect(page.locator('[data-an-chip="interval"]')).toBeHidden();
        await expect(page.locator('[data-an-dirty]')).toBeVisible();
        await chatField(page, 'interval').fill('1');
        await expect(page.locator('[data-an-schedule-text]')).toHaveText('每次生成都会插入。');
        await chatField(page, 'interval').fill('');
        await expect(page.locator('[data-an-schedule-text]')).toHaveText('插入频率填入有效数字后显示下次插入时间。');

        await page.locator('input[name="an-position-chat"][value="0"]').check();
        await expect(page.locator('[data-an-depth-group]')).toBeHidden();
        await expect(page.locator('[data-an-chip="position"]')).toBeHidden();
        await page.locator('input[name="an-position-chat"][value="1"]').check();
        await expect(page.locator('[data-an-depth-group]')).toBeVisible();

        await chatField(page, 'prompt').click();
        await chatField(page, 'prompt').pressSequentially('abc');
        await expect(chatField(page, 'prompt')).toBeFocused();
        await expect(chatField(page, 'prompt')).toHaveValue('Default note textabc');
    });

    test('saves only the changed keys with the current integrity and waits for the engine to reopen the chat', async ({ page }) => {
        const fixture = createNoteFixture();
        await mockNoteChatRoutes(page, fixture);
        const reloadGate = createDeferred();
        const calls = await mockBridgeFrame(page, { replies: { reloadChat: () => reloadGate.promise } });
        await openChat(page);
        await openAuthorsNote(page);

        await chatField(page, 'prompt').fill('Keep the tone gentle.');
        await chatField(page, 'interval').fill('4');
        await chatSave(page).click();

        // saved to the file, but the engine has not confirmed yet: still saving, no success message
        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        await expect.poll(() => calls.filter(call => call.action === 'reloadChat').length).toBe(1);
        await expect(chatSave(page)).toBeDisabled();
        await expect(chatSave(page)).toContainText('保存中');
        await expect(messageBox(page, 'notice')).toBeHidden();

        reloadGate.resolve({ ok: true });
        await expect(messageBox(page, 'notice')).toBeVisible();
        await expect(messageBox(page, 'notice')).toContainText('生成引擎已同步');
        await expect(chatSave(page)).toBeEnabled();
        await expect(page.locator('[data-an-dirty]')).toBeHidden();

        const [save] = fixture.chatSaves;
        expect(save).toMatchObject({ kind: 'character', chatId: 'note-chat' });
        // unset keys stay unset (they keep following the defaults), and the revision of the file is carried
        expect(save.header.chat_metadata).toEqual({ integrity: 'int-1', note_prompt: 'Keep the tone gentle.', note_interval: 4 });
        expect(save.messages).toHaveLength(5);
        expect(fixture.files['note-chat'].metadata).toMatchObject({ integrity: 'int-2', note_prompt: 'Keep the tone gentle.', note_interval: 4 });
        expect(calls.find(call => call.action === 'reloadChat').payload).toEqual({ avatar: 'alice.png', chat: 'note-chat' });

        // the saved keys lost their default marker, the others keep it
        await expect(page.locator('[data-an-chip="prompt"]')).toBeHidden();
        await expect(page.locator('[data-an-chip="interval"]')).toBeHidden();
        await expect(page.locator('[data-an-chip="position"]')).toBeVisible();
        await expect(page.locator('[data-an-schedule-text]')).toHaveText('还有 2 条用户消息才插入。');

        // a second save is accepted only because the revision issued by the first one was stored
        await page.locator('input[name="an-position-chat"][value="2"]').check();
        await chatSave(page).click();
        await expect(messageBox(page, 'notice')).toBeVisible();
        expect(fixture.chatSaves).toHaveLength(2);
        expect(fixture.chatSaves[1].header.chat_metadata).toEqual({
            integrity: 'int-2',
            note_prompt: 'Keep the tone gentle.',
            note_interval: 4,
            note_position: 2,
        });
        expect(fixture.files['note-chat'].metadata.integrity).toBe('int-3');
    });

    test('keeps what was typed when the panel is rendered again', async ({ page }) => {
        const fixture = createNoteFixture();
        await mockNoteChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openAuthorsNote(page);

        await chatField(page, 'prompt').fill('Unsaved draft.');
        await page.locator('[data-an-section="default"]').click();
        await expect(page.locator('.authors-note-form[data-an-scope="default"]')).toBeVisible();
        await page.locator('[data-an-section="chat"]').click();

        await expect(chatField(page, 'prompt')).toHaveValue('Unsaved draft.');
        await expect(page.locator('[data-an-dirty]')).toBeVisible();
        await page.locator('[data-an-reset="chat"]').click();
        await expect(chatField(page, 'prompt')).toHaveValue('Default note text');
        await expect(page.locator('[data-an-dirty]')).toBeHidden();
        expect(fixture.chatSaves).toHaveLength(0);
    });

    test('shows a clear warning when the file was saved but the engine could not reopen the chat', async ({ page }) => {
        const fixture = createNoteFixture();
        await mockNoteChatRoutes(page, fixture);
        await mockBridgeFrame(page, { replies: { reloadChat: () => { throw new Error('engine offline'); } } });
        await openChat(page);
        await openAuthorsNote(page);

        await chatField(page, 'prompt').fill('Saved anyway.');
        await chatSave(page).click();

        await expect(messageBox(page, 'warning')).toBeVisible();
        await expect(messageBox(page, 'warning')).toContainText('已保存到聊天文件');
        await expect(messageBox(page, 'warning')).toContainText('生成引擎没有同步成功');
        await expect(messageBox(page, 'warning')).toContainText('engine offline');
        await expect(messageBox(page, 'notice')).toBeHidden();
        await expect(messageBox(page, 'error')).toBeHidden();
        expect(fixture.files['note-chat'].metadata.note_prompt).toBe('Saved anyway.');
        // the panel now reflects the saved value, so the file and the form agree
        await expect(chatField(page, 'prompt')).toHaveValue('Saved anyway.');
        await expect(page.locator('[data-an-dirty]')).toBeHidden();
    });

    test('shows the failure and keeps the draft when the chat file cannot be saved', async ({ page }) => {
        const fixture = createNoteFixture();
        fixture.failSave = 'disk full';
        await mockNoteChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page);
        await openChat(page);
        await openAuthorsNote(page);

        await chatField(page, 'prompt').fill('Will not be saved.');
        await chatSave(page).click();

        await expect(messageBox(page, 'error')).toBeVisible();
        await expect(messageBox(page, 'error')).toContainText('保存失败');
        await expect(chatField(page, 'prompt')).toHaveValue('Will not be saved.');
        await expect(page.locator('[data-an-dirty]')).toBeVisible();
        expect(calls.map(call => call.action)).not.toContain('reloadChat');
        await expect(chatSave(page)).toBeEnabled();
    });

    test('rejects invalid numbers without sending anything', async ({ page }) => {
        const fixture = createNoteFixture();
        await mockNoteChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openAuthorsNote(page);

        await chatField(page, 'interval').fill('10000');
        await chatField(page, 'depth').fill('-2');
        await chatSave(page).click();

        await expect(page.locator('[data-an-error="interval"]')).toContainText('0 到 9999');
        await expect(page.locator('[data-an-error="depth"]')).toContainText('0 到 9999');
        expect(fixture.chatSaves).toHaveLength(0);

        // fixing a field clears its message right away; depth does not matter outside the in-chat position
        await chatField(page, 'interval').fill('2');
        await expect(page.locator('[data-an-error="interval"]')).toBeHidden();
        await page.locator('input[name="an-position-chat"][value="0"]').check();
        await chatSave(page).click();
        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        expect(fixture.chatSaves[0].header.chat_metadata).toEqual({ integrity: 'int-1', note_interval: 2, note_position: 0 });
    });

    test('cannot be saved while a reply is being generated', async ({ page }) => {
        const fixture = createNoteFixture();
        await mockNoteChatRoutes(page, fixture);
        const generateGate = createDeferred();
        const calls = await mockBridgeFrame(page, {
            replies: { generate: async ({ chat }) => (await generateGate.promise, { chat: `${stripJsonlExtension(chat)}.jsonl`, messageCount: 5, saved: true }) },
        });
        await openChat(page);

        await page.locator('[data-chat-input]').fill('please answer');
        await page.locator('[data-send-message]').click();
        await expect.poll(() => calls.filter(call => call.action === 'generate').length).toBe(1);

        await openAuthorsNote(page);
        await chatField(page, 'prompt').fill('Edited during generation.');
        await expect(chatSave(page)).toBeDisabled();
        await expect(page.locator('.authors-note-form[data-an-scope="chat"]')).toContainText('正在生成');
        // typing is still possible, and the draft survives until generation ends
        await expect(page.locator('[data-an-dirty]')).toBeVisible();
        expect(fixture.chatSaves).toHaveLength(0);

        generateGate.resolve();
        await expect(chatSave(page)).toBeEnabled();
        await expect(chatField(page, 'prompt')).toHaveValue('Edited during generation.');
        await chatSave(page).click();
        await expect(messageBox(page, 'notice')).toBeVisible();
        expect(fixture.chatSaves).toHaveLength(1);
    });

    test('works in a group chat and disables the character note there', async ({ page }) => {
        const fixture = createNoteFixture();
        await mockNoteChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page);
        await openChat(page);

        await page.locator('[data-chat-mode="group"]').click();
        await expect(page.locator('.detail-title')).toHaveText('Alpha Group');
        await page.locator('[data-select-chat="alpha-chat"]').click();
        await expect(page.locator('.chat-thread')).toContainText('second reply');
        await openAuthorsNote(page);

        await chatField(page, 'prompt').fill('Group-wide note.');
        await chatSave(page).click();
        await expect(messageBox(page, 'notice')).toBeVisible();

        expect(fixture.chatSaves).toHaveLength(1);
        expect(fixture.chatSaves[0]).toMatchObject({ kind: 'group', chatId: 'alpha-chat' });
        expect(fixture.chatSaves[0].header.chat_metadata).toEqual({ integrity: 'int-1', note_prompt: 'Group-wide note.' });
        expect(calls.find(call => call.action === 'reloadChat').payload).toEqual({ groupId: 'group-alpha', chat: 'alpha-chat' });

        await page.locator('[data-an-section="chara"]').click();
        await expect(page.locator('.authors-note-unavailable')).toContainText('群聊里不能编辑角色注释');
        await expect(page.locator('.authors-note-form[data-an-scope="chara"]')).toHaveCount(0);
        await expect(page.locator('[data-an-save="chara"]')).toHaveCount(0);
    });

    test('saves and removes the character note through the settings file', async ({ page }) => {
        const fixture = createNoteFixture({
            note: { ...defaultNote, chara: [{ name: 'bruno', prompt: 'Bruno note', useChara: false, position: 0 }] },
        });
        await mockNoteChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page);
        await openChat(page);
        await openAuthorsNote(page);

        await page.locator('[data-an-section="chara"]').click();
        await expect(page.locator('.authors-note-form[data-an-scope="chara"]')).toContainText('Alice Fixture');
        await expect(page.locator('[data-an-scope="chara"][data-an-field="prompt"]')).toHaveValue('');

        // "use" needs a note to use
        await page.locator('[data-an-scope="chara"][data-an-field="useChara"]').check();
        await page.locator('[data-an-save="chara"]').click();
        await expect(page.locator('[data-an-error="prompt"]')).toContainText('需要填写内容');
        expect(fixture.requests.settingsSave).toHaveLength(0);

        await page.locator('[data-an-scope="chara"][data-an-field="prompt"]').fill('Be dramatic.');
        await page.locator('input[name="an-position-chara"][value="1"]').check();
        await page.locator('[data-an-save="chara"]').click();
        await expect(messageBox(page, 'notice')).toContainText('角色注释已保存');

        expect(fixture.requests.settingsSave).toHaveLength(1);
        expect(fixture.requests.settingsSave[0].extension_settings.note.chara).toEqual([
            { name: 'bruno', prompt: 'Bruno note', useChara: false, position: 0 },
            { name: 'alice', prompt: 'Be dramatic.', useChara: true, position: 1 },
        ]);
        expect(fixture.requests.settingsSave[0].extension_settings.note.default).toBe('Default note text');
        expect(calls.map(call => call.action)).toContain('reloadSettings');
        expect(calls.map(call => call.action)).not.toContain('reloadChat');
        expect(fixture.chatSaves).toHaveLength(0);

        // clearing the text and the checkbox removes the entry, like the legacy panel does
        await page.locator('[data-an-scope="chara"][data-an-field="prompt"]').fill('');
        await page.locator('[data-an-scope="chara"][data-an-field="useChara"]').uncheck();
        await page.locator('[data-an-save="chara"]').click();
        await expect.poll(() => fixture.requests.settingsSave.length).toBe(2);
        expect(fixture.requests.settingsSave[1].extension_settings.note.chara).toEqual([
            { name: 'bruno', prompt: 'Bruno note', useChara: false, position: 0 },
        ]);
    });

    test('saves the default note, then lets the engine reopen the chat so it reads the new defaults', async ({ page }) => {
        const fixture = createNoteFixture();
        await mockNoteChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page);
        await openChat(page);
        await openAuthorsNote(page);

        await page.locator('[data-an-section="default"]').click();
        const defaultField = field => page.locator(`[data-an-scope="default"][data-an-field="${field}"]`);
        await expect(defaultField('prompt')).toHaveValue('Default note text');
        await expect(defaultField('interval')).toHaveValue('3');
        await expect(page.locator('input[name="an-position-default"][value="1"]')).toBeChecked();
        await expect(defaultField('allowWIScan')).not.toBeChecked();

        await defaultField('prompt').fill('New default note');
        await defaultField('interval').fill('5');
        await page.locator('input[name="an-position-default"][value="2"]').check();
        await defaultField('allowWIScan').check();
        const callsBefore = calls.length;
        await page.locator('[data-an-save="default"]').click();
        await expect(messageBox(page, 'notice')).toContainText('默认值已保存');

        expect(fixture.requests.settingsSave).toHaveLength(1);
        expect(fixture.requests.settingsSave[0].extension_settings.note).toEqual({
            default: 'New default note',
            chara: [],
            wiAddition: [],
            defaultInterval: 5,
            defaultDepth: 6,
            defaultPosition: 2,
            defaultRole: 1,
            allowWIScan: true,
        });
        // the engine applies defaults to a chat header only when it opens the chat: settings first, then the chat
        expect(calls.slice(callsBefore).map(call => call.action)).toEqual(['reloadSettings', 'reloadChat']);
        expect(calls.at(-1).payload).toEqual({ avatar: 'alice.png', chat: 'note-chat' });
        // the chat file itself is not touched
        expect(fixture.chatSaves).toHaveLength(0);

        // keys the chat never set now follow the new defaults
        await page.locator('[data-an-section="chat"]').click();
        await expect(chatField(page, 'prompt')).toHaveValue('New default note');
        await expect(chatField(page, 'interval')).toHaveValue('5');
        await expect(page.locator('input[name="an-position-chat"][value="2"]')).toBeChecked();
        await expect(page.locator('[data-an-chip="interval"]')).toBeVisible();
    });

    test('keeps the old defaults and does not touch the engine when the settings file cannot be saved', async ({ page }) => {
        const fixture = createNoteFixture();
        await mockNoteChatRoutes(page, fixture);
        await page.route('**/api/settings/save', route => route.fulfill({ status: 500, contentType: 'text/plain', body: 'settings disk full' }));
        const calls = await mockBridgeFrame(page);
        await openChat(page);
        await openAuthorsNote(page);

        await page.locator('[data-an-section="default"]').click();
        await page.locator('[data-an-scope="default"][data-an-field="interval"]').fill('9');
        await page.locator('[data-an-save="default"]').click();

        await expect(messageBox(page, 'error')).toContainText('保存失败');
        await expect(page.locator('[data-an-scope="default"][data-an-field="interval"]')).toHaveValue('9');
        expect(calls.map(call => call.action)).not.toContain('reloadSettings');
        expect(calls.map(call => call.action)).not.toContain('reloadChat');

        // the in-memory defaults were rolled back: the chat tab still shows the old interval
        await page.locator('[data-an-section="chat"]').click();
        await expect(chatField(page, 'interval')).toHaveValue('3');
        await page.locator('[data-an-section="default"]').click();
        await page.locator('[data-an-reset="default"]').click();
        await expect(page.locator('[data-an-scope="default"][data-an-field="interval"]')).toHaveValue('3');
    });

    test('adds a tools button only when a chat is selected', async ({ page }) => {
        const fixture = createNoteFixture();
        fixture.chatLists['alice.png'] = [];
        await mockNoteChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await page.goto('/modern/?view=chat');
        await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
        await expect(page.locator('.page-title')).toHaveText('聊天工作区');

        await expect(page.locator('[data-chat-tools-toggle]')).toHaveCount(0);
        await expect(page.locator('[data-authors-note]')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.querySelectorAll('[data-chat-tools-tab="authors-note"]').length)).toBe(0);
    });
});
