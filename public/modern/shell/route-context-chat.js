export function createChatContextRouteContext(chatContext) {
    const {
        isGroupChatMode,
        getChatModeLabel,
        getSelectedChatEntity,
        getChatContextKey,
        getChatEntityName,
        getChatEntityAvatarUrl,
        getGroupAvatarUrl,
        getChatEntityFallbackIcon,
        getChatEntityEmptyTitle,
        getChatEntityEmptyDescription,
        getChatEntityListEmptyText,
        getSelectedChatList,
        getChatId,
        getChatMessageCount,
        getChatUnreadCount,
        getEntityUnreadCount,
        getVisibleChatList,
        getSelectedChatMessages,
        getCurrentMessageLimit,
        getChatCacheKey,
        clearChatSearch,
        clearChatTransientState,
        searchSelectedChats,
        loadChatMessages,
        prepareChatForSelectedContext,
        getCurrentDraftKey,
        getCurrentDraft,
        setCurrentDraft,
        increaseCurrentMessageLimit,
        closeChatSidebarForMobileSelection,
    } = chatContext;

    return {
        isGroupChatMode,
        getChatModeLabel,
        getSelectedChatEntity,
        getChatContextKey,
        getChatEntityName,
        getChatEntityAvatarUrl,
        getGroupAvatarUrl,
        getChatEntityFallbackIcon,
        getChatEntityEmptyTitle,
        getChatEntityEmptyDescription,
        getChatEntityListEmptyText,
        getSelectedChatList,
        getChatId,
        getChatMessageCount,
        getChatUnreadCount,
        getEntityUnreadCount,
        getVisibleChatList,
        getSelectedChatMessages,
        getCurrentMessageLimit,
        getChatCacheKey,
        clearChatSearch,
        clearChatTransientState,
        searchSelectedChats,
        loadChatMessages,
        prepareChatForSelectedContext,
        getCurrentDraftKey,
        getCurrentDraft,
        setCurrentDraft,
        increaseCurrentMessageLimit,
        closeChatSidebarForMobileSelection,
    };
}

export function createChatFileRouteContext(chatFiles) {
    const {
        startNewModernChat,
        beginModernChatRename,
        cancelModernChatRename,
        saveModernChatRename,
        beginModernChatDelete,
        cancelModernChatDelete,
        confirmModernChatDelete,
        importModernChatFiles,
        exportModernChat,
        loadChatBackups,
        toggleChatBackups,
        viewChatBackup,
        restoreChatBackup,
        beginChatBackupDelete,
        cancelChatBackupDelete,
        confirmChatBackupDelete,
    } = chatFiles;

    return {
        startNewModernChat,
        beginModernChatRename,
        cancelModernChatRename,
        saveModernChatRename,
        beginModernChatDelete,
        cancelModernChatDelete,
        confirmModernChatDelete,
        importModernChatFiles,
        exportModernChat,
        loadChatBackups,
        toggleChatBackups,
        viewChatBackup,
        restoreChatBackup,
        beginChatBackupDelete,
        cancelChatBackupDelete,
        confirmChatBackupDelete,
    };
}

export function createChatGenerationRouteContext(chatGeneration) {
    const {
        checkLegacyGenerationEngine,
        sendModernMessage,
        stopModernGeneration,
        regenerateModernReply,
        continueModernReply,
        triggerGroupMemberModernReply,
        swipeModernMessage,
    } = chatGeneration;

    return {
        checkLegacyGenerationEngine,
        sendModernMessage,
        stopModernGeneration,
        regenerateModernReply,
        continueModernReply,
        triggerGroupMemberModernReply,
        swipeModernMessage,
    };
}

export function createChatMessageRouteContext(chatMessages) {
    const {
        copyModernMessage,
        deleteModernMessage,
        beginModernMessageDelete,
        cancelModernMessageDelete,
        confirmModernMessageDelete,
        beginModernMessageEdit,
        cancelModernMessageEdit,
        saveModernMessageEdit,
    } = chatMessages;

    return {
        copyModernMessage,
        deleteModernMessage,
        beginModernMessageDelete,
        cancelModernMessageDelete,
        confirmModernMessageDelete,
        beginModernMessageEdit,
        cancelModernMessageEdit,
        saveModernMessageEdit,
    };
}

/**
 * 聊天工具、设置页工具和输入框连接标签等界面插槽的业务动作，原样并入路由上下文。
 * featureSlots 来自 shell/feature-slot-actions.js，形如 { authorsNote: { saveAuthorsNote, ... }, summary: { ... } }；
 * 各功能把自己的动作放在自己的键下，这里不逐个列名字。不同功能的动作名不能重复（重名直接抛错），
 * 也不能与 route-context.js 里已有的名字重复（createRouteContext 里检查）。
 * @param {Record<string, Record<string, any>>} [featureSlots] 按功能分组的动作。
 * @returns {Record<string, any>} 合并后的动作表。
 */
export function createFeatureSlotRouteContext(featureSlots = {}) {
    const merged = {};
    for (const [group, actions] of Object.entries(featureSlots || {})) {
        for (const [name, action] of Object.entries(actions || {})) {
            if (Object.hasOwn(merged, name)) {
                throw new Error(`Feature slot action "${name}" from "${group}" is already provided by another feature group.`);
            }
            merged[name] = action;
        }
    }

    return merged;
}
