export function createApiRoute(ctx) {
    const {
        state,
        chatCompletionSourceOptions,
        secretKeyByChatSource,
        escapeHtml,
        formatDate,
        formatNumber,
        maskEndpoint,
        pageHead,
        renderInlineEmpty,
        renderKeyValue,
        getPresetGroups,
        getProviderInfo,
        getSelectedApiMain,
        getChatCompletionModel,
        getApiModelSuggestions,
        getApiSourceUiState,
        getNumberSetting,
        getSecretStateForSource,
        render,
        showToast,
        testApiConnection,
        setApiModelSuggestion,
        saveApiConnectionFromForm,
        updateApiSourceFields,
    } = ctx;

    function renderApi() {
        const provider = getProviderInfo();
        const profiles = getApiProfiles();
        const checks = getApiChecks(provider, profiles);
        const canTestConnection = getSelectedApiMain() === 'openai';

        return `
        ${pageHead('API 连接管理', '连接、模型、预设和请求状态。', `
            <button class="primary-button" type="button" data-test-api ${state.apiTest.running || !canTestConnection ? 'disabled' : ''}>
                <i class="fa-solid ${state.apiTest.running ? 'fa-circle-notch fa-spin' : 'fa-plug-circle-check'}"></i>
                ${state.apiTest.running ? '测试中' : '测试连接'}
            </button>
            <button class="secondary-button" type="button" data-refresh>
                <i class="fa-solid fa-rotate"></i>
                刷新
            </button>
        `)}
        <div class="dashboard-grid">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">当前连接</h2>
                        <p class="panel-subtitle">从 SillyTavern settings.json 读取非密钥字段。</p>
                    </div>
                    <span class="badge">${escapeHtml(provider.api)}</span>
                </div>
                <div class="api-current">
                    <div>
                        <span class="metric-label">主 API</span>
                        <strong>${escapeHtml(provider.api)}</strong>
                    </div>
                    <div>
                        <span class="metric-label">来源</span>
                        <strong>${escapeHtml(provider.chatSource || '未配置')}</strong>
                    </div>
                    <div>
                        <span class="metric-label">模型</span>
                        <strong>${escapeHtml(provider.model || '未配置')}</strong>
                    </div>
                    <div>
                        <span class="metric-label">预设</span>
                        <strong>${escapeHtml(provider.preset || '未配置')}</strong>
                    </div>
                </div>
                <div class="connection-test">
                    <span class="badge ${state.apiTest.status === '失败' ? 'danger' : ''}">${escapeHtml(state.apiTest.status)}</span>
                    <span>${escapeHtml(state.apiTest.detail)}</span>
                </div>
                ${renderApiConnectionEditor(provider)}
            </section>
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">连接诊断</h2>
                        <p class="panel-subtitle">集中显示模型、密钥、CSRF 和测试结果。</p>
                    </div>
                </div>
                ${renderApiDiagnostics(checks)}
                ${renderApiTestHistory()}
            </section>
        </div>
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">连接档案</h2>
                    <p class="panel-subtitle">敏感字段已省略。</p>
                </div>
            </div>
            <div class="grid-list">
                ${profiles.map(profile => renderApiProfileCard(profile)).join('')}
            </div>
        </section>
        <details class="panel section-panel raw-data-panel">
            <summary>
                <span>
                    <strong>原始字段</strong>
                    <em>用于排查连接选择，默认折叠。</em>
                </span>
                <i class="fa-solid fa-chevron-down"></i>
            </summary>
            <div class="grid-list">
                <article class="resource-card">
                    <h3 class="card-title">主配置</h3>
                    <div class="kv-list">
                        ${renderKeyValue('main_api', provider.api)}
                        ${renderKeyValue('chat_completion_source', provider.chatSource || '未设置')}
                        ${renderKeyValue('model', provider.model || '未设置')}
                        ${renderKeyValue('preset', provider.preset || '未设置')}
                    </div>
                </article>
                <article class="resource-card">
                    <h3 class="card-title">安全</h3>
                    <div class="kv-list">
                        ${renderKeyValue('secrets exposure', state.secrets?.allowKeysExposure ? '允许显示' : '不允许显示')}
                        ${renderKeyValue('csrf token', state.csrfToken ? '已获取' : '未获取')}
                        ${renderKeyValue('accounts', state.settingsBundle.enable_accounts ? '开启' : '关闭')}
                        ${renderKeyValue('extensions', state.settingsBundle.enable_extensions ? '开启' : '关闭')}
                    </div>
                </article>
            </div>
        </details>
    `;
    }

    function renderApiDiagnostics(checks) {
        return `
        <div class="api-diagnostic-list">
            ${checks.map(check => `
                <article class="api-diagnostic-card ${check.state === 'ok' ? '' : 'needs-attention'}">
                    <span class="avatar-fallback"><i class="fa-solid ${check.state === 'ok' ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i></span>
                    <span class="row-main">
                        <strong>${escapeHtml(check.label)}</strong>
                        <span class="row-subtitle">${escapeHtml(check.detail)}</span>
                    </span>
                    <span class="${check.state === 'ok' ? 'success' : 'danger'}">${check.state === 'ok' ? '正常' : '需检查'}</span>
                </article>
            `).join('')}
        </div>
    `;
    }

    function renderApiTestHistory() {
        return `
        <section class="form-section api-history-panel">
            <div>
                <h3 class="form-section-title">测试历史</h3>
                <p class="panel-subtitle">保留最近 5 次本页连接测试。</p>
            </div>
            <div class="resource-list compact-list">
                ${state.apiTestHistory.map(item => `
                    <article class="resource-row">
                        <span class="avatar-fallback"><i class="fa-solid ${item.status === '可用' ? 'fa-plug-circle-check' : 'fa-triangle-exclamation'}"></i></span>
                        <span class="row-main">
                            <span class="row-title">${escapeHtml(item.source)} / ${escapeHtml(item.model)}</span>
                            <span class="row-subtitle">${escapeHtml(formatDate(item.time))} · ${escapeHtml(item.detail)}</span>
                        </span>
                        <span class="${item.status === '可用' ? 'success' : 'danger'}">${escapeHtml(item.status)}</span>
                    </article>
                `).join('') || renderInlineEmpty('还没有测试记录')}
            </div>
        </section>
    `;
    }

    function renderApiProfileCard(profile) {
        const canSelect = profile.mainApi && profile.title !== '主连接';
        return `
        <article class="resource-card api-profile-card">
            <div class="card-head">
                <div>
                    <h3 class="card-title">${escapeHtml(profile.title)}</h3>
                    <div class="card-meta">${escapeHtml(profile.kind)}</div>
                </div>
                <span class="badge">${profile.active ? '当前' : '备用'}</span>
            </div>
            <div class="kv-list">
                ${renderKeyValue('来源', profile.source || '未配置')}
                ${renderKeyValue('模型', profile.model || '未配置')}
                ${renderKeyValue('预设', profile.preset || '未配置')}
                ${renderKeyValue('端点', profile.endpoint || '未配置')}
            </div>
            ${canSelect ? `
                <button class="secondary-button" type="button" data-api-profile-main="${escapeHtml(profile.mainApi)}">
                    <i class="fa-solid fa-arrow-right"></i>
                    查看${escapeHtml(profile.title)}
                </button>
            ` : ''}
        </article>
    `;
    }

    function renderApiConnectionEditor(provider) {
        const settings = state.settings.oai_settings || {};
        const source = provider.chatSource || settings.chat_completion_source || 'openai';
        const model = getChatCompletionModel(settings, source);
        const endpoint = settings.siliconflow_endpoint === 'global' ? 'global' : 'cn';
        const apiUiState = getApiSourceUiState(source);
        const openAiPresetNames = getPresetGroups().find(group => group.id === 'openai')?.names || [];
        const mainApi = getSelectedApiMain();

        if (mainApi !== 'openai') {
            const textgenProfile = getApiProfiles().find(profile => profile.title === '文本补全') || {};
            return `
            <div class="settings-form">
                <section class="form-section">
                    <div>
                        <h3 class="form-section-title">连接</h3>
                        <p class="panel-subtitle">现代页当前可编辑聊天补全连接；文本补全连接以只读档案展示。</p>
                    </div>
                    <div class="form-grid two-columns">
                        ${renderApiMainSelect(mainApi)}
                    </div>
                </section>
                <section class="form-section">
                    <div>
                        <h3 class="form-section-title">文本补全档案</h3>
                        <p class="panel-subtitle">文本补全高级编辑暂不开放；当前在新版内展示来源、端点和采样参数状态。</p>
                    </div>
                    <div class="kv-list">
                        ${renderKeyValue('来源', textgenProfile.source || '未配置')}
                        ${renderKeyValue('模型', textgenProfile.model || '未配置')}
                        ${renderKeyValue('预设', textgenProfile.preset || '未配置')}
                        ${renderKeyValue('端点', textgenProfile.endpoint || '未配置')}
                    </div>
                </section>
            </div>
        `;
        }

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
                            ${chatCompletionSourceOptions.map(option => `<option value="${escapeHtml(option.id)}" ${source === option.id ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
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

    function renderApiMainSelect(mainApi) {
        return `
        <label class="field-label">
            <span>主 API</span>
            <select class="select-input" data-api-main>
                <option value="openai" ${mainApi === 'openai' ? 'selected' : ''}>聊天补全</option>
                <option value="textgenerationwebui" ${mainApi === 'textgenerationwebui' ? 'selected' : ''}>文本补全（只读）</option>
            </select>
        </label>
    `;
    }

    function getApiProfiles() {
        const settings = state.settings || {};
        const textgen = settings.textgenerationwebui_settings || {};
        const oaiSettings = settings.oai_settings || {};
        const openaiSource = settings.chat_completion_source || oaiSettings.chat_completion_source || '';
        const openaiModel = openaiSource ? getChatCompletionModel(oaiSettings, openaiSource) : '';
        const textgenModel = textgen.openrouter_model || textgen.custom_model || textgen.generic_model || textgen.ollama_model || textgen.model || '';
        const chatPreset = oaiSettings.preset_settings_openai || settings.preset_settings_openai || '';
        const chatEndpoint = getChatCompletionEndpoint(openaiSource, oaiSettings);
        const textgenPreset = settings.textgenerationwebui_preset || settings.textgenerationwebui_settings_preset || '';
        const textgenEndpoint = maskEndpoint(textgen.server_urls?.[textgen.type] || textgen.api_server || settings.api_server_textgenerationwebui || '');
        const mainIsChat = settings.main_api === 'openai';
        const mainIsTextgen = settings.main_api === 'textgenerationwebui';

        return [
            {
                title: '主连接',
                kind: 'generation',
                mainApi: settings.main_api || '',
                active: true,
                source: settings.main_api || '',
                model: mainIsChat ? openaiModel : (mainIsTextgen ? textgenModel : settings.model || ''),
                preset: mainIsChat ? chatPreset : (mainIsTextgen ? textgenPreset : settings.preset_settings || settings.active_preset || ''),
                endpoint: mainIsChat ? chatEndpoint : (mainIsTextgen ? textgenEndpoint : maskEndpoint(settings.api_server || settings.api_server_textgenerationwebui || '')),
            },
            {
                title: '聊天补全',
                kind: 'chat-completions',
                mainApi: 'openai',
                active: settings.main_api === 'openai',
                source: openaiSource,
                model: openaiModel,
                preset: chatPreset,
                endpoint: chatEndpoint,
            },
            {
                title: '文本补全',
                kind: 'text-completions',
                mainApi: 'textgenerationwebui',
                active: settings.main_api === 'textgenerationwebui',
                source: textgen.type || settings.textgen_type || '',
                model: textgenModel,
                preset: textgenPreset,
                endpoint: textgenEndpoint,
            },
        ];
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

    function getApiChecks(provider, profiles) {
        const secretKey = secretKeyByChatSource[provider.chatSource];
        const secretState = getSecretStateForSource(provider.chatSource);

        return [
            {
                label: '主 API',
                state: provider.api && provider.api !== '未选择' ? 'ok' : 'warn',
                detail: provider.api && provider.api !== '未选择' ? provider.api : '尚未选择主 API。',
            },
            {
                label: '模型',
                state: provider.model ? 'ok' : 'warn',
                detail: provider.model || '未读取到模型字段。',
            },
            {
                label: '连接档案',
                state: profiles.some(profile => profile.source || profile.model || profile.endpoint) ? 'ok' : 'warn',
                detail: `${formatNumber(profiles.length)} 个可见档案。`,
            },
            {
                label: '密钥显示',
                state: state.secrets?.allowKeysExposure ? 'warn' : 'ok',
                detail: state.secrets?.allowKeysExposure ? '当前允许查看密钥。' : '当前不会暴露密钥明文。',
            },
            {
                label: '当前来源密钥',
                state: !secretKey || secretState.length ? 'ok' : 'warn',
                detail: secretKey ? (secretState.length ? `${secretKey} 已保存` : `${secretKey} 未保存`) : '当前来源无需或暂未映射密钥。',
            },
            {
                label: 'CSRF',
                state: state.csrfToken ? 'ok' : 'warn',
                detail: state.csrfToken ? '现代页请求令牌正常。' : '尚未获取请求令牌。',
            },
        ];
    }

    async function handleClick(event) {
        if (event.target.closest('[data-test-api]')) {
            try {
                await testApiConnection();
            } catch (error) {
                state.errors.push({ key: 'api-test', message: error.message });
                showToast('连接测试失败', error.message);
                render();
            }
            return true;
        }

        const apiProfileButton = event.target.closest('[data-api-profile-main]');
        if (apiProfileButton) {
            state.apiMainDraft = apiProfileButton.dataset.apiProfileMain;
            render();
            return true;
        }

        const apiModelSuggestionButton = event.target.closest('[data-api-model-suggestion]');
        if (apiModelSuggestionButton) {
            setApiModelSuggestion(apiModelSuggestionButton.dataset.apiModelSuggestion);
            return true;
        }

        if (event.target.closest('[data-save-api-connection]')) {
            try {
                await saveApiConnectionFromForm();
            } catch (error) {
                state.errors.push({ key: 'api-save', message: error.message });
                showToast('连接配置保存失败', error.message);
                render();
            }
            return true;
        }


        return false;
    }

    function handleChange(event) {
        if (event.target instanceof HTMLSelectElement && event.target.matches('[data-api-main]')) {
            state.apiMainDraft = event.target.value;
            render();
            return true;
        }

        if (event.target instanceof HTMLSelectElement && event.target.matches('[data-api-source]')) {
            updateApiSourceFields(event.target.value);
            return true;
        }

        return false;
    }

    return {
        render: renderApi,
        handleClick,
        handleChange,
    };
}
