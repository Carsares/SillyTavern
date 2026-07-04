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
    } = ctx;

    function renderChatCompletionEditor(provider, mainApi, renderApiMainSelect) {
        const settings = state.settings.oai_settings || {};
        const source = provider.chatSource || settings.chat_completion_source || 'openai';
        const model = getChatCompletionModel(settings, source);
        const endpoint = settings.siliconflow_endpoint === 'global' ? 'global' : 'cn';
        const apiUiState = getApiSourceUiState(source);
        const sourceOptions = chatCompletionSourceOptions.some(option => option.id === source)
            ? chatCompletionSourceOptions
            : [{ id: source, label: `${source} (当前来源)` }, ...chatCompletionSourceOptions];
        const openAiPresetNames = getPresetGroups().find(group => group.id === 'openai')?.names || [];

        return `
        <div class="settings-form">
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">连接</h3>
                    <p class="panel-subtitle">选择主 API、来源和端点。</p>
                </div>
                <div class="form-grid two-columns">
                    ${renderApiMainSelect(mainApi)}
                    <label class="field-label">
                        <span>聊天补全来源</span>
                        <select class="select-input" data-api-source>
                            ${sourceOptions.map(option => `<option value="${escapeHtml(option.id)}" ${source === option.id ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
                        </select>
                    </label>
                    <label class="field-label" data-api-field="siliconflow-endpoint" ${apiUiState.showEndpoint ? '' : 'hidden'}>
                        <span>SiliconFlow 端点</span>
                        <select class="select-input" data-api-endpoint>
                            <option value="cn" ${endpoint === 'cn' ? 'selected' : ''}>China (api.siliconflow.cn)</option>
                            <option value="global" ${endpoint === 'global' ? 'selected' : ''}>Global (api.siliconflow.com)</option>
                        </select>
                    </label>
                    <label class="field-label" data-api-field="custom-url" ${apiUiState.showCustomUrl ? '' : 'hidden'}>
                        <span>Custom URL</span>
                        <input class="text-input" type="url" data-api-custom-url value="${escapeHtml(settings.custom_url || '')}" autocomplete="off" placeholder="OpenAI-compatible base URL">
                    </label>
                    <label class="field-label" data-api-field="reverse-proxy" ${apiUiState.showReverseProxy ? '' : 'hidden'}>
                        <span>Reverse Proxy</span>
                        <input class="text-input" type="url" data-api-reverse-proxy value="${escapeHtml(settings.reverse_proxy || '')}" autocomplete="off" placeholder="可选">
                    </label>
                </div>
            </section>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">模型参数</h3>
                    <p class="panel-subtitle">模型、预设和采样参数。</p>
                </div>
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>模型</span>
                        <input class="text-input" type="text" data-api-model value="${escapeHtml(model)}" autocomplete="off" placeholder="例如 deepseek-ai/DeepSeek-V4-Pro">
                    </label>
                    <div class="field-label api-model-suggestions">
                        <span>常用模型</span>
                        <div class="tag-row">
                            ${getApiModelSuggestions(source, model).map(item => `
                                <button class="secondary-button compact-button" type="button" data-api-model-suggestion="${escapeHtml(item)}">
                                    ${escapeHtml(item)}
                                </button>
                            `).join('') || '<span class="card-meta">当前来源暂无建议</span>'}
                        </div>
                    </div>
                    <label class="field-label">
                        <span>聊天补全预设</span>
                        <select class="select-input" data-api-preset>
                            <option value="">未选择</option>
                            ${openAiPresetNames.map(name => `<option value="${escapeHtml(name)}" ${settings.preset_settings_openai === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
                        </select>
                    </label>
                    <label class="field-label">
                        <span>Temperature</span>
                        <input class="text-input" type="number" step="0.01" data-api-temperature value="${escapeHtml(getNumberSetting(settings, 'temp_openai', 1))}">
                    </label>
                    <label class="field-label">
                        <span>Max Tokens</span>
                        <input class="text-input" type="number" step="1" min="1" data-api-max-tokens value="${escapeHtml(getNumberSetting(settings, 'openai_max_tokens', 300))}">
                    </label>
                    <label class="field-label">
                        <span>Top P</span>
                        <input class="text-input" type="number" step="0.01" data-api-top-p value="${escapeHtml(getNumberSetting(settings, 'top_p_openai', 1))}">
                    </label>
                    <label class="field-label">
                        <span>Frequency Penalty</span>
                        <input class="text-input" type="number" step="0.01" data-api-frequency-penalty value="${escapeHtml(getNumberSetting(settings, 'freq_pen_openai', 0))}">
                    </label>
                    <label class="field-label">
                        <span>Presence Penalty</span>
                        <input class="text-input" type="number" step="0.01" data-api-presence-penalty value="${escapeHtml(getNumberSetting(settings, 'pres_pen_openai', 0))}">
                    </label>
                </div>
            </section>
            <div class="form-section">
                <div>
                    <h3 class="form-section-title">安全密钥</h3>
                    <p class="panel-subtitle">密钥写入本地 secrets，不在页面回显。</p>
                </div>
                <label class="field-label" data-api-field="api-key" ${apiUiState.hasSecretMapping ? '' : 'hidden'}>
                    <span>API Key</span>
                    <input class="text-input" type="password" data-api-key value="" autocomplete="new-password" placeholder="${apiUiState.secretSaved ? '密钥已保存；留空不修改' : '输入后保存到 secrets'}">
                </label>
            </div>
            <div class="connection-test">
                <span class="badge" data-api-secret-status>${apiUiState.secretSaved ? '密钥已保存' : (apiUiState.hasSecretMapping ? '未保存密钥' : '无密钥字段')}</span>
                <span data-api-secret-key>${escapeHtml(apiUiState.secretKey)}</span>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-save-api-connection>
                    <i class="fa-solid fa-floppy-disk"></i>
                    保存连接字段
                </button>
            </div>
        </div>
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
