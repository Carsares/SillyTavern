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
import { createInspector } from './shell/inspector.js';
import { createQueryMatcher, createShellMetadata } from './shell/metadata.js';
import { createNav } from './shell/nav.js';
import { createPalette } from './shell/palette.js';
import { createRouter } from './shell/router.js';
import { createToast } from './shell/toast.js';
import { createTopbar } from './shell/topbar.js';
import { createDashboardRoute } from './routes/dashboard.js';
import { createChatRoute } from './routes/chat.js';
import { createCharactersRoute } from './routes/characters.js';
import { createGroupsRoute } from './routes/groups.js';
import { createWorldbooksRoute } from './routes/worldbooks.js';
import { createPresetsRoute } from './routes/presets.js';
import { createPersonasRoute } from './routes/personas.js';
import { createAssetsRoute } from './routes/assets.js';
import { createApiRoute } from './routes/api.js';
import { createExtensionsRoute } from './routes/extensions.js';
import { createActivityRoute } from './routes/activity.js';
import { createSettingsRoute } from './routes/settings.js';
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

const elements = {
    app: document.getElementById('modernApp'),
    navList: document.getElementById('navList'),
    content: document.getElementById('content'),
    inspector: document.getElementById('inspector'),
    search: document.getElementById('globalSearch'),
    refreshButton: document.getElementById('refreshButton'),
    themeButton: document.getElementById('themeButton'),
    mobileMenuButton: document.getElementById('mobileMenuButton'),
    connectionStatus: document.getElementById('connectionStatus'),
    commandPalette: document.getElementById('commandPalette'),
    paletteSearch: document.getElementById('paletteSearch'),
    paletteResults: document.getElementById('paletteResults'),
    toastStack: document.getElementById('toastStack'),
};

document.documentElement.dataset.theme = state.theme;

const { matchesQuery } = createQueryMatcher({
    state,
    formatText: normalizeText,
});
const { showToast } = createToast({
    elements,
    escapeHtml,
});

const {
    getOaiSettings,
    getSelectedApiMain,
    getChatCompletionModel,
    getApiModelSuggestions,
    getApiSourceUiState,
    getNumberSetting,
    getSecretStateForSource,
    testApiConnection,
    setApiModelSuggestion,
    saveApiConnectionFromForm,
    updateApiSourceFields,
    updateTextCompletionTypeFields,
} = createApiConnectionActions({
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
    getPresetGroups,
    getPresetCount,
    getPresetItems,
    getVisiblePresetGroups,
    getSelectedPresetRecord,
    selectPreset,
    getPresetEditorText,
    updatePresetEditorText,
    saveOpenAiPresetFromForm,
    savePresetJsonFromEditor,
    useOpenAiPreset,
    duplicatePreset,
    exportPreset,
    restorePreset,
    beginPresetDelete,
    cancelPresetDelete,
    confirmPresetDelete,
    importPresetFile,
} = createPresetActions({
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
    getAssetGroups,
    getAssetCount,
    getAssetEntries,
    getBackgroundUrl,
    getBackgroundFilename,
    getBackgroundFolderData,
    getBackgroundFolderById,
    getBackgroundFolderIds,
    getBackgroundFoldersFor,
    getBackgroundFolderCounts,
    uploadBackgroundFile,
    setBackgroundFolderFilter,
    showMoreBackgrounds,
    toggleBackgroundFolderCreate,
    createBackgroundFolder,
    beginBackgroundFolderRename,
    cancelBackgroundFolderRename,
    confirmBackgroundFolderRename,
    beginBackgroundFolderDelete,
    cancelBackgroundFolderDelete,
    confirmBackgroundFolderDelete,
    assignSelectedBackgroundsToFolder,
    beginBackgroundRename,
    cancelBackgroundRename,
    confirmBackgroundRename,
    setBackgroundSelectionMode,
    toggleBackgroundSelection,
    beginBackgroundBatchDelete,
    cancelBackgroundDelete,
    confirmBackgroundDelete,
    toggleAssetDownload,
    toggleAssetGroup,
    downloadAssetFromForm,
    beginAssetDelete,
    cancelAssetDelete,
    confirmAssetDelete,
} = createAssetActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
    backgroundPageSize,
    formatNumber,
});

