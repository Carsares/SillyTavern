// 上下文长度（Context）和回复上限的取值范围，以及「提示词预算」「用量」的纯函数计算。
// 聊天补全的上限逐来源、逐模型对齐旧版 public/scripts/openai.js 的 onModelChange（约 5346-5887 行）、
// getMaxContextOpenAI（约 4966-4998）和各来源的 get*MaxContext 辅助函数；常量对应 125-137 行。
// 文本补全的范围对应 public/scripts/power-user.js:83-89 与 public/index.html 的 #max_context / #amount_gen。
// 本文件不碰 DOM，也不读 state，方便单测；界面与保存路径在 api-chat-completion-connection.js 等文件里调用它。

import { formatNumber } from '../core/utils.js';

const MAX_2K = 2047;
const MAX_4K = 4095;
const MAX_8K = 8191;
const MAX_16K = 16383;
const MAX_32K = 32767;
const MAX_64K = 65535;
const MAX_128K = 128 * 1000;
const MAX_200K = 200 * 1000;
const MAX_256K = 256 * 1000;
const MAX_400K = 400 * 1000;
const MAX_1MIL = 1000 * 1000;
const MAX_2MIL = 2000 * 1000;

/** 旧版「解锁上限」勾选后的上限（openai.js 的 unlocked_max）。 */
export const CHAT_COMPLETION_CONTEXT_UNLOCKED_MAX = MAX_2MIL;
/** 旧版上下文滑块的下限（public/index.html 的 #openai_max_context min）。 */
export const CHAT_COMPLETION_CONTEXT_MIN = 512;
/** 旧版 openai_max_context 的默认值（openai.js 的 max_4k），设置里没有这个字段时引擎按它处理。 */
export const CHAT_COMPLETION_CONTEXT_DEFAULT = MAX_4K;
/** 旧版 openai_max_tokens 的默认值。 */
export const CHAT_COMPLETION_RESPONSE_DEFAULT = 300;

// 文本补全：未解锁 8192 / 2048，解锁后 512 * 1024 / 64 * 1024（power-user.js:83-86）。
export const TEXT_COMPLETION_CONTEXT_MIN = 512;
export const TEXT_COMPLETION_CONTEXT_DEFAULT_MAX = 8192;
export const TEXT_COMPLETION_CONTEXT_UNLOCKED_MAX = 512 * 1024;
export const TEXT_COMPLETION_RESPONSE_MIN = 16;
export const TEXT_COMPLETION_RESPONSE_DEFAULT_MAX = 2048;
export const TEXT_COMPLETION_RESPONSE_UNLOCKED_MAX = 64 * 1024;

/**
 * 按「model 包含 key」的顺序查表，第一个命中的生效。顺序有意义：旧版也是按插入顺序 find，
 * 例如 'moonshot-v1-8k-vision-preview' 会先命中更短的 'moonshot-v1-8k'。
 * @param {ReadonlyArray<readonly [string, number]>} table 键值对表
 * @param {string} model 模型名
 * @param {number} fallback 没有命中时的值
 * @returns {number} 上限
 */
function findByIncludes(table, model, fallback) {
    const hit = table.find(([key]) => model.includes(key));
    return hit ? hit[1] : fallback;
}

/**
 * 按正则顺序查表，第一个命中的生效。
 * @param {ReadonlyArray<readonly [RegExp, number]>} table 正则与上限
 * @param {string} model 模型名
 * @param {number} fallback 没有命中时的值
 * @returns {number} 上限
 */
function findByPattern(table, model, fallback) {
    const hit = table.find(([pattern]) => pattern.test(model));
    return hit ? hit[1] : fallback;
}

