import { createApiChatCompletionConnectionActions } from './api-chat-completion-connection.js';
import { createApiTextCompletionConnectionActions } from './api-text-completion-connection.js';
import { createApiKoboldConnectionActions } from './api-kobold-connection.js';
import { createApiNovelConnectionActions } from './api-novel-connection.js';

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
    const {
        saveKoboldConnectionFromForm,
        testKoboldConnection,
    } = createApiKoboldConnectionActions({
        state,
        elements,
        apiFetch,
        loadData,
        render,
        showToast,
        recordApiTestResult,
    });
    const {
        saveNovelConnectionFromForm,
        testNovelConnection,
    } = createApiNovelConnectionActions({
        state,
        elements,
        apiFetch,
        loadData,
        render,
        showToast,
        recordApiTestResult,
    });
    const {
        saveApiConnectionFromForm,
        testApiConnection,
    } = createApiChatCompletionConnectionActions({
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
    });

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
