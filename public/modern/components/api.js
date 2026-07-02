import { createApiChatCompletionComponents } from './api-chat-completion.js';
import { createApiTextCompletionComponents } from './api-text-completion.js';

export function createApiComponents(ctx) {
    const {
        state,
        secretKeyByChatSource,
        escapeHtml,
        formatDate,
        formatNumber,
        maskEndpoint,
        pageHead,
        renderInlineEmpty,
        renderKeyValue,
        getProviderInfo,
        getSelectedApiMain,
        getChatCompletionModel,
        getSecretStateForSource,
    } = ctx;
    const {
        renderChatCompletionEditor,
        getChatCompletionEndpoint,
    } = createApiChatCompletionComponents(ctx);
    const {
        renderTextCompletionEditor,
        getTextCompletionProfile,
        getTextCompletionSecretKey,
    } = createApiTextCompletionComponents(ctx);

    function renderApi() {
        const provider = getCurrentProviderInfo();
        const profiles = getApiProfiles();
        const checks = getApiChecks(provider, profiles);
        const canTestConnection = ['openai', 'textgenerationwebui'].includes(getSelectedApiMain());

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
        const mainApi = getSelectedApiMain();

        if (mainApi === 'textgenerationwebui') {
            return renderTextCompletionEditor(mainApi, renderApiMainSelect);
        }

        if (mainApi !== 'openai') {
            return `
            <div class="settings-form">
                <section class="form-section">
                    <div>
                        <h3 class="form-section-title">连接</h3>
                        <p class="panel-subtitle">当前主 API 暂不支持在现代页编辑。</p>
                    </div>
                    <div class="form-grid two-columns">
                        ${renderApiMainSelect(mainApi)}
                    </div>
                </section>
            </div>
        `;
        }

        return renderChatCompletionEditor(provider, mainApi, renderApiMainSelect);
    }

    function renderApiMainSelect(mainApi) {
        const isModernMainApi = mainApi === 'openai' || mainApi === 'textgenerationwebui';
        return `
        <label class="field-label">
            <span>主 API</span>
            <select class="select-input" data-api-main>
                ${isModernMainApi ? '' : `<option value="${escapeHtml(mainApi)}" selected disabled>当前：${escapeHtml(mainApi || '未选择')}（暂不支持编辑）</option>`}
                <option value="openai" ${mainApi === 'openai' ? 'selected' : ''}>聊天补全</option>
                <option value="textgenerationwebui" ${mainApi === 'textgenerationwebui' ? 'selected' : ''}>文本补全</option>
            </select>
        </label>
    `;
    }

    function getApiProfiles() {
        const settings = state.settings || {};
        const oaiSettings = settings.oai_settings || {};
        const openaiSource = settings.chat_completion_source || oaiSettings.chat_completion_source || '';
        const openaiModel = openaiSource ? getChatCompletionModel(oaiSettings, openaiSource) : '';
        const textgenProfile = getTextCompletionProfile();
        const chatPreset = oaiSettings.preset_settings_openai || settings.preset_settings_openai || '';
        const chatEndpoint = getChatCompletionEndpoint(openaiSource, oaiSettings);
        const mainIsChat = settings.main_api === 'openai';
        const mainIsTextgen = settings.main_api === 'textgenerationwebui';

        return [
            {
                title: '主连接',
                kind: 'generation',
                mainApi: settings.main_api || '',
                active: true,
                source: settings.main_api || '',
                model: mainIsChat ? openaiModel : (mainIsTextgen ? textgenProfile.model : settings.model || ''),
                preset: mainIsChat ? chatPreset : (mainIsTextgen ? textgenProfile.preset : settings.preset_settings || settings.active_preset || ''),
                endpoint: mainIsChat ? chatEndpoint : (mainIsTextgen ? textgenProfile.endpoint : maskEndpoint(settings.api_server || settings.api_server_textgenerationwebui || '')),
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
                source: textgenProfile.source,
                model: textgenProfile.model,
                preset: textgenProfile.preset,
                endpoint: textgenProfile.endpoint,
            },
        ];
    }

    function getCurrentProviderInfo() {
        const provider = getProviderInfo();
        if (getSelectedApiMain() !== 'textgenerationwebui') {
            return provider;
        }

        const textgenProfile = getTextCompletionProfile();
        return {
            ...provider,
            api: 'textgenerationwebui',
            chatSource: textgenProfile.source,
            model: textgenProfile.model,
            preset: textgenProfile.preset,
        };
    }

    function getApiChecks(provider, profiles) {
        const mainApi = getSelectedApiMain();
        const secretKey = mainApi === 'textgenerationwebui' ? getTextCompletionSecretKey(provider.chatSource) : secretKeyByChatSource[provider.chatSource];
        const textgenSecretState = secretKey ? state.secretState?.[secretKey] : null;
        const secretState = mainApi === 'textgenerationwebui' ? (Array.isArray(textgenSecretState) ? textgenSecretState : []) : getSecretStateForSource(provider.chatSource);

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

    return {
        renderApi,
    };
}
