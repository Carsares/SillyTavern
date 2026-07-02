import {
    apiModelSuggestions,
    chatCompletionModelFields,
    chatCompletionSourceOptions,
    routeLabels,
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
import { createApiConnectionActions } from './actions/api-connection.js';
import { createAssetActions } from './actions/assets.js';
import { createCharacterActions } from './actions/characters.js';
import { createExtensionActions } from './actions/extensions.js';
import { createGroupActions } from './actions/groups.js';
import { createPersonaActions } from './actions/personas.js';
import { createPresetActions } from './actions/presets.js';
import { createSettingsActions } from './actions/settings.js';
import { createWorldbookActions } from './actions/worldbooks.js';
import { createInspector } from './shell/inspector.js';
import { createNav } from './shell/nav.js';
import { createPalette } from './shell/palette.js';
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
    stripJsonlExtension,
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
    getChatModeLabel,
    numberInput,
    formatBytes,
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

const { renderNav } = createNav({ state, elements, getRouteCount });
const { renderStatus } = createTopbar({ state, elements, getProviderInfo });
const { renderInspector } = createInspector({
    state,
    elements,
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

function matchesQuery(...values) {
    if (!state.query) {
        return true;
    }

    return values.some(value => normalizeText(value).includes(state.query));
}

function getProviderInfo() {
    const settings = state.settings || {};
    const bundle = state.settingsBundle || {};
    const api = settings.main_api || '未选择';
    const oaiSettings = settings.oai_settings || {};
    const chatSource = settings.chat_completion_source || oaiSettings.chat_completion_source || '';
    const chatModel = chatSource ? getChatCompletionModel(oaiSettings, chatSource) : '';
    const model = chatModel
        || settings.textgenerationwebui_settings?.openrouter_model
        || settings.textgenerationwebui_settings?.custom_model
        || settings.model
        || '';
    const preset = oaiSettings.preset_settings_openai || settings.preset_settings_openai || settings.preset_settings || '';

    return {
        api,
        chatSource,
        model,
        preset,
        worldCount: (bundle.world_names || []).length,
        extensionsEnabled: bundle.enable_extensions !== false,
    };
}

function getRouteCount(routeId) {
    switch (routeId) {
        case 'characters':
        case 'chat':
            return state.characters.length;
        case 'groups':
            return state.groups.length;
        case 'worldbooks':
            return state.worldbooks.length || (state.settingsBundle.world_names || []).length;
        case 'presets':
            return getPresetCount();
        case 'personas':
            return getPersonas().length;
        case 'assets':
            return getAssetCount();
        case 'extensions':
            return state.extensions.length;
        default:
            return '';
    }
}

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

function beginModernChatRename() {
    const entity = getSelectedChatEntity();
    const contextKey = getChatContextKey(entity);
    if (!contextKey || !state.selected.chat) {
        showToast('重命名失败', '请先选择一个聊天文件。');
        return;
    }

    const selectedChat = getSelectedChatList().find(chat => chat.file_id === state.selected.chat);
    state.chatRenaming = {
        key: getChatCacheKey(contextKey, state.selected.chat),
        name: stripJsonlExtension(selectedChat?.file_name || state.selected.chat),
    };
    state.chatDeleteConfirm = { key: '', name: '' };
    render();
}

function cancelModernChatRename() {
    state.chatRenaming = { key: '', name: '' };
    render();
}

async function saveModernChatRename() {
    const entity = getSelectedChatEntity();
    const contextKey = getChatContextKey(entity);
    const oldChatId = stripJsonlExtension(state.selected.chat);
    const newChatId = stripJsonlExtension(state.chatRenaming.name.trim());
    const renameKey = getChatCacheKey(contextKey, state.selected.chat);
    if (!contextKey || !oldChatId || !newChatId || state.chatRenaming.key !== renameKey) {
        throw new Error('重命名目标已变化，请重新选择聊天。');
    }
    if (oldChatId === newChatId) {
        cancelModernChatRename();
        return;
    }

    const result = await apiFetch('/api/chats/rename', {
        body: {
            avatar_url: isGroupChatMode() ? null : entity.avatar,
            original_file: `${oldChatId}.jsonl`,
            renamed_file: `${newChatId}.jsonl`,
            is_group: isGroupChatMode(),
        },
    });
    if (result?.error) {
        throw new Error('聊天文件重命名失败，可能存在同名文件。');
    }

    const renamedChatId = stripJsonlExtension(result?.sanitizedFileName || newChatId);
    if (isGroupChatMode()) {
        const index = entity.chats?.indexOf(oldChatId) ?? -1;
        if (index >= 0) {
            entity.chats.splice(index, 1, renamedChatId);
        }
        if (entity.chat_id === oldChatId) {
            entity.chat_id = renamedChatId;
        }
        await saveGroupMetadata(entity);
    }

    const oldKey = getChatCacheKey(contextKey, oldChatId);
    const newKey = getChatCacheKey(contextKey, renamedChatId);
    state.selected.chat = renamedChatId;
    if (state.chatMessages[oldKey]) {
        state.chatMessages[newKey] = state.chatMessages[oldKey];
        delete state.chatMessages[oldKey];
    }
    if (state.chatMetadata[oldKey]) {
        state.chatMetadata[newKey] = state.chatMetadata[oldKey];
        delete state.chatMetadata[oldKey];
    }
    state.chatRenaming = { key: '', name: '' };
    await refreshSelectedChatList(entity);
    await loadChatMessages(entity, renamedChatId);
    showToast('聊天已重命名', `${oldChatId} → ${renamedChatId}`);
    render();
}

function beginModernChatDelete() {
    if (state.engine.generating) {
        showToast('删除失败', '生成中不能删除聊天文件。');
        return;
    }

    const entity = getSelectedChatEntity();
    const contextKey = getChatContextKey(entity);
    const chatId = stripJsonlExtension(state.selected.chat);
    if (!contextKey || !chatId) {
        showToast('删除失败', '请先选择一个聊天文件。');
        return;
    }

    state.chatDeleteConfirm = {
        key: getChatCacheKey(contextKey, state.selected.chat),
        name: chatId,
    };
    state.chatRenaming = { key: '', name: '' };
    render();
}

function cancelModernChatDelete() {
    state.chatDeleteConfirm = { key: '', name: '' };
    render();
}

async function confirmModernChatDelete() {
    const entity = getSelectedChatEntity();
    const contextKey = getChatContextKey(entity);
    const chatId = stripJsonlExtension(state.chatDeleteConfirm.name);
    const deleteKey = getChatCacheKey(contextKey, state.selected.chat);
    if (!contextKey || !chatId || state.chatDeleteConfirm.key !== deleteKey) {
        throw new Error('删除目标已变化，请重新选择聊天。');
    }

    const result = isGroupChatMode()
        ? await apiFetch('/api/chats/group/delete', { body: { id: chatId } })
        : await apiFetch('/api/chats/delete', {
            body: {
                avatar_url: entity.avatar,
                chatfile: `${chatId}.jsonl`,
            },
        });
    if (result?.error) {
        throw new Error('聊天文件删除失败。');
    }

    if (isGroupChatMode()) {
        entity.chats = (entity.chats || []).filter(item => item !== chatId);
        if (entity.chat_id === chatId) {
            entity.chat_id = entity.chats[0] || '';
        }
        await saveGroupMetadata(entity);
    }

    const cacheKey = getChatCacheKey(contextKey, chatId);
    delete state.chatMessages[cacheKey];
    delete state.chatMessageLimits[cacheKey];
    delete state.chatMetadata[cacheKey];
    delete state.chatDrafts[cacheKey];
    state.chatRenaming = { key: '', name: '' };
    state.chatDeleteConfirm = { key: '', name: '' };
    state.selected.chat = '';
    await refreshSelectedChatList(entity);
    const chats = getSelectedChatList();
    state.selected.chat = chats[0]?.file_id || '';
    if (state.selected.chat) {
        await loadChatMessages(entity, state.selected.chat);
    }
    showToast('聊天已删除', `${chatId}.jsonl`);
    render();
}

async function recreateStats() {
    await apiFetch('/api/stats/recreate');
    await loadData({ silent: true });
    showToast('统计已重建', '已重新扫描聊天文件。');
    render();
}

async function checkLegacyGenerationEngine({ quiet = false } = {}) {
    if (state.engine.checking || state.engine.generating) {
        return;
    }

    const entity = getSelectedChatEntity();
    if (!entity) {
        state.engine.status = '未选择对象';
        state.engine.detail = '请先选择角色或群聊。';
        state.engine.error = '';
        render();
        return;
    }
    state.engine.checking = true;
    state.engine.ready = false;
    state.engine.status = '检查生成引擎';
    state.engine.error = '';
    state.engine.detail = '正在加载生成上下文。';
    render();

    try {
        const result = await callLegacyBridge('status', {
            avatar: isGroupChatMode() ? null : entity?.avatar,
            groupId: isGroupChatMode() ? entity?.id : null,
            chat: state.selected.chat || '',
        }, 60000);
        const messageCount = Number(result?.messageCount || 0);
        state.engine.ready = true;
        state.engine.status = '引擎就绪';
        state.engine.detail = `${result?.chat || state.selected.chat || '未选择聊天'} · ${formatNumber(messageCount)} 条上下文消息`;
        if (!quiet) {
            showToast('生成引擎已就绪', state.engine.detail);
        }
    } catch (error) {
        state.engine.ready = false;
        state.engine.error = error.message;
        state.engine.status = '引擎不可用';
        state.engine.detail = error.message;
        if (!quiet) {
            throw error;
        }
    } finally {
        state.engine.checking = false;
        render();
    }
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

async function startNewModernChat() {
    const entity = getSelectedChatEntity();
    const chatId = await createModernChatFile(entity);
    showToast('新聊天已创建', `${getChatEntityName(entity)} 的新会话已选中。`);
    render();
    return chatId;
}

async function runLegacyChatGeneration(type, { entity, chatId, message = '', toastTitle, toastMessage }) {
    if (state.engine.generating) {
        return;
    }

    const contextKey = getChatContextKey(entity);
    if (!contextKey || !chatId) {
        throw new Error(isGroupChatMode() ? '请先选择群聊和聊天文件' : '请先选择角色和聊天文件');
    }

    state.engine.generating = true;
    state.engine.status = '生成中';
    state.engine.error = '';
    state.engine.detail = `${getChatEntityName(entity)} · ${chatId}`;
    render();

    try {
        const result = await callLegacyBridge('generate', {
            avatar: isGroupChatMode() ? null : entity.avatar,
            groupId: isGroupChatMode() ? entity.id : null,
            chat: chatId,
            type,
            message,
        });
        const nextChatId = stripJsonlExtension(result?.chat || chatId);
        state.selected.chat = nextChatId;
        delete state.chatMessages[getChatCacheKey(contextKey, nextChatId)];
        delete state.chatMetadata[getChatCacheKey(contextKey, nextChatId)];
        await refreshSelectedChatList(entity);
        await loadChatMessages(entity, nextChatId, { force: true });
        state.engine.ready = true;
        state.engine.status = '就绪';
        state.engine.detail = `${nextChatId} · 已同步最新消息`;
        showToast(toastTitle, toastMessage);
    } catch (error) {
        state.engine.error = error.message;
        state.engine.status = error.message.includes('停止') ? '已停止' : '生成失败';
        state.engine.detail = error.message;
        throw error;
    } finally {
        state.engine.generating = false;
        render();
    }
}

async function swipeModernMessage(messageIndex, direction) {
    if (state.engine.generating) {
        return;
    }

    const entity = getSelectedChatEntity();
    const contextKey = getChatContextKey(entity);
    if (!contextKey || !state.selected.chat) {
        throw new Error('请先选择一个聊天文件');
    }

    const index = Number(messageIndex);
    const messages = getSelectedChatMessages();
    if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
        throw new Error('消息位置无效，请刷新后重试。');
    }

    state.engine.generating = true;
    state.engine.status = '候选切换中';
    state.engine.error = '';
    state.engine.detail = `${state.selected.chat} · ${direction === 'left' ? '上一个候选' : '下一个候选'}`;
    render();

    try {
        const result = await callLegacyBridge('swipe', {
            avatar: isGroupChatMode() ? null : entity.avatar,
            groupId: isGroupChatMode() ? entity.id : null,
            chat: state.selected.chat,
            messageIndex: index,
            direction,
        });
        const nextChatId = stripJsonlExtension(result?.chat || state.selected.chat);
        state.selected.chat = nextChatId;
        delete state.chatMessages[getChatCacheKey(contextKey, nextChatId)];
        delete state.chatMetadata[getChatCacheKey(contextKey, nextChatId)];
        await refreshSelectedChatList(entity);
        await loadChatMessages(entity, nextChatId, { force: true });
        state.engine.ready = true;
        state.engine.status = '就绪';
        state.engine.detail = `${nextChatId} · 当前候选 ${formatNumber((result?.swipeId || 0) + 1)}/${formatNumber(result?.swipeCount || 1)}`;
        showToast('候选已切换', `当前候选 ${formatNumber((result?.swipeId || 0) + 1)}/${formatNumber(result?.swipeCount || 1)}`);
    } catch (error) {
        state.engine.error = error.message;
        state.engine.status = '候选切换失败';
        state.engine.detail = error.message;
        throw error;
    } finally {
        state.engine.generating = false;
        render();
    }
}

async function sendModernMessage() {
    const draftKey = getCurrentDraftKey();
    const draft = (state.chatDrafts[draftKey] || '').trim();
    if (!draft || state.engine.generating) {
        return;
    }

    const entity = getSelectedChatEntity();
    let chatId = state.selected.chat;
    if (!chatId) {
        chatId = await createModernChatFile(entity);
    }

    state.chatDrafts[draftKey] = '';
    state.chatDrafts[getChatCacheKey(getChatContextKey(entity), chatId)] = '';
    await runLegacyChatGeneration('normal', {
        entity,
        chatId,
        message: draft,
        toastTitle: '消息已生成',
        toastMessage: '生成引擎已完成回复并保存聊天文件。',
    });
}

async function regenerateModernReply() {
    if (state.engine.generating) {
        return;
    }

    const entity = getSelectedChatEntity();
    if (!getChatContextKey(entity) || !state.selected.chat) {
        throw new Error('请先选择一个聊天文件');
    }

    if (!getSelectedChatMessages().length) {
        throw new Error('当前聊天没有可重生成的上下文');
    }

    await runLegacyChatGeneration('regenerate', {
        entity,
        chatId: state.selected.chat,
        toastTitle: '回复已重生成',
        toastMessage: '生成引擎已更新最后一条回复。',
    });
}

async function continueModernReply() {
    if (state.engine.generating) {
        return;
    }

    const entity = getSelectedChatEntity();
    if (!getChatContextKey(entity) || !state.selected.chat) {
        throw new Error('请先选择一个聊天文件');
    }

    if (!getSelectedChatMessages().length) {
        throw new Error('当前聊天没有可继续生成的上下文');
    }

    await runLegacyChatGeneration('continue', {
        entity,
        chatId: state.selected.chat,
        toastTitle: '已继续生成',
        toastMessage: '生成引擎已追加到当前回复。',
    });
}

async function copyModernMessage(messageIndex) {
    const index = Number(messageIndex);
    const messages = getSelectedChatMessages();
    if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
        throw new Error('消息位置无效，请刷新后重试。');
    }

    const message = messages[index];
    const text = message.extra?.display_text || message.mes || '';
    if (!text) {
        throw new Error('消息内容为空。');
    }

    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
    } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.append(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
    }
    showToast('消息已复制', message.name || '当前聊天');
}

async function deleteModernMessage(messageIndex) {
    if (state.engine.generating) {
        throw new Error('生成中不能删除消息。');
    }

    const entity = getSelectedChatEntity();
    if (!getChatContextKey(entity) || !state.selected.chat) {
        throw new Error('请先选择一个聊天文件');
    }

    const index = Number(messageIndex);
    const messages = [...getSelectedChatMessages()];
    if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
        throw new Error('消息位置无效，请刷新后重试。');
    }

    const [deletedMessage] = messages.splice(index, 1);
    await saveModernChat(entity, state.selected.chat, messages);
    await refreshSelectedChatList(entity);
    state.chatMessageDeleteConfirm = { key: '', index: -1 };
    showToast('消息已删除', deletedMessage?.name || '当前聊天');
    render();
}

