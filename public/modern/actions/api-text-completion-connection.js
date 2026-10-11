import { secretKeyByTextCompletionType, textCompletionModelFields } from '../core/connection-labels.js';
import { describeReloadFailure, noEngineSync } from '../core/bridge-reload.js';
import { saveSettingsSerialized } from '../core/keyed-queue.js';
import { formatNumber } from '../core/utils.js';
import { getChatCompletionFieldErrorElement, showChatCompletionFieldError } from './api-chat-completion-connection.js';
import { recordRecentModel } from './connection-profiles.js';
import {
    describeTextCompletionLimitHint,
    getIntegerRangeError,
    getPromptBudget,
    getTextCompletionLimits,
} from './chat-completion-limits.js';

const textCompletionSamplingDefaults = {
    temp: 0.7,
    top_p: 0.5,
    top_k: 40,
    min_p: 0,
    rep_pen: 1.2,
    rep_pen_range: 0,
};

// 上下文长度 / 回复长度：顶层 max_context / amount_gen，范围随「解锁上限」（power_user.max_context_unlocked）变化。
// key 同时用作字段级错误的标识（data-api-field-error、aria-describedby 的 id）。
const TEXT_COMPLETION_LIMIT_FIELDS = Object.freeze([
    Object.freeze({ key: 'textMaxContext', selector: '[data-textgen-max-context]', label: '上下文长度', range: 'context', settingKey: 'max_context', fallback: 8192 }),
    Object.freeze({ key: 'textAmountGen', selector: '[data-textgen-amount-gen]', label: '回复长度', range: 'response', settingKey: 'amount_gen', fallback: 350 }),
]);

function readTextCompletionLimits(form) {
    const unlockedInput = form?.querySelector('[data-textgen-max-context-unlocked]');
    return getTextCompletionLimits({ unlocked: unlockedInput instanceof HTMLInputElement && unlockedInput.checked });
}

/**
 * 文本补全上下文长度 / 回复长度字段的错误文案，合法时为空字符串。
 * 范围错误之外，回复长度还必须小于上下文长度，否则提示词预算（上下文 − 回复长度）不大于 0。
 * @param {typeof TEXT_COMPLETION_LIMIT_FIELDS[number]} field 字段定义
 * @param {HTMLInputElement} input 字段输入框
 * @returns {string} 错误文案
 */
function getTextCompletionLimitFieldError(field, input) {
    const form = input.closest('form');
    const limits = readTextCompletionLimits(form);
    const range = limits[field.range];
    const rangeError = getIntegerRangeError({ label: field.label, text: input.value, min: range.min, max: range.max });
    if (rangeError) {
        return `${rangeError}${limits.unlocked ? '' : '（模型确实支持更长时，可勾选“解锁上限”放宽）'}`;
    }
    if (field.range === 'response') {
        const contextInput = form?.querySelector('[data-textgen-max-context]');
        const context = contextInput instanceof HTMLInputElement && contextInput.value.trim() !== '' ? Number(contextInput.value) : NaN;
        if (Number.isFinite(context) && getPromptBudget(context, Number(input.value)) <= 0) {
            return `${field.label} 需小于上下文长度（${formatNumber(context)}），否则没有空间放提示词`;
        }
    }
    return '';
}

/**
 * 解锁勾选、上下文长度或回复长度变化后更新说明文字，并重新判断已显示的字段错误（只增减文字，不插入或移除元素）。
 * @param {Element | null | undefined} container 表单或包含表单的容器（通常是 #content）
 */
export function refreshTextCompletionLimitUi(container) {
    const contextInput = container?.querySelector('[data-textgen-max-context]');
    const responseInput = container?.querySelector('[data-textgen-amount-gen]');
    if (!(contextInput instanceof HTMLInputElement) || !(responseInput instanceof HTMLInputElement)) {
        return;
    }
    const form = contextInput.closest('form');
    const limits = readTextCompletionLimits(form);
    const hint = form?.querySelector('[data-textgen-context-hint]');
    if (hint) {
        hint.textContent = describeTextCompletionLimitHint({ limits, context: contextInput.value, response: responseInput.value });
        const budget = getPromptBudget(Number(contextInput.value), Number(responseInput.value));
        hint.classList.toggle('is-warning', Number.isFinite(budget) && contextInput.value.trim() !== '' && budget <= 0);
    }
    for (const field of TEXT_COMPLETION_LIMIT_FIELDS) {
        const input = form?.querySelector(field.selector);
        const errorElement = input instanceof HTMLInputElement ? getChatCompletionFieldErrorElement(input, field) : null;
        if (!(input instanceof HTMLInputElement) || !(errorElement instanceof HTMLElement)) {
            continue;
        }
        const message = getTextCompletionLimitFieldError(field, input);
        if (message) {
            input.setAttribute('aria-invalid', 'true');
            errorElement.style.visibility = '';
            errorElement.textContent = message;
        } else {
            input.removeAttribute('aria-invalid');
            errorElement.style.visibility = 'hidden';
        }
    }
}