const {
    getExtensionFolderName,
    canManageExtension,
    toggleExtensionInstall,
    installExtensionFromForm,
    loadExtensionDetails,
    switchExtensionBranch,
    beginExtensionOperation,
    cancelExtensionOperation,
    confirmExtensionOperation,
} = createExtensionActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
});

const {
    getRequestCompressionSettings,
    loadSettingsSnapshots,
    createSettingsSnapshot,
    saveModernPreferencesFromForm,
    saveRequestCompressionFromForm,
    previewSettingsSnapshot,
    beginSettingsSnapshotRestore,
    cancelSettingsSnapshotRestore,
    confirmSettingsSnapshotRestore,
} = createSettingsActions({
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

const {
    getActivityEntries,
    getActivitySummary,
    recreateStats,
} = createActivityActions({
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

const {
    defaultGroupForm,
    groupToForm,
    beginGroupCreate,
    cancelGroupCreate,
    saveGroupCreate,
    beginGroupEdit,
    cancelGroupEdit,
    saveGroupEdit,
    beginGroupDelete,
    cancelGroupDelete,
    confirmGroupDelete,
    updateGroupFormField,
    toggleGroupFormMember,
} = createGroupActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
    ensureAvailableChatMode,
});

const {
    getPersonas,
    beginPersonaCreate,
    cancelPersonaCreate,
    savePersonaCreate,
    beginPersonaEdit,
    setDefaultPersona,
    beginPersonaDelete,
    cancelPersonaDelete,
    confirmPersonaDelete,
    cancelPersonaEdit,
    savePersonaEdit,
    updatePersonaFormField,
    replacePersonaAvatar,
} = createPersonaActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
});

const {
    metricCard,
    pageHead,
    renderCharacterRow,
    renderEmptyState,
    renderGroupRow,
    renderInlineEmpty,
    renderKeyValue,
    renderLoading,
} = createCommonComponents({
    state,
    getCharacterAvatarUrl,
    getChatEntityAvatarUrl,
});

