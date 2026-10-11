import { deflateSync } from 'node:zlib';
import { test, expect } from '@playwright/test';
import { createModernResourceFixture, mockBridgeFrame, mockModernWorkspace } from './modern-test-utils.js';

// 会话内生图 · 图片消息展示（WP3）：图片卡片、版本切换（写回 extra.media_index）、大图浮层、两步删除。
// 聊天文件里预置一条有两个版本的图片消息；/user/images/** 返回真实 PNG 字节，引擎用 mockBridgeFrame 替身。
// 生成中 / 失败 / 结果未知卡片依赖 WP2 的生成流程，渲染由 tests/modern-chat-image-message.test.js 覆盖。

const desktopViewport = { width: 1440, height: 900 };

const PATH_1 = '/user/images/Alice Fixture/莉亚 1_2026-10-12@00h19m24s_1.png';
const PATH_2 = '/user/images/Alice Fixture/莉亚 1_2026-10-12@00h21m02s_1.png';
const PROMPT_1 = 'a lighthouse at dawn';
const PROMPT_2 = 'a lighthouse at dawn, second take';

// ---------- 生成测试用 PNG（纯色，64×96） ----------
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
    header[8] = 8; // bit depth
    header[9] = 2; // truecolor RGB
    const row = Buffer.from([0, ...Array.from({ length: width }, () => [r, g, b]).flat()]);
    const raw = Buffer.concat(Array.from({ length: height }, () => row));
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', header),
        pngChunk('IDAT', deflateSync(raw)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

const PNG_BY_PATH = {
    [PATH_1]: solidPng(64, 96, [40, 120, 200]),
    [PATH_2]: solidPng(64, 96, [200, 120, 40]),
};

// ---------- 聊天文件 ----------
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

function createDeferred() {
    /** @type {(value?: unknown) => void} */
    let resolve = () => {};
    const promise = new Promise(settle => {
        resolve = settle;
    });
    return { promise, resolve };
}

function mediaItem(url, prompt, requestId) {
    return {
        url,
        type: 'image',
        title: prompt,
        negative: 'blurry, watermark',
        source: 'generated',
        generation_type: 'free',
        generation: {
            provider: 'openai',
            model: 'gpt-image-1',
            params: { width: 1024, height: 1536, quality: 'high' },
            width: 1024,
            height: 1536,
            mimeType: 'image/png',
            requestId,
            origin: 'manual',
            sourceCount: 0,
            elapsedMs: 12_400,
            createdAt: '2026-10-12T00:19:24.000Z',
        },
    };
}

// 0 开场白，1 用户，2 回复，3 图片消息（两个版本，显示第二个）
function buildMessages() {
    const base = Date.parse('2026-10-12T00:10:00.000Z');
    return [
        { name: 'Alice Fixture', is_user: false, is_system: false, send_date: new Date(base).toISOString(), mes: 'Hello from Alice.' },
        { name: 'Modern E2E User', is_user: true, is_system: false, send_date: new Date(base + 60_000).toISOString(), mes: 'Paint the lighthouse for me.' },
        { name: 'Alice Fixture', is_user: false, is_system: false, send_date: new Date(base + 120_000).toISOString(), mes: 'Here is how it looks at dawn.' },
        {
            name: 'Alice Fixture',
            is_user: false,
            is_system: true,
            send_date: '2026-10-12T00:19:24.000Z',
            mes: '',
            extra: {
                media: [mediaItem(PATH_1, PROMPT_1, 'req-1'), mediaItem(PATH_2, PROMPT_2, 'req-2')],
                media_display: 'gallery',
                media_index: 1,
                inline_image: false,
                image_generation: { version: 1 },
            },
        },
    ];
}

function createImageChatFixture() {
    const fixture = createModernResourceFixture();
    const now = Date.now();
    fixture.chatLists = {
        'alice.png': [{ file_id: 'img-chat', file_name: 'img-chat.jsonl', chat_items: 4, file_size: '4 KB', last_mes: now }],
        'bruno.png': [],
    };
    fixture.seed = buildMessages();
    fixture.files = {
        'img-chat': { metadata: { integrity: 'int-1' }, messages: structuredClone(fixture.seed), saves: 0 },
    };
    fixture.chatSaves = [];
    return fixture;
}

async function mockImageChatRoutes(page, fixture) {
    await mockModernWorkspace(page, fixture);
    await page.route('**/api/characters/chats', route => fulfillJson(route, fixture.chatLists[postJson(route).avatar_url] || []));
    await page.route('**/api/chats/search', route => fulfillJson(route, []));
    await page.route('**/api/backups/chat/get', route => fulfillJson(route, []));
    await page.route('**/api/settings/get-snapshots', route => fulfillJson(route, []));
    await page.route('**/api/chats/get', route => {
        const file = fixture.files[stripJsonlExtension(postJson(route).file_name)];
        return fulfillJson(route, [
            { chat_metadata: structuredClone(file.metadata), user_name: 'Modern E2E User', character_name: 'unused' },
            ...structuredClone(file.messages),
        ]);
    });
    // 保存和真实后端一样检查版本：头里的 integrity 比文件旧就拒绝
    await page.route('**/api/chats/save', route => {
        const payload = postJson(route);
        const file = fixture.files[stripJsonlExtension(payload.file_name)];
        const [header, ...messages] = payload.chat;
        fixture.chatSaves.push({ chatId: stripJsonlExtension(payload.file_name), header: structuredClone(header), messages: structuredClone(messages) });
        if (header.chat_metadata?.integrity !== file.metadata.integrity) {
            return fulfillJson(route, { error: 'integrity' });
        }
        file.saves += 1;
        file.metadata = { ...structuredClone(header.chat_metadata), integrity: `int-${file.saves + 1}` };
        file.messages = structuredClone(messages);
        return fulfillJson(route, { ok: true, integrity: file.metadata.integrity });
    });

    // 只拦站点根下的 /user/images/，记录解码后的路径
    const imageRequests = [];
    await page.route(/^https?:\/\/[^/]+\/user\/images\//u, route => {
        const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
        imageRequests.push(pathname);
        const body = PNG_BY_PATH[pathname];
        return body
            ? route.fulfill({ status: 200, contentType: 'image/png', body })
            : route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' });
    });
    return { imageRequests };
}

