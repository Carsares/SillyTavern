// 输入框随内容长高，到 CSS max-height（styles/routes/chat.css）为止，再多的内容在框内滚动；
// 内容变短或清空后跟着缩回。先把高度压到最小（CSS min-height）才能量出变短后的 scrollHeight；用 0px 而不是
// auto，因为 auto 高度的网格子项会被拉伸到行高。量的这一下把外框锁在原高度：否则消息列表（窄屏时是整页）
// 会瞬间变高，浏览器把它的滚动位置往上夹，读者就离开了最新消息。
export function fitComposerInput(input) {
    if (!(input instanceof HTMLTextAreaElement)) {
        return;
    }
    const frame = input.closest('.composer');
    const style = getComputedStyle(input);
    const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    if (frame instanceof HTMLElement) {
        frame.style.minHeight = `${frame.offsetHeight}px`;
    }
    input.style.height = '0px';
    input.style.height = `${input.scrollHeight + borders}px`;
    if (frame instanceof HTMLElement) {
        frame.style.minHeight = '';
    }
}

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
            fitComposerInput(event.target);
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
        const sendButton = input.closest('.composer')?.querySelector('[data-send-message]');

        if (sendButton instanceof HTMLButtonElement) {
            sendButton.disabled = !canSend;
        }
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
