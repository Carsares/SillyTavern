import { createApiChatCompletionConnectionActions } from './api-chat-completion-connection.js';
import { createApiTextCompletionConnectionActions } from './api-text-completion-connection.js';
import { createApiKoboldConnectionActions } from './api-kobold-connection.js';
import { createApiNovelConnectionActions } from './api-novel-connection.js';
import { createApiHordeConnectionActions } from './api-horde-connection.js';
import { createApiOAuthActions } from './api-oauth.js';
import { createConnectionFieldAutosave } from './api-autosave.js';
import { createSettingsAutosave } from './settings-autosave.js';
import { noEngineSync } from '../core/bridge-reload.js';

export function createApiConnectionActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
    apiModelSuggestions,
    chatCompletionModelFields,
    secretKeyByChatSource,
    uniqueValues,
    // 保存后通知隐藏的生成引擎重载设置（core/bridge-reload.js 的 reloadSettings，等引擎确认；永不 reject）
    reloadSettings = noEngineSync,
}) {
    // 设置中心共用的「改动即保存」：模型连接、界面偏好和聊天工具都从这里写入并显示保存状态
    const settingsAutosave = createSettingsAutosave({ state, apiFetch, showToast, reloadSettings });
    const connectionFieldAutosave = createConnectionFieldAutosave({ state, render, autosave: settingsAutosave });

    function getOaiSettings() {
        return state.settings.oai_settings || {};
    }

    function getSelectedApiMain() {
        return state.settings.main_api || 'openai';
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
            secretKey: secretKeyByChatSource[source] || '',
            secretSaved: secretState.length > 0,
            showEndpoint: source === 'siliconflow',
            showCustomUrl: source === 'custom',
            showReverseProxy: source === 'openai' || source === 'custom' || hasReverseProxy,
        };
    }

    function getNumberSetting(settings, key, fallback) {
        const value = Number(settings[key]);
        return Number.isFinite(value) ? value : fallback;
    }

    const testDependencies = { state, apiFetch, render, showToast, recordApiTestResult };
    const { testTextCompletionConnection } = createApiTextCompletionConnectionActions(testDependencies);
    const { testKoboldConnection } = createApiKoboldConnectionActions(testDependencies);
    const { testNovelConnection } = createApiNovelConnectionActions(testDependencies);
    const {
        loadHordeModels,
        refreshHordeModels,
        testHordeConnection,
    } = createApiHordeConnectionActions(testDependencies);
    const {
        startOpenRouterAuth,
        completeOpenRouterAuthFromUrl,
    } = createApiOAuthActions({
        state,
        apiFetch,
        loadData,
        render,
        showToast,
    });
    const { testApiConnection: runConnectionTest } = createApiChatCompletionConnectionActions({
        ...testDependencies,
        getChatCompletionModel,
        getNumberSetting,
        getOaiSettings,
        getSelectedApiMain,
        testTextCompletionConnection,
        testKoboldConnection,
        testNovelConnection,
        testHordeConnection,
    });

    // 测试用已保存的设置：先等刚改的字段保存完；还有填错没保存的字段时不测，免得测的不是页面上看到的值
    async function testApiConnection() {
        await settingsAutosave.flush();
        const pendingError = connectionFieldAutosave.getPendingFieldError();
        if (pendingError) {
            throw new Error(`有字段没有保存：${pendingError}`);
        }
        await runConnectionTest();
    }

    return {
        settingsAutosave,
        getOaiSettings,
        getSelectedApiMain,
        getChatCompletionModel,
        getApiModelSuggestions,
        getApiSourceUiState,
        getNumberSetting,
        getSecretStateForSource,
        testApiConnection,
        saveConnectionField: connectionFieldAutosave.saveConnectionField,
        fillSuggestedContext: connectionFieldAutosave.fillSuggestedContext,
        applyModelSuggestion: connectionFieldAutosave.applyModelSuggestion,
        loadHordeModels,
        refreshHordeModels,
        startOpenRouterAuth,
        completeOpenRouterAuthFromUrl,
    };
}
