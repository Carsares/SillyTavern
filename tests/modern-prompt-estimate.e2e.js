import { test, expect } from '@playwright/test';
import { BRIDGE_ACTIONS } from '../public/modern/core/bridge-protocol.js';
import { createModernResourceFixture, mockBridgeFrame, mockModernWorkspace } from './modern-test-utils.js';

// 预估下次发送（A1 第二阶段）：上下文抽屉「提示词预算」区块的「估算下次发送」按钮、输入框下方的「预估下次发送」标签，
// 以及自动估算的时机（抽屉打开、设置同步之后）和作废（生成结束、离开聊天）。引擎用 mockBridgeFrame 替身，
// 真实引擎的干跑行为见 modern-bridge-headless.e2e.js 的 "Modern bridge prompt estimate"。

const desktopViewport = { width: 1440, height: 900 };

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

function createDeferred() {
    /** @type {(value?: unknown) => void} */
    let resolve = () => {};
    const promise = new Promise(settle => {
        resolve = settle;
    });
    return { promise, resolve };
}

const estimateReply = (extra = {}) => ({
    available: true,
    estimated: true,
    mainApi: 'openai',
    apiFriendlyName: 'Chat Completion',
    modelUsed: 'deepseek-v4-flash',
    presetName: 'Default',
    tokenizer: 'tiktoken',
    maxContext: 31700,
    totalTokens: 12345,
    includesDraft: false,
    ...extra,
});

const itemizedReply = totalTokens => ({
    available: true,
    mesId: 3,
    mainApi: 'openai',
    apiFriendlyName: 'Chat Completion',
    modelUsed: 'deepseek-v4-flash',
    presetName: 'Default',
    tokenizer: 'tiktoken',
    maxContext: 31700,
    totalTokens,
    parts: [{ name: '聊天历史', tokens: totalTokens - 500 }, { name: '主提示词', tokens: 500 }],
});

function buildMessages(name, count = 4) {
    const base = Date.now() - 120_000;
    return Array.from({ length: count }, (_, index) => {
        const isUser = index % 2 === 1;
        return {
            name: isUser ? 'Modern E2E User' : name,
            is_user: isUser,
            is_system: false,
            send_date: new Date(base + index * 1000).toISOString(),
            mes: index === 0 ? 'Opening line.' : `${isUser ? 'user' : 'reply'} message ${index}`,
        };
    });
}

// alice.png 有两个聊天（est-chat 较新，默认打开），Alpha Group 有一个聊天
function createEstimateFixture() {
    const fixture = createModernResourceFixture();
    const now = Date.now();
    fixture.settings = {
        main_api: 'openai',
        chat_completion_source: 'custom',
        oai_settings: {
            chat_completion_source: 'custom',
            custom_model: 'deepseek-v4-flash',
            preset_settings_openai: 'Default',
            openai_max_tokens: 300,
            openai_max_context: 32000,
        },
        power_user: fixture.settings.power_user,
    };
    fixture.chatLists = {
        'alice.png': [
            { file_id: 'est-chat', file_name: 'est-chat.jsonl', chat_items: 4, file_size: '1 KB', last_mes: now },
            { file_id: 'est-chat-2', file_name: 'est-chat-2.jsonl', chat_items: 4, file_size: '1 KB', last_mes: now - 60_000 },
        ],
        'bruno.png': [],
    };
    fixture.groupChatList = [{ file_id: 'alpha-chat', file_name: 'alpha-chat.jsonl', chat_items: 4, file_size: '1 KB', last_mes: now }];
    fixture.integrity = { 'est-chat': 'int-1', 'est-chat-2': 'int-1', 'alpha-chat': 'int-1' };
    return fixture;
}