function beginModernMessageDelete(messageIndex) {
    if (state.engine.generating) {
        showToast('删除失败', '生成中不能删除消息。');
        return;
    }

    const entity = getSelectedChatEntity();
    const contextKey = getChatContextKey(entity);
    if (!contextKey || !state.selected.chat) {
        showToast('删除失败', '请先选择一个聊天文件。');
        return;
    }

    const index = Number(messageIndex);
    const messages = getSelectedChatMessages();
    if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
        showToast('删除失败', '消息位置无效，请刷新后重试。');
        return;
    }

    state.chatMessageDeleteConfirm = { key: getCurrentDraftKey(), index };
    state.chatEditing = { key: '', index: -1, text: '' };
    render();
}

function cancelModernMessageDelete() {
    state.chatMessageDeleteConfirm = { key: '', index: -1 };
    render();
}

async function confirmModernMessageDelete() {
    const confirm = state.chatMessageDeleteConfirm;
    if (confirm.key !== getCurrentDraftKey() || confirm.index < 0) {
        throw new Error('删除目标已变化，请重新选择消息。');
    }

    await deleteModernMessage(confirm.index);
}

async function importModernChatFiles(files) {
    const entity = getSelectedChatEntity();
    const contextKey = getChatContextKey(entity);
    if (!contextKey) {
        throw new Error(isGroupChatMode() ? '请先选择一个群聊。' : '请先选择一个角色。');
    }

    const importedFileNames = [];
    for (const file of Array.from(files || [])) {
        const format = file.name.split('.').pop()?.toLowerCase() || '';
        if (!['json', 'jsonl'].includes(format)) {
            throw new Error('聊天导入仅支持 JSON 或 JSONL 文件。');
        }
        if (isGroupChatMode() && format !== 'jsonl') {
            throw new Error('群聊导入仅支持 SillyTavern JSONL 文件。');
        }

        const formData = new FormData();
        formData.set('file_type', format);
        formData.set('avatar', file, file.name);
        formData.set('avatar_url', isGroupChatMode() ? '' : entity.avatar);
        formData.set('user_name', getUserName());
        formData.set('character_name', getChatEntityName(entity));
        const result = await apiFetch(isGroupChatMode() ? '/api/chats/group/import' : '/api/chats/import', { body: formData, omitContentType: true });
        if (result?.error) {
            throw new Error(`${file.name} 导入失败，文件格式可能不兼容。`);
        }
        if (isGroupChatMode()) {
            importedFileNames.push(result.res);
        } else {
            importedFileNames.push(...(result?.fileNames || []));
        }
    }

    if (!importedFileNames.length) {
        throw new Error('没有导入任何聊天文件。');
    }

    if (isGroupChatMode()) {
        entity.chats = uniqueValues([...(entity.chats || []), ...importedFileNames.map(stripJsonlExtension)]);
        entity.chat_id = stripJsonlExtension(importedFileNames[0]);
        await saveGroupMetadata(entity);
    }
    clearChatSearch();
    await refreshSelectedChatList(entity);
    state.selected.chat = getChatId({ file_name: importedFileNames[0] });
    await loadChatMessages(entity, state.selected.chat, { force: true });
    showToast('聊天已导入', `${formatNumber(importedFileNames.length)} 个文件`);
    render();
}

