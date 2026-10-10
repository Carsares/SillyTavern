import {
    createChatBackupOwnerIndex,
    describeChatBackupOwner,
    getChatBackupOwnerKey,
    getEntityChatBackupKeys,
} from '../actions/chat-backup-ownership.js';

export function createChatBackupComponents({
    state,
    escapeHtml,
    formatDate,
    formatNumber,
    renderEmptyState,
    renderInlineEmpty,
    getChatModeLabel,
    getChatMessageCount,
    getChatEntityName,
    getSelectedChatEntity,
    getSelectedChatList,
    isGroupChatMode,
}) {
    // Filters default to "current character/group only" and "hide empty backups"; the flags live on
    // state.chatBackups and are undefined until the user flips them.
    function getBackupView() {
        const backups = Array.isArray(state.chatBackups.items) ? state.chatBackups.items : [];
        const groupMode = isGroupChatMode();
        const entity = getSelectedChatEntity();
        const currentKeys = getEntityChatBackupKeys({ entity, groupMode, chats: getSelectedChatList() });
        const ownerIndex = createChatBackupOwnerIndex({ characters: state.characters, groups: state.groups });
        const showAll = state.chatBackups.showAll === true;
        const showEmpty = state.chatBackups.showEmpty === true;
        const query = String(state.chatBackups.query || '').trim().toLowerCase();
        const rows = [];
        let currentCount = 0;
        let hiddenOtherCount = 0;
        let hiddenEmptyCount = 0;
        // Names outside the backend's chat_<key>_<YYYYMMDD-HHMMSS>.jsonl pattern (e.g. copied in by hand)
        // have no owner; they stay out of the per-character view but are counted so they never vanish silently.
        let unrecognizedCount = 0;

        for (const backup of backups) {
            const name = backup.file_name || backup.file_id || '';
            const ownerKey = getChatBackupOwnerKey(name);
            const isCurrent = ownerKey !== null && currentKeys.has(ownerKey);
            if (ownerKey === null) {
                unrecognizedCount += 1;
            }
            if (isCurrent) {
                currentCount += 1;
            }
            if (!showAll && !isCurrent) {
                hiddenOtherCount += 1;
                continue;
            }
            if (query && !name.toLowerCase().includes(query)) {
                continue;
            }
            if (!showEmpty && getChatMessageCount(backup) === 0) {
                hiddenEmptyCount += 1;
                continue;
            }
            rows.push({ backup, name, isCurrent });
        }

        return {
            backups,
            rows,
            ownerIndex,
            entity,
            entityName: entity ? getChatEntityName(entity) : '',
            showAll,
            showEmpty,
            query,
            currentCount,
            hiddenOtherCount,
            hiddenEmptyCount,
            unrecognizedCount,
        };
    }

    function renderChatBackupsPanel() {
        const isLoading = state.chatBackups.loading;
        const modeLabel = getChatModeLabel();
        const view = getBackupView();
        const targetLabel = view.entity ? `当前${modeLabel}「${view.entityName}」` : `当前选中${modeLabel}`;
        const showAllLabel = isGroupChatMode() ? '显示全部角色和群聊' : '显示全部角色';
        const summary = [
            `显示 ${formatNumber(view.rows.length)} 个`,
            `当前${modeLabel}共 ${formatNumber(view.currentCount)} 个`,
            `全部 ${formatNumber(view.backups.length)} 个`,
            view.unrecognizedCount
                ? `其中 ${formatNumber(view.unrecognizedCount)} 个无法识别归属${view.showAll ? '' : `（勾选「${showAllLabel}」查看）`}`
                : '',
        ].filter(Boolean).join(' · ');

        return `
        <section class="panel chat-tool-panel">
            <div class="panel-header chat-tool-header">
                <div class="chat-tool-heading">
                    <h2 class="panel-title">聊天备份</h2>
                    <p class="panel-subtitle">自动保存的聊天备份；恢复会作为新聊天导入到${escapeHtml(targetLabel)}，不覆盖原文件。</p>
                </div>
                <div class="panel-actions">
                    <button class="secondary-button" type="button" data-chat-backups-refresh ${isLoading ? 'disabled' : ''}>
                        <i class="fa-solid ${isLoading ? 'fa-circle-notch fa-spin' : 'fa-rotate'}"></i>
                        刷新备份
                    </button>
                    <button class="icon-button" type="button" data-chat-backups-close title="关闭备份抽屉" aria-label="关闭备份抽屉">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>
            <div class="backup-toolbar">
                <input class="text-input backup-search" type="search" data-chat-backup-search value="${escapeHtml(state.chatBackups.query || '')}" placeholder="按文件名筛选备份" aria-label="按文件名筛选备份" autocomplete="off">
                <label class="checkbox-card compact-checkbox">
                    <input type="checkbox" data-chat-backup-show-all ${view.showAll ? 'checked' : ''}>
                    <span>${showAllLabel}</span>
                </label>
                <label class="checkbox-card compact-checkbox">
                    <input type="checkbox" data-chat-backup-show-empty ${view.showEmpty ? 'checked' : ''}>
                    <span>显示空备份</span>
                </label>
                <span class="backup-summary" data-chat-backup-summary>${escapeHtml(summary)}</span>
            </div>
            <div class="backup-layout">
                <div class="resource-list backup-list" data-chat-backup-list>
                    ${view.rows.map(row => renderChatBackupRow(row, view)).join('') || renderBackupListEmpty(view, isLoading)}
                </div>
                <div class="backup-preview">
                    ${state.chatBackups.previewName ? `
                        <div class="panel-header compact-header">
                            <div class="chat-tool-heading">
                                <h3 class="panel-title backup-preview-title" title="${escapeHtml(state.chatBackups.previewName)}">${escapeHtml(state.chatBackups.previewName)}</h3>
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

    function renderBackupListEmpty(view, isLoading) {
        if (isLoading) {
            return renderInlineEmpty('正在读取备份');
        }
        if (!view.backups.length) {
            return renderInlineEmpty('暂无聊天备份');
        }

        const modeLabel = getChatModeLabel();
        const title = view.query
            ? '没有匹配的备份'
            : (view.showAll ? '没有可显示的备份' : `${modeLabel}「${view.entityName || '未选择'}」暂无聊天备份`);
        const hints = [];
        if (view.hiddenEmptyCount) {
            hints.push(`已隐藏 ${formatNumber(view.hiddenEmptyCount)} 个空备份，勾选「显示空备份」可查看。`);
        }
        if (view.hiddenOtherCount) {
            hints.push(`其他角色或群聊还有 ${formatNumber(view.hiddenOtherCount)} 个备份，勾选「${isGroupChatMode() ? '显示全部角色和群聊' : '显示全部角色'}」可查看。`);
        }
        return renderEmptyState('fa-box-open', title, hints.join(' ') || '自动备份会在聊天保存后出现在这里。');
    }

    function renderChatBackupRow({ backup, name, isCurrent }, view) {
        const isDeleting = state.chatBackups.deleteConfirm === name;
        const isConfirmingRestore = state.chatBackups.restoreConfirm === name;
        const isBusy = state.chatBackups.restoring === name || (isDeleting && state.chatBackups.deleting);
        const meta = [
            `${formatNumber(getChatMessageCount(backup))} 条消息`,
            backup.file_size || '',
            formatDate(backup.last_mes),
        ].filter(Boolean).join(' · ');
        const ownerLabel = isCurrent ? '' : describeChatBackupOwner(name, view.ownerIndex);

        return `
        <article class="backup-row ${state.chatBackups.previewName === name ? 'active' : ''} ${isCurrent ? '' : 'foreign'}" data-chat-backup-row="${escapeHtml(name)}">
            <div class="row-main backup-row-main">
                <strong class="row-title backup-row-title" title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
                <span class="row-subtitle backup-row-meta">${escapeHtml(meta)}</span>
                ${ownerLabel ? `<span class="row-subtitle backup-row-owner">来自 ${escapeHtml(ownerLabel)}</span>` : ''}
            </div>
            <div class="row-actions backup-row-actions">
                <button class="secondary-button compact-button" type="button" data-view-chat-backup="${escapeHtml(name)}" ${isBusy ? 'disabled' : ''}>
                    <i class="fa-solid fa-eye"></i>
                    预览
                </button>
                <button class="secondary-button compact-button" type="button" data-restore-chat-backup="${escapeHtml(name)}" ${isBusy || isConfirmingRestore ? 'disabled' : ''}>
                    <i class="fa-solid ${state.chatBackups.restoring === name ? 'fa-circle-notch fa-spin' : 'fa-file-import'}"></i>
                    恢复
                </button>
                ${isDeleting ? `
                    <button class="secondary-button compact-button" type="button" data-cancel-chat-backup-delete ${state.chatBackups.deleting ? 'disabled' : ''}>
                        取消
                    </button>
                    <button class="secondary-button compact-button danger-action" type="button" data-confirm-chat-backup-delete ${state.chatBackups.deleting ? 'disabled' : ''}>
                        <i class="fa-solid ${state.chatBackups.deleting ? 'fa-circle-notch fa-spin' : 'fa-trash'}"></i>
                        确认删除
                    </button>
                ` : `
                    <button class="secondary-button compact-button" type="button" data-delete-chat-backup="${escapeHtml(name)}" ${isBusy ? 'disabled' : ''}>
                        <i class="fa-solid fa-ellipsis"></i>
                        管理
                    </button>
                `}
            </div>
            ${isConfirmingRestore ? renderRestoreConfirm(name, view) : ''}
        </article>
    `;
    }

    function renderRestoreConfirm(name, view) {
        const modeLabel = getChatModeLabel();
        const ownerLabel = describeChatBackupOwner(name, view.ownerIndex);
        const entityName = view.entityName || '未选择';

        return `
        <div class="backup-restore-confirm" role="alert" data-chat-backup-restore-confirm>
            <p>这个备份属于${escapeHtml(ownerLabel)}，当前选中的是${modeLabel}「${escapeHtml(entityName)}」。确认后会把它作为新聊天导入到「${escapeHtml(entityName)}」，原备份不变。</p>
            <div class="row-actions">
                <button class="secondary-button compact-button" type="button" data-cancel-chat-backup-restore>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button compact-button danger-action" type="button" data-confirm-chat-backup-restore="${escapeHtml(name)}">
                    <i class="fa-solid fa-file-import"></i>
                    确认恢复到「${escapeHtml(entityName)}」
                </button>
            </div>
        </div>
    `;
    }

    return {
        renderChatBackupsPanel,
    };
}
