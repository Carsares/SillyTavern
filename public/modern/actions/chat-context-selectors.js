import { isValidGroupAvatarUrl, stripJsonlExtension } from '../core/utils.js';
import { MODERN_MESSAGE_SOURCE, listCharacterGreetings, resolveCharacterName, resolveUserName } from './chat-greetings.js';

// extra.api of messages the Modern UI writes itself (new-chat greetings): a source marker, not an API name.
export { MODERN_MESSAGE_SOURCE };

export function createChatContextSelectorHelpers({
    state,
    getCharacterAvatarUrl,
    // 群聊开场白从候选里随机挑一条（旧版 getFirstCharacterMessage 用 Math.random）；测试里注入固定值
    random = Math.random,
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

    function getChatContextKey(entity = getSelectedChatEntity(), groupMode = isGroupChatMode()) {
        if (groupMode) {
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

    function getGroupAvatarUrl(group) {
        const avatarUrl = group?.avatar_url || '';
        return isValidGroupAvatarUrl(avatarUrl) ? avatarUrl : '';
    }

    function getChatEntityAvatarUrl(entity = getSelectedChatEntity()) {
        return isGroupChatMode() ? getGroupAvatarUrl(entity) : getCharacterAvatarUrl(entity);
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

    function getChatSortTime(chat) {
        return new Date(chat?.last_mes || 0).getTime() || Number(chat?.last_mes || 0) || 0;
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

    function getChatUnreadCountForContext(contextKey, chat) {
        const chatId = getChatId(chat);
        if (!contextKey || !chatId) {
            return 0;
        }

        const messageCount = getChatMessageCount(chat);
        const cursor = getChatReadCursor(contextKey, chatId);
        if (!cursor) {
            // A chat never opened here counts as unread only once it holds more than its opening greeting: a
            // greeting-only file (e.g. auto-created by the legacy engine) has nothing new to read
            return isChatReadContextInitialized(contextKey) && messageCount > 1 ? messageCount : 0;
        }

        const cursorCount = Number(cursor.messageCount);
        const readCount = Number.isFinite(cursorCount) ? cursorCount : 0;
        return Math.max(0, messageCount - readCount);
    }

    function getChatUnreadCount(chat, entity = getSelectedChatEntity()) {
        return getChatUnreadCountForContext(getChatContextKey(entity), chat);
    }

    function getLatestUnreadChat(contextKey, chats = state.chatLists[contextKey] || []) {
        if (!contextKey || !Array.isArray(chats)) {
            return null;
        }

        return sortChats(chats).find(chat => getChatUnreadCountForContext(contextKey, chat) > 0) || null;
    }

    function getLatestUnreadChatTarget() {
        let latestTarget = null;
        let latestTime = Number.NEGATIVE_INFINITY;
        for (const [contextKey, chats] of Object.entries(state.chatLists)) {
            const groupMode = contextKey.startsWith('group:');
            const entity = groupMode
                ? state.groups.find(group => `group:${group.id}` === contextKey)
                : state.characters.find(character => character.avatar === contextKey);
            const chat = entity ? getLatestUnreadChat(contextKey, chats) : null;
            if (!chat) {
                continue;
            }

            const chatTime = getChatSortTime(chat);
            if (!latestTarget || chatTime > latestTime) {
                latestTarget = { entity, groupMode, chatId: getChatId(chat) };
                latestTime = chatTime;
            }
        }

        return latestTarget;
    }

    function getEntityUnreadCount(entity = getSelectedChatEntity()) {
        const contextKey = getChatContextKey(entity);
        const chats = state.chatLists[contextKey] || [];
        return chats.reduce((total, chat) => total + getChatUnreadCountForContext(contextKey, chat), 0);
    }

    function getTotalChatUnreadCount() {
        return Object.entries(state.chatLists).reduce((total, [contextKey, chats]) => {
            const entity = contextKey.startsWith('group:')
                ? state.groups.find(group => `group:${group.id}` === contextKey)
                : state.characters.find(character => character.avatar === contextKey);
            if (!entity || !Array.isArray(chats)) {
                return total;
            }

            return total + chats.reduce((chatTotal, chat) => chatTotal + getChatUnreadCountForContext(contextKey, chat), 0);
        }, 0);
    }

    function getSelectedChatMessages() {
        const cacheKey = getChatCacheKey(getChatContextKey(), state.selected.chat);
        return state.chatMessages[cacheKey] || [];
    }

    function getCurrentMessageLimit() {
        return state.chatMessageLimits[getCurrentDraftKey()] || 80;
    }

    function sortChats(chats) {
        return [...chats].sort((a, b) => getChatSortTime(b) - getChatSortTime(a));
    }

    function getCurrentDraftKey() {
        return getChatCacheKey(getChatContextKey(), state.selected.chat);
    }

    function getCharacterName(character) {
        return resolveCharacterName(character);
    }

    function getUserName() {
        return resolveUserName(state);
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
            extra: { api: MODERN_MESSAGE_SOURCE, model },
        };
    }

    /**
     * 角色卡的全部开场白（first_mes 在前，备用开场白在后，宏已替换）。first_mes 为空时第一条备用开场白就是开场白。
     * 摘要卡（懒加载列表里的 shallow 卡）没有这些字段，调用前要先取完整卡。
     * @param {object} character 角色卡
     * @returns {string[]} 开场白文本
     */
    function getCharacterGreetings(character) {
        return listCharacterGreetings(character, getUserName());
    }

    function getCharacterGreeting(character) {
        return getCharacterGreetings(character)[0] || '';
    }

    /**
     * 单人聊天新建时的第一条消息：有多条开场白时带 swipes / swipe_id / swipe_info，每个候选的 swipe_info.extra
     * 都保留 Modern 来源标记；只有一条时是普通消息，没有开场白返回 null。
     * @param {object} character 完整角色卡
     * @returns {object | null} 消息对象
     */
    function createGreetingMessage(character) {
        const greetings = getCharacterGreetings(character);
        if (!greetings.length) {
            return null;
        }

        const message = createAssistantMessage(greetings[0], character);
        if (greetings.length > 1) {
            message.swipe_id = 0;
            message.swipes = [...greetings];
            message.swipe_info = greetings.map(() => ({
                send_date: message.send_date,
                extra: structuredClone(message.extra),
            }));
        }
        return message;
    }

    /**
     * 新建群聊时某个成员的开场白（旧版 getFirstCharacterMessage）：在 first_mes 和备用开场白里随机挑一条，
     * 不带候选；消息记下成员头像文件名（original_avatar）和缩略图地址（force_avatar），与引擎写出的群聊消息一致。
     * @param {object} character 成员的完整角色卡
     * @returns {object | null} 消息对象，成员没有开场白时为 null
     */
    function createGroupMemberGreetingMessage(character) {
        const greetings = getCharacterGreetings(character);
        if (!greetings.length) {
            return null;
        }

        const index = Math.min(greetings.length - 1, Math.floor(random() * greetings.length));
        const message = createAssistantMessage(greetings[index], character);
        if (character?.avatar) {
            message.original_avatar = character.avatar;
            message.force_avatar = `/thumbnail?type=avatar&file=${encodeURIComponent(character.avatar)}`;
        }
        return message;
    }

    function getSelectedChatMetadata(entity, chatId, groupMode = isGroupChatMode()) {
        return state.chatMetadata[getChatCacheKey(getChatContextKey(entity, groupMode), chatId)] || {};
    }

    return {
        createAssistantMessage,
        createGreetingMessage,
        createGroupMemberGreetingMessage,
        createModernChatId,
        getCharacterGreeting,
        getCharacterGreetings,
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
        getLatestUnreadChat,
        getLatestUnreadChatTarget,
        getGroupAvatarUrl,
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
    };
}
