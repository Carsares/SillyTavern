export function createChatBackupEvents(ctx) {
    const {
        state,
        render,
        showToast,
        toggleChatBackups,
        loadChatBackups,
        viewChatBackup,
        restoreChatBackup,
        beginChatBackupDelete,
        cancelChatBackupDelete,
        confirmChatBackupDelete,
    } = ctx;

    async function handleChatBackupClick(event) {
        if (event.target.closest('[data-chat-backups-toggle]')) {
            try {
                await toggleChatBackups();
            } catch (error) {
                state.errors.push({ key: 'chat-backups', message: error.message });
                showToast('备份读取失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-chat-backups-refresh]')) {
            try {
                await loadChatBackups({ force: true });
                render();
            } catch (error) {
                state.errors.push({ key: 'chat-backups', message: error.message });
                showToast('备份刷新失败', error.message);
                render();
            }
            return true;
        }

        const viewChatBackupButton = event.target.closest('[data-view-chat-backup]');
        if (viewChatBackupButton) {
            try {
                await viewChatBackup(viewChatBackupButton.dataset.viewChatBackup);
            } catch (error) {
                state.errors.push({ key: 'chat-backup-view', message: error.message });
                showToast('备份预览失败', error.message);
                render();
            }
            return true;
        }

        const restoreChatBackupButton = event.target.closest('[data-restore-chat-backup]');
        if (restoreChatBackupButton) {
            try {
                await restoreChatBackup(restoreChatBackupButton.dataset.restoreChatBackup);
            } catch (error) {
                state.errors.push({ key: 'chat-backup-restore', message: error.message });
                showToast('备份恢复失败', error.message);
                render();
            }
            return true;
        }

        const deleteChatBackupButton = event.target.closest('[data-delete-chat-backup]');
        if (deleteChatBackupButton) {
            beginChatBackupDelete(deleteChatBackupButton.dataset.deleteChatBackup);
            return true;
        }

        if (event.target.closest('[data-cancel-chat-backup-delete]')) {
            cancelChatBackupDelete();
            return true;
        }

        if (event.target.closest('[data-confirm-chat-backup-delete]')) {
            try {
                await confirmChatBackupDelete();
            } catch (error) {
                state.errors.push({ key: 'chat-backup-delete', message: error.message });
                showToast('备份删除失败', error.message);
                render();
            }
            return true;
        }

        return false;
    }

    return {
        handleChatBackupClick,
    };
}
