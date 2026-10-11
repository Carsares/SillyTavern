import { readFileSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import { chatCompletionSourceOptions, CONNECT_API_MAP } from '../public/modern/core/constants.js';
import { useOpenAiPresetFields } from '../public/modern/actions/openai-preset-fields.js';
import {
    applyModelToSettings,
    buildConnectionSwitcherView,
    buildProfileApplication,
    buildProfileFromCurrentConnection,
    CC_COMMANDS,
    createConnectionProfileActions,
    describeProfile,
    ensureConnectionManager,
    formatApplySummary,
    getCurrentModelTarget,
    getRecentModels,
    getSwitchBlocker,
    getSwitcherState,
    lookupConnectApi,
    readConnectionManager,
    RECENT_MODELS_LIMIT,
    RECENT_MODELS_STORAGE_KEY,
    recordRecentModel,
    resolveConnectApiKey,
    resolveSecretKey,
    suggestProfileName,
    TC_COMMANDS,
    validateProfileName,
} from '../public/modern/actions/connection-profiles.js';

// ---------------------------------------------------------------------------------------------------------------------
// 固定数据
// ---------------------------------------------------------------------------------------------------------------------

function chatSettings(overrides = {}) {
    return {
        main_api: 'openai',
        chat_completion_source: 'custom',
        oai_settings: {
            chat_completion_source: 'custom',
            custom_model: 'deepseek-v4-flash',
            custom_url: 'https://old.example/v1',
            claude_model: 'claude-old',
            preset_settings_openai: 'Default',
            openai_max_context: 32000,
            temp_openai: 1,
            reverse_proxy: '',
            proxy_password: '',
            custom_prompt_post_processing: '',
        },
        power_user: { custom_stopping_strings: '', user_prompt_bias: '' },
        proxies: [
            { name: 'None', url: '', password: '' },
            { name: 'Edge', url: 'https://proxy.example/v1', password: 'proxy-pass' },
        ],
        textgenerationwebui_settings: {
            type: 'ooba',
            server_urls: { ooba: 'http://127.0.0.1:5000', vllm: 'http://127.0.0.1:8000' },
            custom_model: 'local-old',
        },
        extension_settings: { connectionManager: { profiles: [], selectedProfile: null } },
        ...overrides,
    };
}

const presetGroups = [
    {
        id: 'openai',
        label: '聊天补全',
        names: ['Default', 'Drifting', 'Writer'],
        contents: [
            JSON.stringify({ temperature: 0.9, openai_max_tokens: 111, openai_max_context: 4095 }),
            // 带连接字段的预设：绑定连接时会把来源和模型一起改掉
            JSON.stringify({ temperature: 0.6, chat_completion_source: 'openai', openai_model: 'gpt-4.1', custom_url: 'https://preset.example/v1' }),
            JSON.stringify({ temperature: 0.5, openai_max_tokens: 777, openai_max_context: 16000 }),
        ],
    },
    { id: 'reasoning', label: '推理模板', names: ['Think'], contents: [{ name: 'Think', prefix: '<think>', suffix: '</think>', separator: '\n' }] },
];

const claudeSecrets = {
    api_key_claude: [
        { id: 'secret-1', label: 'main', value: '****', active: true },
        { id: 'secret-2', label: 'backup', value: '****', active: false },
    ],
};

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
    }
    return value;
}

const fieldsOf = items => items.map(item => item.field);

// ---------------------------------------------------------------------------------------------------------------------
// 别名表
// ---------------------------------------------------------------------------------------------------------------------

function readLegacyObjectValues(file, declaration) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const start = source.indexOf(declaration);
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('};', start));
    return [...body.matchAll(/:\s*'([^']+)'/g)].map(match => match[1]);
}

