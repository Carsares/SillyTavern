import { test, expect } from '@playwright/test';
import { createModernResourceFixture, mockBridgeFrame, mockModernWorkspace } from './modern-test-utils.js';

// 会话内生图 · 从消息生成（WP5）：勾选模式、生成提示词、取消、失败、Esc 退出、文本补全连接下的说明。
// /api/backends/chat-completions/generate 和 /api/image-generation/* 都由测试替身回答，不访问任何真实模型。
//
// 进入「从消息生成」靠输入框的「文本 / 图片」切换和「手动输入 / 从消息生成」分段（WP2，components/chat-image-composer.js）。
// 这里按按钮文字定位（enterFromMessages），WP2 的 data-* 属性定下来后集成时可以换成属性选择器。

const desktopViewport = { width: 1440, height: 900 };
const GENERATED_PROMPT = 'A moonlit rooftop, a silver-haired girl leaning on the railing, anime illustration.';
const PROMPT_TEMPLATE = 'E2E TEMPLATE: describe one frame.';
// 1×1 透明 PNG，图片消息的 <img> 用
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

function fulfillJson(route, body, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
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

function buildMessages() {
    const base = Date.now() - 120_000;
    const iso = offset => new Date(base + offset * 1000).toISOString();
    return [
        { name: 'Alice Fixture', is_user: false, is_system: false, send_date: iso(0), mes: 'Opening line on the rooftop.' },
        { name: 'Modern E2E User', is_user: true, is_system: false, send_date: iso(1), mes: 'Look at the moon tonight.' },
        { name: 'Alice Fixture', is_user: false, is_system: false, send_date: iso(2), mes: 'The moon is huge and silver.' },
        {
            name: 'Alice Fixture',
            is_user: false,
            is_system: true,
            send_date: iso(3),
            mes: '',
            extra: {
                media: [{ url: '/user/images/Alice Fixture/moon.png', type: 'image', title: 'moon', negative: '', source: 'generated', generation: { provider: 'openai', model: 'gpt-image-1', params: {} } }],
                media_display: 'gallery',
                media_index: 0,
                inline_image: false,
                image_generation: { version: 1 },
            },
        },
        { name: 'Modern E2E User', is_user: true, is_system: false, send_date: iso(4), mes: 'Let us stay a little longer.' },
    ];
}

function createFixture({ mainApi = 'openai' } = {}) {
    const fixture = createModernResourceFixture({
        secretState: { api_key_image_generation: [{ id: 'image-key', value: '***', label: 'image', active: true }] },
    });
    const messages = buildMessages();
    fixture.settings.main_api = mainApi;
    fixture.settings.oai_settings = { chat_completion_source: 'openai', openai_model: 'gpt-e2e', openai_max_tokens: 400, temp_openai: 0.8 };
    fixture.settings.extension_settings = {
        imageGeneration: {
            provider: 'openai',
            model: 'gpt-image-1',
            promptGen: { template: PROMPT_TEMPLATE, defaultSelectCount: 2, includeAppearance: true },
        },
    };
    fixture.chatLists = {
        'alice.png': [{ file_id: 'img-chat', file_name: 'img-chat.jsonl', chat_items: messages.length, file_size: '2 KB', last_mes: Date.now() }],
        'bruno.png': [],
    };
    fixture.files = { 'img-chat': { metadata: { integrity: 'int-1' }, messages, saves: 0 } };
    fixture.chatSaves = [];
    fixture.generateBodies = [];
    // 每个测试可以替换：route => Promise<void>，请求体已记录在 generateBodies
    fixture.generateReply = route => fulfillJson(route, { choices: [{ message: { role: 'assistant', content: GENERATED_PROMPT } }] });
    return fixture;
}

async function mockRoutes(page, fixture) {
    await mockModernWorkspace(page, fixture);
    await mockBridgeFrame(page);
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
        fixture.chatSaves.push(payload);
        return fulfillJson(route, { ok: true, integrity: 'int-2' });
    });
    await page.route('**/api/image-generation/capabilities', route => fulfillJson(route, {
        supported: true,
        parameters: ['width', 'height', 'quality', 'count'],
        limits: { maxCount: 4 },
        requiresBaseUrl: false,
        requiresKey: true,
        keySaved: true,
    }));
    await page.route('**/user/images/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_BYTES }));
    await page.route('**/api/backends/chat-completions/generate', async route => {
        fixture.generateBodies.push(postJson(route));
        try {
            await fixture.generateReply(route);
        } catch {
            // 页面取消（AbortController）后请求已经结束，再回答会抛错，忽略
        }
    });
}

