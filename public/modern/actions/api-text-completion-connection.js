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

const textCompletionSamplingDefaults = {
    temp: 0.7,
    top_p: 0.5,
    top_k: 40,
    min_p: 0,
    rep_pen: 1.2,
    rep_pen_range: 0,
};

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
        Object.assign(textgenSettings, settings.sampling);
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
