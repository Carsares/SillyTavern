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
            // 开始编辑时的已保存内容，用来判断是否有未保存的修改。
            baseline: {},
        },
        // 收起或切换编辑后保留的未保存角色修改：avatar → { form, baseline }。
        characterEditDrafts: {},
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
        // 正在执行「读取完整卡」的角色头像文件名，用于按钮的读取中状态。
        characterDetailLoading: '',
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
            // 流式输出气泡状态：active 为真时在消息列表末尾追加流式气泡，text 保存到当前的累积文本用于重渲染兜底
            streaming: { active: false, text: '', chatId: '' },
        },
        chatMode: localStorage.getItem('st-modern-chat-mode') === 'group' ? 'group' : 'character',
        chatSidebarOpen: getInitialChatSidebarOpen(),
        inspectorOpen: localStorage.getItem('st-modern-inspector-open') === 'true',
        // Bumped by actions/settings.js whenever the「默认展开上下文抽屉」preference is saved; shell/inspector.js does
        // not treat the click that saved it as an outside click
        inspectorPreferenceRevision: 0,
        // 只读观测：inspector 里「本次生成提示词分解」的展示状态，data 为 legacy bridge 回传的只读快照。
        inspector: {
            itemizedPrompt: {
                loading: false,
                loaded: false,
                chatId: '',
                expanded: true,
                error: '',
                data: null,
            },
        },
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
            // 当前结果页（1 起），新搜索重置为 1。
            resultPage: 1,
            // 本轮搜索的逐站进度：providers 为 { id, name, status: queued|running|done|failed|cancelled }。
            searchProgress: {
                providers: [],
                cancelled: false,
            },
            records: [],
            // True once the startup data load read the import records (navigation badge), before the route loads
            recordsLoaded: false,
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
        rawSettingsEditor: {
            open: false,
            loading: false,
            value: '',
            saving: false,
            error: '',
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
