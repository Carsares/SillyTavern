/* global window, document, getComputedStyle, localStorage */
import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';
import {
    buildBackgroundCssUrl,
    buildChatImageCssUrl,
    clampChatBackgroundDim,
    ensureChatBackgroundState,
    findBackgroundReferences,
    isTransparentBackground,
    parseBackgroundCssUrl,
    readChatBackgroundPrefs,
    resolveChatBackground,
    writeChatBackgroundPrefs,
} from '../public/modern/core/chat-background.js';
import { createModernResourceFixture, mockBridgeFrame, mockModernWorkspace } from './modern-test-utils.js';

// 聊天背景（B5）。前半部分是 core/chat-background.js 的纯函数测试（不开页面）；
// 后半部分在聊天页和素材库里驱动界面，断言背景样式、保存请求体和对引擎的同步。

const desktopViewport = { width: 1440, height: 900 };
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test.describe('chat background pure functions', () => {
    test('builds the same css values as the legacy page', () => {
        expect(buildBackgroundCssUrl('castle.png')).toBe('url("backgrounds/castle.png")');
        expect(buildBackgroundCssUrl('city night (1).png')).toBe('url("backgrounds/city%20night%20(1).png")');
        expect(buildChatImageCssUrl('/user/images/Alice Fixture/a.png')).toBe('url("/user/images/Alice%20Fixture/a.png")');
    });

    test('parses legacy values and re-encodes them into a safe site path', () => {
        expect(parseBackgroundCssUrl('url("backgrounds/castle.png")')).toEqual({
            url: '/backgrounds/castle.png',
            relativePath: 'backgrounds/castle.png',
            name: 'castle.png',
            kind: 'system',
        });
        expect(parseBackgroundCssUrl('url(\'backgrounds/a%20b.png\')')?.relativePath).toBe('backgrounds/a b.png');
        expect(parseBackgroundCssUrl('url(backgrounds/plain.png)')?.url).toBe('/backgrounds/plain.png');
        expect(parseBackgroundCssUrl('  URL( "backgrounds/spaced.png" )  ')?.url).toBe('/backgrounds/spaced.png');
        // 旧版聊天专属图的路径带一个前导斜杠
        expect(parseBackgroundCssUrl('url("/user/images/Alice%20Fixture/a.png")')).toEqual({
            url: '/user/images/Alice%20Fixture/a.png',
            relativePath: 'user/images/Alice Fixture/a.png',
            name: 'a.png',
            kind: 'chat',
        });
        expect(parseBackgroundCssUrl('url("user/images/x/中文.png")')?.url).toBe('/user/images/x/%E4%B8%AD%E6%96%87.png');
        // 文件名里的括号和引号是合法字符，但输出里一律编码，不会截断 CSS
        expect(parseBackgroundCssUrl('url("backgrounds/image%20(1).png")')?.url).toBe('/backgrounds/image%20%281%29.png');
        expect(parseBackgroundCssUrl('url("backgrounds/it\'s.png")')?.url).toBe('/backgrounds/it%27s.png');
        expect(parseBackgroundCssUrl('url("/backgrounds/leading.png")')?.relativePath).toBe('backgrounds/leading.png');
    });

    test('rejects external, scheme, traversal and css-injection values', () => {
        const malicious = [
            'url("http://evil.test/a.png")',
            'url("https://evil.test/a.png")',
            'url(http://evil.test/a.png)',
            'url("//evil.test/a.png")',
            'url("data:image/png;base64,AAAA")',
            'url("javascript:alert(1)")',
            'url("file:///etc/passwd")',
            'url("backgrounds/../secret.png")',
            'url("backgrounds/%2e%2e/secret.png")',
            'url("backgrounds/..%2Fsecret.png")',
            'url("backgrounds/a/./b.png")',
            'url("/etc/passwd")',
            'url("other/a.png")',
            'url("backgrounds")',
            'url("backgrounds/")',
            'url("user/images")',
            'url("user/images/")',
            'url("backgrounds//a.png")',
            'url("backgrounds\\\\a.png")',
            'url("backgrounds/%E0%A4%A.png")',
            'url("backgrounds/a.png"); background: red',
            'url("backgrounds/a.png") , url(http://evil.test/x)',
            'url("backgrounds/a.png" , url(http://evil.test/x))',
            'url("backgrounds/a.png")url("http://evil.test/x")',
            'url("backgrounds/a.png\\")',
            'url("backgrounds/a.png',
            'url(backgrounds/a b.png)',
            'url(backgrounds/a(1).png)',
            'url("backgrounds/a\nb.png")',
            'url("backgrounds/a%0Ab.png")',
            'url()',
            'url("")',
            'url(" ")',
            'backgrounds/a.png',
            'background-image: url("backgrounds/a.png")',
            '',
            '   ',
            null,
            undefined,
            42,
            {},
            ['url("backgrounds/a.png")'],
            `url("backgrounds/${'a'.repeat(1100)}.png")`,
        ];
        for (const value of malicious) {
            expect(parseBackgroundCssUrl(value), String(value)).toBeNull();
        }
    });

    test('the parsed url never contains characters that can break out of url(...)', () => {
        const values = ['url("backgrounds/a\'b(c).png")', 'url("backgrounds/a%27%29%3B.png")', 'url("backgrounds/a b.png")'];
        for (const value of values) {
            expect(parseBackgroundCssUrl(value)?.url, value).toMatch(/^\/[A-Za-z0-9%._~/-]+$/u);
        }
        // %22（引号）会被拒绝，其余合法文件名全部编码输出
        expect(parseBackgroundCssUrl('url("backgrounds/a%22b.png")')).toBeNull();
        expect(parseBackgroundCssUrl('url("backgrounds/a%27%29%3B.png")')?.url).toBe('/backgrounds/a%27%29%3B.png');
    });

    test('the transparent placeholder means no background', () => {
        expect(isTransparentBackground(parseBackgroundCssUrl('url("backgrounds/__transparent.png")'))).toBe(true);
        expect(isTransparentBackground(parseBackgroundCssUrl('url("backgrounds/castle.png")'))).toBe(false);
        expect(isTransparentBackground(parseBackgroundCssUrl('url("/user/images/x/__transparent.png")'))).toBe(false);
        expect(isTransparentBackground(null)).toBe(false);
    });

    test('resolves chat lock over global over none', () => {
        const settings = { background: { name: 'castle.png', url: 'url("backgrounds/castle.png")', fitting: 'cover' } };
        const lock = 'url("backgrounds/forest.webp")';

        expect(resolveChatBackground({ settings, chatMetadata: { custom_background: lock } })).toMatchObject({
            source: 'chat', path: '/backgrounds/forest.webp', file: 'backgrounds/forest.webp', fitting: 'cover', kind: 'system', locked: true,
        });
        expect(resolveChatBackground({ settings, chatMetadata: {} })).toMatchObject({
            source: 'global', path: '/backgrounds/castle.png', fitting: 'cover', locked: false, lockFailed: false,
        });
        expect(resolveChatBackground({ settings: {}, chatMetadata: {} })).toMatchObject({ source: 'none', path: '', fitting: 'classic' });
        expect(resolveChatBackground()).toMatchObject({ source: 'none', path: '' });
        expect(resolveChatBackground({ settings, chatMetadata: null })).toMatchObject({ source: 'global' });
    });

    test('ignores an invalid lock and an invalid global value', () => {
        const settings = { background: { name: 'castle.png', url: 'url("backgrounds/castle.png")' } };
        const result = resolveChatBackground({ settings, chatMetadata: { custom_background: 'url("http://evil.test/x.png")' } });
        expect(result).toMatchObject({ source: 'global', path: '/backgrounds/castle.png', locked: false });

        // 全局值被改成外链：不退回 name，直接当没有背景
        const badGlobal = { background: { name: 'castle.png', url: 'url("javascript:alert(1)")' } };
        expect(resolveChatBackground({ settings: badGlobal, chatMetadata: {} }).source).toBe('none');
        // url 缺省时才用 name
        expect(resolveChatBackground({ settings: { background: { name: 'castle.png' } }, chatMetadata: {} })).toMatchObject({ source: 'global', path: '/backgrounds/castle.png' });
    });

    test('treats __transparent.png as none for both the global and the chat lock', () => {
        const transparent = 'url("backgrounds/__transparent.png")';
        const global = { background: { name: '__transparent.png', url: transparent, fitting: 'classic' } };
        expect(resolveChatBackground({ settings: global, chatMetadata: {} })).toMatchObject({ source: 'none', path: '' });

        // 聊天锁定为透明图：即使全局有背景，这个聊天也不显示
        const settings = { background: { name: 'castle.png', url: 'url("backgrounds/castle.png")' } };
        expect(resolveChatBackground({ settings, chatMetadata: { custom_background: transparent } })).toMatchObject({
            source: 'none', path: '', locked: true, lockedNone: true,
        });
    });

    test('skips paths that failed to load and falls back one level', () => {
        const settings = { background: { name: 'castle.png', url: 'url("backgrounds/castle.png")' } };
        const chatMetadata = { custom_background: 'url("backgrounds/missing.png")' };

        expect(resolveChatBackground({ settings, chatMetadata, failedPaths: { '/backgrounds/missing.png': true } })).toMatchObject({
            source: 'global', path: '/backgrounds/castle.png', locked: true, lockFailed: true,
        });
        expect(resolveChatBackground({ settings, chatMetadata, failedPaths: new Set(['/backgrounds/missing.png', '/backgrounds/castle.png']) })).toMatchObject({
            source: 'none', path: '', locked: true, lockFailed: true,
        });
        expect(resolveChatBackground({ settings, chatMetadata, failedPaths: ['/backgrounds/other.png'] }).source).toBe('chat');
    });

    test('normalizes the fitting value', () => {
        const chatMetadata = { custom_background: 'url("backgrounds/a.png")' };
        for (const fitting of ['classic', 'cover', 'contain', 'stretch', 'center']) {
            expect(resolveChatBackground({ settings: { background: { fitting } }, chatMetadata }).fitting).toBe(fitting);
        }
        expect(resolveChatBackground({ settings: { background: { fitting: 'zoom' } }, chatMetadata }).fitting).toBe('classic');
        expect(resolveChatBackground({ settings: { background: { fitting: { x: 1 } } }, chatMetadata }).fitting).toBe('classic');
    });

    test('finds references by name, by url and by chat lock', () => {
        const settings = { background: { name: 'castle.png', url: 'url("backgrounds/castle.png")' } };
        expect(findBackgroundReferences({ settings, chatMetadata: {}, filename: 'castle.png' })).toEqual({ global: true, chat: false });
        expect(findBackgroundReferences({ settings, chatMetadata: { custom_background: 'url(\'backgrounds/forest.webp\')' }, filename: 'forest.webp' })).toEqual({ global: false, chat: true });
        expect(findBackgroundReferences({ settings: { background: { name: 'x.png', url: 'url("backgrounds/castle.png")' } }, filename: 'castle.png' }).global).toBe(true);
        expect(findBackgroundReferences({ settings, chatMetadata: null, filename: 'other.png' })).toEqual({ global: false, chat: false });
        expect(findBackgroundReferences({ settings, chatMetadata: {}, filename: '' })).toEqual({ global: false, chat: false });
    });

    test('keeps display preferences in range and tolerates a broken storage', () => {
        expect(clampChatBackgroundDim(30)).toBe(30);
        expect(clampChatBackgroundDim('45.4')).toBe(45);
        expect(clampChatBackgroundDim(-5)).toBe(0);
        expect(clampChatBackgroundDim(500)).toBe(90);
        expect(clampChatBackgroundDim('abc')).toBe(55);
        expect(clampChatBackgroundDim('')).toBe(55);

        const values = new Map();
        const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
        expect(readChatBackgroundPrefs(storage)).toEqual({ enabled: true, dim: 55 });
        writeChatBackgroundPrefs(storage, { enabled: false, dim: 20 });
        expect(values.get('st-modern-chat-bg-enabled')).toBe('0');
        expect(values.get('st-modern-chat-bg-dim')).toBe('20');
        expect(readChatBackgroundPrefs(storage)).toEqual({ enabled: false, dim: 20 });
        writeChatBackgroundPrefs(storage, { dim: 999 });
        expect(readChatBackgroundPrefs(storage).dim).toBe(90);

        const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
        expect(readChatBackgroundPrefs(broken)).toEqual({ enabled: true, dim: 55 });
        expect(() => writeChatBackgroundPrefs(broken, { enabled: true, dim: 10 })).not.toThrow();
        expect(readChatBackgroundPrefs(null)).toEqual({ enabled: true, dim: 55 });
    });

    test('fills the state skeleton once and keeps later changes', () => {
        const state = { chatBackground: {} };
        const storage = { getItem: key => ({ 'st-modern-chat-bg-dim': '25' })[key] };
        const first = ensureChatBackgroundState(state, storage);
        expect(first).toMatchObject({ enabled: true, dim: 25, failed: {}, verified: {}, query: '', busy: false });
        first.dim = 70;
        expect(ensureChatBackgroundState(state, storage).dim).toBe(70);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 页面测试

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

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createMessages() {
    const now = Date.now();
    return Array.from({ length: 6 }, (_, index) => ({
        name: index % 2 ? 'Alice Fixture' : 'Modern E2E User',
        is_user: index % 2 === 0,
        mes: `background message ${index + 1}`,
        send_date: now - (6 - index) * 1000,
    }));
}

const defaultImages = [
    { filename: '__transparent.png', isAnimated: false },
    { filename: 'castle.png', isAnimated: false },
    { filename: 'city night.png', isAnimated: false },
    { filename: 'forest.webp', isAnimated: false },
    { filename: 'rain.gif', isAnimated: true },
];

function createChatBackgroundFixture({ background, metadata = {}, images = defaultImages } = {}) {
    const fixture = createModernResourceFixture({ backgrounds: { images: clone(images) } });
    if (background !== undefined) {
        fixture.settings.background = background;
    }
    fixture.chatFile = { id: 'bg-chat', metadata: { integrity: 'int-1', ...clone(metadata) }, messages: createMessages(), revision: 1 };
    // 默认夹具里的群聊 group-alpha：它的聊天文件和角色聊天互不相干
    fixture.groupChatFile = { id: 'alpha-chat', metadata: { integrity: 'int-1' }, messages: createMessages(), revision: 1 };
    fixture.groupChatSaves = [];
    fixture.chatSaves = [];
    fixture.imageUploads = [];
    fixture.backgroundWrites = { renames: [], deletes: [] };
    return fixture;
}

const castleGlobal = { name: 'castle.png', url: 'url("backgrounds/castle.png")', fitting: 'cover', animation: false };

/**
 * 聊天文件、图片、素材接口和引擎替身。图片请求按路径记录；missingImages 里的路径返回 404。
 * @returns {Promise<{ bridge: any[], imageRequests: string[] }>} 引擎请求记录和图片请求路径。
 */
async function mockBackgroundWorkspace(page, fixture, { missingImages = [] } = {}) {
    await mockModernWorkspace(page, fixture);
    const file = fixture.chatFile;
    const chatListItem = () => ({ file_id: file.id, file_name: `${file.id}.jsonl`, chat_items: file.messages.length, file_size: '2 KB', last_mes: file.messages.at(-1).send_date });
    await page.route('**/api/characters/chats', route => fulfillJson(route, { 'alice.png': [chatListItem()] }[postJson(route).avatar_url] || []));
    const groupFile = fixture.groupChatFile;
    const groupListItem = () => ({ file_id: groupFile.id, file_name: `${groupFile.id}.jsonl`, chat_items: groupFile.messages.length, file_size: '2 KB', last_mes: groupFile.messages.at(-1).send_date });
    await page.route('**/api/chats/search', route => fulfillJson(route, { 'group-alpha': [groupListItem()] }[postJson(route).group_id] || []));
    await page.route('**/api/chats/group/get', route => fulfillJson(route, [
        { chat_metadata: clone(groupFile.metadata), user_name: 'Modern E2E User', character_name: 'unused' },
        ...clone(groupFile.messages),
    ]));
    await page.route('**/api/chats/group/save', route => {
        const payload = postJson(route);
        const [header, ...messages] = payload.chat;
        fixture.groupChatSaves.push(clone(payload));
        if (header.chat_metadata?.integrity !== groupFile.metadata.integrity) {
            return fulfillJson(route, { error: 'integrity' });
        }
        groupFile.revision += 1;
        groupFile.metadata = { ...clone(header.chat_metadata), integrity: `int-${groupFile.revision}` };
        groupFile.messages = messages;
        return fulfillJson(route, { ok: true, integrity: groupFile.metadata.integrity });
    });
    await page.route('**/api/chats/get', route => fulfillJson(route, [
        { chat_metadata: clone(file.metadata), user_name: 'Modern E2E User', character_name: 'Alice Fixture' },
        ...clone(file.messages),
    ]));
    await page.route('**/api/chats/save', route => {
        const payload = postJson(route);
        const [header, ...messages] = payload.chat;
        fixture.chatSaves.push(clone(payload));
        if (header.chat_metadata?.integrity !== file.metadata.integrity) {
            return fulfillJson(route, { error: 'integrity' });
        }
        file.revision += 1;
        file.metadata = { ...clone(header.chat_metadata), integrity: `int-${file.revision}` };
        file.messages = messages;
        return fulfillJson(route, { ok: true, integrity: file.metadata.integrity });
    });
    await page.route('**/api/backups/chat/get', route => fulfillJson(route, []));
    await page.route('**/api/images/upload', route => {
        const payload = postJson(route);
        fixture.imageUploads.push(clone(payload));
        return fulfillJson(route, { path: `/user/images/${payload.ch_name}/${payload.filename}.${payload.format}` });
    });
    await page.route('**/api/backgrounds/rename', route => {
        const payload = postJson(route);
        fixture.backgroundWrites.renames.push(clone(payload));
        fixture.backgrounds.images = fixture.backgrounds.images.map(image => (image.filename === payload.old_bg ? { ...image, filename: payload.new_bg } : image));
        return fulfillJson(route, { name: payload.new_bg });
    });
    await page.route('**/api/backgrounds/delete', route => {
        const payload = postJson(route);
        fixture.backgroundWrites.deletes.push(clone(payload));
        fixture.backgrounds.images = fixture.backgrounds.images.filter(image => image.filename !== payload.bg);
        return fulfillJson(route, { ok: true });
    });

    // 只拦站点根下的 /backgrounds/ 和 /user/images/，不碰 /api/backgrounds/...
    const imageRequests = [];
    await page.route(/^https?:\/\/[^/]+\/(?:backgrounds|user\/images)\//u, route => {
        const pathname = new URL(route.request().url()).pathname;
        imageRequests.push(pathname);
        if (missingImages.includes(pathname)) {
            return route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' });
        }
        return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
    });

    const bridge = await mockBridgeFrame(page);
    return { bridge, imageRequests };
}

// 其他聊天工具的面板此刻是否可用取决于别的功能，这里把它们关掉，只留聊天背景
async function isolateBackgroundTool(page) {
    await page.addInitScript(() => {
        window.__modernTestFlags = { chatTools: { 'authors-note': false, summary: false } };
    });
}

async function openChat(page) {
    await page.goto('/modern/?view=chat');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'chat');
    await expect(page.locator('.page-title')).toHaveText('聊天工作区');
    await expect(page.locator('.message-list .message')).toHaveCount(6);
}

async function openBackgroundTool(page) {
    await page.locator('.detail-actions [data-chat-tools-toggle]').click();
    await page.locator('[data-chat-tools-tab="background"]').click();
    await expect(page.locator('[data-chat-bg-panel]')).toBeVisible();
}

async function goToAssets(page) {
    await page.locator('[data-route="assets"]').click();
    await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'assets');
    await expect(page.locator('.page-title')).toHaveText('素材库');
    await expect(page.locator('.background-card').first()).toBeVisible();
}

async function goToChat(page) {
    await page.locator('[data-route="chat"]').click();
    await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'chat');
    await expect(page.locator('.message-list .message')).toHaveCount(6);
}

