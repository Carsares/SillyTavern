/* global globalThis */

import { beforeEach, describe, expect, jest, test } from '@jest/globals';

// 被测模块不直接读 localStorage / window，但聊天相关模块常经 core/state.js 间接引入它们：先放好替身再加载，免得以后改了引入链就崩
const storage = new Map();
globalThis.localStorage = /** @type {any} */ ({
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
});
globalThis.window = /** @type {any} */ ({ matchMedia: () => ({ matches: false }) });

const { createChatImageMessageComponents, describeImageInfo, getElapsedSeconds, rememberImagePromptOpen, toSafeImageUrl } = await import('../public/modern/components/chat-image-message.js');
const { createChatImageViewActions } = await import('../public/modern/actions/chat-image-view.js');
const { bindChatImageMessageEvents } = await import('../public/modern/routes/chat-image-message-events.js');
const { buildImageMessage, messageIdentity } = await import('../public/modern/core/image-message.js');
const { escapeHtml, formatDate } = await import('../public/modern/core/utils.js');

const CHAT_KEY = 'alice.png::chat-1';
const IMAGE_PATH_1 = '/user/images/莉亚 Fixture/莉亚 Fixture_2026-10-12@00h19m24s_1.png';
const IMAGE_PATH_2 = '/user/images/莉亚 Fixture/莉亚 Fixture_2026-10-12@00h20m02s_1.png';

function textMessage(index, extra = {}) {
    return {
        name: index % 2 ? 'User' : 'Alice',
        is_user: Boolean(index % 2),
        is_system: false,
        send_date: `2026-10-12T00:0${index}:00.000Z`,
        mes: `message ${index}`,
        ...extra,
    };
}

function imageMessage({ versions = 2, mediaIndex = versions - 1, origin = 'manual', sourceCount = 0 } = {}) {
    const meta = {
        prompt: 'moonlit rooftop, <b>cinematic</b> & "soft" light',
        negativePrompt: 'blurry',
        provider: 'openai',
        model: 'gpt-image-1',
        params: { width: 1024, height: 1536, quality: 'high' },
        requestId: 'req-1',
        origin,
        sourceCount,
        elapsedMs: 12_400,
    };
    const images = [IMAGE_PATH_1, IMAGE_PATH_2].slice(0, versions).map(path => ({ path, width: 1024, height: 1536, mimeType: 'image/png' }));
    const message = buildImageMessage({ name: 'Alice', sendDate: '2026-10-12T00:19:24.000Z', images, meta });
    message.extra.media_index = mediaIndex;
    // 第二个版本换一个提示词，区分「当前版本」和「大图里看的版本」
    if (message.extra.media[1]) {
        message.extra.media[1].title = 'second version prompt';
    }
    return message;
}

function createState(overrides = {}) {
    return {
        engine: { generating: false },
        selected: { chat: 'chat-1' },
        chatImageGeneration: {},
        chatMessageDeleteConfirm: { key: '', index: -1 },
        errors: [],
        ...overrides,
    };
}

function createCtx({ state = createState(), messages = [], chatKey = CHAT_KEY, limit = 80 } = {}) {
    return {
        state,
        escapeHtml,
        formatDate,
        getCurrentDraftKey: () => chatKey,
        getSelectedChatMessages: () => messages,
        getSelectedChatEntity: () => ({ avatar: 'alice.png', name: 'Alice' }),
        getChatEntityName: entity => entity.name,
        getCurrentMessageLimit: () => limit,
    };
}

function pendingJob(overrides = {}) {
    return {
        requestId: 'req-9',
        status: 'pending',
        cacheKey: CHAT_KEY,
        contextKey: 'alice.png',
        chatId: 'chat-1',
        groupMode: false,
        kind: 'new',
        targetIdentity: '',
        prompt: 'a lighthouse',
        negativePrompt: '',
        params: { width: 1024, height: 1536 },
        provider: 'openai',
        model: 'gpt-image-1',
        origin: 'manual',
        sourceCount: 0,
        startedAt: Date.now() - 7_200,
        ratio: 1.5,
        failure: null,
        ...overrides,
    };
}

