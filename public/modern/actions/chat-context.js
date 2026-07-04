import { createChatContextLoaderActions } from './chat-context-loaders.js';
import { createChatContextSelectorHelpers } from './chat-context-selectors.js';
import { chatReadStateStorageKey } from '../core/state.js';

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
        getChatUnreadCount,
        getCurrentDraftKey,
        getCurrentMessageLimit,
        getEntityUnreadCount,
        getTotalChatUnreadCount,
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

    function getChatReadCursors() {
        if (!state.chatReadState || typeof state.chatReadState !== 'object') {
            state.chatReadState = { cursors: {}, contexts: {} };
        }
        if (!state.chatReadState.cursors || typeof state.chatReadState.cursors !== 'object' || Array.isArray(state.chatReadState.cursors)) {
            state.chatReadState.cursors = {};
        }
        if (!state.chatReadState.contexts || typeof state.chatReadState.contexts !== 'object' || Array.isArray(state.chatReadState.contexts)) {
            state.chatReadState.contexts = {};
        }
        return state.chatReadState.cursors;
    }

    function getChatReadContexts() {
        getChatReadCursors();
        return state.chatReadState.contexts;
    }

    function persistChatReadState() {
        try {
            localStorage.setItem(chatReadStateStorageKey, JSON.stringify(state.chatReadState));
        } catch {
            // Read state is a UI convenience; storage failures should not block chat actions.
        }
    }

    function getKnownChat(contextKey, chatId) {
        return (state.chatLists[contextKey] || []).find(chat => getChatId(chat) === chatId) || null;
    }

    function setChatReadCursor(contextKey, chatId, messageCount, lastMes = '') {
        if (!contextKey || !chatId) {
            return;
        }

        const cursors = getChatReadCursors();
        const contexts = getChatReadContexts();
        const cacheKey = getChatCacheKey(contextKey, chatId);
        const count = Number(messageCount);
        const nextCursor = {
            messageCount: Number.isFinite(count) ? Math.max(0, count) : 0,
            lastMes: lastMes || '',
        };
        const previous = cursors[cacheKey];
        contexts[contextKey] = true;
        if (previous?.messageCount === nextCursor.messageCount && previous?.lastMes === nextCursor.lastMes) {
            persistChatReadState();
            return;
        }

        cursors[cacheKey] = nextCursor;
        persistChatReadState();
    }

    function syncChatReadStateForList(contextKey, chats) {
        if (!contextKey) {
            return;
        }

        const cursors = getChatReadCursors();
        const contexts = getChatReadContexts();
        const firstLoad = !contexts[contextKey];
        let changed = false;
        for (const chat of chats || []) {
            const chatId = getChatId(chat);
            if (!chatId) {
                continue;
            }

            const cacheKey = getChatCacheKey(contextKey, chatId);
            const messageCount = getChatMessageCount(chat);
            const cursor = cursors[cacheKey];
            if (!cursor) {
                if (firstLoad) {
                    cursors[cacheKey] = { messageCount, lastMes: chat.last_mes || '' };
                    changed = true;
                }
                continue;
            }

            const readCount = Number(cursor.messageCount || 0);
            if (readCount > messageCount) {
                cursors[cacheKey] = { messageCount, lastMes: chat.last_mes || cursor.lastMes || '' };
                changed = true;
            }
        }

        if (firstLoad) {
            contexts[contextKey] = true;
            changed = true;
        }
        if (changed) {
            persistChatReadState();
        }
    }

    function markChatRead(entity, chatId, messages = null) {
        const contextKey = getChatContextKey(entity);
        const normalizedChatId = getChatId({ file_id: chatId, file_name: chatId });
        const knownChat = getKnownChat(contextKey, normalizedChatId);
        const messageCount = Array.isArray(messages) ? messages.length : getChatMessageCount(knownChat);
        const lastMes = knownChat?.last_mes || (Array.isArray(messages) ? messages.at(-1)?.send_date : '') || '';
        setChatReadCursor(contextKey, normalizedChatId, messageCount, lastMes);
    }

    function moveChatReadState(contextKey, oldChatId, newChatId) {
        const oldId = getChatId({ file_id: oldChatId, file_name: oldChatId });
        const newId = getChatId({ file_id: newChatId, file_name: newChatId });
        if (!contextKey || !oldId || !newId || oldId === newId) {
            return;
        }

        const cursors = getChatReadCursors();
        const oldKey = getChatCacheKey(contextKey, oldId);
        const newKey = getChatCacheKey(contextKey, newId);
        if (cursors[oldKey]) {
            cursors[newKey] = cursors[oldKey];
            delete cursors[oldKey];
            persistChatReadState();
        }
    }

    function deleteChatReadState(contextKey, chatId) {
        const normalizedChatId = getChatId({ file_id: chatId, file_name: chatId });
        const cacheKey = getChatCacheKey(contextKey, normalizedChatId);
        const cursors = getChatReadCursors();
        if (cursors[cacheKey]) {
            delete cursors[cacheKey];
            persistChatReadState();
        }
    }

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
        getChatId,
        getChatMessageCount,
        getSelectedChatEntity,
        isGroupChatMode,
        markChatRead,
        sortChats,
        syncChatReadStateForList,
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

    async function refreshSelectedChatUnreadState() {
        const entity = getSelectedChatEntity();
        if (!entity) {
            return;
        }

        await refreshSelectedChatList(entity, { quiet: true });
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
        markChatRead(entity, chatId, messages);
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
        getChatUnreadCount,
        getVisibleChatList,
        getEntityUnreadCount,
        getTotalChatUnreadCount,
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
        refreshSelectedChatUnreadState,
        createModernChatFile,
        moveChatReadState,
        deleteChatReadState,
        toggleChatSidebar,
        closeChatSidebarForMobileSelection,
        closeChatSidebarOverlay,
    };
}