function backdropState(page) {
    return page.evaluate(() => {
        const backdrop = document.querySelector('.chat-backdrop');
        return backdrop ? {
            source: backdrop.getAttribute('data-chat-bg-source'),
            path: backdrop.getAttribute('data-chat-bg-path'),
            fit: backdrop.getAttribute('data-fit'),
        } : null;
    });
}

function parseColor(text) {
    const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/u.exec(text);
    if (rgb) {
        return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
    }
    const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/u.exec(text);
    if (srgb) {
        return { r: Number(srgb[1]) * 255, g: Number(srgb[2]) * 255, b: Number(srgb[3]) * 255, a: srgb[4] === undefined ? 1 : Number(srgb[4]) };
    }
    throw new Error(`Unrecognized color ${text}`);
}

function luminance({ r, g, b }) {
    const channel = value => {
        const scaled = value / 255;
        return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(first, second) {
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
}

test.describe('Chat backdrop rendering', () => {
    test.use({ viewport: desktopViewport });

    test('shows the global background behind the messages with the fitting and a readability overlay', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({ background: castleGlobal });
        const { imageRequests } = await mockBackgroundWorkspace(page, fixture);
        await openChat(page);

        const backdrop = page.locator('.message-list-frame > .chat-backdrop');
        await expect(backdrop).toHaveCount(1);
        await expect(backdrop).toHaveAttribute('data-chat-bg-source', 'global');
        await expect(backdrop).toHaveAttribute('data-chat-bg-path', '/backgrounds/castle.png');
        await expect(backdrop).toHaveAttribute('data-fit', 'cover');
        await expect(backdrop).toHaveCSS('background-image', /\/backgrounds\/castle\.png/u);
        await expect(backdrop).toHaveCSS('background-size', 'cover');
        await expect(backdrop).toHaveCSS('pointer-events', 'none');
        await expect(backdrop).toHaveAttribute('aria-hidden', 'true');
        expect(imageRequests).toContain('/backgrounds/castle.png');

        const overlayAlpha = await page.evaluate(() => {
            const color = getComputedStyle(document.querySelector('.chat-backdrop'), '::after').backgroundColor;
            return color;
        });
        expect(parseColor(overlayAlpha).a).toBeCloseTo(0.55, 2);
        await expect(page.locator('.message-list')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        // 探测通过后不会回退
        await expect.poll(() => backdropState(page)).toMatchObject({ source: 'global' });
    });

    test('the chat lock wins over the global background', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({
            background: castleGlobal,
            metadata: { custom_background: 'url("backgrounds/city%20night.png")' },
        });
        await mockBackgroundWorkspace(page, fixture);
        await openChat(page);

        const backdrop = page.locator('.chat-backdrop');
        await expect(backdrop).toHaveAttribute('data-chat-bg-source', 'chat');
        await expect(backdrop).toHaveAttribute('data-chat-bg-path', '/backgrounds/city%20night.png');
        await expect(backdrop).toHaveCSS('background-image', /\/backgrounds\/city%20night\.png/u);
    });

    for (const fitting of ['classic', 'contain', 'stretch', 'center']) {
        test(`applies the ${fitting} fitting from the global settings`, async ({ page }) => {
            await isolateBackgroundTool(page);
            const fixture = createChatBackgroundFixture({ background: { ...castleGlobal, fitting } });
            await mockBackgroundWorkspace(page, fixture);
            await openChat(page);

            const backdrop = page.locator('.chat-backdrop');
            await expect(backdrop).toHaveAttribute('data-fit', fitting);
            const expected = { classic: 'cover', contain: 'contain', stretch: '100% 100%', center: 'auto' }[fitting];
            await expect(backdrop).toHaveCSS('background-size', expected);
        });
    }

    test('ignores external and malicious values and never requests them', async ({ page }) => {
        await isolateBackgroundTool(page);
        const evilRequests = [];
        await page.route(/^https?:\/\/evil\.test\//u, route => {
            evilRequests.push(route.request().url());
            return route.abort();
        });
        const fixture = createChatBackgroundFixture({
            background: castleGlobal,
            metadata: { custom_background: 'url("http://evil.test/lock.png")' },
        });
        await mockBackgroundWorkspace(page, fixture);
        await openChat(page);

        // 非法锁定值被忽略，回到全局背景
        await expect(page.locator('.chat-backdrop')).toHaveAttribute('data-chat-bg-source', 'global');
        await expect(page.locator('.chat-backdrop')).toHaveAttribute('data-chat-bg-path', '/backgrounds/castle.png');
        expect(evilRequests).toEqual([]);
    });

    for (const [label, background, metadata] of [
        ['a global url pointing outside the site', { name: 'x.png', url: 'url("http://evil.test/global.png")', fitting: 'cover' }, {}],
        ['a data: global url', { name: 'x.png', url: 'url("data:image/png;base64,AAAA")', fitting: 'cover' }, {}],
        ['a path traversal in the lock', { name: '__transparent.png', url: 'url("backgrounds/__transparent.png")' }, { custom_background: 'url("backgrounds/../../secret.png")' }],
        ['css injected after the url', { name: '__transparent.png', url: 'url("backgrounds/__transparent.png")' }, { custom_background: 'url("backgrounds/a.png"); background: red' }],
    ]) {
        test(`renders no backdrop for ${label}`, async ({ page }) => {
            await isolateBackgroundTool(page);
            const evilRequests = [];
            await page.route(/^https?:\/\/evil\.test\//u, route => {
                evilRequests.push(route.request().url());
                return route.abort();
            });
            const fixture = createChatBackgroundFixture({ background, metadata });
            await mockBackgroundWorkspace(page, fixture);
            await openChat(page);

            await expect(page.locator('.chat-backdrop')).toHaveCount(0);
            const firstChild = await page.locator('.message-list-frame').evaluate(frame => frame.firstElementChild?.matches('[data-message-list]'));
            expect(firstChild).toBe(true);
            expect(evilRequests).toEqual([]);
        });
    }

    test('renders nothing for the transparent global background and for a chat locked to none', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({ background: { name: '__transparent.png', url: 'url("backgrounds/__transparent.png")', fitting: 'classic' } });
        await mockBackgroundWorkspace(page, fixture);
        await openChat(page);
        await expect(page.locator('.chat-backdrop')).toHaveCount(0);
    });

    test('a chat locked to the transparent image hides a global background', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({
            background: castleGlobal,
            metadata: { custom_background: 'url("backgrounds/__transparent.png")' },
        });
        await mockBackgroundWorkspace(page, fixture);
        await openChat(page);
        await expect(page.locator('.chat-backdrop')).toHaveCount(0);

        await openBackgroundTool(page);
        await expect(page.locator('[data-chat-bg-source-label]')).toHaveText('无');
        await expect(page.locator('[data-chat-bg-current-name]')).toContainText('无背景');
        await expect(page.locator('[data-chat-bg-pick-none]')).toHaveClass(/selected/u);
    });

    test('falls back to the global background when the locked image fails to load', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({
            background: castleGlobal,
            metadata: { custom_background: 'url("backgrounds/missing.png")' },
        });
        const { imageRequests } = await mockBackgroundWorkspace(page, fixture, { missingImages: ['/backgrounds/missing.png'] });
        await openChat(page);

        await expect.poll(() => backdropState(page)).toMatchObject({ source: 'global', path: '/backgrounds/castle.png' });
        expect(imageRequests).toContain('/backgrounds/missing.png');

        await openBackgroundTool(page);
        await expect(page.locator('[data-chat-bg-source-label]')).toHaveText('全局');
        await expect(page.locator('[data-chat-bg-summary]')).toContainText('无法加载');
    });

    test('shows no backdrop when both the lock and the global image fail', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({
            background: castleGlobal,
            metadata: { custom_background: 'url("backgrounds/missing.png")' },
        });
        await mockBackgroundWorkspace(page, fixture, { missingImages: ['/backgrounds/missing.png', '/backgrounds/castle.png'] });
        await openChat(page);

        await expect(page.locator('.chat-backdrop')).toHaveCount(0);
    });

    test('keeps message bubbles opaque and the overlay follows the light and dark theme', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({ background: castleGlobal });
        await mockBackgroundWorkspace(page, fixture);
        await openChat(page);

        const readStyles = () => page.evaluate(() => {
            const bubble = document.querySelector('.message:not(.user)');
            const userBubble = document.querySelector('.message.user');
            const body = bubble.querySelector('.message-body');
            return {
                overlay: getComputedStyle(document.querySelector('.chat-backdrop'), '::after').backgroundColor,
                bubble: getComputedStyle(bubble).backgroundColor,
                bubbleText: getComputedStyle(body).color,
                userBubble: getComputedStyle(userBubble).backgroundColor,
                userText: getComputedStyle(userBubble.querySelector('.message-body')).color,
            };
        });

        const results = {};
        for (const theme of ['light', 'dark']) {
            await page.evaluate(value => {
                document.documentElement.dataset.theme = value;
            }, theme);
            results[theme] = await readStyles();
            const { overlay, bubble, bubbleText, userBubble, userText } = results[theme];
            expect(parseColor(overlay).a).toBeCloseTo(0.55, 2);
            // 气泡不透明，文字对比度不依赖背景图
            expect(parseColor(bubble).a).toBe(1);
            expect(parseColor(userBubble).a).toBe(1);
            expect(contrastRatio(parseColor(bubbleText), parseColor(bubble))).toBeGreaterThanOrEqual(4.5);
            expect(contrastRatio(parseColor(userText), parseColor(userBubble))).toBeGreaterThanOrEqual(4.5);
        }

        // 遮罩取界面底色：浅色主题偏亮，深色主题偏暗
        expect(luminance(parseColor(results.light.overlay))).toBeGreaterThan(0.8);
        expect(luminance(parseColor(results.dark.overlay))).toBeLessThan(0.05);
    });

    test('hides animated backgrounds under reduced motion but keeps static ones', async ({ page }) => {
        await isolateBackgroundTool(page);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const animated = createChatBackgroundFixture({ background: { name: 'rain.gif', url: 'url("backgrounds/rain.gif")', fitting: 'cover' } });
        await mockBackgroundWorkspace(page, animated);
        await openChat(page);
        await expect(page.locator('.chat-backdrop')).toHaveCount(0);
    });

    test('keeps static backgrounds under reduced motion', async ({ page }) => {
        await isolateBackgroundTool(page);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const fixture = createChatBackgroundFixture({ background: castleGlobal });
        await mockBackgroundWorkspace(page, fixture);
        await openChat(page);
        await expect(page.locator('.chat-backdrop')).toHaveAttribute('data-chat-bg-source', 'global');
    });

    test('shows animated backgrounds when motion is not reduced', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({ background: { name: 'rain.gif', url: 'url("backgrounds/rain.gif")', fitting: 'cover' } });
        await mockBackgroundWorkspace(page, fixture);
        await openChat(page);
        await expect(page.locator('.chat-backdrop')).toHaveAttribute('data-chat-bg-path', '/backgrounds/rain.gif');
    });
});

