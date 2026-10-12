import { test, expect } from '@playwright/test';
import { createModernResourceFixture, gotoModern, mockBridgeFrame, mockModernWorkspace } from './modern-test-utils.js';
import { createSourceSignature } from '../public/modern/core/translation.js';

/* global localStorage */

// 翻译（B3）：聊天消息译文、编辑已翻译消息、角色卡翻译进草稿、设置页。
// 所有 /api/translate/* 请求都由测试替身回答，不访问任何真实翻译服务。

const desktopViewport = { width: 1440, height: 900 };
const ACK_KEY = 'st-modern-translate-privacy-ack';

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

// 已确认过隐私提示的服务（浏览器本地记录）；不预先写入时，第一次翻译会先弹出确认
async function acknowledgePrivacy(page, providers = ['google']) {
    await page.addInitScript(([key, value]) => {
        localStorage.setItem(key, JSON.stringify(value));
    }, [ACK_KEY, providers]);
}

/**
 * 翻译接口的替身：reply(body) 返回 { text } 得到 200 text/plain，返回 { status, json } 得到失败响应。
 * 请求体记录在 fixture.translateRequests。
 */
async function mockTranslateRoutes(page, fixture, providers = ['google']) {
    fixture.translateRequests = [];
    fixture.translateReply ??= body => ({ text: `译文：${body.text}` });
    for (const provider of providers) {
        await page.route(`**/api/translate/${provider}`, route => {
            const body = postJson(route);
            fixture.translateRequests.push({ provider, ...body });
            const reply = fixture.translateReply(body, provider);
            if (reply.status) {
                return fulfillJson(route, reply.json ?? {}, reply.status);
            }
            return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: reply.text });
        });
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// 聊天
// ---------------------------------------------------------------------------------------------------------------------

const ORIGINAL_REPLY = 'Hello {{user}}, the answer is 42.';

function buildChatMessages(extraForReply = { reasoning: 'Let me think about it.' }) {
    const base = Date.now() - 60_000;
    const iso = offset => new Date(base + offset * 1000).toISOString();
    return [
        { name: 'Alice Fixture', is_user: false, is_system: false, send_date: iso(0), mes: 'Opening line.' },
        { name: 'Modern E2E User', is_user: true, is_system: false, send_date: iso(1), mes: 'hello' },
        { name: 'Alice Fixture', is_user: false, is_system: false, send_date: iso(2), mes: ORIGINAL_REPLY, extra: structuredClone(extraForReply) },
    ];
}

function buildTranslatedMessages() {
    const messages = buildChatMessages({});
    messages[2].extra = { display_text: '译文：你好。', display_text_src: createSourceSignature(ORIGINAL_REPLY), display_text_lang: 'zh-CN' };
    return messages;
}

function createChatFixture({ messages = buildChatMessages(), settings = {} } = {}) {
    const fixture = createModernResourceFixture();
    const now = Date.now();
    // manual machine translation unless a test asks otherwise: the opening line is English and would be translated on its own
    fixture.settings.extension_settings = { translate: { mode: 'machine', target_language: 'zh-CN', provider: 'google', auto_greeting: false, ...settings } };
    fixture.chatLists = {
        'alice.png': [{ file_id: 'tr-chat', file_name: 'tr-chat.jsonl', chat_items: messages.length, file_size: '2 KB', last_mes: now }],
        'bruno.png': [],
    };
    fixture.groupChatList = [];
    fixture.files = { 'tr-chat': { metadata: { integrity: 'int-1' }, messages: structuredClone(messages), saves: 0 } };
    fixture.chatSaves = [];
    return fixture;
}

async function mockChatRoutes(page, fixture) {
    await mockModernWorkspace(page, fixture);
    await page.route('**/api/characters/chats', route => fulfillJson(route, fixture.chatLists[postJson(route).avatar_url] || []));
    await page.route('**/api/chats/search', route => fulfillJson(route, []));
    await page.route('**/api/backups/chat/get', route => fulfillJson(route, []));
    await page.route('**/api/chats/get', route => {
        const file = fixture.files[stripJsonlExtension(postJson(route).file_name)];
        return fulfillJson(route, [
            { chat_metadata: structuredClone(file.metadata), user_name: 'Modern E2E User', character_name: 'unused' },
            ...structuredClone(file.messages),
        ]);
    });
    await page.route('**/api/chats/save', route => {
        const payload = postJson(route);
        const file = fixture.files[stripJsonlExtension(payload.file_name)];
        const [header, ...messages] = payload.chat;
        fixture.chatSaves.push({ chatId: payload.file_name, header: structuredClone(header), messages: structuredClone(messages) });
        if (header.chat_metadata?.integrity !== file.metadata.integrity) {
            return fulfillJson(route, { error: 'integrity' });
        }
        file.saves += 1;
        file.metadata = { ...structuredClone(header.chat_metadata), integrity: `int-${file.saves + 1}` };
        file.messages = structuredClone(messages);
        return fulfillJson(route, { ok: true, integrity: file.metadata.integrity });
    });
}

async function openChat(page) {
    await page.goto('/modern/?view=chat');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'chat');
    await expect(page.locator('.page-title')).toHaveText('聊天工作区');
    await expect(page.locator('[data-delete-chat]')).toBeVisible();
    await expect(page.locator('.message')).toHaveCount(3);
}

const reply = page => page.locator('.message').nth(2);
const savedReply = fixture => fixture.files['tr-chat'].messages[2];

