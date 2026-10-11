export function createChatFileEvents(ctx) {
    const {
        state,
        render,
        showToast,
        exportModernChat,
        startNewModernChat,
        beginModernChatRename,
        cancelModernChatRename,
        saveModernChatRename,
        beginModernChatDelete,
        cancelModernChatDelete,
        confirmModernChatDelete,
    } = ctx;

    async function handleChatFileClick(event) {
        const exportChatButton = event.target.closest('[data-export-chat]');
        if (exportChatButton) {
            try {
                await exportModernChat(exportChatButton.dataset.exportChat);
            } catch (error) {
                state.errors.push({ key: 'chat-export', message: error.message });
                showToast('聊天导出失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-new-chat]')) {
            try {
                await startNewModernChat();
            } catch (error) {
                state.errors.push({ key: 'new-chat', message: error.message });
                showToast('新聊天创建失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-rename-chat]')) {
            beginModernChatRename();
            return true;
        }

        if (event.target.closest('[data-cancel-chat-rename]')) {
            cancelModernChatRename();
            return true;
        }

        if (event.target.closest('[data-save-chat-rename]')) {
            try {
                await saveModernChatRename();
            } catch (error) {
                state.errors.push({ key: 'rename-chat', message: error.message });
                showToast('聊天重命名失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-delete-chat]')) {
            beginModernChatDelete();
            return true;
        }

        if (event.target.closest('[data-cancel-chat-delete]')) {
            cancelModernChatDelete();
            return true;
        }

        if (event.target.closest('[data-confirm-chat-delete]')) {
            try {
                await confirmModernChatDelete();
            } catch (error) {
                state.errors.push({ key: 'delete-chat', message: error.message });
                showToast('聊天删除失败', error.message);
                render();
            }
            return true;
        }

        return false;
    }

    return {
        handleChatFileClick,
    };
}