// getMaxContextOpenAI（openai.js:4966）
/** @type {ReadonlyArray<readonly [RegExp, number]>} */
const openAiContextTable = [
    [/^gpt-5\.[45]/, MAX_1MIL],
    [/^gpt-5/, MAX_400K],
    [/gpt-4\.1/, MAX_1MIL],
    [/gpt-audio/, MAX_128K],
    [/^o1/, MAX_128K],
    [/^o[34]/, MAX_200K],
    [/chatgpt-4o-latest|gpt-4-turbo|gpt-4o|gpt-4-1106|gpt-4-0125|gpt-4-vision/, MAX_128K],
    [/gpt-3\.5-turbo-1106/, MAX_16K],
    [/^(gpt-4|gpt-4-0314|gpt-4-0613)$/, MAX_8K],
    [/^(gpt-4-32k|gpt-4-32k-0314|gpt-4-32k-0613)$/, MAX_32K],
    [/gpt-realtime/, MAX_32K],
    [/^(gpt-3\.5-turbo-16k|gpt-3\.5-turbo-16k-0613)$/, MAX_16K],
    [/^code-davinci-002$/, MAX_8K],
    [/^(text-curie-001|text-babbage-001|text-ada-001)$/, MAX_2K],
    [/gpt-3/, MAX_4K],
];

// getGeminiMaxContext 在没有模型列表时的回退表（openai.js:5005 起）
/** @type {ReadonlyArray<readonly [RegExp, number]>} */
const geminiContextTable = [
    [/gemini-2\.5-flash-image/, MAX_32K],
    [/gemini-3-pro-image/, MAX_64K],
    [/gemini-(?:3[.\d]*|2\.(?:5|0))-(pro|flash)/, MAX_1MIL],
    [/(gemini-exp|learnlm-2\.0-flash|gemini-robotics)/, MAX_1MIL],
    [/gemma-3-27b-it/, MAX_128K],
    [/gemma-3n-e4b-it/, MAX_8K],
    [/gemma-3/, MAX_32K],
    [/gemma-4/, MAX_256K],
];

// getGroqMaxContext 的回退表
/** @type {ReadonlyArray<readonly [string, number]>} */
const groqContextTable = [
    ['gemma2-9b-it', MAX_8K],
    ['llama-3.3-70b-versatile', MAX_128K],
    ['llama-3.1-8b-instant', MAX_128K],
    ['llama3-70b-8192', MAX_8K],
    ['llama3-8b-8192', MAX_8K],
    ['llama-guard-3-8b', MAX_8K],
    ['mixtral-8x7b-32768', MAX_32K],
    ['deepseek-r1-distill-llama-70b', MAX_128K],
    ['llama-3.3-70b-specdec', MAX_8K],
    ['llama-3.2-1b-preview', MAX_128K],
    ['llama-3.2-3b-preview', MAX_128K],
    ['llama-3.2-11b-vision-preview', MAX_128K],
    ['llama-3.2-90b-vision-preview', MAX_128K],
    ['qwen-2.5-32b', MAX_128K],
    ['deepseek-r1-distill-qwen-32b', MAX_128K],
    ['deepseek-r1-distill-llama-70b-specdec', MAX_128K],
    ['mistral-saba-24b', MAX_32K],
    ['meta-llama/llama-4-scout-17b-16e-instruct', MAX_128K],
    ['meta-llama/llama-4-maverick-17b-128e-instruct', MAX_128K],
    ['compound-beta', MAX_128K],
    ['compound-beta-mini', MAX_128K],
    ['qwen/qwen3-32b', MAX_128K],
];

// getZaiMaxContext
/** @type {ReadonlyArray<readonly [string, number]>} */
const zaiContextTable = [
    ['glm-5.1', MAX_200K],
    ['glm-5-turbo', MAX_200K],
    ['glm-5v-turbo', MAX_200K],
    ['glm-5', MAX_200K],
    ['glm-4.7', MAX_200K],
    ['glm-4.7-flash', MAX_200K],
    ['glm-4.7-flashx', MAX_200K],
    ['glm-4.6v', MAX_128K],
    ['glm-4.6v-flash', MAX_128K],
    ['glm-4.6v-flashx', MAX_128K],
    ['glm-4.6', MAX_200K],
    ['glm-4.5', MAX_128K],
    ['glm-4-32b-0414-128k', MAX_128K],
    ['glm-4.5-air', MAX_128K],
    ['glm-4.5v', MAX_64K],
    ['autoglm-phone-multilingual', MAX_64K],
];