async function exportModernChat(format) {
    const entity = getSelectedChatEntity();
    const chatId = stripJsonlExtension(state.selected.chat);
    if (!getChatContextKey(entity) || !chatId) {
        throw new Error('请先选择一个聊天文件。');
    }

    const safeFormat = format === 'jsonl' ? 'jsonl' : 'txt';
    const result = await apiFetch('/api/chats/export', {
        body: {
            is_group: isGroupChatMode(),
            avatar_url: isGroupChatMode() ? null : entity.avatar,
            file: `${chatId}.jsonl`,
            exportfilename: `${chatId}.${safeFormat}`,
            format: safeFormat,
        },
    });
    if (!result?.result) {
        throw new Error('聊天导出结果为空。');
    }

    downloadFile(result.result, `${chatId}.${safeFormat}`, safeFormat === 'txt' ? 'text/plain' : 'application/jsonl');
    showToast('导出已开始', `${chatId}.${safeFormat}`);
}

async function loadChatBackups({ force = false } = {}) {
    if (state.chatBackups.items.length && !force) {
        return state.chatBackups.items;
    }

    state.chatBackups.loading = true;
    render();
    try {
        const result = await apiFetch('/api/backups/chat/get');
        const backups = Array.isArray(result) ? sortChats(result.filter(item => item.file_name)) : [];
        state.chatBackups.items = backups;
        return backups;
    } finally {
        state.chatBackups.loading = false;
    }
}

