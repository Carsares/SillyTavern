import { createChatContextLoaderActions } from './chat-context-loaders.js';
import { createChatContextSelectorHelpers } from './chat-context-selectors.js';

export function createChatContextActions({
    state,
    apiFetch,
    render,
    showToast,
    getCharacterAvatarUrl,
}) {
    const {
        createAssistantMessage,
        createModernChatId,
        getCharacterGreeting,
        getCharacterName,
        getChatCacheKey,
        getChatContextKey,
        getChatEntityAvatarUrl,
        getChatEntityEmptyDescription,
        getChatEntityEmptyTitle,
        getChatEntityFallbackIcon,
        getChatEntityListEmptyText,
        getChatEntityName,
        getChatId,
        getChatMessageCount,
        getChatModeLabel,
        getCurrentDraftKey,
        getCurrentMessageLimit,
        getSelectedCharacter,
        getSelectedChatEntity,
        getSelectedChatList,
        getSelectedChatMessages,
        getSelectedChatMetadata,
        getSelectedGroup,
        getUserName,
        getVisibleChatList,
        isGroupChatMode,
        sortChats,
    } = createChatContextSelectorHelpers({
        state,
        getCharacterAvatarUrl,
    });
    const {
        clearChatSearch,
        loadCharacterChats,
        loadChatMessages,
        loadGroupChats,
        prepareChatForSelectedContext,
        refreshSelectedChatList,
        searchSelectedChats,
    } = createChatContextLoaderActions({
        state,
        apiFetch,
        render,
        showToast,
        getChatCacheKey,
        getChatContextKey,
        getSelectedChatEntity,
        isGroupChatMode,
        sortChats,
    });

    function useChatMode(mode, { resetChat = false } = {}) {
        const nextMode = mode === 'group' ? 'group' : 'character';
        if (state.chatMode === nextMode) {
            return false;
        }

        state.chatMode = nextMode;
        localStorage.setItem('st-modern-chat-mode', nextMode);
        if (resetChat) {
            state.selected.chat = '';
            state.chatRenaming = { key: '', name: '' };
            state.chatDeleteConfirm = { key: '', name: '' };
            state.chatEditing = { key: '', index: -1, text: '' };
            state.chatMessageDeleteConfirm = { key: '', index: -1 };
            clearChatSearch();
        }
        return true;
    }

    function ensureAvailableChatMode() {
        if (state.chatMode === 'group' && !state.groups.length && state.characters.length) {
            return useChatMode('character', { resetChat: true });
        }
        if (state.chatMode === 'character' && !state.characters.length && state.groups.length) {
            return useChatMode('group', { resetChat: true });
        }
        return false;
    }

    function increaseCurrentMessageLimit() {
        const key = getCurrentDraftKey();
        if (!key) {
            return;
        }
        state.chatMessageLimits[key] = Math.min(getSelectedChatMessages().length, getCurrentMessageLimit() + 80);
        render();
    }

    function getCurrentDraft() {
        return state.chatDrafts[getCurrentDraftKey()] || '';
    }

    function setCurrentDraft(value) {
        state.chatDrafts[getCurrentDraftKey()] = value;
    }

    async function saveGroupMetadata(group) {
        if (!group?.id) {
            throw new Error('缺少群聊。');
        }
        await apiFetch('/api/groups/edit', { body: group });
    }

    async function saveModernChat(entity, chatId, messages) {
        const contextKey = getChatContextKey(entity);
        if (!contextKey || !chatId) {
            throw new Error(isGroupChatMode() ? '缺少群聊或聊天文件' : '缺少角色或聊天文件');
        }

        const metadata = getSelectedChatMetadata(entity, chatId);
        const chat = [
            { chat_metadata: metadata, user_name: 'unused', character_name: 'unused' },
            ...messages,
        ];
        const result = isGroupChatMode()
            ? await apiFetch('/api/chats/group/save', { body: { id: chatId, chat } })
            : await apiFetch('/api/chats/save', {
                body: {
                    ch_name: getCharacterName(entity),
                    file_name: chatId,
                    avatar_url: entity.avatar,
                    chat,
                },
            });

        if (result?.error) {
            throw new Error(result.error === 'integrity' ? '聊天文件已被其他会话修改，请刷新后重试。' : String(result.error));
        }

        state.chatMessages[getChatCacheKey(contextKey, chatId)] = messages;
    }

    async function createModernChatFile(entity) {
        const contextKey = getChatContextKey(entity);
        if (!contextKey) {
            throw new Error(isGroupChatMode() ? '请先选择群聊' : '请先选择角色');
        }

        const chatId = createModernChatId();
        const greeting = isGroupChatMode() ? '' : getCharacterGreeting(entity);
        const messages = greeting ? [createAssistantMessage(greeting, entity)] : [];
        state.selected.chat = chatId;
        state.chatMetadata[getChatCacheKey(contextKey, chatId)] = {};
        state.chatMessages[getChatCacheKey(contextKey, chatId)] = messages;
        if (isGroupChatMode()) {
            entity.chats = Array.isArray(entity.chats) ? entity.chats : [];
            if (!entity.chats.includes(chatId)) {
                entity.chats.push(chatId);
            }
            entity.chat_id = chatId;
            await saveGroupMetadata(entity);
        }
        await saveModernChat(entity, chatId, messages);
        await refreshSelectedChatList(entity);
        return chatId;
    }

    function toggleChatSidebar(open = !state.chatSidebarOpen) {
        state.chatSidebarOpen = open;
        localStorage.setItem('st-modern-chat-sidebar-open', String(open));
        render();
    }

    function isChatSidebarOverlayVisible() {
        const scrim = document.querySelector('.chat-sidebar-scrim');
        return !!scrim && window.getComputedStyle(scrim).display !== 'none';
    }

    function closeChatSidebarForMobileSelection() {
        if (!state.chatSidebarOpen || !isChatSidebarOverlayVisible()) {
            return false;
        }

        state.chatSidebarOpen = false;
        localStorage.setItem('st-modern-chat-sidebar-open', 'false');
        return true;
    }

    function closeChatSidebarOverlay() {
        if (!closeChatSidebarForMobileSelection()) {
            return false;
        }

        render();
        return true;
    }

    return {
        getSelectedCharacter,
        getSelectedGroup,
        isGroupChatMode,
        useChatMode,
        ensureAvailableChatMode,
        getChatModeLabel,
        getSelectedChatEntity,
        getChatContextKey,
        getChatEntityName,
        getChatEntityAvatarUrl,
        getChatEntityFallbackIcon,
        getChatEntityEmptyTitle,
        getChatEntityEmptyDescription,
        getChatEntityListEmptyText,
        getSelectedChatList,
        getChatId,
        getChatMessageCount,
        getVisibleChatList,
        getSelectedChatMessages,
        getCurrentMessageLimit,
        increaseCurrentMessageLimit,
        getChatCacheKey,
        sortChats,
        loadCharacterChats,
        loadGroupChats,
        clearChatSearch,
        searchSelectedChats,
        loadChatMessages,
        prepareChatForSelectedContext,
        getCurrentDraftKey,
        getCurrentDraft,
        setCurrentDraft,
        getCharacterName,
        getUserName,
        saveGroupMetadata,
        saveModernChat,
        refreshSelectedChatList,
        createModernChatFile,
        toggleChatSidebar,
        closeChatSidebarForMobileSelection,
        closeChatSidebarOverlay,
    };
}
