import { CHAT_COMPLETION_NUMBER_FIELDS } from '../actions/api-autosave.js';
import {
    CHAT_COMPLETION_CONTEXT_DEFAULT,
    CHAT_COMPLETION_RESPONSE_DEFAULT,
    describeChatCompletionContext,
    getChatCompletionSuggestedContext,
} from '../actions/chat-completion-limits.js';
import { createApiFieldComponents } from './api-fields.js';

export function createApiChatCompletionComponents(ctx) {
    const {
        state,
        chatCompletionSourceOptions,
        escapeHtml,
        maskEndpoint,
        getPresetGroups,
        getChatCompletionModel,
        getApiModelSuggestions,
        getApiSourceUiState,
        getNumberSetting,
        formatNumber,
    } = ctx;
    const { renderSecretField } = createApiFieldComponents(ctx);

    // 数值输入框的 min / max 与保存时的校验共用同一份范围定义
    function renderNumberRange(key) {
        const field = CHAT_COMPLETION_NUMBER_FIELDS.find(item => item.key === key);
        return field ? `min="${field.min}" max="${field.max}"` : '';
    }

    function renderNumberField(key, attribute, label, value, step) {
        return `
                    <label class="field-label">
                        <span>${escapeHtml(label)}</span>
                        <input class="text-input" type="number" step="${step}" ${renderNumberRange(key)} ${attribute} value="${escapeHtml(value)}">
                    </label>`;
    }

    // 所有字段改动即保存（actions/api-autosave.js）；来源变化后整页重绘，所以这里只按已保存的来源决定显示哪些字段
    function renderChatCompletionEditor(mainApi, renderApiMainSelect) {
        const settings = state.settings.oai_settings || {};
        const source = settings.chat_completion_source || state.settings.chat_completion_source || 'openai';
        const model = getChatCompletionModel(settings, source);
        // 旧版默认 global（openai.js default_settings），没保存过时按 global 显示
        const endpoint = settings.siliconflow_endpoint === 'cn' ? 'cn' : 'global';
        const apiUiState = getApiSourceUiState(source);
        const sourceOptions = chatCompletionSourceOptions.some(option => option.id === source)
            ? chatCompletionSourceOptions
            : [{ id: source, label: `${source} (当前来源)` }, ...chatCompletionSourceOptions];
        const openAiPresetNames = getPresetGroups().find(group => group.id === 'openai')?.names || [];
        const currentPreset = settings.preset_settings_openai || '';
        const contextValue = getNumberSetting(settings, 'openai_max_context', CHAT_COMPLETION_CONTEXT_DEFAULT);
        const maxTokensValue = getNumberSetting(settings, 'openai_max_tokens', CHAT_COMPLETION_RESPONSE_DEFAULT);
        const contextHint = describeChatCompletionContext({ source, model, context: contextValue, maxTokens: maxTokensValue });
        const suggestedContext = getChatCompletionSuggestedContext({ source, model });
        const showFill = suggestedContext !== null && suggestedContext !== contextValue;
        const suggestions = getApiModelSuggestions(source, model).filter(item => item !== model);

        return `
        <form class="settings-form" data-api-connection-form autocomplete="off" novalidate>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">连接</h3>
                    <p class="panel-subtitle">选择服务和模型。密钥只保存在本机，不会显示出来。</p>
                </div>
                <div class="form-grid two-columns">
                    ${renderApiMainSelect(mainApi)}
                    <label class="field-label">
                        <span>聊天补全来源</span>
                        <select class="select-input" data-api-source>
                            ${sourceOptions.map(option => `<option value="${escapeHtml(option.id)}" ${source === option.id ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
                        </select>
                    </label>
                    ${apiUiState.showEndpoint ? `
                    <label class="field-label" data-api-field="siliconflow-endpoint">
                        <span>SiliconFlow 端点</span>
                        <select class="select-input" data-api-endpoint>
                            <option value="global" ${endpoint === 'global' ? 'selected' : ''}>Global (api.siliconflow.com)</option>
                            <option value="cn" ${endpoint === 'cn' ? 'selected' : ''}>China (api.siliconflow.cn)</option>
                        </select>
                    </label>` : ''}
                    ${apiUiState.showCustomUrl ? `
                    <label class="field-label" data-api-field="custom-url">
                        <span>Custom URL</span>
                        <input class="text-input" type="url" data-api-custom-url value="${escapeHtml(settings.custom_url || '')}" autocomplete="off" placeholder="OpenAI 兼容服务的地址，例如 https://api.deepseek.com">
                    </label>` : ''}
                    ${apiUiState.hasSecretMapping ? renderSecretField({ attribute: 'data-api-key', name: 'chat_completion_api_key', saved: apiUiState.secretSaved, fieldAttribute: 'data-api-field="api-key"' }) : ''}
                    ${source === 'openrouter' ? `
                    <div class="field-label" data-api-field="openrouter-auth">
                        <span>OpenRouter 授权</span>
                        <button class="secondary-button" type="button" data-openrouter-auth>
                            <i class="fa-solid fa-key"></i>
                            用 OpenRouter 授权获取密钥
                        </button>
                    </div>` : ''}
                    <label class="field-label">
                        <span>模型</span>
                        <input class="text-input" type="text" data-api-model value="${escapeHtml(model)}" autocomplete="off" placeholder="例如 deepseek-chat">
                        ${suggestions.length ? `
                        <span class="tag-row api-model-suggestions">
                            ${suggestions.map(item => `
                                <button class="secondary-button compact-button" type="button" data-api-model-suggestion="${escapeHtml(item)}">${escapeHtml(item)}</button>
                            `).join('')}
                        </span>` : ''}
                    </label>
                    <label class="field-label">
                        <span>聊天补全预设</span>
                        <select class="select-input" data-api-preset>
                            ${currentPreset ? '' : '<option value="" selected>未选择</option>'}
                            ${openAiPresetNames.map(name => `<option value="${escapeHtml(name)}" ${currentPreset === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
                        </select>
                        <span class="field-help">选择后立即应用预设里的采样参数和长度。</span>
                    </label>
                    ${apiUiState.showReverseProxy ? `
                    <label class="field-label" data-api-field="reverse-proxy">
                        <span>反向代理</span>
                        <input class="text-input" type="url" data-api-reverse-proxy value="${escapeHtml(settings.reverse_proxy || '')}" autocomplete="off" placeholder="不用时留空">
                    </label>` : ''}
                </div>
            </section>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">长度</h3>
                    <p class="panel-subtitle">上下文长度减去回复长度是提示词预算，放不下的早期消息不会发送。按模型实际支持的长度填写。</p>
                </div>
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>上下文长度</span>
                        <span class="api-context-input">
                            <input class="text-input" type="number" inputmode="numeric" step="1" ${renderNumberRange('maxContext')} data-api-max-context value="${escapeHtml(contextValue)}">
                            <button class="secondary-button compact-button" type="button" data-api-context-fill="${suggestedContext ?? ''}" ${showFill ? '' : 'hidden'}>${suggestedContext === null ? '' : `填入模型上限 ${escapeHtml(formatNumber(suggestedContext))}`}</button>
                        </span>
                    </label>
                    ${renderNumberField('maxTokens', 'data-api-max-tokens', '回复长度（Max Tokens）', maxTokensValue, 1)}
                </div>
                <p class="api-context-hint ${contextHint.level === 'warning' ? 'is-warning' : ''}" data-api-context-hint>${escapeHtml(contextHint.text)}</p>
            </section>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">采样</h3>
                    <p class="panel-subtitle">控制回复的随机程度和重复程度。</p>
                </div>
                <div class="form-grid two-columns">
                    ${renderNumberField('temperature', 'data-api-temperature', 'Temperature', getNumberSetting(settings, 'temp_openai', 1), 0.01)}
                    ${renderNumberField('topP', 'data-api-top-p', 'Top P', getNumberSetting(settings, 'top_p_openai', 1), 0.01)}
                    ${renderNumberField('frequencyPenalty', 'data-api-frequency-penalty', 'Frequency Penalty', getNumberSetting(settings, 'freq_pen_openai', 0), 0.01)}
                    ${renderNumberField('presencePenalty', 'data-api-presence-penalty', 'Presence Penalty', getNumberSetting(settings, 'pres_pen_openai', 0), 0.01)}
                </div>
            </section>
        </form>
    `;
    }

    function getChatCompletionEndpoint(source, settings) {
        if (settings.reverse_proxy) {
            return maskEndpoint(settings.reverse_proxy);
        }
        if (source === 'siliconflow') {
            return settings.siliconflow_endpoint === 'cn' ? 'https://api.siliconflow.cn/v1' : 'https://api.siliconflow.com/v1';
        }
        if (source === 'custom') {
            return maskEndpoint(settings.custom_url || '');
        }
        if (source === 'openai') {
            return 'https://api.openai.com/v1';
        }
        return settings.custom_url ? maskEndpoint(settings.custom_url) : '';
    }

    return {
        renderChatCompletionEditor,
        getChatCompletionEndpoint,
    };
}