// getSiliconflowMaxContext
/** @type {ReadonlyArray<readonly [string, number]>} */
const siliconflowContextTable = [
    ['baidu/ERNIE-4.5-300B-A47B', MAX_128K],
    ['ByteDance-Seed/Seed-OSS-36B-Instruct', MAX_256K],
    ['deepseek-ai/DeepSeek-R1', MAX_128K],
    ['deepseek-ai/DeepSeek-V3', MAX_128K],
    ['deepseek-ai/DeepSeek-V3.1', MAX_128K],
    ['deepseek-ai/DeepSeek-V3.1-Terminus', MAX_128K],
    ['deepseek-ai/DeepSeek-V3.2-Exp', MAX_128K],
    ['deepseek-ai/deepseek-vl2', MAX_4K],
    ['inclusionAI/Ling-1T', MAX_128K],
    ['inclusionAI/Ling-flash-2.0', MAX_128K],
    ['inclusionAI/Ling-mini-2.0', MAX_128K],
    ['inclusionAI/Ring-1T', MAX_128K],
    ['inclusionAI/Ring-flash-2.0', MAX_128K],
    ['meta-llama/Llama-3.3-70B-Instruct', MAX_32K],
    ['meta-llama/Meta-Llama-3.1-8B-Instruct', MAX_32K],
    ['MiniMaxAI/MiniMax-M1-80k', MAX_128K],
    ['MiniMaxAI/MiniMax-M2', MAX_128K],
    ['moonshotai/Kimi-K2-Instruct', MAX_128K],
    ['moonshotai/Kimi-K2-Instruct-0905', MAX_256K],
    ['moonshotai/Kimi-K2-Thinking', MAX_256K],
    ['openai/gpt-oss-120b', MAX_128K],
    ['openai/gpt-oss-20b', MAX_128K],
    ['Qwen/Qwen3-235B-A22B-Instruct-2507', MAX_256K],
    ['Qwen/Qwen3-235B-A22B-Thinking-2507', MAX_256K],
    ['Qwen/Qwen3-30B-A3B-Instruct-2507', MAX_256K],
    ['Qwen/Qwen3-30B-A3B-Thinking-2507', MAX_256K],
    ['Qwen/Qwen3-VL-235B-A22B-Instruct', MAX_256K],
    ['Qwen/Qwen3-VL-235B-A22B-Thinking', MAX_256K],
    ['Qwen/Qwen3-VL-30B-A3B-Instruct', MAX_256K],
    ['Qwen/Qwen3-VL-30B-A3B-Thinking', MAX_256K],
    ['Qwen/Qwen3-VL-32B-Instruct', MAX_256K],
    ['Qwen/Qwen3-VL-32B-Thinking', MAX_256K],
    ['Qwen/Qwen3-VL-8B-Instruct', MAX_256K],
    ['Qwen/Qwen3-VL-8B-Thinking', MAX_256K],
    ['stepfun-ai/step3', MAX_64K],
    ['tencent/Hunyuan-A13B-Instruct', MAX_128K],
    ['zai-org/GLM-4.5', MAX_128K],
    ['zai-org/GLM-4.5-Air', MAX_128K],
    ['zai-org/GLM-4.5V', MAX_64K],
    ['zai-org/GLM-4.6', MAX_200K],
];

