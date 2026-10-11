import { test, expect } from '@playwright/test';
import { BRIDGE_ACTIONS, BRIDGE_TIMEOUTS } from '../public/modern/core/bridge-protocol.js';
import { createModernResourceFixture, mockBridgeFrame, mockModernWorkspace } from './modern-test-utils.js';

// 聊天摘要（A6）：聊天工具抽屉里的「聊天摘要」面板、设置页「聊天工具」标签里的摘要设置、上下文抽屉里的摘要段，
// 以及每次生成成功后由 Modern 发起的自动摘要。引擎用 mockBridgeFrame 替身：替身收到 summarize 时自己改写“聊天文件”，
// 模拟真实引擎“写进 extra.memory 并立即保存”。引擎一侧的真实行为见 modern-bridge-headless.e2e.js。

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

const baseMemory = {
    source: 'main',
    promptInterval: 4,
    promptForceWords: 0,
    promptWords: 200,
    prompt: 'Summarize in {{words}} words.',
    template: '[Summary: {{summary}}]',
    position: 0,
    depth: 2,
    role: 0,
    memoryFrozen: false,
    SkipWIAN: false,
    scan: false,
    overrideResponseLength: 0,
    maxMessagesPerRequest: 0,
    prompt_builder: 0,
    // 旧版默认 settings.json 留下的、扩展不使用的滑块范围，保存时必须原样保留
    promptMinInterval: 1,
    promptMaxInterval: 100,
};

// 8 条消息：0 开场白，1 用户，2 回复，… 7 回复
function buildMessages(name, memories = {}) {
    const base = Date.now() - 120_000;
    return Array.from({ length: 8 }, (_, index) => {
        const isUser = index % 2 === 1;
        const message = {
            name: isUser ? 'Modern E2E User' : name,
            is_user: isUser,
            is_system: false,
            send_date: new Date(base + index * 1000).toISOString(),
            mes: index === 0 ? 'Opening line.' : `${isUser ? 'user' : 'reply'} message ${index}`,
        };
        if (memories[index] !== undefined) {
            message.extra = { memory: memories[index], api: 'openai' };
        }
        return message;
    });
}

function createSummaryFixture({ memory = baseMemory, memories = {}, settingsExtra = {} } = {}) {
    const fixture = createModernResourceFixture();
    const now = Date.now();
    fixture.settings.extension_settings = { memory: structuredClone(memory), ...settingsExtra };
    fixture.chatLists = {
        'alice.png': [{ file_id: 'sum-chat', file_name: 'sum-chat.jsonl', chat_items: 8, file_size: '2 KB', last_mes: now }],
        'bruno.png': [],
    };
    fixture.groupChatList = [{ file_id: 'alpha-chat', file_name: 'alpha-chat.jsonl', chat_items: 8, file_size: '2 KB', last_mes: now }];
    fixture.files = {
        'sum-chat': { metadata: { integrity: 'int-1' }, messages: buildMessages('Alice Fixture', memories), saves: 0 },
        'alpha-chat': { metadata: { integrity: 'int-1' }, messages: buildMessages('Alpha Group'), saves: 0 },
    };
    fixture.chatSaves = [];
    fixture.chatReads = [];
    fixture.failSave = null;
    return fixture;
}

async function mockSummaryChatRoutes(page, fixture) {
    await mockModernWorkspace(page, fixture);
    await page.route('**/api/characters/chats', route => fulfillJson(route, fixture.chatLists[postJson(route).avatar_url] || []));
    await page.route('**/api/chats/search', route => fulfillJson(route, postJson(route).group_id ? fixture.groupChatList : []));
    await page.route('**/api/backups/chat/get', route => fulfillJson(route, []));
    // The settings page reads the snapshot list on entry; an unanswered request would pop a toast over the buttons
    await page.route('**/api/settings/get-snapshots', route => fulfillJson(route, []));

    const readChat = (route, chatId) => {
        const file = fixture.files[stripJsonlExtension(chatId)];
        fixture.chatReads.push(stripJsonlExtension(chatId));
        return fulfillJson(route, [
            { chat_metadata: structuredClone(file.metadata), user_name: 'Modern E2E User', character_name: 'unused' },
            ...structuredClone(file.messages),
        ]);
    };
    // 保存和真实后端一样检查版本：头里的 integrity 比文件旧就拒绝
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

// 替身引擎的两种写入：生成一轮对话 / 摘要，都像真引擎一样改文件并换新 integrity
function engineAppendTurn(fixture, chatId, name) {
    const file = fixture.files[chatId];
    const stamp = new Date().toISOString();
    file.messages.push(
        { name: 'Modern E2E User', is_user: true, is_system: false, send_date: stamp, mes: 'please continue' },
        { name, is_user: false, is_system: false, send_date: stamp, mes: 'engine reply' },
    );
    file.saves += 1;
    file.metadata = { ...file.metadata, integrity: `int-${file.saves + 1}` };
}

function engineWriteSummary(fixture, chatId, index, text) {
    const file = fixture.files[chatId];
    file.messages[index].extra = { ...(file.messages[index].extra || {}), memory: text };
    file.saves += 1;
    file.metadata = { ...file.metadata, integrity: `int-${file.saves + 1}` };
}

async function openChat(page) {
    await page.goto('/modern/?view=chat');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
    await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'chat');
    await expect(page.locator('.page-title')).toHaveText('聊天工作区');
    await expect(page.locator('[data-delete-chat]')).toBeVisible();
}

