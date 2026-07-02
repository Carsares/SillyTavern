export function createSettingsPreferenceComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatBytes,
        renderKeyValue,
        getChatModeLabel,
    } = ctx;

    function renderSettingsPreferencesSection(requestCompression, compressionEnabled) {
        return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">可编辑设置</h2>
                    <p class="panel-subtitle">现代页本地偏好与 settings.json 中的请求压缩参数。</p>
                </div>
            </div>
            <div class="settings-edit-grid">
                ${renderModernPreferencesForm()}
                ${renderRequestCompressionForm(requestCompression)}
            </div>
        </section>
        <div class="grid-list settings-summary-grid">
            <article class="resource-card">
                <h2 class="card-title">现代界面</h2>
                <p class="card-meta">新版工作区本地偏好。</p>
                <div class="kv-list">
                    ${renderKeyValue('主题', state.theme)}
                    ${renderKeyValue('聊天类型', getChatModeLabel())}
                    ${renderKeyValue('聊天列表', state.chatSidebarOpen ? '展开' : '收起')}
                    ${renderKeyValue('上下文抽屉', state.inspectorOpen ? '展开' : '收起')}
                    ${renderKeyValue('入口', '/modern/')}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">请求压缩</h2>
                <p class="card-meta">控制大请求的压缩边界。</p>
                <div class="kv-list">
                    ${renderKeyValue('启用', compressionEnabled ? '是' : '否')}
                    ${renderKeyValue('最小载荷', formatBytes(requestCompression.minPayloadSize))}
                    ${renderKeyValue('最大载荷', formatBytes(requestCompression.maxPayloadSize))}
                </div>
            </article>
        </div>
    `;
    }

    function renderModernPreferencesForm() {
        const defaultChatSidebarOpen = localStorage.getItem('st-modern-chat-sidebar-open') === null
            ? state.chatSidebarOpen
            : localStorage.getItem('st-modern-chat-sidebar-open') === 'true';
        const defaultInspectorOpen = localStorage.getItem('st-modern-inspector-open') === null
            ? state.inspectorOpen
            : localStorage.getItem('st-modern-inspector-open') === 'true';

        return `
        <section class="form-section">
            <div>
                <h3 class="form-section-title">现代界面偏好</h3>
                <p class="panel-subtitle">保存到浏览器本地，只影响新版工作区。</p>
            </div>
            <div class="form-grid two-columns">
                <label class="field-label">
                    <span>主题</span>
                    <select class="select-input" data-modern-theme>
                        <option value="light" ${state.theme === 'light' ? 'selected' : ''}>浅色</option>
                        <option value="dark" ${state.theme === 'dark' ? 'selected' : ''}>深色</option>
                    </select>
                </label>
                <label class="field-label">
                    <span>默认聊天类型</span>
                    <select class="select-input" data-modern-chat-mode>
                        <option value="character" ${state.chatMode === 'character' ? 'selected' : ''}>角色</option>
                        <option value="group" ${state.chatMode === 'group' ? 'selected' : ''}>群聊</option>
                    </select>
                </label>
            </div>
            <div class="checkbox-grid compact-checkbox-grid">
                <label class="checkbox-card">
                    <input type="checkbox" data-modern-chat-sidebar-open ${defaultChatSidebarOpen ? 'checked' : ''}>
                    <span>默认展开聊天列表</span>
                </label>
                <label class="checkbox-card">
                    <input type="checkbox" data-modern-inspector-open ${defaultInspectorOpen ? 'checked' : ''}>
                    <span>默认展开上下文抽屉</span>
                </label>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-save-modern-preferences>
                    <i class="fa-solid fa-floppy-disk"></i>
                    保存界面偏好
                </button>
            </div>
        </section>
    `;
    }

    function renderRequestCompressionForm(requestCompression) {
        return `
        <section class="form-section">
            <div>
                <h3 class="form-section-title">请求压缩</h3>
                <p class="panel-subtitle">控制大请求压缩边界，保存到 settings.json。</p>
            </div>
            <label class="checkbox-card compact-checkbox">
                <input type="checkbox" data-request-compression-enabled ${requestCompression.enabled ? 'checked' : ''}>
                <span>启用请求压缩</span>
            </label>
            <div class="form-grid two-columns">
                <label class="field-label">
                    <span>最小载荷 Byte</span>
                    <input class="text-input" type="number" min="0" step="1" data-request-compression-min value="${escapeHtml(requestCompression.minPayloadSize ?? 0)}">
                </label>
                <label class="field-label">
                    <span>最大载荷 Byte</span>
                    <input class="text-input" type="number" min="0" step="1" data-request-compression-max value="${escapeHtml(requestCompression.maxPayloadSize ?? 0)}">
                </label>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-save-request-compression>
                    <i class="fa-solid fa-floppy-disk"></i>
                    保存请求压缩
                </button>
            </div>
        </section>
    `;
    }

    return {
        renderSettingsPreferencesSection,
    };
}