// getMoonshotMaxContext 的回退表
/** @type {ReadonlyArray<readonly [string, number]>} */
const moonshotContextTable = [
    ['moonshot-v1-8k', MAX_8K],
    ['moonshot-v1-32k', MAX_32K],
    ['moonshot-v1-128k', MAX_128K],
    ['moonshot-v1-auto', MAX_128K],
    ['moonshot-v1-8k-vision-preview', MAX_8K],
    ['moonshot-v1-32k-vision-preview', MAX_32K],
    ['moonshot-v1-128k-vision-preview', MAX_128K],
    ['kimi-k2-0711-preview', MAX_32K],
    ['kimi-latest', MAX_256K],
    ['kimi-thinking-preview', MAX_32K],
    ['kimi-k2.5', MAX_256K],
    ['kimi-k2-0905-preview', MAX_256K],
    ['kimi-k2-turbo-preview', MAX_256K],
    ['kimi-k2-thinking', MAX_256K],
    ['kimi-k2-thinking-turbo', MAX_256K],
];

const cohereSmallModels = ['command-light-nightly', 'command-light', 'command'];
const cohere128kModels = ['c4ai-aya-23', 'c4ai-aya-expanse-32b', 'command-nightly', 'command-a-vision-07-2025'];
const cohere8kModels = ['c4ai-aya-23-8b', 'c4ai-aya-expanse-8b'];
const cohere16kModels = ['c4ai-aya-vision-8b', 'c4ai-aya-vision-32b'];
const perplexity127kModels = ['sonar', 'sonar-reasoning', 'sonar-reasoning-pro', 'r1-1776'];

/**
 * 固定上限：旧版给出的值不依赖远端模型列表。
 * @param {number} max 上限
 * @param {{ unlockApplies?: boolean }} [options] 解锁上限是否对该来源有影响
 * @returns {{ max: number, dynamic: boolean, unlockApplies: boolean }} 解析结果
 */
function fixedLimit(max, { unlockApplies = true } = {}) {
    return { max, dynamic: false, unlockApplies };
}

/**
 * 依赖远端模型列表的上限：旧版先看已加载的模型列表，没有才用这里的回退值，所以这个值只是参考。
 * @param {number} reference 没有模型列表时旧版使用的值
 * @returns {{ max: number, dynamic: boolean, unlockApplies: boolean }} 解析结果
 */
function dynamicLimit(reference) {
    return { max: reference, dynamic: true, unlockApplies: true };
}

/**
 * 每个来源在「未解锁」时的上限。解锁后统一为 2,000,000，由 getChatCompletionContextLimits 处理。
 * 各分支对应 openai.js onModelChange 里同名来源的分支，model 取该来源当前选中的模型。
 * @type {Record<string, (model: string) => { max: number, dynamic: boolean, unlockApplies: boolean }>}
 */
