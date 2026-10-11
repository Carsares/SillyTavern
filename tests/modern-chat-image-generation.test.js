/* global globalThis */

import { describe, expect, jest, test } from '@jest/globals';

// actions/chat-image-generation.js 引入的 actions/chat-image-prompt.js 可能间接读 localStorage / window：先放好替身再加载
const storage = new Map();
globalThis.localStorage = /** @type {any} */ ({
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
});
globalThis.window = /** @type {any} */ (globalThis.window || { matchMedia: () => ({ matches: false }) });
const { createChatImageGenerationActions, createUniqueSendDate, pickImageRequestParams, clampImageCount, readImageRecord } = await import('../public/modern/actions/chat-image-generation.js');
const { createChatGenerationActions } = await import('../public/modern/actions/chat-generation.js');
const { ensureChatImageState, getChatImageView, IMAGE_JOB_STORAGE_KEY } = await import('../public/modern/core/chat-image-state.js');
const { buildImageMessage, messageIdentity } = await import('../public/modern/core/image-message.js');

// 会话内生图的动作（WP2）：不经过浏览器，apiFetch 用替身按路径应答；聊天写入用 chat-context.js 的同口径替身
// （updateModernChatAndSync 在没读过的聊天上抛错，和真实实现一致）。等待和超时都注入成立即完成。

const API = '/api/image-generation';
const hero = { avatar: 'hero.png', name: 'Hero', data: { name: 'Hero' } };
const party = { id: 'party', name: 'Party Group', members: ['hero.png'] };
const cacheKey = (contextKey, chatId) => `${contextKey}::${chatId}`;
const capabilities = {
    supported: true,
    provider: 'openai',
    parameters: ['width', 'height', 'count', 'quality', 'style', 'outputFormat'],
    limits: { countMax: 2, maxDimension: 4096, dimensionMultiple: null },
    requiresBaseUrl: false,
    requiresKey: true,
    keySaved: true,
};

function baseMessages() {
    return [
        { name: 'Hero', is_user: false, is_system: false, send_date: '2026-10-12T00:00:00.000Z', mes: 'Opening line.' },
        { name: 'User', is_user: true, is_system: false, send_date: '2026-10-12T00:00:01.000Z', mes: 'Show me the rooftop.' },
        { name: 'Hero', is_user: false, is_system: false, send_date: '2026-10-12T00:00:02.000Z', mes: 'The moon is bright tonight.' },
    ];
}

function abortError() {
    const error = new Error('aborted');
    error.name = 'AbortError';
    return error;
}

function httpError(status, body) {
    const error = /** @type {Error & { status?: number, body?: string }} */ (new Error(`failed: ${status}`));
    error.status = status;
    error.body = typeof body === 'string' ? body : JSON.stringify(body);
    return error;
}

/**
 * @param {object} [options] 选项。
 * @param {Record<string, any>} [options.routes] 路径 → 应答（值、函数 (body, init) => 值，抛错表示请求失败）。
 * @param {Record<string, any>} [options.settings] state.settings。
 * @param {Map<string, string>} [options.session] sessionStorage 替身的底层 Map。
 */
