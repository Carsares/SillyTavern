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
        settingsAutosave,
        getOaiSettings,
        getSelectedApiMain,
        getChatCompletionModel,
        getApiModelSuggestions,
        getApiSourceUiState,
        getNumberSetting,
        getSecretStateForSource,
        testApiConnection,
        saveConnectionField,
        fillSuggestedContext,
        applyModelSuggestion,
        loadHordeModels,
        refreshHordeModels,
        startOpenRouterAuth,
        getModelServiceUi,
        hasModelServiceSecret,
        describeModelServiceUsage,
        getChatSceneServiceId,
        ensureModelServicesMigrated,
        registerCurrentConnection,
        addModelService,
        updateModelServiceField,
        updateModelServiceKey,
        deleteModelService,
        selectChatService,
        updateTranslationScene,
        loadServiceModels,
        testModelService,
    } = api;

    return {
        settingsAutosave,
        getSelectedApiMain,
        getChatCompletionModel,
        getApiModelSuggestions,
        getApiSourceUiState,
        getNumberSetting,
        getSecretStateForSource,
        getOaiSettings,
        testApiConnection,
        saveConnectionField,
        fillSuggestedContext,
        applyModelSuggestion,
        loadHordeModels,
        refreshHordeModels,
        startOpenRouterAuth,
        getModelServiceUi,
        hasModelServiceSecret,
        describeModelServiceUsage,
        getChatSceneServiceId,
        ensureModelServicesMigrated,
        registerCurrentConnection,
        addModelService,
        updateModelServiceField,
        updateModelServiceKey,
        deleteModelService,
        selectChatService,
        updateTranslationScene,
        loadServiceModels,
        testModelService,
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
        togglePromptOrderEntry,
        movePromptOrderEntry,
        useOpenAiPreset,
        duplicatePreset,
        exportPreset,
        getPresetRestoreStatus,
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
        togglePromptOrderEntry,
        movePromptOrderEntry,
        useOpenAiPreset,
        duplicatePreset,
        exportPreset,
        getPresetRestoreStatus,
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
        saveModernPreferenceField,
        previewSettingsSnapshot,
        beginSettingsSnapshotRestore,
        cancelSettingsSnapshotRestore,
        confirmSettingsSnapshotRestore,
        openRawSettingsEditor,
        updateRawSettingsEditorValue,
        closeRawSettingsEditor,
        saveRawSettingsFromEditor,
    } = settings;

    return {
        getRequestCompressionSettings,
        loadSettingsSnapshots,
        createSettingsSnapshot,
        saveModernPreferenceField,
        previewSettingsSnapshot,
        beginSettingsSnapshotRestore,
        cancelSettingsSnapshotRestore,
        confirmSettingsSnapshotRestore,
        openRawSettingsEditor,
        updateRawSettingsEditorValue,
        closeRawSettingsEditor,
        saveRawSettingsFromEditor,
    };
}