const lockedLimitBySource = {
    openai: model => fixedLimit(findByPattern(openAiContextTable, model, MAX_128K)),
    azure_openai: model => fixedLimit(findByPattern(openAiContextTable, model, MAX_128K)),
    claude: model => fixedLimit(/^claude-(sonnet-4-5|sonnet-4-6|opus-4-6|opus-4-7)/.test(model) ? MAX_1MIL : MAX_200K),
    makersuite: model => dynamicLimit(findByPattern(geminiContextTable, model, MAX_128K)),
    vertexai: model => dynamicLimit(findByPattern(geminiContextTable, model, MAX_128K)),
    openrouter: () => dynamicLimit(MAX_128K),
    // 旧版对非 Jamba 模型不改上限（沿用上一次的值），所以只有 jamba-* 是确定的。
    ai21: model => (model.startsWith('jamba-') ? fixedLimit(MAX_256K) : dynamicLimit(MAX_256K)),
    mistralai: () => dynamicLimit(MAX_32K),
    cohere: model => {
        if (cohereSmallModels.includes(model)) {
            return fixedLimit(MAX_4K);
        }
        if (model.includes('command-r') || cohere128kModels.includes(model)) {
            return fixedLimit(MAX_128K);
        }
        if (model === 'command-a-03-2025') {
            return fixedLimit(MAX_256K);
        }
        if (cohere8kModels.includes(model)) {
            return fixedLimit(MAX_8K);
        }
        if (cohere16kModels.includes(model)) {
            return fixedLimit(MAX_16K);
        }
        return fixedLimit(MAX_4K);
    },
    perplexity: model => {
        if (perplexity127kModels.includes(model)) {
            return fixedLimit(127000);
        }
        if (model === 'sonar-pro') {
            return fixedLimit(200000);
        }
        if (model.includes('llama-3.1')) {
            return fixedLimit(model.includes('online') ? 128 * 1024 - 4000 : 128 * 1024);
        }
        return fixedLimit(MAX_128K);
    },
    groq: model => dynamicLimit(findByIncludes(groqContextTable, model, MAX_128K)),
    // 旧版对 custom 一律给 2,000,000，不受「解锁上限」影响
    custom: () => fixedLimit(MAX_2MIL, { unlockApplies: false }),
    chutes: () => dynamicLimit(MAX_8K),
    electronhub: () => dynamicLimit(MAX_128K),
    nanogpt: () => dynamicLimit(MAX_128K),
    pollinations: () => fixedLimit(MAX_128K),
    deepseek: () => fixedLimit(MAX_1MIL),
    workers_ai: () => dynamicLimit(MAX_8K),
    cometapi: () => fixedLimit(MAX_128K),
    xai: model => {
        if (model.includes('grok-2-vision')) {
            return fixedLimit(MAX_32K);
        }
        if (model.includes('grok-4-fast')) {
            return fixedLimit(MAX_2MIL);
        }
        if (model.includes('grok-4') || model.includes('grok-code')) {
            return fixedLimit(MAX_256K);
        }
        return fixedLimit(MAX_128K);
    },
    aimlapi: () => dynamicLimit(MAX_32K),
    moonshot: model => dynamicLimit(findByIncludes(moonshotContextTable, model, MAX_32K)),
    fireworks: () => dynamicLimit(MAX_32K),
    siliconflow: model => fixedLimit(findByIncludes(siliconflowContextTable, model, MAX_32K)),
    // 旧版对 MiniMax 也不看解锁
    minimax: model => fixedLimit(model === 'M2-her' ? 65536 : 204800, { unlockApplies: false }),
    zai: model => fixedLimit(findByIncludes(zaiContextTable, model, MAX_128K)),
};

/**
 * @typedef {object} ChatCompletionContextLimits
 * @property {string} source 聊天补全来源
 * @property {string} model 参与计算的模型名
 * @property {boolean} unlocked 是否勾选了「解锁上限」
 * @property {number} min 下限
 * @property {number} max 旧版在这个来源和模型下给上下文滑块的上限
 * @property {boolean} dynamic 旧版实际上限取决于远端模型列表，`max` 只是没有列表时的参考值
 * @property {boolean} unlockApplies 「解锁上限」对这个来源是否有影响
 */

/**
 * 聊天补全在指定来源和模型下的上下文长度范围，对齐旧版 onModelChange 的钳制。
 * 依赖远端模型列表的来源（dynamic 为 true）返回的是没有列表时旧版使用的值，旧版可能按实际模型再调整。
 * @param {{ source: string, model?: string, unlocked?: boolean }} options 来源、模型和解锁状态
 * @returns {ChatCompletionContextLimits} 范围
 */
