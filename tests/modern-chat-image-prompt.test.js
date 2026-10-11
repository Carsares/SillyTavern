import { describe, expect, jest, test } from '@jest/globals';

// 「从消息生成」提示词（WP5）：公共请求函数、提示词消息构造、勾选与生成动作、勾选渲染、事件。
// 这些模块都不引入 core/state.js，不需要 localStorage / window 替身；apiFetch 用替身记录请求。

import {
    createChatCompletionRequestBody,
    extractReasoningText,
    getChatCompletionSettingsForTest,
    readConnectionTestReply,
    responseContentToText,
} from '../public/modern/core/chat-completion-request.js';
import {
    buildAppearanceText,
    buildImagePromptMessages,
    createChatImagePromptActions,
    describePromptGenerationFailure,
    describePromptSourceSelection,
    findGroupAppearanceCharacters,
    getPromptGenerationGate,
    isChatImageSelectionActive,
    PROMPT_GENERATION_NO_MODEL_MESSAGE,
    PROMPT_GENERATION_TEXT_BUSY_MESSAGE,
    PROMPT_SOURCE_OVER_LIMIT_MESSAGE,
    selectPromptSources,
    toPromptSourceLines,
} from '../public/modern/actions/chat-image-prompt.js';
import { createChatImageSelectionComponents } from '../public/modern/components/chat-image-selection.js';
import { bindChatImagePromptEvents } from '../public/modern/routes/chat-image-prompt-events.js';
import { getChatImageView } from '../public/modern/core/chat-image-state.js';
import { DEFAULT_PROMPT_TEMPLATE } from '../public/modern/core/image-generation-config.js';
import { messageIdentity } from '../public/modern/core/image-message.js';
import { escapeHtml } from '../public/modern/core/utils.js';

const CACHE_KEY = 'alice.png::chat-1';
const iso = second => new Date(Date.UTC(2026, 9, 12, 0, 0, second)).toISOString();

function createMessages() {
    return [
        { name: 'Alice', is_user: false, is_system: false, send_date: iso(0), mes: 'Opening line.' },
        { name: 'Modern User', is_user: true, is_system: false, send_date: iso(1), mes: 'Look at the moon.' },
        { name: 'Alice', is_user: false, is_system: false, send_date: iso(2), mes: 'It is beautiful tonight.' },
        {
            name: 'Alice',
            is_user: false,
            is_system: true,
            send_date: iso(3),
            mes: '',
            extra: { media: [{ url: '/user/images/Alice/a.png', type: 'image', source: 'generated', title: 'moon' }], media_index: 0 },
        },
        { name: 'Narrator', is_user: false, is_system: true, send_date: iso(4), mes: 'System note.' },
    ];
}

const alice = { avatar: 'alice.png', name: 'Alice', data: { name: 'Alice', description: 'Silver hair, blue cloak. Friend of {{user}}.' } };
const bruno = { avatar: 'bruno.png', name: 'Bruno', data: { name: 'Bruno', description: 'Tall, red scarf.' } };
const cara = { avatar: 'cara.png', name: 'Cara', shallow: true };

function readNumber(settings, key, fallback) {
    const value = Number(settings[key]);
    return Number.isFinite(value) ? value : fallback;
}

function abortError() {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
}

/**
 * apiFetch 替身：每次调用都挂起，测试自己决定何时 resolve / reject；signal 中止时按浏览器的方式抛 AbortError。
 */
function createDeferredFetch() {
    const calls = [];
    const apiFetch = jest.fn((path, options = {}) => new Promise((resolve, reject) => {
        calls.push({ path, options, resolve, reject });
        options.signal?.addEventListener('abort', () => reject(abortError()));
    }));
    return { apiFetch, calls };
}

