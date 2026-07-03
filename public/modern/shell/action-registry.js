import {
    apiModelSuggestions,
    chatCompletionModelFields,
    secretKeyByChatSource,
    worldEntryDefaults,
} from '../core/constants.js';
import { backgroundPageSize } from '../core/state.js';
import {
    arrayToEntryInput,
    downloadFile,
    entryInputToArray,
    formatBytes,
    formatDate,
    formatNumber,
    normalizeText,
    numberInput,
    parsePreset,
    setObjectPath,
    uniqueValues,
} from '../core/utils.js';
import { createActivityActions } from '../actions/activity.js';
import { createApiConnectionActions } from '../actions/api-connection.js';
import { createAssetActions } from '../actions/assets.js';
import { createChatContextActions } from '../actions/chat-context.js';
import { createChatFileActions } from '../actions/chat-files.js';
import { createChatGenerationActions } from '../actions/chat-generation.js';
import { createChatMessageActions } from '../actions/chat-messages.js';
import { createCharacterActions } from '../actions/characters.js';
import { createExtensionActions } from '../actions/extensions.js';
import { createGroupActions } from '../actions/groups.js';
import { createPersonaActions } from '../actions/personas.js';
import { createPresetActions } from '../actions/presets.js';
import { createSettingsActions } from '../actions/settings.js';
import { createWorldbookActions } from '../actions/worldbooks.js';

export function createActionRegistry({
    state,
    elements,
    apiFetch,
    apiFetchResponse,
    loadData,
    render,
    showToast,
    setTheme,
    matchesQuery,
    callLegacyBridge,
}) {
    const apiConnectionActions = createApiConnectionActions({
        state,
        elements,
        apiFetch,
        loadData,
        render,
        showToast,
        apiModelSuggestions,
        chatCompletionModelFields,
        secretKeyByChatSource,
        numberInput,
        uniqueValues,
    });
    const {
        getOaiSettings,
        getChatCompletionModel,
    } = apiConnectionActions;

    const presetActions = createPresetActions({
        state,
        apiFetch,
        loadData,
        render,
        showToast,
        getOaiSettings,
        chatCompletionModelFields,
        parsePreset,
        downloadFile,
        matchesQuery,
    });
    const {
        getPresetGroups,
        getPresetCount,
        getPresetItems,
        selectPreset,
    } = presetActions;

    const assetActions = createAssetActions({
        state,
        apiFetch,
        loadData,
        render,
        showToast,
        backgroundPageSize,
        formatNumber,
    });
    const {
        getAssetGroups,
        getAssetCount,
        getAssetEntries,
        getBackgroundFilename,
    } = assetActions;

    const extensionActions = createExtensionActions({
        state,
        apiFetch,
        loadData,
        render,
        showToast,
    });
    const { getExtensionFolderName } = extensionActions;

    const activityActions = createActivityActions({
        state,
        apiFetch,
        loadData,
        render,
        showToast,
    });

    const worldbookActions = createWorldbookActions({
        state,
        apiFetch,
        loadData,
        render,
        showToast,
        downloadFile,
        arrayToEntryInput,
        entryInputToArray,
        formatNumber,
        normalizeText,
        numberInput,
        setObjectPath,
        worldEntryDefaults,
    });
    const {
        loadWorldDetail,
        beginWorldbookCreate,
    } = worldbookActions;

    const characterActions = createCharacterActions({
        state,
        apiFetch,
        apiFetchResponse,
        loadData,
        render,
        showToast,
    });
    const {
        getCharacterAvatarUrl,
        beginCharacterCreate,
    } = characterActions;

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
        toggleChatSidebar,
        closeChatSidebarForMobileSelection,
        closeChatSidebarOverlay,
    } = chatContextActions;

    const settingsActions = createSettingsActions({
        state,
        elements,
        apiFetch,
        loadData,
        render,
        showToast,
        setTheme,
        getChatModeLabel,
        numberInput,
        formatBytes,
    });

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

    const personaActions = createPersonaActions({
        state,
        apiFetch,
        loadData,
        render,
        showToast,
    });
    const { getPersonas } = personaActions;

    return {
        activityActions,
        apiConnectionActions,
        assetActions,
        chatContextActions,
        chatFileActions,
        chatGenerationActions,
        chatMessageActions,
        characterActions,
        extensionActions,
        groupActions,
        personaActions,
        presetActions,
        settingsActions,
        worldbookActions,
        beginCharacterCreate,
        beginGroupCreate,
        beginWorldbookCreate,
        clearChatSearch,
        closeChatBackups,
        closeChatSidebarForMobileSelection,
        closeChatSidebarOverlay,
        createModernChatFile,
        ensureAvailableChatMode,
        getAssetCount,
        getAssetEntries,
        getAssetGroups,
        getBackgroundFilename,
        getCharacterAvatarUrl,
        getChatCompletionModel,
        getChatContextKey,
        getChatEntityAvatarUrl,
        getChatEntityName,
        getChatId,
        getChatMessageCount,
        getChatModeLabel,
        getPersonas,
        getPresetCount,
        getPresetGroups,
        getPresetItems,
        getSelectedChatEntity,
        getSelectedChatList,
        getExtensionFolderName,
        isGroupChatMode,
        loadChatMessages,
        loadWorldDetail,
        prepareChatForSelectedContext,
        refreshSelectedChatList,
        saveGroupMetadata,
        selectPreset,
        sortChats,
        toggleChatSidebar,
    };
}