export function getChatCompletionContextLimits({ source, model = '', unlocked = false }) {
    const modelName = String(model ?? '');
    const resolveLocked = lockedLimitBySource[source];
    // 未知来源：旧版没有对应分支，上限沿用滑块上一次的值，这里按「依赖外部」处理
    const locked = resolveLocked ? resolveLocked(modelName) : dynamicLimit(MAX_128K);
    const useUnlocked = Boolean(unlocked) && locked.unlockApplies;

    return {
        source,
        model: modelName,
        unlocked: Boolean(unlocked),
        min: CHAT_COMPLETION_CONTEXT_MIN,
        max: useUnlocked ? CHAT_COMPLETION_CONTEXT_UNLOCKED_MAX : locked.max,
        dynamic: useUnlocked ? false : locked.dynamic,
        unlockApplies: locked.unlockApplies,
    };
}

/**
 * 现代页允许填写的聊天补全上下文长度：所有来源都是 512 到 2,000,000，不要求先勾选「解锁上限」。
 * 超过该来源按模型的上限时只提示，保存时由 resolveChatContextUnlock 替引擎打开解锁标记。
 */
export const CHAT_COMPLETION_CONTEXT_INPUT_RANGE = Object.freeze({ min: CHAT_COMPLETION_CONTEXT_MIN, max: CHAT_COMPLETION_CONTEXT_UNLOCKED_MAX });

/**
 * 保存上下文长度时 oai_settings.max_context_unlocked 应取的值。
 * 旧版引擎载入设置时，未解锁就把上下文钳到该来源按模型的上限（onModelChange），所以超过上限时必须打开解锁，填的值才会生效。
 * 「解锁上限」对该来源不起作用（custom、minimax）时返回 null，表示不改这个字段。
 * @param {{ source: string, model?: string, context: number }} options 来源、模型和要保存的上下文长度
 * @returns {boolean | null} 解锁标记
 */
export function resolveChatContextUnlock({ source, model = '', context }) {
    const limits = getChatCompletionContextLimits({ source, model, unlocked: false });
    if (!limits.unlockApplies) {
        return null;
    }
    return Number(context) > limits.max;
}

/**
 * 提示词预算 = 上下文长度 − 回复上限。
 * @param {number} context 上下文长度
 * @param {number} responseTokens 回复上限（Max Tokens / 回复长度）
 * @returns {number} 预算，不是有限数字时返回 NaN
 */
export function getPromptBudget(context, responseTokens) {
    const contextValue = Number(context);
    const responseValue = Number(responseTokens);
    if (!Number.isFinite(contextValue) || !Number.isFinite(responseValue)) {
        return NaN;
    }
    return contextValue - responseValue;
}

/**
 * @typedef {{ text: string, level: 'info' | 'warning' }} LimitHint
 */

/**
 * 说明文字末尾的提示词预算。预算不大于 0 时给出警告，不写负数。
 * @param {number} context 上下文长度
 * @param {number} response 回复长度
 * @returns {LimitHint | null} 没有可显示内容时为 null
 */
function describeBudget(context, response) {
    const budget = getPromptBudget(context, response);
    if (!Number.isFinite(budget)) {
        return null;
    }
    if (budget <= 0) {
        return { text: '回复长度不小于上下文长度，没有空间放提示词', level: 'warning' };
    }
    return { text: `提示词预算 ${formatNumber(budget)}（上下文 − 回复长度）`, level: 'info' };
}

/**
 * @param {Array<LimitHint | null>} parts 各段说明
 * @returns {LimitHint} 合并后的说明，任一段是警告整体就是警告
 */
function joinHints(parts) {
    const present = /** @type {LimitHint[]} */ (parts.filter(Boolean));
    return {
        text: present.map(part => part.text).join('；'),
        level: present.some(part => part.level === 'warning') ? 'warning' : 'info',
    };
}

/**
 * 聊天补全「上下文长度」下方的说明：该来源和模型的上限（超过时警告，不拦截），以及提示词预算。
 * @param {{ source: string, model?: string, context?: number | string, maxTokens?: number | string }} options 来源、模型和当前输入
 * @returns {LimitHint} 说明
 */
