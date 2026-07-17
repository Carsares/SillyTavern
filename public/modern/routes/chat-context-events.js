import { getScrollTop, restoreScrollTop } from '../core/scroll-state.js';

// Shared with the unread poll in app.js: these two lists scroll independently of the document
export const chatResourceListSelector = '.chat-browser .chat-browser-panel:first-child .resource-list';
export const chatFileListSelector = '.chat-browser .chat-browser-panel:nth-child(2) .resource-list';

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
            const resourceListScrollTop = getScrollTop(chatResourceListSelector);
            const chatFileListScrollTop = getScrollTop(chatFileListSelector);
            const chatId = chatButton.dataset.selectChat;
            const groupMode = state.chatMode === 'group';
            const entity = getSelectedChatEntity();
            const entityId = groupMode ? entity?.id : entity?.avatar;
            const isContextCurrent = () => {
                const currentEntity = getSelectedChatEntity();
                const currentEntityId = groupMode ? currentEntity?.id : currentEntity?.avatar;
                return state.chatMode === (groupMode ? 'group' : 'character') && state.selected.chat === chatId && currentEntityId === entityId;
            };
            state.selected.chat = chatId;
            clearChatTransientState();
            await loadChatMessages(entity, chatId, { groupMode, isContextCurrent });
            closeChatSidebarForMobileSelection();
            render();
            restoreScrollTop(chatResourceListSelector, resourceListScrollTop);
            restoreScrollTop(chatFileListSelector, chatFileListScrollTop);
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
