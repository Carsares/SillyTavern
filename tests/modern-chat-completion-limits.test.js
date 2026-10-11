import {
    CHAT_COMPLETION_CONTEXT_UNLOCKED_MAX,
    describeChatCompletionContextHint,
    describeTextCompletionLimitHint,
    formatPercent,
    getChatCompletionContextLimits,
    getChatCompletionContextRange,
    getIntegerRangeError,
    getPromptBudget,
    getTextCompletionLimits,
    getUsageSummary,
    readContextSettings,
} from '../public/modern/actions/chat-completion-limits.js';
import { buildOpenAiPresetFromSettings } from '../public/modern/actions/openai-preset-fields.js';
import { getChatUsageView } from '../public/modern/components/chat-usage-label.js';

// 对照 public/scripts/openai.js 的 onModelChange（上下文上限的钳制）、getMaxContextOpenAI 以及各来源的 get*MaxContext，
// 数值取自当时读到的旧版代码；旧版这几处改动时需要同步更新这里的期望。
const limitsFor = (source, model = '', unlocked = false) => getChatCompletionContextLimits({ source, model, unlocked });

describe('chat completion context limits mirror the legacy onModelChange clamping', () => {
    test('custom is always 2,000,000 and ignores the unlock checkbox', () => {
        expect(limitsFor('custom', 'deepseek-v4-flash')).toMatchObject({ max: 2000000, dynamic: false, unlockApplies: false });
        expect(limitsFor('custom', 'anything', true).max).toBe(2000000);
        expect(limitsFor('custom').min).toBe(512);
    });

    test('deepseek is 1,000,000 locked and 2,000,000 unlocked', () => {
        expect(limitsFor('deepseek', 'deepseek-chat')).toMatchObject({ max: 1000000, dynamic: false, unlocked: false });
        expect(limitsFor('deepseek', 'deepseek-chat', true)).toMatchObject({ max: 2000000, dynamic: false, unlocked: true });
    });

    test('openai picks the limit by model like getMaxContextOpenAI', () => {
        expect(limitsFor('openai', 'gpt-4o').max).toBe(128000);
        expect(limitsFor('openai', 'gpt-4o-mini').max).toBe(128000);
        expect(limitsFor('openai', 'chatgpt-4o-latest').max).toBe(128000);
        expect(limitsFor('openai', 'gpt-4-turbo').max).toBe(128000);
        expect(limitsFor('openai', 'gpt-4.1').max).toBe(1000000);
        expect(limitsFor('openai', 'gpt-4.1-mini').max).toBe(1000000);
        expect(limitsFor('openai', 'gpt-4').max).toBe(8191);
        expect(limitsFor('openai', 'gpt-4-32k').max).toBe(32767);
        expect(limitsFor('openai', 'gpt-3.5-turbo').max).toBe(4095);
        expect(limitsFor('openai', 'gpt-3.5-turbo-1106').max).toBe(16383);
        expect(limitsFor('openai', 'gpt-3.5-turbo-16k').max).toBe(16383);
        expect(limitsFor('openai', 'o1-preview').max).toBe(128000);
        expect(limitsFor('openai', 'o3-mini').max).toBe(200000);
        expect(limitsFor('openai', 'o4-mini').max).toBe(200000);
        expect(limitsFor('openai', 'gpt-audio').max).toBe(128000);
        expect(limitsFor('openai', 'gpt-realtime').max).toBe(32767);
        expect(limitsFor('openai', 'text-ada-001').max).toBe(2047);
        // 没有命中任何规则的新模型沿用旧版的安全默认值 128k
        expect(limitsFor('openai', 'some-future-model').max).toBe(128000);
        expect(limitsFor('openai', 'gpt-4o').dynamic).toBe(false);
    });

    test('gpt-5 families follow the legacy order of rules', () => {
        expect(limitsFor('openai', 'gpt-5').max).toBe(400000);
        expect(limitsFor('openai', 'gpt-5-mini').max).toBe(400000);
        expect(limitsFor('openai', 'gpt-5.1').max).toBe(400000);
        // gpt-5.4 / gpt-5.5 排在 gpt-5 之前，上限 1,000,000
        expect(limitsFor('openai', 'gpt-5.4').max).toBe(1000000);
        expect(limitsFor('openai', 'gpt-5.5-pro').max).toBe(1000000);
        expect(limitsFor('azure_openai', 'gpt-5').max).toBe(400000);
    });

    test('unlocking raises every source that honors it to 2,000,000', () => {
        expect(limitsFor('openai', 'gpt-4', true).max).toBe(CHAT_COMPLETION_CONTEXT_UNLOCKED_MAX);
        expect(limitsFor('claude', 'claude-3-5-haiku', true).max).toBe(2000000);
        expect(limitsFor('xai', 'grok-3', true).max).toBe(2000000);
        // 旧版的 MiniMax 分支不看解锁
        expect(limitsFor('minimax', 'M2-her', true)).toMatchObject({ max: 65536, unlockApplies: false });
        expect(limitsFor('minimax', 'MiniMax-M2').max).toBe(204800);
    });

    test('claude, cohere, perplexity, xai, zai and siliconflow resolve by model name', () => {
        expect(limitsFor('claude', 'claude-sonnet-4-5-20250929').max).toBe(1000000);
        expect(limitsFor('claude', 'claude-opus-4-7').max).toBe(1000000);
        expect(limitsFor('claude', 'claude-sonnet-4-20250514').max).toBe(200000);
        expect(limitsFor('claude', 'claude-3-5-haiku-20241022').max).toBe(200000);

        expect(limitsFor('cohere', 'command-r-plus').max).toBe(128000);
        expect(limitsFor('cohere', 'command-a-03-2025').max).toBe(256000);
        expect(limitsFor('cohere', 'command-light').max).toBe(4095);
        expect(limitsFor('cohere', 'c4ai-aya-vision-8b').max).toBe(16383);

        expect(limitsFor('perplexity', 'sonar').max).toBe(127000);
        expect(limitsFor('perplexity', 'sonar-pro').max).toBe(200000);
        expect(limitsFor('perplexity', 'llama-3.1-sonar-large-128k-online').max).toBe(128 * 1024 - 4000);

        expect(limitsFor('xai', 'grok-2-vision-1212').max).toBe(32767);
        expect(limitsFor('xai', 'grok-4-fast-reasoning').max).toBe(2000000);
        expect(limitsFor('xai', 'grok-4').max).toBe(256000);
        expect(limitsFor('xai', 'grok-3').max).toBe(128000);

        expect(limitsFor('zai', 'glm-4.5-air').max).toBe(128000);
        expect(limitsFor('zai', 'glm-4.6').max).toBe(200000);
        // 旧版按插入顺序取第一个被包含的键：'glm-4.5' 排在 'glm-4.5v' 前面，所以 glm-4.5v 实际得到 128k
        expect(limitsFor('zai', 'glm-4.5v').max).toBe(128000);
        expect(limitsFor('zai', 'autoglm-phone-multilingual').max).toBe(65535);

        expect(limitsFor('siliconflow', 'deepseek-ai/DeepSeek-V3').max).toBe(128000);
        expect(limitsFor('siliconflow', 'deepseek-ai/deepseek-vl2').max).toBe(4095);
        expect(limitsFor('siliconflow', 'Qwen/Qwen3-VL-8B-Thinking').max).toBe(256000);
        expect(limitsFor('siliconflow', 'unknown/model').max).toBe(32767);

        expect(limitsFor('pollinations', 'x').max).toBe(128000);
        expect(limitsFor('cometapi', 'x').max).toBe(128000);
    });

    test('lookups by substring keep the legacy order, so a longer name can match a shorter earlier key', () => {
        // 旧版 Object.entries(...).find(model.includes(key))：vision-preview 先命中更短的 moonshot-v1-8k
        expect(limitsFor('moonshot', 'moonshot-v1-128k-vision-preview').max).toBe(128000);
        expect(limitsFor('moonshot', 'moonshot-v1-8k-vision-preview').max).toBe(8191);
        expect(limitsFor('moonshot', 'kimi-k2.5').max).toBe(256000);
        expect(limitsFor('groq', 'llama3-70b-8192').max).toBe(8191);
        expect(limitsFor('groq', 'mixtral-8x7b-32768').max).toBe(32767);
    });

    test('sources whose limit comes from the remote model list are flagged dynamic with the legacy fallback', () => {
        const dynamicSources = {
            openrouter: 128000,
            makersuite: 128000,
            vertexai: 128000,
            mistralai: 32767,
            groq: 128000,
            chutes: 8191,
            electronhub: 128000,
            nanogpt: 128000,
            workers_ai: 8191,
            aimlapi: 32767,
            moonshot: 32767,
            fireworks: 32767,
        };
        for (const [source, fallback] of Object.entries(dynamicSources)) {
            expect(limitsFor(source, 'unlisted-model')).toMatchObject({ max: fallback, dynamic: true });
        }
        expect(limitsFor('makersuite', 'gemini-2.5-pro')).toMatchObject({ max: 1000000, dynamic: true });
        expect(limitsFor('makersuite', 'gemma-3-27b-it').max).toBe(128000);
        // 解锁后旧版直接给 2,000,000，不再依赖模型列表
        expect(limitsFor('openrouter', 'x', true)).toMatchObject({ max: 2000000, dynamic: false });
        // 其余来源不依赖模型列表
        for (const source of ['openai', 'azure_openai', 'claude', 'cohere', 'perplexity', 'custom', 'deepseek', 'xai', 'zai', 'siliconflow', 'minimax', 'pollinations', 'cometapi']) {
            expect(limitsFor(source, 'gpt-4o').dynamic).toBe(false);
        }
        // 非 Jamba 的 AI21 模型旧版不改上限，视为不确定
        expect(limitsFor('ai21', 'jamba-large')).toMatchObject({ max: 256000, dynamic: false });
        expect(limitsFor('ai21', 'j2-ultra')).toMatchObject({ max: 256000, dynamic: true });
        // 没有对应分支的来源按不确定处理
        expect(limitsFor('brand-new-source', 'm')).toMatchObject({ max: 128000, dynamic: true });
    });

    test('validation range only blocks beyond 2,000,000 for dynamic sources and uses the limit for the rest', () => {
        expect(getChatCompletionContextRange(limitsFor('openai', 'gpt-4o'))).toEqual({ min: 512, max: 128000 });
        expect(getChatCompletionContextRange(limitsFor('openrouter', 'x'))).toEqual({ min: 512, max: 2000000 });
        expect(getChatCompletionContextRange(limitsFor('deepseek', 'x', true))).toEqual({ min: 512, max: 2000000 });
    });
});

