import { describeReloadFailure, noEngineSync } from '../core/bridge-reload.js';
import { saveSettingsSerialized } from '../core/keyed-queue.js';

// 聊天补全数值参数的允许范围，与旧版界面一致：public/index.html 中 #temp_openai、#top_p_openai、
// #freq_pen_openai、#pres_pen_openai 滑块和 #openai_max_tokens 输入框的 min / max。
export const CHAT_COMPLETION_NUMBER_FIELDS = Object.freeze([
    Object.freeze({ key: 'temperature', selector: '[data-api-temperature]', label: 'Temperature', min: 0, max: 2, integer: false }),
    Object.freeze({ key: 'maxTokens', selector: '[data-api-max-tokens]', label: 'Max Tokens', min: 1, max: 128000, integer: true }),
    Object.freeze({ key: 'topP', selector: '[data-api-top-p]', label: 'Top P', min: 0, max: 1, integer: false }),
    Object.freeze({ key: 'frequencyPenalty', selector: '[data-api-frequency-penalty]', label: 'Frequency Penalty', min: -2, max: 2, integer: false }),
    Object.freeze({ key: 'presencePenalty', selector: '[data-api-presence-penalty]', label: 'Presence Penalty', min: -2, max: 2, integer: false }),
]);

/**
 * 返回数值字段的错误文案，合法时返回空字符串。
 * @param {{ label: string, min: number, max: number, integer: boolean }} field 字段定义
 * @param {HTMLInputElement} input 字段输入框
 * @returns {string} 错误文案
 */
function getChatCompletionNumberFieldError(field, input) {
    if (input.validity?.badInput) {
        return `${field.label} 必须是数字`;
    }
    const text = String(input.value ?? '').trim();
    if (!text) {
        return `请填写 ${field.label}`;
    }
    const value = Number(text);
    const outOfRange = !Number.isFinite(value) || value < field.min || value > field.max;
    if (field.integer && (outOfRange || !Number.isInteger(value))) {
        return `${field.label} 需为 ${field.min} 到 ${field.max} 之间的整数`;
    }
    if (outOfRange) {
        return `${field.label} 需在 ${field.min} 到 ${field.max} 之间`;
    }
    return '';
}

function findChatCompletionNumberField(input) {
    return CHAT_COMPLETION_NUMBER_FIELDS.find(item => input.matches(item.selector)) || null;
}

function getChatCompletionFieldErrorElement(input, field) {
    return input.parentElement?.querySelector(`[data-api-field-error="${field.key}"]`) || null;
}

/**
 * 在输入框旁显示或移除字段级错误。直接改 DOM 而不重绘，避免整页 render 把用户未保存的输入重置为已保存值。
 * 只在保存 / 测试的点击处理里调用：此时点击已完成，插入或移除提示造成的位移不影响操作。
 * @param {HTMLInputElement} input 字段输入框
 * @param {{ key: string }} field 字段定义
 * @param {string} message 错误文案，空字符串表示移除
 */
function showChatCompletionFieldError(input, field, message) {
    const errorId = `api-field-error-${field.key}`;
    let errorElement = getChatCompletionFieldErrorElement(input, field);
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
        errorElement.setAttribute('data-api-field-error', field.key);
        input.after(errorElement);
    }
    errorElement.style.visibility = '';
    errorElement.textContent = message;
}

/**
 * 字段改动（change）后刷新已显示的错误：改对了就隐藏提示但保留占位，仍不合法就更新文案；不插入也不移除元素。
 * change 常在用户按下「保存」时因输入框失焦触发，若此刻提示增删导致按钮位移，松开鼠标时点击会落空。
 * 新出现的错误留到保存或测试时统一提示。
 * @param {EventTarget | null} target 发生变化的元素
 * @returns {boolean} 是否为受校验的数值字段
 */
export function refreshChatCompletionFieldError(target) {
    if (!(target instanceof HTMLInputElement)) {
        return false;
    }
    const field = findChatCompletionNumberField(target);
    if (!field) {
        return false;
    }
    const errorElement = getChatCompletionFieldErrorElement(target, field);
    if (!(errorElement instanceof HTMLElement)) {
        return true;
    }
    const message = getChatCompletionNumberFieldError(field, target);
    if (message) {
        target.setAttribute('aria-invalid', 'true');
        errorElement.style.visibility = '';
        errorElement.textContent = message;
    } else {
        target.removeAttribute('aria-invalid');
        errorElement.style.visibility = 'hidden';
    }
    return true;
}

