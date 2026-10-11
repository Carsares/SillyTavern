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
        loadAlternateGreetings,
        copyModernMessage,
        beginModernMessageDelete,
        cancelModernMessageDelete,
        confirmModernMessageDelete,
        beginModernMessageEdit,
        cancelModernMessageEdit,
        saveModernMessageEdit,
        translateModernMessage,
        toggleModernMessageTranslationView,
        clearModernMessageTranslation,
        cancelModernMessageTranslationConfirm,
        dismissModernMessageTranslationError,
    } = ctx;

    // 翻译（B3）：失败说明留在消息下面，动作抛出的前置错误（生成中、位置无效）用提示告知
    async function runTranslationAction(title, action) {
        try {
            await action();
        } catch (error) {
            state.errors.push({ key: 'translate-message', message: error.message });
            showToast(title, error.message);
            render();
        }
    }

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

        if (event.target.closest('[data-load-alternate-greetings]')) {
            try {
                await loadAlternateGreetings();
            } catch (error) {
                state.errors.push({ key: 'load-alternate-greetings', message: error.message });
                showToast('载入备用开场白失败', error.message);
                render();
            }
            return true;
        }

        const confirmTranslationButton = event.target.closest('[data-confirm-message-translation]');
        if (confirmTranslationButton) {
            await runTranslationAction('翻译失败', () => translateModernMessage(confirmTranslationButton.dataset.confirmMessageTranslation, { confirmed: true }));
            return true;
        }

        if (event.target.closest('[data-cancel-message-translation]')) {
            cancelModernMessageTranslationConfirm();
            return true;
        }

        const translateButton = event.target.closest('[data-translate-message]');
        if (translateButton) {
            await runTranslationAction('翻译失败', () => translateModernMessage(translateButton.dataset.translateMessage));
            return true;
        }

        const toggleTranslationButton = event.target.closest('[data-toggle-message-translation]');
        if (toggleTranslationButton) {
            await runTranslationAction('切换原文和译文失败', async () => toggleModernMessageTranslationView(toggleTranslationButton.dataset.toggleMessageTranslation));
            return true;
        }

        const clearTranslationButton = event.target.closest('[data-clear-message-translation]');
        if (clearTranslationButton) {
            await runTranslationAction('清除译文失败', () => clearModernMessageTranslation(clearTranslationButton.dataset.clearMessageTranslation));
            return true;
        }

        const dismissTranslationErrorButton = event.target.closest('[data-dismiss-message-translation-error]');
        if (dismissTranslationErrorButton) {
            await runTranslationAction('关闭提示失败', async () => dismissModernMessageTranslationError(dismissTranslationErrorButton.dataset.dismissMessageTranslationError));
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
