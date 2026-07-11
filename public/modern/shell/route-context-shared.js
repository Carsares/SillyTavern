export function createComponentRouteContext(components) {
    const {
        metricCard,
        pageHead,
        renderCharacterRow,
        renderEmptyState,
        renderGroupRow,
        renderInlineEmpty,
        renderKeyValue,
        renderRouteFilter,
    } = components;

    return {
        metricCard,
        pageHead,
        renderCharacterRow,
        renderEmptyState,
        renderGroupRow,
        renderInlineEmpty,
        renderKeyValue,
        renderRouteFilter,
    };
}

export function createActivityRouteContext(activity) {
    const {
        getActivityEntries,
        getActivitySummary,
        recreateStats,
    } = activity;

    return {
        getActivityEntries,
        getActivitySummary,
        recreateStats,
    };
}

export function createApiRouteContext(api) {
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
        loadHordeModels,
        refreshHordeModels,
        startOpenRouterAuth,
    } = api;

    return {
        getSelectedApiMain,
        getChatCompletionModel,
        getApiModelSuggestions,
        getApiSourceUiState,
        getNumberSetting,
        getSecretStateForSource,
        getOaiSettings,
        testApiConnection,
        setApiModelSuggestion,
        saveApiConnectionFromForm,
        updateApiSourceFields,
        updateTextCompletionTypeFields,
        loadHordeModels,
        refreshHordeModels,
        startOpenRouterAuth,
    };
}

export function createPresetRouteContext(presets) {
    const {
        getPresetCount,
        getPresetGroups,
        getVisiblePresetGroups,
        getSelectedPresetRecord,
        getPresetEditorText,
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
    } = presets;

    return {
        getPresetCount,
        getPresetGroups,
        getVisiblePresetGroups,
        getSelectedPresetRecord,
        getPresetEditorText,
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
    };
}

export function createSettingsRouteContext(settings) {
    const {
        getRequestCompressionSettings,
        loadSettingsSnapshots,
        createSettingsSnapshot,
        saveModernPreferencesFromForm,
        previewSettingsSnapshot,
        beginSettingsSnapshotRestore,
        cancelSettingsSnapshotRestore,
        confirmSettingsSnapshotRestore,
    } = settings;

    return {
        getRequestCompressionSettings,
        loadSettingsSnapshots,
        createSettingsSnapshot,
        saveModernPreferencesFromForm,
        previewSettingsSnapshot,
        beginSettingsSnapshotRestore,
        cancelSettingsSnapshotRestore,
        confirmSettingsSnapshotRestore,
    };
}
