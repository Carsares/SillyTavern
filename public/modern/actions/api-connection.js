import { createApiTextCompletionConnectionActions } from './api-text-completion-connection.js';

export function createApiConnectionActions({
    state,
    elements,
    apiFetch,
    loadData,
    render,
    showToast,
    apiModelSuggestions,
    chatCompletionModelFields,
    secretKeyByChatSource,
    numberInput,
    uniqueValues,
}) {
    function getOaiSettings() {
        return state.settings.oai_settings || {};
    }

    function getSelectedApiMain() {
        return state.apiMainDraft || state.settings.main_api || 'openai';
    }

    function getChatCompletionModel(settings, source) {
        const field = chatCompletionModelFields[source] || 'openai_model';
        return settings[field] || settings.openai_model || '';
    }

    function getApiModelSuggestions(source, currentModel) {
        return uniqueValues([
            currentModel,
            ...(apiModelSuggestions[source] || []),
        ]).slice(0, 8);
    }

    function setApiModelSuggestion(model) {
        const input = elements.content.querySelector('[data-api-model]');
        if (input) {
            input.value = model;
            input.focus();
        }
    }

    function recordApiTestResult(status, detail, settings) {
        state.apiTestHistory = [
            {
                status,
                detail,
                source: settings.source,
                model: settings.model,
                time: Date.now(),
            },
            ...state.apiTestHistory,
        ].slice(0, 5);
    }

    function getSecretStateForSource(source) {
        const secretKey = secretKeyByChatSource[source];
        const value = secretKey ? state.secretState?.[secretKey] : null;
        return Array.isArray(value) ? value : [];
    }

    function getApiSourceUiState(source) {
        const settings = getOaiSettings();
        const secretState = getSecretStateForSource(source);
        const hasReverseProxy = Boolean(settings.reverse_proxy);
        return {
            hasSecretMapping: Boolean(secretKeyByChatSource[source]),
            secretKey: secretKeyByChatSource[source] || '当前来源没有密钥映射',
            secretSaved: secretState.length > 0,
            showEndpoint: source === 'siliconflow',
            showCustomUrl: source === 'custom',
            showReverseProxy: source === 'openai' || source === 'custom' || hasReverseProxy,
        };
    }

    function updateApiSourceFields(source) {
        const uiState = getApiSourceUiState(source);
        const settings = getOaiSettings();
        const modelInput = elements.content.querySelector('[data-api-model]');

        if (modelInput) {
            modelInput.value = getChatCompletionModel(settings, source);
        }

        elements.content.querySelectorAll('[data-api-field]').forEach(field => {
            const fieldName = field.dataset.apiField;
            const isVisible = (
                fieldName === 'siliconflow-endpoint' && uiState.showEndpoint
                || fieldName === 'custom-url' && uiState.showCustomUrl
                || fieldName === 'reverse-proxy' && uiState.showReverseProxy
                || fieldName === 'api-key' && uiState.hasSecretMapping
            );
            field.hidden = !isVisible;
        });

        const keyInput = elements.content.querySelector('[data-api-key]');
        if (keyInput) {
            keyInput.placeholder = uiState.secretSaved ? '密钥已保存；留空不修改' : '输入后保存到 secrets';
            keyInput.value = '';
        }

        const secretBadge = elements.content.querySelector('[data-api-secret-status]');
        if (secretBadge) {
            secretBadge.textContent = uiState.secretSaved ? '密钥已保存' : (uiState.hasSecretMapping ? '未保存密钥' : '无密钥字段');
        }

        const secretKey = elements.content.querySelector('[data-api-secret-key]');
        if (secretKey) {
            secretKey.textContent = uiState.secretKey;
        }
    }

    function getNumberSetting(settings, key, fallback) {
        const value = Number(settings[key]);
        return Number.isFinite(value) ? value : fallback;
    }

    const {
        saveTextCompletionConnectionFromForm,
        testTextCompletionConnection,
        updateTextCompletionTypeFields,
    } = createApiTextCompletionConnectionActions({
        state,
        elements,
        apiFetch,
        loadData,
        render,
        showToast,
        numberInput,
        getNumberSetting,
        recordApiTestResult,
    });

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
        if (mainApi !== 'openai') {
            throw new Error('现代页当前不支持保存该主 API。');
        }
        if (!modelField || !model) {
            throw new Error('当前连接暂不支持在现代页保存，或模型为空。');
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

        await apiFetch('/api/settings/save', { body: state.settings });
        state.apiMainDraft = '';
        await loadData({ silent: true });
        showToast('连接配置已保存', `${source} / ${model}`);
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

    function extractAssistantText(response) {
        if (response?.error) {
            throw new Error(response.error.message || String(response.error));
        }

        const choice = response?.choices?.[0];
        const text = responseContentToText(choice?.message?.content)
            || responseContentToText(choice?.delta?.content)
            || responseContentToText(choice?.text)
            || responseContentToText(response?.message?.content)
            || responseContentToText(response?.content);

        if (!text.trim()) {
            throw new Error('模型没有返回可显示内容。');
        }

        return text.trim();
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
        if (getSelectedApiMain() !== 'openai') {
            throw new Error('现代页当前不支持测试该主 API。');
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
            const text = extractAssistantText(response);
            state.apiTest = {
                running: false,
                status: '可用',
                detail: `${settings.model}: ${text.slice(0, 80)}`,
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
        getOaiSettings,
        getSelectedApiMain,
        getChatCompletionModel,
        getApiModelSuggestions,
        getApiSourceUiState,
        getNumberSetting,
        getSecretStateForSource,
        testApiConnection,
        setApiModelSuggestion,
        saveApiConnectionFromForm,
        updateApiSourceFields,
        updateTextCompletionTypeFields,
    };
}