export function describeChatCompletionContext({ source, model = '', context, maxTokens }) {
    const limits = getChatCompletionContextLimits({ source, model, unlocked: false });
    const contextValue = toFiniteNumber(context);
    /** @type {LimitHint} */
    let limitHint;
    if (!limits.unlockApplies && limits.max >= CHAT_COMPLETION_CONTEXT_UNLOCKED_MAX) {
        limitHint = { text: '该来源不限制上下文长度，按模型实际支持的长度填写', level: 'info' };
    } else if (limits.dynamic) {
        limitHint = { text: `参考上限 ${formatNumber(limits.max)}，实际以该来源的模型列表为准`, level: 'info' };
    } else if (Number.isFinite(contextValue) && contextValue > limits.max) {
        limitHint = { text: `超过当前模型已知上限 ${formatNumber(limits.max)}，请求可能被服务拒绝`, level: 'warning' };
    } else {
        limitHint = { text: `当前模型已知上限 ${formatNumber(limits.max)}`, level: 'info' };
    }
    return joinHints([limitHint, describeBudget(contextValue, toFiniteNumber(maxTokens))]);
}

/**
 * 「填入模型上限」按钮能填的值。依赖模型列表或不限制长度的来源没有确定的上限，返回 null。
 * @param {{ source: string, model?: string }} options 来源和模型
 * @returns {number | null} 上限
 */
export function getChatCompletionSuggestedContext({ source, model = '' }) {
    const limits = getChatCompletionContextLimits({ source, model, unlocked: false });
    if (limits.dynamic || (!limits.unlockApplies && limits.max >= CHAT_COMPLETION_CONTEXT_UNLOCKED_MAX)) {
        return null;
    }
    return limits.max;
}

/**
 * 文本补全（以及 KoboldAI、NovelAI、AI Horde 共用的 max_context / amount_gen）允许填写的范围，
 * 即旧版勾选「解锁」后的范围（power-user.js:83-86）。
 */
export const TEXT_COMPLETION_INPUT_RANGE = Object.freeze({
    context: Object.freeze({ min: TEXT_COMPLETION_CONTEXT_MIN, max: TEXT_COMPLETION_CONTEXT_UNLOCKED_MAX }),
    response: Object.freeze({ min: TEXT_COMPLETION_RESPONSE_MIN, max: TEXT_COMPLETION_RESPONSE_UNLOCKED_MAX }),
});

/**
 * 保存上下文 / 回复长度时 power_user.max_context_unlocked 应取的值：任一项超过旧版未解锁的上限（8,192 / 2,048）就打开，
 * 否则引擎载入设置时会把值钳回上限（power-user.js switchMaxContextSize）。
 * @param {{ context: number, response: number }} options 要保存的上下文长度和回复长度
 * @returns {boolean} 解锁标记
 */
export function resolveTextContextUnlock({ context, response }) {
    return Number(context) > TEXT_COMPLETION_CONTEXT_DEFAULT_MAX || Number(response) > TEXT_COMPLETION_RESPONSE_DEFAULT_MAX;
}

// 引擎对 NovelAI 的 Clio / Kayra / Erato 固定只用 8,192（public/script.js getMaxContextTokens）
const NOVEL_CONTEXT_CAP = 8192;

/**
 * 文本补全类「上下文长度 / 回复长度」下方的说明：NovelAI 的引擎上限，以及提示词预算。
 * @param {{ mainApi?: string, context?: number | string, response?: number | string }} options 主 API 和当前输入
 * @returns {LimitHint} 说明
 */
export function describeTextCompletionContext({ mainApi = '', context, response }) {
    const contextValue = toFiniteNumber(context);
    const novelHint = mainApi === 'novel' && Number.isFinite(contextValue) && contextValue > NOVEL_CONTEXT_CAP
        ? { text: `引擎对 NovelAI 最多使用 ${formatNumber(NOVEL_CONTEXT_CAP)}，超出的部分不会生效`, level: /** @type {const} */ ('warning') }
        : null;
    return joinHints([novelHint, describeBudget(contextValue, toFiniteNumber(response))]);
}

