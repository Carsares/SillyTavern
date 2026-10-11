import { deflateSync } from 'node:zlib';
import { test, expect } from '@playwright/test';
import { createModernResourceFixture, mockBridgeFrame, mockModernWorkspace } from './modern-test-utils.js';

/* global localStorage, sessionStorage */

// 会话内生图 · 输入框图片模式与生成流程（WP2）：元信息行最前的「文本 / 图片」切换、未配置时的空状态和去设置中心的入口、
// 按 /capabilities 过滤的参数标签、Ctrl/⌘+Enter 生成、202 后轮询、生成期间的锁、「停止等待」走 /cancel、
// 以及写入聊天文件的图片消息结构（断言 /api/chats/save 的请求体）。/api/image-generation/* 全部 mock，
// /user/images/** 返回真实 PNG 字节，引擎用 mockBridgeFrame 替身。动作的细节分支由 tests/modern-chat-image-generation.test.js 覆盖。

const desktopViewport = { width: 1440, height: 900 };
const API = '/api/image-generation';
const IMAGE_PATH = '/user/images/Alice Fixture/Alice Fixture_2026-10-12@10h00m00s_1.png';

// ---------- 测试用 PNG（纯色，32×48） ----------
const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
});

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

function solidPng(width, height, [r, g, b]) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 2;
    const row = Buffer.from([0, ...Array.from({ length: width }, () => [r, g, b]).flat()]);
    const raw = Buffer.concat(Array.from({ length: height }, () => row));
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', header),
        pngChunk('IDAT', deflateSync(raw)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

const PNG = solidPng(32, 48, [40, 120, 200]);

// ---------- 夹具 ----------
function fulfillJson(route, body, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

// A handler reply is either a plain JSON body (HTTP 200) or { status: <HTTP number>, body }. A plain body may itself carry
// a string `status` such as 'completed', which must not be taken for the HTTP status.
function fulfillReply(route, reply) {
    const wrapped = reply && typeof reply.status === 'number' && Object.hasOwn(reply, 'body');
    return fulfillJson(route, wrapped ? reply.body : reply, wrapped ? reply.status : 200);
}

function postJson(route) {
    try {
        return route.request().postDataJSON();
    } catch {
        return {};
    }
}

function createDeferred() {
    /** @type {(value?: unknown) => void} */
    let resolve = () => {};
    const promise = new Promise(settle => {
        resolve = settle;
    });
    return { promise, resolve };
}

const capabilities = {
    supported: true,
    provider: 'openai',
    api: 'openai-auxiliary',
    parameters: ['width', 'height', 'count', 'quality', 'style', 'outputFormat'],
    limits: { countMax: 4, maxDimension: 4096, dimensionMultiple: null },
    requiresBaseUrl: false,
    requiresKey: true,
    keySaved: true,
};

function buildMessages() {
    const base = Date.parse('2026-10-12T09:50:00.000Z');
    return [
        { name: 'Alice Fixture', is_user: false, is_system: false, send_date: new Date(base).toISOString(), mes: 'Hello from Alice.' },
        { name: 'Modern E2E User', is_user: true, is_system: false, send_date: new Date(base + 60_000).toISOString(), mes: 'Paint the rooftop for me.' },
        { name: 'Alice Fixture', is_user: false, is_system: false, send_date: new Date(base + 120_000).toISOString(), mes: 'The moon is bright tonight.' },
    ];
}

function createImageFixture({ configured = true } = {}) {
    const fixture = createModernResourceFixture();
    fixture.settings = {
        ...fixture.settings,
        main_api: 'openai',
        extension_settings: {
            imageGeneration: { provider: 'openai', model: 'gpt-image-1', defaults: { size: '1024x1536', quality: 'high', count: 1 } },
        },
    };
    fixture.secretState = configured ? { api_key_image_generation: [{ id: 'img-1', label: 'image', value: '****', active: true }] } : {};
    fixture.chat = { metadata: { integrity: 'int-1' }, messages: buildMessages(), saves: 0 };
    fixture.chatSaves = [];
    fixture.imageCalls = [];
    return fixture;
}

/**
 * @param {import('@playwright/test').Page} page 页面。
 * @param {ReturnType<typeof createImageFixture>} fixture 夹具。
 * @param {{ generate?: (body: any, route: any) => any, requests?: (id: string) => any, cancel?: (body: any) => any }} [handlers] 生图接口的应答。
 */
async function mockImageWorkspace(page, fixture, handlers = {}) {
    await mockModernWorkspace(page, fixture);
    await page.route('**/api/characters/chats', route => fulfillJson(route, postJson(route).avatar_url === 'alice.png'
        ? [{ file_id: 'img-chat', file_name: 'img-chat.jsonl', chat_items: fixture.chat.messages.length, file_size: '2 KB', last_mes: Date.now() }]
        : []));
    await page.route('**/api/chats/search', route => fulfillJson(route, []));
    await page.route('**/api/backups/chat/get', route => fulfillJson(route, []));
    await page.route('**/api/settings/get-snapshots', route => fulfillJson(route, []));
    await page.route('**/api/chats/get', route => fulfillJson(route, [
        { chat_metadata: structuredClone(fixture.chat.metadata), user_name: 'Modern E2E User', character_name: 'unused' },
        ...structuredClone(fixture.chat.messages),
    ]));
    // 和真实后端一样检查 integrity：头里的版本比文件旧就拒绝
    await page.route('**/api/chats/save', route => {
        const payload = postJson(route);
        const [header, ...messages] = payload.chat;
        fixture.chatSaves.push({ fileName: payload.file_name, header: structuredClone(header), messages: structuredClone(messages) });
        if (header.chat_metadata?.integrity !== fixture.chat.metadata.integrity) {
            return fulfillJson(route, { error: 'integrity' }, 400);
        }
        fixture.chat.saves += 1;
        fixture.chat.metadata = { ...structuredClone(header.chat_metadata), integrity: `int-${fixture.chat.saves + 1}` };
        fixture.chat.messages = structuredClone(messages);
        return fulfillJson(route, { ok: true, integrity: fixture.chat.metadata.integrity });
    });
    await page.route(`**${API}/capabilities`, route => {
        fixture.imageCalls.push({ path: 'capabilities', body: postJson(route) });
        return fulfillJson(route, capabilities);
    });
    await page.route(`**${API}/generate`, async route => {
        const body = postJson(route);
        fixture.imageCalls.push({ path: 'generate', body });
        const reply = handlers.generate ? await handlers.generate(body, route) : completedReply(body.requestId);
        if (reply === 'handled') {
            return undefined;
        }
        return fulfillReply(route, reply);
    });
    await page.route(`**${API}/requests/*`, route => {
        const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() || '');
        fixture.imageCalls.push({ path: 'requests', id, method: route.request().method() });
        const reply = handlers.requests ? handlers.requests(id) : { status: 404, body: { error: 'request-not-found', message: 'unknown', outcome: 'unknown' } };
        return fulfillReply(route, reply);
    });
    await page.route(`**${API}/cancel`, route => {
        const body = postJson(route);
        fixture.imageCalls.push({ path: 'cancel', body });
        const reply = handlers.cancel ? handlers.cancel(body) : { requestId: body.requestId, status: 'cancelled', outcome: 'unknown' };
        return fulfillJson(route, reply);
    });
    await page.route(/^https?:\/\/[^/]+\/user\/images\//u, route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
}

function completedReply(requestId) {
    return {
        requestId,
        status: 'completed',
        images: [{ path: IMAGE_PATH, mimeType: 'image/png', bytes: PNG.length, width: 1024, height: 1536 }],
        provider: 'openai',
        model: 'gpt-image-1',
        elapsedMs: 4200,
        incomplete: 0,
    };
}

async function openChat(page) {
    await page.goto('/modern/?view=chat');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'chat');
    await expect(page.locator('.page-title')).toHaveText('聊天工作区');
    await expect(page.locator('[data-delete-chat]')).toBeVisible();
}

const toggle = page => page.locator('[data-composer-meta] [data-chat-image-mode-toggle]');
const promptBox = page => page.locator('[data-chat-image-prompt]');

async function enterImageMode(page) {
    await toggle(page).locator('[data-chat-image-mode="image"]').click();
    await expect(page.locator('.composer[data-composer-image-mode]')).toBeVisible();
}

test.describe('Chat composer image mode', () => {
    test.use({ viewport: desktopViewport });

    test('puts the text / image toggle first in the meta row and switches the composer body', async ({ page }) => {
        const fixture = createImageFixture();
        await mockImageWorkspace(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);

        const meta = page.locator('.composer [data-composer-meta]');
        await expect(meta.locator('> :first-child')).toHaveAttribute('data-chat-image-mode-toggle', '');
        await expect(toggle(page).locator('[data-chat-image-mode="text"]')).toHaveAttribute('aria-pressed', 'true');

        await enterImageMode(page);
        await expect(page.locator('[data-chat-input]')).toHaveCount(0);
        await expect(promptBox(page)).toBeFocused();
        // 图片模式下连接标签换成图片模型标签
        await expect(meta.locator('[data-connection-switcher]')).toHaveCount(0);
        await expect(meta.locator('[data-chat-image-model-chip]')).toContainText('OpenAI · gpt-image-1');
        // 参数标签按 /capabilities 过滤：OpenAI 没有反向提示词 / 种子 / 步数，所以没有「高级」
        await expect(page.locator('[data-chat-image-param="size"]')).toHaveValue('1024x1536');
        await expect(page.locator('[data-chat-image-param="quality"]')).toHaveValue('high');
        await expect(page.locator('[data-chat-image-param="count"]')).toBeVisible();
        await expect(page.locator('[data-chat-image-param="style"]')).toBeVisible();
        await expect(page.locator('[data-chat-image-advanced-toggle]')).toHaveCount(0);
        await expect(page.locator('[data-chat-image-generate]')).toBeDisabled();

        await promptBox(page).fill('a moonlit rooftop');
        await expect(page.locator('[data-chat-image-generate]')).toBeEnabled();

        // 模型标签的弹层：摘要 + 去设置中心
        await meta.locator('[data-chat-image-model-chip]').click();
        await expect(page.locator('[data-chat-image-model-popover]')).toContainText('gpt-image-1');
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-chat-image-model-popover]')).toHaveCount(0);

        // 回到文本模式，图片草稿保留
        await toggle(page).locator('[data-chat-image-mode="text"]').click();
        await expect(page.locator('[data-chat-input]')).toBeVisible();
        await enterImageMode(page);
        await expect(promptBox(page)).toHaveValue('a moonlit rooftop');
    });

    test('shows an empty state without an image model and opens the image side of 模型连接', async ({ page }) => {
        const fixture = createImageFixture({ configured: false });
        await mockImageWorkspace(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);

        await enterImageMode(page);
        const empty = page.locator('[data-chat-image-empty]');
        await expect(empty).toContainText('还没有配置图片模型');
        await expect(empty).toContainText('API Key');
        await expect(promptBox(page)).toHaveCount(0);
        await expect(page.locator('[data-chat-image-model-chip-empty]')).toContainText('未配置图片模型');

        await empty.getByRole('button', { name: '去设置中心配置' }).click();
        await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'settings');
        await expect(page.locator('[data-image-model-form]')).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('st-modern-settings-connection-view'))).toBe('image');
    });

    test('generates with Ctrl+Enter, locks text sending meanwhile and saves the image message into the chat file', async ({ page }) => {
        const fixture = createImageFixture();
        const release = createDeferred();
        await mockImageWorkspace(page, fixture, {
            generate: async body => {
                await release.promise;
                return completedReply(body.requestId);
            },
        });
        const calls = await mockBridgeFrame(page);
        await openChat(page);

        await enterImageMode(page);
        await page.locator('[data-chat-image-param="quality"]').selectOption('medium');
        await promptBox(page).fill('a moonlit rooftop');
        await promptBox(page).press('Control+Enter');

        // 生成期间：切换和图片控件禁用，状态行显示图片生成中，停止按钮可用
        await expect(page.locator('[data-chat-image-status]')).toContainText('图片生成中');
        await expect(toggle(page).locator('[data-chat-image-mode="text"]')).toBeDisabled();
        await expect(promptBox(page)).toBeDisabled();
        await expect(page.locator('[data-chat-image-cancel]')).toBeVisible();
        await expect.poll(() => fixture.imageCalls.filter(call => call.path === 'generate').length).toBe(1);
        const sent = fixture.imageCalls.find(call => call.path === 'generate').body;
        expect(sent).toMatchObject({ provider: 'openai', model: 'gpt-image-1', characterName: 'Alice Fixture', prompt: 'a moonlit rooftop', width: 1024, height: 1536, quality: 'medium', count: 1 });
        expect(sent.requestId).toMatch(/^[0-9a-f-]{36}$/u);
        expect(sent).not.toHaveProperty('negativePrompt');

        release.resolve();
        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        const saved = fixture.chatSaves[0];
        expect(saved.fileName).toBe('img-chat');
        expect(saved.messages).toHaveLength(4);
        const image = saved.messages[3];
        expect(image).toMatchObject({ name: 'Alice Fixture', is_user: false, is_system: true, mes: '' });
        expect(image.extra).toMatchObject({ media_display: 'gallery', media_index: 0, inline_image: false, image_generation: { version: 1 } });
        expect(image.extra.media).toHaveLength(1);
        expect(image.extra.media[0]).toMatchObject({ url: IMAGE_PATH, type: 'image', title: 'a moonlit rooftop', source: 'generated' });
        expect(image.extra.media[0].generation).toMatchObject({ provider: 'openai', model: 'gpt-image-1', requestId: sent.requestId, origin: 'manual' });
        // 写入后通知引擎重开这份聊天，解锁
        await expect.poll(() => calls.some(call => call.action === 'reloadChat')).toBe(true);
        await expect(page.locator('article.image-message[data-image-message-index="3"]')).toBeVisible();
        await expect(toggle(page).locator('[data-chat-image-mode="text"]')).toBeEnabled();
        await expect(page.locator('[data-chat-image-status]')).toHaveCount(0);
        expect(await page.evaluate(() => sessionStorage.getItem('st-modern-image-job'))).toBeNull();
    });

    test('polls the request after a 202 until the image is ready', async ({ page }) => {
        const fixture = createImageFixture();
        let polls = 0;
        await mockImageWorkspace(page, fixture, {
            generate: body => ({ status: 202, body: { requestId: body.requestId, status: 'pending', startedAt: Date.now() } }),
            requests: id => {
                polls += 1;
                return polls < 2 ? { requestId: id, status: 'pending', startedAt: Date.now() } : { ...completedReply(id), startedAt: Date.now() };
            },
        });
        await mockBridgeFrame(page);
        await openChat(page);

        await enterImageMode(page);
        await promptBox(page).fill('a lighthouse');
        await page.locator('[data-chat-image-generate]').click();
        await expect.poll(() => fixture.chatSaves.length, { timeout: 15_000 }).toBe(1);
        expect(fixture.imageCalls.filter(call => call.path === 'requests').every(call => call.method === 'GET')).toBe(true);
        expect(fixture.chatSaves[0].messages.at(-1).extra.media[0].url).toBe(IMAGE_PATH);
    });

    test('stop waiting calls /cancel, unlocks the composer and writes nothing', async ({ page }) => {
        const fixture = createImageFixture();
        await mockImageWorkspace(page, fixture, {
            // 不应答：模拟供应商一直没返回；页面停止后中止这次请求
            generate: () => new Promise(() => {}),
        });
        const calls = await mockBridgeFrame(page);
        await openChat(page);

        await enterImageMode(page);
        await promptBox(page).fill('a slow picture');
        await page.locator('[data-chat-image-generate]').click();
        await expect(page.locator('[data-chat-image-cancel]')).toBeVisible();
        await page.locator('[data-chat-image-cancel]').click();

        await expect.poll(() => fixture.imageCalls.filter(call => call.path === 'cancel').length).toBe(1);
        const generated = fixture.imageCalls.find(call => call.path === 'generate').body;
        expect(fixture.imageCalls.find(call => call.path === 'cancel').body).toEqual({ requestId: generated.requestId });
        await expect(page.locator('.toast').filter({ hasText: '已停止等待' })).toBeVisible();
        await expect(toggle(page).locator('[data-chat-image-mode="text"]')).toBeEnabled();
        await expect(promptBox(page)).toBeEnabled();
        expect(fixture.chatSaves).toHaveLength(0);
        // 停止不经过隐藏引擎的 STOP
        expect(calls.some(call => call.action === 'stop')).toBe(false);
    });

    test('a structured provider failure leaves a result card and saves nothing', async ({ page }) => {
        const fixture = createImageFixture();
        await mockImageWorkspace(page, fixture, {
            generate: () => ({ status: 502, body: { error: 'provider-http-error', message: 'The image provider returned HTTP 400.', detail: 'content policy violation', outcome: 'unknown' } }),
        });
        await mockBridgeFrame(page);
        await openChat(page);

        await enterImageMode(page);
        await promptBox(page).fill('something blocked');
        await page.locator('[data-chat-image-generate]').click();
        await expect(page.locator('[data-image-job]')).toBeVisible();
        await expect(page.locator('[data-image-job]')).toContainText('content policy violation');
        expect(fixture.imageCalls.filter(call => call.path === 'requests')).toHaveLength(0);
        expect(fixture.chatSaves).toHaveLength(0);
        await expect(promptBox(page)).toBeEnabled();
    });
});
