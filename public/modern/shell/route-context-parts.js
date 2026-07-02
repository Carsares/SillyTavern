export function createComponentRouteContext(components) {
    const {
        metricCard,
        pageHead,
        renderCharacterRow,
        renderEmptyState,
        renderGroupRow,
        renderInlineEmpty,
        renderKeyValue,
    } = components;

    return {
        metricCard,
        pageHead,
        renderCharacterRow,
        renderEmptyState,
        renderGroupRow,
        renderInlineEmpty,
        renderKeyValue,
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
    };
}

export function createAssetRouteContext(assets) {
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
    } = assets;

    return {
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
    };
}

export function createCharacterRouteContext(characters) {
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
    } = characters;

    return {
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
    };
}

export function createChatContextRouteContext(chatContext) {
    const {
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
        clearChatSearch,
        searchSelectedChats,
        loadChatMessages,
        prepareChatForSelectedContext,
        getCurrentDraftKey,
        getCurrentDraft,
        setCurrentDraft,
        increaseCurrentMessageLimit,
        closeChatSidebarForMobileSelection,
    } = chatContext;

    return {
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
        clearChatSearch,
        searchSelectedChats,
        loadChatMessages,
        prepareChatForSelectedContext,
        getCurrentDraftKey,
        getCurrentDraft,
        setCurrentDraft,
        increaseCurrentMessageLimit,
        closeChatSidebarForMobileSelection,
    };
}

export function createChatFileRouteContext(chatFiles) {
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
        viewChatBackup,
        restoreChatBackup,
        beginChatBackupDelete,
        cancelChatBackupDelete,
        confirmChatBackupDelete,
    } = chatFiles;

    return {
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
        viewChatBackup,
        restoreChatBackup,
        beginChatBackupDelete,
        cancelChatBackupDelete,
        confirmChatBackupDelete,
    };
}

export function createChatGenerationRouteContext(chatGeneration) {
    const {
        checkLegacyGenerationEngine,
        sendModernMessage,
        stopModernGeneration,
        regenerateModernReply,
        continueModernReply,
        swipeModernMessage,
    } = chatGeneration;

    return {
        checkLegacyGenerationEngine,
        sendModernMessage,
        stopModernGeneration,
        regenerateModernReply,
        continueModernReply,
        swipeModernMessage,
    };
}

export function createChatMessageRouteContext(chatMessages) {
    const {
        copyModernMessage,
        deleteModernMessage,
        beginModernMessageDelete,
        cancelModernMessageDelete,
        confirmModernMessageDelete,
        beginModernMessageEdit,
        cancelModernMessageEdit,
        saveModernMessageEdit,
    } = chatMessages;

    return {
        copyModernMessage,
        deleteModernMessage,
        beginModernMessageDelete,
        cancelModernMessageDelete,
        confirmModernMessageDelete,
        beginModernMessageEdit,
        cancelModernMessageEdit,
        saveModernMessageEdit,
    };
}

export function createExtensionRouteContext(extensions) {
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
    } = extensions;

    return {
        getExtensionFolderName,
        canManageExtension,
        toggleExtensionInstall,
        installExtensionFromForm,
        loadExtensionDetails,
        switchExtensionBranch,
        beginExtensionOperation,
        cancelExtensionOperation,
        confirmExtensionOperation,
    };
}

export function createGroupRouteContext(groups) {
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
    } = groups;

    return {
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
    };
}

export function createPersonaRouteContext(personas) {
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
    } = personas;

    return {
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
        saveRequestCompressionFromForm,
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
        saveRequestCompressionFromForm,
        previewSettingsSnapshot,
        beginSettingsSnapshotRestore,
        cancelSettingsSnapshotRestore,
        confirmSettingsSnapshotRestore,
    };
}

export function createWorldbookRouteContext(worldbooks) {
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
    } = worldbooks;

    return {
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
    };
}