const { getProviderInfo, getRouteCount } = createShellMetadata({
    state,
    getChatCompletionModel,
    getPresetCount,
    getPersonas,
    getAssetCount,
});
const { renderNav } = createNav({ state, elements, getRouteCount });
const { renderStatus } = createTopbar({ state, elements, getProviderInfo });
const { renderInspector } = createInspector({
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
const { renderPalette } = createPalette({
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

function createRouteContext() {
    return {
        state,
        escapeHtml,
        formatBytes,
        formatDate,
        formatDurationMs,
        formatNumber,
        metricCard,
        pageHead,
        renderEmptyState,
        getActivityEntries,
        getActivitySummary,
        render,
        showToast,
        recreateStats,
        chatCompletionSourceOptions,
        secretKeyByChatSource,
        maskEndpoint,
        renderInlineEmpty,
        renderKeyValue,
        getPresetGroups,
        getProviderInfo,
        getSelectedApiMain,
        getChatCompletionModel,
        getApiModelSuggestions,
        getApiSourceUiState,
        getNumberSetting,
        getSecretStateForSource,
        testApiConnection,
        setApiModelSuggestion,
        saveApiConnectionFromForm,
        updateApiSourceFields,
        updateTextCompletionTypeFields,
        matchesQuery,
        getAssetGroups,
        getAssetCount,
        getAssetEntries,
        getBackgroundUrl,
        getBackgroundFilename,
        getBackgroundFolderData,
        getBackgroundFolderById,
        getBackgroundFolderIds,
        getBackgroundFoldersFor,
        getBackgroundFolderCounts,
        setBackgroundSelectionMode,
        setBackgroundFolderFilter,
        toggleBackgroundFolderCreate,
        createBackgroundFolder,
        beginBackgroundFolderRename,
        cancelBackgroundFolderRename,
        confirmBackgroundFolderRename,
        beginBackgroundFolderDelete,
        cancelBackgroundFolderDelete,
        confirmBackgroundFolderDelete,
        assignSelectedBackgroundsToFolder,
        beginBackgroundBatchDelete,
        showMoreBackgrounds,
        cancelBackgroundDelete,
        confirmBackgroundDelete,
        beginBackgroundRename,
        cancelBackgroundRename,
        confirmBackgroundRename,
        toggleAssetDownload,
        downloadAssetFromForm,
        toggleAssetGroup,
        beginAssetDelete,
        cancelAssetDelete,
        confirmAssetDelete,
        toggleBackgroundSelection,
        uploadBackgroundFile,
        uniqueValues,
        renderCharacterRow,
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
        renderGroupRow,
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
        toggleChatBackups,
        loadChatBackups,
        exportModernChat,
        viewChatBackup,
        restoreChatBackup,
        beginChatBackupDelete,
        cancelChatBackupDelete,
        confirmChatBackupDelete,
        sendModernMessage,
        stopModernGeneration,
        checkLegacyGenerationEngine,
        regenerateModernReply,
        continueModernReply,
        swipeModernMessage,
        copyModernMessage,
        deleteModernMessage,
        beginModernMessageDelete,
        cancelModernMessageDelete,
        confirmModernMessageDelete,
        beginModernMessageEdit,
        cancelModernMessageEdit,
        saveModernMessageEdit,
        startNewModernChat,
        beginModernChatRename,
        cancelModernChatRename,
        saveModernChatRename,
        beginModernChatDelete,
        cancelModernChatDelete,
        confirmModernChatDelete,
        importModernChatFiles,
        closeChatSidebarForMobileSelection,
        getPresetCount,
        getExtensionFolderName,
        canManageExtension,
        toggleExtensionInstall,
        installExtensionFromForm,
        loadExtensionDetails,
        switchExtensionBranch,
        beginExtensionOperation,
        cancelExtensionOperation,
        confirmExtensionOperation,
        defaultGroupForm,
        groupToForm,
        beginGroupCreate,
        cancelGroupCreate,
        saveGroupCreate,
        beginGroupEdit,
        cancelGroupEdit,
        saveGroupEdit,
        beginGroupDelete,
        cancelGroupDelete,
        confirmGroupDelete,
        updateGroupFormField,
        toggleGroupFormMember,
        getPersonaUrl,
        getPersonas,
        beginPersonaCreate,
        cancelPersonaCreate,
        savePersonaCreate,
        beginPersonaEdit,
        setDefaultPersona,
        beginPersonaDelete,
        cancelPersonaDelete,
        confirmPersonaDelete,
        cancelPersonaEdit,
        savePersonaEdit,
        updatePersonaFormField,
        replacePersonaAvatar,
        parsePreset,
        getVisiblePresetGroups,
        getSelectedPresetRecord,
        getPresetEditorText,
        getOaiSettings,
        saveOpenAiPresetFromForm,
        selectPreset,
        savePresetJsonFromEditor,
        useOpenAiPreset,
        duplicatePreset,
        exportPreset,
        restorePreset,
        beginPresetDelete,
        cancelPresetDelete,
        confirmPresetDelete,
        updatePresetEditorText,
        importPresetFile,
        getRequestCompressionSettings,
        loadSettingsSnapshots,
        createSettingsSnapshot,
        saveModernPreferencesFromForm,
        saveRequestCompressionFromForm,
        previewSettingsSnapshot,
        beginSettingsSnapshotRestore,
        cancelSettingsSnapshotRestore,
        confirmSettingsSnapshotRestore,
        worldEntryPageSize,
        worldEntryPositions,
        worldEntryRoleOptions,
        worldEntrySelectiveLogicOptions,
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
    };
}

const routeContext = createRouteContext();
const routeModules = {
    dashboard: createDashboardRoute(routeContext),
    chat: createChatRoute(routeContext),
    characters: createCharactersRoute(routeContext),
    groups: createGroupsRoute(routeContext),
    worldbooks: createWorldbooksRoute(routeContext),
    presets: createPresetsRoute(routeContext),
    personas: createPersonasRoute(routeContext),
    assets: createAssetsRoute(routeContext),
    api: createApiRoute(routeContext),
    extensions: createExtensionsRoute(routeContext),
    activity: createActivityRoute(routeContext),
    settings: createSettingsRoute(routeContext),
};
const routeRenderers = Object.fromEntries(Object.entries(routeModules).map(([route, module]) => [route, module.render]));
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

async function loadData({ silent = false, notify = !silent } = {}) {
    state.loading = true;
    state.errors = [];
    if (!silent) {
        render();
    }

    const requests = {
        me: apiFetch('/api/users/me', { method: 'GET' }),
        settingsBundle: apiFetch('/api/settings/get'),
        characters: apiFetch('/api/characters/all'),
        groups: apiFetch('/api/groups/all'),
        worldbooks: apiFetch('/api/worldinfo/list'),
        backgrounds: apiFetch('/api/backgrounds/all'),
        backgroundFolders: apiFetch('/api/backgrounds/folders'),
        assets: apiFetch('/api/assets/get'),
        extensions: apiFetch('/api/extensions/discover', { method: 'GET' }),
        secrets: apiFetch('/api/secrets/settings'),
        secretState: apiFetch('/api/secrets/read'),
        stats: apiFetch('/api/stats/get'),
    };

    const entries = await Promise.all(Object.entries(requests).map(async ([key, promise]) => {
        try {
            return [key, await promise, null];
        } catch (error) {
            return [key, null, error];
        }
    }));

    for (const [key, value, error] of entries) {
        if (error) {
            state.errors.push({ key, message: error.message });
            continue;
        }

        state[key] = value;
    }

    try {
        state.settings = state.settingsBundle?.settings ? JSON.parse(state.settingsBundle.settings) : {};
    } catch (error) {
        state.settings = {};
        state.errors.push({ key: 'settings', message: `设置解析失败：${error.message}` });
    }

    if (!state.selected.character && state.characters[0]) {
        state.selected.character = state.characters[0].avatar;
    }
    if (!state.selected.group && state.groups[0]) {
        state.selected.group = state.groups[0].id;
    }
    if (!state.selected.worldbook && state.worldbooks[0]) {
        state.selected.worldbook = state.worldbooks[0].file_id;
    }
    ensureAvailableChatMode();
    if (state.route === 'chat') {
        await prepareChatForSelectedContext();
    }
    if (state.route === 'worldbooks') {
        await loadWorldDetail(state.selected.worldbook);
    }

    state.loaded = true;
    state.loading = false;
    render();

    if (notify) {
        const summary = state.errors.length ? '部分数据读取失败，详情见右侧检查器。' : '已同步当前用户数据。';
        showToast('刷新完成', summary);
    }
}

function setTheme(theme) {
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('st-modern-theme', theme);
}

function renderContent() {
    if (state.loading && !state.loaded) {
        elements.content.innerHTML = renderLoading();
        return;
    }

    const renderRoute = routeRenderers[state.route] || routeRenderers.dashboard;
    elements.content.innerHTML = renderRoute();
}

function render() {
    renderNav();
    renderStatus();
    renderContent();
    renderInspector();
}

function toggleInspector() {
    state.inspectorOpen = !state.inspectorOpen;
    localStorage.setItem('st-modern-inspector-open', String(state.inspectorOpen));
    renderInspector();
}

function openPalette() {
    elements.commandPalette.hidden = false;
    state.paletteQuery = '';
    elements.paletteSearch.value = '';
    renderPalette();
    window.setTimeout(() => elements.paletteSearch.focus(), 0);
}

function closePalette() {
    elements.commandPalette.hidden = true;
}

elements.refreshButton.addEventListener('click', () => loadData());
elements.themeButton.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
elements.mobileMenuButton.addEventListener('click', () => elements.app.querySelector('.sidebar')?.classList.toggle('open'));
elements.search.addEventListener('input', event => {
    state.query = normalizeText(event.target.value.trim());
    if (state.route === 'assets') {
        state.backgroundVisibleCount = backgroundPageSize;
    }
    render();
});
elements.content.addEventListener('input', event => {
    const routeInputHandler = routeModules[state.route]?.handleInput;
    if (routeInputHandler && routeInputHandler(event) !== false) {
        return;
    }
});
elements.content.addEventListener('change', async event => {
    const routeChangeHandler = routeModules[state.route]?.handleChange;
    if (routeChangeHandler && await routeChangeHandler(event) !== false) {
        return;
    }
});
elements.paletteSearch.addEventListener('input', event => {
    state.paletteQuery = event.target.value.trim();
    renderPalette();
});
elements.commandPalette.addEventListener('click', event => {
    if (event.target === elements.commandPalette) {
        closePalette();
    }
});
document.addEventListener('click', event => {
    handleClick(event);
});
document.addEventListener('keydown', event => {
    const routeKeydownHandler = routeModules[state.route]?.handleKeydown;
    if (routeKeydownHandler && routeKeydownHandler(event) !== false) {
        return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openPalette();
    }
    if (event.key === 'Escape') {
        closePalette();
        elements.app.querySelector('.sidebar')?.classList.remove('open');
        if (closeChatSidebarOverlay() || closeChatBackups()) {
            event.preventDefault();
        }
    }
});

render();
loadData({ notify: false });
