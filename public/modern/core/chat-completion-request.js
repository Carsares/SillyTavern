import { CHAT_COMPLETION_RESPONSE_DEFAULT } from '../actions/chat-completion-limits.js';

// 一次性（非流式）的聊天补全请求：组请求体、读回复。设置中心的「测试连接」（actions/api-chat-completion-connection.js）
// 和聊天页「从消息生成」提示词（actions/chat-image-prompt.js）共用。纯函数，不读全局状态，依赖都从参数传入。

/**
 * 与 actions/api-connection.js 的 getNumberSetting 同一口径：读不出有限数字时用默认值。
 * @param {Record<string, any>} settings 设置对象。
 * @param {string} key 字段名。
 * @param {number} fallback 默认值。
 * @returns {number}
 */
function readNumberSetting(settings, key, fallback) {
    const value = Number(settings[key]);
    return Number.isFinite(value) ? value : fallback;
}

/**
 * @typedef {object} ChatCompletionRequestSettings
 * @property {string} source 聊天补全来源（chat_completion_source）。
 * @property {string} model 模型名。
 * @property {number} temperature
 * @property {number} maxTokens 回复上限。
 * @property {number} topP
 * @property {number} frequencyPenalty
 * @property {number} presencePenalty
 * @property {string} siliconflowEndpoint
 * @property {string} minimaxEndpoint
 * @property {string} customUrl
 * @property {string} reverseProxy
 * @property {string} proxyPassword
 */

/**
 * 从已保存的聊天补全设置里取出请求要用的字段。没有填模型时抛错。
 * @param {object} input 依赖。
 * @param {Record<string, any>} input.oaiSettings 已保存的聊天补全设置（settings.oai_settings）。
 * @param {Record<string, any>} [input.settings] settings.json 全文（state.settings），oai_settings 里没有来源时读它的 chat_completion_source。
 * @param {(settings: Record<string, any>, source: string) => string} input.getChatCompletionModel 按来源取模型名。
 * @param {(settings: Record<string, any>, key: string, fallback: number) => number} [input.getNumberSetting] 读数字设置。
 * @returns {ChatCompletionRequestSettings}
 */
export function getChatCompletionSettingsForTest({ oaiSettings, settings, getChatCompletionModel, getNumberSetting = readNumberSetting }) {
    const savedSettings = oaiSettings || {};
    const source = savedSettings.chat_completion_source || settings?.chat_completion_source || 'openai';
    const model = getChatCompletionModel(savedSettings, source);

    if (!model) {
        throw new Error('还没有填写模型，填好后再测试。');
    }

    return {
        source,
        model,
        temperature: getNumberSetting(savedSettings, 'temp_openai', 1),
        maxTokens: getNumberSetting(savedSettings, 'openai_max_tokens', CHAT_COMPLETION_RESPONSE_DEFAULT),
        topP: getNumberSetting(savedSettings, 'top_p_openai', 1),
        frequencyPenalty: getNumberSetting(savedSettings, 'freq_pen_openai', 0),
        presencePenalty: getNumberSetting(savedSettings, 'pres_pen_openai', 0),
        siliconflowEndpoint: savedSettings.siliconflow_endpoint || 'global',
        minimaxEndpoint: savedSettings.minimax_endpoint || 'global',
        customUrl: savedSettings.custom_url || '',
        reverseProxy: savedSettings.reverse_proxy || '',
        proxyPassword: savedSettings.proxy_password || '',
    };
}

/**
 * @param {any} content 回复里的 content：字符串，或 [{ text } | { content }] 数组。
 * @returns {string}
 */
export function responseContentToText(content) {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content.map(item => item?.text || item?.content || '').filter(Boolean).join('\n');
    }
    return '';
}

/**
 * Mirrors the chat-completion shapes read by extractReasoningFromData in public/scripts/reasoning.js:
 * OpenAI-compatible reasoning_content / reasoning fields, plus Claude and Mistral "thinking" parts.
 * @param {any} response /api/backends/chat-completions/generate 的回复。
 * @returns {string}
 */
export function extractReasoningText(response) {
    const choice = response?.choices?.[0];
    const message = choice?.message;
    const thinkingText = [message?.content, response?.content]
        .filter(Array.isArray)
        .flat()
        .filter(part => part?.type === 'thinking')
        .map(part => responseContentToText(part.thinking))
        .join('\n');

    return [
        message?.reasoning_content,
        message?.reasoning,
        choice?.reasoning,
        thinkingText,
    ].map(responseContentToText).find(text => text.trim()) || '';
}

/**
 * 读出回复正文。后端把上游错误放在 HTTP 200 的 { error } 里返回，这里先检查它并抛错；没有正文也没有推理内容时抛错。
 * @param {any} response /api/backends/chat-completions/generate 的回复。
 * @returns {{ text: string, reasoningOnly: boolean }} reasoningOnly 为真表示只有推理内容、正文为空。
 */
export function readConnectionTestReply(response) {
    if (response?.error) {
        throw new Error(response.error.message || String(response.error));
    }

    const choice = response?.choices?.[0];
    const text = responseContentToText(choice?.message?.content)
        || responseContentToText(choice?.delta?.content)
        || responseContentToText(choice?.text)
        || responseContentToText(response?.message?.content)
        || responseContentToText(response?.content);

    if (text.trim()) {
        return { text: text.trim(), reasoningOnly: false };
    }

    // Reasoning models can spend the whole (deliberately small) test token budget on reasoning.
    // The request still reached the model and got a valid reply, so the connection itself works.
    if (extractReasoningText(response).trim()) {
        return { text: '', reasoningOnly: true };
    }

    throw new Error('模型没有返回可显示内容。');
}

/**
 * @param {ChatCompletionRequestSettings} settings getChatCompletionSettingsForTest 的结果。
 * @param {{ role: string, content: string }[]} messages 发送的消息。
 * @returns {Record<string, any>} /api/backends/chat-completions/generate 的请求体（stream: false）。
 */
export function createChatCompletionRequestBody(settings, messages) {
    return {
        chat_completion_source: settings.source,
        messages,
        model: settings.model,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        stream: false,
        top_p: settings.topP,
        frequency_penalty: settings.frequencyPenalty,
        presence_penalty: settings.presencePenalty,
        siliconflow_endpoint: settings.siliconflowEndpoint,
        minimax_endpoint: settings.minimaxEndpoint,
        custom_url: settings.customUrl,
        reverse_proxy: settings.reverseProxy,
        proxy_password: settings.proxyPassword,
        n: 1,
    };
}