function createHarness({
    messages = createMessages(),
    settings = {},
    groupMode = false,
    entity = alice,
    characters = [alice, bruno],
    apiFetch = jest.fn(async () => ({ choices: [{ message: { content: '  A silver-haired girl under the moon.  ' } }] })),
} = {}) {
    const state = {
        settings: {
            main_api: 'openai',
            name1: 'Modern User',
            oai_settings: { chat_completion_source: 'openai', openai_model: 'gpt-test', openai_max_tokens: 300, temp_openai: 0.7 },
            extension_settings: {},
            ...settings,
        },
        engine: { generating: false, activity: '' },
        characters,
        characterDetails: {},
        chatTools: { open: false },
        chatImageGeneration: {},
    };
    const view = getChatImageView(state, CACHE_KEY);
    view.mode = 'image';
    view.sub = 'auto';
    view.autoStep = 1;
    const render = jest.fn();
    const showToast = jest.fn();
    const deps = {
        state,
        apiFetch,
        render,
        showToast,
        actionRegistry: {
            chatContextActions: {
                getCurrentDraftKey: () => CACHE_KEY,
                getSelectedChatMessages: () => messages,
            },
            getSelectedChatEntity: () => entity,
            isGroupChatMode: () => groupMode,
            apiConnectionActions: {
                getOaiSettings: () => state.settings.oai_settings,
                getChatCompletionModel: (saved, source) => saved[`${source}_model`] || saved.openai_model || '',
                getNumberSetting: readNumber,
            },
        },
    };
    return { state, view, messages, render, showToast, apiFetch, actions: createChatImagePromptActions(deps) };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('core/chat-completion-request', () => {
    const getModel = (saved, source) => saved[`${source}_model`] || saved.openai_model || '';

    test('reads the saved chat completion settings with the same defaults as the connection test', () => {
        const settings = getChatCompletionSettingsForTest({
            oaiSettings: { openai_model: 'gpt-test', temp_openai: '0.5', reverse_proxy: 'http://proxy' },
            settings: { chat_completion_source: 'openai' },
            getChatCompletionModel: getModel,
        });
        expect(settings).toMatchObject({
            source: 'openai',
            model: 'gpt-test',
            temperature: 0.5,
            topP: 1,
            frequencyPenalty: 0,
            presencePenalty: 0,
            siliconflowEndpoint: 'global',
            minimaxEndpoint: 'global',
            reverseProxy: 'http://proxy',
        });
        expect(settings.maxTokens).toBeGreaterThan(0);
        const fromTopLevel = getChatCompletionSettingsForTest({
            oaiSettings: { claude_model: 'claude-test' },
            settings: { chat_completion_source: 'claude' },
            getChatCompletionModel: getModel,
        });
        expect(fromTopLevel.source).toBe('claude');
        expect(fromTopLevel.model).toBe('claude-test');
    });

    test('throws when no model is filled in', () => {
        expect(() => getChatCompletionSettingsForTest({ oaiSettings: {}, settings: {}, getChatCompletionModel: getModel }))
            .toThrow('还没有填写模型');
    });

    test('builds a non-streaming request body', () => {
        const settings = getChatCompletionSettingsForTest({ oaiSettings: { openai_model: 'gpt-test' }, getChatCompletionModel: getModel });
        const body = createChatCompletionRequestBody(settings, [{ role: 'user', content: 'hi' }]);
        expect(body).toMatchObject({ chat_completion_source: 'openai', model: 'gpt-test', stream: false, n: 1, messages: [{ role: 'user', content: 'hi' }] });
    });

    test('reads replies, reasoning-only replies and errors carried in a 200', () => {
        expect(readConnectionTestReply({ choices: [{ message: { content: ' OK ' } }] })).toEqual({ text: 'OK', reasoningOnly: false });
        expect(readConnectionTestReply({ content: [{ type: 'text', text: 'Claude text' }] }).text).toBe('Claude text');
        expect(readConnectionTestReply({ choices: [{ message: { content: '', reasoning_content: 'thinking…' } }] })).toEqual({ text: '', reasoningOnly: true });
        expect(() => readConnectionTestReply({ error: { message: 'quota exceeded' } })).toThrow('quota exceeded');
        expect(() => readConnectionTestReply({ choices: [{ message: { content: '' } }] })).toThrow('模型没有返回可显示内容');
        expect(responseContentToText([{ text: 'a' }, { content: 'b' }])).toBe('a\nb');
        expect(extractReasoningText({ choices: [{ message: { content: [{ type: 'thinking', thinking: 'deep' }] } }] })).toBe('deep');
    });
});

describe('prompt message construction', () => {
    test('system is the template; user carries the optional appearance and Name: text lines', () => {
        const withAppearance = buildImagePromptMessages({
            template: 'TEMPLATE',
            appearance: 'Alice: Silver hair.',
            selected: [{ name: 'Modern User', text: 'Look at the moon.' }, { name: 'Alice', text: 'It is beautiful.' }],
        });
        expect(withAppearance).toEqual([
            { role: 'system', content: 'TEMPLATE' },
            { role: 'user', content: 'Character appearance:\nAlice: Silver hair.\n\nConversation excerpt:\nModern User: Look at the moon.\nAlice: It is beautiful.' },
        ]);
        const without = buildImagePromptMessages({ template: 'T', appearance: '  ', selected: [{ name: 'A', text: 'x' }] });
        expect(without[1].content).toBe('Conversation excerpt:\nA: x');
    });

    test('appearance text skips empty descriptions and user lines fall back to the user name', () => {
        expect(buildAppearanceText([{ name: 'Alice', description: ' Silver ' }, { name: 'Bruno', description: '' }, { name: 'Cara', description: 'Green' }]))
            .toBe('Alice: Silver\n\nCara: Green');
        expect(toPromptSourceLines([{ is_user: true, mes: ' hi ' }, { name: 'Alice', mes: 'yo' }], 'Me')).toEqual([{ name: 'Me', text: 'hi' }, { name: 'Alice', text: 'yo' }]);
    });

    test('group appearance takes every character that speaks in the selected messages, in order of appearance', () => {
        const sources = [
            { name: 'Bruno', is_user: false, mes: 'b' },
            { name: 'Modern User', is_user: true, mes: 'u' },
            { name: 'Alice', is_user: false, mes: 'a' },
            { name: 'Bruno', is_user: false, mes: 'b2' },
            { name: 'Ghost', is_user: false, mes: 'g' },
        ];
        const found = findGroupAppearanceCharacters({ sources, group: { members: ['alice.png', 'bruno.png'] }, characters: [alice, bruno] });
        expect(found.map(character => character.name)).toEqual(['Bruno', 'Alice']);
    });
});

describe('selection rules', () => {
    test('only selected prompt-source messages count, in chat order; image and system messages are ignored', () => {
        const messages = createMessages();
        const selected = new Set([messageIdentity(messages[2]), messageIdentity(messages[3]), messageIdentity(messages[0]), 'gone|x|0']);
        const sources = selectPromptSources(selected, messages);
        expect(sources.map(message => message.mes)).toEqual(['Opening line.', 'It is beautiful tonight.']);
        expect(describePromptSourceSelection(sources)).toEqual({ count: 2, characters: 'Opening line.'.length + 'It is beautiful tonight.'.length, overLimit: false });
    });

    test('the generate button is gated by limits, text generation and the main API', () => {
        const base = { settings: { main_api: 'openai' }, engine: { generating: false } };
        const many = Array.from({ length: 21 }, (_, index) => ({ mes: `m${index}` }));
        const long = [{ mes: 'x'.repeat(6001) }];
        expect(getPromptGenerationGate({ ...base, sources: [] }).code).toBe('empty');
        expect(getPromptGenerationGate({ ...base, sources: many })).toMatchObject({ ok: false, code: 'over-limit', reason: PROMPT_SOURCE_OVER_LIMIT_MESSAGE });
        expect(getPromptGenerationGate({ ...base, sources: long }).code).toBe('over-limit');
        expect(getPromptGenerationGate({ ...base, sources: [{ mes: 'x'.repeat(6000) }] }).ok).toBe(true);
        expect(getPromptGenerationGate({ ...base, engine: { generating: true, activity: '' }, sources: [{ mes: 'a' }] }))
            .toMatchObject({ ok: false, code: 'busy', reason: PROMPT_GENERATION_TEXT_BUSY_MESSAGE });
        // 图片生成占着 generating 时不挡生成提示词（原型只在文本回复生成中禁用）
        expect(getPromptGenerationGate({ ...base, engine: { generating: true, activity: 'image' }, sources: [{ mes: 'a' }] }).ok).toBe(true);
        expect(getPromptGenerationGate({ ...base, settings: { main_api: 'textgenerationwebui' }, sources: [{ mes: 'a' }] }).code).toBe('unsupported');
        expect(getPromptGenerationGate({ ...base, sources: [{ mes: 'a' }], model: '' }).code).toBe('no-model');
    });

    test('selection mode needs image mode, the auto sub-mode, step 1 and a chat completion connection', () => {
        const view = { mode: 'image', sub: 'auto', autoStep: 1 };
        expect(isChatImageSelectionActive(view, { main_api: 'openai' })).toBe(true);
        expect(isChatImageSelectionActive({ ...view, autoStep: 2 }, { main_api: 'openai' })).toBe(false);
        expect(isChatImageSelectionActive({ ...view, sub: 'manual' }, {})).toBe(false);
        expect(isChatImageSelectionActive(view, { main_api: 'kobold' })).toBe(false);
        expect(isChatImageSelectionActive(null, {})).toBe(false);
    });

    test('failure descriptions prefer the backend message', () => {
        expect(describePromptGenerationFailure(Object.assign(new Error('x failed: 500'), { body: '{"error":{"message":"upstream down"}}' }))).toBe('生成提示词失败：upstream down');
        expect(describePromptGenerationFailure(Object.assign(new Error('x failed: 502'), { body: 'Bad gateway' }))).toBe('生成提示词失败：Bad gateway');
        expect(describePromptGenerationFailure(new Error('offline'))).toBe('生成提示词失败：offline');
    });
});

describe('createChatImagePromptActions', () => {
    test('toggle, quick select, clear and the appearance switch change only the current view', () => {
        const { view, messages, actions, render } = createHarness();
        expect(actions.toggleChatImageSelection(messageIdentity(messages[1]))).toBe(true);
        expect([...view.selected]).toEqual([messageIdentity(messages[1])]);
        expect(view.selectionInitialized).toBe(true);
        // 图片消息和系统消息不能勾选
        expect(actions.toggleChatImageSelection(messageIdentity(messages[3]))).toBe(false);
        expect(actions.toggleChatImageSelection(messageIdentity(messages[4]))).toBe(false);
        expect(actions.toggleChatImageSelection(messageIdentity(messages[1]))).toBe(true);
        expect(view.selected.size).toBe(0);

        actions.selectRecentChatImageMessages(2);
        expect([...view.selected]).toEqual([messageIdentity(messages[1]), messageIdentity(messages[2])]);
        actions.clearChatImageSelection();
        expect(view.selected.size).toBe(0);
        actions.setChatImageIncludeAppearance(false);
        expect(view.includeAppearance).toBe(false);
        expect(render).toHaveBeenCalled();
    });

    test('generates a prompt from the selected messages without locking the text engine', async () => {
        const { state, view, messages, actions, apiFetch } = createHarness();
        actions.selectRecentChatImageMessages(2);
        await actions.generateChatImagePrompt();

        expect(apiFetch).toHaveBeenCalledTimes(1);
        const [path, options] = apiFetch.mock.calls[0];
        expect(path).toBe('/api/backends/chat-completions/generate');
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(options.body).toMatchObject({ chat_completion_source: 'openai', model: 'gpt-test', stream: false, max_tokens: 300, temperature: 0.7 });
        expect(options.body.messages[0]).toEqual({ role: 'system', content: DEFAULT_PROMPT_TEMPLATE });
        expect(options.body.messages[1].content).toBe([
            'Character appearance:',
            'Alice: Silver hair, blue cloak. Friend of Modern User.',
            '',
            'Conversation excerpt:',
            `Modern User: ${messages[1].mes}`,
            `Alice: ${messages[2].mes}`,
        ].join('\n'));

        expect(view.prompt).toBe('A silver-haired girl under the moon.');
        expect(view.promptFrom).toBe(2);
        expect(view.autoStep).toBe(3);
        expect(view.promptJob).toBeNull();
        expect(state.engine.generating).toBe(false);
    });

    test('uses the template from settings and leaves out the appearance when switched off', async () => {
        const { view, actions, apiFetch } = createHarness({ settings: { extension_settings: { imageGeneration: { promptGen: { template: 'MY TEMPLATE' } } } } });
        actions.selectRecentChatImageMessages(1);
        view.includeAppearance = false;
        await actions.generateChatImagePrompt();
        const { messages } = apiFetch.mock.calls[0][1].body;
        expect(messages[0].content).toBe('MY TEMPLATE');
        expect(messages[1].content).toBe('Conversation excerpt:\nAlice: It is beautiful tonight.');
    });

    test('freezes the selection while generating and cancel aborts back to step 1', async () => {
        const { apiFetch, calls } = createDeferredFetch();
        const { view, messages, actions, showToast } = createHarness({ apiFetch });
        actions.selectRecentChatImageMessages(2);
        view.prompt = 'kept draft';
        const running = actions.generateChatImagePrompt();
        await flush();

        expect(view.autoStep).toBe(2);
        expect(view.promptJob?.controller).toBeInstanceOf(AbortController);
        expect(calls).toHaveLength(1);
        // 生成中勾选冻结：切换、快速选择都不生效；重复点击不会发第二个请求
        expect(actions.toggleChatImageSelection(messageIdentity(messages[0]))).toBe(false);
        actions.selectRecentChatImageMessages(1);
        expect(view.selected.size).toBe(2);
        await actions.generateChatImagePrompt();
        expect(calls).toHaveLength(1);

        actions.cancelChatImagePrompt();
        await running;
        expect(calls[0].options.signal.aborted).toBe(true);
        expect(view.autoStep).toBe(1);
        expect(view.promptJob).toBeNull();
        expect(view.prompt).toBe('kept draft');
        expect(showToast).toHaveBeenCalledWith('已取消生成提示词', expect.any(String));
    });

    test('an error carried in a 200 reply returns to step 1 with the error and allows a retry', async () => {
        const apiFetch = jest.fn()
            .mockResolvedValueOnce({ error: { message: 'model overloaded' } })
            .mockResolvedValueOnce({ choices: [{ message: { content: 'second try' } }] });
        const { view, actions } = createHarness({ apiFetch });
        actions.selectRecentChatImageMessages(1);
        await actions.generateChatImagePrompt();
        expect(view.autoStep).toBe(1);
        expect(view.promptJob).toEqual({ controller: null, error: '生成提示词失败：model overloaded' });

        await actions.generateChatImagePrompt();
        expect(view.autoStep).toBe(3);
        expect(view.prompt).toBe('second try');
        expect(view.promptJob).toBeNull();
    });

    test('an empty or reasoning-only reply is an error', async () => {
        const apiFetch = jest.fn(async () => ({ choices: [{ message: { content: '', reasoning_content: 'hmm' } }] }));
        const { view, actions } = createHarness({ apiFetch });
        actions.selectRecentChatImageMessages(1);
        await actions.generateChatImagePrompt();
        expect(view.autoStep).toBe(1);
        expect(view.promptJob.error).toContain('推理内容');
    });

    test('an HTTP failure shows the backend message', async () => {
        const apiFetch = jest.fn(async () => {
            throw Object.assign(new Error('/api/backends/chat-completions/generate failed: 500'), { status: 500, body: '{"error":{"message":"bad key"}}' });
        });
        const { view, actions } = createHarness({ apiFetch });
        actions.selectRecentChatImageMessages(1);
        await actions.generateChatImagePrompt();
        expect(view.promptJob.error).toBe('生成提示词失败：bad key');
    });

    test('does not send anything for a text completion connection, a missing model, an empty or oversized selection, or a busy engine', async () => {
        const unsupported = createHarness({ settings: { main_api: 'textgenerationwebui' } });
        unsupported.actions.selectRecentChatImageMessages(1);
        await unsupported.actions.generateChatImagePrompt();
        expect(unsupported.apiFetch).not.toHaveBeenCalled();
        expect(unsupported.view.promptJob.error).toContain('聊天补全');

        const noModel = createHarness({ settings: { oai_settings: { chat_completion_source: 'openai' } } });
        noModel.view.selected = new Set([messageIdentity(noModel.messages[0])]);
        await noModel.actions.generateChatImagePrompt();
        expect(noModel.apiFetch).not.toHaveBeenCalled();
        expect(noModel.view.promptJob.error).toBe(PROMPT_GENERATION_NO_MODEL_MESSAGE);

        const empty = createHarness();
        await empty.actions.generateChatImagePrompt();
        expect(empty.apiFetch).not.toHaveBeenCalled();
        expect(empty.view.autoStep).toBe(1);

        const longMessages = Array.from({ length: 2 }, (_, index) => ({ name: 'Alice', is_user: false, send_date: iso(index), mes: 'x'.repeat(3001) }));
        const oversized = createHarness({ messages: longMessages });
        oversized.actions.selectRecentChatImageMessages(2);
        await oversized.actions.generateChatImagePrompt();
        expect(oversized.apiFetch).not.toHaveBeenCalled();
        expect(oversized.view.promptJob.error).toBe(PROMPT_SOURCE_OVER_LIMIT_MESSAGE);

        const busy = createHarness();
        busy.actions.selectRecentChatImageMessages(1);
        busy.state.engine.generating = true;
        await busy.actions.generateChatImagePrompt();
        expect(busy.apiFetch).not.toHaveBeenCalled();
        expect(busy.showToast).toHaveBeenCalledWith('暂时不能生成提示词', PROMPT_GENERATION_TEXT_BUSY_MESSAGE);
    });

    test('group chats add the appearance of every character in the selection and load summary-only cards', async () => {
        const messages = [
            { name: 'Bruno', is_user: false, send_date: iso(0), mes: 'Bruno speaks.' },
            { name: 'Cara', is_user: false, send_date: iso(1), mes: 'Cara speaks.' },
            { name: 'Alice', is_user: false, send_date: iso(2), mes: 'Alice is not selected.' },
        ];
        const apiFetch = jest.fn(async path => {
            if (path === '/api/characters/get') {
                return { avatar: 'cara.png', name: 'Cara', data: { name: 'Cara', description: 'Green eyes.' } };
            }
            return { choices: [{ message: { content: 'group prompt' } }] };
        });
        const { view, actions } = createHarness({
            messages,
            apiFetch,
            groupMode: true,
            entity: { id: 'g1', members: ['alice.png', 'bruno.png', 'cara.png'] },
            characters: [alice, bruno, cara],
        });
        view.selected = new Set([messageIdentity(messages[0]), messageIdentity(messages[1])]);
        await actions.generateChatImagePrompt();

        expect(apiFetch.mock.calls[0]).toEqual(['/api/characters/get', expect.objectContaining({ body: { avatar_url: 'cara.png' } })]);
        const generate = apiFetch.mock.calls.find(call => call[0] === '/api/backends/chat-completions/generate');
        expect(generate[1].body.messages[1].content).toBe('Character appearance:\nBruno: Tall, red scarf.\n\nCara: Green eyes.\n\nConversation excerpt:\nBruno: Bruno speaks.\nCara: Cara speaks.');
        expect(view.prompt).toBe('group prompt');
    });

    test('a result that arrives after leaving the auto sub-mode is dropped', async () => {
        const { apiFetch, calls } = createDeferredFetch();
        const { view, actions } = createHarness({ apiFetch });
        actions.selectRecentChatImageMessages(1);
        view.prompt = 'manual draft';
        const running = actions.generateChatImagePrompt();
        await flush();
        view.sub = 'manual';
        calls[0].resolve({ choices: [{ message: { content: 'late prompt' } }] });
        await running;
        expect(view.prompt).toBe('manual draft');
        expect(view.autoStep).toBe(1);
        expect(view.promptJob).toBeNull();
    });

    test('back to selection and exit go to step 1 / the manual sub-mode and abort a running request', async () => {
        const { apiFetch, calls } = createDeferredFetch();
        const { view, actions } = createHarness({ apiFetch });
        view.autoStep = 3;
        actions.returnToChatImageSelection();
        expect(view.autoStep).toBe(1);

        actions.selectRecentChatImageMessages(1);
        const running = actions.generateChatImagePrompt();
        await flush();
        actions.exitChatImageSelection();
        await running;
        expect(calls[0].options.signal.aborted).toBe(true);
        expect(view.sub).toBe('manual');
        expect(view.autoStep).toBe(1);
        expect(view.promptJob).toBeNull();
    });
});

function createComponents({ view, messages = createMessages(), settings = {}, engine = { generating: false } } = {}) {
    const state = { settings: { main_api: 'openai', oai_settings: { chat_completion_source: 'openai', openai_model: 'gpt-test' }, ...settings }, engine, chatImageGeneration: {} };
    const current = getChatImageView(state, CACHE_KEY);
    Object.assign(current, { mode: 'image', sub: 'auto', autoStep: 1 }, view || {});
    const components = createChatImageSelectionComponents({
        state,
        escapeHtml,
        formatNumber: value => String(value),
        getCurrentDraftKey: () => CACHE_KEY,
        getSelectedChatMessages: () => messages,
        isGroupChatMode: () => false,
        getOaiSettings: () => state.settings.oai_settings,
        getChatCompletionModel: (saved, source) => saved[`${source}_model`] || saved.openai_model || '',
    });
    return { state, view: current, messages, ...components };
}

describe('chat-image-selection components', () => {
    test('text messages get a checkbox; image and system messages are dimmed; nothing outside selection mode', () => {
        const { view, messages, getMessageSelection, renderSelectionBanner } = createComponents();
        view.selected = new Set([messageIdentity(messages[2])]);

        const plain = getMessageSelection(messages[1], 1);
        expect(plain.className).toBe('message-selectable');
        expect(plain.attrs).toContain(`data-image-select="${escapeHtml(messageIdentity(messages[1]))}"`);
        expect(plain.controlHtml).toContain('data-image-select-checkbox');
        expect(plain.controlHtml).not.toContain('checked');

        const picked = getMessageSelection(messages[2], 2);
        expect(picked.className).toBe('message-selectable message-selected');
        expect(picked.controlHtml).toContain('checked');

        const image = getMessageSelection(messages[3], 3);
        expect(image).toMatchObject({ className: 'message-unselectable', controlHtml: '' });
        expect(image.attrs).toContain('图片消息不参与生成提示词');
        expect(getMessageSelection(messages[4], 4).attrs).toContain('系统消息不参与生成提示词');

        expect(renderSelectionBanner()).toContain('已选 <b data-image-select-banner-count>1</b> 条');
        expect(renderSelectionBanner()).toContain('退出勾选（Esc）');

        view.autoStep = 2;
        expect(getMessageSelection(messages[1], 1)).toEqual({ className: '', attrs: '', controlHtml: '' });
        expect(renderSelectionBanner()).toBe('');
    });

    test('step 1 shows the count, characters, quick select and a disabled button with the reason', () => {
        const { view, messages, renderPromptSourceSteps } = createComponents();
        let html = renderPromptSourceSteps(view, messages);
        expect(html).toContain('data-image-prompt-step="1"');
        expect(html).toContain('已选 <strong data-image-select-count>0</strong> 条，约 0 字');
        expect(html).toMatch(/data-image-prompt-generate disabled/);
        for (const count of [1, 3, 5]) {
            expect(html).toContain(`data-image-select-recent="${count}"`);
        }
        expect(html).toContain('data-image-prompt-appearance checked');

        view.selected = new Set([messageIdentity(messages[1])]);
        html = renderPromptSourceSteps(view, messages);
        expect(html).toContain(`约 ${messages[1].mes.length} 字`);
        expect(html).not.toMatch(/data-image-prompt-generate disabled/);

        view.promptJob = { controller: null, error: '生成提示词失败：bad key' };
        html = renderPromptSourceSteps(view, messages);
        expect(html).toContain('data-image-prompt-error');
        expect(html).toContain('重试生成提示词');

        const many = Array.from({ length: 21 }, (_, index) => ({ name: 'Alice', send_date: iso(index), mes: `line ${index}` }));
        const over = createComponents({ messages: many });
        over.view.selected = new Set(many.map(messageIdentity));
        html = over.renderPromptSourceSteps(over.view, many);
        expect(html).toContain(PROMPT_SOURCE_OVER_LIMIT_MESSAGE);
        expect(html).toMatch(/data-image-prompt-generate disabled/);
    });

    test('step 2 shows the model and cancel; step 3 shows the source line; text completion shows the explanation', () => {
        const { view, messages, renderPromptSourceSteps } = createComponents();
        view.selected = new Set([messageIdentity(messages[1]), messageIdentity(messages[2])]);
        view.autoStep = 2;
        let html = renderPromptSourceSteps(view, messages);
        expect(html).toContain('正在用 <b>gpt-test</b> 根据 2 条消息和角色外貌生成图片提示词');
        expect(html).toContain('data-image-prompt-cancel');

        view.autoStep = 3;
        view.promptFrom = 2;
        html = renderPromptSourceSteps(view, messages);
        expect(html).toContain('由 2 条消息生成');
        expect(html).toContain('data-image-prompt-regenerate');
        expect(html).toContain('data-image-prompt-back');
        expect(html).not.toContain('data-chat-image-prompt');

        const unsupported = createComponents({ settings: { main_api: 'textgenerationwebui' } });
        html = unsupported.renderPromptSourceSteps(unsupported.view, unsupported.messages);
        expect(html).toContain('data-image-prompt-unsupported');
        expect(html).not.toContain('data-image-prompt-stepper');
    });
});

/**
 * 只实现 closest / contains / dataset 的最小元素替身，选择器只支持 [data-x] 和 tag[attr]，用逗号并列。
 */
function fakeElement(attrs = {}, parent = null, tagName = 'div') {
    const dataset = {};
    for (const [name, value] of Object.entries(attrs)) {
        if (name.startsWith('data-')) {
            dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
        }
    }
    const node = { tagName: tagName.toUpperCase(), attrs, parentElement: parent, dataset };
    node.contains = other => {
        for (let current = other; current; current = current.parentElement) {
            if (current === node) {
                return true;
            }
        }
        return false;
    };
    node.closest = selector => {
        const parts = selector.split(',').map(part => part.trim());
        for (let current = node; current; current = current.parentElement) {
            if (parts.some(part => {
                const match = /^([a-z]*)\[([\w-]+)\]$/.exec(part);
                return match && (!match[1] || current.tagName.toLowerCase() === match[1]) && Object.hasOwn(current.attrs, match[2]);
            })) {
                return current;
            }
        }
        return null;
    };
    return node;
}

function createEventHarness({ autoStep = 1 } = {}) {
    const state = { settings: { main_api: 'openai' }, chatTools: { open: false }, chatImageGeneration: {} };
    Object.assign(getChatImageView(state, CACHE_KEY), { mode: 'image', sub: 'auto', autoStep });
    const actions = {
        toggleChatImageSelection: jest.fn(() => true),
        selectRecentChatImageMessages: jest.fn(),
        clearChatImageSelection: jest.fn(),
        setChatImageIncludeAppearance: jest.fn(),
        generateChatImagePrompt: jest.fn(async () => {}),
        cancelChatImagePrompt: jest.fn(),
        returnToChatImageSelection: jest.fn(),
        exitChatImageSelection: jest.fn(),
    };
    const handlers = bindChatImagePromptEvents({ state, getCurrentDraftKey: () => CACHE_KEY, ...actions });
    return { state, actions, handlers };
}

const clickOn = target => ({ target, preventDefault: jest.fn() });

describe('chat-image-prompt events', () => {
    test('a click anywhere on a selectable message toggles it and keeps message buttons from firing', () => {
        const { actions, handlers } = createEventHarness();
        const article = fakeElement({ 'data-image-select': 'id-1' }, null, 'article');
        const deleteButton = fakeElement({ 'data-delete-message': '2' }, article, 'button');
        const event = clickOn(deleteButton);
        expect(handlers.handleClick(event)).toBe(true);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(actions.toggleChatImageSelection).toHaveBeenCalledWith('id-1');

        const link = fakeElement({ href: 'https://example.com' }, article, 'a');
        const linkEvent = clickOn(link);
        expect(handlers.handleClick(linkEvent)).toBe(true);
        expect(linkEvent.preventDefault).not.toHaveBeenCalled();
        expect(actions.toggleChatImageSelection).toHaveBeenCalledTimes(1);

        const unavailable = fakeElement({ 'data-image-select-unavailable': '' }, null, 'article');
        expect(handlers.handleClick(clickOn(fakeElement({}, unavailable, 'button')))).toBe(false);
    });

    test('outside selection mode message clicks pass through', () => {
        const { actions, handlers } = createEventHarness({ autoStep: 2 });
        const article = fakeElement({ 'data-image-select': 'id-1' }, null, 'article');
        expect(handlers.handleClick(clickOn(article))).toBe(false);
        expect(actions.toggleChatImageSelection).not.toHaveBeenCalled();
    });

    test('step buttons call their actions', () => {
        const { actions, handlers } = createEventHarness();
        handlers.handleClick(clickOn(fakeElement({ 'data-image-select-recent': '3' }, null, 'button')));
        expect(actions.selectRecentChatImageMessages).toHaveBeenCalledWith(3);
        handlers.handleClick(clickOn(fakeElement({ 'data-image-select-clear': '' })));
        handlers.handleClick(clickOn(fakeElement({ 'data-image-prompt-generate': '' })));
        handlers.handleClick(clickOn(fakeElement({ 'data-image-prompt-regenerate': '' })));
        handlers.handleClick(clickOn(fakeElement({ 'data-image-prompt-cancel': '' })));
        handlers.handleClick(clickOn(fakeElement({ 'data-image-prompt-back': '' })));
        handlers.handleClick(clickOn(fakeElement({ 'data-image-select-exit': '' })));
        expect(actions.clearChatImageSelection).toHaveBeenCalledTimes(1);
        expect(actions.generateChatImagePrompt).toHaveBeenCalledTimes(2);
        expect(actions.cancelChatImagePrompt).toHaveBeenCalledTimes(1);
        expect(actions.returnToChatImageSelection).toHaveBeenCalledTimes(1);
        expect(actions.exitChatImageSelection).toHaveBeenCalledTimes(1);

        const appearance = fakeElement({ 'data-image-prompt-appearance': '' }, null, 'input');
        appearance.checked = false;
        expect(handlers.handleChange({ target: appearance })).toBe(true);
        expect(actions.setChatImageIncludeAppearance).toHaveBeenCalledWith(false);
    });

    test('Esc exits selection only when handled; the drawer and text fields keep their Esc', () => {
        const { state, actions, handlers } = createEventHarness();
        const keydown = (target = fakeElement({}, null, 'div')) => ({ key: 'Escape', target, preventDefault: jest.fn(), defaultPrevented: false, isComposing: false });

        expect(handlers.handleKeydown({ ...keydown(), key: 'Enter' })).toBe(false);
        expect(handlers.handleKeydown(keydown(fakeElement({}, null, 'textarea')))).toBe(false);
        state.chatTools.open = true;
        expect(handlers.handleKeydown(keydown())).toBe(false);
        state.chatTools.open = false;
        expect(actions.exitChatImageSelection).not.toHaveBeenCalled();

        const event = keydown();
        expect(handlers.handleKeydown(event)).toBe(true);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(actions.exitChatImageSelection).toHaveBeenCalledTimes(1);

        const notSelecting = createEventHarness({ autoStep: 3 });
        expect(notSelecting.handlers.handleKeydown(keydown())).toBe(false);
    });
});