async function toggleChatBackups() {
    state.chatBackups.open = !state.chatBackups.open;
    if (state.chatBackups.open) {
        await loadChatBackups();
    }
    render();
}

function formatBackupPreview(rawText) {
    const lines = String(rawText || '').split('\n').filter(Boolean);
    const messages = [];
    for (const line of lines) {
        try {
            const item = JSON.parse(line);
            if (item?.mes) {
                messages.push(`${item.name || 'Unknown'} · ${formatDate(item.send_date)}\n${item.extra?.display_text || item.mes}`);
            }
        } catch {
            // Ignore broken lines in a backup preview; restore still uses the original file.
        }
    }

    return messages.slice(-40).join('\n\n') || '这个备份没有可预览的消息。';
}

async function downloadChatBackup(name) {
    return apiFetchResponse('/api/backups/chat/download', { body: { name } });
}

async function viewChatBackup(name) {
    const response = await downloadChatBackup(name);
    const rawText = await response.text();
    state.chatBackups.previewName = name;
    state.chatBackups.previewText = formatBackupPreview(rawText);
    render();
}

async function restoreChatBackup(name) {
    const entity = getSelectedChatEntity();
    if (!getChatContextKey(entity)) {
        throw new Error(isGroupChatMode() ? '请先选择要恢复到的群聊。' : '请先选择要恢复到的角色。');
    }

    state.chatBackups.restoring = name;
    render();
    try {
        const response = await downloadChatBackup(name);
        const blob = await response.blob();
        const file = new File([blob], name, { type: 'application/octet-stream' });
        await importModernChatFiles([file]);
        state.chatBackups.restoring = '';
        showToast('备份已恢复', `${name} 已导入到 ${getChatEntityName(entity)}`);
        render();
    } catch (error) {
        state.chatBackups.restoring = '';
        throw error;
    }
}