async function openSummary(page) {
    await page.locator('.detail-actions [data-chat-tools-toggle]').click();
    await expect(page.locator('.chat-tools-drawer')).toBeVisible();
    await page.locator('[data-chat-tools-tab="summary"]').click();
    await expect(page.locator('[data-chat-summary]')).toBeVisible();
}

const summaryInput = page => page.locator('[data-cs-input]');
const summaryMessage = (page, kind) => page.locator(`[data-cs-message="${kind}"]`);
const summarizeCalls = calls => calls.filter(call => call.action === BRIDGE_ACTIONS.SUMMARIZE);

test.describe('Summary panel', () => {
    test.use({ viewport: desktopViewport });

    test('shows the latest summary, where it sits, the source and the auto-summary progress', async ({ page }) => {
        const fixture = createSummaryFixture({ memories: { 2: 'older summary', 5: 'The knight swore an oath.' } });
        await mockSummaryChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openSummary(page);

        await expect(summaryInput(page)).toHaveValue('The knight swore an oath.');
        await expect(page.locator('[data-cs-location]')).toContainText('位于第 6 条消息');
        await expect(page.locator('[data-cs-location]')).toContainText('user message 5');
        await expect(page.locator('[data-cs-source]')).toHaveText('来源：主模型');
        // 8 messages, the summary sits on index 5: two come after it, the interval is 4
        await expect(page.locator('[data-cs-auto-text]')).toContainText('距上次摘要已有 2 条消息，间隔 4 条，还差 2 条');
        await expect(page.locator('[data-cs-dirty]')).toBeHidden();
        await expect(page.locator('[data-cs-save]')).toBeDisabled();
        await expect(page.locator('[data-cs-clear]')).toBeEnabled();
        await expect(page.locator('[data-cs-run]')).toBeEnabled();
        await expect(page.locator('[data-cs-source-warning]')).toHaveCount(0);
    });

    test('says so when the chat has no summary yet and explains how many messages are waiting', async ({ page }) => {
        const fixture = createSummaryFixture();
        await mockSummaryChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openSummary(page);

        await expect(summaryInput(page)).toHaveValue('');
        await expect(page.locator('[data-cs-location]')).toHaveText('聊天里还没有摘要');
        await expect(page.locator('[data-cs-auto-text]')).toContainText('达到间隔 4 条');
        await expect(page.locator('[data-cs-clear]')).toBeDisabled();
    });

    test('a summary that sits only on the last message does not count, like the legacy reader', async ({ page }) => {
        const fixture = createSummaryFixture({ memories: { 7: 'only on the last message' } });
        await mockSummaryChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openSummary(page);

        await expect(summaryInput(page)).toHaveValue('');
        await expect(page.locator('[data-cs-location]')).toHaveText('聊天里还没有摘要');
    });

    test('edits the summary in place: the same message is rewritten, nothing else changes, and the engine reopens the chat', async ({ page }) => {
        const fixture = createSummaryFixture({ memories: { 2: 'older summary', 5: 'The knight swore an oath.' } });
        await mockSummaryChatRoutes(page, fixture);
        const reloadGate = createDeferred();
        const calls = await mockBridgeFrame(page, { replies: { reloadChat: () => reloadGate.promise } });
        await openChat(page);
        await openSummary(page);

        await summaryInput(page).fill('The knight swore an oath, and the dragon woke.');
        await expect(page.locator('[data-cs-dirty]')).toBeVisible();
        await expect(page.locator('[data-cs-save]')).toBeEnabled();
        await expect(summaryInput(page)).toBeFocused();
        await page.locator('[data-cs-save]').click();

        // saved to the file, the engine has not confirmed yet
        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        await expect.poll(() => calls.filter(call => call.action === 'reloadChat').length).toBe(1);
        await expect(page.locator('[data-cs-save]')).toContainText('保存中');
        await expect(summaryMessage(page, 'notice')).toBeHidden();

        reloadGate.resolve({ ok: true });
        await expect(summaryMessage(page, 'notice')).toContainText('摘要已保存到第 6 条消息');
        await expect(summaryMessage(page, 'notice')).toContainText('生成引擎已同步');
        await expect(page.locator('[data-cs-dirty]')).toBeHidden();

        const [save] = fixture.chatSaves;
        expect(save.header.chat_metadata.integrity).toBe('int-1');
        expect(save.messages).toHaveLength(8);
        // the latest holder was overwritten, the older summary and every other message stayed as they were
        expect(save.messages[5].extra).toEqual({ memory: 'The knight swore an oath, and the dragon woke.', api: 'openai' });
        expect(save.messages[2].extra.memory).toBe('older summary');
        expect(save.messages.filter(message => message.extra?.memory)).toHaveLength(2);
        expect(save.messages[4]).toEqual(fixture.files['sum-chat'].messages[4]);
        expect(calls.find(call => call.action === 'reloadChat').payload).toEqual({ avatar: 'alice.png', chat: 'sum-chat' });

        // the revision issued by the first save was stored, so a second edit is accepted
        await summaryInput(page).fill('Second edit.');
        await page.locator('[data-cs-save]').click();
        await expect.poll(() => fixture.chatSaves.length).toBe(2);
        expect(fixture.chatSaves[1].header.chat_metadata.integrity).toBe('int-2');
        expect(fixture.files['sum-chat'].messages[5].extra.memory).toBe('Second edit.');
    });

    test('writing a summary into a chat that has none puts it on the pre-last message', async ({ page }) => {
        const fixture = createSummaryFixture();
        await mockSummaryChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openSummary(page);

        await summaryInput(page).fill('Hand-written summary.');
        await page.locator('[data-cs-save]').click();
        await expect(summaryMessage(page, 'notice')).toContainText('摘要已保存到第 7 条消息');

        expect(fixture.files['sum-chat'].messages[6].extra).toEqual({ memory: 'Hand-written summary.' });
        expect(fixture.files['sum-chat'].messages.filter(message => message.extra?.memory)).toHaveLength(1);
        await expect(page.locator('[data-cs-location]')).toContainText('位于第 7 条消息');
    });

    test('clears the latest summary after a confirmation, and an older one becomes current again', async ({ page }) => {
        const fixture = createSummaryFixture({ memories: { 2: 'older summary', 5: 'latest summary' } });
        await mockSummaryChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page);
        await openChat(page);
        await openSummary(page);

        await page.locator('[data-cs-clear]').click();
        await expect(page.locator('.chat-summary-confirm')).toContainText('清除第 6 条消息上的摘要');
        expect(fixture.chatSaves).toHaveLength(0);
        await page.locator('[data-cs-clear-cancel]').click();
        await expect(page.locator('[data-cs-clear]')).toBeVisible();
        expect(fixture.chatSaves).toHaveLength(0);

        await page.locator('[data-cs-clear]').click();
        await page.locator('[data-cs-clear-confirm]').click();
        await expect(summaryMessage(page, 'notice')).toContainText('已清除第 6 条消息上的摘要');
        await expect(summaryMessage(page, 'notice')).toContainText('第 3 条消息上较早的一份摘要');

        expect(fixture.chatSaves).toHaveLength(1);
        const saved = fixture.chatSaves[0].messages;
        // only the memory key left, the rest of the extra stays
        expect(saved[5].extra).toEqual({ api: 'openai' });
        expect(saved[2].extra.memory).toBe('older summary');
        expect(calls.filter(call => call.action === 'reloadChat')).toHaveLength(1);
        await expect(summaryInput(page)).toHaveValue('older summary');

        // clearing again removes the last one
        await page.locator('[data-cs-clear]').click();
        await page.locator('[data-cs-clear-confirm]').click();
        await expect(summaryMessage(page, 'notice')).toContainText('聊天里已经没有摘要');
        await expect(summaryInput(page)).toHaveValue('');
        await expect(page.locator('[data-cs-clear]')).toBeDisabled();
    });

    test('saving an emptied text box clears the summary without asking again', async ({ page }) => {
        const fixture = createSummaryFixture({ memories: { 5: 'latest summary' } });
        await mockSummaryChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openSummary(page);

        await summaryInput(page).fill('   ');
        await page.locator('[data-cs-save]').click();
        await expect(summaryMessage(page, 'notice')).toContainText('已清除第 6 条消息上的摘要');
        expect(fixture.files['sum-chat'].messages.some(message => message.extra?.memory)).toBe(false);
    });

    test('keeps a failed engine sync visible but does not call the saved file lost', async ({ page }) => {
        const fixture = createSummaryFixture({ memories: { 5: 'latest summary' } });
        await mockSummaryChatRoutes(page, fixture);
        await mockBridgeFrame(page, { replies: { reloadChat: () => { throw new Error('engine offline'); } } });
        await openChat(page);
        await openSummary(page);

        await summaryInput(page).fill('Edited anyway.');
        await page.locator('[data-cs-save]').click();
        await expect(summaryMessage(page, 'warning')).toContainText('摘要已保存到第 6 条消息');
        await expect(summaryMessage(page, 'warning')).toContainText('engine offline');
        expect(fixture.files['sum-chat'].messages[5].extra.memory).toBe('Edited anyway.');
        await expect(summaryInput(page)).toHaveValue('Edited anyway.');
    });

    test('shows the error and keeps the draft when the chat file cannot be saved', async ({ page }) => {
        const fixture = createSummaryFixture({ memories: { 5: 'latest summary' } });
        fixture.failSave = 'disk full';
        await mockSummaryChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page);
        await openChat(page);
        await openSummary(page);

        await summaryInput(page).fill('Will not be saved.');
        await page.locator('[data-cs-save]').click();
        await expect(summaryMessage(page, 'error')).toContainText('保存失败');
        await expect(summaryInput(page)).toHaveValue('Will not be saved.');
        await expect(page.locator('[data-cs-dirty]')).toBeVisible();
        expect(calls.map(call => call.action)).not.toContain('reloadChat');
        await page.locator('[data-cs-reset]').click();
        await expect(summaryInput(page)).toHaveValue('latest summary');
    });

    test('cannot edit, clear or summarize while a reply is being generated', async ({ page }) => {
        const fixture = createSummaryFixture({ memories: { 5: 'latest summary' }, memory: { ...baseMemory, promptInterval: 100 } });
        await mockSummaryChatRoutes(page, fixture);
        const generateGate = createDeferred();
        const calls = await mockBridgeFrame(page, {
            replies: { generate: async ({ chat }) => (await generateGate.promise, { chat: `${stripJsonlExtension(chat)}.jsonl`, messageCount: 8, saved: true }) },
        });
        await openChat(page);
        await page.locator('[data-chat-input]').fill('please answer');
        await page.locator('[data-send-message]').click();
        await expect.poll(() => calls.filter(call => call.action === 'generate').length).toBe(1);

        await openSummary(page);
        await expect(page.locator('[data-cs-run]')).toBeDisabled();
        await expect(page.locator('[data-cs-run-hint]')).toContainText('正在生成，结束后才能重新摘要');
        await expect(page.locator('[data-cs-clear]')).toBeDisabled();
        await summaryInput(page).evaluate(element => { element.readOnly = false; });
        await summaryInput(page).fill('typed while generating');
        await expect(page.locator('[data-cs-save]')).toBeDisabled();
        expect(fixture.chatSaves).toHaveLength(0);

        generateGate.resolve();
        await expect(page.locator('[data-cs-run]')).toBeEnabled();
        expect(summarizeCalls(calls)).toHaveLength(0);
    });

    test('explains the Extras source, offers the way to the settings, and does not allow a manual summary', async ({ page }) => {
        const fixture = createSummaryFixture({ memory: { ...baseMemory, source: 'extras' } });
        await mockSummaryChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page);
        await openChat(page);
        await openSummary(page);

        await expect(page.locator('[data-cs-source]')).toContainText('Extras');
        await expect(page.locator('[data-cs-source-warning]')).toContainText('Extras 服务器');
        await expect(page.locator('[data-cs-run]')).toBeDisabled();
        await expect(page.locator('[data-cs-run-hint]')).toContainText('无法生成');
        // the callout above already says it, the status line does not repeat it
        await expect(page.locator('[data-cs-auto-text]')).toHaveText('');

        await page.locator('[data-cs-open-settings]').click();
        await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'settings');
        await expect(page.locator('[data-settings-summary]')).toBeVisible();
        expect(summarizeCalls(calls)).toHaveLength(0);
    });

    test('explains a disabled summary extension', async ({ page }) => {
        const fixture = createSummaryFixture({ settingsExtra: { disabledExtensions: ['memory'] } });
        await mockSummaryChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await openSummary(page);

        await expect(page.locator('[data-cs-run]')).toBeDisabled();
        await expect(page.locator('[data-cs-run-hint]')).toContainText('被禁用');
        await expect(page.locator('[data-cs-auto-text]')).toContainText('被禁用');
    });
});