async function openChat(page) {
    await page.goto('/modern/?view=chat');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'chat');
    await expect(page.locator('.page-title')).toHaveText('聊天工作区');
    await expect(page.locator('.message')).toHaveCount(5);
}

// 输入框切到图片模式，再切到「从消息生成」（WP2 的按钮）
async function enterFromMessages(page) {
    await page.locator('.composer').getByRole('button', { name: '图片', exact: true }).first().click();
    await page.getByRole('button', { name: /从消息生成/ }).click();
}

const banner = page => page.locator('[data-image-select-banner]');
const selectable = page => page.locator('[data-image-select]');
const generateButton = page => page.locator('[data-image-prompt-generate]');

test.describe('In-chat image generation: prompt from messages', () => {
    test.use({ viewport: desktopViewport });

    test('selects messages by clicking them, generates a prompt with the text connection and fills the prompt box', async ({ page }) => {
        const fixture = createFixture();
        await mockRoutes(page, fixture);
        await openChat(page);
        await enterFromMessages(page);

        await expect(banner(page)).toBeVisible();
        await expect(banner(page)).toContainText('正在勾选消息');
        await expect(page.locator('[data-image-prompt-stepper]')).toContainText('勾选消息');
        // 四条文本消息可以勾选；图片消息变淡、没有复选框
        await expect(selectable(page)).toHaveCount(4);
        await expect(page.locator('[data-image-select-checkbox]')).toHaveCount(4);
        await expect(page.locator('.message.message-unselectable')).toHaveCount(1);

        await page.locator('[data-image-select-clear]').click();
        await expect(page.locator('[data-image-select-count]')).toHaveText('0');
        await expect(generateButton(page)).toBeDisabled();

        // 点消息正文就能勾选；点图片消息不会
        await selectable(page).nth(2).locator('.message-body').click();
        await selectable(page).nth(3).locator('.message-body').click();
        await page.locator('.message.message-unselectable').click();
        await expect(page.locator('.message.message-selected')).toHaveCount(2);
        await expect(page.locator('[data-image-select-banner-count]')).toHaveText('2');
        await expect(page.locator('[data-image-select-summary]')).toContainText(`约 ${'The moon is huge and silver.'.length + 'Let us stay a little longer.'.length} 字`);
        await expect(generateButton(page)).toBeEnabled();

        // 再点一次取消勾选，再勾回来
        await selectable(page).nth(3).click();
        await expect(page.locator('.message.message-selected')).toHaveCount(1);
        await selectable(page).nth(3).click();
        await expect(page.locator('.message.message-selected')).toHaveCount(2);

        await generateButton(page).click();
        await expect.poll(() => fixture.generateBodies.length).toBe(1);
        const body = fixture.generateBodies[0];
        expect(body).toMatchObject({ chat_completion_source: 'openai', model: 'gpt-e2e', stream: false, max_tokens: 400, temperature: 0.8 });
        expect(body.messages).toEqual([
            { role: 'system', content: PROMPT_TEMPLATE },
            {
                role: 'user',
                content: 'Character appearance:\nAlice Fixture: Alice visible description.\n\nConversation excerpt:\nAlice Fixture: The moon is huge and silver.\nModern E2E User: Let us stay a little longer.',
            },
        ]);

        await expect(page.locator('[data-chat-image-prompt]')).toHaveValue(GENERATED_PROMPT);
        await expect(page.locator('[data-image-prompt-source]')).toContainText('由 2 条消息生成');
        await expect(page.locator('[data-image-prompt-step="3"]')).toBeVisible();
        // 第 3 步不再勾选：提示条和复选框都收起；生成提示词不写聊天文件
        await expect(banner(page)).toHaveCount(0);
        await expect(page.locator('[data-image-select-checkbox]')).toHaveCount(0);
        expect(fixture.chatSaves).toHaveLength(0);

        // 返回勾选：勾选还在
        await page.locator('[data-image-prompt-back]').click();
        await expect(banner(page)).toBeVisible();
        await expect(page.locator('.message.message-selected')).toHaveCount(2);
    });

    test('cancel returns to step 1, and an error in a 200 reply is shown with a retry', async ({ page }) => {
        const fixture = createFixture();
        await mockRoutes(page, fixture);
        let releaseHeld;
        const held = new Promise(resolve => {
            releaseHeld = resolve;
        });
        fixture.generateReply = async route => {
            await held;
            await fulfillJson(route, { choices: [{ message: { content: 'too late' } }] });
        };
        await openChat(page);
        await enterFromMessages(page);
        await page.locator('[data-image-select-recent="1"]').click();
        await expect(page.locator('[data-image-select-count]')).toHaveText('1');

        await generateButton(page).click();
        const progress = page.locator('[data-image-prompt-progress]');
        await expect(progress).toContainText('正在用 gpt-e2e 根据 1 条消息和角色外貌生成图片提示词');
        // 生成中勾选冻结
        await expect(banner(page)).toHaveCount(0);
        await expect(page.locator('[data-image-select-checkbox]')).toHaveCount(0);

        await page.locator('[data-image-prompt-cancel]').click();
        await expect(banner(page)).toBeVisible();
        await expect(page.locator('[data-image-prompt-step="1"]')).toBeVisible();
        releaseHeld();
        await expect(page.locator('[data-image-prompt-step="3"]')).toHaveCount(0);

        fixture.generateReply = route => fulfillJson(route, { error: { message: 'quota exceeded' } });
        await generateButton(page).click();
        await expect(page.locator('[data-image-prompt-error]')).toContainText('生成提示词失败：quota exceeded');
        await expect(generateButton(page)).toContainText('重试生成提示词');

        fixture.generateReply = route => fulfillJson(route, { choices: [{ message: { content: GENERATED_PROMPT } }] });
        await generateButton(page).click();
        await expect(page.locator('[data-chat-image-prompt]')).toHaveValue(GENERATED_PROMPT);
        expect(fixture.generateBodies).toHaveLength(3);
    });

    test('Esc leaves selection mode; the over-limit hint disables the button', async ({ page }) => {
        const fixture = createFixture();
        const longText = 'x'.repeat(3100);
        fixture.files['img-chat'].messages[1].mes = longText;
        fixture.files['img-chat'].messages[2].mes = longText;
        await mockRoutes(page, fixture);
        await openChat(page);
        await enterFromMessages(page);

        await page.locator('[data-image-select-clear]').click();
        await selectable(page).nth(1).locator('.message-body').click();
        await selectable(page).nth(2).locator('.message-body').click();
        await expect(page.locator('[data-image-prompt-gate="over-limit"]')).toContainText('最多参考 20 条、6000 字');
        await expect(generateButton(page)).toBeDisabled();

        await page.locator('body').press('Escape');
        await expect(banner(page)).toHaveCount(0);
        await expect(page.locator('[data-image-select-checkbox]')).toHaveCount(0);
        await expect(page.locator('[data-image-prompt-steps]')).toHaveCount(0);
        expect(fixture.generateBodies).toHaveLength(0);
    });

    test('a text completion connection explains that prompts from messages need chat completion', async ({ page }) => {
        const fixture = createFixture({ mainApi: 'textgenerationwebui' });
        await mockRoutes(page, fixture);
        await openChat(page);
        await page.locator('.composer').getByRole('button', { name: '图片', exact: true }).first().click();

        // The composer keeps 「从消息生成」 disabled and explains why in its title, so selection mode never starts
        const fromMessages = page.locator('[data-chat-image-sub="auto"]');
        await expect(fromMessages).toBeDisabled();
        await expect(fromMessages).toHaveAttribute('title', /只支持聊天补全/);
        await expect(banner(page)).toHaveCount(0);
        await expect(page.locator('[data-image-select-checkbox]')).toHaveCount(0);
        expect(fixture.generateBodies).toHaveLength(0);
    });
});
