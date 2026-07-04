export function createChatContextEvents(ctx) {
    const {
        state,
        render,
        showToast,
        getSelectedChatEntity,
        clearChatSearch,
        clearChatTransientState,
        prepareChatForSelectedContext,
        closeChatSidebarForMobileSelection,
        loadChatMessages,
        searchSelectedChats,
        increaseCurrentMessageLimit,
    } = ctx;

    async function handleChatContextClick(event) {
        const chatModeButton = event.target.closest('[data-chat-mode]');
        if (chatModeButton) {
            const nextMode = chatModeButton.dataset.chatMode === 'group' ? 'group' : 'character';
            if (state.chatMode !== nextMode) {
                state.chatMode = nextMode;
                localStorage.setItem('st-modern-chat-mode', nextMode);
                state.selected.chat = '';
                clearChatTransientState();
                clearChatSearch();
                await prepareChatForSelectedContext({ forceList: true });
            }
            render();
            return true;
        }

        if (event.target.closest('[data-refresh-chat-list]')) {
            try {
                clearChatSearch();
                await prepareChatForSelectedContext({ forceList: true });
                render();
            } catch (error) {
                state.errors.push({ key: 'chat-refresh', message: error.message });
                showToast('聊天列表刷新失败', error.message);
                render();
            }
            return true;
        }

        const chatButton = event.target.closest('[data-select-chat]');
        if (chatButton) {
            state.selected.chat = chatButton.dataset.selectChat;
            clearChatTransientState();
            await loadChatMessages(getSelectedChatEntity(), state.selected.chat);
            closeChatSidebarForMobileSelection();
            render();
            return true;
        }

        if (event.target.closest('[data-chat-search-run]')) {
            try {
                if (!state.chatSearch.query.trim()) {
                    clearChatSearch();
                } else {
                    await searchSelectedChats();
                }
                render();
            } catch (error) {
                state.errors.push({ key: 'chat-search', message: error.message });
                showToast('聊天搜索失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-chat-search-clear]')) {
            clearChatSearch();
            render();
            return true;
        }

        if (event.target.closest('[data-load-earlier-messages]')) {
            increaseCurrentMessageLimit();
            return true;
        }

        return false;
    }

    return {
        handleChatContextClick,
    };
}
