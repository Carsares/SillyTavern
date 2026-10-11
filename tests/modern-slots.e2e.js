import { test, expect } from '@playwright/test';
import { createModernResourceFixture, mockModernWorkspace } from './modern-test-utils.js';

/* global document, window, localStorage */

// 界面插槽（聊天工具抽屉、消息背景、连接标签、设置页聊天工具 / 数据维护标签）的机制测试。
// 页面里读取 window.__modernTestFlags（见 public/modern/core/test-flags.js）强制某个面板可用或不可用，
// 所以这个文件不依赖各功能是否已经实现；功能落地后只会让真实面板多出内容，不会改变这里断言的插槽行为。

const desktopViewport = { width: 1440, height: 900 };

const allChatToolsOff = { 'authors-note': false, summary: false, background: false };
const allSettingsSlotsOff = {
    settingsToolSections: { translate: false, summary: false, reasoning: false },
    settingsTabs: { 'chat-tools': false, maintenance: false },
};

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

async function setTestFlags(page, flags) {
    await page.addInitScript(value => {
        window.__modernTestFlags = value;
    }, flags);
}

async function mockChat(page) {
    const fixture = createModernResourceFixture();
    const now = Date.now();
    const messages = Array.from({ length: 6 }, (_, index) => ({
        name: index % 2 ? 'Alice Fixture' : 'Modern E2E User',
        is_user: index % 2 === 0,
        mes: `slot message ${index + 1}`,
        send_date: now - (6 - index) * 1000,
    }));
    await mockModernWorkspace(page, fixture);
    await page.route('**/api/characters/chats', route => {
        const payload = postJson(route);
        return fulfillJson(route, payload.avatar_url === 'alice.png'
            ? [{ file_id: 'slot-chat', file_name: 'slot-chat.jsonl', chat_items: messages.length, file_size: '2 KB', last_mes: now }]
            : []);
    });
    await page.route('**/api/chats/search', route => fulfillJson(route, []));
    await page.route('**/api/chats/get', route => {
        const payload = postJson(route);
        return fulfillJson(route, [
            { chat_metadata: {}, user_name: 'Modern E2E User', character_name: payload.ch_name },
            ...messages,
        ]);
    });
    await page.route('**/api/backups/chat/get', route => fulfillJson(route, []));
}

async function openChat(page) {
    await page.goto('/modern/?view=chat');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'chat');
    await expect(page.locator('.page-title')).toHaveText('聊天工作区');
    // 管理聊天按钮出现说明聊天头部已经按选中的聊天文件渲染完
    await expect(page.locator('[data-delete-chat]')).toBeVisible();
}

async function mockSettings(page) {
    const fixture = createModernResourceFixture({
        settingsBundle: { enable_extensions: true, enable_accounts: true },
    });
    await mockModernWorkspace(page, fixture);
    await page.route('**/api/settings/get-snapshots', route => fulfillJson(route, []));
}

async function openSettings(page) {
    await page.goto('/modern/?view=settings');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'settings');
    await expect(page.locator('.page-title')).toHaveText('设置中心');
}

