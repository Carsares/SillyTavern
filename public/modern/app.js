import {
    characterFormDefaults,
    chatCompletionModelFields,
    chatCompletionSourceOptions,
    routeLabels,
    routes,
    secretKeyByChatSource,
    worldEntryDefaults,
    worldEntryPageSize,
    worldEntryPositions,
} from './core/constants.js';
import {
    escapeHtml,
    formatBytes,
    formatDate,
    formatNumber,
    getAvatarUrl,
    getPersonaUrl,
    normalizeText,
    stripJsonlExtension,
    uniqueValues,
} from './core/utils.js';

const initialRoute = new URLSearchParams(window.location.search).get('view') || 'dashboard';

const state = {
    route: routeLabels[initialRoute] ? initialRoute : 'dashboard',
    query: '',
    paletteQuery: '',
    csrfToken: '',
    csrfTokenRequest: null,
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
    assets: {},
    extensions: [],
    secrets: {},
    secretState: {},
    stats: {},
    chatLists: {},
    chatMessages: {},
    chatMetadata: {},
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
    },
    characterEditing: {
        avatar: '',
        form: {},
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
    assetDownload: {
        active: false,
        url: '',
        category: 'bgm',
        filename: '',
        running: false,
    },
    assetDeleteConfirm: {
        category: '',
        filename: '',
        running: false,
    },
    openAiPresetDraft: {
        name: '',
    },
    worldbookCreating: {
        active: false,
        name: '',
    },
    worldbookDeleteConfirm: {
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
    },
    chatMode: localStorage.getItem('st-modern-chat-mode') === 'group' ? 'group' : 'character',
    chatSidebarOpen: localStorage.getItem('st-modern-chat-sidebar-open') !== 'false',
    inspectorOpen: localStorage.getItem('st-modern-inspector-open') === 'true',
    apiTest: {
        running: false,
        status: '未测试',
        detail: '尚未从现代界面发起连接测试。',
    },
    extensionOperation: {
        name: '',
        type: '',
        action: '',
        running: false,
    },
    extensionInstall: {
        active: false,
        url: '',
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
    settingsSnapshots: {
        loading: false,
        creating: false,
        restoring: false,
        items: [],
        previewName: '',
        previewText: '',
        restoreConfirm: '',
    },
    selected: {
        character: '',
        group: '',
        chat: '',
        worldbook: '',
    },
    theme: localStorage.getItem('st-modern-theme') || 'light',
};

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

const legacyBridgeSource = 'sillytavern-modern-bridge';
const legacyBridge = {
    frame: null,
    loadPromise: null,
    pending: new Map(),
    nextId: 1,
};

function matchesQuery(...values) {
    if (!state.query) {
        return true;
    }

    return values.some(value => normalizeText(value).includes(state.query));
}

function handleLegacyBridgeMessage(event) {
    if (event.origin !== window.location.origin || event.data?.source !== legacyBridgeSource) {
        return;
    }

    const request = legacyBridge.pending.get(event.data.id);
    if (!request) {
        return;
    }

    window.clearTimeout(request.timer);
    legacyBridge.pending.delete(event.data.id);
    if (event.data.error) {
        request.reject(new Error(event.data.error.message || '原版生成引擎执行失败。'));
        return;
    }
    request.resolve(event.data.result);
}

window.addEventListener('message', handleLegacyBridgeMessage);

async function ensureLegacyBridgeFrame() {
    if (legacyBridge.frame?.contentWindow) {
        return legacyBridge.frame;
    }
    if (legacyBridge.loadPromise) {
        return legacyBridge.loadPromise;
    }

    legacyBridge.loadPromise = new Promise((resolve, reject) => {
        const frame = document.createElement('iframe');
        const timer = window.setTimeout(() => {
            reject(new Error('原版生成引擎加载超时。'));
        }, 30000);

        frame.hidden = true;
        frame.title = 'SillyTavern legacy generation engine';
        frame.src = '/?modernBridge=1';
        frame.style.display = 'none';
        frame.addEventListener('load', () => {
            window.clearTimeout(timer);
            resolve(frame);
        }, { once: true });
        frame.addEventListener('error', () => {
            window.clearTimeout(timer);
            reject(new Error('原版生成引擎加载失败。'));
        }, { once: true });

        legacyBridge.frame = frame;
        document.body.append(frame);
    });

    try {
        return await legacyBridge.loadPromise;
    } catch (error) {
        legacyBridge.frame?.remove();
        legacyBridge.frame = null;
        legacyBridge.loadPromise = null;
        throw error;
    }
}

async function callLegacyBridge(action, payload = {}, timeoutMs = 180000) {
    const frame = await ensureLegacyBridgeFrame();
    const id = String(legacyBridge.nextId++);

    const responsePromise = new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
            legacyBridge.pending.delete(id);
            reject(new Error('原版生成引擎响应超时。'));
        }, timeoutMs);
        legacyBridge.pending.set(id, { resolve, reject, timer });
    });

    frame.contentWindow.postMessage({
        source: legacyBridgeSource,
        id,
        action,
        payload,
    }, window.location.origin);

    return responsePromise;
}

function getPresetGroups() {
    const bundle = state.settingsBundle;
    return [
        { id: 'openai', label: '聊天补全', names: bundle.openai_setting_names || [], contents: bundle.openai_settings || [] },
        { id: 'textgenerationwebui', label: '文本补全', names: bundle.textgenerationwebui_preset_names || [], contents: bundle.textgenerationwebui_presets || [] },
        { id: 'kobold', label: 'Kobold', names: bundle.koboldai_setting_names || [], contents: bundle.koboldai_settings || [] },
        { id: 'novel', label: 'NovelAI', names: bundle.novelai_setting_names || [], contents: bundle.novelai_settings || [] },
        { id: 'instruct', label: '指令模板', names: (bundle.instruct || []).map(item => item.name || item.system_prompt_name || '未命名'), contents: bundle.instruct || [] },
        { id: 'context', label: '上下文模板', names: (bundle.context || []).map(item => item.name || item.context_name || '未命名'), contents: bundle.context || [] },
        { id: 'sysprompt', label: '系统提示词', names: (bundle.sysprompt || []).map(item => item.name || item.sysprompt_name || '未命名'), contents: bundle.sysprompt || [] },
        { id: 'reasoning', label: '推理模板', names: (bundle.reasoning || []).map(item => item.name || item.reasoning_name || '未命名'), contents: bundle.reasoning || [] },
    ];
}

function getPresetCount() {
    return getPresetGroups().reduce((total, group) => total + group.names.length, 0);
}

function getPresetItems(group) {
    return group.names
        .map((name, index) => ({
            name,
            content: group.contents[index],
            active: group.id === 'openai' && name === getOaiSettings().preset_settings_openai,
            actionable: group.id === 'openai',
        }))
        .filter(item => matchesQuery(item.name, group.label, group.id));
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

function getAssetEntries(group, limit = 8) {
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

    return entries.slice(0, limit);
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

async function ensureCsrfToken() {
    if (state.csrfToken) {
        return state.csrfToken;
    }

    if (state.csrfTokenRequest) {
        return state.csrfTokenRequest;
    }

    state.csrfTokenRequest = (async () => {
        try {
            const response = await fetch('/csrf-token', { credentials: 'same-origin' });
            if (!response.ok) {
                throw new Error(`CSRF token request failed: ${response.status}`);
            }

            const data = await response.json();
            state.csrfToken = data.token;
            return state.csrfToken;
        } finally {
            state.csrfTokenRequest = null;
        }
    })();

    return state.csrfTokenRequest;
}

async function apiFetch(path, options = {}, retry = true) {
    const method = options.method || 'POST';
    const token = await ensureCsrfToken();
    const headers = {
        'X-CSRF-Token': token,
    };

    if (options.body !== undefined && !options.omitContentType) {
        headers['Content-Type'] = 'application/json';
    }

    const request = {
        method,
        headers,
        credentials: 'same-origin',
        signal: options.signal,
    };

    if (options.body !== undefined) {
        request.body = options.omitContentType ? options.body : JSON.stringify(options.body);
    }

    const response = await fetch(path, request);
    if (response.status === 403 && retry) {
        state.csrfToken = '';
        state.csrfTokenRequest = null;
        return apiFetch(path, options, false);
    }
    if (response.status === 403) {
        throw new Error('当前会话没有访问权限，请先登录。');
    }
    if (!response.ok) {
        throw new Error(`${path} failed: ${response.status}`);
    }
    if (response.status === 204) {
        return null;
    }

    const text = await response.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function apiFetchResponse(path, options = {}, retry = true) {
    const method = options.method || 'POST';
    const token = await ensureCsrfToken();
    const headers = {
        'X-CSRF-Token': token,
    };

    if (options.body !== undefined && !options.omitContentType) {
        headers['Content-Type'] = 'application/json';
    }

    const request = {
        method,
        headers,
        credentials: 'same-origin',
        signal: options.signal,
    };

    if (options.body !== undefined) {
        request.body = options.omitContentType ? options.body : JSON.stringify(options.body);
    }

    const response = await fetch(path, request);
    if (response.status === 403 && retry) {
        state.csrfToken = '';
        state.csrfTokenRequest = null;
        return apiFetchResponse(path, options, false);
    }
    if (response.status === 403) {
        throw new Error('当前会话没有访问权限，请先登录。');
    }
    if (!response.ok) {
        throw new Error(`${path} failed: ${response.status}`);
    }

    return response;
}

function downloadFile(content, fileName, contentType = 'application/octet-stream') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: contentType });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
}

async function loadData({ silent = false } = {}) {
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
    if (state.route === 'chat') {
        await prepareChatForSelectedContext();
    }

    state.loaded = true;
    state.loading = false;
    render();

    if (!silent) {
        const summary = state.errors.length ? '部分数据读取失败，详情见右侧检查器。' : '已同步当前用户数据。';
        showToast('刷新完成', summary);
    }
}

