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

    const compositionBoundInputs = new WeakSet();

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

        if (event.target.closest('[data-chat-backups-close]')) {
            if (state.chatBackups.open) {
                await toggleChatBackups();
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

        const confirmRestoreButton = event.target.closest('[data-confirm-chat-backup-restore]');
        if (confirmRestoreButton) {
            try {
                await restoreChatBackup(confirmRestoreButton.dataset.confirmChatBackupRestore, { confirmed: true });
            } catch (error) {
                state.errors.push({ key: 'chat-backup-restore', message: error.message });
                showToast('备份恢复失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-cancel-chat-backup-restore]')) {
            state.chatBackups.restoreConfirm = '';
            render();
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

    function applyBackupSearch(input) {
        state.chatBackups.query = input.value;
        state.chatBackups.restoreConfirm = '';
        const cursor = input.selectionStart ?? input.value.length;
        render();
        const nextInput = document.querySelector('[data-chat-backup-search]');
        if (nextInput instanceof HTMLInputElement) {
            nextInput.focus();
            nextInput.setSelectionRange(cursor, cursor);
        }
    }

    function handleChatBackupInput(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || !target.matches('[data-chat-backup-search]')) {
            return false;
        }

        // Re-rendering replaces the input, which would cancel an IME composition; the compositionend
        // listener bound in bindChatBackupDom applies the committed text instead.
        if (event.isComposing) {
            state.chatBackups.query = target.value;
            return true;
        }

        applyBackupSearch(target);
        return true;
    }

    function handleChatBackupChange(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return false;
        }

        if (target.matches('[data-chat-backup-show-all]')) {
            state.chatBackups.showAll = target.checked;
            state.chatBackups.restoreConfirm = '';
            render();
            return true;
        }

        if (target.matches('[data-chat-backup-show-empty]')) {
            state.chatBackups.showEmpty = target.checked;
            state.chatBackups.restoreConfirm = '';
            render();
            return true;
        }

        return false;
    }

    // Called after every chat render: the drawer DOM is rebuilt each time, so per-element listeners
    // that the shell's delegated events cannot cover are re-attached here.
    function bindChatBackupDom() {
        const searchInput = document.querySelector('[data-chat-backup-search]');
        if (searchInput instanceof HTMLInputElement && !compositionBoundInputs.has(searchInput)) {
            compositionBoundInputs.add(searchInput);
            searchInput.addEventListener('compositionend', () => applyBackupSearch(searchInput));
        }
    }

    return {
        bindChatBackupDom,
        handleChatBackupChange,
        handleChatBackupClick,
        handleChatBackupInput,
    };
}