function createHarness({ routes = {}, settings, session = new Map(), timeoutMs = 60_000 } = {}) {
    const calls = [];
    const toasts = [];
    const state = {
        settings: settings ?? {
            main_api: 'openai',
            extension_settings: { imageGeneration: { provider: 'openai', model: 'gpt-image-1', defaults: { size: '1024x1536', quality: 'high', count: 1, negativePrompt: 'blurry' } } },
        },
        secretState: { api_key_image_generation: [{ id: 'img-1', value: '****', active: true }] },
        characters: [hero],
        groups: [party],
        selected: { character: 'hero.png', group: '', chat: 'chat-a' },
        chatMode: 'character',
        chatMessages: { [cacheKey('hero.png', 'chat-a')]: baseMessages() },
        engine: { generating: false, activity: '', status: '就绪', detail: '引擎空闲。', error: '' },
        chatImageGeneration: {},
        imageModelSettings: {},
    };
    const isGroup = () => state.chatMode === 'group';
    const entity = () => (isGroup() ? state.groups[0] : state.characters.find(item => item.avatar === state.selected.character));
    const contextKeyOf = (item, groupMode) => (groupMode ? `group:${item.id}` : item.avatar);
    const writes = [];
    const chatContextActions = {
        getSelectedChatEntity: () => entity(),
        isGroupChatMode: isGroup,
        getChatContextKey: (item = entity(), groupMode = isGroup()) => contextKeyOf(item, groupMode),
        getChatCacheKey: cacheKey,
        getCurrentDraftKey: () => cacheKey(contextKeyOf(entity(), isGroup()), state.selected.chat),
        getSelectedChatMessages: () => state.chatMessages[cacheKey(contextKeyOf(entity(), isGroup()), state.selected.chat)] || [],
        loadChatMessages: jest.fn(async (item, chatId, { groupMode }) => {
            state.chatMessages[cacheKey(contextKeyOf(item, groupMode), chatId)] = baseMessages();
            return state.chatMessages[cacheKey(contextKeyOf(item, groupMode), chatId)];
        }),
        updateModernChatAndSync: jest.fn(async (item, chatId, mutate, { groupMode }) => {
            const key = cacheKey(contextKeyOf(item, groupMode), chatId);
            if (!state.chatMessages[key]) {
                throw new Error('聊天记录尚未读取，无法保存。');
            }
            const messages = structuredClone(state.chatMessages[key]);
            const result = await mutate(messages);
            writes.push({ key, groupMode, messages: structuredClone(messages) });
            state.chatMessages[key] = messages;
            return { result, engineSync: Promise.resolve({ ok: true }) };
        }),
        refreshSelectedChatList: jest.fn(async () => {}),
    };
    const apiFetch = jest.fn(async (path, init = {}) => {
        calls.push({ path, method: init.method || 'POST', body: init.body });
        const route = Object.hasOwn(routes, path) ? routes[path] : undefined;
        if (route === undefined) {
            throw new Error(`unexpected request ${path}`);
        }
        return typeof route === 'function' ? route(init.body, init) : structuredClone(route);
    });
    const render = jest.fn(() => {
        // 每次重绘记下锁的状态，用来断言生成期间加了锁
        render.snapshots.push({ generating: state.engine.generating, activity: state.engine.activity, detail: state.engine.detail, stored: session.get(IMAGE_JOB_STORAGE_KEY) || null });
    });
    render.snapshots = [];
    let uuid = 0;
    const actions = createChatImageGenerationActions(/** @type {any} */ ({
        state,
        apiFetch,
        render,
        showToast: (title, message) => toasts.push({ title, message }),
        actionRegistry: { chatContextActions },
        chatImageGenerationOptions: {
            timeoutMs,
            pollMs: 1,
            sleep: async (ms, signal) => {
                if (signal?.aborted) {
                    throw abortError();
                }
                await new Promise(resolve => setTimeout(resolve, 0));
            },
            now: () => 1_760_000_000_000,
            randomUUID: () => `00000000-0000-4000-8000-00000000000${++uuid}`,
            storage: {
                getItem: key => (session.has(key) ? session.get(key) : null),
                setItem: (key, value) => session.set(key, String(value)),
                removeItem: key => session.delete(key),
            },
        },
    }));
    const view = () => getChatImageView(state, chatContextActions.getCurrentDraftKey());
    return { state, actions, apiFetch, calls, toasts, render, writes, session, chatContextActions, view, slot: () => ensureChatImageState(state) };
}

const completed = (requestId, paths = ['/user/images/Hero/Hero_1.png']) => ({
    requestId,
    status: 'completed',
    images: paths.map(path => ({ path, mimeType: 'image/png', bytes: 10, width: 1024, height: 1536 })),
    provider: 'openai',
    model: 'gpt-image-1',
    elapsedMs: 1234,
    incomplete: 0,
});
const requestPath = id => `${API}/requests/${id}`;
const firstId = '00000000-0000-4000-8000-000000000001';
const lastMessage = harness => harness.state.chatMessages[cacheKey('hero.png', 'chat-a')].at(-1);