test.describe('Summarize now', () => {
    test.use({ viewport: desktopViewport });

    test('sends a forced summarize request, locks the chat while it runs, and shows the engine-written summary afterwards', async ({ page }) => {
        const fixture = createSummaryFixture({ memories: { 2: 'older summary' } });
        await mockSummaryChatRoutes(page, fixture);
        const gate = createDeferred();
        const calls = await mockBridgeFrame(page, {
            replies: {
                summarize: async () => {
                    await gate.promise;
                    engineWriteSummary(fixture, 'sum-chat', 6, 'Fresh summary from the model.');
                    return { due: true, summary: 'Fresh summary from the model.', index: 6, saved: true, reason: '', messageCount: 8 };
                },
            },
        });
        await openChat(page);
        await openSummary(page);

        await page.locator('[data-cs-run]').click();
        await expect.poll(() => summarizeCalls(calls).length).toBe(1);
        expect(summarizeCalls(calls)[0].payload).toEqual({ avatar: 'alice.png', groupId: null, chat: 'sum-chat', integrity: 'int-1', mode: 'force' });
        // while the model works the chat is locked, like during a generation, and can be stopped
        await expect(page.locator('[data-send-message]')).toContainText('生成中');
        await expect(page.locator('[data-stop-generation]').first()).toBeVisible();
        await expect(page.locator('[data-cs-run]')).toBeDisabled();
        await expect(page.locator('[data-cs-run]')).toContainText('摘要中');

        gate.resolve();
        await expect(page.locator('[data-cs-run-notice]')).toContainText('摘要已更新，写在第 7 条消息上');
        await expect(summaryInput(page)).toHaveValue('Fresh summary from the model.');
        await expect(page.locator('[data-cs-location]')).toContainText('位于第 7 条消息');
        await expect(page.locator('[data-cs-run]')).toBeEnabled();
        // the page read the chat file again to get the summary and the new revision
        expect(fixture.chatReads.length).toBeGreaterThan(1);
        // the next write by Modern uses the revision the engine's save produced
        await summaryInput(page).fill('Edited after the model.');
        await page.locator('[data-cs-save]').click();
        await expect.poll(() => fixture.chatSaves.length).toBe(1);
        expect(fixture.chatSaves[0].header.chat_metadata.integrity).toBe('int-2');
        expect(fixture.files['sum-chat'].messages[6].extra.memory).toBe('Edited after the model.');
    });

    test('works in a group chat with the group payload', async ({ page }) => {
        const fixture = createSummaryFixture();
        await mockSummaryChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page, {
            replies: {
                summarize: () => {
                    engineWriteSummary(fixture, 'alpha-chat', 6, 'Group summary.');
                    return { due: true, summary: 'Group summary.', index: 6, saved: true, reason: '' };
                },
            },
        });
        await openChat(page);
        await page.locator('[data-chat-mode="group"]').click();
        await expect(page.locator('.detail-title')).toHaveText('Alpha Group');
        await page.locator('[data-select-chat="alpha-chat"]').click();
        await expect(page.locator('.chat-thread')).toContainText('user message 7');
        await openSummary(page);

        await page.locator('[data-cs-run]').click();
        await expect(summaryInput(page)).toHaveValue('Group summary.');
        expect(summarizeCalls(calls)[0].payload).toEqual({ avatar: null, groupId: 'group-alpha', chat: 'alpha-chat', integrity: 'int-1', mode: 'force' });
    });

    test('the stop button reaches the engine and the stopped summary leaves the chat as it was', async ({ page }) => {
        const fixture = createSummaryFixture();
        await mockSummaryChatRoutes(page, fixture);
        const gate = createDeferred();
        const calls = await mockBridgeFrame(page, {
            replies: {
                summarize: async () => {
                    await gate.promise;
                    return { due: true, summary: '', index: -1, saved: false, reason: 'stopped', stopped: true };
                },
                stop: () => {
                    gate.resolve();
                    return { stopped: true };
                },
            },
        });
        await openChat(page);
        await openSummary(page);

        await page.locator('[data-cs-run]').click();
        await expect.poll(() => summarizeCalls(calls).length).toBe(1);
        // the composer's stop button sits behind the drawer, so the panel carries its own
        await expect(page.locator('[data-cs-run]')).toContainText('摘要中');
        await page.locator('[data-chat-summary] [data-stop-generation]').click();
        await expect.poll(() => calls.map(call => call.action)).toContain('stop');
        await expect(page.locator('[data-cs-run-notice]')).toContainText('摘要已停止');
        await expect(page.locator('[data-cs-run]')).toBeEnabled();
        expect(fixture.chatSaves).toHaveLength(0);
        expect(fixture.files['sum-chat'].messages.some(message => message.extra?.memory)).toBe(false);
    });

    test('reports an engine failure in the panel and a toast, and leaves the chat usable', async ({ page }) => {
        const fixture = createSummaryFixture();
        await mockSummaryChatRoutes(page, fixture);
        await mockBridgeFrame(page, { replies: { summarize: () => { throw new Error('摘要来源是 Extras API，它需要连接 Extras 服务器'); } } });
        await openChat(page);
        await openSummary(page);

        await page.locator('[data-cs-run]').click();
        await expect(page.locator('[data-cs-run-notice]')).toContainText('摘要失败');
        await expect(page.locator('[data-cs-run-notice]')).toContainText('Extras');
        await expect(page.locator('.toast').first()).toContainText('聊天摘要失败');
        await expect(page.locator('[data-cs-run]')).toBeEnabled();
        await expect(page.locator('[data-send-message]')).not.toContainText('生成中');
    });

    test('tells the reason when the engine wrote nothing', async ({ page }) => {
        const fixture = createSummaryFixture();
        await mockSummaryChatRoutes(page, fixture);
        const replies = { summarize: () => ({ due: true, summary: '', index: -1, saved: false, reason: 'empty-summary' }) };
        await mockBridgeFrame(page, { replies });
        await openChat(page);
        await openSummary(page);

        await page.locator('[data-cs-run]').click();
        await expect(page.locator('[data-cs-run-notice]')).toContainText('模型没有返回摘要内容');

        replies.summarize = () => ({ due: true, summary: 'x', index: 6, saved: false, reason: 'save-failed' });
        await page.locator('[data-cs-run]').click();
        await expect(page.locator('[data-cs-run-notice]')).toContainText('聊天文件没有接受写入');
        replies.summarize = () => ({ due: true, summary: '', index: -1, saved: false, reason: 'nothing' });
        await page.locator('[data-cs-run]').click();
        await expect(page.locator('[data-cs-run-notice]')).toContainText('先清除当前摘要');
        expect(fixture.chatSaves).toHaveLength(0);
    });
});