function beginChatBackupDelete(name) {
    state.chatBackups.deleteConfirm = name;
    render();
}

function cancelChatBackupDelete() {
    state.chatBackups.deleteConfirm = '';
    render();
}

async function confirmChatBackupDelete() {
    const name = state.chatBackups.deleteConfirm;
    if (!name) {
        throw new Error('请先选择一个备份。');
    }

    state.chatBackups.deleting = true;
    render();
    try {
        await apiFetch('/api/backups/chat/delete', { body: { name } });
        state.chatBackups.items = state.chatBackups.items.filter(item => item.file_name !== name);
        if (state.chatBackups.previewName === name) {
            state.chatBackups.previewName = '';
            state.chatBackups.previewText = '';
        }
        state.chatBackups.deleteConfirm = '';
        showToast('备份已删除', name);
    } finally {
        state.chatBackups.deleting = false;
        render();
    }
}

function beginModernMessageEdit(messageIndex) {
    if (state.engine.generating) {
        showToast('暂不能编辑', '生成中不能编辑消息。');
        return;
    }

    const entity = getSelectedChatEntity();
    const contextKey = getChatContextKey(entity);
    const index = Number(messageIndex);
    const messages = getSelectedChatMessages();
    if (!contextKey || !state.selected.chat || !Number.isInteger(index) || index < 0 || index >= messages.length) {
        showToast('编辑失败', '消息位置无效，请刷新后重试。');
        return;
    }

    const message = messages[index];
    state.chatEditing = {
        key: getChatCacheKey(contextKey, state.selected.chat),
        index,
        text: message.extra?.display_text || message.mes || '',
    };
    state.chatMessageDeleteConfirm = { key: '', index: -1 };
    render();
}

