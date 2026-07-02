import { createWorldbookEntryFormComponents } from './worldbook-entry-forms.js';

export function createWorldbookEntryComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatNumber,
        getWorldEntryTitle,
    } = ctx;
    const {
        renderWorldEntryForm,
        renderWorldEntryCreatePanel,
    } = createWorldbookEntryFormComponents(ctx);

    function renderWorldEntryBulkDeletePanel(selectedCount) {
        return `
        <div class="settings-form inline-form danger-panel">
            <div>
                <strong>批量删除条目</strong>
                <p class="panel-subtitle">将删除当前选中的 ${formatNumber(selectedCount)} 个世界书条目，此操作不可撤销。</p>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-world-entry-bulk-delete>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button danger-action" type="button" data-confirm-world-entry-bulk-delete>
                    <i class="fa-solid fa-trash"></i>
                    确认删除
                </button>
            </div>
        </div>
    `;
    }

    function renderWorldEntryCard(worldbook, entryKey, entry) {
        const isEditing = state.worldEntryEditing.worldbookId === worldbook.file_id && state.worldEntryEditing.entryKey === entryKey;
        const isDeleting = state.worldEntryDeleteConfirm.worldbookId === worldbook.file_id && state.worldEntryDeleteConfirm.entryKey === entryKey;
        const isSelected = state.worldEntryList.selectedKeys.includes(String(entryKey));
        const keywords = Array.isArray(entry.key) ? entry.key.filter(Boolean).join(', ') : entry.key || '无关键词';
        const content = String(entry.content || '').replace(/\s+/g, ' ').trim();
        const preview = content.length > 220 ? `${content.slice(0, 220)}...` : content;

        return `
        <article class="resource-card world-entry-card ${isSelected ? 'selected' : ''}">
            <div class="card-head">
                <label class="selection-row">
                    <input type="checkbox" data-world-entry-select="${escapeHtml(entryKey)}" ${isSelected ? 'checked' : ''}>
                    <span>${isSelected ? '已选择' : '选择'}</span>
                </label>
                <span class="${entry.disable ? 'danger' : 'success'}">
                    <i class="fa-solid ${entry.disable ? 'fa-circle-pause' : 'fa-circle-check'}"></i>
                    ${entry.disable ? '禁用' : '启用'}
                </span>
            </div>
            <div>
                <h3 class="card-title">${escapeHtml(getWorldEntryTitle(entry, entryKey))}</h3>
                <p class="row-subtitle">${escapeHtml(keywords)}</p>
            </div>
            ${preview ? `<p class="detail-text world-entry-preview">${escapeHtml(preview)}</p>` : ''}
            <div class="tag-row">
                <span class="tag">#${escapeHtml(entryKey)}</span>
                <span class="tag">顺序 ${escapeHtml(entry.order ?? 0)}</span>
                <span class="tag">位置 ${escapeHtml(entry.position ?? '默认')}</span>
                ${entry.probability !== undefined ? `<span class="tag">概率 ${escapeHtml(entry.probability)}</span>` : ''}
                ${entry.constant ? '<span class="tag">常驻</span>' : ''}
                ${entry.selective ? '<span class="tag">关键词触发</span>' : ''}
            </div>
            <div class="row-actions">
                <button class="secondary-button" type="button" data-edit-world-entry="${escapeHtml(worldbook.file_id)}" data-world-entry-key="${escapeHtml(entryKey)}" ${isEditing ? 'disabled' : ''}>
                    <i class="fa-solid fa-pen"></i>
                    编辑
                </button>
                <button class="secondary-button" type="button" data-toggle-world-entry="${escapeHtml(worldbook.file_id)}" data-world-entry-key="${escapeHtml(entryKey)}">
                    <i class="fa-solid ${entry.disable ? 'fa-toggle-off' : 'fa-toggle-on'}"></i>
                    ${entry.disable ? '启用' : '禁用'}
                </button>
                <button class="secondary-button" type="button" data-copy-world-entry="${escapeHtml(worldbook.file_id)}" data-world-entry-key="${escapeHtml(entryKey)}">
                    <i class="fa-solid fa-copy"></i>
                    复制
                </button>
                <button class="secondary-button" type="button" data-delete-world-entry="${escapeHtml(worldbook.file_id)}" data-world-entry-key="${escapeHtml(entryKey)}">
                    <i class="fa-solid fa-ellipsis"></i>
                    管理
                </button>
            </div>
            ${isEditing ? renderWorldEntryForm(entryKey, entry) : ''}
            ${isDeleting ? renderWorldEntryDeletePanel(entryKey, entry) : ''}
        </article>
    `;
    }

    function renderWorldEntryDeletePanel(entryKey, entry) {
        return `
        <div class="settings-form inline-form danger-panel">
            <div>
                <strong>删除条目</strong>
                <p class="panel-subtitle">将删除 ${escapeHtml(getWorldEntryTitle(entry, entryKey))}，操作不可撤销。</p>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-world-entry-delete>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button danger-action" type="button" data-confirm-world-entry-delete>
                    <i class="fa-solid fa-trash"></i>
                    确认删除
                </button>
            </div>
        </div>
    `;
    }

    return {
        renderWorldEntryBulkDeletePanel,
        renderWorldEntryCard,
        renderWorldEntryCreatePanel,
    };
}