test.describe('Chat background tool panel', () => {
    test.use({ viewport: desktopViewport });

    test('locks the chat to a picked background and follows the global one again', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({ background: castleGlobal });
        const { bridge } = await mockBackgroundWorkspace(page, fixture);
        await openChat(page);
        await openBackgroundTool(page);

        await expect(page.locator('[data-chat-bg-source-label]')).toHaveText('全局');
        await expect(page.locator('[data-chat-bg-current-name]')).toHaveText('castle.png');
        await expect(page.locator('[data-chat-bg-follow-global]')).toBeDisabled();
        // 全局背景在列表里带「全局」标记，透明占位图不单独成卡
        await expect(page.locator('[data-chat-bg-pick="castle.png"]')).toContainText('全局');
        await expect(page.locator('[data-chat-bg-pick="__transparent.png"]')).toHaveCount(0);

        await page.locator('[data-chat-bg-pick="city night.png"]').click();

        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        const [save] = fixture.chatSaves;
        expect(save).toMatchObject({ ch_name: 'Alice Fixture', file_name: 'bg-chat', avatar_url: 'alice.png' });
        const [header, ...messages] = save.chat;
        expect(header.chat_metadata).toEqual({ integrity: 'int-1', custom_background: 'url("backgrounds/city%20night.png")' });
        expect(messages).toHaveLength(6);
        expect(messages.map(message => message.mes)).toEqual(createMessages().map(message => message.mes));
        await expect.poll(() => bridge.filter(call => call.action === 'reloadChat').map(call => call.payload)).toEqual([{ avatar: 'alice.png', chat: 'bg-chat' }]);

        await expect(page.locator('[data-chat-bg-source-label]')).toHaveText('聊天锁定');
        await expect(page.locator('[data-chat-bg-current-name]')).toHaveText('city night.png');
        await expect(page.locator('[data-chat-bg-pick="city night.png"]')).toHaveClass(/selected/u);
        await expect(page.locator('[data-chat-bg-pick="city night.png"]')).toContainText('本聊天');
        await expect(page.locator('.chat-backdrop')).toHaveAttribute('data-chat-bg-path', '/backgrounds/city%20night.png');
        await expect(page.locator('.chat-backdrop')).toHaveAttribute('data-chat-bg-source', 'chat');

        // 再点「跟随全局」：清除锁定，保存体里不再有 custom_background，用的是上一次保存后签发的 integrity
        await page.locator('[data-chat-bg-follow-global]').click();
        await expect.poll(() => fixture.chatSaves.length).toBe(2);
        expect(fixture.chatSaves[1].chat[0].chat_metadata).toEqual({ integrity: 'int-2' });
        await expect.poll(() => bridge.filter(call => call.action === 'reloadChat').length).toBe(2);
        await expect(page.locator('[data-chat-bg-source-label]')).toHaveText('全局');
        await expect(page.locator('.chat-backdrop')).toHaveAttribute('data-chat-bg-path', '/backgrounds/castle.png');
        await expect(page.locator('[data-chat-bg-follow-global]')).toBeDisabled();
    });

    test('locks the chat to no background with the dedicated tile', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({ background: castleGlobal });
        await mockBackgroundWorkspace(page, fixture);
        await openChat(page);
        await openBackgroundTool(page);
        await expect(page.locator('.chat-backdrop')).toHaveCount(1);

        await page.locator('[data-chat-bg-pick-none]').click();

        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        expect(fixture.chatSaves[0].chat[0].chat_metadata.custom_background).toBe('url("backgrounds/__transparent.png")');
        await expect(page.locator('.chat-backdrop')).toHaveCount(0);
        await expect(page.locator('[data-chat-bg-source-label]')).toHaveText('无');
        await expect(page.locator('[data-chat-bg-follow-global]')).toBeEnabled();
    });

    test('filters the thumbnails and lists the chat specific images', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({
            background: castleGlobal,
            metadata: { chat_backgrounds: ['/user/images/Alice Fixture/own one.png', 'http://evil.test/skip.png', 'user/other/skip.png'] },
        });
        await mockBackgroundWorkspace(page, fixture);
        await openChat(page);
        await openBackgroundTool(page);

        // 非法的登记项被忽略，合法的专属图列在系统背景之前
        await expect(page.locator('[data-chat-bg-pick-chat]')).toHaveCount(1);
        await expect(page.locator('[data-chat-bg-pick-chat]')).toContainText('own one.png');
        await expect(page.locator('[data-chat-bg-pick-chat] img')).toHaveAttribute('src', '/user/images/Alice%20Fixture/own%20one.png');

        await page.locator('[data-chat-bg-filter]').fill('fore');
        await expect(page.locator('[data-chat-bg-pick]')).toHaveCount(1);
        await expect(page.locator('[data-chat-bg-pick="forest.webp"]')).toBeVisible();
        await expect(page.locator('[data-chat-bg-filter]')).toBeFocused();
        await expect(page.locator('[data-chat-bg-pick-chat]')).toHaveCount(0);

        await page.locator('[data-chat-bg-filter]').fill('');
        await expect(page.locator('[data-chat-bg-pick]')).toHaveCount(4);

        // 选专属图：锁定值是旧版的 encodeURI 写法
        await page.locator('[data-chat-bg-pick-chat]').click();
        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        expect(fixture.chatSaves[0].chat[0].chat_metadata.custom_background).toBe('url("/user/images/Alice%20Fixture/own%20one.png")');
        await expect(page.locator('.chat-backdrop')).toHaveAttribute('data-chat-bg-path', '/user/images/Alice%20Fixture/own%20one.png');
    });

    test('uploads a chat specific background, registers it in chat_backgrounds and locks it', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({
            background: castleGlobal,
            metadata: { chat_backgrounds: ['/user/images/Alice Fixture/old.png'] },
        });
        const { bridge } = await mockBackgroundWorkspace(page, fixture);
        await openChat(page);
        await openBackgroundTool(page);

        await page.locator('[data-chat-bg-upload]').setInputFiles({ name: 'my room.png', mimeType: 'image/png', buffer: PNG_1X1 });

        await expect.poll(() => fixture.imageUploads.length).toBe(1);
        const [upload] = fixture.imageUploads;
        expect(upload).toMatchObject({ format: 'png', ch_name: 'Alice Fixture', image: PNG_1X1.toString('base64') });
        expect(upload.filename).toMatch(/^Alice Fixture_\d{4}-\d{2}-\d{2}@\d{2}h\d{2}m\d{2}s\d{3}$/u);
        const uploadedPath = `/user/images/Alice Fixture/${upload.filename}.png`;

        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        // 不登记到 chat_backgrounds，数据维护会把这张图当成未引用图片删掉
        expect(fixture.chatSaves[0].chat[0].chat_metadata).toEqual({
            integrity: 'int-1',
            chat_backgrounds: ['/user/images/Alice Fixture/old.png', uploadedPath],
            custom_background: buildChatImageCssUrl(uploadedPath),
        });
        await expect.poll(() => bridge.filter(call => call.action === 'reloadChat').length).toBe(1);
        await expect(page.locator('.chat-backdrop')).toHaveAttribute('data-chat-bg-source', 'chat');
        await expect(page.locator('.chat-backdrop')).toHaveAttribute('data-chat-bg-path', parseBackgroundCssUrl(buildChatImageCssUrl(uploadedPath)).url);
        await expect(page.locator('[data-chat-bg-pick-chat]')).toHaveCount(2);
    });

    test('locks and uploads a group chat background through the group chat endpoints', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({ background: castleGlobal });
        const { bridge } = await mockBackgroundWorkspace(page, fixture);
        await openChat(page);
        await page.locator('[data-chat-mode="group"]').click();
        await expect(page.locator('[data-select-chat="alpha-chat"]')).toHaveClass(/active/u);
        await expect(page.locator('.message-list .message')).toHaveCount(6);
        await openBackgroundTool(page);
        await expect(page.locator('[data-chat-bg-source-label]')).toHaveText('全局');

        await page.locator('[data-chat-bg-pick="forest.webp"]').click();

        await expect.poll(() => fixture.groupChatSaves.length).toBe(1);
        const [save] = fixture.groupChatSaves;
        expect(save.id).toBe('alpha-chat');
        expect(save.chat[0].chat_metadata).toEqual({ integrity: 'int-1', custom_background: 'url("backgrounds/forest.webp")' });
        await expect.poll(() => bridge.filter(call => call.action === 'reloadChat').map(call => call.payload)).toEqual([{ groupId: 'group-alpha', chat: 'alpha-chat' }]);
        await expect(page.locator('.chat-backdrop')).toHaveAttribute('data-chat-bg-path', '/backgrounds/forest.webp');

        await page.locator('[data-chat-bg-upload]').setInputFiles({ name: 'group room.png', mimeType: 'image/png', buffer: PNG_1X1 });
        await expect.poll(() => fixture.imageUploads.length).toBe(1);
        // 群聊的图放在以群 ID 命名的目录下
        expect(fixture.imageUploads[0].ch_name).toBe('group-alpha');
        await expect.poll(() => fixture.groupChatSaves.length).toBe(2);
        const uploadedPath = `/user/images/group-alpha/${fixture.imageUploads[0].filename}.png`;
        expect(fixture.groupChatSaves[1].chat[0].chat_metadata).toEqual({
            integrity: 'int-2',
            chat_backgrounds: [uploadedPath],
            custom_background: buildChatImageCssUrl(uploadedPath),
        });
        expect(fixture.chatSaves).toEqual([]);
    });

    test('rejects an unsupported upload without touching the server', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({ background: castleGlobal });
        await mockBackgroundWorkspace(page, fixture);
        await openChat(page);
        await openBackgroundTool(page);

        await page.locator('[data-chat-bg-upload]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });

        await expect(page.locator('.toast').filter({ hasText: '只支持' }).first()).toBeVisible();
        expect(fixture.imageUploads).toEqual([]);
        expect(fixture.chatSaves).toEqual([]);
    });

    test('display switch and dim level are stored in localStorage and applied live', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({ background: castleGlobal });
        await mockBackgroundWorkspace(page, fixture);
        await openChat(page);
        await openBackgroundTool(page);

        const backdrop = page.locator('.chat-backdrop');
        await expect(page.locator('[data-chat-bg-dim]')).toHaveValue('55');
        await expect(page.locator('[data-chat-bg-dim-value]')).toHaveText('55%');
        await backdrop.evaluate(element => {
            element.dataset.marker = 'kept';
        });

        await page.locator('[data-chat-bg-dim]').fill('30');
        // 拖动滑块只改 CSS 变量，不重新渲染，所以刚才打的标记还在
        await expect(backdrop).toHaveAttribute('data-marker', 'kept');
        await expect(page.locator('[data-chat-bg-dim-value]')).toHaveText('30%');
        expect(await backdrop.evaluate(element => element.style.getPropertyValue('--chat-bg-dim'))).toBe('30%');
        const alpha = await page.evaluate(() => getComputedStyle(document.querySelector('.chat-backdrop'), '::after').backgroundColor);
        expect(parseColor(alpha).a).toBeCloseTo(0.3, 2);
        expect(await page.evaluate(() => localStorage.getItem('st-modern-chat-bg-dim'))).toBe('30');

        await page.locator('[data-chat-bg-enabled]').uncheck();
        await expect(page.locator('.chat-backdrop')).toHaveCount(0);
        await expect(page.locator('[data-chat-bg-dim]')).toBeDisabled();
        expect(await page.evaluate(() => localStorage.getItem('st-modern-chat-bg-enabled'))).toBe('0');
        // 只是隐藏显示，聊天里的锁定和全局设置都没有被改写
        expect(fixture.chatSaves).toEqual([]);

        // 偏好刷新页面后仍然有效
        await page.reload();
        await expect(page.locator('.message-list .message')).toHaveCount(6);
        await expect(page.locator('.chat-backdrop')).toHaveCount(0);
        await page.locator('.detail-actions [data-chat-tools-toggle]').click();
        await page.locator('[data-chat-tools-tab="background"]').click();
        await page.locator('[data-chat-bg-enabled]').check();
        await expect(page.locator('.chat-backdrop')).toHaveCount(1);
        expect(await page.locator('.chat-backdrop').evaluate(element => element.style.getPropertyValue('--chat-bg-dim'))).toBe('30%');
    });
});