export function createApiChatCompletionConnectionActions({
    state,
    elements,
    apiFetch,
    loadData,
    render,
    showToast,
    chatCompletionModelFields,
    secretKeyByChatSource,
    numberInput,
    getApiSourceUiState,
    getChatCompletionModel,
    getNumberSetting,
    getOaiSettings,
    getSelectedApiMain,
    recordApiTestResult,
    saveTextCompletionConnectionFromForm,
    testTextCompletionConnection,
    saveKoboldConnectionFromForm,
    testKoboldConnection,
    saveNovelConnectionFromForm,
    testNovelConnection,
    saveHordeConnectionFromForm,
    testHordeConnection,
    reloadSettings = noEngineSync,
}) {
    // 校验表单里全部数值字段并标出错误；有错误时聚焦第一个错误字段、提示并返回 false，调用方应中止操作。
    function validateChatCompletionNumberFields(toastTitle) {
        const errors = [];
        for (const field of CHAT_COMPLETION_NUMBER_FIELDS) {
            const input = elements.content.querySelector(field.selector);
            if (!(input instanceof HTMLInputElement)) {
                continue;
            }
            const message = getChatCompletionNumberFieldError(field, input);
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

    function getChatCompletionSettingsFromForm() {
        const savedSettings = getOaiSettings();
        const source = elements.content.querySelector('[data-api-source]')?.value || savedSettings.chat_completion_source || 'openai';
        const model = elements.content.querySelector('[data-api-model]')?.value.trim() || getChatCompletionModel(savedSettings, source);

        if (!model) {
            throw new Error('当前聊天补全表单没有可用模型。');
        }

        return {
            source,
            model,
            temperature: numberInput(elements.content.querySelector('[data-api-temperature]')?.value, getNumberSetting(savedSettings, 'temp_openai', 1)),
            maxTokens: numberInput(elements.content.querySelector('[data-api-max-tokens]')?.value, getNumberSetting(savedSettings, 'openai_max_tokens', 300)),
            topP: numberInput(elements.content.querySelector('[data-api-top-p]')?.value, getNumberSetting(savedSettings, 'top_p_openai', 1)),
            frequencyPenalty: numberInput(elements.content.querySelector('[data-api-frequency-penalty]')?.value, getNumberSetting(savedSettings, 'freq_pen_openai', 0)),
            presencePenalty: numberInput(elements.content.querySelector('[data-api-presence-penalty]')?.value, getNumberSetting(savedSettings, 'pres_pen_openai', 0)),
            siliconflowEndpoint: elements.content.querySelector('[data-api-endpoint]')?.value || savedSettings.siliconflow_endpoint || 'global',
            minimaxEndpoint: savedSettings.minimax_endpoint || 'global',
            customUrl: elements.content.querySelector('[data-api-custom-url]')?.value.trim() || savedSettings.custom_url || '',
            reverseProxy: elements.content.querySelector('[data-api-reverse-proxy]')?.value.trim() || savedSettings.reverse_proxy || '',
            proxyPassword: savedSettings.proxy_password || '',
        };
    }

    async function saveApiConnectionFromForm() {
        const oaiSettings = state.settings.oai_settings || {};
        const mainApi = elements.content.querySelector('[data-api-main]')?.value || 'openai';
        const source = elements.content.querySelector('[data-api-source]')?.value || oaiSettings.chat_completion_source || state.settings.chat_completion_source || '';
        const modelField = chatCompletionModelFields[source];
        const modelInput = elements.content.querySelector('[data-api-model]');
        const presetInput = elements.content.querySelector('[data-api-preset]');
        const endpointInput = elements.content.querySelector('[data-api-endpoint]');
        const customUrlInput = elements.content.querySelector('[data-api-custom-url]');
        const reverseProxyInput = elements.content.querySelector('[data-api-reverse-proxy]');
        const keyInput = elements.content.querySelector('[data-api-key]');
        const model = modelInput?.value.trim() || '';

        if (mainApi === 'textgenerationwebui') {
            await saveTextCompletionConnectionFromForm();
            return;
        }
        if (mainApi === 'kobold') {
            await saveKoboldConnectionFromForm();
            return;
        }
        if (mainApi === 'novel') {
            await saveNovelConnectionFromForm();
            return;
        }
        if (mainApi === 'koboldhorde') {
            await saveHordeConnectionFromForm();
            return;
        }
        if (mainApi !== 'openai') {
            throw new Error('现代页当前不支持保存该主 API。');
        }
        if (!modelField || !model) {
            throw new Error('当前连接暂不支持在现代页保存，或模型为空。');
        }
        // 超出旧版界面允许范围的参数不写入设置；错误标在字段旁，不重绘以保留用户输入。
        if (!validateChatCompletionNumberFields('连接配置未保存')) {
            return;
        }

        state.settings.oai_settings = oaiSettings;
        state.settings.main_api = mainApi;
        state.settings.chat_completion_source = source;
        oaiSettings.chat_completion_source = source;
        oaiSettings[modelField] = model;
        oaiSettings.preset_settings_openai = presetInput?.value || oaiSettings.preset_settings_openai || '';
        oaiSettings.temp_openai = numberInput(elements.content.querySelector('[data-api-temperature]')?.value, getNumberSetting(oaiSettings, 'temp_openai', 1));
        oaiSettings.openai_max_tokens = numberInput(elements.content.querySelector('[data-api-max-tokens]')?.value, getNumberSetting(oaiSettings, 'openai_max_tokens', 300));
        oaiSettings.top_p_openai = numberInput(elements.content.querySelector('[data-api-top-p]')?.value, getNumberSetting(oaiSettings, 'top_p_openai', 1));
        oaiSettings.freq_pen_openai = numberInput(elements.content.querySelector('[data-api-frequency-penalty]')?.value, getNumberSetting(oaiSettings, 'freq_pen_openai', 0));
        oaiSettings.pres_pen_openai = numberInput(elements.content.querySelector('[data-api-presence-penalty]')?.value, getNumberSetting(oaiSettings, 'pres_pen_openai', 0));
        if (source === 'siliconflow') {
            const endpoint = endpointInput?.value || 'cn';
            oaiSettings.siliconflow_endpoint = endpoint === 'global' ? 'global' : 'cn';
        }
        if (source === 'custom') {
            oaiSettings.custom_url = customUrlInput?.value.trim() || oaiSettings.custom_url || '';
        }
        const apiUiState = getApiSourceUiState(source);
        oaiSettings.reverse_proxy = apiUiState.showReverseProxy ? (reverseProxyInput?.value.trim() || '') : '';

        const apiKey = keyInput?.value.trim() || '';
        if (apiKey) {
            const secretKey = secretKeyByChatSource[source];
            if (!secretKey) {
                throw new Error('当前来源没有可写入的密钥映射。');
            }
            await apiFetch('/api/secrets/write', { body: { key: secretKey, value: apiKey, label: `${source} modern` } });
        }

        await saveSettingsSerialized(apiFetch, state.settings);
        // 设置已落盘：先等生成引擎重载完，再更新界面状态和提示，保存后立刻发送也用新配置
        const engineSync = await reloadSettings();
        state.apiMainDraft = '';
        await loadData({ silent: true });
        showToast('连接配置已保存', `${source} / ${model}${describeReloadFailure(engineSync)}`);
    }

    function responseContentToText(content) {
        if (typeof content === 'string') {
            return content;
        }
        if (Array.isArray(content)) {
            return content.map(item => item?.text || item?.content || '').filter(Boolean).join('\n');
        }
        return '';
    }

    // Mirrors the chat-completion shapes read by extractReasoningFromData in public/scripts/reasoning.js:
    // OpenAI-compatible reasoning_content / reasoning fields, plus Claude and Mistral "thinking" parts.
    function extractReasoningText(response) {
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

    function readConnectionTestReply(response) {
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

    function createChatCompletionRequestBody(settings, messages) {
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

    async function testApiConnection() {
        if (state.apiTest.running) {
            return;
        }
        if (getSelectedApiMain() === 'textgenerationwebui') {
            await testTextCompletionConnection();
            return;
        }
        if (getSelectedApiMain() === 'kobold') {
            await testKoboldConnection();
            return;
        }
        if (getSelectedApiMain() === 'novel') {
            await testNovelConnection();
            return;
        }
        if (getSelectedApiMain() === 'koboldhorde') {
            await testHordeConnection();
            return;
        }
        if (getSelectedApiMain() !== 'openai') {
            throw new Error('现代页当前不支持测试该主 API。');
        }
        // 测试请求使用同一组表单参数，越界时先在字段旁提示，不把非法参数发给模型服务。
        if (!validateChatCompletionNumberFields('连接测试未执行')) {
            return;
        }

        const settings = getChatCompletionSettingsFromForm();
        const body = createChatCompletionRequestBody(settings, [
            { role: 'user', content: '请只回复 OK。' },
        ]);
        body.max_tokens = Math.min(settings.maxTokens, 20);

        state.apiTest = {
            running: true,
            status: '测试中',
            detail: `${settings.source} / ${settings.model}`,
        };
        render();

        try {
            const response = await apiFetch('/api/backends/chat-completions/generate', { body });
            const reply = readConnectionTestReply(response);
            const replyDetail = reply.reasoningOnly
                ? '连接正常：模型只返回了推理内容（测试请求的 token 上限较低）'
                : reply.text.slice(0, 80);
            state.apiTest = {
                running: false,
                status: '可用',
                detail: `${settings.model}: ${replyDetail}`,
            };
            recordApiTestResult('可用', state.apiTest.detail, settings);
            showToast('连接测试成功', state.apiTest.detail);
        } catch (error) {
            state.apiTest = {
                running: false,
                status: '失败',
                detail: error.message,
            };
            recordApiTestResult('失败', error.message, settings);
            throw error;
        } finally {
            render();
        }
    }

    return {
        testApiConnection,
        saveApiConnectionFromForm,
    };
}
