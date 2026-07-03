import { formatDate, formatNumber } from '../core/utils.js';
import { createChatContextActions } from '../actions/chat-context.js';
import { createChatFileActions } from '../actions/chat-files.js';
import { createChatGenerationActions } from '../actions/chat-generation.js';
import { createChatMessageActions } from '../actions/chat-messages.js';
import { createGroupActions } from '../actions/groups.js';

export function createChatActionRegistry({
    state,
    apiFetch,
    apiFetchResponse,
    loadData,
    render,
    showToast,
    callLegacyBridge,
    getCharacterAvatarUrl,
}) {
    const chatContextActions = createChatContextActions({
        state,
        apiFetch,
        render,
        showToast,
        getCharacterAvatarUrl,
    });
    const {
        isGroupChatMode,
        ensureAvailableChatMode,
        getChatModeLabel,
        getSelectedChatEntity,
        getChatContextKey,
        getChatEntityName,
        getChatEntityAvatarUrl,
        getSelectedChatList,
        getChatId,
        getChatMessageCount,
        getChatUnreadCount,
        getEntityUnreadCount,
        getSelectedChatMessages,
        getChatCacheKey,
        clearChatSearch,
        loadChatMessages,
        prepareChatForSelectedContext,
        getCurrentDraftKey,
        getUserName,
        sortChats,
        saveGroupMetadata,
        saveModernChat,
        refreshSelectedChatList,
        createModernChatFile,
        moveChatReadState,
        deleteChatReadState,
        toggleChatSidebar,
        closeChatSidebarForMobileSelection,
        closeChatSidebarOverlay,
    } = chatContextActions;

    const chatFileActions = createChatFileActions({
        state,
        apiFetch,
        apiFetchResponse,
        render,
        showToast,
        formatDate,
        formatNumber,
        getSelectedChatEntity,
        getChatContextKey,
        getChatEntityName,
        isGroupChatMode,
        getSelectedChatList,
        getChatId,
        getChatCacheKey,
        getUserName,
        sortChats,
        clearChatSearch,
        loadChatMessages,
        refreshSelectedChatList,
        createModernChatFile,
        saveGroupMetadata,
        moveChatReadState,
        deleteChatReadState,
    });
    const { closeChatBackups } = chatFileActions;

    const chatMessageActions = createChatMessageActions({
        state,
        render,
        showToast,
        getSelectedChatEntity,
        getChatContextKey,
        getSelectedChatMessages,
        getCurrentDraftKey,
        getChatCacheKey,
        saveModernChat,
        refreshSelectedChatList,
    });

    const chatGenerationActions = createChatGenerationActions({
        state,
        render,
        showToast,
        callLegacyBridge,
        formatNumber,
        getSelectedChatEntity,
        getChatContextKey,
        getChatEntityName,
        isGroupChatMode,
        getSelectedChatMessages,
        getCurrentDraftKey,
        getChatCacheKey,
        getUserName,
        loadChatMessages,
        refreshSelectedChatList,
        createModernChatFile,
    });

    const groupActions = createGroupActions({
        state,
        apiFetch,
        loadData,
        render,
        showToast,
        ensureAvailableChatMode,
    });
    const { beginGroupCreate } = groupActions;

    return {
        chatContextActions,
        chatFileActions,
        chatGenerationActions,
        chatMessageActions,
        groupActions,
        beginGroupCreate,
        clearChatSearch,
        closeChatBackups,
        closeChatSidebarForMobileSelection,
        closeChatSidebarOverlay,
        createModernChatFile,
        ensureAvailableChatMode,
        getChatContextKey,
        getChatEntityAvatarUrl,
        getChatEntityName,
        getChatId,
        getChatMessageCount,
        getChatUnreadCount,
        getEntityUnreadCount,
        getChatModeLabel,
        getSelectedChatEntity,
        getSelectedChatList,
        isGroupChatMode,
        loadChatMessages,
        prepareChatForSelectedContext,
        refreshSelectedChatList,
        saveGroupMetadata,
        sortChats,
        toggleChatSidebar,
    };
}