/**
 * 字段改动（change）后刷新文本补全长度字段已显示的错误和说明文字。
 * @param {EventTarget | null} target 发生变化的元素
 * @returns {boolean} 是否为文本补全的长度相关控件
 */
export function handleTextCompletionLimitChange(target) {
    if (!(target instanceof HTMLInputElement) || !target.matches('[data-textgen-max-context], [data-textgen-amount-gen], [data-textgen-max-context-unlocked]')) {
        return false;
    }
    refreshTextCompletionLimitUi(target.closest('form'));
    return true;
}

export function createApiTextCompletionConnectionActions({
    state,
    elements,
    apiFetch,
    loadData,
    render,
    showToast,
    numberInput,
    getNumberSetting,
    recordApiTestResult,
    reloadSettings = noEngineSync,
}) {
    function getTextCompletionSettings() {
        return state.settings.textgenerationwebui_settings || {};
    }

    function getTextCompletionModel(settings, source) {
        const modelField = textCompletionModelFields[source];
        return (modelField ? settings[modelField] : '') || settings.model || '';
    }

    function getTextCompletionEndpoint(settings, source) {
        return settings.server_urls?.[source] || settings.api_server || state.settings.api_server_textgenerationwebui || '';
    }

    function getTextCompletionSecretUiState(source) {
        const secretKey = secretKeyByTextCompletionType[source];
        const value = secretKey ? state.secretState?.[secretKey] : null;
        const secretState = Array.isArray(value) ? value : [];
        return {
            hasSecretMapping: Boolean(secretKey),
            secretKey: secretKey || '当前来源没有密钥映射',
            secretSaved: secretState.length > 0,
        };
    }

    function updateTextCompletionTypeFields(source) {
        const settings = getTextCompletionSettings();
        const endpointInput = elements.content.querySelector('[data-textgen-endpoint]');
        const modelInput = elements.content.querySelector('[data-textgen-model]');
        const keyInput = elements.content.querySelector('[data-textgen-api-key]');
        const keyField = elements.content.querySelector('[data-textgen-field="api-key"]');
        const secretBadge = elements.content.querySelector('[data-textgen-secret-status]');
        const secretKey = elements.content.querySelector('[data-textgen-secret-key]');
        const uiState = getTextCompletionSecretUiState(source);

        if (endpointInput) {
            endpointInput.value = getTextCompletionEndpoint(settings, source);
        }
        if (modelInput) {
            modelInput.value = getTextCompletionModel(settings, source);
        }
        if (keyField) {
            keyField.hidden = !uiState.hasSecretMapping;
        }
        if (keyInput) {
            keyInput.placeholder = uiState.secretSaved ? '密钥已保存；留空不修改' : '输入后保存到 secrets';
            keyInput.value = '';
        }
        if (secretBadge) {
            secretBadge.textContent = uiState.secretSaved ? '密钥已保存' : (uiState.hasSecretMapping ? '未保存密钥' : '无密钥字段');
        }
        if (secretKey) {
            secretKey.textContent = uiState.secretKey;
        }
    }

    function getTextCompletionSettingsFromForm() {
        const savedSettings = getTextCompletionSettings();
        const source = elements.content.querySelector('[data-textgen-type]')?.value || savedSettings.type || state.settings.textgen_type || 'ooba';
        const endpoint = elements.content.querySelector('[data-textgen-endpoint]')?.value.trim() || getTextCompletionEndpoint(savedSettings, source);
        const model = elements.content.querySelector('[data-textgen-model]')?.value.trim() || getTextCompletionModel(savedSettings, source);
        const preset = elements.content.querySelector('[data-textgen-preset]')?.value || savedSettings.preset || '';

        if (!endpoint) {
            throw new Error('当前文本补全表单没有可用端点。');
        }

        return {
            source,
            endpoint,
            model,
            preset,
            sampling: getTextCompletionSamplingSettings(savedSettings),
        };
    }

    function getTextCompletionSamplingSettings(savedSettings) {
        return Object.fromEntries(Object.entries(textCompletionSamplingDefaults).map(([key, fallback]) => {
            const input = elements.content.querySelector(`[data-textgen-sampling="${key}"]`);
            return [key, numberInput(input?.value, getNumberSetting(savedSettings, key, fallback))];
        }));
    }

    // 校验上下文长度 / 回复长度并在字段旁标出错误；有错误时聚焦第一个错误字段、提示并返回 false，调用方应中止保存。
    function validateTextCompletionLimitFields(toastTitle) {
        const errors = [];
        for (const field of TEXT_COMPLETION_LIMIT_FIELDS) {
            const input = elements.content.querySelector(field.selector);
            if (!(input instanceof HTMLInputElement)) {
                continue;
            }
            const message = getTextCompletionLimitFieldError(field, input);
            showChatCompletionFieldError(input, field, message);
            if (message) {
                errors.push({ input, message });
            }
        }
        if (!errors.length) {
            return true;
        }
        errors[0].input.focus();
        showToast(toastTitle, errors.map(item => item.message).join('；'));
        return false;
    }

    async function saveTextCompletionConnectionFromForm() {
        if (!validateTextCompletionLimitFields('文本补全连接未保存')) {
            return;
        }
        const settings = getTextCompletionSettingsFromForm();
        const textgenSettings = state.settings.textgenerationwebui_settings || {};
        const modelField = textCompletionModelFields[settings.source];
        const keyInput = elements.content.querySelector('[data-textgen-api-key]');
        const apiKey = keyInput?.value.trim() || '';

        if (modelField && !settings.model) {
            throw new Error('当前文本补全表单没有可用模型。');
        }

        state.settings.textgenerationwebui_settings = textgenSettings;
        state.settings.main_api = 'textgenerationwebui';
        textgenSettings.type = settings.source;
        textgenSettings.server_urls = { ...(textgenSettings.server_urls || {}), [settings.source]: settings.endpoint };
        textgenSettings.preset = settings.preset;
        Object.assign(textgenSettings, settings.sampling);
        if (modelField) {
            textgenSettings[modelField] = settings.model;
        }
        // 上下文长度 / 回复长度存在设置顶层，「解锁上限」存在 power_user 里，引擎重载设置时三个都会读到
        for (const field of TEXT_COMPLETION_LIMIT_FIELDS) {
            const input = elements.content.querySelector(field.selector);
            if (input instanceof HTMLInputElement) {
                state.settings[field.settingKey] = numberInput(input.value, getNumberSetting(state.settings, field.settingKey, field.fallback));
            }
        }
        const unlockedInput = elements.content.querySelector('[data-textgen-max-context-unlocked]');
        if (unlockedInput instanceof HTMLInputElement) {
            state.settings.power_user = state.settings.power_user || {};
            state.settings.power_user.max_context_unlocked = unlockedInput.checked;
        }

        if (apiKey) {
            const secretKey = secretKeyByTextCompletionType[settings.source];
            if (!secretKey) {
                throw new Error('当前文本补全来源没有可写入的密钥映射。');
            }
            await apiFetch('/api/secrets/write', { body: { key: secretKey, value: apiKey, label: `${settings.source} modern text completion` } });
        }

        await saveSettingsSerialized(apiFetch, state.settings);
        // 记入聊天输入框旁「最近使用的模型」（actions/connection-profiles.js）；没有模型字段的类型不记录
        if (modelField) {
            recordRecentModel('textgenerationwebui', settings.source, settings.model);
        }
        // 设置已落盘：先等生成引擎重载完，再更新界面状态和提示，保存后立刻发送也用新配置
        const engineSync = await reloadSettings();
        state.apiMainDraft = '';
        await loadData({ silent: true });
        showToast('文本补全连接已保存', `${settings.source} / ${settings.model || settings.endpoint}${describeReloadFailure(engineSync)}`);
    }

    async function testTextCompletionConnection() {
        const settings = getTextCompletionSettingsFromForm();

        state.apiTest = {
            running: true,
            status: '测试中',
            detail: `${settings.source} / ${settings.model || settings.endpoint}`,
        };
        render();

        try {
            const response = await apiFetch('/api/backends/text-completions/status', {
                body: {
                    api_server: settings.endpoint,
                    api_type: settings.source,
                },
            });
            const result = response?.result || settings.model || '已连接';
            state.apiTest = {
                running: false,
                status: '可用',
                detail: `${settings.source}: ${result}`,
            };
            recordApiTestResult('可用', state.apiTest.detail, {
                source: settings.source,
                model: settings.model || result,
            });
            showToast('文本补全连接测试成功', state.apiTest.detail);
        } catch (error) {
            state.apiTest = {
                running: false,
                status: '失败',
                detail: error.message,
            };
            recordApiTestResult('失败', error.message, {
                source: settings.source,
                model: settings.model || settings.endpoint,
            });
            throw error;
        } finally {
            render();
        }
    }

    return {
        saveTextCompletionConnectionFromForm,
        testTextCompletionConnection,
        updateTextCompletionTypeFields,
    };
}