describe('prompt budget and hint text', () => {
    test('budget is context minus the response limit', () => {
        expect(getPromptBudget(32000, 300)).toBe(31700);
        expect(getPromptBudget(4095, 300)).toBe(3795);
        expect(getPromptBudget(300, 300)).toBe(0);
        expect(getPromptBudget('abc', 300)).toBeNaN();
        expect(getPromptBudget(4095, undefined)).toBeNaN();
    });

    test('the hint states the limit, the formula and the current budget', () => {
        expect(describeChatCompletionContextHint({ limits: limitsFor('custom', 'm'), context: 32000, maxTokens: 300 }))
            .toBe('上限 2,000,000（该来源固定，不受“解锁上限”影响）；提示词预算 = 上下文 − Max Tokens（当前 31,700）');
        expect(describeChatCompletionContextHint({ limits: limitsFor('openai', 'gpt-4o'), context: 4095, maxTokens: 300 }))
            .toBe('上限 128,000；提示词预算 = 上下文 − Max Tokens（当前 3,795）');
        expect(describeChatCompletionContextHint({ limits: limitsFor('deepseek', 'm', true), context: 4095, maxTokens: 300 }))
            .toContain('已解锁，上限 2,000,000');
        expect(describeChatCompletionContextHint({ limits: limitsFor('openrouter', 'm'), context: 4095, maxTokens: 300 }))
            .toContain('参考上限 128,000（该来源的实际上限取决于远端模型列表，旧版可能按实际模型再收紧）');
        // 输入还不是数字时只给公式
        expect(describeChatCompletionContextHint({ limits: limitsFor('openai', 'gpt-4o'), context: '', maxTokens: 300 }))
            .toBe('上限 128,000；提示词预算 = 上下文 − Max Tokens');
    });
});

