import { CHAT_COMPLETION_NUMBER_FIELDS } from '../actions/api-autosave.js';
import {
    CHAT_COMPLETION_CONTEXT_DEFAULT,
    CHAT_COMPLETION_RESPONSE_DEFAULT,
    describeChatCompletionContext,
    getChatCompletionSuggestedContext,
} from '../actions/chat-completion-limits.js';
import { MODEL_SERVICE_PROVIDERS } from '../../shared/model-services.js';
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

    /**
     * 模型输入框：可以手填，也可以从服务返回的模型列表里选（datalist）。
     * @param {string} source 来源
     * @param {string} model 当前模型
     * @param {{ serviceId?: string, models?: string[] }} [options] 对话场景用的服务和它的模型列表
     * @returns {string} HTML
     */
    function renderModelField(source, model, { serviceId = '', models = [] } = {}) {
        const suggestions = getApiModelSuggestions(source, model).filter(item => item !== model);
        const listId = 'chat-scene-models';
        return `
                    <label class="field-label">
                        <span class="field-label-row">
                            模型
                            ${serviceId ? `<button class="secondary-button compact-button" type="button" data-model-service-models="${escapeHtml(serviceId)}">获取模型列表</button>` : ''}
                        </span>
                        <input class="text-input" type="text" data-api-model value="${escapeHtml(model)}" autocomplete="off" placeholder="例如 deepseek-chat" ${models.length ? `list="${listId}"` : ''}>
                        ${models.length ? `<datalist id="${listId}">${models.map(item => `<option value="${escapeHtml(item)}"></option>`).join('')}</datalist>` : ''}
                        ${suggestions.length ? `
                        <span class="tag-row api-model-suggestions">
                            ${suggestions.map(item => `
                                <button class="secondary-button compact-button" type="button" data-api-model-suggestion="${escapeHtml(item)}">${escapeHtml(item)}</button>
                            `).join('')}
                        </span>` : ''}
                    </label>`;
    }

    function renderPresetField(currentPreset) {
        const openAiPresetNames = getPresetGroups().find(group => group.id === 'openai')?.names || [];
        return `
                    <label class="field-label">
                        <span>聊天补全预设</span>
                        <select class="select-input" data-api-preset>
                            ${currentPreset ? '' : '<option value="" selected>未选择</option>'}
                            ${openAiPresetNames.map(name => `<option value="${escapeHtml(name)}" ${currentPreset === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
                        </select>
                        <span class="field-help">选择后立即应用预设里的采样参数和长度。</span>
                    </label>`;
    }

    function renderReverseProxyField(settings) {
        return `
                    <label class="field-label" data-api-field="reverse-proxy">
                        <span>反向代理</span>
                        <input class="text-input" type="url" data-api-reverse-proxy value="${escapeHtml(settings.reverse_proxy || '')}" autocomplete="off" placeholder="不用时留空">
                    </label>`;
    }

    /**
     * 对话场景的聊天补全编辑器，改动即保存（actions/api-autosave.js）。
     * 选了已登记的模型服务时只显示模型、预设、长度和采样，来源、地址、密钥在服务里改；
     * 没有登记（或来源不能登记为模型服务）时显示完整的来源、地址、密钥字段。
     * @param {{ service?: import('../../shared/model-services.js').ModelService | null, models?: string[] }} [options] 对话场景的服务和模型列表
     * @returns {string} HTML
     */
    function renderChatCompletionEditor({ service = null, models = [] } = {}) {
        const settings = state.settings.oai_settings || {};
        const source = settings.chat_completion_source || state.settings.chat_completion_source || 'openai';
        const model = getChatCompletionModel(settings, source);
        const apiUiState = getApiSourceUiState(source);
        const contextValue = getNumberSetting(settings, 'openai_max_context', CHAT_COMPLETION_CONTEXT_DEFAULT);
        const maxTokensValue = getNumberSetting(settings, 'openai_max_tokens', CHAT_COMPLETION_RESPONSE_DEFAULT);
        const contextHint = describeChatCompletionContext({ source, model, context: contextValue, maxTokens: maxTokensValue });
        const suggestedContext = getChatCompletionSuggestedContext({ source, model });
        const showFill = suggestedContext !== null && suggestedContext !== contextValue;

        return `
        <form class="settings-form" data-api-connection-form autocomplete="off" novalidate>
            ${service ? `
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">模型</h3>
                    <p class="panel-subtitle">地址和 API Key 跟着模型服务「${escapeHtml(service.name)}」走，在上面的模型服务里修改。</p>
                </div>
                <div class="form-grid two-columns">
                    ${renderModelField(source, model, { serviceId: service.id, models })}
                    ${renderPresetField(settings.preset_settings_openai || '')}
                    ${apiUiState.showReverseProxy ? renderReverseProxyField(settings) : ''}
                </div>
            </section>` : renderDirectConnectionSection(settings, source, model, apiUiState)}
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

    // 没有选已登记的模型服务时：直接编辑来源、地址和密钥（也是 Vertex AI、Azure 这类不能登记为模型服务的来源的入口）
    function renderDirectConnectionSection(settings, source, model, apiUiState) {
        // 旧版默认 global（openai.js default_settings），没保存过时按 global 显示
        const endpoint = settings.siliconflow_endpoint === 'cn' ? 'cn' : 'global';
        const sourceOptions = chatCompletionSourceOptions.some(option => option.id === source)
            ? chatCompletionSourceOptions
            : [{ id: source, label: `${source} (当前来源)` }, ...chatCompletionSourceOptions];
        const canRegister = Boolean(MODEL_SERVICE_PROVIDERS[source]);
        return `
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">连接</h3>
                    <p class="panel-subtitle">直接配置聊天补全来源。${canRegister ? '登记为模型服务后，翻译等场景也能直接选用它。' : '这个来源暂时不能登记为模型服务。'}</p>
                </div>
                ${canRegister ? `
                <div class="message-edit-actions">
                    <button class="secondary-button compact-button" type="button" data-model-service-register-current>
                        <i class="fa-solid fa-plus" aria-hidden="true"></i>
                        登记为模型服务
                    </button>
                </div>` : ''}
                <div class="form-grid two-columns">
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
                    ${renderModelField(source, model)}
                    ${renderPresetField(settings.preset_settings_openai || '')}
                    ${apiUiState.showReverseProxy ? renderReverseProxyField(settings) : ''}
                </div>
            </section>`;
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