test.describe('Automatic summary after a generation', () => {
    test.use({ viewport: desktopViewport });

    async function sendMessage(page, text = 'please continue') {
        await page.locator('[data-chat-input]').fill(text);
        await page.locator('[data-send-message]').click();
    }

    function generateReply(fixture, extra = {}) {
        return ({ chat }) => {
            engineAppendTurn(fixture, 'sum-chat', 'Alice Fixture');
            return { chat: `${stripJsonlExtension(chat)}.jsonl`, messageCount: fixture.files['sum-chat'].messages.length, saved: true, ...extra };
        };
    }

    test('asks the engine for an automatic summary after the reply was synced, then reads the chat file again', async ({ page }) => {
        const fixture = createSummaryFixture();
        await mockSummaryChatRoutes(page, fixture);
        const summaryGate = createDeferred();
        const calls = await mockBridgeFrame(page, {
            replies: {
                generate: generateReply(fixture),
                summarize: async () => {
                    await summaryGate.promise;
                    engineWriteSummary(fixture, 'sum-chat', 8, 'Auto summary.');
                    return { due: true, summary: 'Auto summary.', index: 8, saved: true, reason: '' };
                },
            },
        });
        await openChat(page);
        await sendMessage(page);

        await expect.poll(() => summarizeCalls(calls).length).toBe(1);
        expect(calls.map(call => call.action).filter(action => action === 'generate' || action === 'summarize')).toEqual(['generate', 'summarize']);
        // the reply is already on screen while the summary is still being made; the chat stays locked and can be stopped
        await expect(page.locator('.chat-thread')).toContainText('engine reply');
        await expect(page.locator('[data-send-message]')).toContainText('生成中');
        await expect(page.locator('[data-stop-generation]')).toBeVisible();
        const payload = summarizeCalls(calls)[0].payload;
        expect(payload).toEqual({ avatar: 'alice.png', groupId: null, chat: 'sum-chat', integrity: 'int-2', mode: 'auto' });
        expect(BRIDGE_TIMEOUTS.SUMMARIZE).toBeGreaterThanOrEqual(BRIDGE_TIMEOUTS.DEFAULT);

        summaryGate.resolve();
        await expect(page.locator('[data-send-message]')).not.toContainText('生成中');
        await openSummary(page);
        await expect(summaryInput(page)).toHaveValue('Auto summary.');
        await expect(page.locator('[data-cs-location]')).toContainText('位于第 9 条消息');
        await expect(page.locator('[data-cs-run-notice]')).toContainText('摘要已更新，写在第 9 条消息上');
        // sending again works, with the revision the engine's summary save produced
        const generateCalls = calls.filter(call => call.action === 'generate');
        expect(generateCalls[0].payload.integrity).toBe('int-1');
    });

    test('does not call the engine when the Extras source is selected (the user\'s current setting)', async ({ page }) => {
        const fixture = createSummaryFixture({ memory: { ...baseMemory, source: 'extras' } });
        await mockSummaryChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page, { replies: { generate: generateReply(fixture) } });
        await openChat(page);
        await sendMessage(page);

        await expect(page.locator('.chat-thread')).toContainText('engine reply');
        await expect(page.locator('[data-send-message]')).not.toContainText('生成中');
        expect(summarizeCalls(calls)).toHaveLength(0);
    });

    test('does not call the engine while paused, switched off, below the interval, or with the extension disabled', async ({ page }) => {
        const cases = [
            { ...baseMemory, memoryFrozen: true },
            { ...baseMemory, promptInterval: 0 },
            { ...baseMemory, promptInterval: 100 },
        ];
        for (const memory of cases) {
            const fixture = createSummaryFixture({ memory });
            await mockSummaryChatRoutes(page, fixture);
            const calls = await mockBridgeFrame(page, { replies: { generate: generateReply(fixture) } });
            await openChat(page);
            await sendMessage(page);
            await expect(page.locator('.chat-thread')).toContainText('engine reply');
            await expect(page.locator('[data-send-message]')).not.toContainText('生成中');
            expect(summarizeCalls(calls)).toHaveLength(0);
            await page.unrouteAll({ behavior: 'ignoreErrors' });
        }

        const disabled = createSummaryFixture({ settingsExtra: { disabledExtensions: ['memory'] } });
        await mockSummaryChatRoutes(page, disabled);
        const calls = await mockBridgeFrame(page, { replies: { generate: generateReply(disabled) } });
        await openChat(page);
        await sendMessage(page);
        await expect(page.locator('.chat-thread')).toContainText('engine reply');
        expect(summarizeCalls(calls)).toHaveLength(0);
    });

    test('a summary that is not due on the engine side stays quiet', async ({ page }) => {
        const fixture = createSummaryFixture();
        await mockSummaryChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page, {
            replies: {
                generate: generateReply(fixture),
                summarize: () => ({ due: false, summary: '', index: -1, saved: false, reason: 'waiting' }),
            },
        });
        await openChat(page);
        await sendMessage(page);

        await expect.poll(() => summarizeCalls(calls).length).toBe(1);
        await expect(page.locator('[data-send-message]')).not.toContainText('生成中');
        await expect(page.locator('.toast')).toHaveCount(1);
        await expect(page.locator('.toast')).toContainText('消息已生成');
        await openSummary(page);
        await expect(page.locator('[data-cs-run-notice]')).toHaveCount(0);
        await expect(summaryInput(page)).toHaveValue('');
    });

    test('a failing summary never fails the generation: the reply stays, the chat unlocks and a quiet notice appears', async ({ page }) => {
        const fixture = createSummaryFixture();
        await mockSummaryChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page, {
            replies: {
                generate: generateReply(fixture),
                summarize: () => { throw new Error('模型接口超时'); },
            },
        });
        await openChat(page);
        await sendMessage(page);

        await expect.poll(() => summarizeCalls(calls).length).toBe(1);
        await expect(page.locator('[data-send-message]')).not.toContainText('生成中');
        await expect(page.locator('.chat-thread')).toContainText('engine reply');
        await expect(page.locator('.toast').filter({ hasText: '聊天摘要未更新' })).toContainText('模型接口超时');
        await expect(page.locator('.toast').filter({ hasText: '聊天摘要未更新' })).toContainText('回复本身已正常保存');
        // the generation itself is reported as done, not as a failure
        await expect(page.locator('.engine-panel .danger')).toHaveCount(0);
        await openSummary(page);
        await expect(page.locator('[data-cs-run-notice]')).toContainText('摘要没有更新：模型接口超时');
        // and the chat can be used again right away
        await page.locator('[data-chat-input]').fill('another one');
        await expect(page.locator('[data-send-message]')).toBeEnabled();
    });

    test('warns when the engine made the summary but the chat file did not take it', async ({ page }) => {
        const fixture = createSummaryFixture();
        await mockSummaryChatRoutes(page, fixture);
        await mockBridgeFrame(page, {
            replies: {
                generate: generateReply(fixture),
                summarize: () => ({ due: true, summary: 'lost', index: 8, saved: false, reason: 'save-failed' }),
            },
        });
        await openChat(page);
        await sendMessage(page);

        await expect(page.locator('.toast').filter({ hasText: '聊天摘要' })).toContainText('聊天文件没有接受写入');
        await expect(page.locator('[data-send-message]')).not.toContainText('生成中');
        await openSummary(page);
        await expect(summaryInput(page)).toHaveValue('');
    });

    test('a stopped generation is not summarized', async ({ page }) => {
        const fixture = createSummaryFixture();
        await mockSummaryChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page, {
            replies: { generate: generateReply(fixture, { stopped: true, started: true, keptReplyChars: 12 }) },
        });
        await openChat(page);
        await sendMessage(page);

        await expect(page.locator('.toast').first()).toContainText('已停止生成');
        await expect(page.locator('[data-send-message]')).not.toContainText('生成中');
        expect(summarizeCalls(calls)).toHaveLength(0);
    });

    test('regenerating also triggers the due check', async ({ page }) => {
        const fixture = createSummaryFixture();
        await mockSummaryChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page, {
            replies: {
                generate: ({ chat }) => ({ chat: `${stripJsonlExtension(chat)}.jsonl`, messageCount: 8, saved: true }),
                summarize: () => ({ due: false, summary: '', index: -1, saved: false, reason: 'waiting' }),
            },
        });
        await openChat(page);
        await page.locator('[data-regenerate-message]').click();
        await expect.poll(() => summarizeCalls(calls).length).toBe(1);
        expect(calls.filter(call => call.action === 'generate')[0].payload.type).toBe('regenerate');
    });
});