describe('image message card', () => {
    test('shows the two tags, the current version, the prompt, the parameters and the actions', () => {
        const message = imageMessage();
        const messages = [textMessage(0), message];
        const { renderImageMessage } = createChatImageMessageComponents(createCtx({ messages }));
        const html = renderImageMessage(message, 1, {});

        expect(html).toContain('class="message image-message ');
        expect(html).toContain('data-image-message-index="1"');
        expect(html).toContain('<strong>Alice</strong>');
        expect(html).toContain('图片</span>');
        expect(html).toContain('不进入上下文</span>');
        expect(html).toContain('title="保存为 is_system 消息，后续文本回复看不到它"');
        expect(html).toContain(escapeHtml(formatDate(message.send_date)));
        // the shown image is the current version (media_index 1), its path is URL-encoded and attribute-escaped
        expect(html).toContain(`src="${escapeHtml(encodeURI(IMAGE_PATH_2))}"`);
        expect(html).not.toContain(encodeURI(IMAGE_PATH_1));
        expect(html).toContain('alt="生成的图片：second version prompt"');
        expect(html).toContain(`href="${escapeHtml(encodeURI(IMAGE_PATH_2))}" download data-image-message-download="1"`);
        expect(html).toContain('提示词 · 手动输入');
        expect(html).toContain('second version prompt');
        expect(html).toContain('反向提示词：</span>blurry');
        expect(html).toContain('OpenAI · gpt-image-1 · 1024×1536 · 质量 高 · 耗时 12 秒');
        expect(html).toContain('data-image-message-regenerate="1"');
        expect(html).toContain('data-image-message-edit="1"');
        expect(html).toContain('data-image-message-copy="1"');
        expect(html).toContain('data-delete-message="1"');
        expect(html).toContain('aria-label="编辑或删除消息"');
        expect(html).not.toContain('data-image-message-pending');
    });

    test('escapes the prompt and keeps the alt text short', () => {
        const message = imageMessage({ versions: 1, mediaIndex: 0 });
        message.extra.media[0].title = `<script>alert(1)</script> ${'long prompt words '.repeat(20)}`;
        const { renderImageMessage } = createChatImageMessageComponents(createCtx({ messages: [message] }));
        const html = renderImageMessage(message, 0, {});

        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        const alt = /alt="([^"]*)"/.exec(html)[1];
        expect(alt.startsWith('生成的图片：')).toBe(true);
        expect(alt.endsWith('…')).toBe(true);
        expect(alt.length).toBeLessThan(110);
    });

    test('shows the version switcher only with more than one version and disables the ends', () => {
        const single = imageMessage({ versions: 1, mediaIndex: 0 });
        const double = imageMessage({ versions: 2, mediaIndex: 1 });
        const { renderImageMessage } = createChatImageMessageComponents(createCtx({ messages: [single, double] }));

        expect(renderImageMessage(single, 0, {})).not.toContain('data-image-message-version=');

        const html = renderImageMessage(double, 1, {});
        expect(html).toContain('data-image-message-version-label>2/2</span>');
        expect(html).toMatch(/data-image-message-direction="-1"[^>]*aria-label="上一个版本"\s*>/);
        expect(html).toMatch(/data-image-message-direction="1"[^>]*aria-label="下一个版本" disabled>/);

        double.extra.media_index = 0;
        const first = renderImageMessage(double, 1, {});
        expect(first).toContain('data-image-message-version-label>1/2</span>');
        expect(first).toMatch(/data-image-message-direction="-1"[^>]*disabled>/);
        expect(first).toMatch(/data-image-message-direction="1"[^>]*aria-label="下一个版本"\s*>/);
    });

    test('locks version switching and regenerating while anything is generating', () => {
        const state = createState({ engine: { generating: true } });
        const message = imageMessage({ versions: 2, mediaIndex: 0 });
        const { renderImageMessage } = createChatImageMessageComponents(createCtx({ state, messages: [message] }));
        const html = renderImageMessage(message, 0, {});

        expect(html).toMatch(/data-image-message-direction="1"[^>]*title="生成中不能切换版本"[^>]*disabled>/);
        expect(html).toMatch(/data-image-message-regenerate="0"[^>]*disabled>/);
        // copying and editing the prompt stay available
        expect(html).not.toMatch(/data-image-message-copy="0"[^>]*disabled>/);
        expect(html).not.toMatch(/data-image-message-edit="0"[^>]*disabled>/);
    });

    test('says where a prompt made from messages came from', () => {
        const message = imageMessage({ versions: 1, mediaIndex: 0, origin: 'messages', sourceCount: 3 });
        const { renderImageMessage } = createChatImageMessageComponents(createCtx({ messages: [message] }));
        expect(renderImageMessage(message, 0, {})).toContain('提示词 · 由 3 条消息生成');
    });

    test('takes the selection class and attributes, and shows the manage panel only while deleting', () => {
        const message = imageMessage();
        const { renderImageMessage } = createChatImageMessageComponents(createCtx({ messages: [message] }));
        const selection = { className: 'is-unselectable', attrs: 'title="图片消息不参与生成提示词"', controlHtml: '' };

        const idle = renderImageMessage(message, 0, { selection, isDeleting: false, managePanelHtml: '<div data-manage-panel></div>' });
        expect(idle).toContain('class="message image-message is-unselectable"');
        expect(idle).toContain('title="图片消息不参与生成提示词"');
        expect(idle).not.toContain('data-manage-panel');
        expect(idle).not.toMatch(/data-delete-message="0"[^>]*disabled>/);

        const deleting = renderImageMessage(message, 0, { selection, isDeleting: true, managePanelHtml: '<div data-manage-panel></div>' });
        expect(deleting).toContain('<div data-manage-panel></div>');
        expect(deleting).toMatch(/data-delete-message="0"[^>]*disabled>/);
    });

    test('keeps an expanded prompt open across renders', () => {
        const message = imageMessage();
        const { renderImageMessage } = createChatImageMessageComponents(createCtx({ messages: [message] }));
        const key = `${CHAT_KEY}|${messageIdentity(message)}`;

        expect(renderImageMessage(message, 0, {})).toMatch(/data-image-message-prompt="[^"]*"\s*>/);
        rememberImagePromptOpen(key, true);
        expect(renderImageMessage(message, 0, {})).toContain(`data-image-message-prompt="${escapeHtml(key)}" open>`);
        rememberImagePromptOpen(key, false);
        expect(renderImageMessage(message, 0, {})).not.toContain(' open>');
    });

    test('covers the image with a spinner while a new version of this message is generated in this chat', () => {
        const message = imageMessage();
        const state = createState({ engine: { generating: true } });
        state.chatImageGeneration = { job: pendingJob({ kind: 'version', targetIdentity: messageIdentity(message), startedAt: Date.now() - 4_500 }) };
        const ctx = createCtx({ state, messages: [message] });
        const { renderImageMessage } = createChatImageMessageComponents(ctx);

        const html = renderImageMessage(message, 0, {});
        expect(html).toContain('data-image-message-pending');
        expect(html).toContain('正在生成新版本 · 已等待 <span data-image-job-elapsed>4</span> 秒');
        expect(html).toContain('data-image-job-cancel');

        const other = createChatImageMessageComponents(createCtx({ state, messages: [message], chatKey: 'bruno.png::chat-2' }));
        expect(other.renderImageMessage(message, 0, {})).not.toContain('data-image-message-pending');
    });

    test('never outputs a script URL and explains a missing image', () => {
        const message = imageMessage({ versions: 1, mediaIndex: 0 });
        message.extra.media[0].url = 'javascript:alert(1)';
        // isImageMessage only needs a non-empty url string, so the card is still rendered
        const { renderImageMessage } = createChatImageMessageComponents(createCtx({ messages: [message] }));
        const html = renderImageMessage(message, 0, {});

        expect(html).not.toContain('javascript:');
        expect(html).not.toContain('<img');
        expect(html).not.toContain('data-image-message-download');
        expect(html).toContain('图片地址无效，无法显示。');
    });
});

