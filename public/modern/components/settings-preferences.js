export function createSettingsPreferenceComponents(ctx) {
    const {
        state,
        escapeHtml,
    } = ctx;

    // The account & resource tab carries the read-only summaries; this tab only holds the forms
    function renderSettingsPreferencesSection(requestCompression) {
        return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">界面与请求设置</h2>
                    <p class="panel-subtitle">界面偏好可在此修改；请求压缩来自 config.yaml，只在此展示。</p>
                </div>
            </div>
            <div class="settings-edit-grid">
                ${renderModernPreferencesForm()}
                ${renderRequestCompressionForm(requestCompression)}
            </div>
        </section>
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
            <section class="form-section settings-readonly-section" data-request-compression-readonly>
                <div>
                    <h3 class="form-section-title">
                        请求压缩
                        <span class="badge" title="运行中不可修改"><i class="fa-solid fa-lock"></i>只读</span>
                    </h3>
                    <p class="panel-subtitle">来自 config.yaml 的启动配置，运行中不可在现代页修改；如需调整，请编辑 config.yaml 后重启服务。</p>
                </div>
                <label class="checkbox-card compact-checkbox">
                    <input type="checkbox" data-request-compression-enabled ${requestCompression.enabled ? 'checked' : ''} disabled>
                    <span>启用请求压缩</span>
                </label>
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>最小载荷（字节）</span>
                        <input class="text-input" type="number" data-request-compression-min value="${escapeHtml(requestCompression.minPayloadSize ?? 0)}" disabled>
                    </label>
                    <label class="field-label">
                        <span>最大载荷（字节）</span>
                        <input class="text-input" type="number" data-request-compression-max value="${escapeHtml(requestCompression.maxPayloadSize ?? 0)}" disabled>
                    </label>
                </div>
            </section>
    `;
    }

    return {
        renderSettingsPreferencesSection,
    };
}