describe('CONNECT_API_MAP mirrors the legacy /api alias table', () => {
    test('has every legacy chat completion source and text completion type, in the legacy order', () => {
        const textTypes = readLegacyObjectValues('../public/scripts/textgen-settings.js', 'export const textgen_types = {');
        const chatSources = readLegacyObjectValues('../public/scripts/openai.js', 'export const chat_completion_sources = {');
        expect(textTypes.length).toBeGreaterThan(10);
        expect(chatSources.length).toBeGreaterThan(20);

        const legacyAliases = ['kobold', 'horde', 'novel', 'koboldcpp', 'kcpp', 'openai', 'oai', 'google', 'openrouter', 'openrouter-text'];
        const expectedKeys = [...new Set([...legacyAliases, ...textTypes, ...chatSources])];
        expect(Object.keys(CONNECT_API_MAP)).toEqual(expectedKeys);

        for (const type of textTypes.filter(item => item !== 'openrouter')) {
            expect(CONNECT_API_MAP[type]).toEqual({ selected: 'textgenerationwebui', type });
        }
        for (const source of chatSources) {
            expect(CONNECT_API_MAP[source]).toEqual({ selected: 'openai', source });
        }
        for (const option of chatCompletionSourceOptions) {
            expect(CONNECT_API_MAP[option.id]?.source).toBe(option.id);
        }
    });

    test('the alias keys come from setupConnectAPIMap in slash-commands.js', () => {
        const source = readFileSync(new URL('../public/scripts/slash-commands.js', import.meta.url), 'utf8');
        const start = source.indexOf('function setupConnectAPIMap()');
        const block = source.slice(start, source.indexOf('Object.assign(CONNECT_API_MAP, result);', start));
        const keys = [...block.matchAll(/^ {8}'?([\w-]+)'?: \{$/gm)].map(match => match[1]);
        expect(keys).toEqual(['kobold', 'horde', 'novel', 'koboldcpp', 'kcpp', 'openai', 'oai', 'google', 'openrouter', 'openrouter-text']);
        expect(Object.keys(CONNECT_API_MAP).slice(0, keys.length)).toEqual(keys);
    });

    test('aliases point at the right API, case-insensitively', () => {
        expect(lookupConnectApi('OAI')).toEqual({ selected: 'openai', source: 'openai' });
        expect(lookupConnectApi('google')).toEqual({ selected: 'openai', source: 'makersuite' });
        expect(lookupConnectApi('openrouter')).toEqual({ selected: 'openai', source: 'openrouter' });
        expect(lookupConnectApi('openrouter-text')).toEqual({ selected: 'textgenerationwebui', type: 'openrouter' });
        expect(lookupConnectApi('kcpp')).toEqual({ selected: 'textgenerationwebui', type: 'koboldcpp' });
        expect(lookupConnectApi('horde')).toEqual({ selected: 'koboldhorde' });
        expect(lookupConnectApi('constructor')).toBeNull();
        expect(lookupConnectApi('')).toBeNull();
    });

    test('reverse lookup returns the first matching alias like the legacy /api without arguments', () => {
        expect(resolveConnectApiKey({ mainApi: 'openai', source: 'makersuite' })).toBe('google');
        expect(resolveConnectApiKey({ mainApi: 'openai', source: 'openai' })).toBe('openai');
        expect(resolveConnectApiKey({ mainApi: 'openai', source: 'openrouter' })).toBe('openrouter');
        expect(resolveConnectApiKey({ mainApi: 'openai', source: 'custom' })).toBe('custom');
        expect(resolveConnectApiKey({ mainApi: 'textgenerationwebui', type: 'koboldcpp' })).toBe('koboldcpp');
        expect(resolveConnectApiKey({ mainApi: 'textgenerationwebui', type: 'openrouter' })).toBe('openrouter-text');
        expect(resolveConnectApiKey({ mainApi: 'textgenerationwebui', type: 'ooba' })).toBe('ooba');
        expect(resolveConnectApiKey({ mainApi: 'kobold' })).toBe('kobold');
        expect(resolveConnectApiKey({ mainApi: 'koboldhorde' })).toBe('horde');
        expect(resolveConnectApiKey({ mainApi: 'novel' })).toBe('novel');
        expect(resolveConnectApiKey({ mainApi: 'openai', source: 'nonexistent' })).toBe('');
        expect(resolveConnectApiKey({ mainApi: 'poe' })).toBe('');
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 应用档案（纯函数）
// ---------------------------------------------------------------------------------------------------------------------

describe('buildProfileApplication for chat completion profiles', () => {
    const fullProfile = {
        id: 'p-claude',
        mode: 'cc',
        name: 'Claude',
        api: 'claude',
        preset: 'Writer',
        model: 'claude-sonnet-4',
        proxy: 'Edge',
        'stop-strings': '["END","STOP"]',
        'start-reply-with': 'Sure,',
        'prompt-post-processing': 'strict',
        'secret-id': 'secret-2',
        exclude: [],
    };

    test('maps every field to its setting, in the legacy order, and does not touch the input', () => {
        const settings = deepFreeze(chatSettings());
        const result = buildProfileApplication({ settings, profile: deepFreeze(structuredClone(fullProfile)), presetGroups: deepFreeze(structuredClone(presetGroups)), secretState: deepFreeze(structuredClone(claudeSecrets)) });
        const next = result.nextSettings;

        expect(next.main_api).toBe('openai');
        expect(next.chat_completion_source).toBe('claude');
        expect(next.oai_settings.chat_completion_source).toBe('claude');
        expect(next.oai_settings.claude_model).toBe('claude-sonnet-4');
        // 预设
        expect(next.oai_settings.preset_settings_openai).toBe('Writer');
        expect(next.oai_settings.temp_openai).toBe(0.5);
        expect(next.oai_settings.openai_max_tokens).toBe(777);
        expect(next.oai_settings.openai_max_context).toBe(16000);
        // 代理预设：地址、密码和 selected_proxy 一起写入
        expect(next.oai_settings.reverse_proxy).toBe('https://proxy.example/v1');
        expect(next.oai_settings.proxy_password).toBe('proxy-pass');
        expect(next.selected_proxy).toEqual({ name: 'Edge', url: 'https://proxy.example/v1', password: 'proxy-pass' });
        expect(next.power_user.custom_stopping_strings).toBe('["END","STOP"]');
        expect(next.power_user.user_prompt_bias).toBe('Sure,');
        expect(next.oai_settings.custom_prompt_post_processing).toBe('strict');
        expect(next.extension_settings.connectionManager.selectedProfile).toBe('p-claude');

        expect(fieldsOf(result.applied)).toEqual(['api', 'preset', 'model', 'proxy', 'stop-strings', 'start-reply-with', 'prompt-post-processing', 'secret-id']);
        expect(result.skipped).toEqual([]);
        expect(result.secretRotation).toEqual({ key: 'api_key_claude', id: 'secret-2', label: 'backup' });
        // 入参是冻结的：任何写入都会抛错；这里再确认返回的是副本
        expect(next).not.toBe(settings);
        expect(settings.oai_settings.claude_model).toBe('claude-old');
        expect(settings.main_api).toBe('openai');
    });

    test('does not re-apply a preset that is already the current one, so tweaked parameters survive (legacy /preset behaviour)', () => {
        const settings = chatSettings();
        settings.oai_settings.temp_openai = 1.3;
        settings.oai_settings.openai_max_context = 32000;
        const result = buildProfileApplication({ settings, profile: { id: 'p', mode: 'cc', api: 'custom', preset: 'Default', model: 'm' }, presetGroups });

        // 预设 Default 里是 0.9 / 4095，当前设置是用户调过的 1.3 / 32000：保持不变
        expect(result.nextSettings.oai_settings.temp_openai).toBe(1.3);
        expect(result.nextSettings.oai_settings.openai_max_context).toBe(32000);
        expect(result.nextSettings.oai_settings.preset_settings_openai).toBe('Default');
        expect(result.applied.find(item => item.field === 'preset').value).toContain('已是当前预设');
        expect(result.skipped).toEqual([]);

        // 换成另一个预设时才套用它的值
        const other = buildProfileApplication({ settings, profile: { id: 'p', mode: 'cc', preset: 'Writer' }, presetGroups });
        expect(other.nextSettings.oai_settings.temp_openai).toBe(0.5);
        expect(other.nextSettings.oai_settings.openai_max_context).toBe(16000);

        // 当前预设相同但名称写法不同（旧版会模糊匹配的情形）不算同一个预设：精确匹配失败，跳过
        const different = buildProfileApplication({ settings, profile: { id: 'p', mode: 'cc', preset: 'default' }, presetGroups });
        expect(different.skipped[0]).toMatchObject({ field: 'preset' });
    });

    test('lists the applied values without leaking the proxy password or the secret id', () => {
        const result = buildProfileApplication({ settings: chatSettings(), profile: fullProfile, presetGroups, secretState: claudeSecrets });
        const text = JSON.stringify(result.applied);
        expect(text).not.toContain('proxy-pass');
        expect(text).not.toContain('secret-2');
        expect(result.applied.find(item => item.field === 'secret-id').value).toBe('backup');
        expect(result.applied.find(item => item.field === 'proxy').value).toBe('Edge');
    });

    test('a preset that rewrites the source is overridden by the second api step, while the profile model still wins', () => {
        const settings = chatSettings({ chat_completion_source: 'custom' });
        const result = buildProfileApplication({
            settings,
            profile: { id: 'p', mode: 'cc', api: 'custom', preset: 'Drifting', model: 'my-model', 'api-url': 'https://api.example/v1' },
            presetGroups,
        });
        const oai = result.nextSettings.oai_settings;

        // 预设把来源改成了 openai、把地址改成了 preset.example，档案里的 api / api-url / model 随后写回
        expect(oai.chat_completion_source).toBe('custom');
        expect(result.nextSettings.chat_completion_source).toBe('custom');
        expect(oai.custom_url).toBe('https://api.example/v1');
        expect(oai.custom_model).toBe('my-model');
        // 预设自己带来的其他字段保留，旧版同样会留下 openai_model
        expect(oai.openai_model).toBe('gpt-4.1');
        expect(oai.temp_openai).toBe(0.6);
        expect(fieldsOf(result.applied)).toEqual(['api', 'preset', 'api-url', 'model']);
    });

    test('treats a missing bind_preset_to_connection as on (legacy default), and leaves the connection alone when it is off', () => {
        const bound = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'cc', preset: 'Drifting' }, presetGroups });
        expect(bound.nextSettings.oai_settings.chat_completion_source).toBe('openai');

        const unbound = chatSettings();
        unbound.oai_settings.bind_preset_to_connection = false;
        const result = buildProfileApplication({ settings: unbound, profile: { id: 'p', mode: 'cc', preset: 'Drifting' }, presetGroups });
        expect(result.nextSettings.oai_settings.chat_completion_source).toBe('custom');
        expect(result.nextSettings.oai_settings.temp_openai).toBe(0.6);

        // 没有后续 api 步骤时，顶层的来源字段也跟着预设同步，界面读到的和引擎用的一致
        expect(bound.nextSettings.chat_completion_source).toBe('openai');
    });

    test('skips presets and proxies that do not exist by exact name, and keeps applying the rest', () => {
        const settings = chatSettings();
        const result = buildProfileApplication({
            settings,
            profile: { id: 'p', mode: 'cc', api: 'custom', preset: 'default', model: 'm', proxy: 'edge' },
            presetGroups,
        });

        // 旧版会把 "default" 模糊匹配到 "Default"、把 "edge" 匹配到 "Edge"，这里只接受完全相同的名称
        expect(fieldsOf(result.skipped)).toEqual(['preset', 'proxy']);
        expect(result.skipped[0]).toMatchObject({ label: '预设', reason: expect.stringContaining('“default”不存在') });
        expect(result.skipped[0].reason).toContain('精确');
        expect(result.skipped[1].reason).toContain('“edge”不存在');
        expect(result.nextSettings.oai_settings.preset_settings_openai).toBe('Default');
        expect(result.nextSettings.oai_settings.reverse_proxy).toBe('');
        expect(fieldsOf(result.applied)).toEqual(['api', 'model']);
        expect(result.nextSettings.oai_settings.custom_model).toBe('m');
    });

    test('skips the preset when the preset list was not read, and when its content cannot be parsed', () => {
        const noList = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'cc', preset: 'Default' }, presetGroups: [] });
        expect(noList.skipped[0].reason).toContain('没有读取到');

        const broken = buildProfileApplication({
            settings: chatSettings(),
            profile: { id: 'p', mode: 'cc', preset: 'Other' },
            presetGroups: [{ id: 'openai', names: ['Other'], contents: ['{not json'] }],
        });
        expect(broken.skipped[0].reason).toContain('无法读取');
    });

    test('the built-in None proxy exists even when the settings never saved a proxy list', () => {
        const settings = chatSettings();
        delete settings.proxies;
        settings.oai_settings.reverse_proxy = 'https://old.proxy/v1';
        const result = buildProfileApplication({ settings, profile: { id: 'p', mode: 'cc', proxy: 'None' } });
        expect(result.nextSettings.oai_settings.reverse_proxy).toBe('');
        expect(result.skipped).toEqual([]);
    });

    test('honors exclude[]: excluded fields are neither applied nor reported as skipped', () => {
        const settings = chatSettings();
        const result = buildProfileApplication({
            settings,
            profile: { ...fullProfile, exclude: ['model', 'proxy', 'secret-id'] },
            presetGroups,
            secretState: claudeSecrets,
        });

        expect(fieldsOf(result.applied)).toEqual(['api', 'preset', 'stop-strings', 'start-reply-with', 'prompt-post-processing']);
        expect(result.skipped).toEqual([]);
        expect(result.excluded).toEqual(['model', 'proxy', 'secret-id']);
        expect(result.secretRotation).toBeNull();
        expect(result.nextSettings.oai_settings.claude_model).toBe('claude-old');
        expect(result.nextSettings.oai_settings.reverse_proxy).toBe('');
    });

    test('stop strings and the reply prefix may be empty, which clears them', () => {
        const settings = chatSettings();
        settings.power_user.custom_stopping_strings = '["old"]';
        settings.power_user.user_prompt_bias = 'old prefix';
        const result = buildProfileApplication({ settings, profile: { id: 'p', mode: 'cc', 'stop-strings': '', 'start-reply-with': '' } });

        expect(result.nextSettings.power_user.custom_stopping_strings).toBe('[]');
        expect(result.nextSettings.power_user.user_prompt_bias).toBe('');
        expect(result.applied).toEqual([
            { field: 'stop-strings', label: '自定义停止字符串', value: '清空' },
            { field: 'start-reply-with', label: '回复前缀', value: '清空' },
        ]);
    });

    test('other empty or missing fields are not applied at all', () => {
        const result = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'cc', api: '', model: '', preset: undefined, 'api-url': null, proxy: '' } });
        expect(result.applied).toEqual([]);
        expect(result.skipped).toEqual([]);
    });

    test('rejects stop strings that are not a JSON string array, and normalises the items to strings', () => {
        const base = chatSettings();
        const text = buildProfileApplication({ settings: base, profile: { id: 'p', mode: 'cc', 'stop-strings': 'END' } });
        expect(text.skipped[0]).toMatchObject({ field: 'stop-strings' });
        expect(text.nextSettings.power_user.custom_stopping_strings).toBe('');

        const object = buildProfileApplication({ settings: base, profile: { id: 'p', mode: 'cc', 'stop-strings': '{"a":1}' } });
        expect(object.skipped[0]).toMatchObject({ field: 'stop-strings' });

        const mixed = buildProfileApplication({ settings: base, profile: { id: 'p', mode: 'cc', 'stop-strings': '["a",1,true]' } });
        expect(mixed.nextSettings.power_user.custom_stopping_strings).toBe('["a","1","true"]');
        expect(mixed.applied[0].value).toBe('3 条');
    });

    test('prompt post-processing accepts the legacy values and maps none to an empty string', () => {
        const none = buildProfileApplication({ settings: { ...chatSettings(), oai_settings: { custom_prompt_post_processing: 'strict' } }, profile: { id: 'p', mode: 'cc', 'prompt-post-processing': 'None' } });
        expect(none.nextSettings.oai_settings.custom_prompt_post_processing).toBe('');
        expect(none.applied[0].value).toBe('无');

        const merge = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'cc', 'prompt-post-processing': 'MERGE_TOOLS' } });
        expect(merge.nextSettings.oai_settings.custom_prompt_post_processing).toBe('merge_tools');

        const invalid = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'cc', 'prompt-post-processing': 'fancy' } });
        expect(invalid.skipped[0]).toMatchObject({ field: 'prompt-post-processing' });
        expect(invalid.nextSettings.oai_settings.custom_prompt_post_processing).toBe('');
    });

    test('api-url depends on the source: custom URL, fixed choices, region, and nothing for the rest', () => {
        const custom = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'cc', api: 'custom', 'api-url': 'https://api.example/v1?key=abc' } });
        expect(custom.nextSettings.oai_settings.custom_url).toBe('https://api.example/v1?key=abc');
        expect(custom.applied.find(item => item.field === 'api-url').value).toBe('https://api.example/v1');

        const zai = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'cc', api: 'zai', 'api-url': 'coding' } });
        expect(zai.nextSettings.oai_settings.zai_endpoint).toBe('coding');
        const badZai = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'cc', api: 'zai', 'api-url': 'https://x' } });
        expect(badZai.skipped[0].reason).toContain('common、coding');
        expect(badZai.nextSettings.oai_settings.zai_endpoint).toBeUndefined();

        const siliconflow = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'cc', api: 'siliconflow', 'api-url': 'cn' } });
        expect(siliconflow.nextSettings.oai_settings.siliconflow_endpoint).toBe('cn');
        const minimax = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'cc', api: 'minimax', 'api-url': 'global' } });
        expect(minimax.nextSettings.oai_settings.minimax_endpoint).toBe('global');
        const vertex = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'cc', api: 'vertexai', 'api-url': 'europe-west4' } });
        expect(vertex.nextSettings.oai_settings.vertexai_region).toBe('europe-west4');

        const claude = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'cc', api: 'claude', 'api-url': 'https://api.anthropic.com' } });
        expect(claude.skipped).toEqual([expect.objectContaining({ field: 'api-url', reason: expect.stringContaining('claude') })]);
    });

    test('an alias selects the right source and model field', () => {
        const google = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'cc', api: 'Google', model: 'gemini-2.5-pro' } });
        expect(google.nextSettings.oai_settings.chat_completion_source).toBe('makersuite');
        expect(google.nextSettings.oai_settings.google_model).toBe('gemini-2.5-pro');

        const openrouter = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'cc', api: 'openrouter', model: 'openai/gpt-4.1' } });
        expect(openrouter.nextSettings.main_api).toBe('openai');
        expect(openrouter.nextSettings.oai_settings.openrouter_model).toBe('openai/gpt-4.1');
        expect(openrouter.applied[0].value).toBe('OpenRouter（openrouter）');
    });

    test('an unknown api is skipped and so is everything that depends on it, but independent fields still apply', () => {
        const settings = chatSettings();
        const result = buildProfileApplication({
            settings,
            profile: { id: 'p', mode: 'cc', api: 'nonsense', preset: 'Default', model: 'x', 'api-url': 'https://x', proxy: 'Edge', 'stop-strings': '["a"]', 'secret-id': 'secret-1' },
            presetGroups,
            secretState: claudeSecrets,
        });

        expect(fieldsOf(result.skipped)).toEqual(['api', 'preset', 'api-url', 'model', 'proxy', 'secret-id']);
        expect(result.skipped[0].reason).toContain('nonsense');
        expect(result.skipped[1].reason).toContain('依赖');
        expect(fieldsOf(result.applied)).toEqual(['stop-strings']);
        expect(result.nextSettings.oai_settings.custom_model).toBe('deepseek-v4-flash');
        expect(result.nextSettings.oai_settings.preset_settings_openai).toBe('Default');
    });

    test('reasoning template and regex preset are reported as skipped with a reason', () => {
        const result = buildProfileApplication({
            settings: chatSettings(),
            profile: { id: 'p', mode: 'cc', 'reasoning-template': 'Think', 'regex-preset': 'abc' },
            presetGroups,
        });
        expect(result.applied).toEqual([]);
        expect(result.skipped).toEqual([
            { field: 'reasoning-template', label: '推理模板', reason: expect.stringContaining('推理') },
            { field: 'regex-preset', label: '正则预设', reason: expect.stringContaining('暂不支持') },
        ]);
        expect(result.nextSettings.power_user.reasoning).toBeUndefined();
    });

    test('a profile without a recognised mode follows the text completion order, like the legacy extension', () => {
        expect(CC_COMMANDS.filter(command => command === 'api')).toHaveLength(2);
        expect(CC_COMMANDS.indexOf('preset')).toBeLessThan(CC_COMMANDS.lastIndexOf('api'));
        const result = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', api: 'ooba', 'prompt-post-processing': 'strict' } });
        // prompt-post-processing 只在聊天补全档案里按序执行
        expect(result.applied.map(item => item.field)).toEqual(['api']);
    });
});