async function mockEstimateChatRoutes(page, fixture) {
    await mockModernWorkspace(page, fixture);
    await page.route('**/api/characters/chats', route => fulfillJson(route, fixture.chatLists[postJson(route).avatar_url] || []));
    await page.route('**/api/chats/search', route => fulfillJson(route, postJson(route).group_id ? fixture.groupChatList : []));
    await page.route('**/api/backups/chat/get', route => fulfillJson(route, []));
    const readChat = (route, chatId) => {
        const id = String(chatId || '').replace(/\.jsonl$/i, '');
        return fulfillJson(route, [
            { chat_metadata: { integrity: fixture.integrity[id] || 'int-1' }, user_name: 'Modern E2E User', character_name: 'unused' },
            ...buildMessages(id.startsWith('alpha') ? 'Alpha Group' : 'Alice Fixture'),
        ]);
    };
    await page.route('**/api/chats/get', route => readChat(route, postJson(route).file_name));
    await page.route('**/api/chats/group/get', route => readChat(route, postJson(route).id));
    await page.route('**/api/chats/save', route => fulfillJson(route, { ok: true, integrity: 'int-2' }));
}

async function openChat(page, { inspector = 'false' } = {}) {
    await page.addInitScript(`localStorage.setItem("st-modern-inspector-open", "${inspector}")`);
    await page.goto('/modern/?view=chat');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'chat');
    await expect(page.locator('.page-title')).toHaveText('聊天工作区');
    await expect(page.locator('[data-delete-chat]')).toBeVisible();
}

// 把引擎标记为已加载（和用户点「检查生成引擎」一样）。自动估算只在引擎已加载时发
async function makeEngineReady(page, calls) {
    await page.locator('[data-check-generation-engine]').click();
    await expect.poll(() => calls.some(call => call.action === BRIDGE_ACTIONS.STATUS)).toBe(true);
    await expect(page.locator('.engine-panel .badge')).toHaveText('引擎就绪');
}

const estimateCalls = calls => calls.filter(call => call.action === BRIDGE_ACTIONS.ESTIMATE_PROMPT);
const label = page => page.locator('.composer [data-chat-usage-label]');
const section = page => page.locator('[data-inspector-prompt-estimate]');
const toggleInspector = page => page.locator('.topbar [data-toggle-inspector]').click();

// 设置同步完成的通知登记在共用的 core/bridge-reload.js 里；用同一个模块实例做一次成功的 reloadSettings，
// 等于用户保存了预设 / 连接（真实路径是各设置动作调用 bridgeReload.reloadSettings）
const finishReload = (page, method = 'reloadSettings') => page.evaluate(async reloadMethod => {
    const { createBridgeReload } = await import('/modern/core/bridge-reload.js');
    await createBridgeReload(async () => ({ ok: true }))[reloadMethod]();
}, method);
const finishSettingsReload = page => finishReload(page, 'reloadSettings');