test.describe('Chat message translation', () => {
    test.use({ viewport: desktopViewport });

    test('asks for the privacy confirmation, stores display_text without touching mes, toggles without saving and clears', async ({ page }) => {
        const fixture = createChatFixture();
        await mockTranslateRoutes(page, fixture);
        await mockChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page);
        await openChat(page);

        await expect(page.locator('.message-summary-marker')).toHaveCount(0);

        // only character replies get a translate button
        await expect(page.locator('.message').nth(1).locator('[data-translate-message]')).toHaveCount(0);
        await expect(reply(page).locator('[data-translate-message]')).toBeEnabled();

        // first use of the provider: confirm first, nothing is sent
        await reply(page).locator('[data-translate-message]').click();
        const confirm = reply(page).locator('[data-message-translation="confirm"]');
        await expect(confirm).toBeVisible();
        await expect(confirm).toContainText('第三方翻译服务');
        await expect(confirm).toContainText('不会改动原文');
        expect(fixture.translateRequests).toHaveLength(0);
        expect(fixture.chatSaves).toHaveLength(0);

        await confirm.locator('[data-cancel-message-translation]').click();
        await expect(confirm).toHaveCount(0);
        expect(fixture.translateRequests).toHaveLength(0);

        await reply(page).locator('[data-translate-message]').click();
        await reply(page).locator('[data-confirm-message-translation]').click();
        await expect(reply(page).locator('[data-message-translation="ready"]')).toBeVisible();

        // the macro never left the browser, the reasoning was translated too
        expect(fixture.translateRequests.map(request => request.text)).toEqual(['Hello [[1]], the answer is 42.', 'Let me think about it.']);
        expect(fixture.translateRequests.every(request => request.lang === 'zh-CN')).toBe(true);

        // the file got display_text next to the untouched original; one save, one engine reload
        expect(fixture.chatSaves).toHaveLength(1);
        expect(savedReply(fixture)).toMatchObject({
            mes: ORIGINAL_REPLY,
            extra: {
                reasoning: 'Let me think about it.',
                display_text: '译文：Hello {{user}}, the answer is 42.',
                display_text_src: createSourceSignature(ORIGINAL_REPLY),
                display_text_lang: 'zh-CN',
                reasoning_display_text: '译文：Let me think about it.',
            },
        });
        await expect.poll(() => calls.filter(call => call.action === 'reloadChat').length).toBe(1);
        expect(calls.find(call => call.action === 'reloadChat').payload).toEqual({ avatar: 'alice.png', chat: 'tr-chat' });

        // the translation is what is shown, with its reasoning
        await expect(reply(page).locator('.message-body')).toContainText('译文：Hello {{user}}, the answer is 42.');
        await expect(reply(page).locator('.message-translation-badge')).toContainText('译文');
        await reply(page).locator('.message-reasoning summary').click();
        await expect(reply(page).locator('.message-reasoning')).toContainText('译文：Let me think about it.');

        // toggling is view-only
        await reply(page).locator('[data-toggle-message-translation]').click();
        await expect(reply(page).locator('.message-body')).toContainText(ORIGINAL_REPLY);
        await expect(reply(page).locator('.message-body')).not.toContainText('译文：');
        await expect(reply(page).locator('.message-reasoning')).not.toContainText('译文：');
        await expect(reply(page).locator('[data-message-translation]')).toHaveAttribute('data-translation-showing', 'original');
        await reply(page).locator('[data-toggle-message-translation]').click();
        await expect(reply(page).locator('.message-body')).toContainText('译文：Hello');
        expect(fixture.chatSaves).toHaveLength(1);
        expect(calls.filter(call => call.action === 'reloadChat')).toHaveLength(1);

        // the translation survives a reload because it lives in the chat file
        await page.reload();
        await expect(page.locator('.message')).toHaveCount(3);
        await expect(reply(page).locator('.message-body')).toContainText('译文：Hello {{user}}');

        // clearing removes the translation fields and nothing else
        await reply(page).locator('[data-clear-message-translation]').click();
        await expect(reply(page).locator('[data-message-translation]')).toHaveCount(0);
        await expect.poll(() => fixture.chatSaves.length).toBe(2);
        expect(savedReply(fixture)).toEqual(expect.objectContaining({ mes: ORIGINAL_REPLY }));
        expect(savedReply(fixture).extra).toEqual({ reasoning: 'Let me think about it.' });
        await expect(reply(page).locator('.message-body')).toContainText(ORIGINAL_REPLY);
    });

    test('marks the message that holds the latest chat summary, and only that one', async ({ page }) => {
        const messages = buildChatMessages();
        // the summary lives on the second-to-last message (the last message never counts, as in the legacy lookup)
        messages[1].extra = { memory: 'The user greeted Alice.' };
        messages[2].extra = { ...messages[2].extra, memory: 'Ignored: the last message never holds the summary.' };
        const fixture = createChatFixture({ messages });
        await acknowledgePrivacy(page);
        await mockTranslateRoutes(page, fixture);
        await mockChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);

        await expect(page.locator('.message-summary-marker')).toHaveCount(1);
        const marker = page.locator('.message').nth(1).locator('.message-meta .message-summary-marker');
        await expect(marker).toHaveText('摘要');
        await expect(marker).toHaveAttribute('title', '这条消息上挂着聊天摘要');
        // the translate button and the action row of that message are still there
        await expect(page.locator('.message').nth(2).locator('[data-translate-message]')).toBeEnabled();
    });

    test('keeps a numeric translation as the text "42"', async ({ page }) => {
        const fixture = createChatFixture({ messages: [
            ...buildChatMessages().slice(0, 2),
            { name: 'Alice Fixture', is_user: false, is_system: false, send_date: Date.now() - 1000, mes: 'forty-two' },
        ] });
        fixture.translateReply = () => ({ text: '42' });
        await acknowledgePrivacy(page);
        await mockTranslateRoutes(page, fixture);
        await mockChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);

        await reply(page).locator('[data-translate-message]').click();
        await expect(reply(page).locator('[data-message-translation="ready"]')).toBeVisible();
        expect(savedReply(fixture).extra.display_text).toBe('42');
        expect(typeof savedReply(fixture).extra.display_text).toBe('string');
        await expect(reply(page).locator('.message-body')).toContainText('42');
    });

    test('marks a translation as stale once the original changed and shows the original meanwhile', async ({ page }) => {
        const continued = `${ORIGINAL_REPLY} And then it went on.`;
        const messages = buildChatMessages({});
        messages[2].mes = continued;
        // the translation belongs to the shorter text the reply had before it was continued
        messages[2].extra = {
            display_text: '译文：旧的译文',
            display_text_src: createSourceSignature(ORIGINAL_REPLY),
            display_text_lang: 'zh-CN',
        };
        const fixture = createChatFixture({ messages });
        await acknowledgePrivacy(page);
        await mockTranslateRoutes(page, fixture);
        await mockChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);

        const bar = reply(page).locator('[data-message-translation="stale"]');
        await expect(bar).toBeVisible();
        await expect(bar).toContainText('译文已过期');
        await expect(bar).toHaveAttribute('data-translation-showing', 'original');
        await expect(reply(page).locator('.message-body')).toContainText('And then it went on.');
        await expect(reply(page).locator('.message-body')).not.toContainText('旧的译文');

        // the old translation can still be looked at
        await bar.locator('[data-toggle-message-translation]').click();
        await expect(reply(page).locator('.message-body')).toContainText('旧的译文');
        expect(fixture.chatSaves).toHaveLength(0);

        // translating again replaces it and clears the warning
        await bar.locator('[data-translate-message]').click();
        await expect(reply(page).locator('[data-message-translation="ready"]')).toBeVisible();
        expect(savedReply(fixture).extra.display_text).toBe(`译文：${continued}`);
        expect(savedReply(fixture).extra.display_text_src).toBe(createSourceSignature(continued));
    });

    // a toast of the previous save would cover the buttons of the next one for a few seconds, so each scenario gets a fresh page
    test('editing a translated reply starts from the original and keeps the translation when the text did not change', async ({ page }) => {
        const fixture = createChatFixture({ messages: buildTranslatedMessages() });
        await acknowledgePrivacy(page);
        await mockTranslateRoutes(page, fixture);
        await mockChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await expect(reply(page).locator('.message-body')).toContainText('译文：你好。');

        await reply(page).locator('[data-delete-message]').click();
        await reply(page).locator('[data-edit-message]').click();
        await expect(reply(page).locator('[data-edit-message-input]')).toHaveValue(ORIGINAL_REPLY);
        await expect(reply(page).locator('[data-edit-translation-hint]')).toContainText('这里编辑的是原文');
        await reply(page).locator('[data-save-edit-message]').click();
        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        expect(savedReply(fixture).mes).toBe(ORIGINAL_REPLY);
        expect(savedReply(fixture).extra.display_text).toBe('译文：你好。');
        await expect(reply(page).locator('[data-message-translation="ready"]')).toBeVisible();
    });

    test('an edited original drops the translation that no longer matches it and never receives the translation', async ({ page }) => {
        const fixture = createChatFixture({ messages: buildTranslatedMessages() });
        await acknowledgePrivacy(page);
        await mockTranslateRoutes(page, fixture);
        await mockChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);

        await reply(page).locator('[data-delete-message]').click();
        await reply(page).locator('[data-edit-message]').click();
        await reply(page).locator('[data-edit-message-input]').fill('Hello again, friend.');
        await reply(page).locator('[data-save-edit-message]').click();
        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        expect(savedReply(fixture).mes).toBe('Hello again, friend.');
        expect(savedReply(fixture).extra).not.toHaveProperty('display_text');
        expect(savedReply(fixture).extra).not.toHaveProperty('display_text_src');
        expect(savedReply(fixture).extra).not.toHaveProperty('display_text_lang');
        await expect(page.locator('.toast-stack')).toContainText('译文');
        await expect(reply(page).locator('.message-body')).toContainText('Hello again, friend.');
        await expect(reply(page).locator('.message-body')).not.toContainText('你好');
        await expect(reply(page).locator('[data-message-translation]')).toHaveCount(0);
    });

    test('shows a diagnosable message when the provider fails and recovers on retry', async ({ page }) => {
        const fixture = createChatFixture();
        fixture.translateReply = () => ({ status: 500, json: { error: 'provider_error', message: 'Google responded 429 Too Many Requests.', detail: '429' } });
        await acknowledgePrivacy(page);
        await mockTranslateRoutes(page, fixture);
        await mockChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);

        await reply(page).locator('[data-translate-message]').click();
        const error = reply(page).locator('[data-message-translation="error"]');
        await expect(error).toBeVisible();
        await expect(error).toContainText('Google 翻译');
        await expect(error).toContainText('HTTP 429');
        await expect(error).toContainText('换一个翻译服务');
        expect(fixture.chatSaves).toHaveLength(0);
        // the failed attempt is a button away from another one; the original is untouched
        await expect(reply(page).locator('.message-body')).toContainText(ORIGINAL_REPLY);

        fixture.translateReply = body => ({ text: `译文：${body.text}` });
        await error.locator('[data-translate-message]').click();
        await expect(reply(page).locator('[data-message-translation="ready"]')).toBeVisible();
        await expect(error).toHaveCount(0);
        expect(fixture.chatSaves).toHaveLength(1);
    });

    test('explains a missing API key without sending a request and a connection failure with its code', async ({ page }) => {
        const fixture = createChatFixture({ settings: { provider: 'deepl' } });
        await acknowledgePrivacy(page, ['deepl']);
        await mockTranslateRoutes(page, fixture, ['deepl']);
        await mockChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);

        await reply(page).locator('[data-translate-message]').click();
        await expect(reply(page).locator('[data-message-translation="error"]')).toContainText('DeepL 需要先填写 API Key');
        expect(fixture.translateRequests).toHaveLength(0);

        // with a key configured the request goes out; a refused connection names the error code
        fixture.secretState = { deepl: [{ id: 'k1', value: '*******abc', label: 'deepl', active: true }] };
        fixture.translateReply = () => ({ status: 500, json: { error: 'provider_failed', message: 'DeepL request failed: ECONNREFUSED', detail: 'ECONNREFUSED' } });
        await page.reload();
        await expect(page.locator('.message')).toHaveCount(3);
        await reply(page).locator('[data-translate-message]').click();
        await expect(reply(page).locator('[data-message-translation="error"]')).toContainText('ECONNREFUSED');
        expect(fixture.translateRequests[0]).toMatchObject({ provider: 'deepl', endpoint: 'free', lang: 'zh-CN' });
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 角色卡
// ---------------------------------------------------------------------------------------------------------------------

function createCharacterFixture() {
    const alice = {
        avatar: 'alice.png',
        name: 'Alice Fixture',
        description: '{{char}} is a wizard who helps {{user}}.',
        data: {
            name: 'Alice Fixture',
            description: '{{char}} is a wizard who helps {{user}}.',
            personality: 'Curious and kind.',
            scenario: 'A tower at night.',
            first_mes: 'Welcome, {{user}}!',
            mes_example: '<START>\n{{user}}: Hi\n{{char}}: Hello there.',
            creator_notes: 'See ![map](https://x.test/map.png) for the layout.',
            system_prompt: '',
            post_history_instructions: 'Stay in character.',
            alternate_greetings: ['Greetings, traveller.', 'Ah, {{user}}, you came back.'],
            creator: 'Modern E2E',
            tags: ['fixture'],
            extensions: { world: '', talkativeness: 0.5, fav: false, depth_prompt: { prompt: '', depth: 4, role: 'system' } },
        },
    };
    const fixture = createModernResourceFixture({ characters: [alice] });
    fixture.settings.extension_settings = { translate: { mode: 'machine', target_language: 'zh-CN', provider: 'google' } };
    return fixture;
}

// the "translation" of the description drops its placeholders; every other field is translated normally
function translateWithoutMacrosInDescription(body) {
    return { text: body.text.includes('wizard') ? '一位巫师。' : `译文：${body.text}` };
}

const characterField = (page, field) => page.locator(`[data-character-field="${field}"][data-character-scope="edit"]`);

async function openCharacterEditor(page, avatar = 'alice.png') {
    await gotoModern(page, 'characters', '角色库');
    await page.locator(`[data-edit-character="${avatar}"]`).click();
    await expect(page.locator('[data-character-translation]')).toBeVisible();
}

test.describe('Character card translation', () => {
    test.use({ viewport: desktopViewport });

    test('fills only the unsaved draft, keeps macros, and saves through the normal save path', async ({ page }) => {
        const fixture = createCharacterFixture();
        await acknowledgePrivacy(page);
        await mockTranslateRoutes(page, fixture);
        await mockModernWorkspace(page, fixture);
        await mockBridgeFrame(page);
        await openCharacterEditor(page);

        await expect(page.locator('[data-translate-character-draft]')).toContainText('翻译为中文');
        await page.locator('[data-translate-character-draft]').click();
        await expect(page.locator('[data-character-translation-summary]')).toContainText('已翻译 9 个字段');

        // field by field, with macros and tags and the image link kept out of the requests
        const texts = fixture.translateRequests.map(request => request.text);
        expect(texts).toEqual([
            '[[1]] is a wizard who helps [[2]].',
            'Curious and kind.',
            'A tower at night.',
            'Welcome, [[1]]!',
            '[[1]]\n[[2]]: Hi\n[[3]]: Hello there.',
            'See [[1]] for the layout.',
            'Stay in character.',
            'Greetings, traveller.',
            'Ah, [[1]], you came back.',
        ]);
        expect(texts.join('\n')).not.toMatch(/\{\{|<START>|x\.test/);

        await expect(characterField(page, 'description')).toHaveValue('译文：{{char}} is a wizard who helps {{user}}.');
        await expect(characterField(page, 'first_mes')).toHaveValue('译文：Welcome, {{user}}!');
        await expect(characterField(page, 'mes_example')).toHaveValue('译文：<START>\n{{user}}: Hi\n{{char}}: Hello there.');
        await expect(characterField(page, 'creator_notes')).toHaveValue('译文：See ![map](https://x.test/map.png) for the layout.');
        await expect(characterField(page, 'alternate_greetings')).toHaveValue('译文：Greetings, traveller.\n---\n译文：Ah, {{user}}, you came back.');
        // the name and the empty system prompt are not touched
        await expect(characterField(page, 'name')).toHaveValue('Alice Fixture');
        await expect(characterField(page, 'system_prompt')).toHaveValue('');

        // the draft is dirty, but nothing was saved
        await expect(page.locator('.character-form-actions')).toContainText('有未保存的修改');
        expect(fixture.requests.characterMerge).toHaveLength(0);
        expect(fixture.requests.settingsSave).toHaveLength(0);

        // the original of a translated field can be looked at and restored
        const item = page.locator('[data-character-translation-item="description"]');
        await item.locator('summary').click();
        await expect(item.locator('pre')).toHaveText('{{char}} is a wizard who helps {{user}}.');
        await item.locator('[data-restore-character-field]').click();
        await expect(characterField(page, 'description')).toHaveValue('{{char}} is a wizard who helps {{user}}.');
        await expect(item).toHaveAttribute('data-translation-status', 'restored');
        expect(fixture.requests.characterMerge).toHaveLength(0);

        // saving uses the existing save path and carries the translated fields
        await page.locator('[data-save-character-edit]').click();
        await expect.poll(() => fixture.requests.characterMerge.length).toBe(1);
        const [saved] = fixture.requests.characterMerge;
        expect(saved.avatar).toBe('alice.png');
        expect(saved.description).toBe('{{char}} is a wizard who helps {{user}}.');
        expect(saved.first_mes).toBe('译文：Welcome, {{user}}!');
        expect(saved.data.alternate_greetings).toEqual(['译文：Greetings, traveller.', '译文：Ah, {{user}}, you came back.']);
        expect(saved.data.mes_example).toBe('译文：<START>\n{{user}}: Hi\n{{char}}: Hello there.');
    });

    test('leaves a field unchanged and flags it when its placeholders do not match', async ({ page }) => {
        const fixture = createCharacterFixture();
        fixture.translateReply = translateWithoutMacrosInDescription;
        await acknowledgePrivacy(page);
        await mockTranslateRoutes(page, fixture);
        await mockModernWorkspace(page, fixture);
        await mockBridgeFrame(page);
        await openCharacterEditor(page);

        await page.locator('[data-translate-character-draft]').click();
        await expect(page.locator('[data-character-translation-summary]')).toContainText('占位内容对不上');

        const flagged = page.locator('[data-character-translation-item="description"]');
        await expect(flagged).toHaveAttribute('data-translation-status', 'mismatch');
        await expect(flagged).toContainText('缺少 2 处原有内容');
        await expect(flagged).toContainText('已保持原文');
        await expect(characterField(page, 'description')).toHaveValue('{{char}} is a wizard who helps {{user}}.');
        await expect(page.locator('[data-character-translation-item="first_mes"]')).toHaveAttribute('data-translation-status', 'done');
        await expect(characterField(page, 'first_mes')).toHaveValue('译文：Welcome, {{user}}!');
        expect(fixture.requests.characterMerge).toHaveLength(0);
    });

    test('asks for the privacy confirmation first and reports a provider failure on the field', async ({ page }) => {
        const fixture = createCharacterFixture();
        await mockTranslateRoutes(page, fixture);
        await mockModernWorkspace(page, fixture);
        await mockBridgeFrame(page);
        await openCharacterEditor(page);

        await page.locator('[data-translate-character-draft]').click();
        await expect(page.locator('[data-character-translation-confirm="draft"]')).toContainText('第三方翻译服务');
        expect(fixture.translateRequests).toHaveLength(0);

        fixture.translateReply = () => ({ status: 500, json: { error: 'provider_failed', message: 'Google request failed: ETIMEDOUT', detail: 'ETIMEDOUT' } });
        await page.locator('[data-confirm-character-translation]').click();
        const failed = page.locator('[data-character-translation-item="description"]');
        await expect(failed).toHaveAttribute('data-translation-status', 'error');
        await expect(failed).toContainText('ETIMEDOUT');
        // the failure stops the run: the later fields were not tried
        await expect(page.locator('[data-character-translation-item="personality"]')).toHaveAttribute('data-translation-status', 'skipped');
        expect(fixture.translateRequests).toHaveLength(1);
        await expect(characterField(page, 'description')).toHaveValue('{{char}} is a wizard who helps {{user}}.');
        await expect(page.locator('.character-form-actions')).toContainText('没有未保存的修改');
        expect(fixture.requests.characterMerge).toHaveLength(0);
    });

    test('copies the character first and translates the copy as its own unsaved draft', async ({ page }) => {
        const fixture = createCharacterFixture();
        fixture.duplicates = [];
        await acknowledgePrivacy(page);
        await mockTranslateRoutes(page, fixture);
        await mockModernWorkspace(page, fixture);
        await page.route('**/api/characters/duplicate', route => {
            const payload = postJson(route);
            fixture.duplicates.push(payload);
            const copy = { ...structuredClone(fixture.characterDetails[payload.avatar_url]), avatar: 'alice-copy.png' };
            fixture.characters.push(copy);
            fixture.characterDetails['alice-copy.png'] = copy;
            return fulfillJson(route, { path: 'alice-copy.png' });
        });
        await mockBridgeFrame(page);
        await openCharacterEditor(page);

        await page.locator('[data-translate-character-copy]').click();
        await expect(page.locator('[data-character-translation-summary]')).toContainText('已翻译 9 个字段');
        expect(fixture.duplicates).toEqual([{ avatar_url: 'alice.png' }]);
        // the editor now belongs to the copy and holds the translation; neither card was written
        await expect(page.locator('[data-save-character-edit]')).toBeVisible();
        await expect(characterField(page, 'first_mes')).toHaveValue('译文：Welcome, {{user}}!');
        await expect(page.locator('.character-form-actions')).toContainText('有未保存的修改');
        expect(fixture.requests.characterMerge).toHaveLength(0);

        await page.locator('[data-save-character-edit]').click();
        await expect.poll(() => fixture.requests.characterMerge.length).toBe(1);
        expect(fixture.requests.characterMerge[0].avatar).toBe('alice-copy.png');
        // the original card keeps its text
        expect(fixture.characterDetails['alice.png'].data.first_mes).toBe('Welcome, {{user}}!');
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 设置页
// ---------------------------------------------------------------------------------------------------------------------

function createSettingsFixture({ translate = { mode: 'machine', target_language: 'en', internal_language: 'en', provider: 'google', auto_mode: 'none', deepl_endpoint: 'free' } } = {}) {
    const fixture = createModernResourceFixture({ settingsBundle: { enable_extensions: true, enable_accounts: true } });
    fixture.settings.extension_settings = { translate: structuredClone(translate), note: { default: 'kept' } };
    fixture.secretWrites = [];
    fixture.secretDeletes = [];
    return fixture;
}

async function mockSettingsRoutes(page, fixture) {
    await mockModernWorkspace(page, fixture);
    await page.route('**/api/settings/get-snapshots', route => fulfillJson(route, []));
    await page.route('**/api/secrets/write', route => {
        const payload = postJson(route);
        fixture.secretWrites.push(payload);
        const masked = payload.key.endsWith('_url') ? payload.value : `*******${payload.value.slice(-3)}`;
        fixture.secretState = { ...fixture.secretState, [payload.key]: [{ id: `id-${fixture.secretWrites.length}`, value: masked, label: payload.label, active: true }] };
        return fulfillJson(route, { id: `id-${fixture.secretWrites.length}` });
    });
    await page.route('**/api/secrets/delete', route => {
        const payload = postJson(route);
        fixture.secretDeletes.push(payload);
        fixture.secretState = { ...fixture.secretState, [payload.key]: null };
        return route.fulfill({ status: 204 });
    });
}

async function openTranslateSettings(page) {
    await page.goto('/modern/?view=settings');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'settings');
    await page.locator('[data-settings-section="chat-tools"]').click();
    await expect(page.locator('[data-translate-settings]')).toBeVisible();
}

// The settings center reports every automatic save in the save-status pill of its page head
const saveStatus = page => page.locator('[data-settings-save-status]');

test.describe('Translation settings', () => {
    test.use({ viewport: desktopViewport });

    test('saves the provider and secrets, then waits for the engine before refreshing', async ({ page }) => {
        const fixture = createSettingsFixture();
        let savesWhenReloaded = -1;
        await mockSettingsRoutes(page, fixture);
        const calls = await mockBridgeFrame(page, {
            replies: {
                reloadSettings: () => {
                    savesWhenReloaded = fixture.requests.settingsSave.length;
                    return { ok: true };
                },
            },
        });
        await openTranslateSettings(page);

        // machine translation: the section states where the text goes, shows the saved values and the read-only legacy fields
        await expect(page.locator('[data-translate-mode][value="machine"]')).toBeChecked();
        await expect(page.locator('[data-translate-privacy]')).toContainText('第三方');
        await expect(page.locator('[data-translate-provider]')).toHaveValue('google');
        // the target language is chosen on the language tab and only named here
        await expect(page.locator('[data-translate-target-label]')).toContainText('English');
        await expect(page.locator('[data-translate-settings] select[data-translate-target]')).toHaveCount(0);
        await expect(page.locator('[data-translate-internal-language]')).toContainText('English');
        await expect(page.locator('[data-translate-provider-description]')).toContainText('免密钥');
        await expect(page.locator('[data-translate-for="deepl"]').first()).toBeHidden();

        // picking DeepL shows its key and endpoint rows and its own description right away, and saves the provider
        await page.locator('[data-translate-provider]').selectOption('deepl');
        await expect(page.locator('[data-translate-provider-description]')).toContainText('DeepL API Key');
        await expect(page.locator('[data-translate-secret="deepl"]')).toBeVisible();
        await expect(page.locator('[data-translate-deepl-endpoint]')).toBeVisible();
        await expect(page.locator('[data-translate-secret="deeplx_url"]')).toBeHidden();
        await expect(saveStatus(page)).toContainText('翻译设置已保存');
        await expect.poll(() => fixture.requests.settingsSave.length).toBe(1);
        expect(fixture.requests.settingsSave[0].extension_settings.translate.provider).toBe('deepl');
        // the engine was told after the file was written
        await expect.poll(() => calls.filter(call => call.action === 'reloadSettings').length).toBe(1);
        expect(savesWhenReloaded).toBe(1);

        // a key is saved (trimmed) once the box is left, then the box is emptied and the key shown as saved without being echoed
        await page.locator('[data-translate-secret="deepl"]').fill('  secret-key-999 ');
        await page.locator('[data-translate-secret="deepl"]').blur();
        await expect(page.locator('[data-translate-secret-state="deepl"]')).toContainText('已保存（*******999）');
        await expect(page.locator('[data-translate-secret="deepl"]')).toHaveValue('');
        await page.locator('[data-translate-deepl-endpoint]').selectOption('pro');
        await expect.poll(() => fixture.requests.settingsSave.at(-1).extension_settings.translate.deepl_endpoint).toBe('pro');
        await expect(saveStatus(page)).toContainText('翻译设置已保存');

        // the key was written once, although every later save read the whole form again
        expect(fixture.secretWrites).toEqual([{ key: 'deepl', value: 'secret-key-999', label: 'translate modern' }]);
        const saved = fixture.requests.settingsSave.at(-1);
        // the translate block changed, the target language, the legacy-only fields and everything else stayed
        expect(saved.extension_settings.translate).toEqual({ mode: 'machine', provider: 'deepl', target_language: 'en', deepl_endpoint: 'pro', internal_language: 'en', auto_mode: 'none' });
        expect(saved.extension_settings.note).toEqual({ default: 'kept' });
        // the status pill reports the saves; there is no save button and no success toast
        await expect(page.locator('[data-translate-save]')).toHaveCount(0);
        await expect(page.locator('.toast-stack')).not.toContainText('翻译设置已保存');
        await expect(page.locator('[data-translate-provider]')).toHaveValue('deepl');
    });

    test('offers LLM translation first and uses it by default, switching the method saves it', async ({ page }) => {
        const fixture = createSettingsFixture({ translate: {} });
        fixture.settings.main_api = 'openai';
        fixture.settings.oai_settings = { ...fixture.settings.oai_settings, chat_completion_source: 'deepseek', deepseek_model: 'deepseek-chat' };
        fixture.settings.extension_settings.modelServices = {
            services: [{ id: 'svc-1', name: 'DeepSeek', provider: 'deepseek', secretId: 'key-1', defaultModel: 'deepseek-chat' }],
            scenes: { chat: { serviceId: 'svc-1' }, translation: { serviceId: '', model: '', maxOutputTokens: 4096 } },
        };
        await mockSettingsRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openTranslateSettings(page);

        const modes = page.locator('[data-translate-mode]');
        await expect(modes).toHaveCount(2);
        await expect(modes.first()).toHaveAttribute('value', 'llm');
        await expect(modes.first()).toBeChecked();
        await expect(page.locator('[data-translate-llm-target]')).toContainText('DeepSeek');
        await expect(page.locator('[data-translate-llm-target]')).toContainText('deepseek-chat');
        // the machine translation rows only appear for machine translation
        await expect(page.locator('[data-translate-provider]')).toHaveCount(0);
        await expect(page.locator('[data-translate-target-label]')).toContainText('简体中文');

        await page.locator('[data-translate-mode][value="machine"]').check();
        await expect(page.locator('[data-translate-provider]')).toBeVisible();
        await expect.poll(() => fixture.requests.settingsSave.at(-1)?.extension_settings.translate.mode).toBe('machine');
        // the legacy extension keeps a provider it knows
        expect(fixture.requests.settingsSave.at(-1).extension_settings.translate.provider).toBe('google');

        await page.locator('[data-translate-mode][value="llm"]').check();
        await expect.poll(() => fixture.requests.settingsSave.at(-1)?.extension_settings.translate.mode).toBe('llm');

        // the link goes to the model connection tab
        await page.locator('[data-translate-llm] [data-settings-section="connection"]').click();
        await expect(page.locator('[data-scene-translation-service]')).toBeVisible();
    });

    test('saves an API key on Enter once and empties the box like leaving it does', async ({ page }) => {
        const fixture = createSettingsFixture({ translate: { mode: 'machine', target_language: 'en', internal_language: 'en', provider: 'deepl', auto_mode: 'none', deepl_endpoint: 'free' } });
        await mockSettingsRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openTranslateSettings(page);

        const key = page.locator('[data-translate-secret="deepl"]');
        await key.fill('secret-key-999');
        await key.press('Enter');
        await expect(page.locator('[data-translate-secret-state="deepl"]')).toContainText('已保存（*******999）');
        await expect(saveStatus(page)).toContainText('翻译设置已保存');
        // the key is not kept in the box after it was saved
        await expect(key).toHaveValue('');
        // a later change saves the form again without writing the same key a second time
        await page.locator('[data-translate-deepl-endpoint]').selectOption('pro');
        await expect.poll(() => fixture.requests.settingsSave.at(-1)?.extension_settings.translate.deepl_endpoint).toBe('pro');
        expect(fixture.secretWrites).toEqual([{ key: 'deepl', value: 'secret-key-999', label: 'translate modern' }]);
    });

    test('rejects a service URL that is not an http(s) address before writing anything', async ({ page }) => {
        const fixture = createSettingsFixture();
        await mockSettingsRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openTranslateSettings(page);

        // picking LibreTranslate saves the provider by itself
        await page.locator('[data-translate-provider]').selectOption('libre');
        await expect(saveStatus(page)).toContainText('翻译设置已保存');
        await expect.poll(() => fixture.requests.settingsSave.length).toBe(1);

        await page.locator('[data-translate-secret="libre_url"]').fill('ftp://libre.example');
        await page.locator('[data-translate-secret="libre_url"]').press('Enter');
        await expect(saveStatus(page)).toContainText('翻译设置保存失败');
        await expect(page.locator('.toast', { hasText: '翻译设置保存失败' })).toContainText('http://');
        // nothing was written for the rejected address, and the typed value stays for correcting
        expect(fixture.secretWrites).toHaveLength(0);
        expect(fixture.requests.settingsSave).toHaveLength(1);
        await expect(page.locator('[data-translate-secret="libre_url"]')).toHaveValue('ftp://libre.example');
    });

    test('shows an active auto mode read-only with an explanation and a button that turns it off', async ({ page }) => {
        const fixture = createSettingsFixture({ translate: { target_language: 'zh-CN', internal_language: 'en', provider: 'google', auto_mode: 'both', deepl_endpoint: 'free' } });
        await mockSettingsRoutes(page, fixture);
        const calls = await mockBridgeFrame(page);
        await openTranslateSettings(page);

        const notice = page.locator('[data-translate-auto-mode="both"]');
        await expect(notice).toBeVisible();
        await expect(page.locator('[data-translate-default-hint]')).toHaveCount(0);
        await expect(notice).toContainText('翻译回复和输入');
        await expect(notice).toContainText('消息内容会被改写');
        await expect(notice).toContainText('一期只做手动显示翻译');
        // there is no control to pick another auto mode
        await expect(page.locator('select[data-translate-auto-mode]')).toHaveCount(0);

        await notice.locator('[data-translate-disable-auto-mode]').click();
        await expect(page.locator('[data-translate-auto-mode="none"]')).toBeVisible();
        expect(fixture.requests.settingsSave).toHaveLength(1);
        expect(fixture.requests.settingsSave[0].extension_settings.translate).toEqual({ target_language: 'zh-CN', internal_language: 'en', provider: 'google', auto_mode: 'none', deepl_endpoint: 'free' });
        await expect.poll(() => calls.filter(call => call.action === 'reloadSettings').length).toBe(1);
        await expect(page.locator('.toast-stack')).toContainText('自动翻译已关闭');
    });

    test('tests the saved provider with one short sentence and shows the outcome', async ({ page }) => {
        const fixture = createSettingsFixture();
        await mockTranslateRoutes(page, fixture);
        await mockSettingsRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openTranslateSettings(page);

        await page.locator('[data-translate-test]').click();
        const result = page.locator('[data-translate-test-result]');
        await expect(result).toHaveAttribute('data-translate-test-state', 'ok');
        await expect(result).toContainText('译文：Hello, world!');
        expect(fixture.translateRequests).toEqual([{ provider: 'google', text: 'Hello, world!', lang: 'en' }]);

        fixture.translateReply = () => ({ status: 500, json: { error: 'provider_error', message: 'Google responded 503.', detail: '503' } });
        await page.locator('[data-translate-test]').click();
        await expect(result).toHaveAttribute('data-translate-test-state', 'error');
        await expect(result).toContainText('HTTP 503');
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 大模型翻译和开场白自动翻译
// ---------------------------------------------------------------------------------------------------------------------

const LLM_SERVICE = { id: 'svc-1', name: 'DeepSeek', provider: 'deepseek', secretId: 'key-1', defaultModel: 'deepseek-chat' };

function createLlmChatFixture(translate = {}) {
    const fixture = createChatFixture({ settings: { mode: 'llm', auto_greeting: true, ...translate } });
    fixture.settings.main_api = 'openai';
    fixture.settings.oai_settings = { ...fixture.settings.oai_settings, chat_completion_source: 'deepseek', deepseek_model: 'deepseek-chat' };
    fixture.settings.extension_settings.modelServices = {
        services: [structuredClone(LLM_SERVICE)],
        scenes: { chat: { serviceId: 'svc-1' }, translation: { serviceId: '', model: '', maxOutputTokens: 4096 } },
    };
    return fixture;
}

// /api/model-services/complete 的替身：把用户消息加上「译：」返回，请求体记在 fixture.llmRequests
async function mockModelServiceRoutes(page, fixture) {
    fixture.llmRequests = [];
    await page.route('**/api/model-services/complete', route => {
        const body = postJson(route);
        fixture.llmRequests.push(body);
        const text = body.messages?.find(message => message.role === 'user')?.content ?? '';
        return fulfillJson(route, { content: `译：${text}`, finishReason: 'stop', hasReasoning: false, provider: 'deepseek', model: 'deepseek-chat', service: { id: 'svc-1', name: 'DeepSeek', implicit: false, followsChat: true } });
    });
}

test.describe('LLM translation', () => {
    test.use({ viewport: desktopViewport });

    test('translates the foreign greeting on its own when the chat opens, and a reply on request, through the translation scene', async ({ page }) => {
        const fixture = createLlmChatFixture();
        await mockTranslateRoutes(page, fixture);
        await mockModelServiceRoutes(page, fixture);
        await mockChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);

        // the greeting is translated without a click and without a privacy question: the text goes to the user's own model service
        const greeting = page.locator('.message').nth(0);
        await expect(greeting.locator('[data-message-translation="ready"]')).toBeVisible();
        await expect(greeting.locator('.message-body')).toContainText('译：Opening line.');
        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        expect(fixture.files['tr-chat'].messages[0]).toMatchObject({ mes: 'Opening line.', extra: { display_text: '译：Opening line.', display_text_lang: 'zh-CN' } });
        expect(fixture.llmRequests).toHaveLength(1);
        expect(fixture.llmRequests[0].scene).toBe('translation');
        expect(fixture.llmRequests[0].messages[0].role).toBe('system');
        expect(fixture.llmRequests[0].messages[0].content).toContain('Chinese (Simplified)');
        // machine translation was not used
        expect(fixture.translateRequests).toHaveLength(0);
        await expect(page.locator('.toast-stack')).not.toContainText('消息已翻译');

        // a reply is translated on request, macros kept out of the request
        await reply(page).locator('[data-translate-message]').click();
        await expect(reply(page).locator('[data-message-translation="ready"]')).toBeVisible();
        expect(fixture.llmRequests.slice(1).map(request => request.messages[1].content)).toEqual(['Hello [[1]], the answer is 42.', 'Let me think about it.']);
        expect(savedReply(fixture).extra).toMatchObject({ display_text: '译：Hello {{user}}, the answer is 42.', reasoning_display_text: '译：Let me think about it.' });

        // reopening the chat does not translate the greeting again
        await page.reload();
        await expect(page.locator('.message')).toHaveCount(3);
        await expect(page.locator('.message').nth(0).locator('.message-body')).toContainText('译：Opening line.');
        expect(fixture.llmRequests).toHaveLength(3);
    });

    test('leaves the greeting alone when the automatic greeting translation is off', async ({ page }) => {
        const fixture = createLlmChatFixture({ auto_greeting: false });
        await mockModelServiceRoutes(page, fixture);
        await mockChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);

        await expect(page.locator('.message').nth(0).locator('[data-translate-message]')).toBeEnabled();
        await page.waitForTimeout(300);
        expect(fixture.llmRequests).toHaveLength(0);
        expect(fixture.chatSaves).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 设置中心「语言」标签
// ---------------------------------------------------------------------------------------------------------------------

const LEGACY_RULE = 'Always reply in the same language as {{user}}\'s latest message, even if the character card is in another language.';

async function openLanguageSettings(page) {
    await page.goto('/modern/?view=settings');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
    await page.locator('[data-settings-section="language"]').click();
    await expect(page.locator('[data-settings-language]')).toBeVisible();
}

test.describe('Language settings', () => {
    test.use({ viewport: desktopViewport });

    test('replies in Simplified Chinese by default; the reply language, the translation target and the greeting switch save on change', async ({ page }) => {
        const fixture = createSettingsFixture({ translate: {} });
        await mockSettingsRoutes(page, fixture);
        const calls = await mockBridgeFrame(page);
        await openLanguageSettings(page);

        const replyLanguage = page.locator('[data-reply-language]');
        const target = page.locator('[data-translate-target]');
        await expect(replyLanguage).toHaveValue('zh-CN');
        await expect(target).toHaveValue('__follow__');
        await expect(target.locator('option[value="__follow__"]')).toContainText('简体中文');
        await expect(page.locator('[data-translate-auto-greeting]')).toBeChecked();
        await expect(page.locator('[data-legacy-language-rule]')).toHaveCount(0);

        await replyLanguage.selectOption('en');
        await expect.poll(() => fixture.requests.settingsSave.at(-1)?.power_user?.reply_language).toBe('en');
        await expect.poll(() => calls.filter(call => call.action === 'reloadSettings').length).toBe(1);
        await expect(saveStatus(page)).toContainText('角色回复语言已保存');
        // the translation target follows the reply language
        await expect(target.locator('option[value="__follow__"]')).toContainText('English');

        await target.selectOption('ja');
        await expect.poll(() => fixture.requests.settingsSave.at(-1)?.extension_settings.translate).toMatchObject({ follow_reply_language: false, target_language: 'ja' });
        await target.selectOption('__follow__');
        await expect.poll(() => fixture.requests.settingsSave.at(-1)?.extension_settings.translate.follow_reply_language).toBe(true);

        await page.locator('[data-translate-auto-greeting]').uncheck();
        await expect.poll(() => fixture.requests.settingsSave.at(-1)?.extension_settings.translate.auto_greeting).toBe(false);

        // no preference: the follow option has no language of its own to show
        await replyLanguage.selectOption('');
        await expect.poll(() => fixture.requests.settingsSave.at(-1)?.power_user?.reply_language).toBe('');
        await expect(target.locator('option[value="__follow__"]')).toHaveAttribute('disabled', '');
        // the target falls back to the language chosen before
        await expect(target).toHaveValue('ja');
        // everything else in the settings file stayed
        expect(fixture.requests.settingsSave.at(-1).extension_settings.note).toEqual({ default: 'kept' });
    });

    test('points at the hand-written language rule of the main prompt and removes only that paragraph on request', async ({ page }) => {
        const fixture = createSettingsFixture();
        fixture.settings.oai_settings = {
            ...fixture.settings.oai_settings,
            prompts: [
                { identifier: 'main', name: 'Main Prompt', content: `Write {{char}}'s next reply.\n\n${LEGACY_RULE}\n\nStay in character.` },
                { identifier: 'nsfw', name: 'Auxiliary Prompt', content: '' },
            ],
        };
        await mockSettingsRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openLanguageSettings(page);

        const note = page.locator('[data-legacy-language-rule]');
        await expect(note).toBeVisible();
        expect(fixture.requests.settingsSave).toHaveLength(0);

        await note.locator('[data-remove-legacy-language-rule]').click();
        await expect.poll(() => fixture.requests.settingsSave.length).toBe(1);
        const prompts = fixture.requests.settingsSave[0].oai_settings.prompts;
        expect(prompts[0].content).toBe('Write {{char}}\'s next reply.\n\nStay in character.');
        expect(prompts[1]).toEqual({ identifier: 'nsfw', name: 'Auxiliary Prompt', content: '' });
        await expect(note).toHaveCount(0);
    });
});