describe('chat image composer modes and draft', () => {
    test('switches to image mode and pre-selects recent messages once when entering 从消息生成', () => {
        const harness = createHarness({
            settings: {
                main_api: 'openai',
                extension_settings: { imageGeneration: { provider: 'openai', model: 'gpt-image-1', promptGen: { defaultSelectCount: 2, includeAppearance: false } } },
            },
        });
        expect(harness.actions.setChatImageMode('image')).toBe(true);
        expect(harness.view().mode).toBe('image');
        expect(harness.actions.setChatImageSubMode('auto')).toBe(true);
        const messages = baseMessages();
        expect([...harness.view().selected]).toEqual([messageIdentity(messages[1]), messageIdentity(messages[2])]);
        expect(harness.view().includeAppearance).toBe(false);
        expect(harness.view().selectionInitialized).toBe(true);
        expect(harness.view().autoStep).toBe(1);

        // 用户改过勾选后再切回来，不重新预选
        harness.view().selected = new Set([messageIdentity(messages[0])]);
        harness.actions.setChatImageSubMode('manual');
        harness.actions.setChatImageSubMode('auto');
        expect([...harness.view().selected]).toEqual([messageIdentity(messages[0])]);
    });

    test('refuses 从消息生成 on a text completion connection and while the image model is not configured', () => {
        const textCompletion = createHarness({ settings: { main_api: 'textgenerationwebui', extension_settings: { imageGeneration: { provider: 'openai', model: 'gpt-image-1' } } } });
        textCompletion.actions.setChatImageMode('image');
        expect(textCompletion.actions.setChatImageSubMode('auto')).toBe(false);
        expect(textCompletion.view().sub).toBe('manual');

        const unconfigured = createHarness();
        unconfigured.state.secretState = {};
        unconfigured.actions.setChatImageMode('image');
        expect(unconfigured.actions.setChatImageSubMode('auto')).toBe(false);
        // 已经在「从消息生成」时密钥被删掉：再进图片模式回到手动输入
        unconfigured.view().sub = 'auto';
        unconfigured.actions.setChatImageMode('text');
        unconfigured.actions.setChatImageMode('image');
        expect(unconfigured.view().sub).toBe('manual');
    });

    test('does not switch modes while anything is generating', () => {
        const harness = createHarness();
        harness.state.engine.generating = true;
        expect(harness.actions.setChatImageMode('image')).toBe(false);
        expect(harness.view().mode).toBe('text');
    });

    test('typing the prompt or parameters does not re-render; toggling 高级 does', () => {
        const harness = createHarness();
        harness.actions.setChatImageMode('image');
        harness.render.mockClear();
        harness.actions.updateChatImageDraft({ prompt: 'a moonlit roof' });
        harness.actions.updateChatImageDraft({ params: { quality: 'low', seed: '42' } });
        expect(harness.render).not.toHaveBeenCalled();
        expect(harness.view().prompt).toBe('a moonlit roof');
        expect(harness.view().params).toEqual({ quality: 'low', seed: '42' });
        harness.actions.updateChatImageDraft({ params: { seed: undefined } });
        expect(harness.view().params).toEqual({ quality: 'low' });
        harness.actions.updateChatImageDraft({ showAdvanced: true });
        expect(harness.render).toHaveBeenCalledTimes(1);
        harness.actions.clearChatImageDraft();
        expect(harness.view().prompt).toBe('');
    });

    test('edits the prompt of an image message and of a failed job, with its parameters', () => {
        const harness = createHarness();
        const image = buildImageMessage({
            name: 'Hero',
            sendDate: '2026-10-12T00:00:03.000Z',
            images: [{ path: '/user/images/Hero/a.png', width: 1024, height: 1536 }],
            meta: { prompt: 'old prompt', negativePrompt: 'ugly', provider: 'openai', model: 'gpt-image-1', params: { width: 1024, height: 1536, quality: 'high' }, requestId: 'r0' },
        });
        harness.state.chatMessages[cacheKey('hero.png', 'chat-a')].push(image);
        harness.state.chatImageGeneration.lightbox = { cacheKey: 'x', identity: 'y', index: 0 };
        expect(harness.actions.editChatImagePrompt('3')).toBe(true);
        expect(harness.view()).toMatchObject({ mode: 'image', sub: 'manual', prompt: 'old prompt', showAdvanced: true });
        expect(harness.view().params).toMatchObject({ size: '1024x1536', quality: 'high', negativePrompt: 'ugly' });
        expect(harness.state.chatImageGeneration.lightbox).toBeNull();

        harness.slot().job = { requestId: 'r9', status: 'failed', cacheKey: cacheKey('hero.png', 'chat-a'), prompt: 'failed prompt', negativePrompt: '', params: { count: 2 }, failure: { code: 'x', message: 'x', detail: '', outcome: 'not-charged' } };
        expect(harness.actions.editChatImagePrompt()).toBe(true);
        expect(harness.view().prompt).toBe('failed prompt');
        expect(harness.view().params.count).toBe(2);
        expect(harness.slot().job).toBeNull();
        expect(harness.actions.editChatImagePrompt()).toBe(false);
    });
});

