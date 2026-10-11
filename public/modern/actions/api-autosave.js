// 设置中心「模型连接」标签的改动即保存：每个字段失焦或选择后单独校验、单独保存，互不牵连。
// 端点没填不会挡住上下文长度的保存，某个字段填错也只是它自己不保存。
//
// resolveConnectionField 是纯函数：输入框 + 当前设置 → 要写入的路径和值（或错误）。写入、回滚、通知引擎由
// actions/settings-autosave.js 完成；这里的工厂只负责把结果落到页面（字段错误、说明文字、需要时重绘）。
import { chatCompletionModelFields, secretKeyByChatSource } from '../core/constants.js';
import { secretKeyByTextCompletionType, textCompletionModelFields } from '../core/connection-labels.js';
import { formatNumber } from '../core/utils.js';
import { recordRecentModel } from './connection-profiles.js';
import {
    CHAT_COMPLETION_CONTEXT_INPUT_RANGE,
    TEXT_COMPLETION_INPUT_RANGE,
    describeChatCompletionContext,
    describeTextCompletionContext,
    getChatCompletionSuggestedContext,
    resolveChatContextUnlock,
    resolveTextContextUnlock,
} from './chat-completion-limits.js';

// 聊天补全数值参数：范围与旧版界面一致（public/index.html 的 #temp_openai、#top_p_openai、#freq_pen_openai、
// #pres_pen_openai 滑块和 #openai_max_tokens 输入框）；上下文长度不再按来源限制，只限 512 到 2,000,000。
export const CHAT_COMPLETION_NUMBER_FIELDS = Object.freeze([
    Object.freeze({ key: 'temperature', selector: '[data-api-temperature]', label: 'Temperature', setting: 'temp_openai', min: 0, max: 2, integer: false }),
    Object.freeze({ key: 'maxTokens', selector: '[data-api-max-tokens]', label: '回复长度', setting: 'openai_max_tokens', min: 1, max: 128000, integer: true }),
    Object.freeze({ key: 'maxContext', selector: '[data-api-max-context]', label: '上下文长度', setting: 'openai_max_context', ...CHAT_COMPLETION_CONTEXT_INPUT_RANGE, integer: true }),
    Object.freeze({ key: 'topP', selector: '[data-api-top-p]', label: 'Top P', setting: 'top_p_openai', min: 0, max: 1, integer: false }),
    Object.freeze({ key: 'frequencyPenalty', selector: '[data-api-frequency-penalty]', label: 'Frequency Penalty', setting: 'freq_pen_openai', min: -2, max: 2, integer: false }),
    Object.freeze({ key: 'presencePenalty', selector: '[data-api-presence-penalty]', label: 'Presence Penalty', setting: 'pres_pen_openai', min: -2, max: 2, integer: false }),
]);

// 文本补全类（文本补全、KoboldAI、NovelAI、AI Horde）共用的顶层 max_context / amount_gen
export const TEXT_COMPLETION_LENGTH_FIELDS = Object.freeze([
    Object.freeze({ key: 'textMaxContext', selector: '[data-textgen-max-context]', label: '上下文长度', setting: 'max_context', ...TEXT_COMPLETION_INPUT_RANGE.context, integer: true }),
    Object.freeze({ key: 'textAmountGen', selector: '[data-textgen-amount-gen]', label: '回复长度', setting: 'amount_gen', ...TEXT_COMPLETION_INPUT_RANGE.response, integer: true }),
]);

/**
 * @typedef {import('./settings-autosave.js').SettingsChanges} SettingsChanges
 * @typedef {object} FieldResolution
 * @property {string} key 字段标识，也用作字段错误的 data-api-field-error
 * @property {string} label 状态提示里的名称
 * @property {string} [error] 校验错误；有错误时不保存
 * @property {SettingsChanges} [changes] 要写入的路径和值
 * @property {{ key: string, value: string, label: string }} [secret] 要写入的密钥
 * @property {boolean} [rerender] 保存后整页重绘（主 API、来源这类会改变表单结构的字段）
 * @property {() => void} [afterSave] 保存成功后的附加动作
 */