test.describe('Prompt estimate', () => {
    test.use({ viewport: desktopViewport });

    test('the button sends the chat to the engine and shows the estimate in the drawer and under the composer', async ({ page }) => {
        const fixture = createEstimateFixture();
        await mockEstimateChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page, { replies: { estimatePrompt: () => estimateReply() } });
        await openChat(page, { inspector: 'true' });

        // Nothing was asked for yet: the engine is not loaded and the drawer was opened by the saved preference, not by a click
        await expect(section(page)).toContainText('提示词预算');
        await expect(section(page)).toContainText('尚未估算');
        await expect(label(page)).toHaveCount(0);
        expect(estimateCalls(calls)).toHaveLength(0);

        await page.locator('[data-chat-input]').fill('unsent draft');
        await section(page).locator('[data-estimate-prompt]').click();

        await expect.poll(() => estimateCalls(calls).length).toBe(1);
        expect(estimateCalls(calls)[0].payload).toEqual({ avatar: 'alice.png', groupId: null, chat: 'est-chat', integrity: 'int-1' });

        await expect(label(page)).toHaveText('预估下次发送 12,345 / 预算 31,700 token');
        await expect(label(page)).toHaveAttribute('data-usage-kind', 'estimate');
        await expect(label(page)).toHaveAttribute('data-usage-percent', '38.9%');
        await expect(label(page)).toHaveAttribute('title', /按当前设置模拟一次发送.*不含输入框里未发送的文字.*提示词预算 = 上下文 32,000 − 回复上限 300/);
        await expect(section(page).locator('.kv-row', { hasText: '预估下次发送' })).toContainText('12,345 tokens');
        await expect(section(page).locator('.kv-row', { hasText: '提示词预算' })).toContainText('31,700 tokens');
        await expect(section(page).locator('.kv-row', { hasText: '占用' })).toContainText('38.9%');
        await expect(section(page).locator('.kv-row', { hasText: '分词器' })).toContainText('tiktoken');
        await expect(section(page)).toContainText('不含输入框里未发送的文字');
        // The label was updated in place: the unsent draft is still in the box
        await expect(page.locator('[data-chat-input]')).toHaveValue('unsent draft');
        await expect(section(page).locator('[data-estimate-prompt]')).toBeEnabled();
    });

    test('shows the engine reason when there is nothing to estimate and keeps the last sent label', async ({ page }) => {
        const fixture = createEstimateFixture();
        await mockEstimateChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page, {
            replies: {
                estimatePrompt: () => ({ available: false, reason: 'budget', message: 'Not enough free tokens for mandatory prompts.' }),
                getItemizedPrompt: itemizedReply(9000),
            },
        });
        await openChat(page, { inspector: 'true' });

        await page.locator('.inspector-section [data-refresh-itemized-prompt]').click();
        await expect(label(page)).toHaveText('上次发送 9,000 / 预算 31,700 token');

        await section(page).locator('[data-estimate-prompt]').click();
        await expect(section(page)).toContainText('必选提示词已超出提示词预算');
        expect(estimateCalls(calls)).toHaveLength(1);
        // The last sent prompt is still what the label shows, in its original form
        await expect(label(page)).toHaveText('上次发送 9,000 / 预算 31,700 token');
        await expect(label(page)).not.toHaveAttribute('data-usage-kind', /.*/);
    });

    test('a finished generation drops the estimate, and the label goes back to the last sent prompt', async ({ page }) => {
        const fixture = createEstimateFixture();
        await mockEstimateChatRoutes(page, fixture);
        let estimates = 0;
        const calls = await mockBridgeFrame(page, {
            replies: {
                estimatePrompt: () => estimateReply({ totalTokens: estimates++ === 0 ? 12345 : 13000 }),
                generate: () => {
                    fixture.integrity['est-chat'] = 'int-2';
                    return { chat: 'est-chat.jsonl', messageCount: 6, saved: true, type: 'normal' };
                },
                getItemizedPrompt: itemizedReply(12900),
            },
        });
        await openChat(page);

        await toggleInspector(page);
        await section(page).locator('[data-estimate-prompt]').click();
        await expect(label(page)).toHaveText('预估下次发送 12,345 / 预算 31,700 token');
        // The open drawer covers the composer's send button
        await page.keyboard.press('Escape');
        await expect(page.locator('#inspector')).not.toHaveClass(/open/);

        await page.locator('[data-chat-input]').fill('send this');
        await page.locator('[data-send-message]').click();

        // The estimate was taken before the reply: after it the real snapshot is what counts
        await expect(label(page)).toHaveText('上次发送 12,900 / 预算 31,700 token');
        await expect(label(page)).not.toHaveAttribute('data-usage-kind', /.*/);
        await expect(section(page)).toContainText('尚未估算');
        await expect(section(page).locator('.kv-row', { hasText: '预估下次发送' })).toHaveCount(0);
        // Nothing asked for a new estimate by itself after the generation
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(1500);
        expect(estimateCalls(calls)).toHaveLength(1);
        expect(calls.map(call => call.action).filter(action => action === 'generate' || action === 'estimatePrompt')).toEqual(['estimatePrompt', 'generate']);

        // Opening the drawer now (the engine is loaded and there is no estimate for the chat) estimates the next send again
        await toggleInspector(page);
        await expect.poll(() => estimateCalls(calls).length).toBe(2);
        await expect(label(page)).toHaveText('预估下次发送 13,000 / 预算 31,700 token');
        await expect(section(page).locator('.kv-row', { hasText: '预估下次发送' })).toContainText('13,000 tokens');
    });

    test('a group chat says it is unsupported, sends nothing when the drawer opens and disables the button', async ({ page }) => {
        const fixture = createEstimateFixture();
        await mockEstimateChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page, { replies: { estimatePrompt: () => estimateReply() } });
        await openChat(page);
        await page.locator('[data-chat-mode="group"]').click();
        await expect(page.locator('.detail-title')).toHaveText('Alpha Group');
        await page.locator('[data-select-chat="alpha-chat"]').click();
        await expect(page.locator('.chat-thread')).toContainText('user message 1');
        await makeEngineReady(page, calls);

        await toggleInspector(page);
        await expect(page.locator('#inspector')).toHaveClass(/open/);
        await expect(section(page)).toContainText('群聊暂不支持估算');
        await expect(section(page).locator('[data-estimate-prompt]')).toBeDisabled();
        // Intentional wait: we assert the ABSENCE of a request, so give the page time to send one
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(600);
        expect(estimateCalls(calls)).toHaveLength(0);
        await expect(label(page)).toHaveCount(0);
    });

    test('an answer for a chat the user already left is discarded', async ({ page }) => {
        const fixture = createEstimateFixture();
        await mockEstimateChatRoutes(page, fixture);
        const gate = createDeferred();
        const calls = await mockBridgeFrame(page, {
            replies: {
                estimatePrompt: async () => {
                    await gate.promise;
                    return estimateReply({ totalTokens: 777 });
                },
            },
        });
        await openChat(page, { inspector: 'true' });

        await section(page).locator('[data-estimate-prompt]').click();
        await expect.poll(() => estimateCalls(calls).length).toBe(1);
        await expect(section(page)).toContainText('正在估算');
        await expect(section(page).locator('[data-estimate-prompt]')).toBeDisabled();

        // A click outside the drawer closes it; open it again to look at the new chat
        await page.locator('[data-select-chat="est-chat-2"]').click();
        await expect(page.locator('[data-select-chat="est-chat-2"]')).toHaveClass(/active/);
        await toggleInspector(page);
        await expect(page.locator('#inspector')).toHaveClass(/open/);
        gate.resolve();

        // The answer belonged to est-chat: it is not shown for est-chat-2, the button is free again and nothing was stored
        await expect(section(page).locator('[data-estimate-prompt]')).toBeEnabled();
        await expect(section(page)).toContainText('尚未估算');
        await expect(label(page)).toHaveCount(0);
        expect(estimateCalls(calls)).toHaveLength(1);

        // Asking again for the chat that is open now works and is stored for it
        await section(page).locator('[data-estimate-prompt]').click();
        await expect.poll(() => estimateCalls(calls).length).toBe(2);
        expect(estimateCalls(calls)[1].payload).toMatchObject({ chat: 'est-chat-2' });
        await expect(label(page)).toHaveText('预估下次发送 777 / 预算 31,700 token');
    });

    test('opening the drawer estimates by itself only after the engine was loaded, once per chat', async ({ page }) => {
        const fixture = createEstimateFixture();
        await mockEstimateChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page, { replies: { estimatePrompt: () => estimateReply() } });
        await openChat(page);

        // The engine is not loaded: opening the drawer must not wake the hidden page for an estimate
        await toggleInspector(page);
        await expect(page.locator('#inspector')).toHaveClass(/open/);
        await expect.poll(() => calls.some(call => call.action === BRIDGE_ACTIONS.GET_ITEMIZED_PROMPT)).toBe(true);
        // Intentional wait: we assert the ABSENCE of a request, so give the page time to send one
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(600);
        expect(estimateCalls(calls)).toHaveLength(0);
        await toggleInspector(page);
        await expect(page.locator('#inspector')).not.toHaveClass(/open/);

        await makeEngineReady(page, calls);
        await toggleInspector(page);
        await expect.poll(() => estimateCalls(calls).length).toBe(1);
        expect(estimateCalls(calls)[0].payload).toEqual({ avatar: 'alice.png', groupId: null, chat: 'est-chat', integrity: 'int-1' });
        await expect(label(page)).toHaveText('预估下次发送 12,345 / 预算 31,700 token');

        // Closing and opening again keeps the estimate and does not ask again
        await toggleInspector(page);
        await toggleInspector(page);
        await expect(section(page).locator('.kv-row', { hasText: '预估下次发送' })).toContainText('12,345 tokens');
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(400);
        expect(estimateCalls(calls)).toHaveLength(1);

        // Another chat has no estimate yet, so it gets its own when the drawer is opened for it
        await toggleInspector(page);
        await page.locator('[data-select-chat="est-chat-2"]').click();
        await expect(label(page)).toHaveCount(0);
        await toggleInspector(page);
        await expect.poll(() => estimateCalls(calls).length).toBe(2);
        expect(estimateCalls(calls)[1].payload).toMatchObject({ chat: 'est-chat-2' });
    });

    test('an automatic failure is silent, a manual one shows the error in the drawer', async ({ page }) => {
        const fixture = createEstimateFixture();
        await mockEstimateChatRoutes(page, fixture);
        let failing = true;
        const calls = await mockBridgeFrame(page, {
            replies: {
                estimatePrompt: () => {
                    if (failing) {
                        throw new Error('生成引擎暂时不可用');
                    }
                    return estimateReply();
                },
            },
        });
        await openChat(page);
        await makeEngineReady(page, calls);

        await toggleInspector(page);
        await expect.poll(() => estimateCalls(calls).length).toBe(1);
        await expect(section(page)).toContainText('自动估算没有成功');
        await expect(section(page)).not.toContainText('估算失败');
        await expect(section(page)).not.toContainText('生成引擎暂时不可用');
        await expect(page.locator('.toast', { hasText: /估算|暂时不可用/ })).toHaveCount(0);
        await expect(label(page)).toHaveCount(0);

        await section(page).locator('[data-estimate-prompt]').click();
        await expect.poll(() => estimateCalls(calls).length).toBe(2);
        await expect(section(page)).toContainText('估算失败：生成引擎暂时不可用');
        await expect(label(page)).toHaveCount(0);

        // Trying again after the engine recovers clears the error
        failing = false;
        await section(page).locator('[data-estimate-prompt]').click();
        await expect(section(page)).not.toContainText('估算失败');
        await expect(label(page)).toHaveText('预估下次发送 12,345 / 预算 31,700 token');
    });

    test('a finished settings sync estimates again a second later, once, and only for a loaded engine on the chat page', async ({ page }) => {
        const fixture = createEstimateFixture();
        await mockEstimateChatRoutes(page, fixture);
        let tokens = 12345;
        const calls = await mockBridgeFrame(page, { replies: { estimatePrompt: () => estimateReply({ totalTokens: tokens }) } });
        await openChat(page);

        // Engine not loaded yet: a sync is not a reason to wake it
        await finishSettingsReload(page);
        // Intentional wait: we assert the ABSENCE of a request, so wait longer than the delay of the automatic estimate
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(1500);
        expect(estimateCalls(calls)).toHaveLength(0);

        await makeEngineReady(page, calls);
        await finishSettingsReload(page);
        await finishSettingsReload(page);
        expect(estimateCalls(calls)).toHaveLength(0);
        await expect.poll(() => estimateCalls(calls).length, { timeout: 5000 }).toBe(1);
        await expect(label(page)).toHaveText('预估下次发送 12,345 / 预算 31,700 token');

        // The next sync replaces the number
        tokens = 20000;
        await finishSettingsReload(page);
        await expect(label(page)).toHaveText('预估下次发送 20,000 / 预算 31,700 token');
        expect(estimateCalls(calls)).toHaveLength(2);

        // A character sync makes the number stale and is not re-estimated by itself: the label is gone (there is no last sent prompt here)
        await finishReload(page, 'reloadCharacter');
        await expect(label(page)).toHaveCount(0);
        // eslint-disable-next-line playwright/no-wait-for-timeout
        await page.waitForTimeout(1500);
        expect(estimateCalls(calls)).toHaveLength(2);
    });
});