describe('chat image generation flow', () => {
    test('locks the engine, sends the filtered request, writes the image message and unlocks', async () => {
        const harness = createHarness({
            routes: {
                [`${API}/capabilities`]: capabilities,
                [`${API}/generate`]: body => completed(body.requestId),
            },
        });
        harness.actions.setChatImageMode('image');
        harness.actions.updateChatImageDraft({ prompt: '  a moonlit roof  ', params: { count: 4 } });
        await expect(harness.actions.generateChatImage()).resolves.toBe(true);

        expect(harness.calls.map(call => call.path)).toEqual([`${API}/capabilities`, `${API}/generate`]);
        expect(harness.calls[0].body).toEqual({ provider: 'openai', model: 'gpt-image-1' });
        // negativePrompt 不在 OpenAI 的参数表里，被过滤；数量夹到 countMax
        expect(harness.calls[1].body).toEqual({
            requestId: firstId,
            provider: 'openai',
            model: 'gpt-image-1',
            characterName: 'Hero',
            prompt: 'a moonlit roof',
            width: 1024,
            height: 1536,
            quality: 'high',
            count: 2,
        });

        // 请求期间：占着生成锁、状态行是「图片生成中…」、sessionStorage 里有任务
        const during = harness.render.snapshots.find(snapshot => snapshot.stored);
        expect(during).toMatchObject({ generating: true, activity: 'image', detail: '图片生成中…' });
        expect(JSON.parse(during.stored)).toMatchObject({ requestId: firstId, kind: 'new', contextKey: 'hero.png', chatId: 'chat-a', prompt: 'a moonlit roof' });

        const message = lastMessage(harness);
        expect(message).toMatchObject({ name: 'Hero', is_user: false, is_system: true, mes: '', send_date: new Date(1_760_000_000_000).toISOString() });
        expect(message.extra).toMatchObject({ media_display: 'gallery', media_index: 0, inline_image: false });
        expect(message.extra.media[0]).toMatchObject({ url: '/user/images/Hero/Hero_1.png', type: 'image', title: 'a moonlit roof', source: 'generated' });
        expect(message.extra.media[0].generation).toMatchObject({ provider: 'openai', model: 'gpt-image-1', requestId: firstId, origin: 'manual', elapsedMs: 1234 });

        expect(harness.state.engine).toMatchObject({ generating: false, activity: '', status: '就绪', detail: '引擎空闲。' });
        expect(harness.slot().job).toBeNull();
        expect(harness.session.has(IMAGE_JOB_STORAGE_KEY)).toBe(false);
        expect(harness.chatContextActions.refreshSelectedChatList).toHaveBeenCalledTimes(1);
        expect(harness.toasts.at(-1).title).toBe('图片已插入会话');
    });

    test('polls /requests/:id with GET every interval after a 202 until the image is ready', async () => {
        let polls = 0;
        const harness = createHarness({
            routes: {
                [`${API}/capabilities`]: capabilities,
                [`${API}/generate`]: body => ({ requestId: body.requestId, status: 'pending', startedAt: 1 }),
                [requestPath(firstId)]: (_body, init) => {
                    expect(init.method).toBe('GET');
                    polls += 1;
                    return polls < 3 ? { requestId: firstId, status: 'pending', startedAt: 1 } : completed(firstId);
                },
            },
        });
        harness.actions.setChatImageMode('image');
        harness.actions.updateChatImageDraft({ prompt: 'rooftop' });
        await harness.actions.generateChatImage();
        expect(polls).toBe(3);
        expect(lastMessage(harness).extra.media[0].url).toBe('/user/images/Hero/Hero_1.png');
    });

    test('records the prompt source when the prompt came from messages', async () => {
        const harness = createHarness({ routes: { [`${API}/capabilities`]: capabilities, [`${API}/generate`]: body => completed(body.requestId) } });
        harness.actions.setChatImageMode('image');
        harness.actions.setChatImageSubMode('auto');
        Object.assign(harness.view(), { autoStep: 3, prompt: 'generated prompt', promptFrom: 2 });
        await harness.actions.generateChatImage();
        expect(lastMessage(harness).extra.media[0].generation).toMatchObject({ origin: 'messages', sourceCount: 2 });
    });

    test('adds a version to an existing image message with the same prompt and parameters', async () => {
        const harness = createHarness({ routes: { [`${API}/capabilities`]: capabilities, [`${API}/generate`]: body => completed(body.requestId, ['/user/images/Hero/v2.png']) } });
        const image = buildImageMessage({
            name: 'Hero',
            sendDate: '2026-10-12T00:00:03.000Z',
            images: [{ path: '/user/images/Hero/v1.png', width: 1024, height: 1024 }],
            meta: { prompt: 'first prompt', negativePrompt: 'ugly', provider: 'openai', model: 'gpt-image-1', params: { width: 1024, height: 1024, quality: 'low', steps: 30 }, requestId: 'r0' },
        });
        harness.state.chatMessages[cacheKey('hero.png', 'chat-a')].push(image, { name: 'User', is_user: true, is_system: false, send_date: '2026-10-12T00:00:04.000Z', mes: 'nice' });
        await expect(harness.actions.regenerateChatImage(3)).resolves.toBe(true);

        // steps 和 negativePrompt 不在 OpenAI 的参数表里，被过滤
        expect(harness.calls[1].body).toMatchObject({ prompt: 'first prompt', width: 1024, height: 1024, quality: 'low' });
        expect(harness.calls[1].body).not.toHaveProperty('steps');
        expect(harness.calls[1].body).not.toHaveProperty('negativePrompt');
        const messages = harness.state.chatMessages[cacheKey('hero.png', 'chat-a')];
        expect(messages).toHaveLength(5);
        expect(messages[3].extra.media.map(item => item.url)).toEqual(['/user/images/Hero/v1.png', '/user/images/Hero/v2.png']);
        expect(messages[3].extra.media_index).toBe(1);
        expect(harness.toasts.at(-1).title).toBe('已生成新版本');
    });

    test('writes into the chat that started the generation after the user switched away, loading it first', async () => {
        let release;
        const gate = new Promise(resolve => {
            release = resolve;
        });
        const harness = createHarness({
            routes: {
                [`${API}/capabilities`]: capabilities,
                [`${API}/generate`]: async body => {
                    await gate;
                    return completed(body.requestId);
                },
            },
        });
        harness.actions.setChatImageMode('image');
        harness.actions.updateChatImageDraft({ prompt: 'rooftop' });
        const running = harness.actions.generateChatImage();
        await new Promise(resolve => setTimeout(resolve, 0));
        // 切到群聊，并让原聊天掉出缓存
        harness.state.chatMode = 'group';
        harness.state.selected.chat = 'party-chat';
        delete harness.state.chatMessages[cacheKey('hero.png', 'chat-a')];
        release();
        await running;

        expect(harness.chatContextActions.loadChatMessages).toHaveBeenCalledWith(hero, 'chat-a', expect.objectContaining({ force: true, groupMode: false }));
        expect(harness.writes).toHaveLength(1);
        expect(harness.writes[0]).toMatchObject({ key: cacheKey('hero.png', 'chat-a'), groupMode: false });
        expect(harness.writes[0].messages.at(-1).extra.media[0].url).toBe('/user/images/Hero/Hero_1.png');
    });

    test('names group images after the group and sends the group name as characterName', async () => {
        const harness = createHarness({ routes: { [`${API}/capabilities`]: capabilities, [`${API}/generate`]: body => completed(body.requestId) } });
        harness.state.chatMode = 'group';
        harness.state.selected.chat = 'party-chat';
        harness.state.chatMessages[cacheKey('group:party', 'party-chat')] = baseMessages();
        harness.actions.setChatImageMode('image');
        harness.actions.updateChatImageDraft({ prompt: 'group photo' });
        await harness.actions.generateChatImage();
        expect(harness.calls[1].body.characterName).toBe('Party Group');
        expect(harness.writes[0]).toMatchObject({ key: cacheKey('group:party', 'party-chat'), groupMode: true });
        expect(harness.writes[0].messages.at(-1).name).toBe('Party Group');
    });

    test('does not send anything without a prompt, a configured model, or while something is generating', async () => {
        const harness = createHarness({ routes: { [`${API}/capabilities`]: capabilities } });
        harness.actions.setChatImageMode('image');
        await expect(harness.actions.generateChatImage()).resolves.toBe(false);

        harness.actions.updateChatImageDraft({ prompt: 'rooftop' });
        harness.state.engine.generating = true;
        await expect(harness.actions.generateChatImage()).resolves.toBe(false);
        expect(harness.toasts.at(-1).message).toContain('文本回复生成中');

        harness.state.engine.generating = false;
        harness.state.secretState = {};
        await expect(harness.actions.generateChatImage()).resolves.toBe(false);
        expect(harness.toasts.at(-1).title).toBe('还没有配置好图片模型');
        expect(harness.calls).toHaveLength(0);
    });
});