describe('text completion limits', () => {
    test('locked and unlocked ranges follow power-user.js', () => {
        expect(getTextCompletionLimits()).toEqual({
            unlocked: false,
            context: { min: 512, max: 8192 },
            response: { min: 16, max: 2048 },
        });
        expect(getTextCompletionLimits({ unlocked: true })).toEqual({
            unlocked: true,
            context: { min: 512, max: 524288 },
            response: { min: 16, max: 65536 },
        });
    });

    test('integer range errors name the field and the allowed range', () => {
        expect(getIntegerRangeError({ label: '上下文长度', text: '16384', min: 512, max: 8192 })).toBe('上下文长度 需为 512 到 8,192 之间的整数');
        expect(getIntegerRangeError({ label: '上下文长度', text: '8192', min: 512, max: 8192 })).toBe('');
        expect(getIntegerRangeError({ label: '回复长度', text: '', min: 16, max: 2048 })).toBe('请填写 回复长度');
        expect(getIntegerRangeError({ label: '回复长度', text: '12.5', min: 16, max: 2048 })).toBe('回复长度 需为 16 到 2,048 之间的整数');
        expect(getIntegerRangeError({ label: '回复长度', text: 'abc', min: 16, max: 2048 })).toBe('回复长度 需为 16 到 2,048 之间的整数');
    });

    test('the hint shows both ranges, the unlock option and the budget', () => {
        const hint = describeTextCompletionLimitHint({ limits: getTextCompletionLimits(), context: 8192, response: 350 });
        expect(hint).toContain('上下文 512 到 8,192');
        expect(hint).toContain('勾选“解锁上限”后上下文可到 524,288');
        expect(hint).toContain('提示词预算 = 上下文 − 回复长度（当前 7,842）');
        expect(describeTextCompletionLimitHint({ limits: getTextCompletionLimits({ unlocked: true }), context: 100000, response: 350 }))
            .toContain('已解锁');
    });
});

