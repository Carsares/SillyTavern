import { createWorldbookEntryComponents } from './worldbook-entries.js';
import { createWorldbookPanelComponents } from './worldbook-panels.js';

export function createWorldbooksComponents(ctx) {
    const {
        state,
        worldEntryPageSize,
        escapeHtml,
        formatNumber,
        metricCard,
        pageHead,
        renderEmptyState,
        renderInlineEmpty,
        renderRouteFilter,
        matchesQuery,
        isGlobalWorldEnabled,
        getWorldEntryListState,
        getVisibleWorldEntries,
    } = ctx;
    const {
        renderWorldEntryBulkDeletePanel,
        renderWorldEntryCard,
        renderWorldEntryCreatePanel,
    } = createWorldbookEntryComponents(ctx);
    const {
        renderWorldbookCreatePanel,
        renderWorldbookDeletePanel,
        renderWorldbookRow,
        renderWorldbookGlobalSettingsPanel,
    } = createWorldbookPanelComponents(ctx);

    function renderWorldbooks() {
        const namesFromSettings = (state.settingsBundle.world_names || []).map(name => ({ file_id: name, name }));
        const worldbooks = (state.worldbooks.length ? state.worldbooks : namesFromSettings)
            .filter(worldbook => matchesQuery(worldbook.name, worldbook.file_id));
        const selected = worldbooks.find(worldbook => worldbook.file_id === state.selected.worldbook) || worldbooks[0];
        if (selected && state.selected.worldbook !== selected.file_id) {
            state.selected.worldbook = selected.file_id;
        }

        return `
        ${pageHead('世界书', '知识库文件、条目和启用状态。', `
            <button class="primary-button" type="button" data-create-worldbook>
                <i class="fa-solid fa-plus"></i>
                新建世界书
            </button>
            <label class="secondary-button file-action">
                <i class="fa-solid fa-file-import"></i>
                导入 JSON
                <input class="visually-hidden" type="file" accept=".json,application/json" data-worldbook-import-file>
            </label>
        `)}
        <div class="split-grid">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">世界书列表</h2>
                        <p class="panel-subtitle">${formatNumber(worldbooks.length)} 个匹配项</p>
                    </div>
                    ${renderRouteFilter('筛选世界书', '名称或文件 ID')}
                </div>
                ${state.worldbookCreating.active ? renderWorldbookCreatePanel() : ''}
                ${renderWorldbookGlobalSettingsPanel()}
                <div class="resource-list">
                    ${worldbooks.map(worldbook => renderWorldbookRow(worldbook)).join('') || renderInlineEmpty('暂无世界书')}
                </div>
            </section>
            <section class="panel">
                ${selected ? renderWorldbookDetail(selected) : renderEmptyState('fa-book-open', '暂无世界书', '当前用户目录里没有世界书。')}
            </section>
        </div>
    `;
    }

    function renderWorldbookDetail(worldbook) {
        const detail = state.worldDetails[worldbook.file_id];
        const entries = detail?.entries ? Object.entries(detail.entries) : [];
        const listState = getWorldEntryListState(worldbook.file_id);
        const visibleEntries = getVisibleWorldEntries(entries, listState);
        const totalPages = Math.max(1, Math.ceil(visibleEntries.length / worldEntryPageSize));
        listState.page = Math.min(Math.max(1, listState.page), totalPages);
        const pageEntries = visibleEntries.slice((listState.page - 1) * worldEntryPageSize, listState.page * worldEntryPageSize);
        const selectedCount = listState.selectedKeys.length;
        const enabledEntries = entries.filter(([, entry]) => !entry.disable);
        const globalEnabled = isGlobalWorldEnabled(worldbook.file_id);
        const isDeleting = state.worldbookDeleteConfirm.worldbookId === worldbook.file_id;
        const isCreatingEntry = state.worldEntryEditing.worldbookId === worldbook.file_id && state.worldEntryEditing.mode === 'create';

        return `
        <div class="panel-header">
            <div>
                <h2 class="panel-title">${escapeHtml(worldbook.name || worldbook.file_id)}</h2>
                <p class="panel-subtitle">${escapeHtml(worldbook.file_id)}.json</p>
            </div>
            <div class="page-actions">
                <button class="secondary-button" type="button" data-toggle-world-global="${escapeHtml(worldbook.file_id)}">
                    <i class="fa-solid ${globalEnabled ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
                    ${globalEnabled ? '停用全局' : '启用全局'}
                </button>
                <button class="secondary-button" type="button" data-load-worldbook="${escapeHtml(worldbook.file_id)}">
                    <i class="fa-solid ${detail ? 'fa-rotate' : 'fa-database'}"></i>
                    ${detail ? '刷新条目' : '读取条目'}
                </button>
                ${detail ? `
                    <button class="secondary-button" type="button" data-export-worldbook="${escapeHtml(worldbook.file_id)}">
                        <i class="fa-solid fa-file-export"></i>
                        导出 JSON
                    </button>
                    <button class="secondary-button" type="button" data-create-world-entry="${escapeHtml(worldbook.file_id)}">
                        <i class="fa-solid fa-plus"></i>
                        新条目
                    </button>
                ` : ''}
                <button class="secondary-button" type="button" data-delete-worldbook="${escapeHtml(worldbook.file_id)}">
                    <i class="fa-solid fa-ellipsis"></i>
                    管理
                </button>
            </div>
        </div>
        ${isDeleting ? renderWorldbookDeletePanel(worldbook) : ''}
        ${detail ? `
            <div class="metrics-grid compact-metrics">
                ${metricCard('条目', formatNumber(entries.length), '全部 entries', 'fa-list')}
                ${metricCard('启用', formatNumber(enabledEntries.length), '未禁用条目', 'fa-toggle-on')}
                ${metricCard('扩展字段', formatNumber(Object.keys(detail.extensions || {}).length), 'metadata', 'fa-code-branch')}
            </div>
            ${isCreatingEntry ? renderWorldEntryCreatePanel(state.worldEntryEditing.entryKey) : ''}
            <div class="list-toolbar">
                <label class="field-label">
                    <span>搜索条目</span>
                    <input class="text-input" type="search" data-world-entry-search value="${escapeHtml(listState.query)}" placeholder="关键词、注释或内容">
                </label>
                <label class="field-label">
                    <span>排序</span>
                    <select class="select-input" data-world-entry-sort>
                        <option value="order" ${listState.sort === 'order' ? 'selected' : ''}>按插入顺序</option>
                        <option value="comment" ${listState.sort === 'comment' ? 'selected' : ''}>按注释</option>
                        <option value="key" ${listState.sort === 'key' ? 'selected' : ''}>按关键词</option>
                        <option value="status" ${listState.sort === 'status' ? 'selected' : ''}>按启用状态</option>
                    </select>
                </label>
                <div class="toolbar-actions">
                    <button class="secondary-button" type="button" data-world-entry-page="${listState.page - 1}" ${listState.page <= 1 ? 'disabled' : ''}>
                        <i class="fa-solid fa-chevron-left"></i>
                        上一页
                    </button>
                    <span class="badge">${formatNumber(listState.page)} / ${formatNumber(totalPages)}</span>
                    <button class="secondary-button" type="button" data-world-entry-page="${listState.page + 1}" ${listState.page >= totalPages ? 'disabled' : ''}>
                        下一页
                        <i class="fa-solid fa-chevron-right"></i>
                    </button>
                    <button class="secondary-button" type="button" data-bulk-world-entries="enable" ${selectedCount ? '' : 'disabled'}>
                        <i class="fa-solid fa-toggle-on"></i>
                        启用所选 ${formatNumber(selectedCount)}
                    </button>
                    <button class="secondary-button" type="button" data-bulk-world-entries="disable" ${selectedCount ? '' : 'disabled'}>
                        <i class="fa-solid fa-toggle-off"></i>
                        禁用所选 ${formatNumber(selectedCount)}
                    </button>
                    <button class="secondary-button danger-action" type="button" data-delete-selected-world-entries ${selectedCount ? '' : 'disabled'}>
                        <i class="fa-solid fa-trash"></i>
                        删除所选 ${formatNumber(selectedCount)}
                    </button>
                </div>
            </div>
            ${state.worldEntryBulkDeleteConfirm.worldbookId === worldbook.file_id ? renderWorldEntryBulkDeletePanel(selectedCount) : ''}
            <div class="world-entry-list">
                ${pageEntries.map(([entryKey, entry]) => renderWorldEntryCard(worldbook, entryKey, entry)).join('') || renderInlineEmpty('没有条目')}
            </div>
        ` : renderEmptyState('fa-database', '正在读取条目', '如果长时间没有变化，可以点击“读取条目”重试。')}
    `;
    }

    return {
        renderWorldbooks,
    };
}