/**
 * @param {string} text 输入
 * @returns {boolean} 是否为 http(s) 完整地址
 */
function isHttpUrl(text) {
    try {
        const url = new URL(text);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * 数值字段的取值或错误。
 * @param {{ label: string, min?: number, max?: number, integer?: boolean }} field 字段定义
 * @param {HTMLInputElement} input 输入框
 * @returns {{ value?: number, error?: string }} 结果
 */
export function parseNumberField(field, input) {
    if (input.validity?.badInput) {
        return { error: `${field.label} 必须是数字` };
    }
    const text = String(input.value ?? '').trim();
    if (!text) {
        return { error: `请填写 ${field.label}` };
    }
    const value = Number(text);
    if (!Number.isFinite(value)) {
        return { error: `${field.label} 必须是数字` };
    }
    const hasRange = Number.isFinite(field.min) && Number.isFinite(field.max);
    const show = value >= 10000 || (field.max ?? 0) >= 10000 ? formatNumber : String;
    if (field.integer && (!Number.isInteger(value) || (hasRange && (value < field.min || value > field.max)))) {
        return { error: hasRange ? `${field.label} 需为 ${show(field.min)} 到 ${show(field.max)} 之间的整数` : `${field.label} 需为整数` };
    }
    if (hasRange && (value < field.min || value > field.max)) {
        return { error: `${field.label} 需在 ${show(field.min)} 到 ${show(field.max)} 之间` };
    }
    return { value };
}

/**
 * @param {Record<string, any>} settings state.settings
 * @returns {string} 当前聊天补全来源
 */
function getChatSource(settings) {
    return settings.oai_settings?.chat_completion_source || settings.chat_completion_source || 'openai';
}

/**
 * @param {Record<string, any>} settings state.settings
 * @param {string} source 来源
 * @returns {string} 该来源已保存的模型
 */
function getSavedChatModel(settings, source) {
    const oai = settings.oai_settings || {};
    return oai[chatCompletionModelFields[source] || 'openai_model'] || oai.openai_model || '';
}

/**
 * 上下文长度的解锁标记要跟着来源、模型一起更新：换成上限更小的模型时，已保存的上下文可能超过新上限。
 * @param {Record<string, any>} settings state.settings
 * @param {{ source?: string, model?: string, context?: number }} next 将要保存的值，未给的取已保存的值
 * @returns {SettingsChanges} 需要写入的解锁标记（不需要时为空）
 */
function chatUnlockChanges(settings, next) {
    const source = next.source ?? getChatSource(settings);
    const model = next.model ?? getSavedChatModel(settings, source);
    const context = next.context ?? Number(settings.oai_settings?.openai_max_context);
    if (!Number.isFinite(context)) {
        return [];
    }
    const unlocked = resolveChatContextUnlock({ source, model, context });
    return unlocked === null ? [] : [[['oai_settings', 'max_context_unlocked'], unlocked]];
}

/**
 * @param {Record<string, any>} settings state.settings
 * @returns {string} 当前文本补全来源
 */
function getTextSource(settings) {
    return settings.textgenerationwebui_settings?.type || settings.textgen_type || 'ooba';
}

/**
 * 把一个连接字段的改动解析成要写入的设置。不认识的输入框返回 null。
 * @param {HTMLInputElement | HTMLSelectElement} input 发生改动的控件
 * @param {Record<string, any>} settings state.settings
 * @returns {FieldResolution | null} 解析结果
 */
export function resolveConnectionField(input, settings) {
    const value = input instanceof HTMLSelectElement && input.multiple
        ? ''
        : String(input.value ?? '').trim();

    if (input.matches('[data-api-main]')) {
        return { key: 'main', label: '主 API', changes: [[['main_api'], value]], rerender: true };
    }

    // ------------------------------------------------------------ 聊天补全
    if (input.matches('[data-api-source]')) {
        return {
            key: 'source',
            label: '聊天补全来源',
            changes: [
                [['chat_completion_source'], value],
                [['oai_settings', 'chat_completion_source'], value],
                ...chatUnlockChanges(settings, { source: value }),
            ],
            rerender: true,
        };
    }
    if (input.matches('[data-api-endpoint]')) {
        return { key: 'siliconflowEndpoint', label: 'SiliconFlow 端点', changes: [[['oai_settings', 'siliconflow_endpoint'], value === 'cn' ? 'cn' : 'global']] };
    }
    if (input.matches('[data-api-custom-url]')) {
        if (!value) {
            return { key: 'customUrl', label: 'Custom URL', error: '请填写 Custom URL（OpenAI 兼容服务的地址）' };
        }
        if (!isHttpUrl(value)) {
            return { key: 'customUrl', label: 'Custom URL', error: 'Custom URL 需是以 http:// 或 https:// 开头的完整地址' };
        }
        return { key: 'customUrl', label: 'Custom URL', changes: [[['oai_settings', 'custom_url'], value]] };
    }
    if (input.matches('[data-api-reverse-proxy]')) {
        if (value && !isHttpUrl(value)) {
            return { key: 'reverseProxy', label: '反向代理', error: '反向代理需是以 http:// 或 https:// 开头的完整地址，不用时留空' };
        }
        return { key: 'reverseProxy', label: '反向代理', changes: [[['oai_settings', 'reverse_proxy'], value]] };
    }
    if (input.matches('[data-api-model]')) {
        const source = getChatSource(settings);
        const field = chatCompletionModelFields[source];
        if (!field) {
            return { key: 'model', label: '模型', error: '当前来源不支持在这里设置模型' };
        }
        if (!value) {
            return { key: 'model', label: '模型', error: '请填写模型名称' };
        }
        return {
            key: 'model',
            label: '模型',
            changes: [[['oai_settings', field], value], ...chatUnlockChanges(settings, { source, model: value })],
            afterSave: () => recordRecentModel('openai', source, value),
        };
    }
    if (input.matches('[data-api-key]')) {
        const source = getChatSource(settings);
        const secretKey = secretKeyByChatSource[source];
        if (!value) {
            return { key: 'apiKey', label: 'API Key' };
        }
        if (!secretKey) {
            return { key: 'apiKey', label: 'API Key', error: '当前来源没有可写入的密钥' };
        }
        return { key: 'apiKey', label: 'API Key', secret: { key: secretKey, value, label: `${source} modern` }, rerender: true };
    }
    const chatNumberField = CHAT_COMPLETION_NUMBER_FIELDS.find(field => input.matches(field.selector));
    if (chatNumberField && input instanceof HTMLInputElement) {
        const parsed = parseNumberField(chatNumberField, input);
        if (parsed.error) {
            return { key: chatNumberField.key, label: chatNumberField.label, error: parsed.error };
        }
        /** @type {SettingsChanges} */
        const changes = [[['oai_settings', chatNumberField.setting], parsed.value]];
        if (chatNumberField.key === 'maxContext') {
            changes.push(...chatUnlockChanges(settings, { context: parsed.value }));
        }
        return { key: chatNumberField.key, label: chatNumberField.label, changes };
    }

    // ------------------------------------------------------------ 文本补全
    if (input.matches('[data-textgen-type]')) {
        return { key: 'textgenType', label: '文本补全来源', changes: [[['textgenerationwebui_settings', 'type'], value]], rerender: true };
    }
    if (input.matches('[data-textgen-endpoint]')) {
        if (!value) {
            return { key: 'textgenEndpoint', label: '端点', error: '请填写服务地址，例如 http://127.0.0.1:5000' };
        }
        if (!isHttpUrl(value)) {
            return { key: 'textgenEndpoint', label: '端点', error: '端点需是以 http:// 或 https:// 开头的完整地址' };
        }
        return { key: 'textgenEndpoint', label: '端点', changes: [[['textgenerationwebui_settings', 'server_urls', getTextSource(settings)], value]] };
    }
    if (input.matches('[data-textgen-model]')) {
        const source = getTextSource(settings);
        const field = textCompletionModelFields[source];
        if (!field) {
            return { key: 'textgenModel', label: '模型', error: '当前来源由服务端决定模型，不需要填写' };
        }
        return {
            key: 'textgenModel',
            label: '模型',
            changes: [[['textgenerationwebui_settings', field], value]],
            afterSave: () => value && recordRecentModel('textgenerationwebui', source, value),
        };
    }
    if (input.matches('[data-textgen-preset]')) {
        return { key: 'textgenPreset', label: '文本补全预设', changes: [[['textgenerationwebui_settings', 'preset'], value]] };
    }
    if (input.matches('[data-textgen-sampling]') && input instanceof HTMLInputElement) {
        const key = input.dataset.textgenSampling || '';
        const label = input.closest('.field-label')?.querySelector('span')?.textContent?.trim() || key;
        const parsed = parseNumberField({ label }, input);
        if (parsed.error) {
            return { key: `textgenSampling-${key}`, label, error: parsed.error };
        }
        return { key: `textgenSampling-${key}`, label, changes: [[['textgenerationwebui_settings', key], parsed.value]] };
    }
    if (input.matches('[data-textgen-api-key]')) {
        const source = getTextSource(settings);
        const secretKey = secretKeyByTextCompletionType[source];
        if (!value) {
            return { key: 'textgenApiKey', label: 'API Key' };
        }
        if (!secretKey) {
            return { key: 'textgenApiKey', label: 'API Key', error: '当前来源没有可写入的密钥' };
        }
        return { key: 'textgenApiKey', label: 'API Key', secret: { key: secretKey, value, label: `${source} modern text completion` }, rerender: true };
    }
    const lengthField = TEXT_COMPLETION_LENGTH_FIELDS.find(field => input.matches(field.selector));
    if (lengthField && input instanceof HTMLInputElement) {
        const parsed = parseNumberField(lengthField, input);
        if (parsed.error) {
            return { key: lengthField.key, label: lengthField.label, error: parsed.error };
        }
        const context = lengthField.setting === 'max_context' ? parsed.value : Number(settings.max_context);
        const response = lengthField.setting === 'amount_gen' ? parsed.value : Number(settings.amount_gen);
        return {
            key: lengthField.key,
            label: lengthField.label,
            changes: [
                [[lengthField.setting], parsed.value],
                [['power_user', 'max_context_unlocked'], resolveTextContextUnlock({ context, response })],
            ],
        };
    }

    // ------------------------------------------------------------ KoboldAI / NovelAI / AI Horde
    if (input.matches('[data-kobold-api-url]')) {
        if (!value) {
            return { key: 'koboldUrl', label: '服务地址', error: '请填写 KoboldAI 服务地址' };
        }
        if (!isHttpUrl(value)) {
            return { key: 'koboldUrl', label: '服务地址', error: '服务地址需是以 http:// 或 https:// 开头的完整地址' };
        }
        // 引擎优先读 kai_settings.api_server（kai-settings.js loadKoboldSettings），有这个对象时两处都写
        const changes = /** @type {SettingsChanges} */ ([[['api_server'], value]]);
        if (settings.kai_settings && typeof settings.kai_settings === 'object') {
            changes.push([['kai_settings', 'api_server'], value]);
        }
        return { key: 'koboldUrl', label: '服务地址', changes };
    }
    if (input.matches('[data-novel-model]')) {
        // 引擎从 nai_settings 读模型（script.js loadNovelSettings(data, settings.nai_settings ?? settings)）
        const changes = /** @type {SettingsChanges} */ ([[['model_novel'], value]]);
        if (settings.nai_settings && typeof settings.nai_settings === 'object') {
            changes.push([['nai_settings', 'model_novel'], value]);
        }
        return { key: 'novelModel', label: 'NovelAI 模型', changes };
    }
    if (input.matches('[data-novel-api-key]')) {
        return value
            ? { key: 'novelApiKey', label: 'API Key', secret: { key: 'api_key_novel', value, label: 'novel modern' }, rerender: true }
            : { key: 'novelApiKey', label: 'API Key' };
    }
    if (input.matches('[data-horde-model]') && input instanceof HTMLSelectElement) {
        const models = Array.from(input.selectedOptions).map(option => option.value).filter(Boolean);
        return { key: 'hordeModels', label: 'AI Horde 模型', changes: [[['horde_settings', 'models'], models]] };
    }
    if (input.matches('[data-horde-api-key]')) {
        return value
            ? { key: 'hordeApiKey', label: 'API Key', secret: { key: 'api_key_horde', value, label: 'horde modern' }, rerender: true }
            : { key: 'hordeApiKey', label: 'API Key' };
    }

    return null;
}

/**
 * 在字段下方显示或移除错误。
 * @param {Element} input 字段控件
 * @param {string} key 字段标识
 * @param {string} message 错误，空字符串表示移除
 */
export function setConnectionFieldError(input, key, message) {
    const host = input.closest('.field-label') || input.parentElement;
    const errorId = `api-field-error-${key}`;
    let errorElement = host?.querySelector(`[data-api-field-error="${key}"]`);
    if (!message) {
        input.removeAttribute('aria-invalid');
        if (input.getAttribute('aria-describedby') === errorId) {
            input.removeAttribute('aria-describedby');
        }
        errorElement?.remove();
        return;
    }
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', errorId);
    if (!errorElement) {
        errorElement = input.ownerDocument.createElement('span');
        errorElement.className = 'field-error';
        errorElement.id = errorId;
        errorElement.setAttribute('role', 'alert');
        errorElement.setAttribute('data-api-field-error', key);
        host?.append(errorElement);
    }
    errorElement.textContent = message;
}

/**
 * 保存成功后把控件的「初始值」对齐到当前值，之后整页重绘时它不再算作未提交的输入（见 core/preserve-inputs.js）。
 * @param {HTMLInputElement | HTMLSelectElement} input 控件
 */
function markControlClean(input) {
    if (input instanceof HTMLSelectElement) {
        for (const option of input.options) {
            option.defaultSelected = option.selected;
        }
        return;
    }
    if (input.type === 'checkbox' || input.type === 'radio') {
        input.defaultChecked = input.checked;
        return;
    }
    input.defaultValue = input.value;
}

/**
 * 保存失败后把控件退回渲染时的值。
 * @param {HTMLInputElement | HTMLSelectElement} input 控件
 */
function revertControl(input) {
    if (input instanceof HTMLSelectElement) {
        for (const option of input.options) {
            option.selected = option.defaultSelected;
        }
        return;
    }
    if (input.type === 'checkbox' || input.type === 'radio') {
        input.checked = input.defaultChecked;
        return;
    }
    input.value = input.defaultValue;
}

/**
 * 按输入框里的当前值（还没失焦保存的也算）更新上下文长度下方的说明和「填入模型上限」按钮。只改现有元素，不重绘。
 * @param {Record<string, any>} settings state.settings
 * @param {ParentNode | null | undefined} root 表单所在容器
 */
export function refreshConnectionHints(settings, root) {
    const chatContext = root?.querySelector('[data-api-max-context]');
    if (chatContext instanceof HTMLInputElement) {
        const source = getChatSource(settings);
        const modelInput = root.querySelector('[data-api-model]');
        const model = modelInput instanceof HTMLInputElement && modelInput.value.trim() ? modelInput.value.trim() : getSavedChatModel(settings, source);
        const maxTokens = root.querySelector('[data-api-max-tokens]');
        const hint = describeChatCompletionContext({
            source,
            model,
            context: chatContext.value,
            maxTokens: maxTokens instanceof HTMLInputElement ? maxTokens.value : undefined,
        });
        paintHint(root.querySelector('[data-api-context-hint]'), hint);
        const fill = root.querySelector('[data-api-context-fill]');
        if (fill instanceof HTMLButtonElement) {
            const suggested = getChatCompletionSuggestedContext({ source, model });
            fill.hidden = suggested === null || String(suggested) === chatContext.value.trim();
            fill.dataset.apiContextFill = suggested === null ? '' : String(suggested);
            fill.textContent = suggested === null ? '' : `填入模型上限 ${formatNumber(suggested)}`;
        }
    }

    const textContext = root?.querySelector('[data-textgen-max-context]');
    if (textContext instanceof HTMLInputElement) {
        const response = root.querySelector('[data-textgen-amount-gen]');
        const hint = describeTextCompletionContext({
            mainApi: settings.main_api || '',
            context: textContext.value,
            response: response instanceof HTMLInputElement ? response.value : undefined,
        });
        paintHint(root.querySelector('[data-textgen-context-hint]'), hint);
    }
}

/**
 * @param {Element | null} element 说明文字元素
 * @param {{ text: string, level: string }} hint 说明
 */
function paintHint(element, hint) {
    if (!(element instanceof HTMLElement)) {
        return;
    }
    element.textContent = hint.text;
    element.classList.toggle('is-warning', hint.level === 'warning');
    element.hidden = !hint.text;
}

/**
 * @param {object} options 依赖
 * @param {any} options.state 页面状态
 * @param {() => void} options.render 整页重绘
 * @param {ReturnType<typeof import('./settings-autosave.js').createSettingsAutosave>} options.autosave 改动即保存
 */
export function createConnectionFieldAutosave({ state, render, autosave }) {
    /**
     * 保存一个连接字段。不是连接字段时返回 false。
     * @param {EventTarget | null} target 发生改动的控件
     * @returns {Promise<boolean>} 是否已处理
     */
    async function saveConnectionField(target) {
        if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
            return false;
        }
        const resolution = resolveConnectionField(target, state.settings || {});
        if (!resolution) {
            return false;
        }
        setConnectionFieldError(target, resolution.key, resolution.error || '');
        if (resolution.error) {
            autosave.markInvalid(resolution.error);
            return true;
        }

        if (resolution.secret) {
            const result = await autosave.commitSecret({ ...resolution.secret, description: resolution.label });
            if (result.ok) {
                target.value = '';
                markControlClean(target);
                render();
            }
            return true;
        }
        if (!resolution.changes?.length) {
            return true;
        }

        const result = await autosave.commit({ changes: resolution.changes, label: resolution.label });
        if (!result.ok) {
            // 设置已回滚到改动前：输入框也退回渲染时的值，再重绘（否则重绘会把没保存成功的输入当成未提交的内容留下）
            revertControl(target);
            render();
            return true;
        }
        markControlClean(target);
        if (!result.unchanged) {
            resolution.afterSave?.();
        }
        if (resolution.rerender && !result.unchanged) {
            render();
        } else {
            refreshConnectionHints(state.settings || {}, target.closest('form'));
        }
        return true;
    }

    /**
     * 「填入模型上限」：把建议值写进上下文长度并保存。
     * @param {HTMLElement} button 按钮
     * @returns {Promise<void>}
     */
    async function fillSuggestedContext(button) {
        const input = button.closest('form')?.querySelector('[data-api-max-context]');
        const value = button.dataset.apiContextFill || '';
        if (!(input instanceof HTMLInputElement) || !value) {
            return;
        }
        input.value = value;
        await saveConnectionField(input);
        input.focus();
    }

    /**
     * 点「常用模型」里的一项：填进模型框并保存。
     * @param {string} model 模型名
     * @returns {Promise<void>}
     */
    async function applyModelSuggestion(model) {
        const input = document.querySelector('[data-api-model]');
        if (!(input instanceof HTMLInputElement)) {
            return;
        }
        input.value = model;
        await saveConnectionField(input);
    }

    /**
     * 连接表单里还有没通过校验的字段时返回第一条错误（测试连接前检查，避免拿着页面上看到的错值去测）。
     * @returns {string} 错误，没有时为空字符串
     */
    function getPendingFieldError() {
        const error = document.querySelector('[data-api-connection-form] [data-api-field-error]');
        return error?.textContent?.trim() || '';
    }

    return {
        saveConnectionField,
        fillSuggestedContext,
        applyModelSuggestion,
        getPendingFieldError,
    };
}