describe('chat image generation failures, cancel and recovery', () => {
    async function runWith(routes, setup = () => {}) {
        const harness = createHarness({ routes: { [`${API}/capabilities`]: capabilities, ...routes } });
        setup(harness);
        harness.actions.setChatImageMode('image');
        harness.actions.updateChatImageDraft({ prompt: 'rooftop' });
        await harness.actions.generateChatImage();
        return harness;
    }

    test('a structured failure becomes a failed job that keeps the outcome and the provider reason', async () => {
        const harness = await runWith({
            [`${API}/generate`]: () => {
                throw httpError(502, { error: 'provider-http-error', message: 'The image provider returned HTTP 400.', detail: 'content policy', outcome: 'unknown' });
            },
        });
        expect(harness.slot().job).toMatchObject({ status: 'failed', failure: { code: 'provider-http-error', message: '图片供应商返回了错误。', detail: 'content policy', outcome: 'unknown' } });
        expect(harness.calls.map(call => call.path)).not.toContain(requestPath(firstId));
        expect(harness.state.engine.generating).toBe(false);
        expect(harness.session.has(IMAGE_JOB_STORAGE_KEY)).toBe(false);

        const missing = await runWith({ [`${API}/generate`]: () => { throw httpError(400, { error: 'secret-missing', message: 'No image generation key is saved.', outcome: 'not-charged' }); } });
        expect(missing.slot().job.failure).toMatchObject({ code: 'secret-missing', outcome: 'not-charged' });
    });

    test('a network failure asks /requests/:id instead of resubmitting; 404 means the result is unknown', async () => {
        const harness = await runWith({
            [`${API}/generate`]: () => {
                throw new TypeError('Failed to fetch');
            },
            [requestPath(firstId)]: () => {
                throw httpError(404, { error: 'request-not-found', message: 'No image generation request with this id is known.', outcome: 'unknown' });
            },
        });
        expect(harness.calls.filter(call => call.path === `${API}/generate`)).toHaveLength(1);
        expect(harness.slot().job).toMatchObject({ status: 'unknown', failure: { code: 'result-unknown', outcome: 'unknown' } });
        expect(harness.toasts.at(-1).title).toBe('图片结果未知');
    });

    test('a network failure followed by a finished record still writes the image', async () => {
        const harness = await runWith({
            [`${API}/generate`]: () => {
                throw httpError(504, '<html>Gateway Timeout</html>');
            },
            [requestPath(firstId)]: completed(firstId),
        });
        expect(lastMessage(harness).extra.media[0].url).toBe('/user/images/Hero/Hero_1.png');
        expect(harness.slot().job).toBeNull();
    });

    test('the local timeout aborts the request and then looks the result up', async () => {
        const harness = createHarness({
            timeoutMs: 20,
            routes: {
                [`${API}/capabilities`]: capabilities,
                [`${API}/generate`]: (_body, init) => new Promise((_resolve, reject) => {
                    init.signal.addEventListener('abort', () => reject(abortError()));
                }),
                [requestPath(firstId)]: completed(firstId),
            },
        });
        harness.actions.setChatImageMode('image');
        harness.actions.updateChatImageDraft({ prompt: 'rooftop' });
        await harness.actions.generateChatImage();
        expect(harness.calls.map(call => call.path)).toEqual([`${API}/capabilities`, `${API}/generate`, requestPath(firstId)]);
        expect(lastMessage(harness).extra.media).toHaveLength(1);
    });

    test('a chat write failure keeps a charged failure that names the saved image', async () => {
        const harness = await runWith({ [`${API}/generate`]: body => completed(body.requestId) }, current => {
            current.chatContextActions.updateModernChatAndSync.mockImplementation(async () => {
                throw new Error('聊天文件已删除、重命名或正在变更，无法继续保存。');
            });
        });
        expect(harness.slot().job).toMatchObject({ status: 'failed', failure: { code: 'write-failed', outcome: 'charged', detail: '/user/images/Hero/Hero_1.png' } });
        expect(harness.slot().job.failure.message).toContain('/user/images/Hero/Hero_1.png');
        expect(harness.slot().job.failure.message).toContain('没能写入会话');
        expect(harness.state.engine.generating).toBe(false);
    });

    test('stop sends /cancel, ends the local wait, unlocks and warns about billing', async () => {
        const harness = createHarness({
            routes: {
                [`${API}/capabilities`]: capabilities,
                [`${API}/generate`]: (_body, init) => new Promise((_resolve, reject) => {
                    init.signal.addEventListener('abort', () => reject(abortError()));
                }),
                [`${API}/cancel`]: body => ({ requestId: body.requestId, status: 'cancelled', outcome: 'unknown' }),
            },
        });
        harness.actions.setChatImageMode('image');
        harness.actions.updateChatImageDraft({ prompt: 'rooftop' });
        const running = harness.actions.generateChatImage();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(harness.state.engine.activity).toBe('image');

        // 「停止」按钮走 stopModernGeneration，它在 activity === 'image' 时调用这个钩子
        await expect(harness.state.chatImageGeneration.cancelJob()).resolves.toBe(true);
        await running;
        expect(harness.calls.find(call => call.path === `${API}/cancel`).body).toEqual({ requestId: firstId });
        expect(harness.slot().job).toBeNull();
        expect(harness.state.engine).toMatchObject({ generating: false, activity: '', detail: '引擎空闲。' });
        expect(harness.toasts.at(-1)).toEqual({ title: '已停止等待', message: '若供应商已开始生成，可能仍会计费' });
        expect(harness.writes).toHaveLength(0);
    });

    test('stop that races a finished generation still writes the paid image', async () => {
        const harness = createHarness({
            routes: {
                [`${API}/capabilities`]: capabilities,
                [`${API}/generate`]: (_body, init) => new Promise((_resolve, reject) => {
                    init.signal.addEventListener('abort', () => reject(abortError()));
                }),
                [`${API}/cancel`]: body => completed(body.requestId),
            },
        });
        harness.actions.setChatImageMode('image');
        harness.actions.updateChatImageDraft({ prompt: 'rooftop' });
        const running = harness.actions.generateChatImage();
        await new Promise(resolve => setTimeout(resolve, 0));
        await harness.actions.cancelChatImageJob();
        await running;
        expect(harness.writes).toHaveLength(1);
        expect(harness.toasts.at(-1).title).toBe('图片已插入会话');
    });

    test('retry resubmits a failed job with a new request id; dismiss removes it', async () => {
        let attempts = 0;
        const harness = await runWith({
            [`${API}/generate`]: body => {
                attempts += 1;
                if (attempts === 1) {
                    throw httpError(409, { error: 'image-generation-busy', message: 'busy', outcome: 'not-charged' });
                }
                return completed(body.requestId);
            },
        });
        expect(harness.slot().job.status).toBe('failed');
        await expect(harness.actions.retryChatImageJob()).resolves.toBe(true);
        const generates = harness.calls.filter(call => call.path === `${API}/generate`);
        expect(generates.map(call => call.body.requestId)).toEqual([firstId, '00000000-0000-4000-8000-000000000002']);
        expect(generates[1].body).toMatchObject({ prompt: 'rooftop', width: 1024, height: 1536, quality: 'high' });
        expect(harness.slot().job).toBeNull();

        harness.slot().job = { requestId: 'x', status: 'unknown', cacheKey: cacheKey('hero.png', 'chat-a'), failure: null };
        expect(harness.actions.dismissChatImageJob()).toBe(true);
        expect(harness.slot().job).toBeNull();
    });

    test('recovers a pending job from sessionStorage once after a reload and writes the result', async () => {
        const session = new Map([[IMAGE_JOB_STORAGE_KEY, JSON.stringify({
            requestId: 'aaaaaaaa-0000-4000-8000-000000000000',
            cacheKey: cacheKey('hero.png', 'chat-a'),
            contextKey: 'hero.png',
            chatId: 'chat-a',
            groupMode: false,
            kind: 'new',
            targetIdentity: '',
            prompt: 'recovered prompt',
            negativePrompt: '',
            params: { width: 1024, height: 1024 },
            provider: 'openai',
            model: 'gpt-image-1',
            origin: 'manual',
            sourceCount: 0,
            startedAt: 1_760_000_000_000 - 1000,
            ratio: 1,
        })]]);
        const harness = createHarness({
            session,
            routes: { [requestPath('aaaaaaaa-0000-4000-8000-000000000000')]: completed('aaaaaaaa-0000-4000-8000-000000000000') },
        });
        await expect(harness.actions.recoverChatImageJob()).resolves.toBe(true);
        expect(harness.render.snapshots.some(snapshot => snapshot.generating && snapshot.activity === 'image')).toBe(true);
        expect(lastMessage(harness).extra.media[0]).toMatchObject({ title: 'recovered prompt', url: '/user/images/Hero/Hero_1.png' });
        expect(session.has(IMAGE_JOB_STORAGE_KEY)).toBe(false);
        await expect(harness.actions.recoverChatImageJob()).resolves.toBe(false);
        expect(harness.calls.filter(call => call.path.startsWith(`${API}/requests/`))).toHaveLength(1);
    });

    test('a recovered job that the server no longer knows becomes unknown', async () => {
        const session = new Map([[IMAGE_JOB_STORAGE_KEY, JSON.stringify({ requestId: 'bbbbbbbb-0000-4000-8000-000000000000', cacheKey: cacheKey('hero.png', 'chat-a'), contextKey: 'hero.png', chatId: 'chat-a', kind: 'new', prompt: 'p', params: {}, startedAt: 1 })]]);
        const harness = createHarness({
            session,
            routes: { [requestPath('bbbbbbbb-0000-4000-8000-000000000000')]: () => { throw httpError(404, { error: 'request-not-found', message: 'x', outcome: 'unknown' }); } },
        });
        await harness.actions.recoverChatImageJob();
        expect(harness.slot().job).toMatchObject({ status: 'unknown', cacheKey: cacheKey('hero.png', 'chat-a') });
        expect(harness.state.engine.generating).toBe(false);
    });
});