function cancelModernMessageEdit() {
    state.chatEditing = { key: '', index: -1, text: '' };
    render();
}

function formatEditedModernMessage(message, text) {
    const nextMessage = {
        ...message,
        mes: text,
    };

    if (nextMessage.extra?.display_text !== undefined) {
        nextMessage.extra = { ...nextMessage.extra, display_text: text };
    }

    if (nextMessage.swipe_id !== undefined) {
        const swipeId = Math.max(0, Number(nextMessage.swipe_id) || 0);
        const swipes = Array.isArray(nextMessage.swipes) ? [...nextMessage.swipes] : [message.mes || ''];
        while (swipes.length <= swipeId) {
            swipes.push('');
        }
        swipes[swipeId] = text;
        nextMessage.swipes = swipes;

        if (Array.isArray(nextMessage.swipe_info)) {
            nextMessage.swipe_info = nextMessage.swipe_info.map((item, index) => {
                if (index !== swipeId || item?.extra?.display_text === undefined) {
                    return item;
                }
                return { ...item, extra: { ...item.extra, display_text: text } };
            });
        }
    }

    return nextMessage;
}

async function saveModernMessageEdit() {
    if (state.engine.generating) {
        throw new Error('生成中不能保存编辑。');
    }

    const entity = getSelectedChatEntity();
    const contextKey = getChatContextKey(entity);
    const editKey = getChatCacheKey(contextKey, state.selected.chat);
    const edit = state.chatEditing;
    const text = edit.text.trim();
    const messages = [...getSelectedChatMessages()];
    if (!contextKey || !state.selected.chat || edit.key !== editKey || edit.index < 0 || edit.index >= messages.length) {
        throw new Error('编辑目标已变化，请重新选择消息。');
    }
    if (!text) {
        throw new Error('消息内容不能为空。');
    }

    const nextMessage = formatEditedModernMessage(messages[edit.index], text);
    messages[edit.index] = nextMessage;

    await saveModernChat(entity, state.selected.chat, messages);
    await refreshSelectedChatList(entity);
    state.chatEditing = { key: '', index: -1, text: '' };
    showToast('消息已保存', nextMessage.name || '当前聊天');
    render();
}