test.describe('Summary settings', () => {
    test.use({ viewport: desktopViewport });

    async function openSettings(page) {
        await page.goto('/modern/?view=settings');
        await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');
        await page.locator('[data-settings-section="chat-tools"]').click();
        await expect(page.locator('[data-settings-summary]')).toBeVisible();
    }

    const field = (page, name) => page.locator(`[data-settings-summary] [data-ss-field="${name}"]`);
    const message = (page, kind) => page.locator(`[data-ss-message="${kind}"]`);

    test('warns about the Extras source and switches to the main model with one click, changing nothing else', async ({ page }) => {
        const fixture = createSummaryFixture({ memory: { ...baseMemory, source: 'extras', promptInterval: 7 } });
        await mockSummaryChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page);
        await openSettings(page);

        await expect(page.locator('[data-ss-extras-banner]')).toContainText('Extras 服务器');
        await expect(page.locator('[data-ss-extras-banner]')).toContainText('多一次主模型调用');
        await expect(field(page, 'source')).toHaveValue('extras');
        // opening the page never rewrites the settings
        expect(fixture.requests.settingsSave).toHaveLength(0);
        expect(calls.map(call => call.action)).not.toContain('reloadSettings');

        await page.locator('[data-ss-switch-main]').click();
        await expect(message(page, 'notice')).toContainText('摘要来源已切换为主模型');
        await expect(page.locator('[data-ss-extras-banner]')).toHaveCount(0);
        await expect(field(page, 'source')).toHaveValue('main');

        expect(fixture.requests.settingsSave).toHaveLength(1);
        const saved = fixture.requests.settingsSave[0].extension_settings.memory;
        expect(saved).toEqual({ ...baseMemory, source: 'main', promptInterval: 7 });
        expect(calls.filter(call => call.action === 'reloadSettings')).toHaveLength(1);
    });

    test('keeps unsaved edits when the source is switched, and saves only the source then', async ({ page }) => {
        const fixture = createSummaryFixture({ memory: { ...baseMemory, source: 'extras' } });
        await mockSummaryChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openSettings(page);

        await field(page, 'promptInterval').fill('20');
        await page.locator('[data-ss-switch-main]').click();
        await expect(message(page, 'notice')).toBeVisible();
        expect(fixture.requests.settingsSave[0].extension_settings.memory.promptInterval).toBe(4);
        expect(fixture.requests.settingsSave[0].extension_settings.memory.source).toBe('main');
        await expect(field(page, 'promptInterval')).toHaveValue('20');
        await expect(page.locator('[data-ss-dirty]')).toBeVisible();
    });

    test('saves every field with the right type, keeps unrelated keys, and asks the engine to reload the settings', async ({ page }) => {
        const fixture = createSummaryFixture();
        fixture.settings.extension_settings.note = { default: 'keep me' };
        await mockSummaryChatRoutes(page, fixture);
        const reloadGate = createDeferred();
        const calls = await mockBridgeFrame(page, { replies: { reloadSettings: () => reloadGate.promise } });
        await openSettings(page);

        await expect(page.locator('[data-ss-extras-banner]')).toHaveCount(0);
        await expect(field(page, 'source')).toHaveValue('main');
        await expect(page.locator('[data-ss-depth-group]')).toBeHidden();

        await field(page, 'source').selectOption('webllm');
        await field(page, 'prompt_builder').selectOption('2');
        await field(page, 'promptInterval').fill('12');
        await field(page, 'promptForceWords').fill('3000');
        await field(page, 'memoryFrozen').check();
        await field(page, 'promptWords').fill('300');
        await field(page, 'overrideResponseLength').fill('512');
        await field(page, 'maxMessagesPerRequest').fill('20');
        await field(page, 'SkipWIAN').check();
        await field(page, 'prompt').fill('Write {{words}} words.');
        await field(page, 'template').fill('<memory>{{summary}}</memory>');
        await field(page, 'position').selectOption('1');
        await expect(page.locator('[data-ss-depth-group]')).toBeVisible();
        await field(page, 'depth').fill('6');
        await field(page, 'role').selectOption('2');
        await field(page, 'scan').check();
        await expect(page.locator('[data-ss-dirty]')).toBeVisible();

        await page.locator('[data-ss-save]').click();
        await expect.poll(() => fixture.requests.settingsSave.length).toBe(1);
        await expect.poll(() => calls.filter(call => call.action === 'reloadSettings').length).toBe(1);
        // saved, the engine has not confirmed yet
        await expect(page.locator('[data-ss-save]')).toContainText('保存中');
        await expect(message(page, 'notice')).toBeHidden();

        reloadGate.resolve({ ok: true });
        await expect(message(page, 'notice')).toContainText('摘要设置已保存，生成引擎已同步');
        await expect(page.locator('[data-ss-dirty]')).toBeHidden();

        const extensionSettings = fixture.requests.settingsSave[0].extension_settings;
        expect(extensionSettings.memory).toEqual({
            ...baseMemory,
            source: 'webllm',
            prompt_builder: 2,
            promptInterval: 12,
            promptForceWords: 3000,
            memoryFrozen: true,
            promptWords: 300,
            overrideResponseLength: 512,
            maxMessagesPerRequest: 20,
            SkipWIAN: true,
            prompt: 'Write {{words}} words.',
            template: '<memory>{{summary}}</memory>',
            position: 1,
            depth: 6,
            role: 2,
            scan: true,
        });
        expect(extensionSettings.note).toEqual({ default: 'keep me' });
        // the stale slider limits an old settings.json carried are left alone
        expect(extensionSettings.memory.promptMinInterval).toBe(1);
        expect(extensionSettings.memory.promptMaxInterval).toBe(100);
    });

    test('rejects out-of-range values inline and saves nothing', async ({ page }) => {
        const fixture = createSummaryFixture();
        await mockSummaryChatRoutes(page, fixture);
        const calls = await mockBridgeFrame(page);
        await openSettings(page);

        await field(page, 'promptInterval').fill('251');
        await field(page, 'promptWords').fill('10');
        await field(page, 'overrideResponseLength').fill('-5');
        await field(page, 'prompt').fill('   ');
        await field(page, 'template').fill('no macro');
        await page.locator('[data-ss-save]').click();

        await expect(page.locator('[data-ss-error="promptInterval"]')).toContainText('0 到 250');
        await expect(page.locator('[data-ss-error="promptWords"]')).toContainText('25 到 1000');
        await expect(page.locator('[data-ss-error="overrideResponseLength"]')).toContainText('0 到 4096');
        await expect(page.locator('[data-ss-error="prompt"]')).toContainText('不能为空');
        await expect(page.locator('[data-ss-error="template"]')).toContainText('{{summary}}');
        expect(fixture.requests.settingsSave).toHaveLength(0);
        expect(calls.map(call => call.action)).not.toContain('reloadSettings');

        // fixing a field clears its message right away
        await field(page, 'promptInterval').fill('250');
        await expect(page.locator('[data-ss-error="promptInterval"]')).toBeHidden();
        await page.locator('[data-ss-restore-prompt]').click();
        await expect(field(page, 'prompt')).toHaveValue(/Ignore previous instructions/);
        await expect(page.locator('[data-ss-error="prompt"]')).toBeHidden();
        // the other fields kept their unsaved values across the re-render
        await expect(field(page, 'promptInterval')).toHaveValue('250');
        await expect(field(page, 'template')).toHaveValue('no macro');
    });

    test('shows a clear warning when the settings were saved but the engine could not apply them', async ({ page }) => {
        const fixture = createSummaryFixture();
        await mockSummaryChatRoutes(page, fixture);
        await mockBridgeFrame(page, { replies: { reloadSettings: () => { throw new Error('engine offline'); } } });
        await openSettings(page);

        await field(page, 'promptInterval').fill('9');
        await page.locator('[data-ss-save]').click();
        await expect(message(page, 'warning')).toContainText('摘要设置已保存');
        await expect(message(page, 'warning')).toContainText('engine offline');
        await expect(message(page, 'notice')).toBeHidden();
        expect(fixture.settings.extension_settings.memory.promptInterval).toBe(9);
        await expect(field(page, 'promptInterval')).toHaveValue('9');
    });

    test('rolls the in-memory settings back when the save fails', async ({ page }) => {
        const fixture = createSummaryFixture();
        await mockSummaryChatRoutes(page, fixture);
        await page.route('**/api/settings/save', route => fulfillJson(route, { error: 'disk full' }, 500));
        const calls = await mockBridgeFrame(page);
        await openSettings(page);

        await field(page, 'promptInterval').fill('9');
        await page.locator('[data-ss-save]').click();
        await expect(message(page, 'error')).toContainText('保存失败');
        await expect(field(page, 'promptInterval')).toHaveValue('9');
        await expect(page.locator('[data-ss-dirty]')).toBeVisible();
        expect(calls.map(call => call.action)).not.toContain('reloadSettings');
        // the reset button goes back to what is actually saved (4), not to the failed value
        await page.locator('[data-ss-reset]').click();
        await expect(field(page, 'promptInterval')).toHaveValue('4');
    });

    test('a disabled extension is explained at the top', async ({ page }) => {
        const fixture = createSummaryFixture({ settingsExtra: { disabledExtensions: ['memory'] } });
        await mockSummaryChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openSettings(page);

        await expect(page.locator('[data-ss-disabled-banner]')).toContainText('被禁用');
    });
});

