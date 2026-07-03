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

    const chatRegistry = createChatActionRegistry({
        state,
        apiFetch,
        apiFetchResponse,
        loadData,
        render,
        showToast,
        callLegacyBridge,
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
    });

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
        characterActions,
        extensionActions,
        personaActions,
        presetActions,
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
        getExtensionFolderName,
        loadWorldDetail,
        selectPreset,
        ...chatRegistry,
    };
}