async function stopModernGeneration() {
    try {
        await callLegacyBridge('stop', {}, 15000);
    } catch (error) {
        state.errors.push({ key: 'legacy-stop', message: error.message });
    }
    state.engine.generating = false;
    state.engine.status = '已停止';
    state.engine.detail = '已向生成引擎发送停止请求。';
    render();
}

async function setRoute(routeId) {
    if (!routeLabels[routeId]) {
        return;
    }

    state.route = routeId;
    const url = new URL(window.location.href);
    url.searchParams.set('view', routeId);
    window.history.replaceState({}, '', url);
    elements.content.focus({ preventScroll: true });
    render();

    if (routeId === 'chat') {
        await prepareChatForSelectedContext();
        render();
    }
    if (routeId === 'worldbooks') {
        await loadWorldDetail(state.selected.worldbook);
        render();
    }
}

function setTheme(theme) {
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('st-modern-theme', theme);
}

function toggleChatSidebar(open = !state.chatSidebarOpen) {
    state.chatSidebarOpen = open;
    localStorage.setItem('st-modern-chat-sidebar-open', String(open));
    render();
}

function getActivityEntries() {
    return Object.entries(state.stats || {})
        .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
        .map(([id, stats]) => ({
            id,
            messages: Number(stats.user_msg_count || 0) + Number(stats.non_user_msg_count || 0),
            words: Number(stats.user_word_count || 0) + Number(stats.non_user_word_count || 0),
            size: Number(stats.chat_size || 0),
            swipes: Number(stats.total_swipe_count || 0),
            genTime: Number(stats.total_gen_time || 0),
            first: Number(stats.date_first_chat || 0),
            last: Number(stats.date_last_chat || 0),
        }))
        .sort((a, b) => b.last - a.last);
}