test.describe('Summary in the context drawer', () => {
    test.use({ viewport: desktopViewport });

    test('shows the summary, where it is, the source and the progress', async ({ page }) => {
        const fixture = createSummaryFixture({ memories: { 5: 'The knight swore an oath.' } });
        await mockSummaryChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await page.locator('[data-toggle-inspector]').first().click();

        const section = page.locator('[data-inspector-chat-summary]');
        await expect(section).toBeVisible();
        await expect(section).toContainText('聊天摘要');
        await expect(section).toContainText('主模型');
        await expect(section).toContainText('第 6 条消息');
        await expect(section).toContainText('2 条消息 / 间隔 4 条');
        await expect(section.locator('[data-inspector-summary-text]')).toHaveText('The knight swore an oath.');
    });

    test('says there is no summary yet and why nothing is generated for the Extras source', async ({ page }) => {
        const fixture = createSummaryFixture({ memory: { ...baseMemory, source: 'extras' } });
        await mockSummaryChatRoutes(page, fixture);
        await mockBridgeFrame(page);
        await openChat(page);
        await page.locator('[data-toggle-inspector]').first().click();

        const section = page.locator('[data-inspector-chat-summary]');
        await expect(section).toContainText('这个聊天还没有摘要');
        await expect(section).toContainText('Extras');
        await expect(section).toContainText('不会自动生成摘要');
        await expect(section.locator('[data-inspector-summary-text]')).toHaveCount(0);
    });
});