describe('buildProfileApplication for secrets', () => {
    const profile = { id: 'p', mode: 'cc', api: 'claude', 'secret-id': 'secret-2' };

    test('returns the rotate request only when another secret has to become active', () => {
        const result = buildProfileApplication({ settings: chatSettings(), profile, secretState: claudeSecrets });
        expect(result.secretRotation).toEqual({ key: 'api_key_claude', id: 'secret-2', label: 'backup' });

        const alreadyActive = buildProfileApplication({ settings: chatSettings(), profile: { ...profile, 'secret-id': 'secret-1' }, secretState: claudeSecrets });
        expect(alreadyActive.secretRotation).toBeNull();
        expect(alreadyActive.applied.find(item => item.field === 'secret-id').value).toContain('已是当前');
    });

    test('finds a secret by its label when the id is gone, like the legacy command', () => {
        const result = buildProfileApplication({ settings: chatSettings(), profile: { ...profile, 'secret-id': 'backup' }, secretState: claudeSecrets });
        expect(result.secretRotation).toMatchObject({ id: 'secret-2' });
    });

    test('skips with a reason when the secret was deleted or the source has no secrets', () => {
        const gone = buildProfileApplication({ settings: chatSettings(), profile: { ...profile, 'secret-id': 'secret-9' }, secretState: claudeSecrets });
        expect(gone.secretRotation).toBeNull();
        expect(gone.skipped[0]).toMatchObject({ field: 'secret-id', reason: expect.stringContaining('已被删除') });

        const none = buildProfileApplication({ settings: chatSettings(), profile, secretState: {} });
        expect(none.skipped[0].reason).toContain('api_key_claude');

        const kobold = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'tc', api: 'kobold', 'secret-id': 'x' }, secretState: claudeSecrets });
        expect(kobold.skipped[0].reason).toContain('没有可切换的密钥');
    });

    test('without secret state the request is passed through unchecked', () => {
        const result = buildProfileApplication({ settings: chatSettings(), profile });
        expect(result.secretRotation).toEqual({ key: 'api_key_claude', id: 'secret-2', label: '' });
    });

    test('resolves the secret key for every API family', () => {
        expect(resolveSecretKey(chatSettings())).toBe('api_key_custom');
        expect(resolveSecretKey({ main_api: 'openai', chat_completion_source: 'vertexai', oai_settings: { vertexai_auth_mode: 'full' } })).toBe('vertexai_service_account_json');
        expect(resolveSecretKey({ main_api: 'openai', chat_completion_source: 'vertexai', oai_settings: { vertexai_auth_mode: 'express' } })).toBe('api_key_vertexai');
        expect(resolveSecretKey({ main_api: 'textgenerationwebui', textgenerationwebui_settings: { type: 'koboldcpp' } })).toBe('api_key_koboldcpp');
        expect(resolveSecretKey({ main_api: 'textgenerationwebui', textgenerationwebui_settings: { type: 'ollama' } })).toBe('');
        expect(resolveSecretKey({ main_api: 'novel' })).toBe('api_key_novel');
        expect(resolveSecretKey({ main_api: 'koboldhorde' })).toBe('api_key_horde');
        expect(resolveSecretKey({ main_api: 'kobold' })).toBe('');
    });
});