/**
 * 整数输入框的范围错误，合法时返回空字符串。
 * @param {{ label: string, text: unknown, min: number, max: number }} options 字段名、输入文字和允许范围
 * @returns {string} 错误文案
 */
export function getIntegerRangeError({ label, text, min, max }) {
    const trimmed = String(text ?? '').trim();
    if (!trimmed) {
        return `请填写 ${label}`;
    }
    const value = Number(trimmed);
    if (!Number.isInteger(value) || value < min || value > max) {
        return `${label} 需为 ${formatNumber(min)} 到 ${formatNumber(max)} 之间的整数`;
    }
    return '';
}

function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '') {
        return NaN;
    }
    return Number(value);
}

/**
 * 从已保存的设置里读出当前主 API 的上下文长度和回复上限。
 * 聊天补全用 oai_settings.openai_max_context / openai_max_tokens，其余主 API 用顶层 max_context / amount_gen。
 * @param {Record<string, any> | null | undefined} settings state.settings
 * @param {string} [mainApi] 主 API，缺省取 settings.main_api
 * @returns {{ mainApi: string, contextLimit: number | null, responseLimit: number | null }} 没有数据的项为 null
 */
export function readContextSettings(settings, mainApi = '') {
    const api = mainApi || settings?.main_api || '';
    const isChatCompletion = api === 'openai';
    const oai = settings?.oai_settings || {};
    const context = toFiniteNumber(isChatCompletion ? (oai.openai_max_context ?? CHAT_COMPLETION_CONTEXT_DEFAULT) : settings?.max_context);
    const response = toFiniteNumber(isChatCompletion ? (oai.openai_max_tokens ?? CHAT_COMPLETION_RESPONSE_DEFAULT) : settings?.amount_gen);

    return {
        mainApi: api,
        contextLimit: Number.isFinite(context) ? context : null,
        responseLimit: Number.isFinite(response) ? response : null,
    };
}

/**
 * 把百分比写成最多一位小数的文字，例如 38.9、100。
 * @param {number} percent 百分比数值
 * @returns {string} 文字
 */
export function formatPercent(percent) {
    return String(Number(percent.toFixed(1)));
}

/**
 * @typedef {object} UsageSummary
 * @property {number} used 上次发送（或预估下次发送）的提示词 token 数
 * @property {number} budget 提示词预算（上下文 − 回复上限）
 * @property {number | null} percent 占用百分比，预算不大于 0 时为 null
 * @property {number | null} contextLimit 设置里的上下文上限
 * @property {number | null} responseLimit 设置里的回复上限
 */

/**
 * 把提示词分解快照（bridge 的 getItemizedPrompt 结果，或 estimatePrompt 的估算，两者的 totalTokens / maxContext / mainApi 含义相同）整理成用量摘要。
 * 快照里的 maxContext 是引擎按当时设置算出的「上下文 − 回复上限」，即提示词预算，不是上下文本身。
 * @param {{ available?: boolean, totalTokens?: number, maxContext?: number, mainApi?: string } | null | undefined} snapshot 提示词分解快照
 * @param {Record<string, any> | null | undefined} settings state.settings
 * @returns {UsageSummary | null} 没有可用快照时返回 null
 */
export function getUsageSummary(snapshot, settings) {
    if (!snapshot || snapshot.available === false) {
        return null;
    }

    const used = Number(snapshot.totalTokens);
    const budget = Number(snapshot.maxContext);
    if (!Number.isFinite(used) || !Number.isFinite(budget)) {
        return null;
    }

    const { contextLimit, responseLimit } = readContextSettings(settings, snapshot.mainApi || '');
    return {
        used,
        budget,
        percent: budget > 0 ? (used / budget) * 100 : null,
        contextLimit,
        responseLimit,
    };
}
