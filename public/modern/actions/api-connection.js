const textCompletionModelFields = {
    ooba: 'custom_model',
    generic: 'generic_model',
    openrouter: 'openrouter_model',
    ollama: 'ollama_model',
    vllm: 'vllm_model',
    aphrodite: 'aphrodite_model',
    tabby: 'tabby_model',
    llamacpp: 'llamacpp_model',
    mancer: 'mancer_model',
    togetherai: 'togetherai_model',
    infermaticai: 'infermaticai_model',
    dreamgen: 'dreamgen_model',
    featherless: 'featherless_model',
};

const secretKeyByTextCompletionType = {
    ooba: 'api_key_ooba',
    generic: 'api_key_generic',
    openrouter: 'api_key_openrouter',
    vllm: 'api_key_vllm',
    aphrodite: 'api_key_aphrodite',
    tabby: 'api_key_tabby',
    llamacpp: 'api_key_llamacpp',
    koboldcpp: 'api_key_koboldcpp',
    mancer: 'api_key_mancer',
    togetherai: 'api_key_togetherai',
    infermaticai: 'api_key_infermaticai',
    dreamgen: 'api_key_dreamgen',
    featherless: 'api_key_featherless',
    huggingface: 'api_key_huggingface',
};

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

    function getTextCompletionSettings() {
        return state.settings.textgenerationwebui_settings || {};
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
        };
    }

    async function saveTextCompletionConnectionFromForm() {
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
        if (modelField) {
            textgenSettings[modelField] = settings.model;
        }

        if (apiKey) {
            const secretKey = secretKeyByTextCompletionType[settings.source];
            if (!secretKey) {
                throw new Error('当前文本补全来源没有可写入的密钥映射。');
            }
            await apiFetch('/api/secrets/write', { body: { key: secretKey, value: apiKey, label: `${settings.source} modern text completion` } });
        }

        await apiFetch('/api/settings/save', { body: state.settings });
        state.apiMainDraft = '';
        await loadData({ silent: true });
        showToast('文本补全连接已保存', `${settings.source} / ${settings.model || settings.endpoint}`);
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