async function stubClipboard(page) {
    const writes = [];
    await page.exposeFunction('recordImageClipboardWrite', value => {
        writes.push(value);
    });
    await page.addInitScript(`
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: async value => {
                    window.recordImageClipboardWrite(value);
                },
            },
        });
    `);
    return writes;
}

async function openChat(page) {
    await page.goto('/modern/?view=chat');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'chat');
    await expect(page.locator('.page-title')).toHaveText('聊天工作区');
    await expect(page.locator('[data-delete-chat]')).toBeVisible();
}

const imageCard = page => page.locator('article.image-message[data-image-message-index="3"]');
const lightbox = page => page.locator('[data-image-lightbox]');

test.describe('Image message display', () => {
    test.use({ viewport: desktopViewport });

    test('shows the image card with its tags, the current version, the collapsed prompt, the parameters and the actions', async ({ page }) => {
        const fixture = createImageChatFixture();
        const { imageRequests } = await mockImageChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);

        const card = imageCard(page);
        await expect(card).toBeVisible();
        await expect(card.locator('.message-meta strong')).toHaveText('Alice Fixture');
        await expect(card.locator('.image-message-tag')).toHaveText(['图片', '不进入上下文']);
        await expect(card.locator('.image-message-tag').nth(1)).toHaveAttribute('title', '保存为 is_system 消息，后续文本回复看不到它');
        await expect(card.locator('[data-image-message-version-label]')).toHaveText('2/2');
        await expect(card.locator('[data-image-message-direction="-1"]')).toBeEnabled();
        await expect(card.locator('[data-image-message-direction="1"]')).toBeDisabled();

        // one image, the second version, loaded through the encoded path (spaces and CJK)
        const image = card.locator('.image-message-image');
        await expect(image).toHaveCount(1);
        await expect(image).toHaveAttribute('src', encodeURI(PATH_2));
        await expect(image).toHaveAttribute('alt', `生成的图片：${PROMPT_2}`);
        await expect.poll(() => image.evaluate(element => /** @type {HTMLImageElement} */ (element).naturalWidth)).toBe(64);
        expect(imageRequests).toContain(PATH_2);
        expect(imageRequests).not.toContain(PATH_1);
        // the image message does not fall back to the generic media grid
        await expect(card.locator('.message-media-grid')).toHaveCount(0);

        const prompt = card.locator('[data-image-message-prompt]');
        await expect(prompt.locator('summary')).toHaveText('提示词 · 手动输入');
        await expect(prompt.locator('.image-message-prompt-text').first()).toBeHidden();
        await prompt.locator('summary').click();
        await expect(prompt.locator('.image-message-prompt-text').first()).toHaveText(PROMPT_2);
        await expect(card.locator('[data-image-message-info]')).toHaveText('OpenAI · gpt-image-1 · 1024×1536 · 质量 高 · 耗时 12 秒');

        await expect(card.locator('[data-image-message-regenerate="3"]')).toBeEnabled();
        await expect(card.locator('[data-image-message-edit="3"]')).toBeVisible();
        await expect(card.locator('[data-image-message-copy="3"]')).toBeVisible();
        const download = card.locator('[data-image-message-download="3"]');
        await expect(download).toHaveAttribute('href', encodeURI(PATH_2));
        await expect(download).toHaveAttribute('download', '');
        await expect(card.locator('[data-delete-message="3"]')).toHaveAttribute('aria-label', '编辑或删除消息');
        expect(fixture.chatSaves).toHaveLength(0);
    });

    test('switches the version, saves only media_index, keeps the prompt open, and asks the engine to reopen the chat', async ({ page }) => {
        const fixture = createImageChatFixture();
        await mockImageChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page);
        await openChat(page);

        const card = imageCard(page);
        await card.locator('[data-image-message-prompt] summary').click();
        await expect(card.locator('[data-image-message-prompt]')).toHaveAttribute('open', '');
        await card.locator('[data-image-message-direction="-1"]').click();

        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        const [save] = fixture.chatSaves;
        expect(save.header.chat_metadata.integrity).toBe('int-1');
        expect(save.messages).toHaveLength(4);
        expect(save.messages.slice(0, 3)).toEqual(fixture.seed.slice(0, 3));
        expect(save.messages[3]).toEqual({ ...fixture.seed[3], extra: { ...fixture.seed[3].extra, media_index: 0 } });

        await expect(card.locator('[data-image-message-version-label]')).toHaveText('1/2');
        await expect(card.locator('.image-message-image')).toHaveAttribute('src', encodeURI(PATH_1));
        await expect(card.locator('[data-image-message-direction="-1"]')).toBeDisabled();
        await expect(card.locator('[data-image-message-direction="1"]')).toBeEnabled();
        // the re-render kept the expanded prompt open and shows the first version's prompt
        await expect(card.locator('[data-image-message-prompt]')).toHaveAttribute('open', '');
        await expect(card.locator('[data-image-message-prompt] .image-message-prompt-text').first()).toHaveText(PROMPT_1);
        await expect.poll(() => calls.filter(call => call.action === 'reloadChat').map(call => call.payload)).toEqual([{ avatar: 'alice.png', chat: 'img-chat' }]);

        // the revision issued by the first save is used for the next one
        await card.locator('[data-image-message-direction="1"]').click();
        await expect.poll(() => fixture.chatSaves.length).toBe(2);
        expect(fixture.chatSaves[1].header.chat_metadata.integrity).toBe('int-2');
        expect(fixture.files['img-chat'].messages[3].extra.media_index).toBe(1);
        await expect(card.locator('[data-image-message-version-label]')).toHaveText('2/2');
    });

    test('cannot switch versions or regenerate while a reply is being generated', async ({ page }) => {
        const fixture = createImageChatFixture();
        await mockImageChatRoutes(page, fixture);
        const generateGate = createDeferred();
        const calls = await mockBridgeFrame(page, {
            replies: { generate: async ({ chat }) => (await generateGate.promise, { chat: `${stripJsonlExtension(chat)}.jsonl`, messageCount: 4, saved: true }) },
        });
        await openChat(page);
        await page.locator('[data-chat-input]').fill('one more detail please');
        await page.locator('[data-send-message]').click();
        await expect.poll(() => calls.filter(call => call.action === 'generate').length).toBe(1);

        const card = imageCard(page);
        await expect(card.locator('[data-image-message-direction="-1"]')).toBeDisabled();
        await expect(card.locator('[data-image-message-direction="-1"]')).toHaveAttribute('title', '生成中不能切换版本');
        await expect(card.locator('[data-image-message-regenerate="3"]')).toBeDisabled();
        // viewing and copying stay available
        await expect(card.locator('[data-image-message-copy="3"]')).toBeEnabled();
        await card.locator('[data-image-message-open="3"]').click();
        await expect(lightbox(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(lightbox(page)).toHaveCount(0);
        expect(fixture.chatSaves).toHaveLength(0);

        generateGate.resolve();
        await expect(card.locator('[data-image-message-direction="-1"]')).toBeEnabled();
    });

    test('opens the lightbox with the full prompt, parameters and file path; copy, browse versions, Esc and the backdrop', async ({ page }) => {
        const fixture = createImageChatFixture();
        await mockImageChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        const clipboardWrites = await stubClipboard(page);
        await openChat(page);

        await imageCard(page).locator('[data-image-message-open="3"]').click();
        const box = lightbox(page);
        await expect(box).toBeVisible();
        await expect(box).toHaveAttribute('role', 'dialog');
        await expect(box.locator('[data-image-lightbox-close="icon"]')).toBeFocused();
        await expect(box.locator('[data-image-lightbox-image]')).toHaveAttribute('src', encodeURI(PATH_2));
        await expect(box.locator('[data-image-lightbox-prompt]')).toHaveText(PROMPT_2);
        await expect(box.locator('[data-image-lightbox-negative]')).toHaveText('blurry, watermark');
        await expect(box.locator('[data-image-lightbox-path]')).toHaveText(PATH_2);
        await expect(box.locator('.image-lightbox-meta')).toContainText('供应商OpenAI');
        await expect(box.locator('.image-lightbox-meta')).toContainText('尺寸1024×1536');
        await expect(box.locator('.image-lightbox-meta')).toContainText('版本2/2');
        await expect(box.locator('[data-image-lightbox-download]')).toHaveAttribute('href', encodeURI(PATH_2));

        await box.locator('[data-image-lightbox-copy]').click();
        await expect.poll(() => clipboardWrites).toEqual([PROMPT_2]);
        await expect(page.locator('.toast-stack')).toContainText('提示词已复制');

        // browsing versions inside the lightbox does not change the message or the chat file
        await box.locator('[data-image-lightbox-step="-1"]').click();
        await expect(box.locator('[data-image-lightbox-image]')).toHaveAttribute('src', encodeURI(PATH_1));
        await expect(box.locator('[data-image-lightbox-prompt]')).toHaveText(PROMPT_1);
        await box.locator('[data-image-lightbox-copy]').click();
        await expect.poll(() => clipboardWrites).toEqual([PROMPT_2, PROMPT_1]);
        await expect(imageCard(page).locator('[data-image-message-version-label]')).toHaveText('2/2');
        expect(fixture.chatSaves).toHaveLength(0);

        await page.keyboard.press('Escape');
        await expect(box).toHaveCount(0);

        // clicks inside the side panel keep it open; the backdrop around the image closes it
        await imageCard(page).locator('[data-image-message-open="3"]').click();
        await box.locator('.image-lightbox-head h3').click();
        await expect(box).toBeVisible();
        await box.locator('[data-image-lightbox-image]').click();
        await expect(box).toBeVisible();
        await box.locator('.image-lightbox-stage').click({ position: { x: 8, y: 8 } });
        await expect(box).toHaveCount(0);

        await imageCard(page).locator('[data-image-message-open="3"]').click();
        await box.locator('[data-image-lightbox-close="button"]').click();
        await expect(box).toHaveCount(0);
    });

    test('copies the prompt from the card', async ({ page }) => {
        const fixture = createImageChatFixture();
        await mockImageChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        const clipboardWrites = await stubClipboard(page);
        await openChat(page);

        await imageCard(page).locator('[data-image-message-copy="3"]').click();
        await expect.poll(() => clipboardWrites).toEqual([PROMPT_2]);
        await expect(page.locator('.toast-stack')).toContainText('提示词已复制');
    });

    test('deletes the whole image message with the existing two-step delete', async ({ page }) => {
        const fixture = createImageChatFixture();
        await mockImageChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page);
        await openChat(page);

        const card = imageCard(page);
        await card.locator('[data-delete-message="3"]').click();
        const panel = card.locator('.message-delete-panel');
        await expect(panel).toBeVisible();
        // an image message has no text to edit
        await expect(panel.locator('[data-edit-message]')).toBeHidden();
        await panel.locator('[data-request-message-delete]').click();
        await expect(panel.locator('.message-delete-question')).toBeVisible();
        await panel.locator('[data-confirm-message-delete]').click();

        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        expect(fixture.chatSaves[0].messages).toEqual(fixture.seed.slice(0, 3));
        await expect(page.locator('article.image-message')).toHaveCount(0);
        await expect.poll(() => calls.filter(call => call.action === 'reloadChat').map(call => call.payload)).toEqual([{ avatar: 'alice.png', chat: 'img-chat' }]);
    });
});