describe('usage summary', () => {
    const snapshot = { available: true, mainApi: 'openai', totalTokens: 12345, maxContext: 31700 };

    test('reads the context and response limits of the active main API from the saved settings', () => {
        const chatSettings = { main_api: 'openai', oai_settings: { openai_max_context: 32000, openai_max_tokens: 300 }, max_context: 8192, amount_gen: 350 };
        expect(readContextSettings(chatSettings)).toEqual({ mainApi: 'openai', contextLimit: 32000, responseLimit: 300 });
        expect(readContextSettings(chatSettings, 'textgenerationwebui')).toEqual({ mainApi: 'textgenerationwebui', contextLimit: 8192, responseLimit: 350 });
        // 聊天补全设置里没有这两个字段时，引擎按旧版默认值 4095 / 300 处理
        expect(readContextSettings({ main_api: 'openai', oai_settings: {} })).toEqual({ mainApi: 'openai', contextLimit: 4095, responseLimit: 300 });
        expect(readContextSettings({ main_api: 'kobold' })).toEqual({ mainApi: 'kobold', contextLimit: null, responseLimit: null });
    });

    test('percent is the prompt total divided by the prompt budget', () => {
        const usage = getUsageSummary(snapshot, { main_api: 'openai', oai_settings: { openai_max_context: 32000, openai_max_tokens: 300 } });
        expect(usage).toMatchObject({ used: 12345, budget: 31700, contextLimit: 32000, responseLimit: 300 });
        expect(formatPercent(usage.percent)).toBe('38.9');
        expect(formatPercent(100)).toBe('100');
        expect(formatPercent(0)).toBe('0');
    });

    test('no usable snapshot or a non-positive budget gives no percent', () => {
        expect(getUsageSummary(null, {})).toBeNull();
        expect(getUsageSummary({ available: false }, {})).toBeNull();
        expect(getUsageSummary({ available: true, totalTokens: 'x', maxContext: 10 }, {})).toBeNull();
        expect(getUsageSummary({ available: true, mainApi: 'openai', totalTokens: 100, maxContext: 0 }, {}).percent).toBeNull();
    });
});

