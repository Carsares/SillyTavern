export function createChatBackupComponents({
    state,
    escapeHtml,
    formatDate,
    formatNumber,
    renderEmptyState,
    renderInlineEmpty,
    getChatModeLabel,
    getChatMessageCount,
}) {
    function renderChatBackupsPanel() {
        const backups = state.chatBackups.items;
        const isLoading = state.chatBackups.loading;
        const targetLabel = `当前选中${getChatModeLabel()}`;

        return `
        <section class="panel chat-tool-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">聊天备份</h2>
                    <p class="panel-subtitle">自动保存的聊天备份；恢复会导入到${targetLabel}，不覆盖原文件。</p>
                </div>
                <button class="secondary-button" type="button" data-chat-backups-refresh ${isLoading ? 'disabled' : ''}>
                    <i class="fa-solid ${isLoading ? 'fa-circle-notch fa-spin' : 'fa-rotate'}"></i>
                    刷新备份
                </button>
            </div>
            <div class="backup-layout">
                <div class="resource-list backup-list">
                    ${backups.map(backup => renderChatBackupRow(backup)).join('') || renderInlineEmpty(isLoading ? '正在读取备份' : '暂无聊天备份')}
                </div>
                <div class="backup-preview">
                    ${state.chatBackups.previewName ? `
                        <div class="panel-header compact-header">
                            <div>
                                <h3 class="panel-title">${escapeHtml(state.chatBackups.previewName)}</h3>
                                <p class="panel-subtitle">预览最近 40 条可读消息。</p>
                            </div>
                        </div>
                        <textarea readonly>${escapeHtml(state.chatBackups.previewText)}</textarea>
                    ` : renderEmptyState('fa-eye', '未选择备份', `点击“预览”查看备份内容，或点击“恢复”导入到${targetLabel}。`)}
                </div>
            </div>
        </section>
    `;
    }

    function renderChatBackupRow(backup) {
        const name = backup.file_name || backup.file_id || '';
        const isDeleting = state.chatBackups.deleteConfirm === name;
        const isBusy = state.chatBackups.restoring === name || (isDeleting && state.chatBackups.deleting);
        const meta = [
            `${formatNumber(getChatMessageCount(backup))} 条消息`,
            backup.file_size || '',
            formatDate(backup.last_mes),
        ].filter(Boolean).join(' · ');

        return `
        <article class="backup-row ${state.chatBackups.previewName === name ? 'active' : ''}">
            <div class="row-main">
                <strong class="row-title">${escapeHtml(name)}</strong>
                <span class="row-subtitle">${escapeHtml(meta)}</span>
            </div>
            <div class="row-actions">
                <button class="secondary-button" type="button" data-view-chat-backup="${escapeHtml(name)}" ${isBusy ? 'disabled' : ''}>
                    <i class="fa-solid fa-eye"></i>
                    预览
                </button>
                <button class="secondary-button" type="button" data-restore-chat-backup="${escapeHtml(name)}" ${isBusy ? 'disabled' : ''}>
                    <i class="fa-solid ${state.chatBackups.restoring === name ? 'fa-circle-notch fa-spin' : 'fa-file-import'}"></i>
                    恢复
                </button>
                ${isDeleting ? `
                    <button class="secondary-button" type="button" data-cancel-chat-backup-delete ${state.chatBackups.deleting ? 'disabled' : ''}>
                        取消
                    </button>
                    <button class="secondary-button danger-action" type="button" data-confirm-chat-backup-delete ${state.chatBackups.deleting ? 'disabled' : ''}>
                        <i class="fa-solid ${state.chatBackups.deleting ? 'fa-circle-notch fa-spin' : 'fa-trash'}"></i>
                        确认删除
                    </button>
                ` : `
                    <button class="secondary-button" type="button" data-delete-chat-backup="${escapeHtml(name)}" ${isBusy ? 'disabled' : ''}>
                        <i class="fa-solid fa-ellipsis"></i>
                        管理
                    </button>
                `}
            </div>
        </article>
    `;
    }

    return {
        renderChatBackupsPanel,
    };
}
