import {
    chatCompletionSourceOptions,
    secretKeyByChatSource,
    worldEntryPageSize,
    worldEntryPositions,
    worldEntryRoleOptions,
    worldEntrySelectiveLogicOptions,
} from './core/constants.js';
import { createApiClient } from './core/api-client.js';
import { createLegacyBridge } from './core/legacy-bridge.js';
import { backgroundPageSize, createModernState } from './core/state.js';
import { createCommonComponents } from './components/common.js';
import { createActionRegistry } from './shell/action-registry.js';
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
    escapeHtml,
    formatBytes,
    formatDate,
    formatDurationMs,
    formatNumber,
    getPersonaUrl,
    maskEndpoint,
    normalizeText,
    parsePreset,
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

const {
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
    getAssetCount,
    getAssetEntries,
    getAssetGroups,
    getBackgroundFilename,
    getCharacterAvatarUrl,
    getChatCompletionModel,
    getChatEntityAvatarUrl,
    getChatEntityName,
    getChatId,
    getChatMessageCount,
    getEntityUnreadCount,
    getChatModeLabel,
    getExtensionFolderName,
    getPersonas,
    getPresetCount,
    getPresetGroups,
    getPresetItems,
    getSelectedChatEntity,
    getSelectedChatList,
    isGroupChatMode,
    ensureAvailableChatMode,
    loadWorldDetail,
    prepareChatForSelectedContext,
    selectPreset,
    toggleChatSidebar,
} = createActionRegistry({
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
});

const commonComponents = createCommonComponents({
    state,
    getCharacterAvatarUrl,
    getChatEntityAvatarUrl,
    getEntityUnreadCount,
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
    getAssetGroups,
    getAssetEntries,
    getBackgroundFilename,
    getExtensionFolderName,
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
    characters: characterActions,
    chatContext: chatContextActions,
    chatFiles: chatFileActions,
    chatGeneration: chatGenerationActions,
    chatMessages: chatMessageActions,
    extensions: extensionActions,
    groups: groupActions,
    personas: personaActions,
    presets: presetActions,
    settings: settingsActions,
    worldbooks: worldbookActions,
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
    renderPalette,
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
    getBackgroundFilename,
    beginCharacterCreate,
    beginGroupCreate,
    beginWorldbookCreate,
    selectPreset,
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
