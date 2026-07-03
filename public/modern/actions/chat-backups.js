export function createChatBackupActions({
    state,
    apiFetch,
    apiFetchResponse,
    render,
    showToast,
    formatDate,
    getChatContextKey,
    getChatEntityName,
    getSelectedChatEntity,
    importModernChatFiles,
    isGroupChatMode,
    sortChats,
}) {
    async function loadChatBackups({ force = false } = {}) {
        if (state.chatBackups.items.length && !force) {
            return state.chatBackups.items;
        }

        state.chatBackups.loading = true;
        render();
        try {
            const result = await apiFetch('/api/backups/chat/get');
            const backups = Array.isArray(result) ? sortChats(result.filter(item => item.file_name)) : [];
            state.chatBackups.items = backups;
            return backups;
        } finally {
            state.chatBackups.loading = false;
        }
    }

    async function toggleChatBackups() {
        state.chatBackups.open = !state.chatBackups.open;
        if (state.chatBackups.open) {
            await loadChatBackups();
        }
        render();
    }

    function closeChatBackups() {
        if (!state.chatBackups.open) {
            return false;
        }

        state.chatBackups.open = false;
        render();
        return true;
    }

    function formatBackupPreview(rawText) {
        const lines = String(rawText || '').split('\n').filter(Boolean);
        const messages = [];
        for (const line of lines) {
            try {
                const item = JSON.parse(line);
                if (item?.mes) {
                    messages.push(`${item.name || 'Unknown'} · ${formatDate(item.send_date)}\n${item.extra?.display_text || item.mes}`);
                }
            } catch {
                // Ignore broken lines in a backup preview; restore still uses the original file.
            }
        }

        return messages.slice(-40).join('\n\n') || '这个备份没有可预览的消息。';
    }

    async function downloadChatBackup(name) {
        return apiFetchResponse('/api/backups/chat/download', { body: { name } });
    }

    async function viewChatBackup(name) {
        const response = await downloadChatBackup(name);
        const rawText = await response.text();
        state.chatBackups.previewName = name;
        state.chatBackups.previewText = formatBackupPreview(rawText);
        render();
    }

    async function restoreChatBackup(name) {
        const entity = getSelectedChatEntity();
        if (!getChatContextKey(entity)) {
            throw new Error(isGroupChatMode() ? '请先选择要恢复到的群聊。' : '请先选择要恢复到的角色。');
        }

        state.chatBackups.restoring = name;
        render();
        try {
            const response = await downloadChatBackup(name);
            const blob = await response.blob();
            const file = new File([blob], name, { type: 'application/octet-stream' });
            await importModernChatFiles([file]);
            state.chatBackups.restoring = '';
            showToast('备份已恢复', `${name} 已导入到 ${getChatEntityName(entity)}`);
            render();
        } catch (error) {
            state.chatBackups.restoring = '';
            throw error;
        }
    }

    function beginChatBackupDelete(name) {
        state.chatBackups.deleteConfirm = name;
        render();
    }

    function cancelChatBackupDelete() {
        state.chatBackups.deleteConfirm = '';
        render();
    }

    async function confirmChatBackupDelete() {
        const name = state.chatBackups.deleteConfirm;
        if (!name) {
            throw new Error('请先选择一个备份。');
        }

        state.chatBackups.deleting = true;
        render();
        try {
            await apiFetch('/api/backups/chat/delete', { body: { name } });
            state.chatBackups.items = state.chatBackups.items.filter(item => item.file_name !== name);
            if (state.chatBackups.previewName === name) {
                state.chatBackups.previewName = '';
                state.chatBackups.previewText = '';
            }
            state.chatBackups.deleteConfirm = '';
            showToast('备份已删除', name);
        } finally {
            state.chatBackups.deleting = false;
            render();
        }
    }

    return {
        beginChatBackupDelete,
        cancelChatBackupDelete,
        closeChatBackups,
        confirmChatBackupDelete,
        loadChatBackups,
        restoreChatBackup,
        toggleChatBackups,
        viewChatBackup,
    };
}