async function loadWorldDetail(worldbookId) {
    if (!worldbookId || state.worldDetails[worldbookId]) {
        return;
    }

    try {
        state.worldDetails[worldbookId] = await apiFetch('/api/worldinfo/get', { body: { name: worldbookId } });
    } catch (error) {
        state.errors.push({ key: 'worldbook', message: error.message });
        showToast('世界书读取失败', error.message);
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
    return getAvatarUrl(entity);
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

function getOaiSettings() {
    return state.settings.oai_settings || {};
}

function getChatCompletionModel(settings, source) {
    const field = chatCompletionModelFields[source] || 'openai_model';
    return settings[field] || settings.openai_model || '';
}

function getApiSourceUiState(source) {
    const secretState = getSecretStateForSource(source);
    return {
        hasSecretMapping: Boolean(secretKeyByChatSource[source]),
        secretKey: secretKeyByChatSource[source] || '当前来源没有密钥映射',
        secretSaved: secretState.length > 0,
        showEndpoint: source === 'siliconflow',
        showCustomUrl: source === 'custom',
    };
}

function updateApiSourceFields(source) {
    const uiState = getApiSourceUiState(source);
    const settings = getOaiSettings();
    const modelInput = elements.content.querySelector('[data-api-model]');

    if (modelInput) {
        modelInput.value = getChatCompletionModel(settings, source);
    }

    elements.content.querySelectorAll('[data-api-field]').forEach(field => {
        const fieldName = field.dataset.apiField;
        const isVisible = (
            fieldName === 'siliconflow-endpoint' && uiState.showEndpoint
            || fieldName === 'custom-url' && uiState.showCustomUrl
            || fieldName === 'api-key' && uiState.hasSecretMapping
        );
        field.hidden = !isVisible;
    });

    const keyInput = elements.content.querySelector('[data-api-key]');
    if (keyInput) {
        keyInput.placeholder = uiState.secretSaved ? '密钥已保存；留空不修改' : '输入后保存到 secrets';
        keyInput.value = '';
    }

    const secretBadge = elements.content.querySelector('[data-api-secret-status]');
    if (secretBadge) {
        secretBadge.textContent = uiState.secretSaved ? '密钥已保存' : (uiState.hasSecretMapping ? '未保存密钥' : '无密钥字段');
    }

    const secretKey = elements.content.querySelector('[data-api-secret-key]');
    if (secretKey) {
        secretKey.textContent = uiState.secretKey;
    }
}

function getNumberSetting(settings, key, fallback) {
    const value = Number(settings[key]);
    return Number.isFinite(value) ? value : fallback;
}

function getChatCompletionSettings() {
    const settings = getOaiSettings();
    const source = settings.chat_completion_source || 'openai';
    const model = getChatCompletionModel(settings, source);

    if (!model) {
        throw new Error('当前聊天补全设置没有可用模型。');
    }

    return {
        source,
        model,
        temperature: getNumberSetting(settings, 'temp_openai', 1),
        maxTokens: getNumberSetting(settings, 'openai_max_tokens', 300),
        topP: getNumberSetting(settings, 'top_p_openai', 1),
        frequencyPenalty: getNumberSetting(settings, 'freq_pen_openai', 0),
        presencePenalty: getNumberSetting(settings, 'pres_pen_openai', 0),
        siliconflowEndpoint: settings.siliconflow_endpoint || 'global',
        minimaxEndpoint: settings.minimax_endpoint || 'global',
        customUrl: settings.custom_url || '',
        reverseProxy: settings.reverse_proxy || '',
        proxyPassword: settings.proxy_password || '',
    };
}

async function saveApiConnectionFromForm() {
    const oaiSettings = state.settings.oai_settings || {};
    const mainApi = elements.content.querySelector('[data-api-main]')?.value || 'openai';
    const source = elements.content.querySelector('[data-api-source]')?.value || oaiSettings.chat_completion_source || state.settings.chat_completion_source || '';
    const modelField = chatCompletionModelFields[source];
    const modelInput = elements.content.querySelector('[data-api-model]');
    const presetInput = elements.content.querySelector('[data-api-preset]');
    const endpointInput = elements.content.querySelector('[data-api-endpoint]');
    const customUrlInput = elements.content.querySelector('[data-api-custom-url]');
    const reverseProxyInput = elements.content.querySelector('[data-api-reverse-proxy]');
    const keyInput = elements.content.querySelector('[data-api-key]');
    const model = modelInput?.value.trim() || '';

    if (!modelField || !model) {
        throw new Error('当前连接暂不支持在现代页保存，或模型为空。');
    }

    state.settings.oai_settings = oaiSettings;
    state.settings.main_api = mainApi;
    state.settings.chat_completion_source = source;
    oaiSettings.chat_completion_source = source;
    oaiSettings[modelField] = model;
    oaiSettings.preset_settings_openai = presetInput?.value || oaiSettings.preset_settings_openai || '';
    oaiSettings.temp_openai = numberInput(elements.content.querySelector('[data-api-temperature]')?.value, getNumberSetting(oaiSettings, 'temp_openai', 1));
    oaiSettings.openai_max_tokens = numberInput(elements.content.querySelector('[data-api-max-tokens]')?.value, getNumberSetting(oaiSettings, 'openai_max_tokens', 300));
    oaiSettings.top_p_openai = numberInput(elements.content.querySelector('[data-api-top-p]')?.value, getNumberSetting(oaiSettings, 'top_p_openai', 1));
    oaiSettings.freq_pen_openai = numberInput(elements.content.querySelector('[data-api-frequency-penalty]')?.value, getNumberSetting(oaiSettings, 'freq_pen_openai', 0));
    oaiSettings.pres_pen_openai = numberInput(elements.content.querySelector('[data-api-presence-penalty]')?.value, getNumberSetting(oaiSettings, 'pres_pen_openai', 0));
    if (source === 'siliconflow') {
        const endpoint = endpointInput?.value || 'cn';
        oaiSettings.siliconflow_endpoint = endpoint === 'global' ? 'global' : 'cn';
    }
    if (source === 'custom') {
        oaiSettings.custom_url = customUrlInput?.value.trim() || oaiSettings.custom_url || '';
    }
    oaiSettings.reverse_proxy = reverseProxyInput?.value.trim() || '';

    const apiKey = keyInput?.value.trim() || '';
    if (apiKey) {
        const secretKey = secretKeyByChatSource[source];
        if (!secretKey) {
            throw new Error('当前来源没有可写入的密钥映射。');
        }
        await apiFetch('/api/secrets/write', { body: { key: secretKey, value: apiKey, label: `${source} modern` } });
    }

    await apiFetch('/api/settings/save', { body: state.settings });
    await loadData({ silent: true });
    showToast('连接配置已保存', `${source} / ${model}`);
}

function getSecretStateForSource(source) {
    const secretKey = secretKeyByChatSource[source];
    const value = secretKey ? state.secretState?.[secretKey] : null;
    return Array.isArray(value) ? value : [];
}

function getOpenAiPresetByName(presetName) {
    const group = getPresetGroups().find(item => item.id === 'openai');
    const presetIndex = group?.names.indexOf(presetName) ?? -1;
    return parsePreset(presetIndex >= 0 ? group.contents[presetIndex] : null);
}

function buildOpenAiPresetFromCurrentSettings() {
    const settings = getOaiSettings();
    const preset = getOpenAiPresetByName(settings.preset_settings_openai) || {};
    const source = settings.chat_completion_source || 'openai';
    const modelField = chatCompletionModelFields[source];

    preset.temperature = settings.temp_openai;
    preset.openai_max_tokens = settings.openai_max_tokens;
    preset.top_p = settings.top_p_openai;
    preset.frequency_penalty = settings.freq_pen_openai;
    preset.presence_penalty = settings.pres_pen_openai;
    preset.chat_completion_source = source;
    if (modelField) {
        preset[modelField] = settings[modelField];
    }
    if (source === 'siliconflow') {
        preset.siliconflow_endpoint = settings.siliconflow_endpoint || 'cn';
    }
    if (source === 'custom') {
        preset.custom_url = settings.custom_url || '';
    }
    if (settings.reverse_proxy) {
        preset.reverse_proxy = settings.reverse_proxy;
    }

    return preset;
}

async function saveOpenAiPresetFromForm() {
    const name = (state.openAiPresetDraft.name || getOaiSettings().preset_settings_openai || '').trim();
    if (!name) {
        throw new Error('预设名称不能为空。');
    }

    const preset = buildOpenAiPresetFromCurrentSettings();
    state.settings.oai_settings = state.settings.oai_settings || {};
    state.settings.oai_settings.preset_settings_openai = name;
    await apiFetch('/api/presets/save', { body: { apiId: 'openai', name, preset } });
    await apiFetch('/api/settings/save', { body: state.settings });
    state.openAiPresetDraft = { name: '' };
    await loadData({ silent: true });
    showToast('预设已保存', name);
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

function updateCharacterFormField(element) {
    const form = element.dataset.characterScope === 'create'
        ? state.characterCreating.form
        : state.characterEditing.form;
    form[element.dataset.characterField] = element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element.value;
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

function arrayToEntryInput(value) {
    return Array.isArray(value) ? value.join(', ') : String(value || '');
}

function entryInputToArray(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function alternateGreetingsToInput(value) {
    return Array.isArray(value) ? value.join('\n---\n') : '';
}

function inputToAlternateGreetings(value) {
    return String(value || '')
        .split(/\n\s*---\s*\n/g)
        .map(item => item.trim())
        .filter(Boolean);
}

function numberInput(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function setObjectPath(target, path, value) {
    const parts = String(path || '').split('.').filter(Boolean);
    if (!target || !parts.length) {
        return;
    }

    let cursor = target;
    for (const part of parts.slice(0, -1)) {
        if (!cursor[part] || typeof cursor[part] !== 'object') {
            cursor[part] = {};
        }
        cursor = cursor[part];
    }
    cursor[parts.at(-1)] = value;
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
        probability: String(entry?.probability ?? worldEntryDefaults.probability),
        constant: !!entry?.constant,
        vectorized: !!entry?.vectorized,
        selective: entry?.selective !== false,
        useProbability: entry?.useProbability !== false,
        disable: !!entry?.disable,
        ignoreBudget: !!entry?.ignoreBudget,
        excludeRecursion: !!entry?.excludeRecursion,
        preventRecursion: !!entry?.preventRecursion,
    };
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
        probability: Math.max(0, Math.min(100, numberInput(form.probability, worldEntryDefaults.probability))),
        constant: !!form.constant,
        vectorized: !!form.vectorized,
        selective: !!form.selective,
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
        key: ['keys', entry.key],
        keysecondary: ['secondary_keys', entry.keysecondary],
        selective: ['selective', entry.selective],
        vectorized: ['extensions.vectorized', entry.vectorized],
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

function parsePreset(rawPreset) {
    if (!rawPreset) {
        return null;
    }
    if (typeof rawPreset === 'string') {
        try {
            return JSON.parse(rawPreset);
        } catch {
            return null;
        }
    }
    return structuredClone(rawPreset);
}

function applyOpenAiPresetFields(settings, preset) {
    const fieldMap = {
        temperature: ['temp_openai', false],
        frequency_penalty: ['freq_pen_openai', false],
        presence_penalty: ['pres_pen_openai', false],
        top_p: ['top_p_openai', false],
        top_k: ['top_k_openai', false],
        top_a: ['top_a_openai', false],
        min_p: ['min_p_openai', false],
        repetition_penalty: ['repetition_penalty_openai', false],
        max_context_unlocked: ['max_context_unlocked', false],
        openai_max_context: ['openai_max_context', false],
        openai_max_tokens: ['openai_max_tokens', false],
        names_behavior: ['names_behavior', false],
        send_if_empty: ['send_if_empty', false],
        impersonation_prompt: ['impersonation_prompt', false],
        new_chat_prompt: ['new_chat_prompt', false],
        new_group_chat_prompt: ['new_group_chat_prompt', false],
        new_example_chat_prompt: ['new_example_chat_prompt', false],
        continue_nudge_prompt: ['continue_nudge_prompt', false],
        bias_preset_selected: ['bias_preset_selected', false],
        wi_format: ['wi_format', false],
        scenario_format: ['scenario_format', false],
        personality_format: ['personality_format', false],
        group_nudge_prompt: ['group_nudge_prompt', false],
        stream_openai: ['stream_openai', false],
        prompts: ['prompts', false],
        prompt_order: ['prompt_order', false],
        chat_completion_source: ['chat_completion_source', true],
        openai_model: ['openai_model', true],
        claude_model: ['claude_model', true],
        openrouter_model: ['openrouter_model', true],
        ai21_model: ['ai21_model', true],
        mistralai_model: ['mistralai_model', true],
        cohere_model: ['cohere_model', true],
        perplexity_model: ['perplexity_model', true],
        groq_model: ['groq_model', true],
        chutes_model: ['chutes_model', true],
        siliconflow_model: ['siliconflow_model', true],
        siliconflow_endpoint: ['siliconflow_endpoint', true],
        minimax_model: ['minimax_model', true],
        minimax_endpoint: ['minimax_endpoint', true],
        electronhub_model: ['electronhub_model', true],
        nanogpt_model: ['nanogpt_model', true],
        deepseek_model: ['deepseek_model', true],
        aimlapi_model: ['aimlapi_model', true],
        xai_model: ['xai_model', true],
        pollinations_model: ['pollinations_model', true],
        moonshot_model: ['moonshot_model', true],
        fireworks_model: ['fireworks_model', true],
        cometapi_model: ['cometapi_model', true],
        custom_model: ['custom_model', true],
        custom_url: ['custom_url', true],
        custom_include_body: ['custom_include_body', true],
        custom_exclude_body: ['custom_exclude_body', true],
        custom_include_headers: ['custom_include_headers', true],
        custom_prompt_post_processing: ['custom_prompt_post_processing', true],
        google_model: ['google_model', true],
        vertexai_model: ['vertexai_model', true],
        zai_model: ['zai_model', true],
        zai_endpoint: ['zai_endpoint', true],
        workers_ai_model: ['workers_ai_model', true],
        workers_ai_account_id: ['workers_ai_account_id', true],
        reverse_proxy: ['reverse_proxy', true],
        proxy_password: ['proxy_password', true],
    };
    const useConnectionFields = Boolean(settings.bind_preset_to_connection);

    for (const [presetKey, [settingsKey, isConnection]] of Object.entries(fieldMap)) {
        if (isConnection && !useConnectionFields) {
            continue;
        }
        if (preset[presetKey] !== undefined) {
            settings[settingsKey] = structuredClone(preset[presetKey]);
        }
    }

    if (preset.extensions) {
        settings.extensions = structuredClone(preset.extensions);
    }
}

async function useOpenAiPreset(presetName) {
    const group = getPresetGroups().find(item => item.id === 'openai');
    const presetIndex = group?.names.indexOf(presetName) ?? -1;
    const preset = parsePreset(presetIndex >= 0 ? group.contents[presetIndex] : null);
    if (!preset) {
        throw new Error('预设读取失败。');
    }

    state.settings.oai_settings = state.settings.oai_settings || {};
    state.settings.oai_settings.preset_settings_openai = presetName;
    applyOpenAiPresetFields(state.settings.oai_settings, preset);
    await apiFetch('/api/settings/save', { body: state.settings });
    await loadData({ silent: true });
    showToast('预设已切换', `当前聊天补全预设：${presetName}`);
}

function responseContentToText(content) {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content.map(item => item?.text || item?.content || '').filter(Boolean).join('\n');
    }
    return '';
}

function extractAssistantText(response) {
    if (response?.error) {
        throw new Error(response.error.message || String(response.error));
    }

    const choice = response?.choices?.[0];
    const text = responseContentToText(choice?.message?.content)
        || responseContentToText(choice?.delta?.content)
        || responseContentToText(choice?.text)
        || responseContentToText(response?.message?.content)
        || responseContentToText(response?.content);

    if (!text.trim()) {
        throw new Error('模型没有返回可显示内容。');
    }

    return text.trim();
}

async function testApiConnection() {
    if (state.apiTest.running) {
        return;
    }

    const settings = getChatCompletionSettings();
    const body = createChatCompletionRequestBody(settings, [
        { role: 'user', content: '请只回复 OK。' },
    ]);
    body.max_tokens = Math.min(settings.maxTokens, 20);

    state.apiTest = {
        running: true,
        status: '测试中',
        detail: `${settings.source} / ${settings.model}`,
    };
    render();

    try {
        const response = await apiFetch('/api/backends/chat-completions/generate', { body });
        const text = extractAssistantText(response);
        state.apiTest = {
            running: false,
            status: '可用',
            detail: `${settings.model}: ${text.slice(0, 80)}`,
        };
        showToast('连接测试成功', state.apiTest.detail);
    } catch (error) {
        state.apiTest = {
            running: false,
            status: '失败',
            detail: error.message,
        };
        throw error;
    } finally {
        render();
    }
}

function createChatCompletionRequestBody(settings, messages) {
    return {
        chat_completion_source: settings.source,
        messages,
        model: settings.model,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        stream: false,
        top_p: settings.topP,
        frequency_penalty: settings.frequencyPenalty,
        presence_penalty: settings.presencePenalty,
        siliconflow_endpoint: settings.siliconflowEndpoint,
        minimax_endpoint: settings.minimaxEndpoint,
        custom_url: settings.customUrl,
        reverse_proxy: settings.reverseProxy,
        proxy_password: settings.proxyPassword,
        n: 1,
    };
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
    state.engine.status = '原版生成中';
    state.engine.error = '';
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
        state.engine.status = '就绪';
        showToast(toastTitle, toastMessage);
    } catch (error) {
        state.engine.error = error.message;
        state.engine.status = error.message.includes('停止') ? '已停止' : '生成失败';
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
        state.engine.status = '就绪';
        showToast('候选已切换', `当前候选 ${formatNumber((result?.swipeId || 0) + 1)}/${formatNumber(result?.swipeCount || 1)}`);
    } catch (error) {
        state.engine.error = error.message;
        state.engine.status = '候选切换失败';
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
        toastMessage: '原版生成引擎已完成回复并保存聊天文件。',
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
        toastMessage: '原版生成引擎已更新最后一条回复。',
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
        toastMessage: '原版生成引擎已追加到当前回复。',
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
    showToast('消息已删除', deletedMessage?.name || '当前聊天');
    render();
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

function renderNav() {
    elements.navList.innerHTML = routes.map(route => {
        const count = getRouteCount(route.id);
        return `
            <button class="nav-button ${route.id === state.route ? 'active' : ''}" type="button" data-route="${route.id}">
                <i class="fa-solid ${route.icon}"></i>
                <span>${escapeHtml(route.label)}</span>
                ${count !== '' ? `<span class="nav-count">${formatNumber(count)}</span>` : ''}
            </button>
        `;
    }).join('');
}

function renderStatus() {
    const provider = getProviderInfo();
    const isError = state.errors.length > 0;
    const label = state.loading ? '读取中' : (isError ? '部分失败' : provider.api);
    const dotClass = state.loading ? 'muted' : (isError ? 'warning' : '');
    elements.connectionStatus.innerHTML = `
        <span class="dot ${dotClass}"></span>
        <span>${escapeHtml(label)}</span>
    `;
}

function pageHead(title, description, actions = '') {
    return `
        <div class="page-head">
            <div>
                <p class="eyebrow">${escapeHtml(routeLabels[state.route] || 'Workspace')}</p>
                <h1 class="page-title">${escapeHtml(title)}</h1>
                ${description ? `<p class="page-description">${escapeHtml(description)}</p>` : ''}
            </div>
            <div class="page-actions">${actions}</div>
        </div>
    `;
}

function legacyMenu(label) {
    return `
        <details class="legacy-menu">
            <summary class="secondary-button">
                <i class="fa-solid fa-ellipsis"></i>
                更多
            </summary>
            <div class="legacy-menu-panel">
                <button class="secondary-button ghost-action" type="button" data-open-legacy>
                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    ${escapeHtml(label)}
                </button>
            </div>
        </details>
    `;
}

function metricCard(label, value, detail, icon) {
    return `
        <section class="metric-card">
            <div class="metric-label"><i class="fa-solid ${icon}"></i> ${escapeHtml(label)}</div>
            <div class="metric-value">${escapeHtml(value)}</div>
            <div class="metric-delta">${escapeHtml(detail)}</div>
        </section>
    `;
}

function renderDashboard() {
    const provider = getProviderInfo();
    const recentCharacters = [...state.characters]
        .sort((a, b) => Number(b.date_last_chat || b.date_added || 0) - Number(a.date_last_chat || a.date_added || 0))
        .slice(0, 6);

    return `
        ${pageHead('工作台', '资源、连接和最近会话。', `
            ${legacyMenu('打开原版')}
            <button class="primary-button" type="button" data-route="chat">
                <i class="fa-solid fa-comments"></i>
                进入聊天
            </button>
        `)}
        <div class="metrics-grid">
            ${metricCard('角色', formatNumber(state.characters.length), '可用于聊天和人设转换', 'fa-address-card')}
            ${metricCard('世界书', formatNumber(state.worldbooks.length || provider.worldCount), '上下文知识库', 'fa-book-open')}
            ${metricCard('预设', formatNumber(getPresetCount()), '模型、指令、上下文模板', 'fa-sliders')}
            ${metricCard('素材', formatNumber(getAssetCount()), '背景、音频、Live2D、VRM', 'fa-folder-tree')}
        </div>
        <div class="dashboard-grid">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">当前连接</h2>
                        <p class="panel-subtitle">从现有设置读取，不展示任何密钥。</p>
                    </div>
                    <span class="badge">${provider.extensionsEnabled ? '扩展开启' : '扩展关闭'}</span>
                </div>
                <div class="table-wrap">
                    <table>
                        <tbody>
                            <tr><th>主 API</th><td>${escapeHtml(provider.api)}</td></tr>
                            <tr><th>聊天补全来源</th><td>${escapeHtml(provider.chatSource || '未配置')}</td></tr>
                            <tr><th>模型</th><td>${escapeHtml(provider.model || '未读取到模型字段')}</td></tr>
                            <tr><th>预设字段</th><td>${escapeHtml(provider.preset || '未读取到当前预设字段')}</td></tr>
                        </tbody>
                    </table>
                </div>
            </section>
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">资源概览</h2>
                        <p class="panel-subtitle">优先显示需要经常操作的对象。</p>
                    </div>
                </div>
                <div class="resource-list">
                    ${recentCharacters.map(character => renderCharacterRow(character)).join('') || renderInlineEmpty('暂无角色')}
                </div>
            </section>
        </div>
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">快捷入口</h2>
                    <p class="panel-subtitle">按常用工作流进入对应页面。</p>
                </div>
            </div>
            <div class="action-grid">
                ${renderActionCard('聊天', '查看角色会话和历史消息', `${formatNumber(state.characters.length)} 个角色`, 'fa-comments', 'chat')}
                ${renderActionCard('角色', '检查角色卡和关联世界书', `${formatNumber(state.characters.length)} 张卡`, 'fa-address-card', 'characters')}
                ${renderActionCard('世界书', '查看知识库文件和条目', `${formatNumber(state.worldbooks.length || provider.worldCount)} 本`, 'fa-book-open', 'worldbooks')}
                ${renderActionCard('预设', '浏览模型参数和提示模板', `${formatNumber(getPresetCount())} 个`, 'fa-sliders', 'presets')}
                ${renderActionCard('API', '检查连接、模型和密钥状态', provider.api, 'fa-plug', 'api')}
                ${renderActionCard('扩展', '查看已发现扩展', `${formatNumber(state.extensions.length)} 个`, 'fa-cubes', 'extensions')}
            </div>
        </section>
    `;
}

function renderActionCard(title, detail, meta, icon, routeId) {
    return `
        <button class="action-card" type="button" data-route="${routeId}">
            <span class="action-icon"><i class="fa-solid ${icon}"></i></span>
            <span class="action-body">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(detail)}</span>
            </span>
            <span class="badge">${escapeHtml(meta)}</span>
        </button>
    `;
}

function renderInlineEmpty(text) {
    return `<div class="muted">${escapeHtml(text)}</div>`;
}

function renderCharacterRow(character) {
    const avatar = getAvatarUrl(character);
    const title = character.name || character.data?.name || character.avatar || '未命名角色';
    const subtitle = [
        character.data?.creator ? `作者 ${character.data.creator}` : '',
        character.date_last_chat ? `最近 ${formatDate(character.date_last_chat)}` : '',
    ].filter(Boolean).join(' · ') || character.avatar || '角色卡';

    return `
        <button class="resource-row ${state.selected.character === character.avatar ? 'active' : ''}" type="button" data-select-character="${escapeHtml(character.avatar)}">
            ${avatar ? `<img class="avatar" src="${avatar}" alt="">` : '<span class="avatar-fallback">C</span>'}
            <span class="row-main">
                <span class="row-title">${escapeHtml(title)}</span>
                <span class="row-subtitle">${escapeHtml(subtitle)}</span>
            </span>
        </button>
    `;
}

function renderGroupRow(group) {
    const avatar = getChatEntityAvatarUrl(group);
    const memberCount = Array.isArray(group.members) ? group.members.length : 0;
    const chatCount = Array.isArray(group.chats) ? group.chats.length : 0;
    const subtitle = [
        `${formatNumber(memberCount)} 个成员`,
        `${formatNumber(chatCount)} 个会话`,
        group.date_last_chat ? `最近 ${formatDate(group.date_last_chat)}` : '',
    ].filter(Boolean).join(' · ') || group.id || '群聊';

    return `
        <button class="resource-row ${state.selected.group === group.id ? 'active' : ''}" type="button" data-select-group="${escapeHtml(group.id)}">
            ${avatar ? `<img class="avatar" src="${avatar}" alt="">` : '<span class="avatar-fallback"><i class="fa-solid fa-users"></i></span>'}
            <span class="row-main">
                <span class="row-title">${escapeHtml(group.name || group.id || '未命名群聊')}</span>
                <span class="row-subtitle">${escapeHtml(subtitle)}</span>
            </span>
        </button>
    `;
}

function renderChat() {
    const characters = state.characters.filter(character => matchesQuery(character.name, character.avatar, character.data?.creator));
    const groups = state.groups.filter(group => matchesQuery(group.name, group.id, ...(Array.isArray(group.members) ? group.members : [])));
    const selected = getSelectedChatEntity() || (isGroupChatMode() ? groups[0] : characters[0]);
    if (!isGroupChatMode() && selected?.avatar && state.selected.character !== selected.avatar) {
        state.selected.character = selected.avatar;
    }
    if (isGroupChatMode() && selected?.id && state.selected.group !== selected.id) {
        state.selected.group = selected.id;
    }
    const contextKey = getChatContextKey(selected);
    const resourceCount = isGroupChatMode() ? groups.length : characters.length;
    const allChats = getSelectedChatList();
    const chats = getVisibleChatList(selected);
    const isLoadingChats = !!state.loadingChats[contextKey];
    const isSearching = state.chatSearch.loading;
    const searchActive = state.chatSearch.contextKey === contextKey && !!state.chatSearch.searchedQuery;
    const searchSummary = searchActive
        ? `${formatNumber(chats.length)} 个搜索结果 / ${formatNumber(allChats.length)} 个会话`
        : (isLoadingChats ? '读取中' : `${formatNumber(allChats.length)} 个会话`);
    const chatImportAccept = isGroupChatMode() ? '.jsonl' : '.json,.jsonl';
    const resourceRows = isGroupChatMode()
        ? (groups.map(group => renderGroupRow(group)).join('') || renderInlineEmpty(getChatEntityListEmptyText()))
        : (characters.map(character => renderCharacterRow(character)).join('') || renderInlineEmpty(getChatEntityListEmptyText()));

    return `
        ${pageHead('聊天工作区', '角色、会话文件和消息预览。', `
            <label class="secondary-button file-action">
                <i class="fa-solid fa-file-import"></i>
                导入聊天
                <input class="visually-hidden" type="file" accept="${chatImportAccept}" multiple data-chat-import-file>
            </label>
            <button class="secondary-button" type="button" data-chat-backups-toggle>
                <i class="fa-solid fa-clock-rotate-left"></i>
                ${state.chatBackups.open ? '收起备份' : '聊天备份'}
            </button>
            <button class="secondary-button" type="button" data-toggle-chat-sidebar>
                <i class="fa-solid ${state.chatSidebarOpen ? 'fa-table-columns' : 'fa-list'}"></i>
                ${state.chatSidebarOpen ? '收起列表' : '展开列表'}
            </button>
            ${legacyMenu('打开原版聊天')}
        `)}
        <div class="chat-layout ${state.chatSidebarOpen ? '' : 'chat-sidebar-collapsed'}">
            ${state.chatSidebarOpen ? `
                <aside class="chat-browser">
                <section class="panel chat-browser-panel">
                    <div class="panel-header">
                        <div>
                            <h2 class="panel-title">${getChatModeLabel()}</h2>
                            <p class="panel-subtitle">${formatNumber(resourceCount)} 个匹配项</p>
                        </div>
                    </div>
                    <div class="segmented-control chat-mode-switch" role="tablist" aria-label="聊天类型">
                        <button class="${state.chatMode === 'character' ? 'active' : ''}" type="button" data-chat-mode="character" aria-selected="${state.chatMode === 'character'}">
                            <i class="fa-solid fa-user"></i>
                            角色
                        </button>
                        <button class="${state.chatMode === 'group' ? 'active' : ''}" type="button" data-chat-mode="group" aria-selected="${state.chatMode === 'group'}">
                            <i class="fa-solid fa-users"></i>
                            群聊
                        </button>
                    </div>
                    <div class="resource-list">
                        ${resourceRows}
                    </div>
                </section>
                <section class="panel chat-browser-panel">
	                    <div class="panel-header">
	                        <div>
	                            <h2 class="panel-title">聊天文件</h2>
	                            <p class="panel-subtitle">${escapeHtml(searchSummary)}</p>
	                        </div>
	                        <button class="icon-button" type="button" data-new-chat title="新聊天" ${selected ? '' : 'disabled'}>
	                            <i class="fa-solid fa-plus"></i>
	                        </button>
	                    </div>
	                    <div class="chat-search-row">
	                        <input class="text-input" type="search" data-chat-search-input value="${escapeHtml(state.chatSearch.query)}" placeholder="搜索文件名和消息内容">
	                        <button class="icon-button" type="button" data-chat-search-run title="搜索聊天" ${selected && !isSearching ? '' : 'disabled'}>
	                            <i class="fa-solid ${isSearching ? 'fa-circle-notch fa-spin' : 'fa-magnifying-glass'}"></i>
	                        </button>
	                        <button class="icon-button" type="button" data-chat-search-clear title="清空搜索" ${state.chatSearch.query || state.chatSearch.searchedQuery ? '' : 'disabled'}>
	                            <i class="fa-solid fa-xmark"></i>
	                        </button>
	                    </div>
	                    <div class="resource-list">
	                        ${chats.map(chat => renderChatFileRow(chat)).join('') || renderInlineEmpty(selected ? `这个${getChatModeLabel()}暂无聊天文件` : `先选择一个${getChatModeLabel()}`)}
	                    </div>
	                </section>
	            </aside>
            ` : ''}
	            <section class="panel chat-thread">
	                ${selected ? renderChatThread(selected, { compactContext: !state.chatSidebarOpen, chatCount: allChats.length }) : renderEmptyState(isGroupChatMode() ? 'fa-users' : 'fa-address-card', getChatEntityEmptyTitle(), getChatEntityEmptyDescription())}
	            </section>
	        </div>
	        ${state.chatBackups.open ? renderChatBackupsPanel() : ''}
	    `;
}

function renderChatFileRow(chat) {
    const chatId = getChatId(chat);
    const messageCount = getChatMessageCount(chat);
    const subtitle = [
        `${formatNumber(messageCount)} 条消息`,
        chat.file_size || '',
        formatDate(chat.last_mes),
    ].filter(Boolean).join(' · ');
    const preview = chat.preview_message || '';

    return `
        <button class="resource-row ${state.selected.chat === chatId ? 'active' : ''}" type="button" data-select-chat="${escapeHtml(chatId)}">
            <span class="avatar-fallback"><i class="fa-solid fa-message"></i></span>
            <span class="row-main">
                <span class="row-title">${escapeHtml(chat.file_name || chatId)}</span>
                <span class="row-subtitle">${escapeHtml(subtitle)}</span>
                ${preview ? `<span class="row-subtitle chat-preview">${escapeHtml(preview)}</span>` : ''}
            </span>
        </button>
    `;
}

function renderChatThread(entity, options = {}) {
    const avatar = getChatEntityAvatarUrl(entity);
    const name = getChatEntityName(entity);
    const contextKey = getChatContextKey(entity);
    const chats = getSelectedChatList();
    const visibleChats = getVisibleChatList(entity);
    const selectedChat = visibleChats.find(chat => getChatId(chat) === state.selected.chat)
        || chats.find(chat => getChatId(chat) === state.selected.chat);
    const messages = getSelectedChatMessages();
    const isRenaming = state.chatRenaming.key === getChatCacheKey(contextKey, state.selected.chat);
    const isDeleting = state.chatDeleteConfirm.key === getChatCacheKey(contextKey, state.selected.chat);
    const memberCount = isGroupChatMode() && Array.isArray(entity?.members) ? entity.members.length : 0;
    const subtitle = isGroupChatMode()
        ? `${formatNumber(memberCount)} 个成员`
        : (entity.data?.creator || entity.avatar || '角色卡');

    return `
        ${options.compactContext ? `
            <div class="chat-context-strip">
                ${avatar ? `<img class="avatar" src="${avatar}" alt="">` : `<span class="avatar-fallback"><i class="fa-solid ${getChatEntityFallbackIcon()}"></i></span>`}
                <span class="row-main">
                    <strong>${escapeHtml(name)}</strong>
                    <span class="row-subtitle">${escapeHtml(selectedChat?.file_name || '未选择聊天文件')} · ${formatNumber(options.chatCount || chats.length)} 个会话</span>
                </span>
                <button class="secondary-button" type="button" data-toggle-chat-sidebar>
                    <i class="fa-solid fa-list"></i>
                    选择${getChatModeLabel()}/会话
                </button>
            </div>
        ` : ''}
        <div class="detail-hero">
            ${avatar ? `<img class="avatar large" src="${avatar}" alt="">` : `<span class="avatar-fallback large"><i class="fa-solid ${getChatEntityFallbackIcon()}"></i></span>`}
            <div>
                <h2 class="detail-title">${escapeHtml(name)}</h2>
                <p class="panel-subtitle">${escapeHtml(selectedChat?.file_name || subtitle)}</p>
                <div class="tag-row detail-tags">
                    <span class="tag">${formatNumber(messages.length)} 条消息</span>
                    <span class="tag">${escapeHtml(selectedChat?.file_size || '0 B')}</span>
                    <span class="tag">${escapeHtml(formatDate(selectedChat?.last_mes))}</span>
                    ${isGroupChatMode() ? `<span class="tag">${formatNumber(memberCount)} 个成员</span>` : ''}
                    <span class="tag">${escapeHtml(state.engine.status)}</span>
                </div>
            </div>
            ${selectedChat ? `
                <div class="page-actions detail-actions">
                    <button class="secondary-button" type="button" data-export-chat="txt">
                        <i class="fa-solid fa-file-lines"></i>
                        导出 TXT
                    </button>
                    <button class="secondary-button" type="button" data-export-chat="jsonl">
                        <i class="fa-solid fa-file-code"></i>
                        导出 JSONL
                    </button>
                    <button class="secondary-button" type="button" data-rename-chat ${isRenaming ? 'disabled' : ''}>
                        <i class="fa-solid fa-pen-to-square"></i>
                        重命名
                    </button>
                    <button class="secondary-button danger-action" type="button" data-delete-chat>
                        <i class="fa-solid fa-trash"></i>
                        删除
                    </button>
                </div>
            ` : ''}
        </div>
        ${isRenaming ? renderChatRenamePanel() : ''}
        ${isDeleting ? renderChatDeletePanel() : ''}
        ${messages.length ? renderMessageList(messages) : renderEmptyState('fa-comments', chats.length ? '聊天文件为空' : '暂无聊天记录', chats.length ? '这个聊天文件没有可显示消息。' : '历史消息会在这里显示。')}
        <div class="composer">
            <textarea data-chat-input placeholder="输入消息，按 Ctrl/⌘ + Enter 发送">${escapeHtml(getCurrentDraft())}</textarea>
            <button class="primary-button" type="button" data-send-message ${state.engine.generating ? 'disabled' : ''}>
                <i class="fa-solid ${state.engine.generating ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'}"></i>
                ${state.engine.generating ? '生成中' : '发送'}
            </button>
            ${!state.engine.generating && messages.length ? `
                <button class="secondary-button" type="button" data-continue-message>
                    <i class="fa-solid fa-forward-step"></i>
                    继续
                </button>
                <button class="secondary-button" type="button" data-regenerate-message>
                    <i class="fa-solid fa-rotate-right"></i>
                    重生成
                </button>
            ` : ''}
            ${state.engine.generating ? `
                <button class="secondary-button" type="button" data-stop-generation>
                    <i class="fa-solid fa-stop"></i>
                    停止
                </button>
            ` : ''}
        </div>
    `;
}

function renderChatDeletePanel() {
    return `
        <div class="settings-form inline-form danger-panel">
            <div>
                <strong>删除聊天文件</strong>
                <p class="panel-subtitle">将删除 ${escapeHtml(state.chatDeleteConfirm.name)}.jsonl，操作不可撤销。</p>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-chat-delete>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button danger-action" type="button" data-confirm-chat-delete>
                    <i class="fa-solid fa-trash"></i>
                    确认删除
                </button>
            </div>
        </div>
    `;
}

function renderChatRenamePanel() {
    return `
        <div class="settings-form inline-form">
            <label class="field-label">
                <span>聊天文件名</span>
                <input class="text-input" type="text" data-chat-rename-input value="${escapeHtml(state.chatRenaming.name)}" autocomplete="off">
            </label>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-chat-rename>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="primary-button" type="button" data-save-chat-rename>
                    <i class="fa-solid fa-check"></i>
                    保存
                </button>
            </div>
        </div>
    `;
}

function renderChatBackupsPanel() {
    const backups = state.chatBackups.items;
    const isLoading = state.chatBackups.loading;
    const targetLabel = `当前选中${getChatModeLabel()}`;

    return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">聊天备份</h2>
                    <p class="panel-subtitle">自动保存的聊天备份；恢复会导入到${targetLabel}，不覆盖原文件。</p>
                </div>
                <button class="secondary-button" type="button" data-chat-backups-refresh ${isLoading ? 'disabled' : ''}>
                    <i class="fa-solid ${isLoading ? 'fa-circle-notch fa-spin' : 'fa-rotate'}"></i>
                    刷新备份
                </button>
            </div>
            <div class="backup-layout">
                <div class="resource-list backup-list">
                    ${backups.map(backup => renderChatBackupRow(backup)).join('') || renderInlineEmpty(isLoading ? '正在读取备份' : '暂无聊天备份')}
                </div>
                <div class="backup-preview">
                    ${state.chatBackups.previewName ? `
                        <div class="panel-header compact-header">
                            <div>
                                <h3 class="panel-title">${escapeHtml(state.chatBackups.previewName)}</h3>
                                <p class="panel-subtitle">预览最近 40 条可读消息。</p>
                            </div>
                        </div>
                        <textarea readonly>${escapeHtml(state.chatBackups.previewText)}</textarea>
                    ` : renderEmptyState('fa-eye', '未选择备份', `点击“预览”查看备份内容，或点击“恢复”导入到${targetLabel}。`)}
                </div>
            </div>
        </section>
    `;
}

function renderChatBackupRow(backup) {
    const name = backup.file_name || backup.file_id || '';
    const isDeleting = state.chatBackups.deleteConfirm === name;
    const isBusy = state.chatBackups.restoring === name || (isDeleting && state.chatBackups.deleting);
    const meta = [
        `${formatNumber(getChatMessageCount(backup))} 条消息`,
        backup.file_size || '',
        formatDate(backup.last_mes),
    ].filter(Boolean).join(' · ');

    return `
        <article class="backup-row ${state.chatBackups.previewName === name ? 'active' : ''}">
            <div class="row-main">
                <strong class="row-title">${escapeHtml(name)}</strong>
                <span class="row-subtitle">${escapeHtml(meta)}</span>
            </div>
            <div class="row-actions">
                <button class="secondary-button" type="button" data-view-chat-backup="${escapeHtml(name)}" ${isBusy ? 'disabled' : ''}>
                    <i class="fa-solid fa-eye"></i>
                    预览
                </button>
                <button class="secondary-button" type="button" data-restore-chat-backup="${escapeHtml(name)}" ${isBusy ? 'disabled' : ''}>
                    <i class="fa-solid ${state.chatBackups.restoring === name ? 'fa-circle-notch fa-spin' : 'fa-file-import'}"></i>
                    恢复
                </button>
                ${isDeleting ? `
                    <button class="secondary-button" type="button" data-cancel-chat-backup-delete ${state.chatBackups.deleting ? 'disabled' : ''}>
                        取消
                    </button>
                    <button class="secondary-button danger-action" type="button" data-confirm-chat-backup-delete ${state.chatBackups.deleting ? 'disabled' : ''}>
                        <i class="fa-solid ${state.chatBackups.deleting ? 'fa-circle-notch fa-spin' : 'fa-trash'}"></i>
                        确认删除
                    </button>
                ` : `
                    <button class="secondary-button danger-action" type="button" data-delete-chat-backup="${escapeHtml(name)}" ${isBusy ? 'disabled' : ''}>
                        <i class="fa-solid fa-trash"></i>
                        删除
                    </button>
                `}
            </div>
        </article>
    `;
}

function renderMessageList(messages) {
    const startIndex = Math.max(messages.length - 80, 0);

    return `
        <div class="message-list">
            ${messages.slice(-80).map((message, index) => renderMessage(message, startIndex + index)).join('')}
        </div>
    `;
}

function renderInlineMessageText(value) {
    return escapeHtml(value)
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

function renderMessageText(value) {
    const text = String(value || '[空消息]');
    const parts = text.split(/```([\s\S]*?)```/g);
    return parts.map((part, index) => {
        if (index % 2 === 1) {
            const code = part.replace(/^\n|\n$/g, '');
            return `<pre><code>${escapeHtml(code)}</code></pre>`;
        }

        return part
            .split(/\n{2,}/)
            .map(paragraph => paragraph.trim() ? `<p>${renderInlineMessageText(paragraph)}</p>` : '')
            .join('');
    }).join('');
}

function getMessageReasoning(message) {
    return message.extra?.reasoning_display_text || message.extra?.reasoning || message.swipe_info?.[message.swipe_id || 0]?.extra?.reasoning || '';
}

function renderMessageReasoning(message) {
    const reasoning = getMessageReasoning(message);
    if (!reasoning) {
        return '';
    }

    return `
        <details class="message-reasoning">
            <summary>推理内容</summary>
            <div>${renderMessageText(reasoning)}</div>
        </details>
    `;
}

function isImageAttachment(attachment) {
    const type = String(attachment?.type || '');
    const url = String(attachment?.url || attachment?.image || '');
    return type.includes('image') || /\.(png|jpe?g|gif|webp|svg)$/i.test(url);
}

function isAudioAttachment(attachment) {
    const type = String(attachment?.type || '');
    const url = String(attachment?.url || '');
    return type.includes('audio') || /\.(mp3|wav|ogg|m4a|flac)$/i.test(url);
}

function isVideoAttachment(attachment) {
    const type = String(attachment?.type || '');
    const url = String(attachment?.url || '');
    return type.includes('video') || /\.(mp4|webm|mov)$/i.test(url);
}

function renderMessageMediaItem(attachment, index) {
    const url = attachment?.url || attachment?.image || attachment?.src || '';
    const title = attachment?.title || attachment?.name || `媒体 ${index + 1}`;
    if (!url) {
        return '';
    }

    if (isImageAttachment(attachment)) {
        return `<figure class="message-media-item"><img src="${escapeHtml(url)}" alt="${escapeHtml(title)}"><figcaption>${escapeHtml(title)}</figcaption></figure>`;
    }
    if (isAudioAttachment(attachment)) {
        return `<figure class="message-media-item"><audio controls src="${escapeHtml(url)}"></audio><figcaption>${escapeHtml(title)}</figcaption></figure>`;
    }
    if (isVideoAttachment(attachment)) {
        return `<figure class="message-media-item"><video controls src="${escapeHtml(url)}"></video><figcaption>${escapeHtml(title)}</figcaption></figure>`;
    }

    return `<a class="message-file" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>`;
}

function renderMessageAttachments(message) {
    const media = Array.isArray(message.extra?.media) ? message.extra.media : [];
    const files = Array.isArray(message.extra?.files) ? message.extra.files : [];
    if (!media.length && !files.length) {
        return '';
    }

    return `
        <div class="message-attachments">
            ${media.length ? `<div class="message-media-grid">${media.map((item, index) => renderMessageMediaItem(item, index)).join('')}</div>` : ''}
            ${files.map(file => `
                <span class="message-file">
                    <i class="fa-solid fa-paperclip"></i>
                    ${escapeHtml(file.name || '附件')}
                    ${file.size ? `<span>${escapeHtml(formatBytes(file.size))}</span>` : ''}
                </span>
            `).join('')}
        </div>
    `;
}

function renderMessageFoot(message, model) {
    const details = [
        model,
        Array.isArray(message.swipes) && message.swipes.length > 1 ? `候选 ${(message.swipe_id || 0) + 1}/${message.swipes.length}` : '',
        message.extra?.token_count ? `${formatNumber(message.extra.token_count)} tokens` : '',
    ].filter(Boolean);

    return details.length ? `<footer class="message-foot">${details.map(detail => `<span>${escapeHtml(detail)}</span>`).join('')}</footer>` : '';
}

function renderMessage(message, messageIndex) {
    const name = message.name || (message.is_user ? 'You' : 'Character');
    const text = message.extra?.display_text || message.mes || '[空消息]';
    const model = message.extra?.model || message.extra?.api || '';
    const isEditing = state.chatEditing.key === getCurrentDraftKey() && state.chatEditing.index === messageIndex;
    const canSwipe = !message.is_user && !message.is_system && messageIndex === getSelectedChatMessages().length - 1;

    return `
        <article class="message ${message.is_user ? 'user' : ''}">
            <header class="message-meta">
                <strong>${escapeHtml(name)}</strong>
                <span class="message-actions">
                    <span>${escapeHtml(formatDate(message.send_date))}</span>
                    ${canSwipe ? `
                        <button class="icon-button mini" type="button" data-swipe-message="${messageIndex}" data-swipe-direction="left" title="上一个候选">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                        <button class="icon-button mini" type="button" data-swipe-message="${messageIndex}" data-swipe-direction="right" title="下一个候选">
                            <i class="fa-solid fa-chevron-right"></i>
                        </button>
                    ` : ''}
                    <button class="icon-button mini" type="button" data-copy-message="${messageIndex}" title="复制消息">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                    <button class="icon-button mini" type="button" data-edit-message="${messageIndex}" title="编辑消息" ${isEditing ? 'disabled' : ''}>
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="icon-button mini danger" type="button" data-delete-message="${messageIndex}" title="删除消息">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </span>
            </header>
            ${isEditing ? `
                <div class="message-edit">
                    <textarea data-edit-message-input="${messageIndex}">${escapeHtml(state.chatEditing.text)}</textarea>
                    <div class="message-edit-actions">
                        <button class="secondary-button" type="button" data-cancel-edit-message>
                            <i class="fa-solid fa-xmark"></i>
                            取消
                        </button>
                        <button class="primary-button" type="button" data-save-edit-message>
                            <i class="fa-solid fa-check"></i>
                            保存
                        </button>
                    </div>
                </div>
            ` : `<div class="message-body">${renderMessageText(text)}</div>`}
            ${renderMessageReasoning(message)}
            ${renderMessageAttachments(message)}
            ${renderMessageFoot(message, model)}
        </article>
    `;
}

function renderCharacters() {
    const characters = state.characters.filter(character => matchesQuery(character.name, character.avatar, character.data?.creator, character.data?.tags?.join(' ')));
    const selected = state.characters.find(character => character.avatar === state.selected.character) || characters[0];
    if (selected && state.selected.character !== selected.avatar) {
        state.selected.character = selected.avatar;
    }

    return `
        ${pageHead('角色库', '角色卡、来源、世界书和聊天占用。', `
            <button class="primary-button" type="button" data-create-character>
                <i class="fa-solid fa-plus"></i>
                新建角色
            </button>
            <label class="secondary-button file-action">
                <i class="fa-solid fa-upload"></i>
                导入文件
                <input class="visually-hidden" type="file" accept=".png,.json,.yaml,.yml,.charx,.byaf" data-character-import-file>
            </label>
            ${legacyMenu('打开原版编辑')}
        `)}
        <div class="split-grid">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">角色列表</h2>
                        <p class="panel-subtitle">${formatNumber(characters.length)} 个匹配项</p>
                    </div>
                </div>
                ${state.characterCreating.active ? renderCharacterCreatePanel() : ''}
                <div class="resource-list">
                    ${characters.map(character => renderCharacterRow(character)).join('') || renderInlineEmpty('暂无匹配角色')}
                </div>
            </section>
            <section class="panel">
                ${selected ? renderCharacterDetail(selected) : renderEmptyState('fa-address-card', '暂无角色', '当前用户目录里没有角色卡。')}
            </section>
        </div>
    `;
}

function renderCharacterDetail(character) {
    const detail = state.characterDetails[character.avatar] || character;
    const avatar = getAvatarUrl(detail);
    const name = detail.name || detail.data?.name || '未命名角色';
    const tags = getCharacterTags(detail);
    const isEditing = state.characterEditing.avatar === character.avatar;
    const isRenaming = state.characterRenaming.avatar === character.avatar;
    const isDeleting = state.characterDeleteConfirm.avatar === character.avatar;

    return `
        <div class="detail-hero character-detail-hero">
            ${avatar ? `<img class="avatar large" src="${avatar}" alt="">` : '<span class="avatar-fallback large">C</span>'}
            <div>
                <h2 class="detail-title">${escapeHtml(name)}</h2>
                <p class="panel-subtitle">${escapeHtml(detail.avatar || character.avatar || '角色卡')}</p>
                <div class="tag-row detail-tags">
                    ${tags.slice(0, 8).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('') || '<span class="tag">未打标签</span>'}
                </div>
            </div>
            <div class="detail-actions page-actions">
                <button class="secondary-button" type="button" data-load-character-detail="${escapeHtml(character.avatar)}">
                    <i class="fa-solid fa-database"></i>
                    读取完整卡
                </button>
                <button class="secondary-button" type="button" data-edit-character="${escapeHtml(character.avatar)}" ${isEditing ? 'disabled' : ''}>
                    <i class="fa-solid fa-pen"></i>
                    编辑
                </button>
                <button class="secondary-button" type="button" data-duplicate-character="${escapeHtml(character.avatar)}">
                    <i class="fa-solid fa-copy"></i>
                    复制
                </button>
                <button class="secondary-button" type="button" data-rename-character="${escapeHtml(character.avatar)}">
                    <i class="fa-solid fa-i-cursor"></i>
                    重命名
                </button>
                <button class="secondary-button" type="button" data-export-character="${escapeHtml(character.avatar)}" data-character-export-format="png">
                    <i class="fa-solid fa-image"></i>
                    PNG
                </button>
                <button class="secondary-button" type="button" data-export-character="${escapeHtml(character.avatar)}" data-character-export-format="json">
                    <i class="fa-solid fa-file-code"></i>
                    JSON
                </button>
                <button class="secondary-button danger-action" type="button" data-delete-character="${escapeHtml(character.avatar)}">
                    <i class="fa-solid fa-trash"></i>
                    删除
                </button>
            </div>
        </div>
        ${isRenaming ? renderCharacterRenamePanel(detail) : ''}
        ${isDeleting ? renderCharacterDeletePanel(detail) : ''}
        ${isEditing ? renderCharacterEditPanel(detail) : ''}
        <div class="table-wrap">
            <table>
                <tbody>
                    <tr><th>创建时间</th><td>${escapeHtml(formatDate(detail.create_date || detail.date_added))}</td></tr>
                    <tr><th>最近聊天</th><td>${escapeHtml(formatDate(detail.date_last_chat))}</td></tr>
                    <tr><th>聊天占用</th><td>${escapeHtml(formatBytes(detail.chat_size))}</td></tr>
                    <tr><th>卡片大小</th><td>${escapeHtml(formatBytes(detail.data_size))}</td></tr>
                    <tr><th>作者</th><td>${escapeHtml(detail.data?.creator || '未知')}</td></tr>
                    <tr><th>关联世界书</th><td>${escapeHtml(detail.data?.extensions?.world || '未关联')}</td></tr>
                </tbody>
            </table>
        </div>
        <p class="detail-text">${escapeHtml(detail.description || detail.data?.description || detail.data?.creator_notes || '当前列表接口未返回完整角色描述。')}</p>
    `;
}

function renderCharacterCreatePanel() {
    return `
        <div class="settings-form inline-form">
            <strong>新建角色</strong>
            ${renderCharacterFormContent(state.characterCreating.form, 'create', true)}
        </div>
    `;
}

function renderCharacterEditPanel(character) {
    return `
        <div class="settings-form inline-form">
            <strong>编辑角色卡</strong>
            ${renderCharacterFormContent(state.characterEditing.form || characterToForm(character), 'edit', false)}
        </div>
    `;
}

function renderCharacterRenamePanel(character) {
    return `
        <div class="settings-form inline-form">
            <div class="form-grid two-columns">
                <label class="field-label">
                    <span>新名称</span>
                    <input class="text-input" type="text" data-character-rename-input value="${escapeHtml(state.characterRenaming.name)}">
                </label>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-character-rename>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="primary-button" type="button" data-confirm-character-rename>
                    <i class="fa-solid fa-check"></i>
                    保存重命名
                </button>
            </div>
            <p class="panel-subtitle">将同步更新卡片名称、PNG 文件名和对应聊天目录：${escapeHtml(character.avatar || '')}</p>
        </div>
    `;
}

function renderCharacterDeletePanel(character) {
    return `
        <div class="settings-form inline-form danger-panel">
            <div>
                <strong>删除角色</strong>
                <p class="panel-subtitle">将删除 ${escapeHtml(state.characterDeleteConfirm.name || character.avatar)} 的角色卡文件。</p>
            </div>
            <label class="checkbox-card compact-checkbox">
                <input type="checkbox" data-character-delete-chats ${state.characterDeleteConfirm.deleteChats ? 'checked' : ''}>
                <span>同时删除聊天记录目录</span>
            </label>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-character-delete>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button danger-action" type="button" data-confirm-character-delete>
                    <i class="fa-solid fa-trash"></i>
                    确认删除
                </button>
            </div>
        </div>
    `;
}

function renderCharacterFormContent(form, scope, isCreate) {
    const scopeAttribute = escapeHtml(scope);

    return `
        <div class="character-form">
            <div class="form-grid two-columns">
                ${renderCharacterInput('name', '名称', form.name, scopeAttribute)}
                ${renderCharacterInput('creator', '作者', form.creator, scopeAttribute)}
                ${renderCharacterInput('character_version', '版本', form.character_version, scopeAttribute)}
                ${renderCharacterInput('tags', '标签', form.tags, scopeAttribute, '用逗号分隔')}
                ${renderCharacterWorldSelect(form, scopeAttribute)}
                ${renderCharacterNumberInput('talkativeness', '发言概率', form.talkativeness, scopeAttribute, '0', '1', '0.05')}
                ${renderCharacterNumberInput('depth_prompt_depth', 'Depth 深度', form.depth_prompt_depth, scopeAttribute, '0', '9999', '1')}
                ${renderCharacterDepthRoleSelect(form, scopeAttribute)}
                ${renderCharacterCheckbox('favorite', '收藏角色', form.favorite, scopeAttribute)}
            </div>
            ${renderCharacterTextarea('description', '描述', form.description, scopeAttribute)}
            ${renderCharacterTextarea('personality', '性格', form.personality, scopeAttribute)}
            ${renderCharacterTextarea('scenario', '场景', form.scenario, scopeAttribute)}
            ${renderCharacterTextarea('first_mes', '首条消息', form.first_mes, scopeAttribute)}
            ${renderCharacterTextarea('alternate_greetings', '备用开场白', form.alternate_greetings, scopeAttribute, '多条开场白用单独一行 --- 分隔')}
            ${renderCharacterTextarea('mes_example', '示例消息', form.mes_example, scopeAttribute)}
            ${renderCharacterTextarea('creator_notes', '作者备注', form.creator_notes, scopeAttribute)}
            ${renderCharacterTextarea('system_prompt', '系统提示词', form.system_prompt, scopeAttribute)}
            ${renderCharacterTextarea('depth_prompt_prompt', 'Depth Prompt', form.depth_prompt_prompt, scopeAttribute)}
            ${renderCharacterTextarea('post_history_instructions', '历史后置提示', form.post_history_instructions, scopeAttribute)}
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" ${isCreate ? 'data-cancel-character-create' : 'data-cancel-character-edit'}>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="primary-button" type="button" ${isCreate ? 'data-save-character-create' : 'data-save-character-edit'}>
                    <i class="fa-solid fa-check"></i>
                    ${isCreate ? '创建角色' : '保存角色'}
                </button>
            </div>
        </div>
    `;
}

function renderCharacterInput(field, label, value, scope, placeholder = '') {
    return `
        <label class="field-label">
            <span>${escapeHtml(label)}</span>
            <input class="text-input" type="text" data-character-field="${escapeHtml(field)}" data-character-scope="${scope}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">
        </label>
    `;
}

function renderCharacterNumberInput(field, label, value, scope, min, max, step) {
    return `
        <label class="field-label">
            <span>${escapeHtml(label)}</span>
            <input class="text-input" type="number" min="${escapeHtml(min)}" max="${escapeHtml(max)}" step="${escapeHtml(step)}" data-character-field="${escapeHtml(field)}" data-character-scope="${scope}" value="${escapeHtml(value)}">
        </label>
    `;
}

function renderCharacterTextarea(field, label, value, scope, placeholder = '') {
    return `
        <label class="field-label">
            <span>${escapeHtml(label)}</span>
            <textarea data-character-field="${escapeHtml(field)}" data-character-scope="${scope}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
        </label>
    `;
}

function renderCharacterCheckbox(field, label, checked, scope) {
    return `
        <label class="checkbox-card compact-checkbox">
            <input type="checkbox" data-character-field="${escapeHtml(field)}" data-character-scope="${scope}" ${checked ? 'checked' : ''}>
            <span>${escapeHtml(label)}</span>
        </label>
    `;
}

function renderCharacterDepthRoleSelect(form, scope) {
    const roles = ['system', 'user', 'assistant'];
    return `
        <label class="field-label">
            <span>Depth Prompt 角色</span>
            <select class="select-input" data-character-field="depth_prompt_role" data-character-scope="${scope}">
                ${roles.map(role => `<option value="${role}" ${form.depth_prompt_role === role ? 'selected' : ''}>${role}</option>`).join('')}
            </select>
        </label>
    `;
}

function renderCharacterWorldSelect(form, scope) {
    const worldNames = uniqueValues([
        form.world,
        ...(state.worldbooks || []).map(worldbook => worldbook.file_id || worldbook.name),
        ...(state.settingsBundle.world_names || []),
    ]);

    return `
        <label class="field-label">
            <span>关联世界书</span>
            <select class="select-input" data-character-field="world" data-character-scope="${scope}">
                <option value="">不关联</option>
                ${worldNames.map(name => `<option value="${escapeHtml(name)}" ${form.world === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
            </select>
        </label>
    `;
}

function renderWorldbooks() {
    const namesFromSettings = (state.settingsBundle.world_names || []).map(name => ({ file_id: name, name }));
    const worldbooks = (state.worldbooks.length ? state.worldbooks : namesFromSettings)
        .filter(worldbook => matchesQuery(worldbook.name, worldbook.file_id));
    const selected = worldbooks.find(worldbook => worldbook.file_id === state.selected.worldbook) || worldbooks[0];
    if (selected && state.selected.worldbook !== selected.file_id) {
        state.selected.worldbook = selected.file_id;
    }

    return `
        ${pageHead('世界书', '知识库文件、条目和启用状态。', `
            <button class="primary-button" type="button" data-create-worldbook>
                <i class="fa-solid fa-plus"></i>
                新建世界书
            </button>
            ${legacyMenu('打开原版编辑器')}
        `)}
        <div class="split-grid">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">世界书列表</h2>
                        <p class="panel-subtitle">${formatNumber(worldbooks.length)} 个匹配项</p>
                    </div>
                </div>
                ${state.worldbookCreating.active ? renderWorldbookCreatePanel() : ''}
                <div class="resource-list">
                    ${worldbooks.map(worldbook => renderWorldbookRow(worldbook)).join('') || renderInlineEmpty('暂无世界书')}
                </div>
            </section>
            <section class="panel">
                ${selected ? renderWorldbookDetail(selected) : renderEmptyState('fa-book-open', '暂无世界书', '当前用户目录里没有世界书。')}
            </section>
        </div>
    `;
}

function renderWorldbookCreatePanel() {
    return `
        <div class="settings-form inline-form">
            <label class="field-label">
                <span>世界书名称</span>
                <input class="text-input" type="text" data-worldbook-create-name value="${escapeHtml(state.worldbookCreating.name)}" placeholder="例如：角色设定集">
            </label>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-worldbook-create>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="primary-button" type="button" data-save-worldbook-create>
                    <i class="fa-solid fa-check"></i>
                    创建
                </button>
            </div>
        </div>
    `;
}

function renderWorldbookRow(worldbook) {
    const globalEnabled = isGlobalWorldEnabled(worldbook.file_id);

    return `
        <button class="resource-row ${state.selected.worldbook === worldbook.file_id ? 'active' : ''}" type="button" data-select-worldbook="${escapeHtml(worldbook.file_id)}">
            <span class="avatar-fallback"><i class="fa-solid fa-book-open"></i></span>
            <span class="row-main">
                <span class="row-title">${escapeHtml(worldbook.name || worldbook.file_id)}</span>
                <span class="row-subtitle">${escapeHtml(worldbook.file_id)}</span>
            </span>
            <span class="badge ${globalEnabled ? '' : 'danger'}">${globalEnabled ? '全局启用' : '未启用'}</span>
        </button>
    `;
}

function renderWorldbookDetail(worldbook) {
    const detail = state.worldDetails[worldbook.file_id];
    const entries = detail?.entries ? Object.entries(detail.entries) : [];
    const listState = getWorldEntryListState(worldbook.file_id);
    const visibleEntries = getVisibleWorldEntries(entries, listState);
    const totalPages = Math.max(1, Math.ceil(visibleEntries.length / worldEntryPageSize));
    listState.page = Math.min(Math.max(1, listState.page), totalPages);
    const pageEntries = visibleEntries.slice((listState.page - 1) * worldEntryPageSize, listState.page * worldEntryPageSize);
    const selectedCount = listState.selectedKeys.length;
    const enabledEntries = entries.filter(([, entry]) => !entry.disable);
    const globalEnabled = isGlobalWorldEnabled(worldbook.file_id);
    const isDeleting = state.worldbookDeleteConfirm.worldbookId === worldbook.file_id;
    const isCreatingEntry = state.worldEntryEditing.worldbookId === worldbook.file_id && state.worldEntryEditing.mode === 'create';

    return `
        <div class="panel-header">
            <div>
                <h2 class="panel-title">${escapeHtml(worldbook.name || worldbook.file_id)}</h2>
                <p class="panel-subtitle">${escapeHtml(worldbook.file_id)}.json</p>
            </div>
            <div class="page-actions">
                <button class="secondary-button" type="button" data-toggle-world-global="${escapeHtml(worldbook.file_id)}">
                    <i class="fa-solid ${globalEnabled ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
                    ${globalEnabled ? '停用全局' : '启用全局'}
                </button>
                <button class="secondary-button" type="button" data-load-worldbook="${escapeHtml(worldbook.file_id)}">
                    <i class="fa-solid fa-database"></i>
                    读取条目
                </button>
                ${detail ? `
                    <button class="secondary-button" type="button" data-create-world-entry="${escapeHtml(worldbook.file_id)}">
                        <i class="fa-solid fa-plus"></i>
                        新条目
                    </button>
                ` : ''}
                <button class="secondary-button danger-action" type="button" data-delete-worldbook="${escapeHtml(worldbook.file_id)}">
                    <i class="fa-solid fa-trash"></i>
                    删除
                </button>
            </div>
        </div>
        ${isDeleting ? renderWorldbookDeletePanel(worldbook) : ''}
        ${detail ? `
            <div class="metrics-grid compact-metrics">
                ${metricCard('条目', formatNumber(entries.length), '全部 entries', 'fa-list')}
                ${metricCard('启用', formatNumber(enabledEntries.length), '未禁用条目', 'fa-toggle-on')}
                ${metricCard('扩展字段', formatNumber(Object.keys(detail.extensions || {}).length), 'metadata', 'fa-code-branch')}
            </div>
            ${isCreatingEntry ? renderWorldEntryCreatePanel(state.worldEntryEditing.entryKey) : ''}
            <div class="list-toolbar">
                <label class="field-label">
                    <span>搜索条目</span>
                    <input class="text-input" type="search" data-world-entry-search value="${escapeHtml(listState.query)}" placeholder="关键词、注释或内容">
                </label>
                <label class="field-label">
                    <span>排序</span>
                    <select class="select-input" data-world-entry-sort>
                        <option value="order" ${listState.sort === 'order' ? 'selected' : ''}>按插入顺序</option>
                        <option value="comment" ${listState.sort === 'comment' ? 'selected' : ''}>按注释</option>
                        <option value="key" ${listState.sort === 'key' ? 'selected' : ''}>按关键词</option>
                        <option value="status" ${listState.sort === 'status' ? 'selected' : ''}>按启用状态</option>
                    </select>
                </label>
                <div class="toolbar-actions">
                    <button class="secondary-button" type="button" data-world-entry-page="${listState.page - 1}" ${listState.page <= 1 ? 'disabled' : ''}>
                        <i class="fa-solid fa-chevron-left"></i>
                        上一页
                    </button>
                    <span class="badge">${formatNumber(listState.page)} / ${formatNumber(totalPages)}</span>
                    <button class="secondary-button" type="button" data-world-entry-page="${listState.page + 1}" ${listState.page >= totalPages ? 'disabled' : ''}>
                        下一页
                        <i class="fa-solid fa-chevron-right"></i>
                    </button>
                    <button class="secondary-button" type="button" data-bulk-world-entries="enable" ${selectedCount ? '' : 'disabled'}>
                        <i class="fa-solid fa-toggle-on"></i>
                        启用所选 ${formatNumber(selectedCount)}
                    </button>
                    <button class="secondary-button" type="button" data-bulk-world-entries="disable" ${selectedCount ? '' : 'disabled'}>
                        <i class="fa-solid fa-toggle-off"></i>
                        禁用所选 ${formatNumber(selectedCount)}
                    </button>
                </div>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr><th>选择</th><th>键</th><th>注释</th><th>状态</th><th>操作</th></tr>
                    </thead>
                    <tbody>
                        ${pageEntries.map(([entryKey, entry]) => renderWorldEntryRow(worldbook, entryKey, entry)).join('') || '<tr><td colspan="5">没有条目</td></tr>'}
                    </tbody>
                </table>
            </div>
        ` : renderEmptyState('fa-database', '尚未读取条目', '点击“读取条目”查看这个世界书的 entries。')}
    `;
}

function renderWorldbookDeletePanel(worldbook) {
    return `
        <div class="settings-form inline-form danger-panel">
            <div>
                <strong>删除世界书</strong>
                <p class="panel-subtitle">将删除 ${escapeHtml(worldbook.file_id)}.json，并从全局启用列表移除。角色卡里已有的关联字段不会自动改写。</p>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-worldbook-delete>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button danger-action" type="button" data-confirm-worldbook-delete>
                    <i class="fa-solid fa-trash"></i>
                    确认删除
                </button>
            </div>
        </div>
    `;
}

function renderWorldEntryRow(worldbook, entryKey, entry) {
    const isEditing = state.worldEntryEditing.worldbookId === worldbook.file_id && state.worldEntryEditing.entryKey === entryKey;
    const isDeleting = state.worldEntryDeleteConfirm.worldbookId === worldbook.file_id && state.worldEntryDeleteConfirm.entryKey === entryKey;
    const isSelected = state.worldEntryList.selectedKeys.includes(String(entryKey));

    return `
        <tr>
            <td>
                <input type="checkbox" data-world-entry-select="${escapeHtml(entryKey)}" ${isSelected ? 'checked' : ''}>
            </td>
            <td>${escapeHtml(Array.isArray(entry.key) ? entry.key.join(', ') : entry.key || '无关键词')}</td>
            <td>${escapeHtml(entry.comment || entry.name || '未命名条目')}</td>
            <td>${entry.disable ? '<span class="danger">禁用</span>' : '<span class="success">启用</span>'}</td>
            <td>
                <div class="row-actions">
                    <button class="secondary-button" type="button" data-edit-world-entry="${escapeHtml(worldbook.file_id)}" data-world-entry-key="${escapeHtml(entryKey)}" ${isEditing ? 'disabled' : ''}>
                        <i class="fa-solid fa-pen"></i>
                        编辑
                    </button>
                    <button class="secondary-button" type="button" data-toggle-world-entry="${escapeHtml(worldbook.file_id)}" data-world-entry-key="${escapeHtml(entryKey)}">
                        <i class="fa-solid ${entry.disable ? 'fa-toggle-off' : 'fa-toggle-on'}"></i>
                        ${entry.disable ? '启用' : '禁用'}
                    </button>
                    <button class="secondary-button" type="button" data-copy-world-entry="${escapeHtml(worldbook.file_id)}" data-world-entry-key="${escapeHtml(entryKey)}">
                        <i class="fa-solid fa-copy"></i>
                        复制
                    </button>
                    <button class="secondary-button danger-action" type="button" data-delete-world-entry="${escapeHtml(worldbook.file_id)}" data-world-entry-key="${escapeHtml(entryKey)}">
                        <i class="fa-solid fa-trash"></i>
                        删除
                    </button>
                </div>
            </td>
        </tr>
        ${isEditing ? renderWorldEntryForm(entryKey, entry) : ''}
        ${isDeleting ? renderWorldEntryDeleteRow(entryKey, entry) : ''}
    `;
}

function renderWorldEntryDeleteRow(entryKey, entry) {
    return `
        <tr>
            <td colspan="5">
                <div class="settings-form inline-form danger-panel">
                    <div>
                        <strong>删除条目</strong>
                        <p class="panel-subtitle">将删除 ${escapeHtml(getWorldEntryTitle(entry, entryKey))}，操作不可撤销。</p>
                    </div>
                    <div class="message-edit-actions">
                        <button class="secondary-button" type="button" data-cancel-world-entry-delete>
                            <i class="fa-solid fa-xmark"></i>
                            取消
                        </button>
                        <button class="secondary-button danger-action" type="button" data-confirm-world-entry-delete>
                            <i class="fa-solid fa-trash"></i>
                            确认删除
                        </button>
                    </div>
                </div>
            </td>
        </tr>
    `;
}

function renderWorldEntryForm(entryKey, entry) {
    const edit = state.worldEntryEditing;
    const form = edit.form || worldEntryToForm(entry || createWorldEntry(Number(entryKey)));
    const isCreate = edit.mode === 'create';
    const formContent = renderWorldEntryFormContent(form, isCreate);

    return `
        <tr>
            <td colspan="5">${formContent}</td>
        </tr>
    `;
}

function renderWorldEntryCreatePanel(entryKey) {
    const form = state.worldEntryEditing.form || worldEntryToForm(createWorldEntry(Number(entryKey)));
    return `
        <div class="settings-form inline-form">
            <strong>新建条目</strong>
            ${renderWorldEntryFormContent(form, true)}
        </div>
    `;
}

function renderWorldEntryFormContent(form, isCreate) {
    return `
        <div class="world-entry-form">
            <div class="form-grid two-columns">
                <label class="field-label">
                    <span>主关键词</span>
                    <input class="text-input" type="text" data-world-entry-field="key" value="${escapeHtml(form.key)}" placeholder="用逗号分隔">
                </label>
                <label class="field-label">
                    <span>次级关键词</span>
                    <input class="text-input" type="text" data-world-entry-field="keysecondary" value="${escapeHtml(form.keysecondary)}" placeholder="用逗号分隔">
                </label>
                <label class="field-label">
                    <span>注释</span>
                    <input class="text-input" type="text" data-world-entry-field="comment" value="${escapeHtml(form.comment)}">
                </label>
                <label class="field-label">
                    <span>插入位置</span>
                    <select class="select-input" data-world-entry-field="position">
                        ${worldEntryPositions.map(position => `<option value="${position.value}" ${Number(form.position) === position.value ? 'selected' : ''}>${escapeHtml(position.label)}</option>`).join('')}
                    </select>
                </label>
                <label class="field-label">
                    <span>顺序</span>
                    <input class="text-input" type="number" data-world-entry-field="order" value="${escapeHtml(form.order)}">
                </label>
                <label class="field-label">
                    <span>深度</span>
                    <input class="text-input" type="number" data-world-entry-field="depth" value="${escapeHtml(form.depth)}">
                </label>
                <label class="field-label">
                    <span>概率</span>
                    <input class="text-input" type="number" min="0" max="100" data-world-entry-field="probability" value="${escapeHtml(form.probability)}">
                </label>
            </div>
            <label class="field-label">
                <span>内容</span>
                <textarea data-world-entry-field="content">${escapeHtml(form.content)}</textarea>
            </label>
            <div class="checkbox-grid">
                ${renderWorldEntryCheckbox('constant', '常驻', form.constant)}
                ${renderWorldEntryCheckbox('vectorized', '向量化', form.vectorized)}
                ${renderWorldEntryCheckbox('selective', '使用关键词触发', form.selective)}
                ${renderWorldEntryCheckbox('useProbability', '使用概率', form.useProbability)}
                ${renderWorldEntryCheckbox('disable', '禁用', form.disable)}
                ${renderWorldEntryCheckbox('ignoreBudget', '忽略预算', form.ignoreBudget)}
                ${renderWorldEntryCheckbox('excludeRecursion', '不递归扫描', form.excludeRecursion)}
                ${renderWorldEntryCheckbox('preventRecursion', '阻止递归', form.preventRecursion)}
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-world-entry-edit>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="primary-button" type="button" data-save-world-entry-edit>
                    <i class="fa-solid fa-check"></i>
                    ${isCreate ? '创建条目' : '保存条目'}
                </button>
            </div>
        </div>
    `;
}

function renderWorldEntryCheckbox(field, label, checked) {
    return `
        <label class="checkbox-card">
            <input type="checkbox" data-world-entry-field="${escapeHtml(field)}" ${checked ? 'checked' : ''}>
            <span>${escapeHtml(label)}</span>
        </label>
    `;
}

function renderPresets() {
    const groups = getPresetGroups()
        .map(group => ({ ...group, items: getPresetItems(group) }))
        .filter(group => group.items.length > 0);

    return `
        ${pageHead('预设管理', '模型参数、指令模板和上下文模板。', `
            ${legacyMenu('打开原版编辑器')}
        `)}
        ${renderOpenAiPresetTools()}
        <div class="grid-list">
            ${groups.map(group => `
                <article class="resource-card">
                    <div class="card-head">
                        <div>
                            <h2 class="card-title">${escapeHtml(group.label)}</h2>
                            <div class="card-meta">${escapeHtml(group.id)} · ${formatNumber(group.items.length)} 个</div>
                        </div>
                        <span class="badge">${formatNumber(group.items.length)}</span>
                    </div>
                    <div class="resource-list scroll-list">
                        ${group.items.map(item => `
                            <${item.actionable ? 'button' : 'div'} class="resource-row ${item.active ? 'active' : ''}" ${item.actionable ? `type="button" data-use-openai-preset="${escapeHtml(item.name)}"` : ''}>
                                <span class="avatar-fallback"><i class="fa-solid fa-file-lines"></i></span>
                                <span class="row-main">
                                    <span class="row-title">${escapeHtml(item.name)}</span>
                                    <span class="row-subtitle">${escapeHtml(getPresetSummary(item.content))}</span>
                                </span>
                                ${item.actionable ? `<span class="badge">${item.active ? '当前' : '使用'}</span>` : ''}
                            </${item.actionable ? 'button' : 'div'}>
                        `).join('')}
                    </div>
                </article>
            `).join('') || renderEmptyState('fa-sliders', '暂无匹配预设', '尝试清空搜索关键词。')}
        </div>
    `;
}

function renderOpenAiPresetTools() {
    const currentPreset = getOaiSettings().preset_settings_openai || '';
    const draftName = state.openAiPresetDraft.name || currentPreset;

    return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">聊天补全预设</h2>
                    <p class="panel-subtitle">保存现代 API 页可编辑的模型、端点和采样参数；高级字段保留在原预设中。</p>
                </div>
                <span class="badge">${escapeHtml(currentPreset || '未选择')}</span>
            </div>
            <div class="settings-form">
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>预设名称</span>
                        <input class="text-input" type="text" data-openai-preset-name value="${escapeHtml(draftName)}" placeholder="输入新名称或覆盖当前预设">
                    </label>
                </div>
                <div class="message-edit-actions">
                    <button class="secondary-button" type="button" data-save-openai-preset>
                        <i class="fa-solid fa-floppy-disk"></i>
                        保存当前配置为预设
                    </button>
                </div>
            </div>
        </section>
    `;
}

function getPresetSummary(rawPreset) {
    if (!rawPreset) {
        return '预设文件';
    }

    if (typeof rawPreset === 'string') {
        try {
            const preset = JSON.parse(rawPreset);
            return preset.model || preset.openai_model || preset.name || 'JSON 预设';
        } catch {
            return '文本预设';
        }
    }

    return rawPreset.model || rawPreset.name || 'JSON 预设';
}

function renderPersonas() {
    const personas = getPersonas().filter(persona => matchesQuery(persona.name, persona.title, persona.description, persona.avatarId));

    return `
        ${pageHead('用户人设', '头像、标题和默认身份。', `
            <button class="primary-button" type="button" data-create-persona>
                <i class="fa-solid fa-plus"></i>
                新建人设
            </button>
            ${legacyMenu('打开原版管理')}
        `)}
        ${state.personaCreating.active ? renderPersonaCreatePanel() : ''}
        <div class="grid-list">
            ${personas.map(persona => `
                <article class="resource-card">
                    <div class="detail-hero compact-hero">
                        <img class="avatar large" src="${getPersonaUrl(persona.avatarId)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'), { className: 'avatar-fallback large', textContent: 'P' }))">
                        <div>
                            <h2 class="card-title">${escapeHtml(persona.name || '未命名人设')}</h2>
                            <div class="card-meta">${escapeHtml(persona.title || persona.avatarId)}</div>
                            ${persona.default ? '<span class="tag">默认</span>' : ''}
                        </div>
                    </div>
                    <p class="detail-text">${escapeHtml(persona.description || '暂无描述')}</p>
                    <div class="row-actions">
                        <button class="secondary-button" type="button" data-edit-persona="${escapeHtml(persona.avatarId)}">
                            <i class="fa-solid fa-pen"></i>
                            编辑
                        </button>
                        <button class="secondary-button" type="button" data-set-default-persona="${escapeHtml(persona.avatarId)}" ${persona.default ? 'disabled' : ''}>
                            <i class="fa-solid fa-user-check"></i>
                            设为默认
                        </button>
                        <label class="secondary-button file-action">
                            <i class="fa-solid fa-image"></i>
                            替换头像
                            <input class="visually-hidden" type="file" accept="image/*" data-persona-avatar-file="${escapeHtml(persona.avatarId)}">
                        </label>
                        <button class="secondary-button danger-action" type="button" data-delete-persona="${escapeHtml(persona.avatarId)}">
                            <i class="fa-solid fa-trash"></i>
                            删除
                        </button>
                    </div>
                    ${state.personaEditing.avatarId === persona.avatarId ? renderPersonaEditPanel(persona) : ''}
                    ${state.personaDeleteConfirm.avatarId === persona.avatarId ? renderPersonaDeletePanel(persona) : ''}
                </article>
            `).join('') || renderEmptyState('fa-user-gear', '暂无用户人设', '当前目录没有用户人设。')}
        </div>
    `;
}

function renderPersonaCreatePanel() {
    return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">新建用户人设</h2>
                    <p class="panel-subtitle">上传头像后写入 personas 设置。</p>
                </div>
            </div>
            <div class="settings-form inline-form">
                ${renderPersonaFormContent(state.personaCreating.form, 'create')}
                <label class="field-label">
                    <span>头像图片</span>
                    <input class="text-input" type="file" accept="image/*" data-persona-create-file>
                    ${state.personaCreating.file ? `<span class="card-meta">${escapeHtml(state.personaCreating.file.name)}</span>` : ''}
                </label>
                <div class="message-edit-actions">
                    <button class="secondary-button" type="button" data-cancel-persona-create>
                        <i class="fa-solid fa-xmark"></i>
                        取消
                    </button>
                    <button class="primary-button" type="button" data-save-persona-create>
                        <i class="fa-solid fa-check"></i>
                        创建人设
                    </button>
                </div>
            </div>
        </section>
    `;
}

function renderPersonaEditPanel(persona) {
    const form = state.personaEditing.form;
    const formValue = {
        name: form.name || persona.name,
        title: form.title || '',
        description: form.description || '',
    };

    return `
        <div class="settings-form">
            ${renderPersonaFormContent(formValue, 'edit')}
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-persona-edit>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="primary-button" type="button" data-save-persona-edit>
                    <i class="fa-solid fa-check"></i>
                    保存
                </button>
            </div>
        </div>
    `;
}

function renderPersonaFormContent(form, scope) {
    return `
        <div class="form-grid">
            <label class="field-label">
                <span>名称</span>
                <input class="text-input" type="text" data-persona-field="name" data-persona-scope="${escapeHtml(scope)}" value="${escapeHtml(form.name || '')}">
            </label>
            <label class="field-label">
                <span>标题</span>
                <input class="text-input" type="text" data-persona-field="title" data-persona-scope="${escapeHtml(scope)}" value="${escapeHtml(form.title || '')}">
            </label>
            <label class="field-label">
                <span>描述</span>
                <textarea data-persona-field="description" data-persona-scope="${escapeHtml(scope)}">${escapeHtml(form.description || '')}</textarea>
            </label>
        </div>
    `;
}

function renderPersonaDeletePanel(persona) {
    return `
        <div class="settings-form inline-form danger-panel">
            <div>
                <strong>删除用户人设</strong>
                <p class="panel-subtitle">将删除 ${escapeHtml(persona.name || persona.avatarId)} 的设置和头像文件。</p>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-persona-delete>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button danger-action" type="button" data-confirm-persona-delete>
                    <i class="fa-solid fa-trash"></i>
                    确认删除
                </button>
            </div>
        </div>
    `;
}

function renderAssets() {
    const groups = getAssetGroups().filter(group => matchesQuery(group.name));
    const allBackgrounds = state.backgrounds?.images || [];
    const backgrounds = allBackgrounds.filter(background => matchesQuery(getBackgroundFilename(background)));
    const selection = state.backgroundSelection;
    const selectedCount = selection.filenames.length;

    return `
        ${pageHead('素材库', '背景、音频、Live2D、VRM 和资产文件。', `
            <button class="primary-button" type="button" data-toggle-asset-download>
                <i class="fa-solid ${state.assetDownload.active ? 'fa-xmark' : 'fa-cloud-arrow-down'}"></i>
                ${state.assetDownload.active ? '取消下载' : '下载资产'}
            </button>
            <label class="secondary-button file-action">
                <i class="fa-solid fa-upload"></i>
                上传背景
                <input class="visually-hidden" type="file" accept="image/*,.gif,.webp,.apng" data-background-upload-file>
            </label>
            <button class="secondary-button" type="button" data-toggle-background-selection>
                <i class="fa-solid ${selection.active ? 'fa-xmark' : 'fa-check-square'}"></i>
                ${selection.active ? '退出选择' : '选择背景'}
            </button>
            ${selection.active ? `
                <button class="secondary-button danger-action" type="button" data-delete-selected-backgrounds ${selectedCount ? '' : 'disabled'}>
                    <i class="fa-solid fa-trash"></i>
                    删除所选 ${formatNumber(selectedCount)}
                </button>
            ` : ''}
            ${legacyMenu('打开原版素材')}
        `)}
        ${state.assetDownload.active ? renderAssetDownloadPanel() : ''}
        <div class="metrics-grid">
            ${metricCard('背景', formatNumber(allBackgrounds.length), '背景图片', 'fa-image')}
            ${metricCard('资产文件', formatNumber(getAssetCount()), 'assets 目录', 'fa-folder-tree')}
            ${metricCard('素材分类', formatNumber(groups.length), '有效分类', 'fa-layer-group')}
            ${metricCard('动画背景', formatNumber(allBackgrounds.filter(item => item.isAnimated).length), 'metadata 标记', 'fa-film')}
        </div>
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">背景</h2>
                    <p class="panel-subtitle">${formatNumber(backgrounds.length)} 个匹配项，显示前 24 个。${selection.active ? `已选择 ${formatNumber(selectedCount)} 个。` : ''}</p>
                </div>
            </div>
            ${selection.deleteConfirm ? `
                <div class="settings-form inline-form danger-panel">
                    <strong>删除所选背景</strong>
                    <p class="panel-subtitle">将删除 ${formatNumber(selectedCount)} 个背景文件，此操作会调用原版背景删除接口。</p>
                    <div class="message-edit-actions">
                        <button class="secondary-button" type="button" data-cancel-background-delete ${selection.deleting ? 'disabled' : ''}>
                            <i class="fa-solid fa-xmark"></i>
                            取消
                        </button>
                        <button class="secondary-button danger-action" type="button" data-confirm-background-delete ${selection.deleting ? 'disabled' : ''}>
                            <i class="fa-solid ${selection.deleting ? 'fa-circle-notch fa-spin' : 'fa-trash'}"></i>
                            ${selection.deleting ? '删除中' : '确认删除'}
                        </button>
                    </div>
                </div>
            ` : ''}
            <div class="background-grid">
                ${backgrounds.slice(0, 24).map(background => renderBackgroundCard(background)).join('') || renderInlineEmpty('暂无背景')}
            </div>
        </section>
        <div class="grid-list">
            ${groups.map(group => `
                <article class="resource-card">
                    <div class="card-head">
                        <div>
                            <h2 class="card-title">${escapeHtml(group.name)}</h2>
                            <div class="card-meta">${formatNumber(group.count)} 个文件</div>
                        </div>
                        <span class="badge">${formatNumber(group.count)}</span>
                    </div>
                    <div class="resource-list compact-list">
                        ${getAssetEntries(group).map(entry => renderAssetEntryRow(entry)).join('') || renderInlineEmpty('空分类')}
                    </div>
                    ${group.count > 8 ? '<p class="panel-subtitle">仅显示前 8 个文件，可用搜索缩小范围。</p>' : ''}
                </article>
            `).join('') || renderEmptyState('fa-folder-tree', '暂无素材', '当前资产目录还没有可显示文件。')}
        </div>
    `;
}

function renderAssetDownloadPanel() {
    const download = state.assetDownload;
    const categories = [
        { value: 'bgm', label: 'BGM' },
        { value: 'ambient', label: '环境音' },
        { value: 'blip', label: '提示音' },
    ];

    return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">下载资产</h2>
                    <p class="panel-subtitle">把白名单域名下的文件下载到 assets 分类目录。</p>
                </div>
            </div>
            <div class="settings-form">
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>资产 URL</span>
                        <input class="text-input" type="url" data-asset-download-url value="${escapeHtml(download.url)}" placeholder="https://example.com/file.mp3" autocomplete="off">
                    </label>
                    <label class="field-label">
                        <span>文件名</span>
                        <input class="text-input" type="text" data-asset-download-filename value="${escapeHtml(download.filename)}" placeholder="sound.mp3" autocomplete="off">
                    </label>
                    <label class="field-label">
                        <span>分类</span>
                        <select class="select-input" data-asset-download-category>
                            ${categories.map(category => `<option value="${category.value}" ${download.category === category.value ? 'selected' : ''}>${escapeHtml(category.label)}</option>`).join('')}
                        </select>
                    </label>
                </div>
                <div class="message-edit-actions">
                    <button class="secondary-button" type="button" data-toggle-asset-download ${download.running ? 'disabled' : ''}>
                        <i class="fa-solid fa-xmark"></i>
                        取消
                    </button>
                    <button class="primary-button" type="button" data-download-asset ${download.running ? 'disabled' : ''}>
                        <i class="fa-solid ${download.running ? 'fa-circle-notch fa-spin' : 'fa-cloud-arrow-down'}"></i>
                        ${download.running ? '下载中' : '下载'}
                    </button>
                </div>
            </div>
        </section>
    `;
}

function renderBackgroundCard(background) {
    const filename = getBackgroundFilename(background);
    const isSelected = state.backgroundSelection.filenames.includes(filename);
    const isSelecting = state.backgroundSelection.active;
    const isAnimated = typeof background === 'object' && Boolean(background?.isAnimated);
    const isRenaming = state.backgroundRenaming.filename === filename;

    return `
        <article class="resource-card background-card ${isSelected ? 'selected' : ''}">
            <img class="background-thumb" src="${getBackgroundUrl(filename)}" alt="" loading="lazy">
            <div class="card-head">
                <div>
                    <h3 class="card-title">${escapeHtml(filename)}</h3>
                    <div class="card-meta">${isAnimated ? '动画背景' : '静态背景'}</div>
                </div>
            </div>
            ${!isSelecting && !isRenaming ? `
                <div class="row-actions">
                    <button class="secondary-button" type="button" data-background-rename="${escapeHtml(filename)}">
                        <i class="fa-solid fa-i-cursor"></i>
                        重命名
                    </button>
                </div>
            ` : ''}
            ${isRenaming ? `
                <div class="settings-form inline-form">
                    <label class="field-label">
                        <span>新文件名</span>
                        <input class="text-input" type="text" data-background-rename-input value="${escapeHtml(state.backgroundRenaming.name)}">
                    </label>
                    <div class="message-edit-actions">
                        <button class="secondary-button" type="button" data-cancel-background-rename ${state.backgroundRenaming.running ? 'disabled' : ''}>
                            <i class="fa-solid fa-xmark"></i>
                            取消
                        </button>
                        <button class="primary-button" type="button" data-confirm-background-rename ${state.backgroundRenaming.running ? 'disabled' : ''}>
                            <i class="fa-solid ${state.backgroundRenaming.running ? 'fa-circle-notch fa-spin' : 'fa-check'}"></i>
                            ${state.backgroundRenaming.running ? '保存中' : '保存'}
                        </button>
                    </div>
                </div>
            ` : ''}
            ${isSelecting ? `
                <label class="selection-row">
                    <input type="checkbox" data-background-select="${escapeHtml(filename)}" ${isSelected ? 'checked' : ''}>
                    <span>${isSelected ? '已选择' : '选择'}</span>
                </label>
            ` : ''}
        </article>
    `;
}

function renderAssetEntryRow(entry) {
    const isDeleting = state.assetDeleteConfirm.category === entry.category && state.assetDeleteConfirm.filename === entry.filename;
    const isBusy = isDeleting && state.assetDeleteConfirm.running;
    const readOnlyReason = entry.filename?.includes('/')
        ? '嵌套资源需在原版资源目录管理'
        : '当前分类不支持删除';

    return `
        <div class="resource-row asset-row">
            <span class="avatar-fallback"><i class="fa-solid fa-file"></i></span>
            <span class="row-main">
                <span class="row-title">${escapeHtml(entry.label || entry.filename)}</span>
                <span class="row-subtitle">${escapeHtml(entry.path)}</span>
            </span>
            ${entry.deletable ? `
                <span class="row-actions">
                    ${isDeleting ? `
                        <button class="secondary-button" type="button" data-cancel-asset-delete ${isBusy ? 'disabled' : ''}>
                            取消
                        </button>
                        <button class="secondary-button danger-action" type="button" data-confirm-asset-delete ${isBusy ? 'disabled' : ''}>
                            <i class="fa-solid ${isBusy ? 'fa-circle-notch fa-spin' : 'fa-trash'}"></i>
                            确认
                        </button>
                    ` : `
                        <button class="secondary-button danger-action" type="button" data-delete-asset data-asset-category="${escapeHtml(entry.category)}" data-asset-filename="${escapeHtml(entry.filename)}">
                            <i class="fa-solid fa-trash"></i>
                            删除
                        </button>
                    `}
                </span>
            ` : `<span class="card-meta asset-readonly">${escapeHtml(readOnlyReason)}</span>`}
        </div>
    `;
}

function renderApi() {
    const provider = getProviderInfo();
    const profiles = getApiProfiles();
    const checks = getApiChecks(provider, profiles);

    return `
        ${pageHead('API 连接管理', '连接、模型、预设和请求状态。', `
            <button class="primary-button" type="button" data-test-api ${state.apiTest.running ? 'disabled' : ''}>
                <i class="fa-solid ${state.apiTest.running ? 'fa-circle-notch fa-spin' : 'fa-plug-circle-check'}"></i>
                ${state.apiTest.running ? '测试中' : '测试连接'}
            </button>
            <button class="secondary-button" type="button" data-refresh>
                <i class="fa-solid fa-rotate"></i>
                刷新
            </button>
            ${legacyMenu('打开原版连接配置')}
        `)}
        <div class="dashboard-grid">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">当前连接</h2>
                        <p class="panel-subtitle">从 SillyTavern settings.json 读取非密钥字段。</p>
                    </div>
                    <span class="badge">${escapeHtml(provider.api)}</span>
                </div>
                <div class="api-current">
                    <div>
                        <span class="metric-label">主 API</span>
                        <strong>${escapeHtml(provider.api)}</strong>
                    </div>
                    <div>
                        <span class="metric-label">来源</span>
                        <strong>${escapeHtml(provider.chatSource || '未配置')}</strong>
                    </div>
                    <div>
                        <span class="metric-label">模型</span>
                        <strong>${escapeHtml(provider.model || '未配置')}</strong>
                    </div>
                    <div>
                        <span class="metric-label">预设</span>
                        <strong>${escapeHtml(provider.preset || '未配置')}</strong>
                    </div>
                </div>
                <div class="connection-test">
                    <span class="badge ${state.apiTest.status === '失败' ? 'danger' : ''}">${escapeHtml(state.apiTest.status)}</span>
                    <span>${escapeHtml(state.apiTest.detail)}</span>
                </div>
                ${renderApiConnectionEditor(provider)}
            </section>
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">检查项</h2>
                        <p class="panel-subtitle">用于定位配置为空、模型缺失和密钥显示策略。</p>
                    </div>
                </div>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr><th>项目</th><th>状态</th><th>详情</th></tr>
                        </thead>
                        <tbody>${checks.map(check => renderApiCheckRow(check)).join('')}</tbody>
                    </table>
                </div>
            </section>
        </div>
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">连接档案</h2>
                    <p class="panel-subtitle">敏感字段已省略。</p>
                </div>
            </div>
            <div class="grid-list">
                ${profiles.map(profile => `
                    <article class="resource-card">
                        <div class="card-head">
                            <div>
                                <h3 class="card-title">${escapeHtml(profile.title)}</h3>
                                <div class="card-meta">${escapeHtml(profile.kind)}</div>
                            </div>
                            <span class="badge">${profile.active ? '当前' : '备用'}</span>
                        </div>
                        <div class="kv-list">
                            ${renderKeyValue('来源', profile.source || '未配置')}
                            ${renderKeyValue('模型', profile.model || '未配置')}
                            ${renderKeyValue('预设', profile.preset || '未配置')}
                            ${renderKeyValue('端点', profile.endpoint || '未配置')}
                        </div>
                    </article>
                `).join('')}
            </div>
        </section>
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">原始字段</h2>
                    <p class="panel-subtitle">用于排查连接选择。</p>
                </div>
            </div>
            <div class="grid-list">
                <article class="resource-card">
                    <h3 class="card-title">主配置</h3>
                    <div class="kv-list">
                        ${renderKeyValue('main_api', provider.api)}
                        ${renderKeyValue('chat_completion_source', provider.chatSource || '未设置')}
                        ${renderKeyValue('model', provider.model || '未设置')}
                        ${renderKeyValue('preset', provider.preset || '未设置')}
                    </div>
                </article>
                <article class="resource-card">
                    <h3 class="card-title">安全</h3>
                    <div class="kv-list">
                        ${renderKeyValue('secrets exposure', state.secrets?.allowKeysExposure ? '允许显示' : '不允许显示')}
                        ${renderKeyValue('csrf token', state.csrfToken ? '已获取' : '未获取')}
                        ${renderKeyValue('accounts', state.settingsBundle.enable_accounts ? '开启' : '关闭')}
                        ${renderKeyValue('extensions', state.settingsBundle.enable_extensions ? '开启' : '关闭')}
                    </div>
                </article>
            </div>
        </section>
    `;
}

function renderApiConnectionEditor(provider) {
    const settings = state.settings.oai_settings || {};
    const source = provider.chatSource || settings.chat_completion_source || 'openai';
    const model = getChatCompletionModel(settings, source);
    const endpoint = settings.siliconflow_endpoint === 'global' ? 'global' : 'cn';
    const apiUiState = getApiSourceUiState(source);
    const openAiPresetNames = getPresetGroups().find(group => group.id === 'openai')?.names || [];

    return `
        <div class="settings-form">
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">连接</h3>
                    <p class="panel-subtitle">选择主 API、来源和端点。</p>
                </div>
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>主 API</span>
                        <select class="select-input" data-api-main>
                            <option value="openai" ${(state.settings.main_api || 'openai') === 'openai' ? 'selected' : ''}>聊天补全</option>
                            <option value="textgenerationwebui" ${state.settings.main_api === 'textgenerationwebui' ? 'selected' : ''}>文本补全</option>
                        </select>
                    </label>
                    <label class="field-label">
                        <span>聊天补全来源</span>
                        <select class="select-input" data-api-source>
                            ${chatCompletionSourceOptions.map(option => `<option value="${escapeHtml(option.id)}" ${source === option.id ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
                        </select>
                    </label>
                    <label class="field-label" data-api-field="siliconflow-endpoint" ${apiUiState.showEndpoint ? '' : 'hidden'}>
                        <span>SiliconFlow 端点</span>
                        <select class="select-input" data-api-endpoint>
                            <option value="cn" ${endpoint === 'cn' ? 'selected' : ''}>China (api.siliconflow.cn)</option>
                            <option value="global" ${endpoint === 'global' ? 'selected' : ''}>Global (api.siliconflow.com)</option>
                        </select>
                    </label>
                    <label class="field-label" data-api-field="custom-url" ${apiUiState.showCustomUrl ? '' : 'hidden'}>
                        <span>Custom URL</span>
                        <input class="text-input" type="url" data-api-custom-url value="${escapeHtml(settings.custom_url || '')}" autocomplete="off" placeholder="OpenAI-compatible base URL">
                    </label>
                    <label class="field-label">
                        <span>Reverse Proxy</span>
                        <input class="text-input" type="url" data-api-reverse-proxy value="${escapeHtml(settings.reverse_proxy || '')}" autocomplete="off" placeholder="可选">
                    </label>
                </div>
            </section>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">模型参数</h3>
                    <p class="panel-subtitle">模型、预设和采样参数。</p>
                </div>
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>模型</span>
                        <input class="text-input" type="text" data-api-model value="${escapeHtml(model)}" autocomplete="off" placeholder="例如 deepseek-ai/DeepSeek-V4-Pro">
                    </label>
                    <label class="field-label">
                        <span>聊天补全预设</span>
                        <select class="select-input" data-api-preset>
                            <option value="">未选择</option>
                            ${openAiPresetNames.map(name => `<option value="${escapeHtml(name)}" ${settings.preset_settings_openai === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
                        </select>
                    </label>
                    <label class="field-label">
                        <span>Temperature</span>
                        <input class="text-input" type="number" step="0.01" data-api-temperature value="${escapeHtml(getNumberSetting(settings, 'temp_openai', 1))}">
                    </label>
                    <label class="field-label">
                        <span>Max Tokens</span>
                        <input class="text-input" type="number" step="1" min="1" data-api-max-tokens value="${escapeHtml(getNumberSetting(settings, 'openai_max_tokens', 300))}">
                    </label>
                    <label class="field-label">
                        <span>Top P</span>
                        <input class="text-input" type="number" step="0.01" data-api-top-p value="${escapeHtml(getNumberSetting(settings, 'top_p_openai', 1))}">
                    </label>
                    <label class="field-label">
                        <span>Frequency Penalty</span>
                        <input class="text-input" type="number" step="0.01" data-api-frequency-penalty value="${escapeHtml(getNumberSetting(settings, 'freq_pen_openai', 0))}">
                    </label>
                    <label class="field-label">
                        <span>Presence Penalty</span>
                        <input class="text-input" type="number" step="0.01" data-api-presence-penalty value="${escapeHtml(getNumberSetting(settings, 'pres_pen_openai', 0))}">
                    </label>
                </div>
            </section>
            <div class="form-section">
                <div>
                    <h3 class="form-section-title">安全密钥</h3>
                    <p class="panel-subtitle">密钥仍写入原版 secrets，不在页面回显。</p>
                </div>
                <label class="field-label" data-api-field="api-key" ${apiUiState.hasSecretMapping ? '' : 'hidden'}>
                    <span>API Key</span>
                    <input class="text-input" type="password" data-api-key value="" autocomplete="new-password" placeholder="${apiUiState.secretSaved ? '密钥已保存；留空不修改' : '输入后保存到 secrets'}">
                </label>
            </div>
            <div class="connection-test">
                <span class="badge" data-api-secret-status>${apiUiState.secretSaved ? '密钥已保存' : (apiUiState.hasSecretMapping ? '未保存密钥' : '无密钥字段')}</span>
                <span data-api-secret-key>${escapeHtml(apiUiState.secretKey)}</span>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-save-api-connection>
                    <i class="fa-solid fa-floppy-disk"></i>
                    保存连接字段
                </button>
            </div>
        </div>
    `;
}

function getApiProfiles() {
    const settings = state.settings || {};
    const textgen = settings.textgenerationwebui_settings || {};
    const oaiSettings = settings.oai_settings || {};
    const openaiSource = settings.chat_completion_source || oaiSettings.chat_completion_source || '';
    const openaiModel = openaiSource ? getChatCompletionModel(oaiSettings, openaiSource) : '';
    const textgenModel = textgen.openrouter_model || textgen.custom_model || textgen.generic_model || textgen.ollama_model || textgen.model || '';
    const chatPreset = oaiSettings.preset_settings_openai || settings.preset_settings_openai || '';
    const chatEndpoint = getChatCompletionEndpoint(openaiSource, oaiSettings);
    const textgenPreset = settings.textgenerationwebui_preset || settings.textgenerationwebui_settings_preset || '';
    const textgenEndpoint = maskEndpoint(textgen.server_urls?.[textgen.type] || textgen.api_server || settings.api_server_textgenerationwebui || '');
    const mainIsChat = settings.main_api === 'openai';
    const mainIsTextgen = settings.main_api === 'textgenerationwebui';

    return [
        {
            title: '主连接',
            kind: 'generation',
            active: true,
            source: settings.main_api || '',
            model: mainIsChat ? openaiModel : (mainIsTextgen ? textgenModel : settings.model || ''),
            preset: mainIsChat ? chatPreset : (mainIsTextgen ? textgenPreset : settings.preset_settings || settings.active_preset || ''),
            endpoint: mainIsChat ? chatEndpoint : (mainIsTextgen ? textgenEndpoint : maskEndpoint(settings.api_server || settings.api_server_textgenerationwebui || '')),
        },
        {
            title: '聊天补全',
            kind: 'chat-completions',
            active: settings.main_api === 'openai',
            source: openaiSource,
            model: openaiModel,
            preset: chatPreset,
            endpoint: chatEndpoint,
        },
        {
            title: '文本补全',
            kind: 'text-completions',
            active: settings.main_api === 'textgenerationwebui',
            source: textgen.type || settings.textgen_type || '',
            model: textgenModel,
            preset: textgenPreset,
            endpoint: textgenEndpoint,
        },
    ];
}

function getChatCompletionEndpoint(source, settings) {
    if (settings.reverse_proxy) {
        return maskEndpoint(settings.reverse_proxy);
    }
    if (source === 'siliconflow') {
        return settings.siliconflow_endpoint === 'cn' ? 'https://api.siliconflow.cn/v1' : 'https://api.siliconflow.com/v1';
    }
    if (source === 'custom') {
        return maskEndpoint(settings.custom_url || '');
    }
    if (source === 'openai') {
        return 'https://api.openai.com/v1';
    }
    return settings.custom_url ? maskEndpoint(settings.custom_url) : '';
}

function maskEndpoint(value) {
    if (!value) {
        return '';
    }

    try {
        const url = new URL(value);
        return `${url.origin}${url.pathname.replace(/\/+$/, '') || '/'}`;
    } catch {
        return String(value).replace(/(key|token|secret)=([^&]+)/gi, '$1=***');
    }
}

function getApiChecks(provider, profiles) {
    const secretKey = secretKeyByChatSource[provider.chatSource];
    const secretState = getSecretStateForSource(provider.chatSource);

    return [
        {
            label: '主 API',
            state: provider.api && provider.api !== '未选择' ? 'ok' : 'warn',
            detail: provider.api && provider.api !== '未选择' ? provider.api : '尚未选择主 API。',
        },
        {
            label: '模型',
            state: provider.model ? 'ok' : 'warn',
            detail: provider.model || '未读取到模型字段。',
        },
        {
            label: '连接档案',
            state: profiles.some(profile => profile.source || profile.model || profile.endpoint) ? 'ok' : 'warn',
            detail: `${formatNumber(profiles.length)} 个可见档案。`,
        },
        {
            label: '密钥显示',
            state: state.secrets?.allowKeysExposure ? 'warn' : 'ok',
            detail: state.secrets?.allowKeysExposure ? '当前允许查看密钥。' : '当前不会暴露密钥明文。',
        },
        {
            label: '当前来源密钥',
            state: !secretKey || secretState.length ? 'ok' : 'warn',
            detail: secretKey ? (secretState.length ? `${secretKey} 已保存` : `${secretKey} 未保存`) : '当前来源无需或暂未映射密钥。',
        },
        {
            label: 'CSRF',
            state: state.csrfToken ? 'ok' : 'warn',
            detail: state.csrfToken ? '现代页请求令牌正常。' : '尚未获取请求令牌。',
        },
    ];
}

function renderApiCheckRow(check) {
    const icon = check.state === 'ok' ? 'fa-circle-check success' : 'fa-triangle-exclamation danger';
    const label = check.state === 'ok' ? '正常' : '需检查';

    return `
        <tr>
            <td>${escapeHtml(check.label)}</td>
            <td><span class="${check.state === 'ok' ? 'success' : 'danger'}"><i class="fa-solid ${icon}"></i> ${label}</span></td>
            <td>${escapeHtml(check.detail)}</td>
        </tr>
    `;
}

function renderKeyValue(key, value) {
    return `
        <div class="kv-row">
            <span class="kv-key">${escapeHtml(key)}</span>
            <span class="kv-value" title="${escapeHtml(value ?? '未设置')}">${escapeHtml(value ?? '未设置')}</span>
        </div>
    `;
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

function renderExtensions() {
    const extensions = state.extensions.filter(extension => matchesQuery(extension.name, extension.type));

    return `
        ${pageHead('扩展', '内置、本地和全局扩展。', `
            <button class="primary-button" type="button" data-toggle-extension-install>
                <i class="fa-solid ${state.extensionInstall.active ? 'fa-xmark' : 'fa-plus'}"></i>
                ${state.extensionInstall.active ? '取消安装' : '安装扩展'}
            </button>
            ${legacyMenu('打开原版扩展')}
        `)}
        ${state.extensionInstall.active ? renderExtensionInstallPanel() : ''}
        <div class="table-wrap">
            <table>
                <thead>
                    <tr><th>扩展</th><th>类型</th><th>路径</th><th>操作</th></tr>
                </thead>
                <tbody>
                    ${extensions.map(extension => `
                        <tr>
                            <td>${escapeHtml(extension.name.replace('third-party/', ''))}</td>
                            <td><span class="tag">${escapeHtml(extension.type)}</span></td>
                            <td class="mono">${escapeHtml(extension.name)}</td>
                            <td>
                                ${canManageExtension(extension) ? `
                                    <div class="row-actions">
                                        <button class="secondary-button" type="button" data-extension-details="${escapeHtml(getExtensionFolderName(extension))}" data-extension-type="${escapeHtml(extension.type)}">
                                            <i class="fa-solid fa-circle-info"></i>
                                            详情
                                        </button>
                                        <button class="secondary-button" type="button" data-extension-action="update" data-extension-name="${escapeHtml(getExtensionFolderName(extension))}" data-extension-type="${escapeHtml(extension.type)}">
                                            <i class="fa-solid fa-download"></i>
                                            更新
                                        </button>
                                        ${state.me?.admin ? `
                                            <button class="secondary-button" type="button" data-extension-action="move" data-extension-name="${escapeHtml(getExtensionFolderName(extension))}" data-extension-type="${escapeHtml(extension.type)}">
                                                <i class="fa-solid fa-right-left"></i>
                                                ${extension.type === 'global' ? '移到本地' : '移到全局'}
                                            </button>
                                        ` : ''}
                                        <button class="secondary-button danger-action" type="button" data-extension-action="delete" data-extension-name="${escapeHtml(getExtensionFolderName(extension))}" data-extension-type="${escapeHtml(extension.type)}">
                                            <i class="fa-solid fa-trash"></i>
                                            删除
                                        </button>
                                    </div>
                                ` : '<span class="card-meta">内置只读</span>'}
                            </td>
                        </tr>
                        ${state.extensionDetails.name === getExtensionFolderName(extension) && state.extensionDetails.type === extension.type ? renderExtensionDetailsRow(extension) : ''}
                        ${state.extensionOperation.name === getExtensionFolderName(extension) && state.extensionOperation.type === extension.type ? renderExtensionOperationRow(extension) : ''}
                    `).join('') || '<tr><td colspan="4">暂无扩展</td></tr>'}
                </tbody>
            </table>
        </div>
    `;
}

function renderExtensionInstallPanel() {
    const install = state.extensionInstall;

    return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">安装扩展</h2>
                    <p class="panel-subtitle">从 Git 仓库安装第三方扩展；安装后会读取 manifest.json。</p>
                </div>
            </div>
            <div class="settings-form">
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>Git URL</span>
                        <input class="text-input" type="url" data-extension-install-url value="${escapeHtml(install.url)}" placeholder="https://github.com/user/extension.git" autocomplete="off">
                    </label>
                    <label class="field-label">
                        <span>分支</span>
                        <input class="text-input" type="text" data-extension-install-branch value="${escapeHtml(install.branch)}" placeholder="留空使用默认分支" autocomplete="off">
                    </label>
                    ${state.me?.admin ? `
                        <label class="checkbox-card compact-checkbox">
                            <input type="checkbox" data-extension-install-global ${install.global ? 'checked' : ''}>
                            <span>安装为全局扩展</span>
                        </label>
                    ` : ''}
                </div>
                <div class="message-edit-actions">
                    <button class="secondary-button" type="button" data-toggle-extension-install ${install.running ? 'disabled' : ''}>
                        <i class="fa-solid fa-xmark"></i>
                        取消
                    </button>
                    <button class="primary-button" type="button" data-install-extension ${install.running ? 'disabled' : ''}>
                        <i class="fa-solid ${install.running ? 'fa-circle-notch fa-spin' : 'fa-download'}"></i>
                        ${install.running ? '安装中' : '安装扩展'}
                    </button>
                </div>
            </div>
        </section>
    `;
}

function renderExtensionDetailsRow(extension) {
    const details = state.extensionDetails;
    const version = details.version || {};
    const currentHash = version.currentCommitHash ? String(version.currentCommitHash).slice(0, 12) : '未读取';
    const status = details.loading
        ? '读取中'
        : (details.error ? '读取失败' : (version.isUpToDate === false ? '有更新' : '最新'));
    const branchOptions = uniqueValues([
        details.branch,
        version.currentBranchName,
        ...details.branches.map(branch => branch.name),
    ].filter(Boolean));

    return `
        <tr>
            <td colspan="4">
                <div class="settings-form inline-form">
                    <div class="panel-header compact-header">
                        <div>
                            <strong>${escapeHtml(getExtensionFolderName(extension))}</strong>
                            <p class="panel-subtitle">${escapeHtml(extension.type)} · ${escapeHtml(version.remoteUrl || '未读取远端')}</p>
                        </div>
                        <span class="badge ${details.error || version.isUpToDate === false ? 'danger' : ''}">${escapeHtml(status)}</span>
                    </div>
                    ${details.error ? `<p class="danger">${escapeHtml(details.error)}</p>` : ''}
                    <div class="kv-list">
                        ${renderKeyValue('当前分支', version.currentBranchName || '未读取')}
                        ${renderKeyValue('当前提交', currentHash)}
                        ${renderKeyValue('远端', version.remoteUrl || '未配置')}
                        ${renderKeyValue('分支数量', details.branches.length ? formatNumber(details.branches.length) : '未读取')}
                    </div>
                    <div class="form-grid two-columns">
                        <label class="field-label">
                            <span>目标分支</span>
                            ${branchOptions.length ? `
                                <select class="select-input" data-extension-branch>
                                    ${branchOptions.map(branch => `<option value="${escapeHtml(branch)}" ${details.branch === branch ? 'selected' : ''}>${escapeHtml(branch)}</option>`).join('')}
                                </select>
                            ` : `
                                <input class="text-input" type="text" data-extension-branch value="${escapeHtml(details.branch)}" placeholder="先读取分支或输入本地分支">
                            `}
                        </label>
                    </div>
                    <div class="message-edit-actions">
                        <button class="secondary-button" type="button" data-refresh-extension-details="${escapeHtml(details.name)}" data-extension-type="${escapeHtml(details.type)}" ${details.loading ? 'disabled' : ''}>
                            <i class="fa-solid ${details.loading ? 'fa-circle-notch fa-spin' : 'fa-rotate'}"></i>
                            刷新状态
                        </button>
                        <button class="secondary-button" type="button" data-load-extension-branches="${escapeHtml(details.name)}" data-extension-type="${escapeHtml(details.type)}" ${details.loading ? 'disabled' : ''}>
                            <i class="fa-solid ${details.loading ? 'fa-circle-notch fa-spin' : 'fa-code-branch'}"></i>
                            读取分支
                        </button>
                        <button class="secondary-button" type="button" data-switch-extension-branch ${details.loading || !details.branch ? 'disabled' : ''}>
                            <i class="fa-solid fa-code-compare"></i>
                            切换分支
                        </button>
                    </div>
                </div>
            </td>
        </tr>
    `;
}

function renderExtensionOperationRow(extension) {
    const operation = state.extensionOperation;
    const isDelete = operation.action === 'delete';
    const isMove = operation.action === 'move';
    const title = isDelete ? '删除扩展' : (isMove ? '移动扩展' : '更新扩展');
    const description = isDelete
        ? '删除会移除扩展目录。'
        : (isMove ? `将扩展移动到${extension.type === 'global' ? '本地' : '全局'}目录。` : '更新会执行 git pull。');

    return `
        <tr>
            <td colspan="4">
                <div class="settings-form inline-form ${isDelete ? 'danger-panel' : ''}">
                    <div>
                        <strong>${title}</strong>
                        <p class="panel-subtitle">${escapeHtml(getExtensionFolderName(extension))} · ${escapeHtml(extension.type)}。${escapeHtml(description)}</p>
                    </div>
                    <div class="message-edit-actions">
                        <button class="secondary-button" type="button" data-cancel-extension-operation ${operation.running ? 'disabled' : ''}>
                            <i class="fa-solid fa-xmark"></i>
                            取消
                        </button>
                        <button class="secondary-button ${isDelete ? 'danger-action' : ''}" type="button" data-confirm-extension-operation ${operation.running ? 'disabled' : ''}>
                            <i class="fa-solid ${operation.running ? 'fa-circle-notch fa-spin' : (isDelete ? 'fa-trash' : (isMove ? 'fa-right-left' : 'fa-download'))}"></i>
                            ${operation.running ? '处理中' : '确认'}
                        </button>
                    </div>
                </div>
            </td>
        </tr>
    `;
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

function formatDurationMs(value) {
    const ms = Number(value || 0);
    if (!ms) {
        return '0s';
    }
    if (ms < 1000) {
        return `${formatNumber(ms)}ms`;
    }
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) {
        return `${formatNumber(seconds)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${formatNumber(minutes)}m ${formatNumber(rest)}s`;
}

function renderActivityEntryRow(entry) {
    return `
        <tr>
            <td class="mono">${escapeHtml(entry.id)}</td>
            <td>${formatNumber(entry.messages)}</td>
            <td>${formatNumber(entry.words)}</td>
            <td>${formatBytes(entry.size)}</td>
            <td>${formatNumber(entry.swipes)}</td>
            <td>${escapeHtml(formatDate(entry.last))}</td>
        </tr>
    `;
}

function renderActivity() {
    const stats = state.stats || {};
    const entries = getActivityEntries();
    const summary = getActivitySummary(entries);
    const rawRows = Object.entries(stats).slice(0, 80);
    const statsUpdatedAt = Number(stats.timestamp || 0);

    return `
        ${pageHead('活动与统计', '统计缓存和使用记录。', `
            <button class="secondary-button" type="button" data-recreate-stats>
                <i class="fa-solid fa-chart-simple"></i>
                重建统计
            </button>
            <button class="secondary-button" type="button" data-refresh>
                <i class="fa-solid fa-rotate"></i>
                刷新
            </button>
        `)}
        <div class="metrics-grid">
            ${metricCard('统计对象', formatNumber(entries.length), '有聊天统计的角色或群聊', 'fa-id-card')}
            ${metricCard('消息总量', formatNumber(summary.messages), `${formatNumber(summary.words)} words`, 'fa-message')}
            ${metricCard('聊天体积', formatBytes(summary.size), `${formatNumber(summary.swipes)} swipes`, 'fa-database')}
            ${metricCard('最近活动', statsUpdatedAt ? formatDate(statsUpdatedAt) : '未生成', summary.last ? `最近聊天 ${formatDate(summary.last)}` : '无聊天记录', 'fa-clock')}
        </div>
        ${entries.length ? `
            <section class="panel section-panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">活跃对象</h2>
                        <p class="panel-subtitle">按最近聊天时间排序，展示消息、词数和缓存体积。</p>
                    </div>
                    <span class="badge">生成耗时 ${escapeHtml(formatDurationMs(summary.genTime))}</span>
                </div>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr><th>对象</th><th>消息</th><th>词数</th><th>大小</th><th>候选</th><th>最近聊天</th></tr>
                        </thead>
                        <tbody>
                            ${entries.slice(0, 80).map(renderActivityEntryRow).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
        ` : renderEmptyState('fa-chart-line', '暂无统计数据', '统计缓存为空或尚未生成。')}
        ${rawRows.length ? `
            <details class="panel section-panel raw-data-panel">
                <summary>
                    <span>
                        <strong>原始统计数据</strong>
                        <em>${formatNumber(rawRows.length)} 个字段</em>
                    </span>
                    <i class="fa-solid fa-chevron-down"></i>
                </summary>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr><th>字段</th><th>值</th></tr>
                        </thead>
                        <tbody>
                            ${rawRows.map(([key, value]) => `
                                <tr>
                                    <td class="mono">${escapeHtml(key)}</td>
                                    <td>${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : value)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </details>
        ` : ''}
    `;
}

function renderSettings() {
    const bundle = state.settingsBundle || {};
    const requestCompression = bundle.request_compression || {};
    const savedSecrets = Object.values(state.secretState || {}).filter(value => Array.isArray(value) ? value.length > 0 : Boolean(value)).length;
    const snapshotCount = state.settingsSnapshots.items.length;
    const compressionEnabled = Boolean(requestCompression.enabled);
    const dataStatus = state.errors.length ? '需要处理' : '正常';

    return `
        ${pageHead('设置中心', '账户、扩展、请求压缩和页面偏好。', `
            <button class="primary-button" type="button" data-create-settings-snapshot ${state.settingsSnapshots.creating ? 'disabled' : ''}>
                <i class="fa-solid ${state.settingsSnapshots.creating ? 'fa-circle-notch fa-spin' : 'fa-camera'}"></i>
                创建快照
            </button>
            <button class="secondary-button" type="button" data-load-settings-snapshots ${state.settingsSnapshots.loading ? 'disabled' : ''}>
                <i class="fa-solid ${state.settingsSnapshots.loading ? 'fa-circle-notch fa-spin' : 'fa-clock-rotate-left'}"></i>
                设置快照
            </button>
            ${legacyMenu('打开原版设置')}
        `)}
        <div class="metrics-grid">
            ${metricCard('数据状态', dataStatus, state.errors.length ? `${formatNumber(state.errors.length)} 个读取错误` : '读取正常', 'fa-heart-pulse')}
            ${metricCard('扩展', formatNumber(state.extensions.length), bundle.enable_extensions ? '扩展系统开启' : '扩展系统关闭', 'fa-cubes')}
            ${metricCard('安全密钥', formatNumber(savedSecrets), '仅显示保存状态', 'fa-key')}
            ${metricCard('设置快照', formatNumber(snapshotCount), state.settingsSnapshots.loading ? '读取中' : '本地备份', 'fa-clock-rotate-left')}
        </div>
        <div class="grid-list">
            <article class="resource-card">
                <h2 class="card-title">用户与账户</h2>
                <p class="card-meta">当前登录与权限状态。</p>
                <div class="kv-list">
                    ${renderKeyValue('当前用户', state.me?.name || state.me?.handle || '默认用户')}
                    ${renderKeyValue('管理员', state.me?.admin ? '是' : '否')}
                    ${renderKeyValue('账户系统', bundle.enable_accounts ? '开启' : '关闭')}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">扩展能力</h2>
                <p class="card-meta">第三方扩展发现、安装和更新策略。</p>
                <div class="kv-list">
                    ${renderKeyValue('扩展启用', bundle.enable_extensions ? '是' : '否')}
                    ${renderKeyValue('自动更新', bundle.enable_extensions_auto_update ? '是' : '否')}
                    ${renderKeyValue('发现数量', state.extensions.length)}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">请求压缩</h2>
                <p class="card-meta">控制大请求的压缩边界。</p>
                <div class="kv-list">
                    ${renderKeyValue('启用', compressionEnabled ? '是' : '否')}
                    ${renderKeyValue('最小载荷', formatBytes(requestCompression.minPayloadSize))}
                    ${renderKeyValue('最大载荷', formatBytes(requestCompression.maxPayloadSize))}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">现代界面</h2>
                <p class="card-meta">新版工作区本地偏好。</p>
                <div class="kv-list">
                    ${renderKeyValue('主题', state.theme)}
                    ${renderKeyValue('聊天类型', getChatModeLabel())}
                    ${renderKeyValue('聊天列表', state.chatSidebarOpen ? '展开' : '收起')}
                    ${renderKeyValue('上下文抽屉', state.inspectorOpen ? '展开' : '收起')}
                    ${renderKeyValue('入口', '/modern/')}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">资源索引</h2>
                <p class="card-meta">当前用户目录读取到的核心对象。</p>
                <div class="kv-list">
                    ${renderKeyValue('角色', formatNumber(state.characters.length))}
                    ${renderKeyValue('群聊', formatNumber(state.groups.length))}
                    ${renderKeyValue('世界书', formatNumber(state.worldbooks.length || (state.settingsBundle.world_names || []).length))}
                    ${renderKeyValue('素材', formatNumber(getAssetCount()))}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">请求安全</h2>
                <p class="card-meta">现代页请求令牌和密钥状态。</p>
                <div class="kv-list">
                    ${renderKeyValue('CSRF', state.csrfToken ? '已获取' : '未获取')}
                    ${renderKeyValue('密钥状态', savedSecrets ? `${formatNumber(savedSecrets)} 个已保存` : '未读取到')}
                    ${renderKeyValue('错误状态', dataStatus)}
                </div>
            </article>
        </div>
        ${renderSettingsSnapshots()}
    `;
}

function renderSettingsSnapshots() {
    const snapshots = state.settingsSnapshots.items;
    const selectedSnapshot = state.settingsSnapshots.previewName;
    const isLoading = state.settingsSnapshots.loading;

    return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">设置快照</h2>
                    <p class="panel-subtitle">备份和恢复 settings.json。恢复前会要求二次确认。</p>
                </div>
                <button class="secondary-button" type="button" data-load-settings-snapshots ${isLoading ? 'disabled' : ''}>
                    <i class="fa-solid ${isLoading ? 'fa-circle-notch fa-spin' : 'fa-rotate'}"></i>
                    刷新
                </button>
            </div>
            <div class="backup-layout">
                <div class="resource-list backup-list">
                    ${snapshots.map(snapshot => renderSettingsSnapshotRow(snapshot)).join('') || renderInlineEmpty(isLoading ? '正在读取设置快照' : '暂无设置快照')}
                </div>
                <div class="backup-preview">
                    ${selectedSnapshot ? `
                        <div class="panel-header compact-header">
                            <div>
                                <h3 class="panel-title">${escapeHtml(selectedSnapshot)}</h3>
                                <p class="panel-subtitle">只读预览。恢复会替换当前 settings.json。</p>
                            </div>
                        </div>
                        <textarea readonly>${escapeHtml(state.settingsSnapshots.previewText)}</textarea>
                    ` : renderEmptyState('fa-file-code', '未选择快照', '点击“预览”查看快照内容。')}
                </div>
            </div>
        </section>
    `;
}

function renderSettingsSnapshotRow(snapshot) {
    const name = snapshot.name || '';
    const isConfirming = state.settingsSnapshots.restoreConfirm === name;
    const isBusy = state.settingsSnapshots.restoring && isConfirming;
    return `
        <article class="backup-row ${state.settingsSnapshots.previewName === name ? 'active' : ''}">
            <div class="row-main">
                <strong class="row-title">${escapeHtml(name)}</strong>
                <span class="row-subtitle">${escapeHtml(formatDate(snapshot.date))} · ${escapeHtml(formatBytes(snapshot.size))}</span>
            </div>
            <div class="row-actions">
                <button class="secondary-button" type="button" data-preview-settings-snapshot="${escapeHtml(name)}" ${isBusy ? 'disabled' : ''}>
                    <i class="fa-solid fa-eye"></i>
                    预览
                </button>
                ${isConfirming ? `
                    <button class="secondary-button" type="button" data-cancel-settings-restore ${state.settingsSnapshots.restoring ? 'disabled' : ''}>
                        取消
                    </button>
                    <button class="secondary-button danger-action" type="button" data-confirm-settings-restore ${state.settingsSnapshots.restoring ? 'disabled' : ''}>
                        <i class="fa-solid ${state.settingsSnapshots.restoring ? 'fa-circle-notch fa-spin' : 'fa-rotate-left'}"></i>
                        确认恢复
                    </button>
                ` : `
                    <button class="secondary-button danger-action" type="button" data-restore-settings-snapshot="${escapeHtml(name)}" ${state.settingsSnapshots.restoring ? 'disabled' : ''}>
                        <i class="fa-solid fa-rotate-left"></i>
                        恢复
                    </button>
                `}
            </div>
        </article>
    `;
}

function renderEmptyState(icon, title, description) {
    return `
        <div class="empty-state">
            <div>
                <i class="fa-solid ${icon}"></i>
                <strong>${escapeHtml(title)}</strong>
                <div>${escapeHtml(description)}</div>
            </div>
        </div>
    `;
}

function renderLoading() {
    return `
        <div class="loading-state">
            <div>
                <i class="fa-solid fa-circle-notch fa-spin"></i>
                <strong>正在读取 SillyTavern 数据</strong>
                <div>角色、世界书、预设、素材和扩展会并发加载。</div>
            </div>
        </div>
    `;
}

function renderContent() {
    if (state.loading && !state.loaded) {
        elements.content.innerHTML = renderLoading();
        return;
    }

    switch (state.route) {
        case 'dashboard':
            elements.content.innerHTML = renderDashboard();
            break;
        case 'chat':
            elements.content.innerHTML = renderChat();
            break;
        case 'characters':
            elements.content.innerHTML = renderCharacters();
            break;
        case 'worldbooks':
            elements.content.innerHTML = renderWorldbooks();
            break;
        case 'presets':
            elements.content.innerHTML = renderPresets();
            break;
        case 'personas':
            elements.content.innerHTML = renderPersonas();
            break;
        case 'assets':
            elements.content.innerHTML = renderAssets();
            break;
        case 'api':
            elements.content.innerHTML = renderApi();
            break;
        case 'extensions':
            elements.content.innerHTML = renderExtensions();
            break;
        case 'activity':
            elements.content.innerHTML = renderActivity();
            break;
        case 'settings':
            elements.content.innerHTML = renderSettings();
            break;
        default:
            elements.content.innerHTML = renderDashboard();
    }
}

function renderInspector() {
    const provider = getProviderInfo();
    const selectedCharacter = state.characters.find(character => character.avatar === state.selected.character);
    const selectedGroup = state.groups.find(group => group.id === state.selected.group);
    const selectedEntity = getSelectedChatEntity();
    const selectedWorldbook = state.worldbooks.find(worldbook => worldbook.file_id === state.selected.worldbook);
    const selectedChat = getSelectedChatList().find(chat => chat.file_id === state.selected.chat);
    const selectedGroupMembers = selectedGroup?.members?.length ?? 0;
    const currentContextDetail = isGroupChatMode()
        ? renderKeyValue('群聊成员', selectedGroup ? `${formatNumber(selectedGroupMembers)} 个` : '未选中')
        : renderKeyValue('角色文件', selectedCharacter?.avatar || '未选中');

    elements.inspector.classList.toggle('open', state.inspectorOpen);
    elements.inspector.setAttribute('aria-hidden', state.inspectorOpen ? 'false' : 'true');
    document.querySelectorAll('[data-toggle-inspector]').forEach(button => {
        button.classList.toggle('active', state.inspectorOpen);
        button.setAttribute('aria-pressed', state.inspectorOpen ? 'true' : 'false');
    });

    elements.inspector.innerHTML = `
        <section class="inspector-section inspector-head">
            <div>
                <h2 class="inspector-title">上下文</h2>
                <p class="panel-subtitle">当前页面、连接和选中资源。</p>
            </div>
            <button class="icon-button mini" type="button" data-toggle-inspector title="关闭上下文">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </section>
        <section class="inspector-section">
            <h2 class="inspector-title">会话</h2>
            <div class="kv-list">
                ${renderKeyValue('用户', state.me?.name || state.me?.handle || '默认用户')}
                ${renderKeyValue('入口', routeLabels[state.route])}
                ${renderKeyValue('状态', state.errors.length ? '部分失败' : '正常')}
            </div>
        </section>
        <section class="inspector-section">
            <h2 class="inspector-title">API</h2>
            <div class="kv-list">
                ${renderKeyValue('主 API', provider.api)}
                ${renderKeyValue('来源', provider.chatSource || '未配置')}
                ${renderKeyValue('模型', provider.model || '未配置')}
            </div>
        </section>
        <section class="inspector-section">
            <h2 class="inspector-title">当前上下文</h2>
            <div class="kv-list">
                ${renderKeyValue('聊天类型', getChatModeLabel())}
                ${renderKeyValue('当前对象', getChatEntityName(selectedEntity))}
                ${currentContextDetail}
                ${renderKeyValue('聊天文件', selectedChat?.file_name || state.selected.chat || '未选中')}
                ${renderKeyValue('世界书', selectedWorldbook?.name || selectedWorldbook?.file_id || '未选中')}
            </div>
        </section>
        <section class="inspector-section">
            <h2 class="inspector-title">读取错误</h2>
            ${state.errors.length ? `
                <div class="kv-list">
                    ${state.errors.map(error => renderKeyValue(error.key, error.message)).join('')}
                </div>
            ` : '<p class="muted">暂无错误。</p>'}
        </section>
    `;
}

function renderPalette() {
    const query = normalizeText(state.paletteQuery);
    const routeCommands = routes.map(route => ({
        type: '页面',
        label: route.label,
        detail: route.id,
        route: route.id,
    }));
    const characterCommands = state.characters.slice(0, 80).map(character => ({
        type: '角色',
        label: character.name || character.data?.name || character.avatar,
        detail: character.avatar,
        route: 'characters',
        select: 'character',
        id: character.avatar,
    }));
    const worldCommands = state.worldbooks.slice(0, 80).map(worldbook => ({
        type: '世界书',
        label: worldbook.name || worldbook.file_id,
        detail: worldbook.file_id,
        route: 'worldbooks',
        select: 'worldbook',
        id: worldbook.file_id,
    }));
    const commands = [...routeCommands, ...characterCommands, ...worldCommands]
        .filter(command => !query || normalizeText(`${command.type} ${command.label} ${command.detail}`).includes(query))
        .slice(0, 40);

    elements.paletteResults.innerHTML = commands.map(command => `
        <button class="command-row" type="button" data-command-route="${escapeHtml(command.route)}" data-command-select="${escapeHtml(command.select || '')}" data-command-id="${escapeHtml(command.id || '')}">
            <span class="avatar-fallback"><i class="fa-solid fa-arrow-right"></i></span>
            <span class="row-main">
                <span class="row-title">${escapeHtml(command.label)}</span>
                <span class="row-subtitle">${escapeHtml(command.type)} · ${escapeHtml(command.detail)}</span>
            </span>
        </button>
    `).join('') || renderInlineEmpty('没有匹配结果');
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

function openLegacy() {
    window.location.href = '/';
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
        await setRoute(routeButton.dataset.route);
        elements.app.querySelector('.sidebar')?.classList.remove('open');
        return;
    }

    const chatModeButton = event.target.closest('[data-chat-mode]');
    if (chatModeButton) {
        const nextMode = chatModeButton.dataset.chatMode === 'group' ? 'group' : 'character';
        if (state.chatMode !== nextMode) {
            state.chatMode = nextMode;
            localStorage.setItem('st-modern-chat-mode', nextMode);
            state.selected.chat = '';
            state.chatRenaming = { key: '', name: '' };
            state.chatDeleteConfirm = { key: '', name: '' };
            state.chatEditing = { key: '', index: -1, text: '' };
            clearChatSearch();
            await prepareChatForSelectedContext();
        }
        render();
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

    const chatButton = event.target.closest('[data-select-chat]');
    if (chatButton) {
        state.selected.chat = chatButton.dataset.selectChat;
        await loadChatMessages(getSelectedChatEntity(), state.selected.chat);
        render();
        return;
    }

    if (event.target.closest('[data-chat-search-run]')) {
        try {
            if (!state.chatSearch.query.trim()) {
                clearChatSearch();
            } else {
                await searchSelectedChats();
            }
            render();
        } catch (error) {
            state.errors.push({ key: 'chat-search', message: error.message });
            showToast('聊天搜索失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-chat-search-clear]')) {
        clearChatSearch();
        render();
        return;
    }

    if (event.target.closest('[data-chat-backups-toggle]')) {
        try {
            await toggleChatBackups();
        } catch (error) {
            state.errors.push({ key: 'chat-backups', message: error.message });
            showToast('备份读取失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-chat-backups-refresh]')) {
        try {
            await loadChatBackups({ force: true });
            render();
        } catch (error) {
            state.errors.push({ key: 'chat-backups', message: error.message });
            showToast('备份刷新失败', error.message);
            render();
        }
        return;
    }

    const exportChatButton = event.target.closest('[data-export-chat]');
    if (exportChatButton) {
        try {
            await exportModernChat(exportChatButton.dataset.exportChat);
        } catch (error) {
            state.errors.push({ key: 'chat-export', message: error.message });
            showToast('聊天导出失败', error.message);
            render();
        }
        return;
    }

    const viewChatBackupButton = event.target.closest('[data-view-chat-backup]');
    if (viewChatBackupButton) {
        try {
            await viewChatBackup(viewChatBackupButton.dataset.viewChatBackup);
        } catch (error) {
            state.errors.push({ key: 'chat-backup-view', message: error.message });
            showToast('备份预览失败', error.message);
            render();
        }
        return;
    }

    const restoreChatBackupButton = event.target.closest('[data-restore-chat-backup]');
    if (restoreChatBackupButton) {
        try {
            await restoreChatBackup(restoreChatBackupButton.dataset.restoreChatBackup);
        } catch (error) {
            state.errors.push({ key: 'chat-backup-restore', message: error.message });
            showToast('备份恢复失败', error.message);
            render();
        }
        return;
    }

    const deleteChatBackupButton = event.target.closest('[data-delete-chat-backup]');
    if (deleteChatBackupButton) {
        beginChatBackupDelete(deleteChatBackupButton.dataset.deleteChatBackup);
        return;
    }

    if (event.target.closest('[data-cancel-chat-backup-delete]')) {
        cancelChatBackupDelete();
        return;
    }

    if (event.target.closest('[data-confirm-chat-backup-delete]')) {
        try {
            await confirmChatBackupDelete();
        } catch (error) {
            state.errors.push({ key: 'chat-backup-delete', message: error.message });
            showToast('备份删除失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-send-message]')) {
        try {
            await sendModernMessage();
        } catch (error) {
            state.errors.push({ key: 'modern-send', message: error.message });
            showToast('发送失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-stop-generation]')) {
        await stopModernGeneration();
        return;
    }

    if (event.target.closest('[data-regenerate-message]')) {
        try {
            await regenerateModernReply();
        } catch (error) {
            state.errors.push({ key: 'regenerate', message: error.message });
            showToast('重生成失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-continue-message]')) {
        try {
            await continueModernReply();
        } catch (error) {
            state.errors.push({ key: 'continue-message', message: error.message });
            showToast('继续生成失败', error.message);
            render();
        }
        return;
    }

    const swipeMessageButton = event.target.closest('[data-swipe-message]');
    if (swipeMessageButton) {
        try {
            await swipeModernMessage(swipeMessageButton.dataset.swipeMessage, swipeMessageButton.dataset.swipeDirection);
        } catch (error) {
            state.errors.push({ key: 'swipe-message', message: error.message });
            showToast('候选切换失败', error.message);
            render();
        }
        return;
    }

    const copyMessageButton = event.target.closest('[data-copy-message]');
    if (copyMessageButton) {
        try {
            await copyModernMessage(copyMessageButton.dataset.copyMessage);
        } catch (error) {
            state.errors.push({ key: 'copy-message', message: error.message });
            showToast('复制消息失败', error.message);
            render();
        }
        return;
    }

    const deleteMessageButton = event.target.closest('[data-delete-message]');
    if (deleteMessageButton) {
        try {
            await deleteModernMessage(deleteMessageButton.dataset.deleteMessage);
        } catch (error) {
            state.errors.push({ key: 'delete-message', message: error.message });
            showToast('删除消息失败', error.message);
            render();
        }
        return;
    }

    const editMessageButton = event.target.closest('[data-edit-message]');
    if (editMessageButton) {
        beginModernMessageEdit(editMessageButton.dataset.editMessage);
        return;
    }

    if (event.target.closest('[data-cancel-edit-message]')) {
        cancelModernMessageEdit();
        return;
    }

    if (event.target.closest('[data-save-edit-message]')) {
        try {
            await saveModernMessageEdit();
        } catch (error) {
            state.errors.push({ key: 'edit-message', message: error.message });
            showToast('保存消息失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-new-chat]')) {
        try {
            await startNewModernChat();
        } catch (error) {
            state.errors.push({ key: 'new-chat', message: error.message });
            showToast('新聊天创建失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-rename-chat]')) {
        beginModernChatRename();
        return;
    }

    if (event.target.closest('[data-cancel-chat-rename]')) {
        cancelModernChatRename();
        return;
    }

    if (event.target.closest('[data-save-chat-rename]')) {
        try {
            await saveModernChatRename();
        } catch (error) {
            state.errors.push({ key: 'rename-chat', message: error.message });
            showToast('聊天重命名失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-delete-chat]')) {
        beginModernChatDelete();
        return;
    }

    if (event.target.closest('[data-cancel-chat-delete]')) {
        cancelModernChatDelete();
        return;
    }

    if (event.target.closest('[data-confirm-chat-delete]')) {
        try {
            await confirmModernChatDelete();
        } catch (error) {
            state.errors.push({ key: 'delete-chat', message: error.message });
            showToast('聊天删除失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-create-character]')) {
        beginCharacterCreate();
        return;
    }

    if (event.target.closest('[data-cancel-character-create]')) {
        cancelCharacterCreate();
        return;
    }

    if (event.target.closest('[data-save-character-create]')) {
        try {
            await saveCharacterCreate();
        } catch (error) {
            state.errors.push({ key: 'character-create', message: error.message });
            showToast('角色创建失败', error.message);
            render();
        }
        return;
    }

    const loadCharacterButton = event.target.closest('[data-load-character-detail]');
    if (loadCharacterButton) {
        await loadCharacterDetail(loadCharacterButton.dataset.loadCharacterDetail, { force: true });
        render();
        return;
    }

    const editCharacterButton = event.target.closest('[data-edit-character]');
    if (editCharacterButton) {
        await beginCharacterEdit(editCharacterButton.dataset.editCharacter);
        return;
    }

    if (event.target.closest('[data-cancel-character-edit]')) {
        cancelCharacterEdit();
        return;
    }

    if (event.target.closest('[data-save-character-edit]')) {
        try {
            await saveCharacterEdit();
        } catch (error) {
            state.errors.push({ key: 'character-edit', message: error.message });
            showToast('角色保存失败', error.message);
            render();
        }
        return;
    }

    const duplicateCharacterButton = event.target.closest('[data-duplicate-character]');
    if (duplicateCharacterButton) {
        try {
            await duplicateCharacter(duplicateCharacterButton.dataset.duplicateCharacter);
        } catch (error) {
            state.errors.push({ key: 'character-duplicate', message: error.message });
            showToast('角色复制失败', error.message);
            render();
        }
        return;
    }

    const renameCharacterButton = event.target.closest('[data-rename-character]');
    if (renameCharacterButton) {
        const character = getCharacterByAvatar(renameCharacterButton.dataset.renameCharacter);
        if (character) {
            beginCharacterRename(character);
        }
        return;
    }

    if (event.target.closest('[data-cancel-character-rename]')) {
        cancelCharacterRename();
        return;
    }

    if (event.target.closest('[data-confirm-character-rename]')) {
        try {
            await confirmCharacterRename();
        } catch (error) {
            state.errors.push({ key: 'character-rename', message: error.message });
            showToast('角色重命名失败', error.message);
            render();
        }
        return;
    }

    const exportCharacterButton = event.target.closest('[data-export-character]');
    if (exportCharacterButton) {
        try {
            await exportCharacter(exportCharacterButton.dataset.exportCharacter, exportCharacterButton.dataset.characterExportFormat || 'png');
        } catch (error) {
            state.errors.push({ key: 'character-export', message: error.message });
            showToast('角色导出失败', error.message);
            render();
        }
        return;
    }

    const deleteCharacterButton = event.target.closest('[data-delete-character]');
    if (deleteCharacterButton) {
        const character = getCharacterByAvatar(deleteCharacterButton.dataset.deleteCharacter);
        if (character) {
            beginCharacterDelete(character);
        }
        return;
    }

    if (event.target.closest('[data-cancel-character-delete]')) {
        cancelCharacterDelete();
        return;
    }

    if (event.target.closest('[data-confirm-character-delete]')) {
        try {
            await confirmCharacterDelete();
        } catch (error) {
            state.errors.push({ key: 'character-delete', message: error.message });
            showToast('角色删除失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-create-persona]')) {
        beginPersonaCreate();
        return;
    }

    if (event.target.closest('[data-cancel-persona-create]')) {
        cancelPersonaCreate();
        return;
    }

    if (event.target.closest('[data-save-persona-create]')) {
        try {
            await savePersonaCreate();
        } catch (error) {
            state.errors.push({ key: 'persona-create', message: error.message });
            showToast('用户人设创建失败', error.message);
            render();
        }
        return;
    }

    const editPersonaButton = event.target.closest('[data-edit-persona]');
    if (editPersonaButton) {
        const persona = getPersonas().find(item => item.avatarId === editPersonaButton.dataset.editPersona);
        if (persona) {
            beginPersonaEdit(persona);
        }
        return;
    }

    const defaultPersonaButton = event.target.closest('[data-set-default-persona]');
    if (defaultPersonaButton) {
        try {
            await setDefaultPersona(defaultPersonaButton.dataset.setDefaultPersona);
        } catch (error) {
            state.errors.push({ key: 'persona-default', message: error.message });
            showToast('默认人设保存失败', error.message);
            render();
        }
        return;
    }

    const deletePersonaButton = event.target.closest('[data-delete-persona]');
    if (deletePersonaButton) {
        beginPersonaDelete(deletePersonaButton.dataset.deletePersona);
        return;
    }

    if (event.target.closest('[data-cancel-persona-delete]')) {
        cancelPersonaDelete();
        return;
    }

    if (event.target.closest('[data-confirm-persona-delete]')) {
        try {
            await confirmPersonaDelete();
        } catch (error) {
            state.errors.push({ key: 'persona-delete', message: error.message });
            showToast('用户人设删除失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-cancel-persona-edit]')) {
        cancelPersonaEdit();
        return;
    }

    if (event.target.closest('[data-save-persona-edit]')) {
        try {
            await savePersonaEdit();
        } catch (error) {
            state.errors.push({ key: 'persona-edit', message: error.message });
            showToast('用户人设保存失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-toggle-background-selection]')) {
        setBackgroundSelectionMode(!state.backgroundSelection.active);
        return;
    }

    if (event.target.closest('[data-delete-selected-backgrounds]')) {
        try {
            beginBackgroundBatchDelete();
        } catch (error) {
            showToast('请选择背景', error.message);
        }
        return;
    }

    if (event.target.closest('[data-cancel-background-delete]')) {
        cancelBackgroundDelete();
        return;
    }

    if (event.target.closest('[data-confirm-background-delete]')) {
        try {
            await confirmBackgroundDelete();
        } catch (error) {
            state.errors.push({ key: 'background-delete', message: error.message });
            showToast('背景删除失败', error.message);
            render();
        }
        return;
    }

    const backgroundRenameButton = event.target.closest('[data-background-rename]');
    if (backgroundRenameButton) {
        beginBackgroundRename(backgroundRenameButton.dataset.backgroundRename);
        return;
    }

    if (event.target.closest('[data-cancel-background-rename]')) {
        cancelBackgroundRename();
        return;
    }

    if (event.target.closest('[data-confirm-background-rename]')) {
        try {
            await confirmBackgroundRename();
        } catch (error) {
            state.errors.push({ key: 'background-rename', message: error.message });
            showToast('背景重命名失败', error.message);
            state.backgroundRenaming.running = false;
            render();
        }
        return;
    }

    if (event.target.closest('[data-toggle-asset-download]')) {
        toggleAssetDownload();
        return;
    }

    if (event.target.closest('[data-download-asset]')) {
        try {
            await downloadAssetFromForm();
        } catch (error) {
            state.errors.push({ key: 'asset-download', message: error.message });
            showToast('资产下载失败', error.message);
            state.assetDownload.running = false;
            render();
        }
        return;
    }

    const deleteAssetButton = event.target.closest('[data-delete-asset]');
    if (deleteAssetButton) {
        beginAssetDelete(deleteAssetButton.dataset.assetCategory, deleteAssetButton.dataset.assetFilename);
        return;
    }

    if (event.target.closest('[data-cancel-asset-delete]')) {
        cancelAssetDelete();
        return;
    }

    if (event.target.closest('[data-confirm-asset-delete]')) {
        try {
            await confirmAssetDelete();
        } catch (error) {
            state.errors.push({ key: 'asset-delete', message: error.message });
            showToast('资产删除失败', error.message);
            state.assetDeleteConfirm.running = false;
            render();
        }
        return;
    }

    if (event.target.closest('[data-toggle-extension-install]')) {
        toggleExtensionInstall();
        return;
    }

    if (event.target.closest('[data-install-extension]')) {
        try {
            await installExtensionFromForm();
        } catch (error) {
            state.errors.push({ key: 'extension-install', message: error.message });
            showToast('扩展安装失败', error.message);
            state.extensionInstall.running = false;
            render();
        }
        return;
    }

    const extensionDetailsButton = event.target.closest('[data-extension-details]');
    if (extensionDetailsButton) {
        try {
            await loadExtensionDetails(extensionDetailsButton.dataset.extensionDetails, extensionDetailsButton.dataset.extensionType);
        } catch (error) {
            state.errors.push({ key: 'extension-details', message: error.message });
            showToast('扩展状态读取失败', error.message);
        }
        return;
    }

    const refreshExtensionDetailsButton = event.target.closest('[data-refresh-extension-details]');
    if (refreshExtensionDetailsButton) {
        try {
            await loadExtensionDetails(refreshExtensionDetailsButton.dataset.refreshExtensionDetails, refreshExtensionDetailsButton.dataset.extensionType);
        } catch (error) {
            state.errors.push({ key: 'extension-details-refresh', message: error.message });
            showToast('扩展状态刷新失败', error.message);
        }
        return;
    }

    const loadExtensionBranchesButton = event.target.closest('[data-load-extension-branches]');
    if (loadExtensionBranchesButton) {
        try {
            await loadExtensionDetails(loadExtensionBranchesButton.dataset.loadExtensionBranches, loadExtensionBranchesButton.dataset.extensionType, { branches: true });
        } catch (error) {
            state.errors.push({ key: 'extension-branches', message: error.message });
            showToast('扩展分支读取失败', error.message);
        }
        return;
    }

    if (event.target.closest('[data-switch-extension-branch]')) {
        try {
            await switchExtensionBranch();
        } catch (error) {
            state.errors.push({ key: 'extension-switch', message: error.message });
            showToast('扩展分支切换失败', error.message);
            state.extensionDetails.loading = false;
            render();
        }
        return;
    }

    const extensionActionButton = event.target.closest('[data-extension-action]');
    if (extensionActionButton) {
        beginExtensionOperation(extensionActionButton.dataset.extensionName, extensionActionButton.dataset.extensionType, extensionActionButton.dataset.extensionAction);
        return;
    }

    if (event.target.closest('[data-cancel-extension-operation]')) {
        cancelExtensionOperation();
        return;
    }

    if (event.target.closest('[data-confirm-extension-operation]')) {
        try {
            await confirmExtensionOperation();
        } catch (error) {
            state.errors.push({ key: 'extension-operation', message: error.message });
            showToast('扩展操作失败', error.message);
            cancelExtensionOperation();
        }
        return;
    }

    if (event.target.closest('[data-recreate-stats]')) {
        try {
            await recreateStats();
        } catch (error) {
            state.errors.push({ key: 'stats-recreate', message: error.message });
            showToast('统计重建失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-load-settings-snapshots]')) {
        try {
            await loadSettingsSnapshots({ force: true });
            render();
        } catch (error) {
            state.errors.push({ key: 'settings-snapshots', message: error.message });
            showToast('设置快照读取失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-create-settings-snapshot]')) {
        try {
            await createSettingsSnapshot();
        } catch (error) {
            state.errors.push({ key: 'settings-snapshot-create', message: error.message });
            showToast('设置快照创建失败', error.message);
            render();
        }
        return;
    }

    const previewSettingsSnapshotButton = event.target.closest('[data-preview-settings-snapshot]');
    if (previewSettingsSnapshotButton) {
        try {
            await previewSettingsSnapshot(previewSettingsSnapshotButton.dataset.previewSettingsSnapshot);
        } catch (error) {
            state.errors.push({ key: 'settings-snapshot-preview', message: error.message });
            showToast('设置快照预览失败', error.message);
            render();
        }
        return;
    }

    const restoreSettingsSnapshotButton = event.target.closest('[data-restore-settings-snapshot]');
    if (restoreSettingsSnapshotButton) {
        beginSettingsSnapshotRestore(restoreSettingsSnapshotButton.dataset.restoreSettingsSnapshot);
        return;
    }

    if (event.target.closest('[data-cancel-settings-restore]')) {
        cancelSettingsSnapshotRestore();
        return;
    }

    if (event.target.closest('[data-confirm-settings-restore]')) {
        try {
            await confirmSettingsSnapshotRestore();
        } catch (error) {
            state.errors.push({ key: 'settings-snapshot-restore', message: error.message });
            showToast('设置快照恢复失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-test-api]')) {
        try {
            await testApiConnection();
        } catch (error) {
            state.errors.push({ key: 'api-test', message: error.message });
            showToast('连接测试失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-save-api-connection]')) {
        try {
            await saveApiConnectionFromForm();
        } catch (error) {
            state.errors.push({ key: 'api-save', message: error.message });
            showToast('连接配置保存失败', error.message);
            render();
        }
        return;
    }

    if (event.target.closest('[data-save-openai-preset]')) {
        try {
            await saveOpenAiPresetFromForm();
        } catch (error) {
            state.errors.push({ key: 'preset-save', message: error.message });
            showToast('预设保存失败', error.message);
            render();
        }
        return;
    }

    const presetButton = event.target.closest('[data-use-openai-preset]');
    if (presetButton) {
        try {
            await useOpenAiPreset(presetButton.dataset.useOpenaiPreset);
        } catch (error) {
            state.errors.push({ key: 'preset', message: error.message });
            showToast('预设切换失败', error.message);
            render();
        }
        return;
    }

    const worldbookButton = event.target.closest('[data-select-worldbook]');
    if (worldbookButton) {
        state.selected.worldbook = worldbookButton.dataset.selectWorldbook;
        render();
        return;
    }

    if (event.target.closest('[data-create-worldbook]')) {
        beginWorldbookCreate();
        return;
    }

    if (event.target.closest('[data-cancel-worldbook-create]')) {
        cancelWorldbookCreate();
        return;
    }

    if (event.target.closest('[data-save-worldbook-create]')) {
        try {
            await saveWorldbookCreate();
        } catch (error) {
            state.errors.push({ key: 'worldbook-create', message: error.message });
            showToast('世界书创建失败', error.message);
            render();
        }
        return;
    }

    const loadWorldbookButton = event.target.closest('[data-load-worldbook]');
    if (loadWorldbookButton) {
        await loadWorldDetail(loadWorldbookButton.dataset.loadWorldbook);
        render();
        return;
    }

    const toggleWorldGlobalButton = event.target.closest('[data-toggle-world-global]');
    if (toggleWorldGlobalButton) {
        try {
            await toggleGlobalWorld(toggleWorldGlobalButton.dataset.toggleWorldGlobal);
        } catch (error) {
            state.errors.push({ key: 'worldbook', message: error.message });
            showToast('世界书切换失败', error.message);
            render();
        }
        return;
    }

    const deleteWorldbookButton = event.target.closest('[data-delete-worldbook]');
    if (deleteWorldbookButton) {
        beginWorldbookDelete(deleteWorldbookButton.dataset.deleteWorldbook);
        return;
    }

    if (event.target.closest('[data-cancel-worldbook-delete]')) {
        cancelWorldbookDelete();
        return;
    }

    if (event.target.closest('[data-confirm-worldbook-delete]')) {
        try {
            await confirmWorldbookDelete();
        } catch (error) {
            state.errors.push({ key: 'worldbook-delete', message: error.message });
            showToast('世界书删除失败', error.message);
            render();
        }
        return;
    }

    const createWorldEntryButton = event.target.closest('[data-create-world-entry]');
    if (createWorldEntryButton) {
        await beginWorldEntryCreate(createWorldEntryButton.dataset.createWorldEntry);
        return;
    }

    const toggleWorldEntryButton = event.target.closest('[data-toggle-world-entry]');
    if (toggleWorldEntryButton) {
        try {
            await toggleWorldEntry(toggleWorldEntryButton.dataset.toggleWorldEntry, toggleWorldEntryButton.dataset.worldEntryKey);
        } catch (error) {
            state.errors.push({ key: 'worldbook-entry', message: error.message });
            showToast('条目切换失败', error.message);
            render();
        }
        return;
    }

    const worldEntryPageButton = event.target.closest('[data-world-entry-page]');
    if (worldEntryPageButton) {
        setWorldEntryPage(worldEntryPageButton.dataset.worldEntryPage);
        return;
    }

    const bulkWorldEntryButton = event.target.closest('[data-bulk-world-entries]');
    if (bulkWorldEntryButton) {
        try {
            await setSelectedWorldEntriesDisabled(state.selected.worldbook, bulkWorldEntryButton.dataset.bulkWorldEntries === 'disable');
        } catch (error) {
            state.errors.push({ key: 'worldbook-entry-bulk', message: error.message });
            showToast('批量操作失败', error.message);
            render();
        }
        return;
    }

    const copyWorldEntryButton = event.target.closest('[data-copy-world-entry]');
    if (copyWorldEntryButton) {
        try {
            await duplicateWorldEntry(copyWorldEntryButton.dataset.copyWorldEntry, copyWorldEntryButton.dataset.worldEntryKey);
        } catch (error) {
            state.errors.push({ key: 'worldbook-entry-copy', message: error.message });
            showToast('条目复制失败', error.message);
            render();
        }
        return;
    }

    const deleteWorldEntryButton = event.target.closest('[data-delete-world-entry]');
    if (deleteWorldEntryButton) {
        beginWorldEntryDelete(deleteWorldEntryButton.dataset.deleteWorldEntry, deleteWorldEntryButton.dataset.worldEntryKey);
        return;
    }

    if (event.target.closest('[data-cancel-world-entry-delete]')) {
        cancelWorldEntryDelete();
        return;
    }

    if (event.target.closest('[data-confirm-world-entry-delete]')) {
        try {
            await confirmWorldEntryDelete();
        } catch (error) {
            state.errors.push({ key: 'worldbook-entry-delete', message: error.message });
            showToast('条目删除失败', error.message);
            render();
        }
        return;
    }

    const editWorldEntryButton = event.target.closest('[data-edit-world-entry]');
    if (editWorldEntryButton) {
        await beginWorldEntryEdit(editWorldEntryButton.dataset.editWorldEntry, editWorldEntryButton.dataset.worldEntryKey);
        return;
    }

    if (event.target.closest('[data-cancel-world-entry-edit]')) {
        cancelWorldEntryEdit();
        return;
    }

    if (event.target.closest('[data-save-world-entry-edit]')) {
        try {
            await saveWorldEntryEdit();
        } catch (error) {
            state.errors.push({ key: 'worldbook-entry-edit', message: error.message });
            showToast('条目保存失败', error.message);
            render();
        }
        return;
    }

    const commandButton = event.target.closest('[data-command-route]');
    if (commandButton) {
        const select = commandButton.dataset.commandSelect;
        const id = commandButton.dataset.commandId;
        if (select && id) {
            state.selected[select] = id;
        }
        closePalette();
        await setRoute(commandButton.dataset.commandRoute);
        return;
    }

    if (event.target.closest('[data-open-legacy]')) {
        openLegacy();
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
    render();
});
elements.content.addEventListener('input', event => {
    if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-chat-input]')) {
        setCurrentDraft(event.target.value);
    }
    if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-edit-message-input]')) {
        state.chatEditing.text = event.target.value;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-chat-rename-input]')) {
        state.chatRenaming.name = event.target.value;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-chat-search-input]')) {
        state.chatSearch.query = event.target.value;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-background-rename-input]')) {
        state.backgroundRenaming.name = event.target.value;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-asset-download-url]')) {
        state.assetDownload.url = event.target.value;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-asset-download-filename]')) {
        state.assetDownload.filename = event.target.value;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-character-rename-input]')) {
        state.characterRenaming.name = event.target.value;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-openai-preset-name]')) {
        state.openAiPresetDraft.name = event.target.value;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-extension-install-url]')) {
        state.extensionInstall.url = event.target.value;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-extension-install-branch]')) {
        state.extensionInstall.branch = event.target.value;
    }
    if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) && event.target.matches('[data-extension-branch]')) {
        state.extensionDetails.branch = event.target.value;
    }
    if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) && event.target.matches('[data-persona-field]')) {
        updatePersonaFormField(event.target);
    }
    if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) && event.target.matches('[data-character-field]')) {
        updateCharacterFormField(event.target);
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-worldbook-create-name]')) {
        state.worldbookCreating.name = event.target.value;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-world-entry-search]')) {
        updateWorldEntryListField('query', event.target.value);
    }
    if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) && event.target.matches('[data-world-entry-field]')) {
        updateWorldEntryFormField(event.target);
    }
});
elements.content.addEventListener('change', async event => {
    if (event.target instanceof HTMLSelectElement && event.target.matches('[data-api-source]')) {
        updateApiSourceFields(event.target.value);
        return;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-background-select]')) {
        toggleBackgroundSelection(event.target.dataset.backgroundSelect, event.target.checked);
        return;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-extension-install-global]')) {
        state.extensionInstall.global = event.target.checked;
        return;
    }
    if (event.target instanceof HTMLSelectElement && event.target.matches('[data-asset-download-category]')) {
        state.assetDownload.category = event.target.value;
        return;
    }
    if (event.target instanceof HTMLSelectElement && event.target.matches('[data-extension-branch]')) {
        state.extensionDetails.branch = event.target.value;
        render();
        return;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-persona-create-file]')) {
        state.personaCreating.file = event.target.files?.[0] || null;
        render();
        return;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-persona-avatar-file]')) {
        try {
            await replacePersonaAvatar(event.target.dataset.personaAvatarFile, event.target.files?.[0]);
        } catch (error) {
            state.errors.push({ key: 'persona-avatar', message: error.message });
            showToast('头像替换失败', error.message);
            render();
        } finally {
            event.target.value = '';
        }
        return;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-character-import-file]')) {
        try {
            await importCharacterFile(event.target.files?.[0]);
        } catch (error) {
            state.errors.push({ key: 'character-import', message: error.message });
            showToast('角色导入失败', error.message);
            render();
        } finally {
            event.target.value = '';
        }
        return;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-chat-import-file]')) {
        try {
            await importModernChatFiles(event.target.files);
        } catch (error) {
            state.errors.push({ key: 'chat-import', message: error.message });
            showToast('聊天导入失败', error.message);
            render();
        } finally {
            event.target.value = '';
        }
        return;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-background-upload-file]')) {
        try {
            await uploadBackgroundFile(event.target.files?.[0]);
        } catch (error) {
            state.errors.push({ key: 'background-upload', message: error.message });
            showToast('背景上传失败', error.message);
            render();
        } finally {
            event.target.value = '';
        }
        return;
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-character-delete-chats]')) {
        state.characterDeleteConfirm.deleteChats = event.target.checked;
    }
    if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) && event.target.matches('[data-character-field]')) {
        updateCharacterFormField(event.target);
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-world-entry-select]')) {
        toggleWorldEntrySelection(event.target.dataset.worldEntrySelect, event.target.checked);
        return;
    }
    if (event.target instanceof HTMLSelectElement && event.target.matches('[data-world-entry-sort]')) {
        updateWorldEntryListField('sort', event.target.value);
        return;
    }
    if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) && event.target.matches('[data-world-entry-field]')) {
        updateWorldEntryFormField(event.target);
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
    if (event.target instanceof HTMLElement && event.target.matches('[data-chat-input]') && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        sendModernMessage().catch(error => {
            state.errors.push({ key: 'modern-send', message: error.message });
            showToast('发送失败', error.message);
            render();
        });
        return;
    }

    if (event.target instanceof HTMLElement && event.target.matches('[data-chat-search-input]') && event.key === 'Enter') {
        event.preventDefault();
        if (!state.chatSearch.query.trim()) {
            clearChatSearch();
            render();
            return;
        }
        searchSelectedChats().then(() => render()).catch(error => {
            state.errors.push({ key: 'chat-search', message: error.message });
            showToast('聊天搜索失败', error.message);
            render();
        });
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
loadData();
