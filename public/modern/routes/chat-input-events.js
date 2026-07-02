export function createChatInputEvents(ctx) {
    const {
        state,
        render,
        showToast,
        getSelectedChatEntity,
        clearChatSearch,
        searchSelectedChats,
        sendModernMessage,
        cancelModernMessageDelete,
        cancelModernMessageEdit,
        getCurrentDraftKey,
        setCurrentDraft,
        importModernChatFiles,
    } = ctx;

    function handleChatInput(event) {
        if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-chat-input]')) {
            setCurrentDraft(event.target.value);
            updateComposerSendState(event.target);
            return true;
        }
        if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-edit-message-input]')) {
            state.chatEditing.text = event.target.value;
            return true;
        }
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-chat-rename-input]')) {
            state.chatRenaming.name = event.target.value;
            return true;
        }
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-chat-search-input]')) {
            state.chatSearch.query = event.target.value;
            return true;
        }

        return false;
    }

    function updateComposerSendState(input) {
        const draftLength = input.value.trim().length;
        const hasTarget = Boolean(getSelectedChatEntity());
        const canSend = !state.engine.generating && hasTarget && draftLength > 0;
        const composer = input.closest('.composer');
        const sendButton = composer?.querySelector('[data-send-message]');
        const status = composer?.querySelector('[data-composer-status]');

        if (sendButton instanceof HTMLButtonElement) {
            sendButton.disabled = !canSend;
        }
        if (status) {
            status.textContent = getComposerStatusText(draftLength, hasTarget);
        }
    }

    function getComposerStatusText(draftLength, hasTarget) {
        if (!hasTarget) {
            return '先选择角色或群聊。';
        }
        if (state.engine.generating) {
            return state.engine.detail || '生成中，请等待当前回复完成。';
        }
        if (draftLength > 0) {
            return `${draftLength} 字，准备发送。`;
        }
        return '输入消息后可发送；空消息不会提交。';
    }

    async function handleChatInputChange(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-chat-import-file]')) {
            try {
                await importModernChatFiles(event.target.files);
            } catch (error) {
                state.errors.push({ key: 'chat-import', message: error.message });
                showToast('聊天导入失败', error.message);
                render();
            } finally {
                event.target.value = '';
            }
            return true;
        }

        return false;
    }

    function handleChatInputKeydown(event) {
        if (event.key === 'Escape') {
            const currentDraftKey = getCurrentDraftKey();
            if (state.chatEditing.key === currentDraftKey && state.chatEditing.index >= 0) {
                event.preventDefault();
                cancelModernMessageEdit();
                return true;
            }
            if (state.chatMessageDeleteConfirm.key === currentDraftKey && state.chatMessageDeleteConfirm.index >= 0) {
                event.preventDefault();
                cancelModernMessageDelete();
                return true;
            }
        }

        if (event.target instanceof HTMLElement && event.target.matches('[data-chat-input]') && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            sendModernMessage().catch(error => {
                state.errors.push({ key: 'modern-send', message: error.message });
                showToast('发送失败', error.message);
                render();
            });
            return true;
        }

        if (event.target instanceof HTMLElement && event.target.matches('[data-chat-search-input]') && event.key === 'Enter') {
            event.preventDefault();
            if (!state.chatSearch.query.trim()) {
                clearChatSearch();
                render();
                return true;
            }
            searchSelectedChats().then(() => render()).catch(error => {
                state.errors.push({ key: 'chat-search', message: error.message });
                showToast('聊天搜索失败', error.message);
                render();
            });
            return true;
        }

        return false;
    }

    return {
        handleChatInput,
        handleChatInputChange,
        handleChatInputKeydown,
    };
}
