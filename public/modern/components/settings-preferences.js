export function createSettingsPreferenceComponents(ctx) {
    const {
        state,
    } = ctx;

    // 界面偏好只存在浏览器本地，改动即保存（routes/settings-events.js → saveModernPreferenceField）
    function renderSettingsPreferencesSection() {
        const defaultChatSidebarOpen = localStorage.getItem('st-modern-chat-sidebar-open') === null
            ? state.chatSidebarOpen
            : localStorage.getItem('st-modern-chat-sidebar-open') === 'true';
        const defaultInspectorOpen = localStorage.getItem('st-modern-inspector-open') === null
            ? state.inspectorOpen
            : localStorage.getItem('st-modern-inspector-open') === 'true';

        return `
        <section class="panel section-panel" data-preserve-inputs>
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">界面</h2>
                    <p class="panel-subtitle">只保存在当前浏览器，只影响这个工作区的外观和默认布局。</p>
                </div>
            </div>
            <div class="settings-form">
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
                        <span>打开聊天页时展开会话列表</span>
                    </label>
                    <label class="checkbox-card">
                        <input type="checkbox" data-modern-inspector-open ${defaultInspectorOpen ? 'checked' : ''}>
                        <span>打开页面时展开右侧上下文抽屉</span>
                    </label>
                </div>
            </div>
        </section>
    `;
    }

    return {
        renderSettingsPreferencesSection,
    };
}