test.describe('Chat background actions from the assets page', () => {
    test.use({ viewport: desktopViewport });

    test('sets the global background without touching the other background settings', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({ background: { ...castleGlobal, animation: true, sortOrder: 'newest', thumbnailColumns: 4 } });
        fixture.settings.extension_settings = { keep: { me: true } };
        const { bridge } = await mockBackgroundWorkspace(page, fixture);
        await page.goto('/modern/?view=assets');
        await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
        await expect(page.locator('.background-card').first()).toBeVisible();

        await expect(page.locator('[data-background-set-global="castle.png"]')).toBeDisabled();
        await expect(page.locator('[data-background-set-global="castle.png"]')).toContainText('当前全局背景');
        await expect(page.locator('.background-card[data-background-card="castle.png"] [data-background-usage="global"]')).toBeVisible();
        // 没有选过聊天：设为聊天背景不可用，并说明原因
        await expect(page.locator('[data-background-set-chat="forest.webp"]')).toBeDisabled();
        await expect(page.locator('[data-background-set-chat="forest.webp"]')).toHaveAttribute('title', /先在聊天页选择/u);

        await page.locator('[data-background-set-global="forest.webp"]').click();

        await expect.poll(() => fixture.requests.settingsSave.length).toBe(1);
        expect(fixture.requests.settingsSave[0].background).toEqual({
            name: 'forest.webp',
            url: 'url("backgrounds/forest.webp")',
            fitting: 'cover',
            animation: true,
            sortOrder: 'newest',
            thumbnailColumns: 4,
        });
        expect(fixture.requests.settingsSave[0].extension_settings).toEqual({ keep: { me: true } });
        expect(fixture.requests.settingsSave[0].power_user).toBeTruthy();
        await expect.poll(() => bridge.filter(call => call.action === 'reloadSettings').length).toBe(1);
        await expect(page.locator('.background-card[data-background-card="forest.webp"] [data-background-usage="global"]')).toBeVisible();
        await expect(page.locator('.background-card[data-background-card="castle.png"] [data-background-usage="global"]')).toHaveCount(0);
        await expect(page.locator('[data-background-set-global="forest.webp"]')).toBeDisabled();
    });

    test('sets the current chat background and the chat page shows it', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({ background: castleGlobal });
        const { bridge } = await mockBackgroundWorkspace(page, fixture);
        await openChat(page);
        await goToAssets(page);

        const button = page.locator('[data-background-set-chat="forest.webp"]');
        await expect(button).toBeEnabled();
        await expect(button).toHaveAttribute('title', /Alice Fixture \/ bg-chat/u);
        await button.click();

        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        const header = fixture.chatSaves[0].chat[0];
        expect(header.chat_metadata).toEqual({ integrity: 'int-1', custom_background: 'url("backgrounds/forest.webp")' });
        expect(fixture.chatSaves[0].chat).toHaveLength(7);
        await expect.poll(() => bridge.filter(call => call.action === 'reloadChat').map(call => call.payload)).toEqual([{ avatar: 'alice.png', chat: 'bg-chat' }]);
        // 只改聊天头，不动全局设置
        expect(fixture.requests.settingsSave).toEqual([]);
        await expect(page.locator('.background-card[data-background-card="forest.webp"] [data-background-usage="chat"]')).toBeVisible();
        await expect(button).toBeDisabled();
        await expect(button).toContainText('当前聊天背景');

        await goToChat(page);
        await expect(page.locator('.chat-backdrop')).toHaveAttribute('data-chat-bg-source', 'chat');
        await expect(page.locator('.chat-backdrop')).toHaveAttribute('data-chat-bg-path', '/backgrounds/forest.webp');
    });

    test('warns before deleting the global and locked backgrounds, then clears both references', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({
            background: { ...castleGlobal, name: 'forest.webp', url: 'url("backgrounds/forest.webp")' },
            metadata: { custom_background: 'url("backgrounds/castle.png")' },
        });
        const { bridge } = await mockBackgroundWorkspace(page, fixture);
        await openChat(page);
        await goToAssets(page);

        await page.locator('[data-toggle-background-selection]').click();
        await page.locator('[data-background-select="forest.webp"]').check();
        await page.locator('[data-background-select="castle.png"]').check();
        await page.locator('[data-delete-selected-backgrounds]').click();

        const note = page.locator('.danger-panel [data-background-reference-note]');
        await expect(note).toBeVisible();
        await expect(note).toHaveClass(/in-use/u);
        await expect(note).toContainText('「forest.webp」是当前全局背景，删除后全局背景会恢复为无背景');
        await expect(note).toContainText('「castle.png」是当前聊天（Alice Fixture / bg-chat）锁定的背景，删除后会清除这个聊天的背景锁定');
        await expect(note).toContainText('其他聊天如果锁定了这些背景，会自动回退到全局背景');
        // 确认之前什么都没有发生
        expect(fixture.backgroundWrites.deletes).toEqual([]);
        expect(fixture.requests.settingsSave).toEqual([]);
        expect(fixture.chatSaves).toEqual([]);

        await page.locator('[data-confirm-background-delete]').click();

        await expect.poll(() => fixture.backgroundWrites.deletes.length).toBe(2);
        expect(fixture.backgroundWrites.deletes.map(item => item.bg).sort()).toEqual(['castle.png', 'forest.webp']);
        await expect.poll(() => fixture.requests.settingsSave.length).toBe(1);
        expect(fixture.requests.settingsSave[0].background).toEqual({
            name: '__transparent.png',
            url: 'url("backgrounds/__transparent.png")',
            fitting: 'cover',
            animation: false,
        });
        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        expect(fixture.chatSaves[0].chat[0].chat_metadata).toEqual({ integrity: 'int-1' });
        await expect.poll(() => bridge.filter(call => call.action === 'reloadChat').length).toBe(1);

        await goToChat(page);
        await expect(page.locator('.chat-backdrop')).toHaveCount(0);
    });

    test('deleting an unused background shows only the generic note and changes no reference', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({ background: castleGlobal, metadata: { custom_background: 'url("backgrounds/forest.webp")' } });
        await mockBackgroundWorkspace(page, fixture);
        await openChat(page);
        await goToAssets(page);

        await page.locator('[data-toggle-background-selection]').click();
        await page.locator('[data-background-select="city night.png"]').check();
        await page.locator('[data-delete-selected-backgrounds]').click();

        const note = page.locator('.danger-panel [data-background-reference-note]');
        await expect(note).not.toHaveClass(/in-use/u);
        await expect(note).not.toContainText('是当前全局背景');
        await expect(note).not.toContainText('锁定的背景');
        await page.locator('[data-confirm-background-delete]').click();

        await expect.poll(() => fixture.backgroundWrites.deletes.length).toBe(1);
        await expect(page.locator('.background-card[data-background-card="city night.png"]')).toHaveCount(0);
        expect(fixture.requests.settingsSave).toEqual([]);
        expect(fixture.chatSaves).toEqual([]);
    });

    test('warns when renaming the locked background and moves the chat lock to the new name', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({
            background: castleGlobal,
            metadata: { custom_background: 'url("backgrounds/forest.webp")' },
        });
        const { bridge } = await mockBackgroundWorkspace(page, fixture);
        await openChat(page);
        await goToAssets(page);

        await page.locator('[data-background-card="forest.webp"] [data-background-rename]').click();
        const note = page.locator('[data-background-card="forest.webp"] [data-background-reference-note]');
        await expect(note).toContainText('这是当前聊天（Alice Fixture / bg-chat）锁定的背景，重命名后会同步更新这个聊天的锁定');
        await expect(note).not.toContainText('当前全局背景');
        expect(fixture.backgroundWrites.renames).toEqual([]);

        await page.locator('[data-background-rename-input]').fill('forest2.webp');
        await page.locator('[data-confirm-background-rename]').click();

        await expect.poll(() => fixture.backgroundWrites.renames).toEqual([{ old_bg: 'forest.webp', new_bg: 'forest2.webp' }]);
        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        expect(fixture.chatSaves[0].chat[0].chat_metadata.custom_background).toBe('url("backgrounds/forest2.webp")');
        await expect.poll(() => bridge.filter(call => call.action === 'reloadChat').length).toBe(1);
        // 全局背景不是它，设置不用写
        expect(fixture.requests.settingsSave).toEqual([]);
        await expect(page.locator('.background-card[data-background-card="forest2.webp"] [data-background-usage="chat"]')).toBeVisible();
    });

    test('renaming the global background keeps updating the global settings', async ({ page }) => {
        await isolateBackgroundTool(page);
        const fixture = createChatBackgroundFixture({ background: castleGlobal });
        await mockBackgroundWorkspace(page, fixture);
        await openChat(page);
        await goToAssets(page);

        await page.locator('[data-background-card="castle.png"] [data-background-rename]').click();
        await expect(page.locator('[data-background-card="castle.png"] [data-background-reference-note]')).toContainText('这是当前全局背景，重命名后会同步更新全局设置里的引用');
        await page.locator('[data-background-rename-input]').fill('castle2.png');
        await page.locator('[data-confirm-background-rename]').click();

        await expect.poll(() => fixture.requests.settingsSave.length).toBe(1);
        expect(fixture.requests.settingsSave[0].background).toEqual({ ...castleGlobal, name: 'castle2.png', url: 'url("backgrounds/castle2.png")' });
        expect(fixture.chatSaves).toEqual([]);
    });
});