describe('image helpers', () => {
    test('toSafeImageUrl encodes site paths and rejects other schemes', () => {
        expect(toSafeImageUrl('/user/images/a b/图 1.png')).toBe('/user/images/a%20b/%E5%9B%BE%201.png');
        expect(toSafeImageUrl('https://example.com/x.png')).toBe('https://example.com/x.png');
        expect(toSafeImageUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
        expect(toSafeImageUrl('javascript:alert(1)')).toBe('');
        expect(toSafeImageUrl('//evil.example/x.png')).toBe('');
        expect(toSafeImageUrl('data:text/html,<b>x</b>')).toBe('');
        expect(toSafeImageUrl('')).toBe('');
        expect(toSafeImageUrl(null)).toBe('');
    });

    test('describeImageInfo skips what was not recorded', () => {
        expect(describeImageInfo({ generation: { provider: 'novelai', model: 'nai-diffusion-4-5-full', params: { aspectRatio: '3:4' }, width: null, height: null, elapsedMs: null } }))
            .toBe('NovelAI · nai-diffusion-4-5-full · 3:4');
        expect(describeImageInfo({ url: '/user/images/a.png' })).toBe('');
    });

    test('getElapsedSeconds counts whole seconds and never goes negative', () => {
        expect(getElapsedSeconds(10_000, 17_900)).toBe(7);
        expect(getElapsedSeconds(20_000, 10_000)).toBe(0);
        expect(getElapsedSeconds(NaN, 10_000)).toBe(0);
    });
});

describe('job card', () => {
    test('shows nothing without a job, or when the job belongs to another chat', () => {
        const state = createState();
        const components = createChatImageMessageComponents(createCtx({ state }));
        expect(components.renderImageJobCard()).toBe('');
        expect(components.hasVisibleImageJob()).toBe(false);

        state.chatImageGeneration = { job: pendingJob({ cacheKey: 'bruno.png::chat-2' }) };
        expect(components.renderImageJobCard()).toBe('');
        expect(components.hasVisibleImageJob()).toBe(false);
    });

    test('a pending new image shows a placeholder sized by the ratio, the elapsed seconds and a stop button', () => {
        const state = createState({ engine: { generating: true } });
        state.chatImageGeneration = { job: pendingJob() };
        const components = createChatImageMessageComponents(createCtx({ state }));
        const html = components.renderImageJobCard();

        expect(components.hasVisibleImageJob()).toBe(true);
        expect(html).toContain('data-image-job="pending"');
        expect(html).toContain('style="aspect-ratio: 1 / 1.5000"');
        expect(html).toContain('正在生成 · 已等待 <span data-image-job-elapsed>7</span> 秒');
        expect(html).toContain('OpenAI · gpt-image-1 · 1024×1536');
        expect(html).toContain('data-image-job-cancel');
        expect(html).toContain('停止等待');
        expect(html).toContain('供应商可能照常计费');
        expect(html).toContain('<strong>Alice</strong>');
    });

    test('a pending version shows on its message; the card appears only when that message is gone or folded away', () => {
        const message = imageMessage();
        const messages = [textMessage(0), textMessage(1), message];
        const state = createState({ engine: { generating: true } });
        state.chatImageGeneration = { job: pendingJob({ kind: 'version', targetIdentity: messageIdentity(message) }) };

        const shown = createChatImageMessageComponents(createCtx({ state, messages }));
        expect(shown.hasVisibleImageJob()).toBe(false);
        expect(shown.renderImageJobCard()).toBe('');

        const folded = createChatImageMessageComponents(createCtx({ state, messages: [message, textMessage(1), textMessage(2)], limit: 2 }));
        expect(folded.hasVisibleImageJob()).toBe(true);
        expect(folded.renderImageJobCard()).toContain('正在生成新版本');

        const gone = createChatImageMessageComponents(createCtx({ state, messages: [textMessage(0)] }));
        expect(gone.renderImageJobCard()).toContain('data-image-job-kind="version"');
    });

    test('a failure that was not charged is a red card with edit, retry and remove', () => {
        const state = createState();
        state.chatImageGeneration = {
            job: pendingJob({ status: 'failed', failure: { code: 'moderation_blocked', message: '提示词触发了内容安全策略。', detail: 'provider said <no>', outcome: 'not-charged' } }),
        };
        const components = createChatImageMessageComponents(createCtx({ state }));
        const html = components.renderImageJobCard();

        expect(components.hasVisibleImageJob()).toBe(true);
        expect(html).toContain('image-job-card is-failed');
        expect(html).toContain('data-image-job="failed"');
        expect(html).toContain('图片生成失败');
        expect(html).toContain('提示词触发了内容安全策略。');
        expect(html).toContain('provider said &lt;no&gt;');
        expect(html).toContain('data-image-job-edit');
        expect(html).toMatch(/data-image-job-retry[^>]*>\s*<i[^>]*><\/i>\s*重试/);
        expect(html).toContain('data-image-job-dismiss');
        expect(html).not.toContain('结果未知');
    });

    test('an unknown or charged outcome is a yellow card that warns about billing and points at the image folder', () => {
        const state = createState();
        const components = createChatImageMessageComponents(createCtx({ state }));

        for (const job of [
            pendingJob({ status: 'unknown', failure: { code: 'client-timeout', message: '等待图片结果超时。', detail: '', outcome: 'unknown' } }),
            pendingJob({ status: 'failed', failure: { code: 'save-failed', message: '图片保存失败。', detail: '', outcome: 'charged' } }),
            pendingJob({ status: 'failed', failure: { code: 'upstream', message: '供应商返回 502。', detail: '', outcome: 'unknown' } }),
        ]) {
            state.chatImageGeneration = { job };
            const html = components.renderImageJobCard();
            expect(html).toContain('image-job-card is-unknown');
            expect(html).toContain('data-image-job="unknown"');
            expect(html).toContain('结果未知');
            expect(html).toContain(escapeHtml(job.failure.message));
            expect(html).toContain('<code data-image-job-folder>/user/images/Alice/</code>');
            expect(html).toContain('重新提交（会再次计费）');
            expect(html).toContain('data-image-job-dismiss');
            expect(html).not.toContain('data-image-job-edit');
        }
        state.chatImageGeneration = { job: pendingJob({ status: 'failed', failure: { code: 'x', message: 'm', detail: '', outcome: 'charged' } }) };
        expect(components.renderImageJobCard()).toContain('供应商已经计费。');
    });

    test('a failed new version is labelled as such', () => {
        const message = imageMessage();
        const state = createState();
        state.chatImageGeneration = {
            job: pendingJob({ kind: 'version', targetIdentity: messageIdentity(message), status: 'failed', failure: { code: 'bad', message: '参数无效。', detail: '', outcome: 'not-charged' } }),
        };
        const html = createChatImageMessageComponents(createCtx({ state, messages: [message] })).renderImageJobCard();
        expect(html).toContain('新版本生成失败');
        expect(html).toContain('新版本</span>');
    });

    test('retrying is disabled while a text reply is being generated', () => {
        const state = createState({ engine: { generating: true } });
        state.chatImageGeneration = { job: pendingJob({ status: 'unknown', failure: null }) };
        const html = createChatImageMessageComponents(createCtx({ state })).renderImageJobCard();
        expect(html).toMatch(/data-image-job-retry[^>]*disabled>/);
        expect(html).toContain('没有收到图片生成的结果。');
    });
});

describe('lightbox', () => {
    test('renders nothing when closed, for another chat, or when the message is gone', () => {
        const message = imageMessage();
        const state = createState();
        const messages = [message];
        const components = createChatImageMessageComponents(createCtx({ state, messages }));
        expect(components.renderImageLightbox()).toBe('');

        state.chatImageGeneration = { lightbox: { cacheKey: 'bruno.png::chat-2', identity: messageIdentity(message), index: 0 } };
        expect(components.renderImageLightbox()).toBe('');

        state.chatImageGeneration = { lightbox: { cacheKey: CHAT_KEY, identity: 'missing|x|0', index: 0 } };
        expect(components.renderImageLightbox()).toBe('');
    });

    test('finds the message by identity and shows the image, the full prompt, the parameters and the file path', () => {
        const message = imageMessage({ versions: 2, mediaIndex: 1 });
        const state = createState();
        // the message moved from index 0 to index 2 (earlier messages were loaded): the lightbox follows its identity
        const messages = [textMessage(0), textMessage(1), message];
        state.chatImageGeneration = { lightbox: { cacheKey: CHAT_KEY, identity: messageIdentity(message), index: 0 } };
        const html = createChatImageMessageComponents(createCtx({ state, messages })).renderImageLightbox();

        expect(html).toContain('role="dialog" aria-modal="true" aria-label="图片详情"');
        expect(html).toContain('data-image-lightbox-message="2" data-image-lightbox-media="0"');
        expect(html).toContain(`src="${escapeHtml(encodeURI(IMAGE_PATH_1))}"`);
        expect(html).toContain(`data-image-lightbox-prompt>${escapeHtml('moonlit rooftop, <b>cinematic</b> & "soft" light')}</div>`);
        expect(html).toContain('data-image-lightbox-negative>blurry</div>');
        expect(html).toContain('<dt>来源</dt><dd>手动输入</dd>');
        expect(html).toContain('<dt>版本</dt><dd>1/2</dd>');
        expect(html).toContain('<dt>供应商</dt><dd>OpenAI</dd>');
        expect(html).toContain('<dt>尺寸</dt><dd>1024×1536</dd>');
        expect(html).toContain('<dt>质量</dt><dd>高</dd>');
        expect(html).toContain('<dt>耗时</dt><dd>12 秒</dd>');
        expect(html).toContain(`data-image-lightbox-path>${escapeHtml(IMAGE_PATH_1)}</dd>`);
        expect(html).toContain('data-image-lightbox-copy="2"');
        expect(html).toContain('data-image-lightbox-edit="2"');
        expect(html).toContain('data-image-lightbox-download');
        expect(html).toContain('data-image-lightbox-close="icon"');
        expect(html).toContain('data-image-lightbox-close="button"');
        expect(html).toMatch(/data-image-lightbox-step="-1"[^>]*disabled>/);
        expect(html).toMatch(/data-image-lightbox-step="1"[^>]*title="下一个版本"\s*>/);
    });
});

function createActionHarness({ messages, state = createState(), syncResult = { ok: true } } = {}) {
    const store = { messages: structuredClone(messages) };
    const calls = { updates: [], toasts: [], renders: 0 };
    // 和真实的 updateModernChatAndSync 一样排队：每次都在上一次保存后的消息上修改
    let queue = Promise.resolve();
    const chatContextActions = {
        getSelectedChatMessages: () => store.messages,
        getCurrentDraftKey: () => CHAT_KEY,
        updateModernChatAndSync: jest.fn((entity, chatId, mutate, options) => {
            calls.updates.push({ entity, chatId, options });
            const run = queue.then(async () => {
                const latest = structuredClone(store.messages);
                const result = await mutate(latest);
                store.messages = latest;
                return { result, engineSync: Promise.resolve(syncResult) };
            });
            queue = run.catch(() => {});
            return run;
        }),
    };
    const actions = createChatImageViewActions(/** @type {any} */ ({
        state,
        render: () => {
            calls.renders += 1;
        },
        showToast: (title, text) => calls.toasts.push([title, text]),
        actionRegistry: {
            chatContextActions,
            getSelectedChatEntity: () => ({ avatar: 'alice.png', name: 'Alice' }),
            isGroupChatMode: () => false,
            getChatContextKey: entity => entity?.avatar || '',
        },
    }));
    return { actions, store, calls, state, chatContextActions };
}

describe('view actions', () => {
    test('selectChatImageVersion writes the new media_index through the chat file queue and re-renders', async () => {
        const harness = createActionHarness({ messages: [textMessage(0), imageMessage({ versions: 2, mediaIndex: 1 })] });
        const result = await harness.actions.selectChatImageVersion(1, -1);

        expect(result).toBe(0);
        expect(harness.calls.updates).toEqual([{ entity: { avatar: 'alice.png', name: 'Alice' }, chatId: 'chat-1', options: { groupMode: false } }]);
        expect(harness.store.messages[1].extra.media_index).toBe(0);
        // nothing else in the message changed
        expect(harness.store.messages[1].extra.media).toHaveLength(2);
        expect(harness.store.messages[0]).toEqual(textMessage(0));
        expect(harness.calls.renders).toBe(1);
        expect(harness.calls.toasts).toEqual([]);
    });

    test('does nothing at either end of the versions', async () => {
        const harness = createActionHarness({ messages: [imageMessage({ versions: 2, mediaIndex: 1 })] });
        expect(await harness.actions.selectChatImageVersion(0, 1)).toBeNull();
        expect(harness.chatContextActions.updateModernChatAndSync).not.toHaveBeenCalled();
    });

    test('refuses while generating, and for messages that are not images', async () => {
        const state = createState({ engine: { generating: true } });
        const busy = createActionHarness({ state, messages: [imageMessage()] });
        await expect(busy.actions.selectChatImageVersion(0, -1)).rejects.toThrow('生成中不能切换图片版本。');
        expect(busy.chatContextActions.updateModernChatAndSync).not.toHaveBeenCalled();

        const text = createActionHarness({ messages: [textMessage(0)] });
        await expect(text.actions.selectChatImageVersion(0, 1)).rejects.toThrow('这条消息不是图片消息。');
        await expect(text.actions.selectChatImageVersion(5, 1)).rejects.toThrow('消息位置无效');
    });

    test('steps from the latest saved state, so two quick clicks move two versions', async () => {
        const message = imageMessage({ versions: 2, mediaIndex: 0 });
        message.extra.media.push({ ...message.extra.media[1], url: '/user/images/Alice/third.png', title: 'third' });
        const harness = createActionHarness({ messages: [message] });
        await Promise.all([harness.actions.selectChatImageVersion(0, 1), harness.actions.selectChatImageVersion(0, 1)]);
        expect(harness.store.messages[0].extra.media_index).toBe(2);
    });

    test('tells the user when the engine could not reload the chat afterwards', async () => {
        const harness = createActionHarness({ messages: [imageMessage({ versions: 2, mediaIndex: 1 })], syncResult: { ok: false, error: 'timeout' } });
        await harness.actions.selectChatImageVersion(0, -1);
        expect(harness.calls.toasts).toEqual([['图片版本已切换', '已保存到聊天文件（生成引擎未能同步：timeout，下次生成可能仍用旧配置）']]);
    });

    test('openChatImageLightbox remembers the chat, the message identity and the version; close clears it', () => {
        const message = imageMessage({ versions: 2, mediaIndex: 1 });
        const harness = createActionHarness({ messages: [textMessage(0), message] });

        harness.actions.openChatImageLightbox(1);
        expect(harness.state.chatImageGeneration.lightbox).toEqual({ cacheKey: CHAT_KEY, identity: messageIdentity(message), index: 1 });

        harness.actions.openChatImageLightbox('1', '0');
        expect(harness.state.chatImageGeneration.lightbox.index).toBe(0);
        harness.actions.openChatImageLightbox(1, 9);
        expect(harness.state.chatImageGeneration.lightbox.index).toBe(1);
        expect(harness.calls.renders).toBe(3);

        harness.actions.closeChatImageLightbox({ silent: true });
        expect(harness.state.chatImageGeneration.lightbox).toBeNull();
        expect(harness.calls.renders).toBe(3);
        harness.actions.openChatImageLightbox(1);
        harness.actions.closeChatImageLightbox();
        expect(harness.state.chatImageGeneration.lightbox).toBeNull();
        expect(harness.calls.renders).toBe(5);

        expect(() => harness.actions.openChatImageLightbox(0)).toThrow('这条消息不是图片消息。');
    });

    describe('copyChatImagePrompt', () => {
        let written;
        beforeEach(() => {
            written = [];
            Object.defineProperty(globalThis, 'navigator', {
                configurable: true,
                writable: true,
                value: { clipboard: { writeText: async text => written.push(text) } },
            });
        });

        test('copies the prompt of the shown version, or of the version given, and says so', async () => {
            const harness = createActionHarness({ messages: [imageMessage({ versions: 2, mediaIndex: 1 })] });
            await harness.actions.copyChatImagePrompt(0);
            await harness.actions.copyChatImagePrompt(0, 0);
            expect(written).toEqual(['second version prompt', 'moonlit rooftop, <b>cinematic</b> & "soft" light']);
            expect(harness.calls.toasts).toEqual([['提示词已复制', 'Alice'], ['提示词已复制', 'Alice']]);
        });

        test('refuses an image without a prompt', async () => {
            const message = imageMessage({ versions: 1, mediaIndex: 0 });
            message.extra.media[0].title = '  ';
            const harness = createActionHarness({ messages: [message] });
            await expect(harness.actions.copyChatImagePrompt(0)).rejects.toThrow('这张图片没有记录提示词。');
            expect(written).toEqual([]);
        });
    });
});

// 事件测试不依赖 DOM：用最小的元素替身模拟 closest / dataset / disabled
function toDatasetKey(attribute) {
    return attribute.replace(/^data-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function fakeElement(attrs = {}, { parent = null, disabled = false } = {}) {
    const element = {
        attrs,
        parent,
        disabled,
        dataset: Object.fromEntries(Object.entries(attrs).map(([name, value]) => [toDatasetKey(name), String(value)])),
        closest(selector) {
            const name = /^\[([^\]=]+)\]$/.exec(selector)?.[1];
            for (let node = element; node; node = node.parent) {
                if (name && Object.hasOwn(node.attrs, name)) {
                    return node;
                }
            }
            return null;
        },
    };
    return element;
}

function createEventHarness(extra = {}) {
    const calls = [];
    const record = name => jest.fn(async (...args) => {
        calls.push([name, ...args]);
    });
    const ctx = {
        state: createState(),
        render: jest.fn(),
        showToast: jest.fn(),
        selectChatImageVersion: record('selectChatImageVersion'),
        openChatImageLightbox: record('openChatImageLightbox'),
        closeChatImageLightbox: jest.fn(options => calls.push(['closeChatImageLightbox', options])),
        copyChatImagePrompt: record('copyChatImagePrompt'),
        regenerateChatImage: record('regenerateChatImage'),
        editChatImagePrompt: record('editChatImagePrompt'),
        cancelChatImageJob: record('cancelChatImageJob'),
        retryChatImageJob: record('retryChatImageJob'),
        dismissChatImageJob: record('dismissChatImageJob'),
        ...extra,
    };
    return { ctx, calls, handlers: bindChatImageMessageEvents(ctx) };
}

describe('events', () => {
    test('routes message buttons to the view actions and the generation actions', async () => {
        const { handlers, calls } = createEventHarness();
        const article = fakeElement({ 'data-image-message-index': 3 });

        expect(await handlers.handleClick({ target: fakeElement({ 'data-image-message-version': 3, 'data-image-message-direction': '-1' }, { parent: article }) })).toBe(true);
        expect(await handlers.handleClick({ target: fakeElement({}, { parent: fakeElement({ 'data-image-message-open': 3 }, { parent: article }) }) })).toBe(true);
        expect(await handlers.handleClick({ target: fakeElement({ 'data-image-message-regenerate': 3 }) })).toBe(true);
        expect(await handlers.handleClick({ target: fakeElement({ 'data-image-message-edit': 3 }) })).toBe(true);
        expect(await handlers.handleClick({ target: fakeElement({ 'data-image-message-copy': 3 }) })).toBe(true);
        expect(await handlers.handleClick({ target: fakeElement({ 'data-image-message-download': 3 }) })).toBe(true);

        expect(calls).toEqual([
            ['selectChatImageVersion', '3', -1],
            ['openChatImageLightbox', '3'],
            ['regenerateChatImage', 3],
            ['editChatImagePrompt', 3],
            ['copyChatImagePrompt', '3'],
        ]);
    });

    test('ignores disabled buttons and clicks that are not its own', async () => {
        const { handlers, calls } = createEventHarness();
        expect(await handlers.handleClick({ target: fakeElement({ 'data-image-message-regenerate': 1 }, { disabled: true }) })).toBe(true);
        expect(await handlers.handleClick({ target: fakeElement({ 'data-image-job-retry': '' }, { disabled: true }) })).toBe(true);
        expect(await handlers.handleClick({ target: fakeElement({ 'data-delete-message': 1 }) })).toBe(false);
        expect(await handlers.handleClick({ target: null })).toBe(false);
        expect(calls).toEqual([]);
    });

    test('job card buttons call the generation actions; the card edit button passes no message', async () => {
        const { handlers, calls } = createEventHarness();
        for (const name of ['data-image-job-cancel', 'data-image-job-retry', 'data-image-job-dismiss', 'data-image-job-edit']) {
            expect(await handlers.handleClick({ target: fakeElement({ [name]: '' }) })).toBe(true);
        }
        expect(calls).toEqual([['cancelChatImageJob'], ['retryChatImageJob'], ['dismissChatImageJob'], ['editChatImagePrompt']]);
    });

    test('a missing generation action becomes a toast instead of an exception', async () => {
        const { handlers, ctx } = createEventHarness({ retryChatImageJob: undefined });
        expect(await handlers.handleClick({ target: fakeElement({ 'data-image-job-retry': '' }) })).toBe(true);
        expect(ctx.showToast).toHaveBeenCalledWith('重新提交失败', '这个操作暂不可用。');
        expect(ctx.render).toHaveBeenCalled();
    });

    test('a failing action shows its error', async () => {
        const { handlers, ctx } = createEventHarness({ selectChatImageVersion: jest.fn(async () => { throw new Error('生成中不能切换图片版本。'); }) });
        await handlers.handleClick({ target: fakeElement({ 'data-image-message-version': 0, 'data-image-message-direction': '1' }) });
        expect(ctx.showToast).toHaveBeenCalledWith('切换图片版本失败', '生成中不能切换图片版本。');
        expect(ctx.state.errors).toEqual([{ key: 'chat-image-message', message: '生成中不能切换图片版本。' }]);
    });

    test('lightbox: the backdrop and the close buttons close it, the panel and the image do not', async () => {
        const { handlers, calls } = createEventHarness();
        const lightbox = fakeElement({ 'data-image-lightbox': '', 'data-image-lightbox-message': 4, 'data-image-lightbox-media': 1 });
        const panel = fakeElement({ 'data-image-lightbox-panel': '' }, { parent: lightbox });

        expect(await handlers.handleClick({ target: fakeElement({ 'data-image-lightbox-image': '' }, { parent: lightbox }) })).toBe(true);
        expect(await handlers.handleClick({ target: fakeElement({}, { parent: panel }) })).toBe(true);
        expect(calls).toEqual([]);

        expect(await handlers.handleClick({ target: lightbox })).toBe(true);
        expect(await handlers.handleClick({ target: fakeElement({ 'data-image-lightbox-close': 'button' }, { parent: panel }) })).toBe(true);
        expect(calls).toEqual([['closeChatImageLightbox', undefined], ['closeChatImageLightbox', undefined]]);
    });

    test('lightbox buttons: version steps, copy the shown version, edit closes it first', async () => {
        const { handlers, calls } = createEventHarness();
        const lightbox = fakeElement({ 'data-image-lightbox': '', 'data-image-lightbox-message': 4, 'data-image-lightbox-media': 1 });
        const panel = fakeElement({ 'data-image-lightbox-panel': '' }, { parent: lightbox });
        const nav = fakeElement({ 'data-image-lightbox-nav': '' }, { parent: lightbox });

        await handlers.handleClick({ target: fakeElement({ 'data-image-lightbox-step': '-1' }, { parent: nav }) });
        await handlers.handleClick({ target: fakeElement({ 'data-image-lightbox-copy': 4 }, { parent: panel }) });
        await handlers.handleClick({ target: fakeElement({ 'data-image-lightbox-edit': 4 }, { parent: panel }) });
        await handlers.handleClick({ target: fakeElement({ 'data-image-lightbox-download': '' }, { parent: panel }) });

        expect(calls).toEqual([
            ['openChatImageLightbox', '4', 0],
            ['copyChatImagePrompt', '4', 1],
            ['closeChatImageLightbox', { silent: true }],
            ['editChatImagePrompt', '4'],
        ]);
    });

    describe('Escape', () => {
        let lightboxOnPage;
        beforeEach(() => {
            lightboxOnPage = false;
            globalThis.document = /** @type {any} */ ({ querySelector: selector => (selector === '[data-image-lightbox]' && lightboxOnPage ? {} : null) });
        });

        test('closes the lightbox only while it is on the page', () => {
            const { handlers, ctx } = createEventHarness();
            const event = { key: 'Escape', preventDefault: jest.fn() };

            expect(handlers.handleKeydown(event)).toBe(false);
            expect(ctx.closeChatImageLightbox).not.toHaveBeenCalled();

            lightboxOnPage = true;
            expect(handlers.handleKeydown({ key: 'Enter', preventDefault: jest.fn() })).toBe(false);
            expect(handlers.handleKeydown(event)).toBe(true);
            expect(event.preventDefault).toHaveBeenCalled();
            expect(ctx.closeChatImageLightbox).toHaveBeenCalledTimes(1);
        });
    });
});
