import { stripJsonlExtension } from '../core/utils.js';

export function createChatContextActions({
    state,
    apiFetch,
    render,
    showToast,
    getCharacterAvatarUrl,
}) {
    function getSelectedCharacter() {
        return state.characters.find(character => character.avatar === state.selected.character) || state.characters[0] || null;
    }

    function getSelectedGroup() {
        return state.groups.find(group => group.id === state.selected.group) || state.groups[0] || null;
    }

    function isGroupChatMode() {
        return state.chatMode === 'group';
    }

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

    function getChatModeLabel() {
        return isGroupChatMode() ? '群聊' : '角色';
    }

    function getSelectedChatEntity() {
        return isGroupChatMode() ? getSelectedGroup() : getSelectedCharacter();
    }

    function getChatContextKey(entity = getSelectedChatEntity()) {
        if (isGroupChatMode()) {
            return entity?.id ? `group:${entity.id}` : 'group:';
        }
        return entity?.avatar || '';
    }

    function getChatEntityName(entity = getSelectedChatEntity()) {
        if (isGroupChatMode()) {
            return entity?.name || '未命名群聊';
        }
        return entity?.name || entity?.data?.name || '未命名角色';
    }

    function getChatEntityAvatarUrl(entity = getSelectedChatEntity()) {
        if (isGroupChatMode()) {
            return entity?.avatar_url || '';
        }
        return getCharacterAvatarUrl(entity);
    }

    function getChatEntityFallbackIcon() {
        return isGroupChatMode() ? 'fa-users' : 'fa-user';
    }

    function getChatEntityEmptyTitle() {
        return isGroupChatMode() ? '没有可用群聊' : '没有可用角色';
    }

    function getChatEntityEmptyDescription() {
        return isGroupChatMode() ? '当前目录没有可用群聊。' : '当前目录没有可用角色卡。';
    }

    function getChatEntityListEmptyText() {
        return isGroupChatMode() ? '暂无匹配群聊' : '暂无匹配角色';
    }

    function getSelectedChatList() {
        return state.chatLists[getChatContextKey()] || [];
    }

    function getChatId(chat) {
        return stripJsonlExtension(chat?.file_id || chat?.file_name || '');
    }

    function getChatMessageCount(chat) {
        return Number(chat?.chat_items ?? chat?.message_count ?? 0);
    }

    function getVisibleChatList(entity = getSelectedChatEntity()) {
        const search = state.chatSearch;
        const contextKey = getChatContextKey(entity);
        if (search.contextKey === contextKey && search.searchedQuery) {
            return search.results;
        }

        return getSelectedChatList();
    }

    function getSelectedChatMessages() {
        const cacheKey = getChatCacheKey(getChatContextKey(), state.selected.chat);
        return state.chatMessages[cacheKey] || [];
    }

    function getCurrentMessageLimit() {
        return state.chatMessageLimits[getCurrentDraftKey()] || 80;
    }

    function increaseCurrentMessageLimit() {
        const key = getCurrentDraftKey();
        if (!key) {
            return;
        }
        state.chatMessageLimits[key] = Math.min(getSelectedChatMessages().length, getCurrentMessageLimit() + 80);
        render();
    }

    function getChatCacheKey(avatar, chatId) {
        return `${avatar || ''}::${chatId || ''}`;
    }

    function sortChats(chats) {
        return [...chats].sort((a, b) => {
            const bTime = new Date(b.last_mes || 0).getTime() || Number(b.last_mes || 0);
            const aTime = new Date(a.last_mes || 0).getTime() || Number(a.last_mes || 0);
            return bTime - aTime;
        });
    }

    async function loadCharacterChats(character) {
        if (!character?.avatar) {
            return [];
        }
        if (state.chatLists[character.avatar]) {
            return state.chatLists[character.avatar];
        }

        state.loadingChats[character.avatar] = true;
        try {
            const result = await apiFetch('/api/characters/chats', {
                body: {
                    avatar_url: character.avatar,
                    metadata: true,
                },
            });
            const chats = Array.isArray(result) ? sortChats(result.filter(chat => chat.file_name)) : [];
            state.chatLists[character.avatar] = chats;
            return chats;
        } catch (error) {
            state.errors.push({ key: 'chats', message: error.message });
            showToast('聊天列表读取失败', error.message);
            return [];
        } finally {
            state.loadingChats[character.avatar] = false;
        }
    }

    async function loadGroupChats(group) {
        if (!group?.id) {
            return [];
        }

        const contextKey = `group:${group.id}`;
        if (state.chatLists[contextKey]) {
            return state.chatLists[contextKey];
        }

        state.loadingChats[contextKey] = true;
        try {
            const result = await apiFetch('/api/chats/search', {
                body: {
                    query: '',
                    avatar_url: null,
                    group_id: group.id,
                },
            });
            const chats = Array.isArray(result) ? sortChats(result.filter(chat => chat.file_name)) : [];
            state.chatLists[contextKey] = chats;
            return chats;
        } catch (error) {
            state.errors.push({ key: 'group-chats', message: error.message });
            showToast('群聊列表读取失败', error.message);
            return [];
        } finally {
            state.loadingChats[contextKey] = false;
        }
    }

    function clearChatSearch() {
        const contextKey = getChatContextKey();
        state.chatSearch = {
            avatar: state.selected.character || '',
            contextKey,
            query: '',
            searchedQuery: '',
            loading: false,
            results: [],
        };
    }

    async function searchSelectedChats() {
        const entity = getSelectedChatEntity();
        const contextKey = getChatContextKey(entity);
        if (!entity || !contextKey) {
            throw new Error(isGroupChatMode() ? '请先选择一个群聊。' : '请先选择一个角色。');
        }

        const query = state.chatSearch.query.trim();
        if (!query) {
            clearChatSearch();
            return;
        }

        state.chatSearch = {
            ...state.chatSearch,
            avatar: isGroupChatMode() ? '' : entity.avatar,
            contextKey,
            loading: true,
        };
        render();

        try {
            const result = await apiFetch('/api/chats/search', {
                body: {
                    query,
                    avatar_url: isGroupChatMode() ? null : entity.avatar,
                    group_id: isGroupChatMode() ? entity.id : null,
                },
            });
            const results = Array.isArray(result) ? sortChats(result.filter(chat => chat.file_name)) : [];
            state.chatSearch = {
                avatar: isGroupChatMode() ? '' : entity.avatar,
                contextKey,
                query,
                searchedQuery: query,
                loading: false,
                results,
            };
        } catch (error) {
            state.chatSearch.loading = false;
            throw error;
        }
    }

    async function loadChatMessages(entity, chatId, { force = false } = {}) {
        const contextKey = getChatContextKey(entity);
        if (!contextKey || !chatId) {
            return [];
        }

        const cacheKey = getChatCacheKey(contextKey, chatId);
        if (!force && state.chatMessages[cacheKey]) {
            return state.chatMessages[cacheKey];
        }

        try {
            const result = isGroupChatMode()
                ? await apiFetch('/api/chats/group/get', { body: { id: chatId } })
                : await apiFetch('/api/chats/get', {
                    body: {
                        ch_name: entity.name || entity.data?.name || '',
                        file_name: chatId,
                        avatar_url: entity.avatar,
                    },
                });
            const header = Array.isArray(result) ? result.find(message => message && message.chat_metadata) : null;
            const messages = Array.isArray(result) ? result.filter(message => message && !message.chat_metadata) : [];
            state.chatMetadata[cacheKey] = header?.chat_metadata || {};
            state.chatMessages[cacheKey] = messages;
            return messages;
        } catch (error) {
            state.errors.push({ key: 'chat', message: error.message });
            showToast('聊天记录读取失败', error.message);
            return [];
        }
    }

    async function prepareChatForSelectedContext() {
        const entity = getSelectedChatEntity();
        const chats = isGroupChatMode() ? await loadGroupChats(entity) : await loadCharacterChats(entity);

        if (!state.selected.chat && chats[0]?.file_id) {
            state.selected.chat = chats[0].file_id;
        }

        await loadChatMessages(entity, state.selected.chat);
    }

    function getCurrentDraftKey() {
        return getChatCacheKey(getChatContextKey(), state.selected.chat);
    }

    function getCurrentDraft() {
        return state.chatDrafts[getCurrentDraftKey()] || '';
    }

    function setCurrentDraft(value) {
        state.chatDrafts[getCurrentDraftKey()] = value;
    }

    function getCharacterName(character) {
        return character?.name || character?.data?.name || '未命名角色';
    }

    function getUserName() {
        return state.settings.name1 || state.me?.name || state.me?.handle || 'You';
    }

    function formatTemplate(value, character) {
        const userName = getUserName();
        const characterName = getCharacterName(character);
        return String(value ?? '')
            .replaceAll('{{user}}', userName)
            .replaceAll('{{char}}', characterName)
            .trim();
    }

    function getMessageTimestamp() {
        return new Date().toISOString();
    }

    function createModernChatId() {
        return `Modern ${new Date().toISOString().replace(/[:.]/g, '-')}`;
    }

    function createAssistantMessage(text, character, model = '') {
        return {
            name: getCharacterName(character),
            is_user: false,
            is_system: false,
            send_date: getMessageTimestamp(),
            mes: text,
            extra: { api: 'modern', model },
        };
    }

    function getCharacterGreeting(character) {
        return formatTemplate(character?.data?.first_mes || character?.first_mes || '', character);
    }

    function getSelectedChatMetadata(entity, chatId) {
        return state.chatMetadata[getChatCacheKey(getChatContextKey(entity), chatId)] || {};
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

    async function refreshSelectedChatList(entity) {
        const contextKey = getChatContextKey(entity);
        delete state.chatLists[contextKey];
        if (isGroupChatMode()) {
            await loadGroupChats(entity);
        } else {
            await loadCharacterChats(entity);
        }
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