function getActivitySummary(entries) {
    return entries.reduce((summary, entry) => ({
        messages: summary.messages + entry.messages,
        words: summary.words + entry.words,
        size: summary.size + entry.size,
        swipes: summary.swipes + entry.swipes,
        genTime: summary.genTime + entry.genTime,
        last: Math.max(summary.last, entry.last),
    }), { messages: 0, words: 0, size: 0, swipes: 0, genTime: 0, last: 0 });
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

function showToast(title, message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
    elements.toastStack.append(toast);
    window.setTimeout(() => toast.remove(), 4200);
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

function runCommandAction(action) {
    switch (action) {
        case 'create-character':
            beginCharacterCreate();
            break;
        case 'create-group':
            beginGroupCreate();
            break;
        case 'create-worldbook':
            beginWorldbookCreate();
            break;
        default:
            break;
    }
}

async function handleClick(event) {
    if (event.target.closest('[data-toggle-inspector]')) {
        toggleInspector();
        return;
    }

    if (event.target.closest('[data-toggle-chat-sidebar]')) {
        toggleChatSidebar();
        return;
    }

    const routeButton = event.target.closest('[data-route]');
    if (routeButton) {
        if (routeButton.dataset.openGroupChat) {
            state.chatMode = 'group';
            localStorage.setItem('st-modern-chat-mode', 'group');
            state.selected.group = routeButton.dataset.openGroupChat;
            state.selected.chat = '';
            clearChatSearch();
        }
        await setRoute(routeButton.dataset.route);
        elements.app.querySelector('.sidebar')?.classList.remove('open');
        return;
    }

    const characterButton = event.target.closest('[data-select-character]');
    if (characterButton) {
        state.chatMode = 'character';
        localStorage.setItem('st-modern-chat-mode', 'character');
        state.selected.character = characterButton.dataset.selectCharacter;
        state.selected.chat = '';
        clearChatSearch();
        if (state.route === 'chat') {
            await prepareChatForSelectedContext();
        }
        render();
        return;
    }

    const groupButton = event.target.closest('[data-select-group]');
    if (groupButton) {
        state.chatMode = 'group';
        localStorage.setItem('st-modern-chat-mode', 'group');
        state.selected.group = groupButton.dataset.selectGroup;
        state.selected.chat = '';
        clearChatSearch();
        if (state.route === 'chat') {
            await prepareChatForSelectedContext();
        }
        render();
        return;
    }

    const routeClickHandler = routeModules[state.route]?.handleClick;
    if (routeClickHandler && await routeClickHandler(event) !== false) {
        return;
    }

    const commandButton = event.target.closest('[data-command-route]');
    if (commandButton) {
        const select = commandButton.dataset.commandSelect;
        const id = commandButton.dataset.commandId;
        const action = commandButton.dataset.commandAction;
        if (select && id) {
            state.selected[select] = id;
        }
        closePalette();
        await setRoute(commandButton.dataset.commandRoute);
        if (action) {
            runCommandAction(action);
        }
        return;
    }

    if (event.target.closest('[data-refresh]')) {
        await loadData();
    }
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
    }
});

render();
loadData({ notify: false });
