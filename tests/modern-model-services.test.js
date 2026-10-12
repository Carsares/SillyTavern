import { describe, expect, jest, test } from '@jest/globals';

import {
    DEFAULT_TRANSLATION_MAX_OUTPUT_TOKENS,
    describeServiceProblem,
    getServiceProblem,
    readChatConnectionService,
    readModelServices,
    resolveSceneTarget,
} from '../public/shared/model-services.js';
import {
    buildReplyLanguageInstruction,
    findLegacyLanguageRule,
    removeLegacyLanguageRule,
    resolveReplyLanguage,
} from '../public/shared/reply-language.js';
import { CHAT_SCENE_OTHER, createModelServiceActions, describeServiceTestFailure } from '../public/modern/actions/model-services.js';

const SERVICE_A = { id: 'svc-a', name: 'A', provider: 'custom', baseUrl: 'https://a.example.test/v1', secretId: 'key-a', defaultModel: 'model-a' };
const SERVICE_D = { id: 'svc-d', name: 'D', provider: 'deepseek', secretId: 'key-d', defaultModel: 'deepseek-chat' };

function settingsWith({ services = [SERVICE_A, SERVICE_D], scenes = {}, oai = {}, mainApi = 'openai' } = {}) {
    return {
        main_api: mainApi,
        oai_settings: { chat_completion_source: 'custom', custom_url: 'https://chat.example.test/v1', custom_model: 'chat-model', openai_max_context: 500000, ...oai },
        extension_settings: { modelServices: { services: structuredClone(services), scenes } },
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// 登记表和场景解析（public/shared/model-services.js）
// ---------------------------------------------------------------------------------------------------------------------

describe('model service registry', () => {
    test('drops records with an unknown provider or no id and fills the defaults', () => {
        const registry = readModelServices({
            extension_settings: {
                modelServices: {
                    services: [SERVICE_A, { id: 'x', provider: 'vertexai' }, { provider: 'deepseek' }, null],
                    scenes: { translation: { maxOutputTokens: 999999 } },
                },
            },
        });
        expect(registry.services.map(service => service.id)).toEqual(['svc-a']);
        expect(registry.services[0].secretKey).toBe('api_key_custom');
        expect(registry.scenes).toEqual({ chat: { serviceId: '' }, translation: { serviceId: '', model: '', maxOutputTokens: DEFAULT_TRANSLATION_MAX_OUTPUT_TOKENS } });
        expect(readModelServices(undefined)).toMatchObject({ services: [] });
    });

    test('says what a service still lacks', () => {
        const base = readModelServices(settingsWith()).services[0];
        expect(getServiceProblem(base)).toBe('');
        expect(getServiceProblem({ ...base, baseUrl: '' })).toBe('base-url-missing');
        expect(getServiceProblem({ ...base, baseUrl: 'https://user:pass@a.test/v1' })).toBe('base-url-invalid');
        expect(getServiceProblem({ ...base, secretId: '' })).toBe('secret-missing');
        expect(describeServiceProblem({ ...base, secretId: '' })).toBe('还没有保存 API Key');
    });

    test('reads the chat connection as an unregistered service only for chat completion', () => {
        expect(readChatConnectionService(settingsWith())).toMatchObject({ service: { provider: 'custom', baseUrl: 'https://chat.example.test/v1', secretKey: 'api_key_custom', id: '' }, model: 'chat-model' });
        expect(readChatConnectionService(settingsWith({ oai: { chat_completion_source: 'deepseek', deepseek_model: 'deepseek-reasoner' } }))).toMatchObject({ service: { provider: 'deepseek', baseUrl: '' }, model: 'deepseek-reasoner' });
        expect(readChatConnectionService(settingsWith({ mainApi: 'kobold' }))).toBeNull();
        expect(readChatConnectionService(settingsWith({ oai: { chat_completion_source: 'vertexai' } }))).toBeNull();
    });
});

describe('scene targets', () => {
    test('the translation scene uses its own service and model, falling back to the service default model', () => {
        const own = resolveSceneTarget(settingsWith({ scenes: { translation: { serviceId: 'svc-d', model: 'deepseek-v4', maxOutputTokens: 2048 } } }), 'translation');
        expect(own).toMatchObject({ service: { id: 'svc-d' }, model: 'deepseek-v4', implicit: false, followsChat: false, maxOutputTokens: 2048 });
        const fallback = resolveSceneTarget(settingsWith({ scenes: { translation: { serviceId: 'svc-d', model: '' } } }), 'translation');
        expect(fallback.model).toBe('deepseek-chat');
    });

    test('following the chat scene uses the registered chat service when its provider still matches, else the bare connection', () => {
        const registered = resolveSceneTarget(settingsWith({ scenes: { chat: { serviceId: 'svc-a' } } }), 'translation');
        expect(registered).toMatchObject({ service: { id: 'svc-a', secretId: 'key-a' }, model: 'chat-model', implicit: false, followsChat: true });

        // a connection profile switched the source to deepseek: the custom service no longer describes the chat connection
        const switched = resolveSceneTarget(settingsWith({ scenes: { chat: { serviceId: 'svc-a' } }, oai: { chat_completion_source: 'deepseek', deepseek_model: 'deepseek-chat' } }), 'translation');
        expect(switched).toMatchObject({ service: { id: '', provider: 'deepseek' }, implicit: true });

        expect(resolveSceneTarget(settingsWith(), 'chat')).toMatchObject({ implicit: true, followsChat: false });
    });

    test('reports why a scene cannot be used', () => {
        const code = (settings, scene = 'translation') => {
            try {
                resolveSceneTarget(settings, scene);
                return 'ok';
            } catch (error) {
                return error.code;
            }
        };
        expect(code(settingsWith(), 'summary')).toBe('scene-not-configured');
        expect(code(settingsWith({ mainApi: 'textgenerationwebui' }))).toBe('scene-not-configured');
        expect(code(settingsWith({ scenes: { translation: { serviceId: 'gone' } } }))).toBe('service-not-found');
        expect(code(settingsWith({ services: [{ ...SERVICE_D, defaultModel: '' }], scenes: { translation: { serviceId: 'svc-d' } } }))).toBe('model-missing');
        expect(code(settingsWith({ oai: { custom_model: '' } }))).toBe('model-missing');
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 回复语言（public/shared/reply-language.js）
// ---------------------------------------------------------------------------------------------------------------------

describe('reply language', () => {
    test('defaults to Simplified Chinese, keeps follow and none, replaces unknown values', () => {
        expect(resolveReplyLanguage(undefined)).toBe('zh-CN');
        expect(resolveReplyLanguage({})).toBe('zh-CN');
        expect(resolveReplyLanguage({ reply_language: 'ja' })).toBe('ja');
        expect(resolveReplyLanguage({ reply_language: 'follow' })).toBe('follow');
        expect(resolveReplyLanguage({ reply_language: '' })).toBe('');
        expect(resolveReplyLanguage({ reply_language: 'klingon' })).toBe('zh-CN');
    });

    test('builds the instruction placed after the chat history', () => {
        expect(buildReplyLanguageInstruction('zh-CN')).toContain('Write the next reply in Simplified Chinese (简体中文), even if the character card');
        expect(buildReplyLanguageInstruction('en')).toContain('in English');
        expect(buildReplyLanguageInstruction('follow')).toContain('same language as the user\'s latest message');
        expect(buildReplyLanguageInstruction('')).toBe('');
    });

    test('finds and removes the hand-written rule, keeping the rest of the prompt and its spacing', () => {
        const rule = 'Always reply in the same language as {{user}}\'s latest message.\nNever switch.';
        const prompt = `Write {{char}}'s next reply.\n\n${rule}\n\nStay in character.`;
        expect(findLegacyLanguageRule(prompt)).toBe(rule);
        expect(removeLegacyLanguageRule(prompt)).toBe('Write {{char}}\'s next reply.\n\nStay in character.');
        expect(removeLegacyLanguageRule(`${rule}\n\nStay in character.`)).toBe('Stay in character.');
        expect(removeLegacyLanguageRule('No rule here.')).toBe('No rule here.');
        expect(findLegacyLanguageRule(undefined)).toBe('');
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 设置中心的模型服务动作（public/modern/actions/model-services.js）
// ---------------------------------------------------------------------------------------------------------------------

function createActionsHarness({ settings = settingsWith(), secretState, commitOk = true, newSecretId = 'key-new' } = {}) {
    const state = {
        loaded: true,
        settings,
        secretState: secretState ?? {
            api_key_custom: [{ id: 'key-active', active: true }, { id: 'key-a', active: false }],
            api_key_deepseek: [{ id: 'key-d', active: false }],
        },
    };
    const commits = [];
    const secretsWritten = [];
    const calls = [];
    const autosave = {
        commit: jest.fn(async ({ changes, label }) => {
            commits.push({ label, changes: structuredClone(changes) });
            if (!commitOk) {
                return { ok: false };
            }
            for (const [path, value] of changes) {
                let target = state.settings;
                for (const key of path.slice(0, -1)) {
                    target[key] ??= {};
                    target = target[key];
                }
                target[path.at(-1)] = structuredClone(value);
            }
            return { ok: true };
        }),
        commitSecret: jest.fn(async options => {
            secretsWritten.push(options);
            return { ok: true, id: newSecretId };
        }),
        flush: jest.fn(async () => {}),
    };
    const apiFetch = jest.fn(async (url, options) => {
        calls.push({ url, body: options?.body });
        if (url === '/api/secrets/read') {
            return state.secretState;
        }
        if (url === '/api/secrets/rotate') {
            const entries = state.secretState[options.body.key] || [];
            entries.forEach(entry => { entry.active = entry.id === options.body.id; });
        }
        return {};
    });
    const render = jest.fn();
    const toasts = [];
    const actions = createModelServiceActions({ state, apiFetch, render, showToast: (title, message) => toasts.push({ title, message }), autosave });
    return { actions, state, commits, secretsWritten, calls, autosave, toasts };
}

describe('model service actions', () => {
    test('the first visit registers the current connection with its active key, once, without touching the connection', async () => {
        const settings = settingsWith();
        delete settings.extension_settings.modelServices;
        const harness = createActionsHarness({ settings });
        expect(await harness.actions.ensureMigrated()).toBe(true);
        expect(await harness.actions.ensureMigrated()).toBe(false);

        const registry = readModelServices(harness.state.settings);
        expect(registry.services).toHaveLength(1);
        expect(registry.services[0]).toMatchObject({ name: 'chat.example.test', provider: 'custom', baseUrl: 'https://chat.example.test/v1', secretId: 'key-active', defaultModel: 'chat-model' });
        expect(registry.scenes.chat.serviceId).toBe(registry.services[0].id);
        expect(harness.commits).toHaveLength(1);
        expect(harness.commits[0].changes.map(([path]) => path.join('.'))).toEqual(['extension_settings.modelServices']);
        expect(harness.secretsWritten).toHaveLength(0);
    });

    test('no migration once a registry exists, even an emptied one, or when the chat does not use chat completion', async () => {
        expect(await createActionsHarness().actions.ensureMigrated()).toBe(false);
        expect(await createActionsHarness({ settings: settingsWith({ services: [] }) }).actions.ensureMigrated()).toBe(false);
        const kobold = settingsWith({ mainApi: 'kobold' });
        delete kobold.extension_settings.modelServices;
        expect(await createActionsHarness({ settings: kobold }).actions.ensureMigrated()).toBe(false);
    });

    test('adding a service writes its key without making it active and remembers the key id', async () => {
        const harness = createActionsHarness();
        const result = await harness.actions.addService({ provider: 'custom', name: '', baseUrl: 'https://b.example.test/v1', apiKey: ' sk-b ', defaultModel: 'model-b' });
        expect(result.ok).toBe(true);
        expect(harness.secretsWritten[0]).toMatchObject({ key: 'api_key_custom', value: 'sk-b', activate: false });
        const added = readModelServices(harness.state.settings).services.find(service => service.id === result.id);
        expect(added).toMatchObject({ name: 'b.example.test', secretId: 'key-new', defaultModel: 'model-b' });
        expect(harness.calls.some(call => call.url === '/api/secrets/rotate')).toBe(false);
    });

    test('adding a service checks the provider and address before writing anything', async () => {
        const harness = createActionsHarness();
        expect((await harness.actions.addService({ provider: 'vertexai' })).ok).toBe(false);
        expect((await harness.actions.addService({ provider: 'custom', baseUrl: '' })).error).toContain('服务地址');
        expect((await harness.actions.addService({ provider: 'custom', baseUrl: 'ftp://x' })).error).toContain('http://');
        expect(harness.secretsWritten).toHaveLength(0);
        expect(harness.commits).toHaveLength(0);
    });

    test('choosing a service for the chat scene writes the source, address and model, then makes its key active', async () => {
        const harness = createActionsHarness();
        await harness.actions.selectChatService('svc-a');
        const written = Object.fromEntries(harness.commits[0].changes.map(([path, value]) => [path.join('.'), value]));
        expect(written).toMatchObject({
            'main_api': 'openai',
            'chat_completion_source': 'custom',
            'oai_settings.chat_completion_source': 'custom',
            'oai_settings.custom_url': 'https://a.example.test/v1',
            'oai_settings.custom_model': 'chat-model',
        });
        expect(written['extension_settings.modelServices'].scenes.chat.serviceId).toBe('svc-a');
        expect(harness.calls).toContainEqual({ url: '/api/secrets/rotate', body: { key: 'api_key_custom', id: 'key-a' } });
        expect(harness.actions.getChatSceneServiceId()).toBe('svc-a');
    });

    test('a failed save does not rotate the key', async () => {
        const harness = createActionsHarness({ commitOk: false });
        await harness.actions.selectChatService('svc-a');
        expect(harness.calls.some(call => call.url === '/api/secrets/rotate')).toBe(false);
    });

    test('other interfaces switch the main API, direct configuration forgets the chat service', async () => {
        const harness = createActionsHarness({ settings: settingsWith({ scenes: { chat: { serviceId: 'svc-a' } } }) });
        await harness.actions.selectChatService(CHAT_SCENE_OTHER);
        expect(harness.state.settings.main_api).toBe('textgenerationwebui');
        await harness.actions.selectChatService('');
        expect(harness.state.settings.main_api).toBe('openai');
        expect(readModelServices(harness.state.settings).scenes.chat.serviceId).toBe('');
    });

    test('a service used by a scene cannot be deleted; an unused one goes with its inactive key', async () => {
        const harness = createActionsHarness({ settings: settingsWith({ scenes: { chat: { serviceId: 'svc-a' }, translation: { serviceId: 'svc-d' } } }) });
        expect((await harness.actions.deleteService('svc-a')).error).toContain('正在被对话场景使用');
        expect((await harness.actions.deleteService('svc-d')).error).toContain('正在被翻译场景使用');

        // translation now follows the chat scene, so the chat service serves both
        await harness.actions.updateTranslationScene('serviceId', '');
        expect(readModelServices(harness.state.settings).scenes.translation).toMatchObject({ serviceId: '', model: '' });
        expect((await harness.actions.deleteService('svc-a')).error).toContain('对话、翻译');
        expect((await harness.actions.deleteService('svc-d')).ok).toBe(true);
        expect(readModelServices(harness.state.settings).services.map(service => service.id)).toEqual(['svc-a']);
        expect(harness.calls).toContainEqual({ url: '/api/secrets/delete', body: { key: 'api_key_deepseek', id: 'key-d' } });
    });

    test('the active key of a deleted service is kept', async () => {
        const harness = createActionsHarness({ settings: settingsWith({ services: [{ ...SERVICE_A, secretId: 'key-active' }, SERVICE_D] }) });
        expect((await harness.actions.deleteService('svc-a')).ok).toBe(true);
        expect(harness.calls.some(call => call.url === '/api/secrets/delete')).toBe(false);
    });

    test('a new key for the chat service becomes active and the old one is removed', async () => {
        const harness = createActionsHarness({ settings: settingsWith({ scenes: { chat: { serviceId: 'svc-a' } } }) });
        expect((await harness.actions.updateServiceKey('svc-a', 'sk-new')).ok).toBe(true);
        expect(harness.secretsWritten[0]).toMatchObject({ key: 'api_key_custom', activate: false });
        expect(readModelServices(harness.state.settings).services[0].secretId).toBe('key-new');
        expect(harness.calls).toContainEqual({ url: '/api/secrets/rotate', body: { key: 'api_key_custom', id: 'key-new' } });
        expect(harness.calls).toContainEqual({ url: '/api/secrets/delete', body: { key: 'api_key_custom', id: 'key-a' } });
    });

    test('changing the address of the chat service also updates the chat connection', async () => {
        const harness = createActionsHarness({ settings: settingsWith({ scenes: { chat: { serviceId: 'svc-a' } } }) });
        await harness.actions.updateServiceField('svc-a', 'baseUrl', 'https://a2.example.test/v1');
        expect(harness.state.settings.oai_settings.custom_url).toBe('https://a2.example.test/v1');
        expect((await harness.actions.updateServiceField('svc-a', 'baseUrl', 'nope')).ok).toBe(false);
        expect((await harness.actions.updateServiceField('svc-a', 'name', ' ')).ok).toBe(false);
    });

    test('the translation output limit stays within 256 and 65,536', async () => {
        const harness = createActionsHarness();
        expect((await harness.actions.updateTranslationScene('maxOutputTokens', '100')).ok).toBe(false);
        expect((await harness.actions.updateTranslationScene('maxOutputTokens', '8192')).ok).toBe(true);
        expect(readModelServices(harness.state.settings).scenes.translation.maxOutputTokens).toBe(8192);
    });

    test('the model list is read with the service key id and kept out of the settings', async () => {
        const harness = createActionsHarness();
        harness.calls.length = 0;
        const apiFetch = jest.fn(async () => ({ data: [{ id: 'b' }, { id: 'a' }, 'a'] }));
        const actions = createModelServiceActions({ state: harness.state, apiFetch, render: () => {}, showToast: () => {}, autosave: harness.autosave });
        await actions.loadServiceModels('svc-a');
        expect(apiFetch).toHaveBeenCalledWith('/api/backends/chat-completions/status', { body: { chat_completion_source: 'custom', custom_url: 'https://a.example.test/v1', secret_id: 'key-a' } });
        expect(actions.getUi().models['svc-a']).toEqual({ loading: false, items: ['a', 'b'], error: '' });
        expect(harness.commits).toHaveLength(0);
    });

    test('a failed service test explains the backend error code', () => {
        const failure = body => Object.assign(new Error('failed'), { body: JSON.stringify(body) });
        expect(describeServiceTestFailure(failure({ error: 'provider-http-error', message: 'HTTP 401', detail: 'Invalid key' }))).toBe('服务返回了错误：Invalid key');
        expect(describeServiceTestFailure(failure({ error: 'secret-missing' }))).toBe('还没有保存 API Key。');
        expect(describeServiceTestFailure(new Error('offline'))).toBe('测试失败：offline');
    });
});