describe('buildProfileApplication for text completion profiles', () => {
    const profile = {
        id: 'p-ooba',
        mode: 'tc',
        api: 'ooba',
        preset: 'Min P',
        'api-url': 'http://localhost:5001',
        model: 'local-model',
        sysprompt: 'Roleplay',
        'sysprompt-state': 'true',
        instruct: 'ChatML',
        context: 'ChatML',
        'instruct-state': 'true',
        tokenizer: 'best_match',
        'stop-strings': '',
        'start-reply-with': '',
        'reasoning-template': 'Think',
        'regex-preset': 'abc',
    };

    test('applies the type, the server URL and the model, and lists everything else as skipped with a reason', () => {
        const settings = deepFreeze(chatSettings());
        const result = buildProfileApplication({ settings, profile, presetGroups });
        const next = result.nextSettings;

        expect(next.main_api).toBe('textgenerationwebui');
        expect(next.textgenerationwebui_settings.type).toBe('ooba');
        expect(next.textgenerationwebui_settings.server_urls).toEqual({ ooba: 'http://localhost:5001', vllm: 'http://127.0.0.1:8000' });
        expect(next.textgenerationwebui_settings.custom_model).toBe('local-model');
        expect(next.power_user.custom_stopping_strings).toBe('[]');
        expect(fieldsOf(result.applied)).toEqual(['api', 'api-url', 'model', 'stop-strings', 'start-reply-with']);
        // TC_COMMANDS 的顺序
        expect(fieldsOf(result.skipped)).toEqual(['preset', 'sysprompt', 'sysprompt-state', 'instruct', 'context', 'instruct-state', 'tokenizer', 'reasoning-template', 'regex-preset']);
        expect(result.skipped.every(item => item.reason.length > 4)).toBe(true);
        expect(result.skipped[0].reason).toContain('文本补全预设');
        // 聊天补全的设置原样保留
        expect(next.oai_settings).toEqual(settings.oai_settings);
        expect(TC_COMMANDS.indexOf('api-url')).toBeLessThan(TC_COMMANDS.indexOf('model'));
    });

    test('types without a server URL input skip the URL, and types without a model field skip the model', () => {
        const openrouter = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'tc', api: 'openrouter-text', 'api-url': 'https://x', model: 'm' } });
        expect(openrouter.nextSettings.textgenerationwebui_settings.type).toBe('openrouter');
        expect(openrouter.nextSettings.textgenerationwebui_settings.openrouter_model).toBe('m');
        expect(openrouter.skipped).toEqual([expect.objectContaining({ field: 'api-url', reason: expect.stringContaining('固定') })]);

        const koboldcpp = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'tc', api: 'kcpp', 'api-url': 'http://127.0.0.1:5001', model: 'm' } });
        expect(koboldcpp.nextSettings.textgenerationwebui_settings.type).toBe('koboldcpp');
        expect(koboldcpp.nextSettings.textgenerationwebui_settings.server_urls.koboldcpp).toBe('http://127.0.0.1:5001');
        expect(koboldcpp.skipped).toEqual([expect.objectContaining({ field: 'model', reason: expect.stringContaining('没有模型字段') })]);
    });

    test('Kobold Classic takes only its server URL; NovelAI and Horde take only the API switch', () => {
        const kobold = buildProfileApplication({ settings: { ...chatSettings(), kai_settings: { api_server: 'http://old:5000' } }, profile: { id: 'p', mode: 'tc', api: 'kobold', 'api-url': 'http://127.0.0.1:5000', model: 'x' } });
        expect(kobold.nextSettings.main_api).toBe('kobold');
        expect(kobold.nextSettings.api_server).toBe('http://127.0.0.1:5000');
        expect(kobold.nextSettings.kai_settings.api_server).toBe('http://127.0.0.1:5000');
        expect(fieldsOf(kobold.skipped)).toEqual(['model']);

        const horde = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'tc', api: 'horde' } });
        expect(horde.nextSettings.main_api).toBe('koboldhorde');
        const novel = buildProfileApplication({ settings: chatSettings(), profile: { id: 'p', mode: 'tc', api: 'novel' } });
        expect(novel.nextSettings.main_api).toBe('novel');
    });

    test('switching from text completion back to a chat completion profile restores the chat source', () => {
        const settings = chatSettings({ main_api: 'textgenerationwebui' });
        const result = buildProfileApplication({ settings, profile: { id: 'p', mode: 'cc', api: 'custom', model: 'm' } });
        expect(result.nextSettings.main_api).toBe('openai');
        expect(result.nextSettings.oai_settings.custom_model).toBe('m');
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 从当前连接创建档案
// ---------------------------------------------------------------------------------------------------------------------

describe('buildProfileFromCurrentConnection', () => {
    const customSecrets = { api_key_custom: [{ id: 'cs-1', label: 'main', value: '****', active: true }, { id: 'cs-2', label: 'spare', value: '****', active: false }] };

    function chatConnection() {
        const settings = chatSettings();
        settings.selected_proxy = { name: 'Edge', url: 'https://proxy.example/v1', password: 'proxy-pass' };
        settings.oai_settings.reverse_proxy = 'https://proxy.example/v1';
        settings.oai_settings.custom_prompt_post_processing = 'single';
        settings.power_user.custom_stopping_strings = '["x"]';
        settings.power_user.user_prompt_bias = 'Ok.';
        return settings;
    }

    test('records the chat completion connection with a uuid id and the legacy fields', () => {
        const profile = buildProfileFromCurrentConnection(chatConnection(), { name: 'Mine', secretState: customSecrets });

        expect(profile.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(profile).toMatchObject({
            mode: 'cc',
            name: 'Mine',
            api: 'custom',
            preset: 'Default',
            model: 'deepseek-v4-flash',
            'api-url': 'https://old.example/v1',
            proxy: 'Edge',
            'stop-strings': '["x"]',
            'start-reply-with': 'Ok.',
            'prompt-post-processing': 'single',
            'secret-id': 'cs-1',
            exclude: [],
        });
        // 密钥只记 id，不带明文，也不带代理密码
        expect(JSON.stringify(profile)).not.toContain('proxy-pass');
        expect(JSON.stringify(profile)).not.toContain('****');
        // 不记录 Modern 现在不会应用的字段
        expect(Object.keys(profile)).not.toEqual(expect.arrayContaining(['reasoning-template', 'regex-preset']));
    });

    test('uses none for an empty post-processing, and omits empty or unset values', () => {
        const settings = chatSettings();
        settings.oai_settings.preset_settings_openai = '';
        delete settings.power_user;
        const profile = buildProfileFromCurrentConnection(settings);
        expect(profile['prompt-post-processing']).toBe('none');
        expect(profile).not.toHaveProperty('preset');
        expect(profile).not.toHaveProperty('proxy');
        expect(profile).not.toHaveProperty('stop-strings');
        expect(profile).not.toHaveProperty('start-reply-with');
        expect(profile).not.toHaveProperty('secret-id');
    });

    test('records the text completion connection without a preset or chat-only fields', () => {
        const settings = chatSettings({ main_api: 'textgenerationwebui' });
        settings.textgenerationwebui_settings.preset = 'Min P';
        const profile = buildProfileFromCurrentConnection(settings, { name: 'Local', secretState: { api_key_ooba: [{ id: 'o-1', active: true }] } });
        expect(profile).toMatchObject({ mode: 'tc', api: 'ooba', model: 'local-old', 'api-url': 'http://127.0.0.1:5000', 'secret-id': 'o-1' });
        expect(profile).not.toHaveProperty('preset');
        expect(profile).not.toHaveProperty('prompt-post-processing');
        expect(profile).not.toHaveProperty('proxy');
    });

    test('records Kobold Classic with its server URL and mode tc', () => {
        const profile = buildProfileFromCurrentConnection({ main_api: 'kobold', api_server: 'http://127.0.0.1:5000' });
        expect(profile).toMatchObject({ mode: 'tc', api: 'kobold', 'api-url': 'http://127.0.0.1:5000' });
    });

    test('a connection the alias table cannot name produces a profile without api', () => {
        expect(buildProfileFromCurrentConnection({ main_api: 'poe' })).not.toHaveProperty('api');
    });

    test('applying a profile built from one connection restores that connection on another', () => {
        const source = chatConnection();
        source.oai_settings.max_context_unlocked = false;
        const profile = buildProfileFromCurrentConnection(source, { name: 'Mine', secretState: customSecrets });

        const other = chatSettings({ main_api: 'textgenerationwebui', chat_completion_source: 'claude' });
        other.oai_settings.chat_completion_source = 'claude';
        other.oai_settings.custom_model = 'other-model';
        other.oai_settings.custom_url = 'https://other.example/v1';
        other.oai_settings.preset_settings_openai = 'Drifting';
        other.power_user = { custom_stopping_strings: '["other"]', user_prompt_bias: 'Other' };
        const result = buildProfileApplication({ settings: other, profile, presetGroups, secretState: customSecrets });
        const next = result.nextSettings;

        expect(result.skipped).toEqual([]);
        expect(next.main_api).toBe('openai');
        expect(next.oai_settings.chat_completion_source).toBe('custom');
        expect(next.chat_completion_source).toBe('custom');
        expect(next.oai_settings.custom_model).toBe('deepseek-v4-flash');
        expect(next.oai_settings.custom_url).toBe('https://old.example/v1');
        expect(next.oai_settings.preset_settings_openai).toBe('Default');
        expect(next.oai_settings.reverse_proxy).toBe('https://proxy.example/v1');
        expect(next.power_user).toEqual({ custom_stopping_strings: '["x"]', user_prompt_bias: 'Ok.' });
        expect(next.oai_settings.custom_prompt_post_processing).toBe('single');
        expect(result.secretRotation).toBeNull(); // cs-1 本来就是当前密钥
    });
});

describe('profile names', () => {
    const profiles = [{ id: 'a', name: 'Existing' }];

    test('validates the name', () => {
        expect(validateProfileName('  New   name ', profiles)).toEqual({ ok: true, name: 'New name' });
        expect(validateProfileName('   ', profiles)).toMatchObject({ ok: false, error: expect.stringContaining('名称') });
        expect(validateProfileName('Existing', profiles)).toMatchObject({ ok: false, error: expect.stringContaining('已经有') });
        expect(validateProfileName('<None>', profiles)).toMatchObject({ ok: false });
        expect(validateProfileName('x'.repeat(81), profiles)).toMatchObject({ ok: false });
    });

    test('suggests api, model and preset, and adds a counter when the name is taken', () => {
        expect(suggestProfileName(chatSettings(), [])).toBe('custom deepseek-v4-flash - Default');
        expect(suggestProfileName(chatSettings(), [{ name: 'custom deepseek-v4-flash - Default' }, { name: 'custom deepseek-v4-flash - Default (2)' }])).toBe('custom deepseek-v4-flash - Default (3)');
        expect(suggestProfileName({}, [])).toBe('新连接档案');
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 概要、模型、最近模型
// ---------------------------------------------------------------------------------------------------------------------

describe('summaries', () => {
    test('formats the applied and skipped counts and folds long reason lists', () => {
        expect(formatApplySummary({ applied: [1, 2, 3], skipped: [] })).toBe('已应用 3 项');
        const text = formatApplySummary({
            applied: [1],
            skipped: [{ label: '预设', reason: 'a' }, { label: '代理预设', reason: 'b' }],
        });
        expect(text).toBe('已应用 1 项，跳过 2 项（预设：a；代理预设：b）');
        const many = formatApplySummary({ applied: [], skipped: ['a', 'b', 'c', 'd', 'e'].map(label => ({ label, reason: 'r' })) });
        expect(many).toContain('跳过 5 项');
        expect(many).toContain('另有 2 项见详情');
        expect(many).not.toContain('d：');
    });

    test('describes a profile for lists', () => {
        const view = describeProfile({ id: 'x', name: 'Claude 日常', mode: 'cc', api: 'claude', model: 'claude-sonnet-4', preset: 'Default', 'api-url': 'https://h.example/v1?key=abc', exclude: ['proxy'] });
        expect(view).toMatchObject({
            id: 'x',
            name: 'Claude 日常',
            modeLabel: '聊天补全',
            sourceLabel: 'Claude',
            model: 'claude-sonnet-4',
            preset: 'Default',
            endpoint: 'https://h.example/v1',
            summary: 'Claude · claude-sonnet-4 · 预设 Default',
            excludedLabels: ['代理预设'],
        });
        expect(describeProfile({ id: 'y', mode: 'tc', api: 'kcpp', model: 'm' })).toMatchObject({ modeLabel: '文本补全', sourceLabel: 'KoboldCpp', summary: 'KoboldCpp · m' });
        expect(describeProfile({ id: 'z', mode: 'cc', api: 'mystery' }).sourceLabel).toBe('mystery');
    });

    test('reads the connection manager defensively and creates its default shape on demand', () => {
        expect(readConnectionManager({})).toEqual({ profiles: [], selectedProfile: '' });
        expect(readConnectionManager({ extension_settings: { connectionManager: { profiles: 'nope', selectedProfile: null } } })).toEqual({ profiles: [], selectedProfile: '' });
        expect(readConnectionManager({ extension_settings: { connectionManager: { profiles: [{ id: 'a' }, null, 5], selectedProfile: 'a' } } })).toEqual({ profiles: [{ id: 'a' }], selectedProfile: 'a' });
        const settings = {};
        expect(ensureConnectionManager(settings)).toEqual({ profiles: [], selectedProfile: null });
        expect(settings.extension_settings.connectionManager).toBe(ensureConnectionManager(settings));
    });
});

describe('quick model switch', () => {
    test('finds the model field of the current API', () => {
        expect(getCurrentModelTarget(chatSettings())).toEqual({ mainApi: 'openai', source: 'custom', field: 'custom_model', model: 'deepseek-v4-flash' });
        expect(getCurrentModelTarget(chatSettings({ main_api: 'textgenerationwebui' }))).toEqual({ mainApi: 'textgenerationwebui', source: 'ooba', field: 'custom_model', model: 'local-old' });
        expect(getCurrentModelTarget({ main_api: 'kobold' })).toBeNull();
        expect(getCurrentModelTarget({ main_api: 'textgenerationwebui', textgenerationwebui_settings: { type: 'koboldcpp' } })).toBeNull();
        expect(getCurrentModelTarget({ main_api: 'openai' })).toBeNull();
    });

    test('writes the model into a copy of the settings', () => {
        const settings = deepFreeze(chatSettings());
        const change = applyModelToSettings(settings, ' new-model ');
        expect(change.nextSettings.oai_settings.custom_model).toBe('new-model');
        expect(change.unchanged).toBe(false);
        expect(settings.oai_settings.custom_model).toBe('deepseek-v4-flash');

        expect(applyModelToSettings(settings, 'deepseek-v4-flash').unchanged).toBe(true);
        const text = applyModelToSettings(chatSettings({ main_api: 'textgenerationwebui' }), 'tg-model');
        expect(text.nextSettings.textgenerationwebui_settings.custom_model).toBe('tg-model');
    });

    test('refuses an empty model and an API without a model field', () => {
        expect(() => applyModelToSettings(chatSettings(), '  ')).toThrow('模型不能为空');
        expect(() => applyModelToSettings({ main_api: 'novel' }, 'x')).toThrow('暂不支持');
    });
});

describe('recent models', () => {
    function fakeStorage(initial = {}) {
        const data = { ...initial };
        return {
            data,
            getItem: key => (key in data ? data[key] : null),
            setItem: (key, value) => { data[key] = value; },
        };
    }

    test('moves the used model to the front, de-duplicates, and keeps five per source', () => {
        const storage = fakeStorage();
        for (const model of ['a', 'b', 'c', 'a', 'd', 'e', 'f']) {
            recordRecentModel('openai', 'custom', model, storage);
        }
        expect(getRecentModels('openai', 'custom', storage)).toEqual(['f', 'e', 'd', 'a', 'c']);
        expect(getRecentModels('openai', 'custom', storage)).toHaveLength(RECENT_MODELS_LIMIT);
        expect(recordRecentModel('openai', 'custom', 'c', storage)).toEqual(['c', 'f', 'e', 'd', 'a']);
        expect(JSON.parse(storage.data[RECENT_MODELS_STORAGE_KEY])).toEqual({ 'openai:custom': ['c', 'f', 'e', 'd', 'a'] });
    });

    test('keeps every API and source apart', () => {
        const storage = fakeStorage();
        recordRecentModel('openai', 'custom', 'm1', storage);
        recordRecentModel('openai', 'claude', 'm2', storage);
        recordRecentModel('textgenerationwebui', 'ooba', 'm3', storage);
        expect(getRecentModels('openai', 'custom', storage)).toEqual(['m1']);
        expect(getRecentModels('openai', 'claude', storage)).toEqual(['m2']);
        expect(getRecentModels('textgenerationwebui', 'ooba', storage)).toEqual(['m3']);
        expect(getRecentModels('openai', 'openrouter', storage)).toEqual([]);
    });

    test('ignores blank input, corrupt storage, a missing storage, and write failures', () => {
        const storage = fakeStorage();
        expect(recordRecentModel('openai', 'custom', '  ', storage)).toEqual([]);
        expect(recordRecentModel('', 'custom', 'x', storage)).toEqual([]);
        expect(storage.data).toEqual({});

        const corrupt = fakeStorage({ [RECENT_MODELS_STORAGE_KEY]: '{oops' });
        expect(getRecentModels('openai', 'custom', corrupt)).toEqual([]);
        expect(recordRecentModel('openai', 'custom', 'ok', corrupt)).toEqual(['ok']);

        const wrongShape = fakeStorage({ [RECENT_MODELS_STORAGE_KEY]: JSON.stringify({ 'openai:custom': 'nope', 'openai:claude': ['a', 3, '', 'b'] }) });
        expect(getRecentModels('openai', 'custom', wrongShape)).toEqual([]);
        expect(getRecentModels('openai', 'claude', wrongShape)).toEqual(['a', 'b']);

        expect(getRecentModels('openai', 'custom', null)).toEqual([]);
        expect(recordRecentModel('openai', 'custom', 'x', null)).toEqual(['x']);
        const broken = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
        expect(recordRecentModel('openai', 'custom', 'x', broken)).toEqual(['x']);
    });

    test('the switcher view lists the current model first and marks it', () => {
        const storage = fakeStorage();
        recordRecentModel('openai', 'custom', 'older', storage);
        recordRecentModel('openai', 'custom', 'newer', storage);
        const settings = chatSettings();
        settings.extension_settings.connectionManager = { profiles: [{ id: 'a', name: 'A', mode: 'cc', api: 'claude', model: 'm' }], selectedProfile: 'a' };
        const view = buildConnectionSwitcherView({ settings, storage });

        expect(view.models).toEqual({
            supported: true,
            sourceLabel: 'Custom OpenAI-compatible',
            items: [
                { model: 'deepseek-v4-flash', current: true },
                { model: 'newer', current: false },
                { model: 'older', current: false },
            ],
        });
        expect(view.profiles).toEqual([expect.objectContaining({ id: 'a', current: true, name: 'A' })]);
        expect(buildConnectionSwitcherView({ settings: { main_api: 'novel' }, storage }).models).toEqual({ supported: false, sourceLabel: '', items: [] });
    });
});

describe('the preset field helper', () => {
    test('keeps its old default for connection fields and accepts an explicit override', () => {
        const preset = { temperature: 0.4, chat_completion_source: 'claude', claude_model: 'c' };
        const unbound = {};
        useOpenAiPresetFields(unbound, preset);
        expect(unbound).toEqual({ temp_openai: 0.4 });

        const bound = {};
        useOpenAiPresetFields(bound, preset, { bindToConnection: true });
        expect(bound).toEqual({ temp_openai: 0.4, chat_completion_source: 'claude', claude_model: 'c' });

        const forcedOff = { bind_preset_to_connection: true };
        useOpenAiPresetFields(forcedOff, preset, { bindToConnection: false });
        expect(forcedOff.chat_completion_source).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 动作
// ---------------------------------------------------------------------------------------------------------------------

function createActionFixture({ settings = chatSettings(), secretState = claudeSecrets, generating = false, saveError = null, reloadResult = { ok: true } } = {}) {
    const events = [];
    const storageData = {};
    const storage = {
        getItem: key => (key in storageData ? storageData[key] : null),
        setItem: (key, value) => { storageData[key] = value; },
    };
    const state = {
        settings: structuredClone(settings),
        secretState: structuredClone(secretState),
        engine: { generating },
        apiMainDraft: 'textgenerationwebui',
        connectionSwitcher: {},
    };
    const saved = [];
    const rotations = [];
    const toasts = [];
    const apiFetch = jest.fn(async (path, options = {}) => {
        if (path === '/api/settings/save') {
            events.push('save');
            if (saveError) {
                throw new Error(saveError);
            }
            saved.push(structuredClone(options.body));
            return { ok: true };
        }
        if (path === '/api/secrets/rotate') {
            events.push('rotate');
            rotations.push(options.body);
            return null;
        }
        throw new Error(`unexpected request ${path}`);
    });
    const loadData = jest.fn(async () => {
        events.push('loadData');
        // 与真实 loadData 一致：设置和密钥状态都以服务端落盘的为准
        if (saved.length) {
            state.settings = structuredClone(saved.at(-1));
        }
        const rotation = rotations.at(-1);
        if (rotation && state.secretState[rotation.key]) {
            state.secretState[rotation.key] = state.secretState[rotation.key].map(item => ({ ...item, active: item.id === rotation.id }));
        }
    });
    const reloadSettings = jest.fn(async () => {
        events.push('reloadSettings');
        return reloadResult;
    });
    const render = jest.fn(() => events.push('render'));
    const showToast = jest.fn((title, message) => toasts.push({ title, message }));
    const actions = createConnectionProfileActions({
        state,
        apiFetch,
        loadData,
        render,
        showToast,
        bridgeReload: { reloadSettings },
        actionRegistry: { getPresetGroups: () => presetGroups },
        storage,
    });
    return { actions, state, events, saved, rotations, toasts, storage, apiFetch, loadData, reloadSettings, render };
}

function withProfiles(settings, profiles, selectedProfile = null) {
    const next = structuredClone(settings);
    next.extension_settings.connectionManager = { profiles: structuredClone(profiles), selectedProfile };
    return next;
}

const claudeProfile = {
    id: 'p-claude',
    mode: 'cc',
    name: 'Claude 日常',
    api: 'claude',
    preset: 'Default',
    model: 'claude-sonnet-4',
    'secret-id': 'secret-2',
    exclude: [],
};

describe('applyConnectionProfile', () => {
    test('saves the new settings, rotates the secret, syncs the engine, and reports applied and skipped items', async () => {
        const profiles = [{ ...claudeProfile, proxy: 'Missing' }];
        const fixture = createActionFixture({ settings: withProfiles(chatSettings(), profiles) });

        const result = await fixture.actions.applyConnectionProfile('p-claude');

        expect(result.ok).toBe(true);
        expect(fixture.saved).toHaveLength(1);
        const body = fixture.saved[0];
        expect(body.chat_completion_source).toBe('claude');
        expect(body.oai_settings).toMatchObject({ chat_completion_source: 'claude', claude_model: 'claude-sonnet-4', preset_settings_openai: 'Default' });
        expect(body.extension_settings.connectionManager.selectedProfile).toBe('p-claude');
        expect(fixture.rotations).toEqual([{ key: 'api_key_claude', id: 'secret-2' }]);
        // 先保存，再通知引擎，页面数据在其后刷新
        expect(fixture.events.indexOf('save')).toBeLessThan(fixture.events.indexOf('reloadSettings'));
        expect(fixture.events.indexOf('reloadSettings')).toBeLessThan(fixture.events.indexOf('loadData'));
        expect(fixture.state.apiMainDraft).toBe('');
        expect(fixture.state.connectionSwitcher.busy).toBe(false);

        expect(fixture.state.connectionSwitcher.lastResult).toMatchObject({
            kind: 'profile',
            title: '档案“Claude 日常”',
            summary: expect.stringMatching(/^已应用 4 项，跳过 1 项（代理预设：/),
        });
        expect(fieldsOf(fixture.state.connectionSwitcher.lastResult.skipped)).toEqual(['proxy']);
        expect(fixture.toasts.at(-1)).toMatchObject({ title: '已切换到“Claude 日常”', message: expect.stringContaining('已应用 4 项，跳过 1 项') });
        // 切过去的模型记入最近使用
        expect(JSON.parse(fixture.storage.getItem(RECENT_MODELS_STORAGE_KEY))).toEqual({ 'openai:claude': ['claude-sonnet-4'] });
    });

    test('refuses while a reply is being generated and does not save anything', async () => {
        const fixture = createActionFixture({ settings: withProfiles(chatSettings(), [claudeProfile]), generating: true });
        const result = await fixture.actions.applyConnectionProfile('p-claude');

        expect(result).toMatchObject({ ok: false });
        expect(fixture.apiFetch).not.toHaveBeenCalled();
        expect(fixture.reloadSettings).not.toHaveBeenCalled();
        expect(fixture.toasts[0].message).toContain('生成');
        expect(getSwitchBlocker(fixture.state)).toContain('生成中');
    });

    test('refuses a second switch while one is running', async () => {
        const fixture = createActionFixture({ settings: withProfiles(chatSettings(), [claudeProfile, { ...claudeProfile, id: 'p-2', name: 'Other', 'secret-id': undefined }]) });
        let release = () => {};
        fixture.apiFetch.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ ok: true }); }));

        const first = fixture.actions.applyConnectionProfile('p-claude');
        await Promise.resolve();
        expect(getSwitcherState(fixture.state).busy).toBe(true);
        expect(getSwitchBlocker(fixture.state)).toContain('切换');
        const second = await fixture.actions.applyConnectionProfile('p-2');
        expect(second.ok).toBe(false);

        release();
        await first;
        expect(getSwitcherState(fixture.state).busy).toBe(false);
    });

    test('reports a failed save, restores the previous settings, and does not touch secrets or the engine', async () => {
        const settings = withProfiles(chatSettings(), [claudeProfile]);
        const fixture = createActionFixture({ settings, saveError: 'disk full' });
        const result = await fixture.actions.applyConnectionProfile('p-claude');

        expect(result).toMatchObject({ ok: false, error: 'disk full' });
        expect(fixture.state.settings).toEqual(settings);
        expect(fixture.rotations).toEqual([]);
        expect(fixture.reloadSettings).not.toHaveBeenCalled();
        expect(fixture.toasts.at(-1)).toMatchObject({ title: '连接档案应用失败', message: 'disk full' });
        expect(fixture.state.connectionSwitcher.busy).toBe(false);
    });

    test('surfaces an engine sync failure next to the success', async () => {
        const fixture = createActionFixture({ settings: withProfiles(chatSettings(), [claudeProfile]), reloadResult: { ok: false, error: '引擎超时' } });
        const result = await fixture.actions.applyConnectionProfile('p-claude');

        expect(result.ok).toBe(true);
        expect(fixture.state.connectionSwitcher.lastResult.warning).toContain('引擎超时');
        expect(fixture.toasts.at(-1).message).toContain('引擎超时');
    });

    test('a page refresh failure after saving is only a warning, not a failed switch', async () => {
        const fixture = createActionFixture({ settings: withProfiles(chatSettings(), [{ ...claudeProfile, 'secret-id': undefined }]) });
        fixture.loadData.mockRejectedValueOnce(new Error('network down'));
        const result = await fixture.actions.applyConnectionProfile('p-claude');

        expect(result.ok).toBe(true);
        expect(fixture.saved).toHaveLength(1);
        expect(fixture.state.connectionSwitcher.lastResult.warning).toContain('页面数据刷新失败：network down');
        expect(fixture.toasts.at(-1).title).toBe('已切换到“Claude 日常”');
    });

    test('moves the secret to skipped when the server did not confirm the rotation', async () => {
        const fixture = createActionFixture({ settings: withProfiles(chatSettings(), [claudeProfile]) });
        // loadData 读回来的密钥状态仍是旧的
        fixture.loadData.mockImplementation(async () => {
            fixture.events.push('loadData');
            fixture.state.settings = structuredClone(fixture.saved.at(-1));
        });
        const result = await fixture.actions.applyConnectionProfile('p-claude');

        expect(result.ok).toBe(true);
        expect(fieldsOf(result.applied)).not.toContain('secret-id');
        expect(result.skipped.find(item => item.field === 'secret-id').reason).toContain('没有确认');
    });

    test('reports a failed rotate request as skipped without failing the whole switch', async () => {
        const fixture = createActionFixture({ settings: withProfiles(chatSettings(), [claudeProfile]) });
        fixture.apiFetch.mockImplementation(async path => {
            if (path === '/api/secrets/rotate') {
                throw new Error('500');
            }
            fixture.saved.push(structuredClone(fixture.state.settings));
            return { ok: true };
        });
        const result = await fixture.actions.applyConnectionProfile('p-claude');
        expect(result.ok).toBe(true);
        expect(result.skipped.find(item => item.field === 'secret-id').reason).toContain('密钥切换请求失败');
    });

    test('tells the user when the profile has nothing to apply and changes nothing', async () => {
        const fixture = createActionFixture({ settings: withProfiles(chatSettings(), [{ id: 'empty', name: 'Empty', mode: 'cc', 'reasoning-template': 'Think' }]) });
        const result = await fixture.actions.applyConnectionProfile('empty');

        expect(result).toMatchObject({ ok: false, reason: 'nothing-applied' });
        expect(fixture.apiFetch).not.toHaveBeenCalled();
        expect(fixture.toasts.at(-1).title).toContain('没有可应用的项');
        expect(fixture.state.connectionSwitcher.lastResult.skipped).toHaveLength(1);
    });

    test('an unknown id is reported', async () => {
        const fixture = createActionFixture();
        expect(await fixture.actions.applyConnectionProfile('nope')).toMatchObject({ ok: false, reason: 'not-found' });
        expect(fixture.apiFetch).not.toHaveBeenCalled();
    });
});

describe('createProfileFromCurrentConnection and deleteConnectionProfile', () => {
    test('rejects bad names without saving and keeps the message for the form', async () => {
        const fixture = createActionFixture({ settings: withProfiles(chatSettings(), [claudeProfile]) });
        expect(await fixture.actions.createProfileFromCurrentConnection(' ')).toMatchObject({ ok: false });
        expect(fixture.state.connectionSwitcher.error).toContain('名称');
        expect(await fixture.actions.createProfileFromCurrentConnection('Claude 日常')).toMatchObject({ ok: false });
        expect(fixture.state.connectionSwitcher.error).toContain('已经有');
        expect(fixture.apiFetch).not.toHaveBeenCalled();
    });

    test('saves a new profile built from the current connection and selects it', async () => {
        const fixture = createActionFixture({ settings: withProfiles(chatSettings(), [claudeProfile]), secretState: { api_key_custom: [{ id: 'cs-1', label: 'main', active: true }] } });
        const result = await fixture.actions.createProfileFromCurrentConnection(' 我的 连接 ');

        expect(result.ok).toBe(true);
        const manager = fixture.saved[0].extension_settings.connectionManager;
        expect(manager.profiles).toHaveLength(2);
        expect(manager.profiles[1]).toMatchObject({ name: '我的 连接', mode: 'cc', api: 'custom', model: 'deepseek-v4-flash', 'secret-id': 'cs-1' });
        expect(manager.selectedProfile).toBe(manager.profiles[1].id);
        // 现有设置原样保留，页面没有重新读取
        expect(fixture.saved[0].oai_settings.custom_model).toBe('deepseek-v4-flash');
        expect(fixture.loadData).not.toHaveBeenCalled();
        expect(fixture.state.connectionSwitcher).toMatchObject({ createOpen: false, error: '' });
        await Promise.resolve();
        expect(fixture.reloadSettings).toHaveBeenCalledTimes(1);
    });

    test('creates the connection manager settings when the file has none', async () => {
        const settings = chatSettings();
        delete settings.extension_settings;
        const fixture = createActionFixture({ settings });
        await fixture.actions.createProfileFromCurrentConnection('First');
        expect(fixture.saved[0].extension_settings.connectionManager.profiles).toHaveLength(1);
    });

    test('refuses to create a profile for a connection it cannot name', async () => {
        const fixture = createActionFixture({ settings: { main_api: 'poe' } });
        const result = await fixture.actions.createProfileFromCurrentConnection('X');
        expect(result.ok).toBe(false);
        expect(fixture.state.connectionSwitcher.error).toContain('无法识别');
        expect(fixture.apiFetch).not.toHaveBeenCalled();
    });

    test('keeps the old settings when the save fails', async () => {
        const settings = withProfiles(chatSettings(), []);
        const fixture = createActionFixture({ settings, saveError: 'locked' });
        expect(await fixture.actions.createProfileFromCurrentConnection('X')).toMatchObject({ ok: false, error: 'locked' });
        expect(fixture.state.settings).toEqual(settings);
        expect(fixture.state.connectionSwitcher.error).toContain('locked');
    });

    test('deletes a profile and clears the selection when it was the selected one', async () => {
        const fixture = createActionFixture({ settings: withProfiles(chatSettings(), [claudeProfile, { ...claudeProfile, id: 'p-2', name: 'Other' }], 'p-claude') });
        const result = await fixture.actions.deleteConnectionProfile('p-claude');

        expect(result.ok).toBe(true);
        const manager = fixture.saved[0].extension_settings.connectionManager;
        expect(manager.profiles.map(profile => profile.id)).toEqual(['p-2']);
        expect(manager.selectedProfile).toBeNull();
        expect(fixture.toasts.at(-1).title).toBe('已删除连接档案');

        const other = createActionFixture({ settings: withProfiles(chatSettings(), [claudeProfile, { ...claudeProfile, id: 'p-2', name: 'Other' }], 'p-2') });
        await other.actions.deleteConnectionProfile('p-claude');
        expect(other.saved[0].extension_settings.connectionManager.selectedProfile).toBe('p-2');
        expect(await other.actions.deleteConnectionProfile('missing')).toMatchObject({ ok: false });
    });
});

describe('switchModelQuick', () => {
    test('writes the source model field, syncs the engine and remembers the model', async () => {
        const fixture = createActionFixture();
        const result = await fixture.actions.switchModelQuick('deepseek-v4-pro');

        expect(result.ok).toBe(true);
        expect(fixture.saved[0].oai_settings.custom_model).toBe('deepseek-v4-pro');
        expect(fixture.saved[0].oai_settings.claude_model).toBe('claude-old');
        expect(fixture.events.indexOf('save')).toBeLessThan(fixture.events.indexOf('reloadSettings'));
        expect(JSON.parse(fixture.storage.getItem(RECENT_MODELS_STORAGE_KEY))).toEqual({ 'openai:custom': ['deepseek-v4-pro'] });
        expect(fixture.state.connectionSwitcher.lastResult).toMatchObject({ kind: 'model', summary: '已切换到 deepseek-v4-pro' });
        expect(fixture.toasts.at(-1).title).toBe('已切换模型');
    });

    test('a page refresh failure after saving is only a warning', async () => {
        const fixture = createActionFixture();
        fixture.loadData.mockRejectedValueOnce(new Error('network down'));
        const result = await fixture.actions.switchModelQuick('deepseek-v4-pro');
        expect(result.ok).toBe(true);
        expect(fixture.state.connectionSwitcher.lastResult.warning).toContain('页面数据刷新失败：network down');
    });

    test('does nothing for the model already in use, while generating, or for an unsupported API', async () => {
        const same = createActionFixture();
        expect(await same.actions.switchModelQuick('deepseek-v4-flash')).toMatchObject({ ok: true, unchanged: true });
        expect(same.apiFetch).not.toHaveBeenCalled();

        const busy = createActionFixture({ generating: true });
        expect(await busy.actions.switchModelQuick('x')).toMatchObject({ ok: false });
        expect(busy.apiFetch).not.toHaveBeenCalled();

        const novel = createActionFixture({ settings: { main_api: 'novel' } });
        expect(await novel.actions.switchModelQuick('x')).toMatchObject({ ok: false });
        expect(novel.apiFetch).not.toHaveBeenCalled();
        expect(novel.toasts.at(-1).title).toBe('不能切换模型');
    });

    test('keeps the previous settings when saving fails', async () => {
        const settings = chatSettings();
        const fixture = createActionFixture({ settings, saveError: 'readonly' });
        expect(await fixture.actions.switchModelQuick('x')).toMatchObject({ ok: false, error: 'readonly' });
        expect(fixture.state.settings).toEqual(settings);
        expect(fixture.storage.getItem(RECENT_MODELS_STORAGE_KEY)).toBeNull();
    });
});
