import {
    apiModelSuggestions,
    chatCompletionModelFields,
    chatCompletionSourceOptions,
    secretKeyByChatSource,
    worldEntryDefaults,
    worldEntryPageSize,
    worldEntryPositions,
    worldEntryRoleOptions,
    worldEntrySelectiveLogicOptions,
} from './core/constants.js';
import { createApiClient } from './core/api-client.js';
import { createLegacyBridge } from './core/legacy-bridge.js';
import { backgroundPageSize, createModernState } from './core/state.js';
import { createCommonComponents } from './components/common.js';
import { createActivityActions } from './actions/activity.js';
import { createApiConnectionActions } from './actions/api-connection.js';
import { createAssetActions } from './actions/assets.js';
import { createChatContextActions } from './actions/chat-context.js';
import { createChatFileActions } from './actions/chat-files.js';
import { createChatGenerationActions } from './actions/chat-generation.js';
import { createChatMessageActions } from './actions/chat-messages.js';
import { createCharacterActions } from './actions/characters.js';
import { createExtensionActions } from './actions/extensions.js';
import { createGroupActions } from './actions/groups.js';
import { createPersonaActions } from './actions/personas.js';
import { createPresetActions } from './actions/presets.js';
import { createSettingsActions } from './actions/settings.js';
import { createWorldbookActions } from './actions/worldbooks.js';
import { createDataLoader } from './shell/data-loader.js';
import { createShellElements } from './shell/elements.js';
import { bindShellEvents } from './shell/events.js';
import { createInspector } from './shell/inspector.js';
import { createQueryMatcher, createShellMetadata } from './shell/metadata.js';
import { createNav } from './shell/nav.js';
import { createPalette } from './shell/palette.js';
import { createRenderer } from './shell/renderer.js';
import { createRouter } from './shell/router.js';
import { createRouteContext } from './shell/route-context.js';
import { createRouteModules } from './shell/routes.js';
import { createTheme } from './shell/theme.js';
import { createToast } from './shell/toast.js';
import { createTopbar } from './shell/topbar.js';
import {
    arrayToEntryInput,
    downloadFile,
    entryInputToArray,
    escapeHtml,
    formatBytes,
    formatDate,
    formatDurationMs,
    formatNumber,
    getPersonaUrl,
    maskEndpoint,
    normalizeText,
    numberInput,
    parsePreset,
    setObjectPath,
    uniqueValues,
} from './core/utils.js';

const state = createModernState();

const apiClient = createApiClient({
    onTokenChange: token => {
        state.csrfToken = token;
    },
});
const apiFetch = apiClient.apiFetch;
const apiFetchResponse = apiClient.apiFetchResponse;
const { callLegacyBridge } = createLegacyBridge();

const elements = createShellElements();

document.documentElement.dataset.theme = state.theme;

let dataLoader;
let shellRenderer;

const { matchesQuery } = createQueryMatcher({
    state,
    formatText: normalizeText,
});
const { showToast } = createToast({
    elements,
    escapeHtml,
});
const { setTheme } = createTheme({
    state,
    root: document.documentElement,
});

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

const { getAssetCount } = assetActions;

const extensionActions = createExtensionActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
});

const settingsActions = createSettingsActions({
    state,
    elements,
    apiFetch,
    loadData,
    render,
    showToast,
    setTheme,
    getChatModeLabel: () => getChatModeLabel(),
    numberInput,
    formatBytes,
});

const activityActions = createActivityActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
});

