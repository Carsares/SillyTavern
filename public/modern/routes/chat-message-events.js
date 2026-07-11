export function createChatMessageEvents(ctx) {
    const {
        state,
        render,
        showToast,
        sendModernMessage,
        stopModernGeneration,
        checkLegacyGenerationEngine,
        regenerateModernReply,
        continueModernReply,
        triggerGroupMemberModernReply,
        swipeModernMessage,
        copyModernMessage,
        beginModernMessageDelete,
        cancelModernMessageDelete,
        confirmModernMessageDelete,
        beginModernMessageEdit,
        cancelModernMessageEdit,
        saveModernMessageEdit,
    } = ctx;

    async function handleChatMessageClick(event) {
        if (event.target.closest('[data-send-message]')) {
            try {
                await sendModernMessage();
            } catch (error) {
                state.errors.push({ key: 'modern-send', message: error.message });
                showToast('发送失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-stop-generation]')) {
            await stopModernGeneration();
            return true;
        }

        if (event.target.closest('[data-check-generation-engine]')) {
            try {
                await checkLegacyGenerationEngine();
            } catch (error) {
                state.errors.push({ key: 'legacy-engine-check', message: error.message });
                showToast('生成引擎检查失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-regenerate-message]')) {
            try {
                await regenerateModernReply();
            } catch (error) {
                state.errors.push({ key: 'regenerate', message: error.message });
                showToast('重生成失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-continue-message]')) {
            try {
                await continueModernReply();
            } catch (error) {
                state.errors.push({ key: 'continue-message', message: error.message });
                showToast('继续生成失败', error.message);
                render();
            }
            return true;
        }

        const speakMemberButton = event.target.closest('[data-speak-member]');
        if (speakMemberButton) {
            try {
                await triggerGroupMemberModernReply(speakMemberButton.dataset.speakMember);
            } catch (error) {
                state.errors.push({ key: 'group-manual-speak', message: error.message });
                showToast('生成失败', error.message);
                render();
            }
            return true;
        }

        const swipeMessageButton = event.target.closest('[data-swipe-message]');
        if (swipeMessageButton) {
            try {
                await swipeModernMessage(swipeMessageButton.dataset.swipeMessage, swipeMessageButton.dataset.swipeDirection);
            } catch (error) {
                state.errors.push({ key: 'swipe-message', message: error.message });
                showToast('候选切换失败', error.message);
                render();
            }
            return true;
        }

        const copyMessageButton = event.target.closest('[data-copy-message]');
        if (copyMessageButton) {
            try {
                await copyModernMessage(copyMessageButton.dataset.copyMessage);
            } catch (error) {
                state.errors.push({ key: 'copy-message', message: error.message });
                showToast('复制消息失败', error.message);
                render();
            }
            return true;
        }

        const deleteMessageButton = event.target.closest('[data-delete-message]');
        if (deleteMessageButton) {
            beginModernMessageDelete(deleteMessageButton.dataset.deleteMessage);
            return true;
        }

        if (event.target.closest('[data-cancel-message-delete]')) {
            cancelModernMessageDelete();
            return true;
        }

        if (event.target.closest('[data-confirm-message-delete]')) {
            try {
                await confirmModernMessageDelete();
            } catch (error) {
                state.errors.push({ key: 'delete-message', message: error.message });
                showToast('删除消息失败', error.message);
                render();
            }
            return true;
        }

        const editMessageButton = event.target.closest('[data-edit-message]');
        if (editMessageButton) {
            beginModernMessageEdit(editMessageButton.dataset.editMessage);
            return true;
        }

        if (event.target.closest('[data-cancel-edit-message]')) {
            cancelModernMessageEdit();
            return true;
        }

        if (event.target.closest('[data-save-edit-message]')) {
            try {
                await saveModernMessageEdit();
            } catch (error) {
                state.errors.push({ key: 'edit-message', message: error.message });
                showToast('保存消息失败', error.message);
                render();
            }
            return true;
        }

        return false;
    }

    return {
        handleChatMessageClick,
    };
}
