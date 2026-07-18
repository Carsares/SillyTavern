import { characterFormDefaults, routeLabels } from './constants.js';

const chatSidebarPreference = localStorage.getItem('st-modern-chat-sidebar-open');
export const chatReadStateStorageKey = 'st-modern-chat-read-state:v1';

export const backgroundPageSize = window.matchMedia('(max-width: 860px)').matches ? 8 : 24;

function getInitialChatSidebarOpen() {
    if (chatSidebarPreference !== null) {
        return chatSidebarPreference !== 'false';
    }

    return !window.matchMedia('(max-width: 860px)').matches;
}

function loadChatReadState() {
    try {
        const value = JSON.parse(localStorage.getItem(chatReadStateStorageKey) || '{}');
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (value.cursors && typeof value.cursors === 'object' && !Array.isArray(value.cursors)) {
                return {
                    cursors: value.cursors,
                    contexts: value.contexts && typeof value.contexts === 'object' && !Array.isArray(value.contexts) ? value.contexts : {},
                };
            }

            return {
                cursors: value,
                contexts: {},
            };
        }
    } catch {
        // Ignore invalid localStorage state and rebuild it from loaded chat lists.
    }

    return {
        cursors: {},
        contexts: {},
    };
}

export function createModernState() {
    const initialRoute = new URLSearchParams(window.location.search).get('view') || 'dashboard';

    return {
        route: routeLabels[initialRoute] ? initialRoute : 'dashboard',
        query: '',
        paletteQuery: '',
        csrfToken: '',
        loaded: false,
        loading: false,
        errors: [],
        me: null,
        settingsBundle: {},
        settings: {},
        characters: [],
        groups: [],
        worldbooks: [],
        characterDetails: {},
        worldDetails: {},
        backgrounds: [],
        backgroundFolders: { folders: [], imageFolderMap: {} },
        assets: {},
        extensions: [],
        secrets: {},
        secretState: {},
        stats: {},
        chatLists: {},
        chatMessages: {},
        chatMessageLimits: {},
        chatMetadata: {},
        chatReadState: loadChatReadState(),
        loadingChats: {},
        chatDrafts: {},
        chatSearch: {
            avatar: '',
            contextKey: '',
            query: '',
            searchedQuery: '',
            loading: false,
            results: [],
        },
        chatBackups: {
            open: false,
            loading: false,
            items: [],
            previewName: '',
            previewText: '',
            deleteConfirm: '',
            deleting: false,
            restoring: '',
        },
        chatEditing: {
            key: '',
            index: -1,
            text: '',
        },
        chatMessageDeleteConfirm: {
            key: '',
            index: -1,
        },
        chatRenaming: {
            key: '',
            name: '',
        },
        chatDeleteConfirm: {
            key: '',
            name: '',
        },
        characterCreating: {
            active: false,
            form: { ...characterFormDefaults },
            errors: {},
        },
        characterEditing: {
            avatar: '',
            form: {},
            errors: {},
        },
        characterRenaming: {
            avatar: '',
            name: '',
        },
        characterDeleteConfirm: {
            avatar: '',
            name: '',
            deleteChats: false,
        },
        avatarCacheBust: {},
        groupCreating: {
            active: false,
            form: {},
        },
        groupEditing: {
            id: '',
            form: {},
        },
        groupDeleteConfirm: {
            id: '',
            name: '',
        },
        personaEditing: {
            avatarId: '',
            form: {},
        },
        personaCreating: {
            active: false,
            form: { name: '', title: '', description: '' },
            file: null,
        },
        personaDeleteConfirm: {
            avatarId: '',
        },
        backgroundSelection: {
            active: false,
            filenames: [],
            deleteConfirm: false,
            deleting: false,
        },
        backgroundRenaming: {
            filename: '',
            name: '',
            running: false,
        },
        backgroundFolderFilter: '',
        backgroundFolderAssignment: '',
        backgroundVisibleCount: backgroundPageSize,
        backgroundFolderCreating: {
            active: false,
            name: '',
            running: false,
        },
        backgroundFolderRenaming: {
            id: '',
            name: '',
            running: false,
        },
        backgroundFolderDeleteConfirm: {
            id: '',
            running: false,
        },
        assetDownload: {
            active: false,
            url: '',
            category: 'bgm',
            filename: '',
            running: false,
        },
        assetTab: localStorage.getItem('st-modern-asset-tab') === 'files' ? 'files' : 'backgrounds',
        assetExpandedGroups: [],
        assetDeleteConfirm: {
            category: '',
            filename: '',
            running: false,
        },
        openAiPresetDraft: {
            name: '',
        },
        presetSelection: {
            apiId: 'openai',
            name: '',
        },
        // Group ids the user has expanded, preserved so selecting a preset doesn't collapse them
        presetExpandedGroups: [],
        presetEditor: {
            apiId: '',
            name: '',
            json: '',
            error: '',
        },
        presetDeleteConfirm: {
            apiId: '',
            name: '',
        },
        worldbookCreating: {
            active: false,
            name: '',
        },
        worldbookDeleteConfirm: {
            worldbookId: '',
        },
        worldEntryBulkDeleteConfirm: {
            worldbookId: '',
        },
        worldEntryList: {
            worldbookId: '',
            query: '',
            sort: 'order',
            page: 1,
            selectedKeys: [],
        },
        worldEntryEditing: {
            worldbookId: '',
            entryKey: '',
            mode: '',
            form: {},
        },
        worldEntryDeleteConfirm: {
            worldbookId: '',
            entryKey: '',
        },
        engine: {
            generating: false,
            status: '就绪',
            error: '',
            checking: false,
            ready: false,
            detail: '生成引擎会在首次发送时自动加载。',
        },
        chatMode: localStorage.getItem('st-modern-chat-mode') === 'group' ? 'group' : 'character',
        chatSidebarOpen: getInitialChatSidebarOpen(),
        inspectorOpen: localStorage.getItem('st-modern-inspector-open') === 'true',
        settingsSection: localStorage.getItem('st-modern-settings-section') || 'preferences',
        activityFilter: '',
        activitySort: localStorage.getItem('st-modern-activity-sort') || 'recent',
        apiTest: {
            running: false,
            status: '未测试',
            detail: '尚未从现代界面发起连接测试。',
        },
        apiTestHistory: [],
        apiMainDraft: '',
        hordeModels: { loaded: false, loading: false, items: [] },
        extensionOperation: {
            name: '',
            type: '',
            action: '',
            running: false,
        },
        extensionView: localStorage.getItem('st-modern-extension-view') || 'all',
        extensionInstall: {
            active: false,
            url: '',
            urlError: '',
            branch: '',
            global: false,
            running: false,
        },
        extensionDetails: {
            name: '',
            type: '',
            loading: false,
            version: null,
            branches: [],
            branch: '',
            error: '',
        },
        remoteResources: {
            activeTab: localStorage.getItem('st-modern-remote-resource-tab') || 'discover',
            loaded: false,
            loading: false,
            searching: false,
            searched: false,
            query: '',
            resourceType: '',
            selectedProviders: [],
            providers: [],
            results: [],
            total: 0,
            errors: [],
            records: [],
            operation: {
                key: '',
                running: false,
            },
            presetPrompt: null,
            urlImport: {
                url: '',
                running: false,
            },
            credentialDrafts: {},
            credentialSaving: '',
            providerToggling: '',
        },
        settingsSnapshots: {
            loaded: false,
            loading: false,
            creating: false,
            restoring: false,
            items: [],
            query: '',
            previewName: '',
            previewText: '',
            restoreConfirm: '',
        },
        selected: {
            character: '',
            group: '',
            chat: '',
            worldbook: '',
            persona: '',
            extension: '',
            background: '',
            asset: '',
        },
        theme: localStorage.getItem('st-modern-theme') || 'light',
    };
}