const {
    loadWorldDetail,
    isGlobalWorldEnabled,
    toggleGlobalWorld,
    toggleWorldEntry,
    getWorldEntryListState,
    updateWorldEntryListField,
    setWorldEntryPage,
    toggleWorldEntrySelection,
    getVisibleWorldEntries,
    setSelectedWorldEntriesDisabled,
    beginWorldEntryBulkDelete,
    cancelWorldEntryBulkDelete,
    confirmWorldEntryBulkDelete,
    getWorldEntryTitle,
    createWorldEntry,
    worldEntryToForm,
    beginWorldbookCreate,
    cancelWorldbookCreate,
    saveWorldbookCreate,
    importWorldbookFile,
    exportWorldbook,
    beginWorldbookDelete,
    cancelWorldbookDelete,
    confirmWorldbookDelete,
    beginWorldEntryCreate,
    beginWorldEntryEdit,
    cancelWorldEntryEdit,
    saveWorldEntryEdit,
    duplicateWorldEntry,
    beginWorldEntryDelete,
    cancelWorldEntryDelete,
    updateWorldEntryFormField,
    confirmWorldEntryDelete,
} = createWorldbookActions({
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
    getCharacterAvatarUrl,
    getCharacterByAvatar,
    getCharacterTags,
    characterToForm,
    beginCharacterCreate,
    cancelCharacterCreate,
    saveCharacterCreate,
    loadCharacterDetail,
    beginCharacterEdit,
    cancelCharacterEdit,
    saveCharacterEdit,
    duplicateCharacter,
    beginCharacterRename,
    cancelCharacterRename,
    confirmCharacterRename,
    exportCharacter,
    beginCharacterDelete,
    cancelCharacterDelete,
    confirmCharacterDelete,
    updateCharacterFormField,
    replaceCharacterAvatar,
    importCharacterFile,
} = createCharacterActions({
    state,
    apiFetch,
    apiFetchResponse,
    loadData,
    render,
    showToast,
});

const {
    isGroupChatMode,
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
    clearChatSearch,
    searchSelectedChats,
    loadChatMessages,
    prepareChatForSelectedContext,
    getCurrentDraftKey,
    getCurrentDraft,
    setCurrentDraft,
    getUserName,
    sortChats,
    saveGroupMetadata,
    saveModernChat,
    refreshSelectedChatList,
    createModernChatFile,
    toggleChatSidebar,
    closeChatSidebarForMobileSelection,
    closeChatSidebarOverlay,
} = createChatContextActions({
    state,
    apiFetch,
    render,
    showToast,
    getCharacterAvatarUrl,
});

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
    closeChatBackups,
    viewChatBackup,
    restoreChatBackup,
    beginChatBackupDelete,
    cancelChatBackupDelete,
    confirmChatBackupDelete,
} = createChatFileActions({
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

const {
    copyModernMessage,
    deleteModernMessage,
    beginModernMessageDelete,
    cancelModernMessageDelete,
    confirmModernMessageDelete,
    beginModernMessageEdit,
    cancelModernMessageEdit,
    saveModernMessageEdit,
} = createChatMessageActions({
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

const {
    checkLegacyGenerationEngine,
    sendModernMessage,
    stopModernGeneration,
    regenerateModernReply,
    continueModernReply,
    swipeModernMessage,
} = createChatGenerationActions({
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

const commonComponents = createCommonComponents({
    state,
    getCharacterAvatarUrl,
    getChatEntityAvatarUrl,
});

const {
    renderInlineEmpty,
    renderKeyValue,
    renderLoading,
} = commonComponents;

const { getProviderInfo, getRouteCount } = createShellMetadata({
    state,
    getChatCompletionModel,
    getPresetCount,
    getPersonas,
    getAssetCount,
});
const { renderNav } = createNav({ state, elements, getRouteCount });
const { renderStatus } = createTopbar({ state, elements, getProviderInfo });
const { renderInspector, toggleInspector } = createInspector({
    state,
    elements,
    getPersonas,
    getPresetGroups,
    getChatEntityName,
    getChatModeLabel,
    getProviderInfo,
    getSelectedChatEntity,
    getSelectedChatList,
    isGroupChatMode,
    renderKeyValue,
});
const { closePalette, openPalette, renderPalette } = createPalette({
    state,
    elements,
    getChatId,
    getChatMessageCount,
    getChatModeLabel,
    getPersonas,
    getPresetGroups,
    getPresetItems,
    getSelectedChatList,
    renderInlineEmpty,
});

const routeContext = createRouteContext({
    state,
    utils: {
        escapeHtml,
        formatBytes,
        formatDate,
        formatDurationMs,
        formatNumber,
        getPersonaUrl,
        maskEndpoint,
        parsePreset,
        uniqueValues,
    },
    components: commonComponents,
    shell: {
        getProviderInfo,
        matchesQuery,
        render,
        showToast,
    },
    activity: activityActions,
    constants: {
        chatCompletionSourceOptions,
        secretKeyByChatSource,
        worldEntryPageSize,
        worldEntryPositions,
        worldEntryRoleOptions,
        worldEntrySelectiveLogicOptions,
    },
    api: apiConnectionActions,
    assets: assetActions,
    characters: {
        getCharacterAvatarUrl,
        getCharacterTags,
        characterToForm,
        beginCharacterCreate,
        cancelCharacterCreate,
        saveCharacterCreate,
        loadCharacterDetail,
        beginCharacterEdit,
        cancelCharacterEdit,
        saveCharacterEdit,
        duplicateCharacter,
        getCharacterByAvatar,
        beginCharacterRename,
        cancelCharacterRename,
        confirmCharacterRename,
        exportCharacter,
        beginCharacterDelete,
        cancelCharacterDelete,
        confirmCharacterDelete,
        updateCharacterFormField,
        replaceCharacterAvatar,
        importCharacterFile,
    },
    chatContext: {
        isGroupChatMode,
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
        getChatCacheKey,
        getCurrentDraftKey,
        getCurrentDraft,
        setCurrentDraft,
        increaseCurrentMessageLimit,
        searchSelectedChats,
        loadChatMessages,
        closeChatSidebarForMobileSelection,
    },
    chatFiles: {
        toggleChatBackups,
        loadChatBackups,
        exportModernChat,
        viewChatBackup,
        restoreChatBackup,
        beginChatBackupDelete,
        cancelChatBackupDelete,
        confirmChatBackupDelete,
        startNewModernChat,
        beginModernChatRename,
        cancelModernChatRename,
        saveModernChatRename,
        beginModernChatDelete,
        cancelModernChatDelete,
        confirmModernChatDelete,
        importModernChatFiles,
    },
    chatGeneration: {
        sendModernMessage,
        stopModernGeneration,
        checkLegacyGenerationEngine,
        regenerateModernReply,
        continueModernReply,
        swipeModernMessage,
    },
    chatMessages: {
        copyModernMessage,
        deleteModernMessage,
        beginModernMessageDelete,
        cancelModernMessageDelete,
        confirmModernMessageDelete,
        beginModernMessageEdit,
        cancelModernMessageEdit,
        saveModernMessageEdit,
    },
    extensions: extensionActions,
    groups: groupActions,
    personas: personaActions,
    presets: presetActions,
    settings: settingsActions,
    worldbooks: {
        isGlobalWorldEnabled,
        getWorldEntryListState,
        getVisibleWorldEntries,
        getWorldEntryTitle,
        createWorldEntry,
        worldEntryToForm,
        loadWorldDetail,
        beginWorldbookCreate,
        cancelWorldbookCreate,
        saveWorldbookCreate,
        exportWorldbook,
        toggleGlobalWorld,
        beginWorldbookDelete,
        cancelWorldbookDelete,
        confirmWorldbookDelete,
        beginWorldEntryCreate,
        toggleWorldEntry,
        setWorldEntryPage,
        setSelectedWorldEntriesDisabled,
        beginWorldEntryBulkDelete,
        cancelWorldEntryBulkDelete,
        confirmWorldEntryBulkDelete,
        duplicateWorldEntry,
        beginWorldEntryDelete,
        cancelWorldEntryDelete,
        confirmWorldEntryDelete,
        beginWorldEntryEdit,
        cancelWorldEntryEdit,
        saveWorldEntryEdit,
        updateWorldEntryListField,
        updateWorldEntryFormField,
        importWorldbookFile,
        toggleWorldEntrySelection,
    },
});

const routeModules = createRouteModules(routeContext);
const routeRenderers = Object.fromEntries(Object.entries(routeModules).map(([route, module]) => [route, module.render]));
shellRenderer = createRenderer({
    state,
    elements,
    routeRenderers,
    renderLoading,
    renderNav,
    renderStatus,
    renderInspector,
});
dataLoader = createDataLoader({
    state,
    apiFetch,
    render,
    showToast,
    ensureAvailableChatMode,
    prepareChatForSelectedContext,
    loadWorldDetail,
});
const { handleClick } = createRouter({
    state,
    elements,
    routeModules,
    render,
    loadData,
    loadWorldDetail,
    prepareChatForSelectedContext,
    clearChatSearch,
    beginCharacterCreate,
    beginGroupCreate,
    beginWorldbookCreate,
    toggleInspector,
    toggleChatSidebar,
    closePalette,
    closeChatSidebarForMobileSelection,
});

async function loadData(options) {
    return dataLoader.loadData(options);
}

function render() {
    shellRenderer.render();
}

bindShellEvents({
    state,
    elements,
    routeModules,
    backgroundPageSize,
    normalizeText,
    loadData,
    setTheme,
    render,
    renderPalette,
    closePalette,
    openPalette,
    closeChatSidebarOverlay,
    closeChatBackups,
    handleClick,
});

render();
loadData({ notify: false });
