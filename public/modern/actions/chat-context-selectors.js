import { stripJsonlExtension } from '../core/utils.js';

export function createChatContextSelectorHelpers({
    state,
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

    function getChatCacheKey(avatar, chatId) {
        return `${avatar || ''}::${chatId || ''}`;
    }

    function getChatReadCursor(contextKey, chatId) {
        return state.chatReadState?.cursors?.[getChatCacheKey(contextKey, chatId)] || null;
    }

    function isChatReadContextInitialized(contextKey) {
        return !!state.chatReadState?.contexts?.[contextKey];
    }

    function getChatUnreadCount(chat, entity = getSelectedChatEntity()) {
        const contextKey = getChatContextKey(entity);
        const chatId = getChatId(chat);
        if (!contextKey || !chatId) {
            return 0;
        }

        const messageCount = getChatMessageCount(chat);
        const cursor = getChatReadCursor(contextKey, chatId);
        if (!cursor) {
            return isChatReadContextInitialized(contextKey) ? messageCount : 0;
        }

        const cursorCount = Number(cursor.messageCount);
        const readCount = Number.isFinite(cursorCount) ? cursorCount : 0;
        return Math.max(0, messageCount - readCount);
    }

    function getEntityUnreadCount(entity = getSelectedChatEntity()) {
        const contextKey = getChatContextKey(entity);
        const chats = state.chatLists[contextKey] || [];
        return chats.reduce((total, chat) => total + getChatUnreadCount(chat, entity), 0);
    }

    function getSelectedChatMessages() {
        const cacheKey = getChatCacheKey(getChatContextKey(), state.selected.chat);
        return state.chatMessages[cacheKey] || [];
    }

    function getCurrentMessageLimit() {
        return state.chatMessageLimits[getCurrentDraftKey()] || 80;
    }

    function sortChats(chats) {
        return [...chats].sort((a, b) => {
            const bTime = new Date(b.last_mes || 0).getTime() || Number(b.last_mes || 0);
            const aTime = new Date(a.last_mes || 0).getTime() || Number(a.last_mes || 0);
            return bTime - aTime;
        });
    }

    function getCurrentDraftKey() {
        return getChatCacheKey(getChatContextKey(), state.selected.chat);
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

    return {
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
    };
}
