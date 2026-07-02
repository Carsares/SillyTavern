import {
    apiModelSuggestions,
    characterFormDefaults,
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
import { createPresetActions } from './actions/presets.js';
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
    alternateGreetingsToInput,
    arrayToEntryInput,
    downloadFile,
    entryInputToArray,
    escapeHtml,
    formatBytes,
    formatDate,
    formatDurationMs,
    formatNumber,
    getAvatarUrl,
    getPersonaUrl,
    inputToAlternateGreetings,
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

function getPersonas() {
    const powerUser = state.settings.power_user || state.settings;
    const personas = powerUser.personas || {};
    const descriptions = powerUser.persona_descriptions || {};

    return Object.entries(personas).map(([avatarId, name]) => ({
        avatarId,
        name,
        title: descriptions[avatarId]?.title || '',
        description: descriptions[avatarId]?.description || '',
        default: powerUser.default_persona === avatarId,
    }));
}

function getAssetGroups() {
    return Object.entries(state.assets || {}).map(([name, value]) => {
        if (Array.isArray(value)) {
            return { name, count: value.length, detail: value };
        }

        if (value && typeof value === 'object') {
            const count = Object.values(value).reduce((total, item) => total + (Array.isArray(item) ? item.length : 0), 0);
            return { name, count, detail: value };
        }

        return { name, count: 0, detail: value };
    });
}

function getAssetCount() {
    return getAssetGroups().reduce((total, group) => total + group.count, 0);
}

function getAssetFileName(assetPath) {
    return String(assetPath || '').split('/').filter(Boolean).pop() || '';
}

function getAssetRelativeName(category, assetPath) {
    const value = String(assetPath || '');
    const prefix = `assets/${category}/`;
    return value.startsWith(prefix) ? value.slice(prefix.length) : getAssetFileName(value);
}

function canDeleteAsset(category, assetPath) {
    const relativeName = getAssetRelativeName(category, assetPath);
    return ['bgm', 'ambient', 'blip'].includes(category) && relativeName && !relativeName.includes('/');
}

function getAssetEntries(group, limit = Infinity) {
    const entries = [];
    if (Array.isArray(group.detail)) {
        group.detail.forEach(assetPath => {
            entries.push({
                category: group.name,
                filename: getAssetRelativeName(group.name, assetPath),
                path: assetPath,
                label: getAssetFileName(assetPath),
                deletable: canDeleteAsset(group.name, assetPath),
            });
        });
    } else if (group.detail && typeof group.detail === 'object') {
        Object.entries(group.detail).forEach(([section, items]) => {
            if (!Array.isArray(items)) {
                return;
            }
            items.forEach(assetPath => {
                entries.push({
                    category: group.name,
                    filename: getAssetRelativeName(group.name, assetPath),
                    path: assetPath,
                    label: `${section}/${getAssetFileName(assetPath)}`,
                    deletable: canDeleteAsset(group.name, assetPath),
                });
            });
        });
    }

    return Number.isFinite(limit) ? entries.slice(0, limit) : entries;
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

async function loadWorldDetail(worldbookId, { force = false } = {}) {
    if (!worldbookId || (state.worldDetails[worldbookId] && !force)) {
        return state.worldDetails[worldbookId] || null;
    }

    try {
        state.worldDetails[worldbookId] = await apiFetch('/api/worldinfo/get', { body: { name: worldbookId } });
        return state.worldDetails[worldbookId];
    } catch (error) {
        state.errors.push({ key: 'worldbook', message: error.message });
        showToast('世界书读取失败', error.message);
        return null;
    }
}

async function loadCharacterDetail(avatar, { force = false } = {}) {
    if (!avatar || (state.characterDetails[avatar] && !force)) {
        return state.characterDetails[avatar] || null;
    }

    try {
        state.characterDetails[avatar] = await apiFetch('/api/characters/get', { body: { avatar_url: avatar } });
        return state.characterDetails[avatar];
    } catch (error) {
        state.errors.push({ key: 'character', message: error.message });
        showToast('角色卡读取失败', error.message);
        return null;
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

function getCharacterAvatarUrl(character) {
    const url = getAvatarUrl(character);
    const avatar = character?.avatar || '';
    const cacheBust = avatar ? state.avatarCacheBust[avatar] : '';
    return url && cacheBust ? `${url}?v=${encodeURIComponent(cacheBust)}` : url;
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

function getCharacterByAvatar(avatar) {
    return state.characters.find(character => character.avatar === avatar) || state.characterDetails[avatar] || null;
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

function defaultCharacterForm() {
    return { ...characterFormDefaults };
}

function getCharacterData(character) {
    return character?.data || {};
}

function getCharacterTags(character) {
    const dataTags = getCharacterData(character).tags;
    return Array.isArray(dataTags) ? dataTags : Array.isArray(character?.tags) ? character.tags : [];
}

function characterToForm(character) {
    const data = getCharacterData(character);
    const extensions = data.extensions || {};
    const depthPrompt = extensions.depth_prompt || {};

    return {
        ...defaultCharacterForm(),
        name: data.name || character?.name || '',
        description: data.description || character?.description || '',
        personality: data.personality || character?.personality || '',
        scenario: data.scenario || character?.scenario || '',
        first_mes: data.first_mes || character?.first_mes || '',
        mes_example: data.mes_example || character?.mes_example || '',
        creator_notes: data.creator_notes || character?.creatorcomment || '',
        system_prompt: data.system_prompt || '',
        post_history_instructions: data.post_history_instructions || '',
        creator: data.creator || '',
        character_version: data.character_version || '',
        tags: arrayToEntryInput(getCharacterTags(character)),
        world: extensions.world || '',
        alternate_greetings: alternateGreetingsToInput(data.alternate_greetings),
        depth_prompt_prompt: depthPrompt.prompt || '',
        depth_prompt_depth: String(depthPrompt.depth ?? 4),
        depth_prompt_role: depthPrompt.role || 'system',
        talkativeness: String(extensions.talkativeness ?? character?.talkativeness ?? 0.5),
        favorite: Boolean(extensions.fav ?? character?.fav),
    };
}

function characterCreatePayload(form) {
    return {
        ch_name: form.name.trim(),
        description: form.description,
        personality: form.personality,
        scenario: form.scenario,
        first_mes: form.first_mes,
        mes_example: form.mes_example,
        creator_notes: form.creator_notes,
        system_prompt: form.system_prompt,
        post_history_instructions: form.post_history_instructions,
        tags: entryInputToArray(form.tags),
        creator: form.creator,
        character_version: form.character_version,
        world: form.world,
        alternate_greetings: inputToAlternateGreetings(form.alternate_greetings),
        depth_prompt_prompt: form.depth_prompt_prompt,
        depth_prompt_depth: numberInput(form.depth_prompt_depth, 4),
        depth_prompt_role: form.depth_prompt_role || 'system',
        talkativeness: numberInput(form.talkativeness, 0.5),
        fav: form.favorite ? 'true' : 'false',
    };
}

function characterMergePayload(avatar, form) {
    const tags = entryInputToArray(form.tags);
    const talkativeness = numberInput(form.talkativeness, 0.5);
    const favorite = !!form.favorite;
    const depthPrompt = {
        prompt: form.depth_prompt_prompt || '',
        depth: numberInput(form.depth_prompt_depth, 4),
        role: form.depth_prompt_role || 'system',
    };

    return {
        avatar,
        name: form.name.trim(),
        description: form.description,
        personality: form.personality,
        scenario: form.scenario,
        first_mes: form.first_mes,
        mes_example: form.mes_example,
        creatorcomment: form.creator_notes,
        talkativeness,
        fav: favorite,
        tags,
        data: {
            name: form.name.trim(),
            description: form.description,
            personality: form.personality,
            scenario: form.scenario,
            first_mes: form.first_mes,
            mes_example: form.mes_example,
            creator_notes: form.creator_notes,
            system_prompt: form.system_prompt,
            post_history_instructions: form.post_history_instructions,
            alternate_greetings: inputToAlternateGreetings(form.alternate_greetings),
            tags,
            creator: form.creator,
            character_version: form.character_version,
            extensions: {
                world: form.world,
                talkativeness,
                fav: favorite,
                depth_prompt: depthPrompt,
            },
        },
    };
}

function clearCharacterCache(avatar) {
    if (!avatar) {
        return;
    }

    delete state.characterDetails[avatar];
    delete state.chatLists[avatar];
    Object.keys(state.chatMessages).forEach(key => {
        if (key.startsWith(`${avatar}::`)) {
            delete state.chatMessages[key];
        }
    });
    Object.keys(state.chatMessageLimits).forEach(key => {
        if (key.startsWith(`${avatar}::`)) {
            delete state.chatMessageLimits[key];
        }
    });
    Object.keys(state.chatMetadata).forEach(key => {
        if (key.startsWith(`${avatar}::`)) {
            delete state.chatMetadata[key];
        }
    });
}

function beginCharacterCreate() {
    state.characterCreating = { active: true, form: defaultCharacterForm() };
    state.characterEditing = { avatar: '', form: {} };
    render();
}

function cancelCharacterCreate() {
    state.characterCreating = { active: false, form: defaultCharacterForm() };
    render();
}

async function saveCharacterCreate() {
    const form = state.characterCreating.form;
    const payload = characterCreatePayload(form);
    if (!payload.ch_name) {
        throw new Error('角色名称不能为空。');
    }

    const avatar = await apiFetch('/api/characters/create', { body: payload });
    state.characterCreating = { active: false, form: defaultCharacterForm() };
    state.selected.character = avatar;
    state.selected.chat = '';
    await loadData({ silent: true });
    await loadCharacterDetail(avatar, { force: true });
    showToast('角色已创建', avatar);
    render();
}

async function beginCharacterEdit(avatar) {
    const character = await loadCharacterDetail(avatar);
    if (!character) {
        return;
    }

    state.characterEditing = { avatar, form: characterToForm(character) };
    state.characterCreating = { active: false, form: defaultCharacterForm() };
    state.characterRenaming = { avatar: '', name: '' };
    state.characterDeleteConfirm = { avatar: '', name: '', deleteChats: false };
    render();
}

function cancelCharacterEdit() {
    state.characterEditing = { avatar: '', form: {} };
    render();
}

async function saveCharacterEdit() {
    const { avatar, form } = state.characterEditing;
    if (!avatar || state.selected.character !== avatar) {
        throw new Error('编辑目标已变化，请重新选择角色。');
    }
    if (!form.name?.trim()) {
        throw new Error('角色名称不能为空。');
    }

    await apiFetch('/api/characters/merge-attributes', { body: characterMergePayload(avatar, form) });
    state.characterEditing = { avatar: '', form: {} };
    clearCharacterCache(avatar);
    await loadData({ silent: true });
    await loadCharacterDetail(avatar, { force: true });
    showToast('角色卡已保存', form.name.trim());
    render();
}

function beginCharacterRename(character) {
    state.characterRenaming = {
        avatar: character.avatar,
        name: character.name || character.data?.name || '',
    };
    state.characterDeleteConfirm = { avatar: '', name: '', deleteChats: false };
    render();
}

function cancelCharacterRename() {
    state.characterRenaming = { avatar: '', name: '' };
    render();
}

async function confirmCharacterRename() {
    const { avatar, name } = state.characterRenaming;
    const nextName = name.trim();
    if (!avatar || state.selected.character !== avatar) {
        throw new Error('重命名目标已变化，请重新选择角色。');
    }
    if (!nextName) {
        throw new Error('新名称不能为空。');
    }

    const result = await apiFetch('/api/characters/rename', { body: { avatar_url: avatar, new_name: nextName } });
    const nextAvatar = result?.avatar || avatar;
    clearCharacterCache(avatar);
    state.characterRenaming = { avatar: '', name: '' };
    state.characterEditing = { avatar: '', form: {} };
    state.selected.character = nextAvatar;
    state.selected.chat = '';
    await loadData({ silent: true });
    await loadCharacterDetail(nextAvatar, { force: true });
    showToast('角色已重命名', nextAvatar);
    render();
}

async function duplicateCharacter(avatar) {
    if (!avatar) {
        return;
    }

    const result = await apiFetch('/api/characters/duplicate', { body: { avatar_url: avatar } });
    const nextAvatar = result?.path || result?.avatar || '';
    if (nextAvatar) {
        state.selected.character = nextAvatar;
        state.selected.chat = '';
    }
    await loadData({ silent: true });
    if (nextAvatar) {
        await loadCharacterDetail(nextAvatar, { force: true });
    }
    showToast('角色已复制', nextAvatar || avatar);
    render();
}

function beginCharacterDelete(character) {
    state.characterDeleteConfirm = {
        avatar: character.avatar,
        name: character.name || character.data?.name || character.avatar,
        deleteChats: false,
    };
    state.characterRenaming = { avatar: '', name: '' };
    render();
}

function cancelCharacterDelete() {
    state.characterDeleteConfirm = { avatar: '', name: '', deleteChats: false };
    render();
}

async function confirmCharacterDelete() {
    const { avatar, deleteChats } = state.characterDeleteConfirm;
    if (!avatar || state.selected.character !== avatar) {
        throw new Error('删除目标已变化，请重新选择角色。');
    }

    await apiFetch('/api/characters/delete', { body: { avatar_url: avatar, delete_chats: deleteChats } });
    clearCharacterCache(avatar);
    state.characterDeleteConfirm = { avatar: '', name: '', deleteChats: false };
    state.characterEditing = { avatar: '', form: {} };
    state.selected.character = '';
    state.selected.chat = '';
    await loadData({ silent: true });
    showToast('角色已删除', avatar);
    render();
}

async function exportCharacter(avatar, format) {
    const response = await apiFetchResponse('/api/characters/export', { body: { avatar_url: avatar, format } });
    const blob = await response.blob();
    const baseName = String(avatar || 'character').replace(/\.png$/i, '');
    const fileName = `${baseName}.${format}`;
    downloadFile(blob, fileName);
    showToast('导出已开始', fileName);
}

async function importCharacterFile(file) {
    if (!file) {
        return;
    }

    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const supportedFormats = ['png', 'json', 'yaml', 'yml', 'charx', 'byaf'];
    if (!supportedFormats.includes(extension)) {
        throw new Error('仅支持 png/json/yaml/yml/charx/byaf 角色卡文件。');
    }

    const formData = new FormData();
    formData.set('avatar', file, file.name);
    formData.set('file_type', extension);
    formData.set('preserved_name', file.name);
    const result = await apiFetch('/api/characters/import', { body: formData, omitContentType: true });
    if (result?.error) {
        throw new Error('角色卡导入失败。');
    }

    const avatar = result?.file_name || '';
    if (avatar) {
        state.selected.character = avatar;
        state.selected.chat = '';
    }
    await loadData({ silent: true });
    if (avatar) {
        await loadCharacterDetail(avatar, { force: true });
    }
    showToast('角色已导入', avatar || file.name);
    render();
}

async function replaceCharacterAvatar(avatar, file) {
    if (!avatar) {
        throw new Error('请选择要替换头像的角色。');
    }
    if (!file) {
        return;
    }
    if (file.type && !file.type.startsWith('image/')) {
        throw new Error('角色头像只支持图片文件。');
    }

    const formData = new FormData();
    formData.set('avatar', file, file.name || 'avatar.png');
    formData.set('avatar_url', avatar);
    await apiFetch('/api/characters/edit-avatar', { body: formData, omitContentType: true });
    state.avatarCacheBust[avatar] = String(Date.now());
    clearCharacterCache(avatar);
    await loadData({ silent: true });
    await loadCharacterDetail(avatar, { force: true });
    showToast('角色头像已替换', avatar);
    render();
}

function updateCharacterFormField(element) {
    const form = element.dataset.characterScope === 'create'
        ? state.characterCreating.form
        : state.characterEditing.form;
    form[element.dataset.characterField] = element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element.value;
}

function defaultGroupForm() {
    return {
        name: '',
        avatar_url: '',
        members: [],
        allow_self_responses: false,
        activation_strategy: '0',
        generation_mode: '0',
        auto_mode_delay: '5',
        fav: false,
    };
}

function groupToForm(group) {
    return {
        ...defaultGroupForm(),
        name: group?.name || '',
        avatar_url: group?.avatar_url || '',
        members: Array.isArray(group?.members) ? [...group.members] : [],
        allow_self_responses: !!group?.allow_self_responses,
        activation_strategy: String(group?.activation_strategy ?? 0),
        generation_mode: String(group?.generation_mode ?? 0),
        auto_mode_delay: String(group?.auto_mode_delay ?? 5),
        fav: !!group?.fav,
    };
}

function groupFormToPayload(form, previous = {}) {
    const members = Array.isArray(form.members) ? form.members : [];
    return {
        ...previous,
        name: form.name.trim() || `群组 ${formatNumber(state.groups.length + 1)}`,
        avatar_url: form.avatar_url.trim() || previous.avatar_url || '',
        members,
        allow_self_responses: !!form.allow_self_responses,
        activation_strategy: numberInput(form.activation_strategy, 0),
        generation_mode: numberInput(form.generation_mode, 0),
        disabled_members: Array.isArray(previous.disabled_members) ? previous.disabled_members.filter(member => members.includes(member)) : [],
        fav: !!form.fav,
        auto_mode_delay: numberInput(form.auto_mode_delay, 5),
    };
}

function clearGroupCache(groupId) {
    if (!groupId) {
        return;
    }

    const contextKey = `group:${groupId}`;
    delete state.chatLists[contextKey];
    Object.keys(state.chatMessages).forEach(key => {
        if (key.startsWith(`${contextKey}::`)) {
            delete state.chatMessages[key];
        }
    });
    Object.keys(state.chatMessageLimits).forEach(key => {
        if (key.startsWith(`${contextKey}::`)) {
            delete state.chatMessageLimits[key];
        }
    });
    Object.keys(state.chatMetadata).forEach(key => {
        if (key.startsWith(`${contextKey}::`)) {
            delete state.chatMetadata[key];
        }
    });
    Object.keys(state.chatDrafts).forEach(key => {
        if (key.startsWith(`${contextKey}::`)) {
            delete state.chatDrafts[key];
        }
    });
}

function beginGroupCreate() {
    state.groupCreating = { active: true, form: defaultGroupForm() };
    state.groupEditing = { id: '', form: {} };
    state.groupDeleteConfirm = { id: '', name: '' };
    render();
}

function cancelGroupCreate() {
    state.groupCreating = { active: false, form: {} };
    render();
}

async function saveGroupCreate() {
    const payload = groupFormToPayload(state.groupCreating.form || defaultGroupForm());
    if (!payload.members.length) {
        throw new Error('群组至少需要一个角色成员。');
    }

    const group = await apiFetch('/api/groups/create', { body: payload });
    state.groupCreating = { active: false, form: {} };
    state.selected.group = group?.id || '';
    state.chatMode = 'group';
    localStorage.setItem('st-modern-chat-mode', 'group');
    state.selected.chat = '';
    await loadData({ silent: true });
    showToast('群组已创建', group?.name || payload.name);
    render();
}

function beginGroupEdit(groupId) {
    const group = state.groups.find(item => item.id === groupId);
    if (!group) {
        return;
    }

    state.groupEditing = { id: groupId, form: groupToForm(group) };
    state.groupCreating = { active: false, form: {} };
    state.groupDeleteConfirm = { id: '', name: '' };
    render();
}

function cancelGroupEdit() {
    state.groupEditing = { id: '', form: {} };
    render();
}

async function saveGroupEdit() {
    const { id, form } = state.groupEditing;
    const group = state.groups.find(item => item.id === id);
    if (!id || !group || state.selected.group !== id) {
        throw new Error('编辑目标已变化，请重新选择群组。');
    }
    if (!Array.isArray(form.members) || !form.members.length) {
        throw new Error('群组至少需要一个角色成员。');
    }

    const payload = groupFormToPayload(form, group);
    await apiFetch('/api/groups/edit', { body: payload });
    clearGroupCache(id);
    state.groupEditing = { id: '', form: {} };
    await loadData({ silent: true });
    showToast('群组已保存', payload.name);
    render();
}

function beginGroupDelete(group) {
    state.groupDeleteConfirm = {
        id: group.id,
        name: group.name || group.id,
    };
    state.groupEditing = { id: '', form: {} };
    render();
}

function cancelGroupDelete() {
    state.groupDeleteConfirm = { id: '', name: '' };
    render();
}

async function confirmGroupDelete() {
    const { id } = state.groupDeleteConfirm;
    if (!id || state.selected.group !== id) {
        throw new Error('删除目标已变化，请重新选择群组。');
    }

    await apiFetch('/api/groups/delete', { body: { id } });
    clearGroupCache(id);
    state.groupDeleteConfirm = { id: '', name: '' };
    state.groupEditing = { id: '', form: {} };
    state.selected.group = '';
    state.selected.chat = '';
    await loadData({ silent: true });
    ensureAvailableChatMode();
    showToast('群组已删除', id);
    render();
}

function updateGroupFormField(element) {
    const form = element.dataset.groupScope === 'create'
        ? state.groupCreating.form
        : state.groupEditing.form;
    form[element.dataset.groupField] = element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element.value;
}

function toggleGroupFormMember(scope, avatar, checked) {
    const form = scope === 'create' ? state.groupCreating.form : state.groupEditing.form;
    const members = new Set(Array.isArray(form.members) ? form.members : []);
    if (checked) {
        members.add(avatar);
    } else {
        members.delete(avatar);
    }
    form.members = [...members];
    render();
}

function getPowerUserSettingsForWrite() {
    const source = state.settings.power_user || state.settings;
    source.personas = source.personas || {};
    source.persona_descriptions = source.persona_descriptions || {};
    return source;
}

function defaultPersonaForm() {
    return { name: '', title: '', description: '' };
}

function beginPersonaCreate() {
    state.personaCreating = { active: true, form: defaultPersonaForm(), file: null };
    state.personaEditing = { avatarId: '', form: {} };
    state.personaDeleteConfirm = { avatarId: '' };
    render();
}

function cancelPersonaCreate() {
    state.personaCreating = { active: false, form: defaultPersonaForm(), file: null };
    render();
}

async function uploadPersonaAvatarFile(file, overwriteName = '') {
    if (!file) {
        throw new Error('请选择头像图片。');
    }

    const formData = new FormData();
    formData.append('avatar', file, file.name);
    if (overwriteName) {
        formData.append('overwrite_name', overwriteName);
    }

    const result = await apiFetch('/api/avatars/upload', { body: formData, omitContentType: true });
    return result?.path || overwriteName;
}

async function savePersonaCreate() {
    const { form, file } = state.personaCreating;
    const name = form.name.trim();
    if (!name) {
        throw new Error('人设名称不能为空。');
    }
    if (!file) {
        throw new Error('请先选择头像图片。');
    }

    const avatarId = await uploadPersonaAvatarFile(file);
    const powerUser = getPowerUserSettingsForWrite();
    powerUser.personas[avatarId] = name;
    powerUser.persona_descriptions[avatarId] = {
        title: form.title || '',
        description: form.description || '',
    };
    if (!powerUser.default_persona) {
        powerUser.default_persona = avatarId;
    }
    await apiFetch('/api/settings/save', { body: state.settings });
    state.personaCreating = { active: false, form: defaultPersonaForm(), file: null };
    await loadData({ silent: true });
    showToast('用户人设已创建', name);
    render();
}

function beginPersonaEdit(persona) {
    state.personaEditing = {
        avatarId: persona.avatarId,
        form: {
            name: persona.name || '',
            title: persona.title || '',
            description: persona.description || '',
        },
    };
    state.personaCreating = { active: false, form: defaultPersonaForm(), file: null };
    state.personaDeleteConfirm = { avatarId: '' };
    render();
}

function cancelPersonaEdit() {
    state.personaEditing = { avatarId: '', form: {} };
    render();
}

async function savePersonaEdit() {
    const { avatarId, form } = state.personaEditing;
    if (!avatarId) {
        throw new Error('请选择要编辑的用户人设。');
    }
    if (!form.name?.trim()) {
        throw new Error('人设名称不能为空。');
    }

    const powerUser = getPowerUserSettingsForWrite();
    powerUser.personas[avatarId] = form.name.trim();
    powerUser.persona_descriptions[avatarId] = {
        ...(powerUser.persona_descriptions[avatarId] || {}),
        title: form.title || '',
        description: form.description || '',
    };
    await apiFetch('/api/settings/save', { body: state.settings });
    state.personaEditing = { avatarId: '', form: {} };
    await loadData({ silent: true });
    showToast('用户人设已保存', form.name.trim());
    render();
}

async function setDefaultPersona(avatarId) {
    const powerUser = getPowerUserSettingsForWrite();
    if (!powerUser.personas[avatarId]) {
        throw new Error('用户人设不存在，请刷新后重试。');
    }

    powerUser.default_persona = avatarId;
    await apiFetch('/api/settings/save', { body: state.settings });
    await loadData({ silent: true });
    showToast('默认人设已更新', powerUser.personas[avatarId]);
    render();
}

function beginPersonaDelete(avatarId) {
    state.personaDeleteConfirm = { avatarId };
    state.personaEditing = { avatarId: '', form: {} };
    render();
}

function cancelPersonaDelete() {
    state.personaDeleteConfirm = { avatarId: '' };
    render();
}

async function confirmPersonaDelete() {
    const { avatarId } = state.personaDeleteConfirm;
    if (!avatarId) {
        throw new Error('请选择要删除的用户人设。');
    }

    const powerUser = getPowerUserSettingsForWrite();
    const name = powerUser.personas[avatarId] || avatarId;
    await apiFetch('/api/avatars/delete', { body: { avatar: avatarId } });
    delete powerUser.personas[avatarId];
    delete powerUser.persona_descriptions[avatarId];
    if (powerUser.default_persona === avatarId) {
        powerUser.default_persona = null;
    }
    await apiFetch('/api/settings/save', { body: state.settings });
    state.personaDeleteConfirm = { avatarId: '' };
    state.personaEditing = { avatarId: '', form: {} };
    await loadData({ silent: true });
    showToast('用户人设已删除', name);
    render();
}

async function replacePersonaAvatar(avatarId, file) {
    if (!avatarId) {
        throw new Error('请选择要替换头像的用户人设。');
    }
    await uploadPersonaAvatarFile(file, avatarId);
    await loadData({ silent: true });
    showToast('头像已替换', avatarId);
    render();
}

function updatePersonaFormField(element) {
    const form = element.dataset.personaScope === 'create' ? state.personaCreating.form : state.personaEditing.form;
    form[element.dataset.personaField] = element.value;
}

function getBackgroundUrl(filename) {
    return `/backgrounds/${String(filename || '').split('/').map(part => encodeURIComponent(part)).join('/')}`;
}

function getBackgroundFilename(background) {
    return typeof background === 'string' ? background : background?.filename || '';
}

function getBackgroundFolderData() {
    return {
        folders: Array.isArray(state.backgroundFolders?.folders) ? state.backgroundFolders.folders : [],
        imageFolderMap: state.backgroundFolders?.imageFolderMap || {},
    };
}

function getBackgroundFolderById(folderId) {
    return getBackgroundFolderData().folders.find(folder => folder.id === folderId) || null;
}

function getBackgroundFolderIds(filename) {
    const map = getBackgroundFolderData().imageFolderMap;
    return Array.isArray(map[filename]) ? map[filename] : [];
}

function getBackgroundFoldersFor(filename) {
    return getBackgroundFolderIds(filename).map(getBackgroundFolderById).filter(Boolean);
}

function getBackgroundFolderCounts() {
    const counts = {};
    for (const folder of getBackgroundFolderData().folders) {
        counts[folder.id] = 0;
    }
    for (const folderIds of Object.values(getBackgroundFolderData().imageFolderMap)) {
        for (const folderId of new Set(Array.isArray(folderIds) ? folderIds : [])) {
            counts[folderId] = (counts[folderId] || 0) + 1;
        }
    }
    return counts;
}

async function uploadBackgroundFile(file) {
    if (!file) {
        return;
    }

    const formData = new FormData();
    formData.set('avatar', file, file.name);
    const filename = await apiFetch('/api/backgrounds/upload', { body: formData, omitContentType: true });
    await loadData({ silent: true });
    showToast('背景已上传', filename || file.name);
    render();
}

function setBackgroundFolderFilter(folderId) {
    state.backgroundFolderFilter = folderId && getBackgroundFolderById(folderId) ? folderId : '';
    state.backgroundVisibleCount = backgroundPageSize;
    render();
}

function showMoreBackgrounds() {
    state.backgroundVisibleCount += backgroundPageSize;
    render();
}

function toggleBackgroundFolderCreate(active = !state.backgroundFolderCreating.active) {
    state.backgroundFolderCreating = {
        active,
        name: active ? state.backgroundFolderCreating.name : '',
        running: false,
    };
    render();
}

async function createBackgroundFolder() {
    const name = state.backgroundFolderCreating.name.trim();
    if (!name) {
        throw new Error('请输入背景文件夹名称。');
    }

    state.backgroundFolderCreating.running = true;
    render();
    try {
        const folder = await apiFetch('/api/image-metadata/folders/create', { body: { name } });
        state.backgroundFolderCreating = { active: false, name: '', running: false };
        state.backgroundFolderFilter = folder?.id || '';
        state.backgroundFolderAssignment = folder?.id || '';
        await loadData({ silent: true });
        showToast('背景文件夹已创建', folder?.name || name);
    } finally {
        state.backgroundFolderCreating.running = false;
        render();
    }
}

function beginBackgroundFolderRename(folderId) {
    const folder = getBackgroundFolderById(folderId);
    if (!folder) {
        throw new Error('背景文件夹不存在，请刷新后重试。');
    }
    state.backgroundFolderRenaming = { id: folder.id, name: folder.name || '', running: false };
    state.backgroundFolderDeleteConfirm = { id: '', running: false };
    render();
}

function cancelBackgroundFolderRename() {
    state.backgroundFolderRenaming = { id: '', name: '', running: false };
    render();
}

async function confirmBackgroundFolderRename() {
    const { id, name } = state.backgroundFolderRenaming;
    const nextName = name.trim();
    if (!id || !getBackgroundFolderById(id)) {
        throw new Error('背景文件夹不存在，请刷新后重试。');
    }
    if (!nextName) {
        throw new Error('请输入背景文件夹名称。');
    }

    state.backgroundFolderRenaming.running = true;
    render();
    try {
        await apiFetch('/api/image-metadata/folders/update', { body: { id, name: nextName } });
        state.backgroundFolderRenaming = { id: '', name: '', running: false };
        await loadData({ silent: true });
        showToast('背景文件夹已重命名', nextName);
    } finally {
        state.backgroundFolderRenaming.running = false;
        render();
    }
}

function beginBackgroundFolderDelete(folderId) {
    const folder = getBackgroundFolderById(folderId);
    if (!folder) {
        throw new Error('背景文件夹不存在，请刷新后重试。');
    }
    state.backgroundFolderDeleteConfirm = { id: folder.id, running: false };
    state.backgroundFolderRenaming = { id: '', name: '', running: false };
    render();
}

function cancelBackgroundFolderDelete() {
    state.backgroundFolderDeleteConfirm = { id: '', running: false };
    render();
}

async function confirmBackgroundFolderDelete() {
    const { id } = state.backgroundFolderDeleteConfirm;
    const folder = getBackgroundFolderById(id);
    if (!folder) {
        throw new Error('背景文件夹不存在，请刷新后重试。');
    }

    state.backgroundFolderDeleteConfirm.running = true;
    render();
    try {
        await apiFetch('/api/image-metadata/folders/delete', { body: { id } });
        if (state.backgroundFolderFilter === id) {
            state.backgroundFolderFilter = '';
        }
        if (state.backgroundFolderAssignment === id) {
            state.backgroundFolderAssignment = '';
        }
        state.backgroundFolderDeleteConfirm = { id: '', running: false };
        await loadData({ silent: true });
        showToast('背景文件夹已删除', `${folder.name}，背景图片未删除。`);
    } finally {
        state.backgroundFolderDeleteConfirm.running = false;
        render();
    }
}

async function assignSelectedBackgroundsToFolder(remove = false) {
    const folderId = state.backgroundFolderAssignment || state.backgroundFolderFilter;
    const folder = getBackgroundFolderById(folderId);
    const filenames = [...state.backgroundSelection.filenames];
    if (!folder) {
        throw new Error('请选择目标背景文件夹。');
    }
    if (!filenames.length) {
        throw new Error('请选择要处理的背景。');
    }

    const endpoint = remove ? '/api/image-metadata/folders/unassign' : '/api/image-metadata/folders/assign';
    await apiFetch(endpoint, {
        body: {
            id: folder.id,
            paths: filenames.map(filename => `backgrounds/${filename}`),
        },
    });
    await loadData({ silent: true });
    showToast(remove ? '已移出背景文件夹' : '已加入背景文件夹', `${formatNumber(filenames.length)} 个背景 · ${folder.name}`);
    render();
}

function beginBackgroundRename(filename) {
    state.backgroundRenaming = { filename, name: filename, running: false };
    state.backgroundSelection.deleteConfirm = false;
    render();
}

function cancelBackgroundRename() {
    state.backgroundRenaming = { filename: '', name: '', running: false };
    render();
}

async function confirmBackgroundRename() {
    const oldName = state.backgroundRenaming.filename;
    const newName = state.backgroundRenaming.name.trim();
    if (!oldName || !newName) {
        throw new Error('请输入新的背景文件名。');
    }
    if (oldName === newName) {
        cancelBackgroundRename();
        return;
    }

    state.backgroundRenaming.running = true;
    render();
    try {
        await apiFetch('/api/backgrounds/rename', { body: { old_bg: oldName, new_bg: newName } });
        state.backgroundRenaming = { filename: '', name: '', running: false };
        await loadData({ silent: true });
        showToast('背景已重命名', `${oldName} → ${newName}`);
    } finally {
        state.backgroundRenaming.running = false;
        render();
    }
}

function setBackgroundSelectionMode(active) {
    state.backgroundSelection = {
        active,
        filenames: active ? state.backgroundSelection.filenames : [],
        deleteConfirm: false,
        deleting: false,
    };
    render();
}

function toggleBackgroundSelection(filename, checked) {
    const names = new Set(state.backgroundSelection.filenames);
    if (checked) {
        names.add(filename);
    } else {
        names.delete(filename);
    }
    state.backgroundSelection.filenames = [...names];
    state.backgroundSelection.deleteConfirm = false;
    render();
}

function beginBackgroundBatchDelete() {
    if (!state.backgroundSelection.filenames.length) {
        throw new Error('请选择要删除的背景。');
    }
    state.backgroundSelection.deleteConfirm = true;
    render();
}

function cancelBackgroundDelete() {
    state.backgroundSelection.deleteConfirm = false;
    render();
}

async function confirmBackgroundDelete() {
    const filenames = [...state.backgroundSelection.filenames];
    if (!filenames.length) {
        throw new Error('请选择要删除的背景。');
    }

    state.backgroundSelection.deleting = true;
    render();
    for (const filename of filenames) {
        await apiFetch('/api/backgrounds/delete', { body: { bg: filename } });
    }
    state.backgroundSelection = { active: false, filenames: [], deleteConfirm: false, deleting: false };
    await loadData({ silent: true });
    showToast('背景已删除', `${formatNumber(filenames.length)} 个文件`);
    render();
}

function toggleAssetDownload(active = !state.assetDownload.active) {
    state.assetDownload = {
        active,
        url: active ? state.assetDownload.url : '',
        category: active ? state.assetDownload.category : 'bgm',
        filename: active ? state.assetDownload.filename : '',
        running: false,
    };
    render();
}

function toggleAssetGroup(name) {
    const groups = new Set(state.assetExpandedGroups);
    if (groups.has(name)) {
        groups.delete(name);
    } else {
        groups.add(name);
    }
    state.assetExpandedGroups = [...groups];
    render();
}

async function downloadAssetFromForm() {
    const url = state.assetDownload.url.trim();
    const filename = state.assetDownload.filename.trim();
    const category = state.assetDownload.category;
    if (!url || !filename) {
        throw new Error('请输入资产 URL 和文件名。');
    }

    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('资产 URL 只支持 HTTP 或 HTTPS。');
    }

    state.assetDownload.running = true;
    render();
    try {
        await apiFetch('/api/assets/download', { body: { url, category, filename } });
        state.assetDownload = { active: false, url: '', category: 'bgm', filename: '', running: false };
        await loadData({ silent: true });
        showToast('资产已下载', `${category}/${filename}`);
    } finally {
        state.assetDownload.running = false;
        render();
    }
}

function beginAssetDelete(category, filename) {
    state.assetDeleteConfirm = { category, filename, running: false };
    render();
}

function cancelAssetDelete() {
    state.assetDeleteConfirm = { category: '', filename: '', running: false };
    render();
}

async function confirmAssetDelete() {
    const { category, filename } = state.assetDeleteConfirm;
    if (!category || !filename) {
        throw new Error('请选择要删除的资产文件。');
    }

    state.assetDeleteConfirm.running = true;
    render();
    try {
        await apiFetch('/api/assets/delete', { body: { category, filename } });
        state.assetDeleteConfirm = { category: '', filename: '', running: false };
        await loadData({ silent: true });
        showToast('资产已删除', `${category}/${filename}`);
    } finally {
        state.assetDeleteConfirm.running = false;
        render();
    }
}

async function recreateStats() {
    await apiFetch('/api/stats/recreate');
    await loadData({ silent: true });
    showToast('统计已重建', '已重新扫描聊天文件。');
    render();
}

function getGlobalWorldNames() {
    return state.settings.world_info_settings?.world_info?.globalSelect || [];
}

function isGlobalWorldEnabled(worldbookId) {
    return getGlobalWorldNames().includes(worldbookId);
}

async function toggleGlobalWorld(worldbookId) {
    if (!worldbookId) {
        return;
    }

    state.settings.world_info_settings = state.settings.world_info_settings || {};
    state.settings.world_info_settings.world_info = state.settings.world_info_settings.world_info || {};
    const globalWorlds = getGlobalWorldNames();
    const nextGlobalWorlds = globalWorlds.includes(worldbookId)
        ? globalWorlds.filter(name => name !== worldbookId)
        : [...globalWorlds, worldbookId];

    state.settings.world_info_settings.world_info.globalSelect = nextGlobalWorlds;
    await apiFetch('/api/settings/save', { body: state.settings });
    await loadData({ silent: true });
    showToast(nextGlobalWorlds.includes(worldbookId) ? '世界书已启用' : '世界书已停用', worldbookId);
}

async function toggleWorldEntry(worldbookId, entryKey) {
    if (!worldbookId || entryKey === undefined) {
        return;
    }

    await loadWorldDetail(worldbookId);
    const detail = state.worldDetails[worldbookId];
    const nextDetail = structuredClone(detail);
    const entry = nextDetail?.entries?.[entryKey];
    if (!entry) {
        throw new Error('世界书条目不存在，请刷新后重试。');
    }

    entry.disable = !entry.disable;
    syncWorldEntryOriginalData(nextDetail, Number(entryKey), entry);
    await saveWorldbookDetail(worldbookId, nextDetail);
    showToast(entry.disable ? '条目已禁用' : '条目已启用', entry.comment || entry.name || entryKey);
    render();
}

function getWorldEntryListState(worldbookId) {
    if (state.worldEntryList.worldbookId !== worldbookId) {
        state.worldEntryList = { worldbookId, query: '', sort: 'order', page: 1, selectedKeys: [] };
    }
    return state.worldEntryList;
}

function updateWorldEntryListField(field, value) {
    state.worldEntryList[field] = value;
    if (field === 'query' || field === 'sort') {
        state.worldEntryList.page = 1;
    }
    render();
}

function setWorldEntryPage(page) {
    state.worldEntryList.page = Math.max(1, Number(page) || 1);
    render();
}

function toggleWorldEntrySelection(entryKey, checked) {
    const keys = new Set(state.worldEntryList.selectedKeys);
    if (checked) {
        keys.add(String(entryKey));
    } else {
        keys.delete(String(entryKey));
    }
    state.worldEntryList.selectedKeys = [...keys];
    render();
}

function getWorldEntrySearchText(entryKey, entry) {
    return normalizeText([
        entryKey,
        entry?.comment,
        entry?.name,
        Array.isArray(entry?.key) ? entry.key.join(', ') : entry?.key,
        Array.isArray(entry?.keysecondary) ? entry.keysecondary.join(', ') : entry?.keysecondary,
        entry?.content,
    ].filter(Boolean).join(' '));
}

function sortWorldEntries(entries, sort) {
    const sortedEntries = [...entries];
    sortedEntries.sort(([leftKey, leftEntry], [rightKey, rightEntry]) => {
        if (sort === 'comment') {
            return getWorldEntryTitle(leftEntry, leftKey).localeCompare(getWorldEntryTitle(rightEntry, rightKey), 'zh-Hans-CN');
        }
        if (sort === 'status') {
            return Number(!!leftEntry.disable) - Number(!!rightEntry.disable) || Number(leftKey) - Number(rightKey);
        }
        if (sort === 'key') {
            const leftValue = Array.isArray(leftEntry.key) ? leftEntry.key.join(', ') : String(leftEntry.key || '');
            const rightValue = Array.isArray(rightEntry.key) ? rightEntry.key.join(', ') : String(rightEntry.key || '');
            return leftValue.localeCompare(rightValue, 'zh-Hans-CN') || Number(leftKey) - Number(rightKey);
        }
        return Number(leftEntry.order ?? 0) - Number(rightEntry.order ?? 0) || Number(leftKey) - Number(rightKey);
    });
    return sortedEntries;
}

function getVisibleWorldEntries(entries, listState) {
    const query = normalizeText(listState.query);
    const filteredEntries = query
        ? entries.filter(([entryKey, entry]) => getWorldEntrySearchText(entryKey, entry).includes(query))
        : entries;
    return sortWorldEntries(filteredEntries, listState.sort);
}

async function setSelectedWorldEntriesDisabled(worldbookId, disabled) {
    const selectedKeys = [...state.worldEntryList.selectedKeys];
    if (!selectedKeys.length) {
        throw new Error('请先选择世界书条目。');
    }

    await loadWorldDetail(worldbookId);
    const detail = state.worldDetails[worldbookId];
    const nextDetail = structuredClone(detail);
    let changedCount = 0;
    for (const entryKey of selectedKeys) {
        const entry = nextDetail?.entries?.[entryKey];
        if (!entry || entry.disable === disabled) {
            continue;
        }
        entry.disable = disabled;
        syncWorldEntryOriginalData(nextDetail, Number(entryKey), entry);
        changedCount++;
    }
    if (!changedCount) {
        showToast('条目未变更', disabled ? '所选条目已经禁用。' : '所选条目已经启用。');
        return;
    }

    await saveWorldbookDetail(worldbookId, nextDetail);
    state.worldEntryList.selectedKeys = [];
    showToast(disabled ? '条目已批量禁用' : '条目已批量启用', `${formatNumber(changedCount)} 个条目`);
    render();
}

function beginWorldEntryBulkDelete(worldbookId) {
    if (!state.worldEntryList.selectedKeys.length) {
        throw new Error('请先选择世界书条目。');
    }

    state.worldEntryBulkDeleteConfirm = { worldbookId };
    state.worldEntryDeleteConfirm = { worldbookId: '', entryKey: '' };
    state.worldEntryEditing = { worldbookId: '', entryKey: '', mode: '', form: {} };
    render();
}

function cancelWorldEntryBulkDelete() {
    state.worldEntryBulkDeleteConfirm = { worldbookId: '' };
    render();
}

async function confirmWorldEntryBulkDelete() {
    const worldbookId = state.worldEntryBulkDeleteConfirm.worldbookId;
    const selectedKeys = [...state.worldEntryList.selectedKeys];
    if (!worldbookId || !selectedKeys.length) {
        throw new Error('请先选择世界书条目。');
    }

    await loadWorldDetail(worldbookId);
    const detail = state.worldDetails[worldbookId];
    const nextDetail = structuredClone(detail);
    let deletedCount = 0;
    for (const entryKey of selectedKeys) {
        if (!nextDetail?.entries?.[entryKey]) {
            continue;
        }
        delete nextDetail.entries[entryKey];
        deleteWorldEntryOriginalData(nextDetail, entryKey);
        deletedCount++;
    }
    if (!deletedCount) {
        throw new Error('所选条目已经不存在，请刷新后重试。');
    }

    await saveWorldbookDetail(worldbookId, nextDetail);
    state.worldEntryList.selectedKeys = [];
    state.worldEntryBulkDeleteConfirm = { worldbookId: '' };
    showToast('条目已批量删除', `${formatNumber(deletedCount)} 个条目`);
    render();
}

function getWorldEntryTitle(entry, entryKey) {
    return entry?.comment || entry?.name || (Array.isArray(entry?.key) ? entry.key.join(', ') : '') || `条目 ${entryKey}`;
}

function getFreeWorldEntryUid(detail) {
    if (!detail?.entries) {
        return null;
    }

    for (let uid = 0; uid < 1_000_000; uid++) {
        if (!(uid in detail.entries)) {
            return uid;
        }
    }

    return null;
}

function createWorldEntry(uid) {
    return {
        uid,
        ...structuredClone(worldEntryDefaults),
    };
}

function worldEntryToForm(entry) {
    return {
        key: arrayToEntryInput(entry?.key),
        keysecondary: arrayToEntryInput(entry?.keysecondary),
        comment: entry?.comment || '',
        content: entry?.content || '',
        order: String(entry?.order ?? worldEntryDefaults.order),
        position: String(entry?.position ?? worldEntryDefaults.position),
        depth: String(entry?.depth ?? worldEntryDefaults.depth),
        role: entry?.role == null ? '' : String(entry.role),
        probability: String(entry?.probability ?? worldEntryDefaults.probability),
        selectiveLogic: String(entry?.selectiveLogic ?? worldEntryDefaults.selectiveLogic),
        scanDepth: entry?.scanDepth == null ? '' : String(entry.scanDepth),
        caseSensitive: entry?.caseSensitive == null ? '' : String(Boolean(entry.caseSensitive)),
        matchWholeWords: entry?.matchWholeWords == null ? '' : String(Boolean(entry.matchWholeWords)),
        useGroupScoring: entry?.useGroupScoring == null ? '' : String(Boolean(entry.useGroupScoring)),
        constant: !!entry?.constant,
        vectorized: !!entry?.vectorized,
        selective: entry?.selective !== false,
        addMemo: !!entry?.addMemo,
        useProbability: entry?.useProbability !== false,
        disable: !!entry?.disable,
        ignoreBudget: !!entry?.ignoreBudget,
        excludeRecursion: !!entry?.excludeRecursion,
        preventRecursion: !!entry?.preventRecursion,
    };
}

function nullableBooleanInput(value) {
    if (value === '' || value == null) {
        return null;
    }

    return value === true || value === 'true';
}

function nullableNumberInput(value) {
    if (value === '' || value == null) {
        return null;
    }

    return numberInput(value, null);
}

function formToWorldEntry(form, uid, previous = {}) {
    return {
        ...previous,
        uid,
        key: entryInputToArray(form.key),
        keysecondary: entryInputToArray(form.keysecondary),
        comment: String(form.comment || ''),
        content: String(form.content || ''),
        order: numberInput(form.order, worldEntryDefaults.order),
        position: numberInput(form.position, worldEntryDefaults.position),
        depth: numberInput(form.depth, worldEntryDefaults.depth),
        role: form.role === '' ? null : numberInput(form.role, worldEntryDefaults.role),
        probability: Math.max(0, Math.min(100, numberInput(form.probability, worldEntryDefaults.probability))),
        selectiveLogic: numberInput(form.selectiveLogic, worldEntryDefaults.selectiveLogic),
        scanDepth: nullableNumberInput(form.scanDepth),
        caseSensitive: nullableBooleanInput(form.caseSensitive),
        matchWholeWords: nullableBooleanInput(form.matchWholeWords),
        useGroupScoring: nullableBooleanInput(form.useGroupScoring),
        constant: !!form.constant,
        vectorized: !!form.vectorized,
        selective: !!form.selective,
        addMemo: !!form.addMemo,
        useProbability: !!form.useProbability,
        disable: !!form.disable,
        ignoreBudget: !!form.ignoreBudget,
        excludeRecursion: !!form.excludeRecursion,
        preventRecursion: !!form.preventRecursion,
    };
}

function syncWorldEntryOriginalData(detail, uid, entry) {
    if (!detail?.originalData || !Array.isArray(detail.originalData.entries)) {
        return;
    }

    const originalEntry = detail.originalData.entries.find(item => item.uid === uid);
    if (!originalEntry) {
        return;
    }

    const fieldMap = {
        comment: ['comment', entry.comment],
        content: ['content', entry.content],
        constant: ['constant', entry.constant],
        order: ['insertion_order', entry.order],
        depth: ['extensions.depth', entry.depth],
        probability: ['extensions.probability', entry.probability],
        position: ['extensions.position', entry.position],
        role: ['extensions.role', entry.role],
        key: ['keys', entry.key],
        keysecondary: ['secondary_keys', entry.keysecondary],
        selective: ['selective', entry.selective],
        selectiveLogic: ['selectiveLogic', entry.selectiveLogic],
        addMemo: ['addMemo', entry.addMemo],
        vectorized: ['extensions.vectorized', entry.vectorized],
        scanDepth: ['extensions.scan_depth', entry.scanDepth],
        caseSensitive: ['extensions.case_sensitive', entry.caseSensitive],
        matchWholeWords: ['extensions.match_whole_words', entry.matchWholeWords],
        useGroupScoring: ['extensions.use_group_scoring', entry.useGroupScoring],
        ignoreBudget: ['extensions.ignore_budget', entry.ignoreBudget],
        excludeRecursion: ['extensions.exclude_recursion', entry.excludeRecursion],
        preventRecursion: ['extensions.prevent_recursion', entry.preventRecursion],
        enabled: ['enabled', !entry.disable],
    };

    for (const [path, value] of Object.values(fieldMap)) {
        setObjectPath(originalEntry, path, value);
    }
}

function deleteWorldEntryOriginalData(detail, entryKey) {
    if (!detail?.originalData || !Array.isArray(detail.originalData.entries)) {
        return;
    }

    const originalIndex = detail.originalData.entries.findIndex(item => item.uid == entryKey);
    if (originalIndex >= 0) {
        detail.originalData.entries.splice(originalIndex, 1);
    }
}

async function saveWorldbookDetail(worldbookId, detail) {
    await apiFetch('/api/worldinfo/edit', { body: { name: worldbookId, data: detail } });
    state.worldDetails[worldbookId] = detail;
}

function beginWorldbookCreate() {
    state.worldbookCreating = { active: true, name: '' };
    render();
}

function cancelWorldbookCreate() {
    state.worldbookCreating = { active: false, name: '' };
    render();
}

async function saveWorldbookCreate() {
    const name = state.worldbookCreating.name.trim();
    if (!name) {
        throw new Error('世界书名称不能为空。');
    }
    const exists = state.worldbooks.some(worldbook => worldbook.file_id === name) || (state.settingsBundle.world_names || []).includes(name);
    if (exists) {
        throw new Error('同名世界书已存在。');
    }

    const detail = { name, entries: {}, extensions: {} };
    await apiFetch('/api/worldinfo/edit', { body: { name, data: detail } });
    delete state.worldDetails[name];
    state.worldbookCreating = { active: false, name: '' };
    state.selected.worldbook = name;
    await loadData({ silent: true });
    await loadWorldDetail(name);
    showToast('世界书已创建', `${name}.json`);
    render();
}

async function importWorldbookFile(file) {
    if (!file) {
        return;
    }
    if (!file.name.toLowerCase().endsWith('.json')) {
        throw new Error('现代页暂只支持导入标准 JSON 世界书。');
    }

    const worldName = file.name.replace(/\.json$/i, '');
    if (state.worldbooks.some(worldbook => worldbook.file_id === worldName)) {
        throw new Error('同名世界书已存在，请先重命名文件或删除旧世界书。');
    }

    const formData = new FormData();
    formData.append('avatar', file);
    const result = await apiFetch('/api/worldinfo/import', { body: formData, omitContentType: true });
    const importedName = result?.name || worldName;
    state.selected.worldbook = importedName;
    delete state.worldDetails[importedName];
    await loadData({ silent: true });
    await loadWorldDetail(importedName);
    showToast('世界书已导入', `${importedName}.json`);
    render();
}

async function exportWorldbook(worldbookId) {
    if (!worldbookId) {
        throw new Error('请先选择世界书。');
    }

    await loadWorldDetail(worldbookId);
    const detail = state.worldDetails[worldbookId];
    if (!detail) {
        throw new Error('世界书内容读取失败。');
    }

    downloadFile(JSON.stringify(detail, null, 2), `${worldbookId}.json`, 'application/json');
    showToast('世界书导出已开始', `${worldbookId}.json`);
}

function beginWorldbookDelete(worldbookId) {
    state.worldbookDeleteConfirm = { worldbookId };
    state.worldEntryDeleteConfirm = { worldbookId: '', entryKey: '' };
    render();
}

function cancelWorldbookDelete() {
    state.worldbookDeleteConfirm = { worldbookId: '' };
    render();
}

async function confirmWorldbookDelete() {
    const worldbookId = state.worldbookDeleteConfirm.worldbookId;
    if (!worldbookId || state.selected.worldbook !== worldbookId) {
        throw new Error('删除目标已变化，请重新选择世界书。');
    }

    await apiFetch('/api/worldinfo/delete', { body: { name: worldbookId } });
    delete state.worldDetails[worldbookId];
    state.worldbookDeleteConfirm = { worldbookId: '' };
    state.worldEntryEditing = { worldbookId: '', entryKey: '', mode: '', form: {} };
    state.worldEntryDeleteConfirm = { worldbookId: '', entryKey: '' };
    const globalWorlds = getGlobalWorldNames();
    if (globalWorlds.includes(worldbookId)) {
        state.settings.world_info_settings.world_info.globalSelect = globalWorlds.filter(name => name !== worldbookId);
        await apiFetch('/api/settings/save', { body: state.settings });
    }
    state.selected.worldbook = '';
    await loadData({ silent: true });
    showToast('世界书已删除', `${worldbookId}.json`);
}

async function beginWorldEntryCreate(worldbookId) {
    await loadWorldDetail(worldbookId);
    const detail = state.worldDetails[worldbookId];
    detail.entries = detail.entries || {};
    const uid = getFreeWorldEntryUid(detail);
    if (!Number.isInteger(uid)) {
        showToast('新增失败', '无法分配世界书条目 UID。');
        return;
    }

    state.worldEntryEditing = {
        worldbookId,
        entryKey: String(uid),
        mode: 'create',
        form: worldEntryToForm(createWorldEntry(uid)),
    };
    state.worldEntryDeleteConfirm = { worldbookId: '', entryKey: '' };
    render();
}

async function beginWorldEntryEdit(worldbookId, entryKey) {
    await loadWorldDetail(worldbookId);
    const entry = state.worldDetails[worldbookId]?.entries?.[entryKey];
    if (!entry) {
        showToast('编辑失败', '世界书条目不存在，请刷新后重试。');
        return;
    }

    state.worldEntryEditing = {
        worldbookId,
        entryKey,
        mode: 'edit',
        form: worldEntryToForm(entry),
    };
    state.worldEntryDeleteConfirm = { worldbookId: '', entryKey: '' };
    render();
}

function cancelWorldEntryEdit() {
    state.worldEntryEditing = { worldbookId: '', entryKey: '', mode: '', form: {} };
    render();
}

async function saveWorldEntryEdit() {
    const edit = state.worldEntryEditing;
    const form = edit.form || {};
    if (!edit.worldbookId || edit.entryKey === '') {
        throw new Error('世界书条目目标无效。');
    }

    await loadWorldDetail(edit.worldbookId);
    const detail = state.worldDetails[edit.worldbookId];
    const nextDetail = structuredClone(detail);
    const uid = Number(edit.entryKey);
    const entry = nextDetail?.entries?.[edit.entryKey];
    if (edit.mode !== 'create' && !entry) {
        throw new Error('世界书条目不存在，请刷新后重试。');
    }

    nextDetail.entries = nextDetail.entries || {};
    nextDetail.entries[edit.entryKey] = formToWorldEntry(form, uid, entry || createWorldEntry(uid));
    syncWorldEntryOriginalData(nextDetail, uid, nextDetail.entries[edit.entryKey]);
    await saveWorldbookDetail(edit.worldbookId, nextDetail);
    state.worldEntryEditing = { worldbookId: '', entryKey: '', mode: '', form: {} };
    showToast(edit.mode === 'create' ? '条目已创建' : '条目已保存', getWorldEntryTitle(nextDetail.entries[edit.entryKey], edit.entryKey));
    render();
}

async function duplicateWorldEntry(worldbookId, entryKey) {
    await loadWorldDetail(worldbookId);
    const detail = state.worldDetails[worldbookId];
    const source = detail?.entries?.[entryKey];
    const uid = getFreeWorldEntryUid(detail);
    if (!source || !Number.isInteger(uid)) {
        throw new Error('无法复制这个世界书条目。');
    }

    const nextDetail = structuredClone(detail);
    const copiedEntry = structuredClone(source);
    copiedEntry.uid = uid;
    nextDetail.entries[String(uid)] = copiedEntry;
    await saveWorldbookDetail(worldbookId, nextDetail);
    showToast('条目已复制', getWorldEntryTitle(copiedEntry, uid));
    render();
}

function beginWorldEntryDelete(worldbookId, entryKey) {
    state.worldEntryDeleteConfirm = { worldbookId, entryKey };
    state.worldEntryEditing = { worldbookId: '', entryKey: '', mode: '', form: {} };
    render();
}

function cancelWorldEntryDelete() {
    state.worldEntryDeleteConfirm = { worldbookId: '', entryKey: '' };
    render();
}

function updateWorldEntryFormField(element) {
    if (!state.worldEntryEditing.worldbookId) {
        return;
    }

    const field = element.dataset.worldEntryField;
    if (!field) {
        return;
    }

    state.worldEntryEditing.form = state.worldEntryEditing.form || {};
    state.worldEntryEditing.form[field] = element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element.value;
}

async function confirmWorldEntryDelete() {
    const { worldbookId, entryKey } = state.worldEntryDeleteConfirm;
    if (!worldbookId || entryKey === '') {
        throw new Error('删除目标已变化，请重新选择条目。');
    }

    await loadWorldDetail(worldbookId);
    const detail = state.worldDetails[worldbookId];
    const entry = detail?.entries?.[entryKey];
    if (!entry) {
        throw new Error('世界书条目不存在，请刷新后重试。');
    }

    const nextDetail = structuredClone(detail);
    delete nextDetail.entries[entryKey];
    deleteWorldEntryOriginalData(nextDetail, entryKey);
    await saveWorldbookDetail(worldbookId, nextDetail);
    state.worldEntryDeleteConfirm = { worldbookId: '', entryKey: '' };
    showToast('条目已删除', getWorldEntryTitle(entry, entryKey));
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

function getExtensionFolderName(extension) {
    return String(extension?.name || '').replace(/^third-party\//, '');
}

function canManageExtension(extension) {
    return extension?.type === 'local' || extension?.type === 'global';
}

function resetExtensionDetails() {
    state.extensionDetails = { name: '', type: '', loading: false, version: null, branches: [], branch: '', error: '' };
}

function toggleExtensionInstall(active = !state.extensionInstall.active) {
    state.extensionInstall = {
        active,
        url: active ? state.extensionInstall.url : '',
        branch: active ? state.extensionInstall.branch : '',
        global: active ? state.extensionInstall.global : false,
        running: false,
    };
    render();
}

async function installExtensionFromForm() {
    const url = state.extensionInstall.url.trim();
    const branch = state.extensionInstall.branch.trim();
    if (!url) {
        throw new Error('请输入扩展 Git URL。');
    }

    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('扩展 URL 只支持 HTTP 或 HTTPS。');
    }

    state.extensionInstall.running = true;
    render();
    try {
        const result = await apiFetch('/api/extensions/install', {
            body: {
                url,
                branch,
                global: Boolean(state.extensionInstall.global && state.me?.admin),
            },
        });
        state.extensionInstall = { active: false, url: '', branch: '', global: false, running: false };
        resetExtensionDetails();
        await loadData({ silent: true });
        showToast('扩展已安装', result?.display_name || result?.folderName || parsedUrl.pathname.split('/').pop());
    } finally {
        state.extensionInstall.running = false;
        render();
    }
}

function beginExtensionOperation(name, type, action) {
    state.extensionOperation = { name, type, action, running: false };
    render();
}

function cancelExtensionOperation() {
    state.extensionOperation = { name: '', type: '', action: '', running: false };
    render();
}

async function confirmExtensionOperation() {
    const { name, type, action } = state.extensionOperation;
    if (!name || !action) {
        throw new Error('请选择扩展操作。');
    }

    state.extensionOperation.running = true;
    render();
    const body = { extensionName: name, global: type === 'global' };
    if (action === 'update') {
        const result = await apiFetch('/api/extensions/update', { body });
        showToast(result?.isUpToDate ? '扩展已是最新' : '扩展已更新', result?.shortCommitHash || name);
    } else if (action === 'delete') {
        await apiFetch('/api/extensions/delete', { body });
        showToast('扩展已删除', name);
    } else if (action === 'move') {
        const destination = type === 'global' ? 'local' : 'global';
        await apiFetch('/api/extensions/move', { body: { extensionName: name, source: type, destination } });
        showToast('扩展位置已移动', `${name} → ${destination}`);
    } else {
        throw new Error('未知扩展操作。');
    }
    state.extensionOperation = { name: '', type: '', action: '', running: false };
    resetExtensionDetails();
    await loadData({ silent: true });
    render();
}

async function loadExtensionDetails(name, type, { branches = false } = {}) {
    if (!name || !type) {
        throw new Error('请选择扩展。');
    }

    state.extensionDetails = {
        name,
        type,
        loading: true,
        version: state.extensionDetails.name === name && state.extensionDetails.type === type ? state.extensionDetails.version : null,
        branches: state.extensionDetails.name === name && state.extensionDetails.type === type ? state.extensionDetails.branches : [],
        branch: state.extensionDetails.name === name && state.extensionDetails.type === type ? state.extensionDetails.branch : '',
        error: '',
    };
    render();

    try {
        const body = { extensionName: name, global: type === 'global' };
        const version = await apiFetch('/api/extensions/version', { body });
        let extensionBranches = state.extensionDetails.branches;
        if (branches) {
            const result = await apiFetch('/api/extensions/branches', { body });
            extensionBranches = Array.isArray(result) ? result : [];
        }

        state.extensionDetails = {
            name,
            type,
            loading: false,
            version,
            branches: extensionBranches,
            branch: state.extensionDetails.branch || version?.currentBranchName || '',
            error: '',
        };
        render();
    } catch (error) {
        state.extensionDetails = {
            ...state.extensionDetails,
            loading: false,
            error: error.message,
        };
        render();
        throw error;
    }
}

async function switchExtensionBranch() {
    const details = state.extensionDetails;
    const branch = details.branch.trim();
    if (!details.name || !details.type || !branch) {
        throw new Error('请选择扩展和分支。');
    }

    state.extensionDetails.loading = true;
    render();
    try {
        await apiFetch('/api/extensions/switch', {
            body: {
                extensionName: details.name,
                branch,
                global: details.type === 'global',
            },
        });
        showToast('扩展分支已切换', `${details.name} → ${branch}`);
        await loadExtensionDetails(details.name, details.type, { branches: true });
    } finally {
        state.extensionDetails.loading = false;
        render();
    }
}

async function loadSettingsSnapshots({ force = false } = {}) {
    if (state.settingsSnapshots.items.length && !force) {
        return state.settingsSnapshots.items;
    }

    state.settingsSnapshots.loading = true;
    render();
    try {
        const result = await apiFetch('/api/settings/get-snapshots');
        const snapshots = Array.isArray(result)
            ? [...result].sort((a, b) => Number(b.date || 0) - Number(a.date || 0))
            : [];
        state.settingsSnapshots.items = snapshots;
        return snapshots;
    } finally {
        state.settingsSnapshots.loading = false;
    }
}

async function createSettingsSnapshot() {
    state.settingsSnapshots.creating = true;
    render();
    try {
        await apiFetch('/api/settings/make-snapshot');
        await loadSettingsSnapshots({ force: true });
        showToast('设置快照已创建', '当前 settings.json 已备份。');
    } finally {
        state.settingsSnapshots.creating = false;
        render();
    }
}

async function previewSettingsSnapshot(name) {
    const text = await apiFetch('/api/settings/load-snapshot', { body: { name } });
    state.settingsSnapshots.previewName = name;
    state.settingsSnapshots.previewText = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
    render();
}

function beginSettingsSnapshotRestore(name) {
    state.settingsSnapshots.restoreConfirm = name;
    render();
}

function cancelSettingsSnapshotRestore() {
    state.settingsSnapshots.restoreConfirm = '';
    render();
}

async function confirmSettingsSnapshotRestore() {
    const name = state.settingsSnapshots.restoreConfirm;
    if (!name) {
        throw new Error('请先选择一个设置快照。');
    }

    state.settingsSnapshots.restoring = true;
    render();
    try {
        await apiFetch('/api/settings/restore-snapshot', { body: { name } });
        state.settingsSnapshots.restoreConfirm = '';
        await loadData({ silent: true });
        showToast('设置已恢复', name);
    } finally {
        state.settingsSnapshots.restoring = false;
        render();
    }
}

function getRequestCompressionSettings() {
    return state.settings.request_compression || state.settingsBundle.request_compression || {};
}

function saveModernPreferencesFromForm() {
    const theme = elements.content.querySelector('[data-modern-theme]')?.value === 'dark' ? 'dark' : 'light';
    const chatMode = elements.content.querySelector('[data-modern-chat-mode]')?.value === 'group' ? 'group' : 'character';
    const chatSidebarOpen = Boolean(elements.content.querySelector('[data-modern-chat-sidebar-open]')?.checked);
    const inspectorOpen = Boolean(elements.content.querySelector('[data-modern-inspector-open]')?.checked);

    setTheme(theme);
    state.chatMode = chatMode;
    localStorage.setItem('st-modern-chat-mode', chatMode);
    localStorage.setItem('st-modern-chat-sidebar-open', String(chatSidebarOpen));
    localStorage.setItem('st-modern-inspector-open', String(inspectorOpen));
    showToast('界面偏好已保存', `${theme} / ${getChatModeLabel()}`);
    render();
}

async function saveRequestCompressionFromForm() {
    const current = getRequestCompressionSettings();
    const enabled = Boolean(elements.content.querySelector('[data-request-compression-enabled]')?.checked);
    const minPayloadSize = numberInput(elements.content.querySelector('[data-request-compression-min]')?.value, Number(current.minPayloadSize || 0));
    const maxPayloadSize = numberInput(elements.content.querySelector('[data-request-compression-max]')?.value, Number(current.maxPayloadSize || 0));

    if (minPayloadSize < 0 || maxPayloadSize < 0) {
        throw new Error('请求压缩载荷大小不能小于 0。');
    }
    if (maxPayloadSize && minPayloadSize > maxPayloadSize) {
        throw new Error('最小载荷不能大于最大载荷。');
    }

    state.settings.request_compression = {
        ...current,
        enabled,
        minPayloadSize,
        maxPayloadSize,
    };
    await apiFetch('/api/settings/save', { body: state.settings });
    await loadData({ silent: true });
    showToast('请求压缩设置已保存', `${formatBytes(minPayloadSize)} - ${formatBytes(maxPayloadSize)}`);
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
