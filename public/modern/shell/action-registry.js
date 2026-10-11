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
import { createCharacterActions } from '../actions/characters.js';
import { createExtensionActions } from '../actions/extensions.js';
import { createPersonaActions } from '../actions/personas.js';
import { createPresetActions } from '../actions/presets.js';
import { createRemoteResourceActions } from '../actions/remote-resources.js';
import { createSettingsActions } from '../actions/settings.js';
import { createWorldbookActions } from '../actions/worldbooks.js';
import { createChatActionRegistry } from './chat-action-registry.js';

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
    subscribeProgress,
    bridgeReload,
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
        reloadSettings: bridgeReload.reloadSettings,
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
        reloadSettings: bridgeReload.reloadSettings,
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
        callLegacyBridge,
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
        reloadWorldInfo: bridgeReload.reloadWorldInfo,
    });
    const {
        loadWorldDetail,
        ensureWorldbookFileWriteAllowed,
        restoreWorldbookFile,
        beginWorldbookCreate,
    } = worldbookActions;

    const characterActions = createCharacterActions({
        state,
        apiFetch,
        apiFetchResponse,
        loadData,
        render,
        showToast,
        reloadCharacter: bridgeReload.reloadCharacter,
        reloadWorldInfo: bridgeReload.reloadWorldInfo,
    });
    const {
        getCharacterAvatarUrl,
        beginCharacterCreate,
    } = characterActions;

    const chatRegistry = createChatActionRegistry({
        state,
        apiFetch,
        apiFetchResponse,
        loadData,
        render,
        showToast,
        callLegacyBridge,
        subscribeProgress,
        bridgeReload,
        getCharacterAvatarUrl,
    });
    const { getChatModeLabel } = chatRegistry;

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
        reloadSettings: bridgeReload.reloadSettings,
    });

    const personaActions = createPersonaActions({
        state,
        apiFetch,
        loadData,
        render,
        showToast,
        reloadSettings: bridgeReload.reloadSettings,
    });
    const { getPersonas } = personaActions;

    const remoteResourceActions = createRemoteResourceActions({
        state,
        apiFetch,
        apiFetchResponse,
        loadData,
        render,
        showToast,
        callLegacyBridge,
        loadWorldDetail,
        ensureWorldbookFileWriteAllowed,
        restoreWorldbookFile,
        reloadWorldInfo: bridgeReload.reloadWorldInfo,
        offerCharacterEmbeddedWorld: characterActions.offerEmbeddedWorldAfterImport,
    });

    return {
        // 引擎同步通道（reloadChat / reloadCharacter / reloadSettings / reloadWorldInfo / waitForPendingReloads），
        // 供之后新增、需要自己通知引擎的 action 工厂注入
        bridgeReload,
        activityActions,
        apiConnectionActions,
        assetActions,
        characterActions,
        extensionActions,
        personaActions,
        presetActions,
        remoteResourceActions,
        settingsActions,
        worldbookActions,
        beginCharacterCreate,
        beginWorldbookCreate,
        getAssetCount,
        getAssetEntries,
        getAssetGroups,
        getBackgroundFilename,
        getCharacterAvatarUrl,
        getChatCompletionModel,
        getPersonas,
        getPresetCount,
        getPresetGroups,
        getPresetItems,
        getRemoteResourceCount: remoteResourceActions.getRemoteResourceCount,
        getExtensionFolderName,
        loadWorldDetail,
        selectPreset,
        ...chatRegistry,
    };
}
