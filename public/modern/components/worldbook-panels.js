export function createWorldbookPanelComponents(ctx) {
    const {
        state,
        escapeHtml,
        isGlobalWorldEnabled,
    } = ctx;

    function renderWorldbookCreatePanel() {
        return `
        <div class="settings-form inline-form">
            <label class="field-label">
                <span>世界书名称</span>
                <input class="text-input" type="text" data-worldbook-create-name value="${escapeHtml(state.worldbookCreating.name)}" placeholder="例如：角色设定集">
            </label>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-worldbook-create>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="primary-button" type="button" data-save-worldbook-create>
                    <i class="fa-solid fa-check"></i>
                    创建
                </button>
            </div>
        </div>
    `;
    }

    function renderWorldbookRow(worldbook) {
        const globalEnabled = isGlobalWorldEnabled(worldbook.file_id);

        return `
        <button class="resource-row ${state.selected.worldbook === worldbook.file_id ? 'active' : ''}" type="button" data-select-worldbook="${escapeHtml(worldbook.file_id)}">
            <span class="avatar-fallback"><i class="fa-solid fa-book-open"></i></span>
            <span class="row-main">
                <span class="row-title">${escapeHtml(worldbook.name || worldbook.file_id)}</span>
                <span class="row-subtitle">${escapeHtml(worldbook.file_id)}</span>
            </span>
            <span class="badge ${globalEnabled ? '' : 'danger'}">${globalEnabled ? '全局启用' : '未启用'}</span>
        </button>
    `;
    }

    function renderWorldbookDeletePanel(worldbook) {
        return `
        <div class="settings-form inline-form danger-panel">
            <div>
                <strong>删除世界书</strong>
                <p class="panel-subtitle">将删除 ${escapeHtml(worldbook.file_id)}.json，并从全局启用列表移除。角色卡里已有的关联字段不会自动改写。</p>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-worldbook-delete>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button danger-action" type="button" data-confirm-worldbook-delete>
                    <i class="fa-solid fa-trash"></i>
                    确认删除
                </button>
            </div>
        </div>
    `;
    }

    // Global world-info generation parameters (injection budget / recursion), previously only editable in the legacy UI
    function renderWorldbookGlobalSettingsPanel() {
        const worldInfo = state.settings.world_info_settings || {};
        const numberValue = (field, fallback) => {
            const value = Number(worldInfo[field]);
            return Number.isFinite(value) ? value : fallback;
        };
        const boolValue = field => !!worldInfo[field];
        return `
        <details class="settings-form inline-form worldbook-global-settings">
            <summary class="form-subsection-title">全局生成参数</summary>
            <p class="panel-subtitle">影响所有启用世界书的注入预算与扫描行为，对应旧版全局设置。</p>
            <div class="form-grid two-columns">
                <label class="field-label">
                    <span>扫描深度</span>
                    <input class="text-input" type="number" min="0" step="1" data-worldbook-setting="world_info_depth" value="${numberValue('world_info_depth', 2)}">
                </label>
                <label class="field-label">
                    <span>预算（%）</span>
                    <input class="text-input" type="number" min="1" max="100" step="1" data-worldbook-setting="world_info_budget" value="${numberValue('world_info_budget', 25)}">
                </label>
                <label class="field-label">
                    <span>预算上限（tokens，0 表示不限）</span>
                    <input class="text-input" type="number" min="0" step="1" data-worldbook-setting="world_info_budget_cap" value="${numberValue('world_info_budget_cap', 0)}">
                </label>
            </div>
            <label class="checkbox-card compact-checkbox">
                <input type="checkbox" data-worldbook-setting="world_info_recursive" ${boolValue('world_info_recursive') ? 'checked' : ''}>
                <span>递归扫描</span>
            </label>
            <label class="checkbox-card compact-checkbox">
                <input type="checkbox" data-worldbook-setting="world_info_overflow_alert" ${boolValue('world_info_overflow_alert') ? 'checked' : ''}>
                <span>预算溢出提醒</span>
            </label>
            <label class="checkbox-card compact-checkbox">
                <input type="checkbox" data-worldbook-setting="world_info_case_sensitive" ${boolValue('world_info_case_sensitive') ? 'checked' : ''}>
                <span>区分大小写</span>
            </label>
            <label class="checkbox-card compact-checkbox">
                <input type="checkbox" data-worldbook-setting="world_info_match_whole_words" ${boolValue('world_info_match_whole_words') ? 'checked' : ''}>
                <span>全词匹配</span>
            </label>
        </details>
    `;
    }

    return {
        renderWorldbookCreatePanel,
        renderWorldbookDeletePanel,
        renderWorldbookRow,
        renderWorldbookGlobalSettingsPanel,
    };
}
