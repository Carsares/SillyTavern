export function createApiCurrentComponents(ctx) {
    const {
        state,
        escapeHtml,
    } = ctx;

    function renderApiCurrentPanel(provider, renderConnectionEditor) {
        return `
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
            ${renderConnectionEditor()}
        </section>
    `;
    }

    function renderUnsupportedApiEditor(mainApi, renderApiMainSelect) {
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

    return {
        renderApiCurrentPanel,
        renderUnsupportedApiEditor,
        renderApiMainSelect,
    };
}