describe('chat usage label view', () => {
    function makeState(overrides = {}) {
        return {
            selected: { chat: 'chat-a' },
            settings: { main_api: 'openai', oai_settings: { openai_max_context: 32000, openai_max_tokens: 300 } },
            inspector: {
                itemizedPrompt: {
                    loaded: true,
                    loading: false,
                    error: '',
                    chatId: 'chat-a',
                    data: { available: true, mainApi: 'openai', totalTokens: 12345, maxContext: 31700 },
                    ...overrides,
                },
            },
        };
    }

    test('shows the last prompt size against the budget with the percent in the tooltip', () => {
        const view = getChatUsageView(makeState());
        expect(view.text).toBe('上次发送 12,345 / 预算 31,700 token');
        expect(view.percentText).toBe('38.9%');
        expect(view.level).toBe('');
        expect(view.title).toContain('占提示词预算的 38.9%');
        expect(view.title).toContain('提示词预算 = 上下文 32,000 − 回复上限 300');
    });

    test('warns when the prompt nearly fills or overfills the budget', () => {
        expect(getChatUsageView(makeState({ data: { available: true, totalTokens: 29000, maxContext: 31700 } })).level).toBe('is-high');
        expect(getChatUsageView(makeState({ data: { available: true, totalTokens: 31700, maxContext: 31700 } })).level).toBe('is-over');
    });

    test('hides for another chat, a failed read, an unloaded or empty snapshot', () => {
        expect(getChatUsageView(makeState({ chatId: 'chat-b' }))).toBeNull();
        expect(getChatUsageView(makeState({ error: '读取失败' }))).toBeNull();
        expect(getChatUsageView(makeState({ loaded: false }))).toBeNull();
        expect(getChatUsageView(makeState({ data: null }))).toBeNull();
        expect(getChatUsageView({ selected: {}, settings: {}, inspector: {} })).toBeNull();
    });
});

describe('saving an OpenAI preset', () => {
    const chatCompletionModelFields = { custom: 'custom_model' };

    test('keeps the context length and unlock flag in the preset', () => {
        const preset = buildOpenAiPresetFromSettings({
            settings: { chat_completion_source: 'custom', custom_model: 'm', openai_max_context: 32000, max_context_unlocked: true, openai_max_tokens: 300 },
            preset: { openai_max_context: 4095, max_context_unlocked: false },
            chatCompletionModelFields,
        });
        expect(preset).toMatchObject({ openai_max_context: 32000, max_context_unlocked: true, openai_max_tokens: 300 });
    });

    test('leaves the preset values alone when the settings do not have the fields', () => {
        const preset = buildOpenAiPresetFromSettings({
            settings: { chat_completion_source: 'custom', custom_model: 'm', openai_max_tokens: 300 },
            preset: { openai_max_context: 8191, max_context_unlocked: false },
            chatCompletionModelFields,
        });
        expect(preset).toMatchObject({ openai_max_context: 8191, max_context_unlocked: false });
    });
});