describe('stop button routing and helpers', () => {
    test('stopModernGeneration calls the image cancel hook instead of the bridge STOP while an image is generating', async () => {
        const cancelJob = jest.fn(async () => true);
        const callLegacyBridge = jest.fn(async () => ({ ok: true }));
        const state = {
            settings: {},
            selected: { character: 'hero.png', chat: 'chat-a' },
            engine: { generating: true, activity: 'image', settingsSyncPending: 0, status: '', detail: '', error: '', streaming: { text: '', chatId: '' } },
            chatImageGeneration: { cancelJob },
            chatMessages: {},
            chatMetadata: {},
        };
        const actions = createChatGenerationActions(/** @type {any} */ ({
            state,
            apiFetch: async () => null,
            render: () => {},
            showToast: () => {},
            callLegacyBridge,
            subscribeProgress: () => () => {},
            formatNumber: String,
            getSelectedChatEntity: () => hero,
            getChatContextKey: () => 'hero.png',
            getChatEntityName: item => item.name,
            isGroupChatMode: () => false,
            getSelectedChatMessages: () => [],
            getCurrentDraftKey: () => cacheKey('hero.png', 'chat-a'),
            getChatCacheKey: cacheKey,
            getUserName: () => 'User',
            loadChatMessages: async () => [],
            refreshSelectedChatList: async () => {},
            createModernChatFile: async () => {},
            runModernChatFileOperation: async () => {},
        }));
        await actions.stopModernGeneration();
        expect(cancelJob).toHaveBeenCalledTimes(1);
        expect(callLegacyBridge).not.toHaveBeenCalled();
    });

    test('helpers keep request parameters valid', () => {
        expect(pickImageRequestParams({ width: 1024, quality: 'high', steps: 20, seed: null }, ['width', 'height', 'quality', 'seed'])).toEqual({ quality: 'high' });
        expect(clampImageCount({ count: 9 }, { countMax: 4 })).toEqual({ count: 4 });
        expect(clampImageCount({ count: 0 }, { countMax: 4 })).toEqual({ count: 1 });
        expect(clampImageCount({ quality: 'low' }, {})).toEqual({ quality: 'low' });
        const date = new Date(1_760_000_000_000).toISOString();
        expect(createUniqueSendDate([{ send_date: date }], 1_760_000_000_000)).toBe(new Date(1_760_000_000_001).toISOString());
        expect(readImageRecord({ status: 'cancelled' })).toEqual({ kind: 'cancelled' });
        expect(readImageRecord({ status: 'completed', images: [] }).kind).toBe('failed');
        expect(readImageRecord({ status: 'failed', error: { error: 'save-failed', message: 'x', outcome: 'charged' } })).toMatchObject({ kind: 'failed', failure: { code: 'save-failed', outcome: 'charged' } });
    });
});