test.describe('Chat tools drawer slot', () => {
    test.use({ viewport: desktopViewport });

    test('stays invisible while no tool panel is available', async ({ page }) => {
        await setTestFlags(page, { chatTools: allChatToolsOff });
        await mockChat(page);
        await openChat(page);

        await expect(page.locator('[data-chat-tools-toggle]')).toHaveCount(0);
        await expect(page.locator('.chat-tools-drawer')).toHaveCount(0);
        await expect(page.locator('.chat-tools-scrim')).toHaveCount(0);
        await expect(page.getByRole('button', { name: '聊天工具' })).toHaveCount(0);
        // 管理聊天按钮不受影响
        await expect(page.locator('.detail-actions [data-delete-chat]')).toBeVisible();
    });

    test('shows the header button only for available panels and switches tabs', async ({ page }) => {
        await setTestFlags(page, { chatTools: { 'authors-note': true, summary: true, background: false } });
        await mockChat(page);
        await openChat(page);

        const toggle = page.locator('.detail-actions [data-chat-tools-toggle]');
        await expect(toggle).toBeVisible();
        await expect(toggle).toContainText('聊天工具');
        // 紧挨着「管理聊天」，排在它前面
        const toolsBox = await toggle.boundingBox();
        const manageBox = await page.locator('.detail-actions [data-delete-chat]').boundingBox();
        expect(toolsBox.x + toolsBox.width).toBeLessThanOrEqual(manageBox.x + 1);
        expect(Math.abs(toolsBox.y - manageBox.y)).toBeLessThanOrEqual(2);
        await expect(page.locator('.chat-tools-drawer')).toHaveCount(0);

        await toggle.click();
        const drawer = page.locator('[data-chat-tools-drawer]');
        await expect(drawer).toBeVisible();
        await expect(drawer).toHaveAttribute('aria-label', '聊天工具');
        await expect(drawer.getByRole('heading', { name: '聊天工具' })).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');

        // 只有可用的工具出现标签，背景被强制关闭所以没有
        const tabs = drawer.locator('[data-chat-tools-tab]');
        await expect(tabs).toHaveText([/作者注释/, /聊天摘要/]);
        await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
        await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false');
        await expect(drawer.locator('[data-chat-tool-pane="authors-note"]')).toBeAttached();

        await tabs.nth(1).click();
        await expect(drawer).toBeVisible();
        await expect(drawer.locator('[data-chat-tools-tab="summary"]')).toHaveAttribute('aria-selected', 'true');
        await expect(drawer.locator('[data-chat-tools-tab="authors-note"]')).toHaveAttribute('aria-selected', 'false');
        await expect(drawer.locator('[data-chat-tool-pane="summary"]')).toBeAttached();
        await expect(drawer.locator('[data-chat-tool-pane="authors-note"]')).toHaveCount(0);

        // 内容区自己滚动，抽屉整体不超出视口
        const body = drawer.locator('[data-chat-tools-body]');
        await expect(body).toHaveCSS('overflow-y', 'auto');
        const drawerBox = await drawer.boundingBox();
        expect(drawerBox.height).toBeLessThanOrEqual(desktopViewport.height);

        // 点 × 关闭，再打开时记得上次的标签
        await drawer.locator('.panel-actions [data-chat-tools-close]').click();
        await expect(drawer).toHaveCount(0);
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await toggle.click();
        await expect(page.locator('[data-chat-tools-drawer] [data-chat-tools-tab="summary"]')).toHaveAttribute('aria-selected', 'true');
    });

    test('closes with Escape and with the scrim, and Escape keeps its other jobs when closed', async ({ page }) => {
        await setTestFlags(page, { chatTools: { 'authors-note': true, summary: false, background: false } });
        await mockChat(page);
        await openChat(page);

        const toggle = page.locator('[data-chat-tools-toggle]');
        const drawer = page.locator('[data-chat-tools-drawer]');

        await toggle.click();
        await expect(drawer).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(drawer).toHaveCount(0);

        await toggle.click();
        await expect(drawer).toBeVisible();
        await page.locator('.chat-tools-scrim').click({ position: { x: 20, y: 20 } });
        await expect(drawer).toHaveCount(0);

        // 工具抽屉没开时 Esc 仍然走原来的流程（关闭聊天备份抽屉）
        await page.locator('.page-head [data-chat-backups-toggle]').click();
        await expect(page.getByRole('complementary', { name: '聊天备份' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('complementary', { name: '聊天备份' })).toHaveCount(0);
    });

    test('opening the tools drawer folds the backups drawer away', async ({ page }) => {
        await setTestFlags(page, { chatTools: { 'authors-note': true, summary: false, background: false } });
        await mockChat(page);
        await openChat(page);

        await page.locator('.page-head [data-chat-backups-toggle]').click();
        await expect(page.getByRole('complementary', { name: '聊天备份' })).toBeVisible();
        // 备份遮罩盖住了头部按钮，这里用脚本点击模拟从别处触发打开
        await page.evaluate(() => document.querySelector('[data-chat-tools-toggle]').click());
        await expect(page.getByRole('dialog', { name: '聊天工具' })).toBeVisible();
        await expect(page.getByRole('complementary', { name: '聊天备份' })).toHaveCount(0);
    });
});

test.describe('Chat backdrop and connection chip slots', () => {
    test.use({ viewport: desktopViewport });

    test('render nothing by default', async ({ page }) => {
        await setTestFlags(page, { chatTools: allChatToolsOff });
        await mockChat(page);
        await openChat(page);

        await expect(page.locator('.chat-backdrop')).toHaveCount(0);
        await expect(page.locator('[data-composer-meta]')).toHaveCount(0);
        // 消息列表仍是列表框的第一个子节点，布局与没有插槽时一致
        const firstChildIsList = await page.locator('.message-list-frame').evaluate(frame => frame.firstElementChild?.matches('[data-message-list]'));
        expect(firstChildIsList).toBe(true);
    });

    test('backdrop sits under the messages without taking clicks', async ({ page }) => {
        await setTestFlags(page, {
            chatTools: allChatToolsOff,
            slotHtml: { chatBackdrop: '<div class="chat-backdrop" data-test-backdrop></div>' },
        });
        await mockChat(page);
        await openChat(page);

        const frame = page.locator('.message-list-frame');
        const backdrop = frame.locator('.chat-backdrop');
        await expect(backdrop).toHaveCount(1);
        const order = await frame.evaluate(element => [...element.children].map(child => child.className.split(' ')[0] || child.tagName));
        expect(order[0]).toBe('chat-backdrop');
        expect(order[1]).toBe('message-list');

        await expect(backdrop).toHaveCSS('position', 'absolute');
        await expect(backdrop).toHaveCSS('pointer-events', 'none');
        await expect(backdrop).toHaveCSS('z-index', '0');
        await expect(page.locator('.message-list')).toHaveCSS('z-index', '1');
        await expect(page.locator('.message-list')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

        // 背景铺满列表框
        const frameBox = await frame.boundingBox();
        const backdropBox = await backdrop.boundingBox();
        expect(Math.abs(backdropBox.x - frameBox.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(backdropBox.y - frameBox.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(backdropBox.width - frameBox.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(backdropBox.height - frameBox.height)).toBeLessThanOrEqual(1);

        // 点击落在消息上，而不是背景上
        const lastMessage = page.locator('.message-list .message').last();
        const messageBox = await lastMessage.boundingBox();
        const hit = await page.evaluate(({ x, y }) => {
            const element = document.elementFromPoint(x, y);
            return {
                inBackdrop: Boolean(element?.closest('.chat-backdrop')),
                inList: Boolean(element?.closest('.message-list')),
            };
        }, { x: messageBox.x + messageBox.width / 2, y: messageBox.y + messageBox.height / 2 });
        expect(hit).toEqual({ inBackdrop: false, inList: true });
    });

    test('connection chip lands in the composer meta row below the input', async ({ page }) => {
        await setTestFlags(page, {
            chatTools: allChatToolsOff,
            slotHtml: { chatConnectionChip: '<button class="secondary-button compact-button" type="button" data-test-chip>测试连接</button>' },
        });
        await mockChat(page);
        await openChat(page);

        const meta = page.locator('.composer [data-composer-meta]');
        await expect(meta).toBeVisible();
        const chip = meta.locator('[data-test-chip]');
        await expect(chip).toBeVisible();

        const textareaBox = await page.locator('.composer textarea[data-chat-input]').boundingBox();
        const chipBox = await chip.boundingBox();
        const sendBox = await page.locator('.composer [data-send-message]').boundingBox();
        // 标签在输入框下方，发送按钮仍和输入框同一行
        expect(chipBox.y).toBeGreaterThanOrEqual(textareaBox.y + textareaBox.height - 1);
        expect(Math.abs(sendBox.y + sendBox.height - (textareaBox.y + textareaBox.height))).toBeLessThanOrEqual(2);
        // 标签没有被挤到输入框右边
        expect(chipBox.x).toBeLessThan(sendBox.x);
    });
});

test.describe('Settings tab slots', () => {
    test.use({ viewport: desktopViewport });

    test('adds no tabs while nothing is available', async ({ page }) => {
        await setTestFlags(page, allSettingsSlotsOff);
        await mockSettings(page);
        await openSettings(page);

        await expect(page.locator('.settings-tabs [data-settings-section]')).toHaveCount(5);
        await expect(page.locator('[data-settings-section="chat-tools"]')).toHaveCount(0);
        await expect(page.locator('[data-settings-section="maintenance"]')).toHaveCount(0);
        await expect(page.getByRole('button', { name: '聊天工具' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: '数据维护' })).toHaveCount(0);
    });

    test('shows the chat tools tab as soon as one section is available', async ({ page }) => {
        await setTestFlags(page, {
            settingsToolSections: { translate: true, summary: false, reasoning: false },
            settingsTabs: { maintenance: false },
        });
        await mockSettings(page);
        await openSettings(page);

        const tabs = page.locator('.settings-tabs [data-settings-section]');
        await expect(tabs).toHaveText([/界面与请求/, /聊天工具/, /账户与资源/, /设置快照/, /原始设置/, /安全诊断/]);
        await expect(page.locator('[data-settings-section="maintenance"]')).toHaveCount(0);

        const chatToolsTab = page.locator('[data-settings-section="chat-tools"]');
        await chatToolsTab.click();
        await expect(chatToolsTab).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-settings-section="preferences"]')).toHaveAttribute('aria-selected', 'false');
        await expect(page.locator('[data-settings-chat-tools]')).toBeVisible();
        await expect(page.locator('[data-settings-tool-section="translate"]')).toBeAttached();
        // 未开启的分区不渲染
        await expect(page.locator('[data-settings-tool-section="summary"]')).toHaveCount(0);
        await expect(page.locator('[data-settings-tool-section="reasoning"]')).toHaveCount(0);

        // 切到别的标签再回来
        await page.locator('[data-settings-section="status"]').click();
        await expect(page.locator('[data-settings-chat-tools]')).toHaveCount(0);
        await chatToolsTab.click();
        await expect(page.locator('[data-settings-chat-tools]')).toBeVisible();
    });

    test('shows the maintenance tab when its panel is available', async ({ page }) => {
        await setTestFlags(page, {
            settingsToolSections: { translate: false, summary: false, reasoning: false },
            settingsTabs: { 'chat-tools': false, maintenance: true },
        });
        await mockSettings(page);
        await openSettings(page);

        const tabs = page.locator('.settings-tabs [data-settings-section]');
        await expect(tabs).toHaveText([/界面与请求/, /账户与资源/, /设置快照/, /数据维护/, /原始设置/, /安全诊断/]);
        await page.locator('[data-settings-section="maintenance"]').click();
        await expect(page.locator('[data-settings-section="maintenance"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-settings-maintenance]')).toBeAttached();
    });

    test('falls back to the first tab when the remembered tab is gone, and keeps global shortcuts', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('st-modern-settings-section', 'maintenance');
        });
        await setTestFlags(page, allSettingsSlotsOff);
        await mockSettings(page);
        await openSettings(page);

        await expect(page.locator('[data-settings-section="preferences"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-settings-maintenance]')).toHaveCount(0);

        // 设置页新加的 keydown 处理在没人认领时必须放行全局快捷键
        await page.keyboard.press('ControlOrMeta+k');
        await expect(page.locator('#commandPalette')).toBeVisible();
    });
});
