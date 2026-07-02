const routes = [
    { id: 'dashboard', label: '总览', icon: 'fa-gauge-high' },
    { id: 'chat', label: '聊天', icon: 'fa-comments' },
    { id: 'characters', label: '角色', icon: 'fa-address-card' },
    { id: 'worldbooks', label: '世界书', icon: 'fa-book-open' },
    { id: 'presets', label: '预设', icon: 'fa-sliders' },
    { id: 'personas', label: '用户人设', icon: 'fa-user-gear' },
    { id: 'assets', label: '素材', icon: 'fa-folder-tree' },
    { id: 'api', label: 'API', icon: 'fa-plug' },
    { id: 'extensions', label: '扩展', icon: 'fa-cubes' },
    { id: 'activity', label: '活动', icon: 'fa-chart-line' },
    { id: 'settings', label: '设置', icon: 'fa-gear' },
];

const routeLabels = Object.fromEntries(routes.map(route => [route.id, route.label]));
const initialRoute = new URLSearchParams(window.location.search).get('view') || 'dashboard';
const chatCompletionModelFields = {
    openai: 'openai_model',
    claude: 'claude_model',
    openrouter: 'openrouter_model',
    ai21: 'ai21_model',
    makersuite: 'google_model',
    vertexai: 'vertexai_model',
    mistralai: 'mistralai_model',
    custom: 'custom_model',
    cohere: 'cohere_model',
    perplexity: 'perplexity_model',
    groq: 'groq_model',
    chutes: 'chutes_model',
    electronhub: 'electronhub_model',
    nanogpt: 'nanogpt_model',
    deepseek: 'deepseek_model',
    aimlapi: 'aimlapi_model',
    xai: 'xai_model',
    pollinations: 'pollinations_model',
    moonshot: 'moonshot_model',
    fireworks: 'fireworks_model',
    cometapi: 'cometapi_model',
    azure_openai: 'azure_openai_model',
    zai: 'zai_model',
    siliconflow: 'siliconflow_model',
    workers_ai: 'workers_ai_model',
    minimax: 'minimax_model',
};
const worldEntryDefaults = {
    key: [],
    keysecondary: [],
    comment: '',
    content: '',
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: 0,
    addMemo: false,
    order: 100,
    position: 0,
    disable: false,
    ignoreBudget: false,
    excludeRecursion: false,
    preventRecursion: false,
    probability: 100,
    useProbability: true,
    depth: 4,
    role: 0,
};
const worldEntryPositions = [
    { value: 0, label: '角色前' },
    { value: 1, label: '角色后' },
    { value: 2, label: '作者注释顶部' },
    { value: 3, label: '作者注释底部' },
    { value: 4, label: '按深度插入' },
    { value: 5, label: '示例消息顶部' },
    { value: 6, label: '示例消息底部' },
];

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
    worldDetails: {},
    backgrounds: [],
    assets: {},
    extensions: [],
    secrets: {},
    stats: {},
    chatLists: {},
    chatMessages: {},
    chatMetadata: {},
    loadingChats: {},
    chatDrafts: {},
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
    worldbookCreating: {
        active: false,
        name: '',
    },
    worldbookDeleteConfirm: {
        worldbookId: '',
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
    apiTest: {
        running: false,
        status: '未测试',
        detail: '尚未从现代界面发起连接测试。',
    },
    selected: {
        character: '',
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
let generationAbortController = null;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatNumber(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat('zh-CN').format(number);
}

function formatBytes(value) {
    const number = Number(value || 0);
    if (!number) {
        return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(number) / Math.log(1024)), units.length - 1);
    return `${(number / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value) {
    if (!value) {
        return '未知';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '未知';
    }

    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function stripJsonlExtension(value) {
    return String(value || '').replace(/\.jsonl$/i, '');
}

function getAvatarUrl(character) {
    if (!character?.avatar) {
        return '';
    }

    return `/characters/${encodeURIComponent(character.avatar)}`;
}

function getPersonaUrl(avatarId) {
    return `/User%20Avatars/${encodeURIComponent(avatarId)}`;
}

function normalizeText(value) {
    return String(value ?? '').toLowerCase();
}

function matchesQuery(...values) {
    if (!state.query) {
        return true;
    }

    return values.some(value => normalizeText(value).includes(state.query));
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
    if (!state.selected.worldbook && state.worldbooks[0]) {
        state.selected.worldbook = state.worldbooks[0].file_id;
    }
    if (state.route === 'chat') {
        await prepareChatForSelectedCharacter();
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

function getSelectedCharacter() {
    return state.characters.find(character => character.avatar === state.selected.character) || state.characters[0] || null;
}

function getSelectedChatList() {
    return state.chatLists[state.selected.character] || [];
}

function getSelectedChatMessages() {
    const cacheKey = getChatCacheKey(state.selected.character, state.selected.chat);
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

async function loadChatMessages(character, chatId) {
    if (!character?.avatar || !chatId) {
        return [];
    }

    const cacheKey = getChatCacheKey(character.avatar, chatId);
    if (state.chatMessages[cacheKey]) {
        return state.chatMessages[cacheKey];
    }

    try {
        const result = await apiFetch('/api/chats/get', {
            body: {
                ch_name: character.name || character.data?.name || '',
                file_name: chatId,
                avatar_url: character.avatar,
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

async function prepareChatForSelectedCharacter() {
    const character = getSelectedCharacter();
    const chats = await loadCharacterChats(character);

    if (!state.selected.chat && chats[0]?.file_id) {
        state.selected.chat = chats[0].file_id;
    }

    await loadChatMessages(character, state.selected.chat);
}

function getCurrentDraftKey() {
    return getChatCacheKey(state.selected.character, state.selected.chat);
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

function createUserMessage(text) {
    return {
        name: getUserName(),
        is_user: true,
        is_system: false,
        send_date: getMessageTimestamp(),
        mes: text,
        extra: { api: 'modern' },
    };
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

function getSelectedChatMetadata(character, chatId) {
    return state.chatMetadata[getChatCacheKey(character?.avatar, chatId)] || {};
}

async function saveModernChat(character, chatId, messages) {
    if (!character?.avatar || !chatId) {
        throw new Error('缺少角色或聊天文件');
    }

    const metadata = getSelectedChatMetadata(character, chatId);
    const result = await apiFetch('/api/chats/save', {
        body: {
            ch_name: getCharacterName(character),
            file_name: chatId,
            avatar_url: character.avatar,
            chat: [
                { chat_metadata: metadata, user_name: 'unused', character_name: 'unused' },
                ...messages,
            ],
        },
    });

    if (result?.error) {
        throw new Error(result.error === 'integrity' ? '聊天文件已被其他会话修改，请刷新后重试。' : String(result.error));
    }

    state.chatMessages[getChatCacheKey(character.avatar, chatId)] = messages;
}

function beginModernChatRename() {
    const character = getSelectedCharacter();
    if (!character?.avatar || !state.selected.chat) {
        showToast('重命名失败', '请先选择一个聊天文件。');
        return;
    }

    const selectedChat = getSelectedChatList().find(chat => chat.file_id === state.selected.chat);
    state.chatRenaming = {
        key: getChatCacheKey(character.avatar, state.selected.chat),
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
    const character = getSelectedCharacter();
    const oldChatId = stripJsonlExtension(state.selected.chat);
    const newChatId = stripJsonlExtension(state.chatRenaming.name.trim());
    const renameKey = getChatCacheKey(character?.avatar, state.selected.chat);
    if (!character?.avatar || !oldChatId || !newChatId || state.chatRenaming.key !== renameKey) {
        throw new Error('重命名目标已变化，请重新选择聊天。');
    }
    if (oldChatId === newChatId) {
        cancelModernChatRename();
        return;
    }

    const result = await apiFetch('/api/chats/rename', {
        body: {
            avatar_url: character.avatar,
            original_file: `${oldChatId}.jsonl`,
            renamed_file: `${newChatId}.jsonl`,
            is_group: false,
        },
    });
    if (result?.error) {
        throw new Error('聊天文件重命名失败，可能存在同名文件。');
    }

    const renamedChatId = stripJsonlExtension(result?.sanitizedFileName || newChatId);
    const oldKey = getChatCacheKey(character.avatar, oldChatId);
    const newKey = getChatCacheKey(character.avatar, renamedChatId);
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
    await refreshSelectedChatList(character);
    await loadChatMessages(character, renamedChatId);
    showToast('聊天已重命名', `${oldChatId} → ${renamedChatId}`);
    render();
}

function beginModernChatDelete() {
    if (state.engine.generating) {
        showToast('删除失败', '生成中不能删除聊天文件。');
        return;
    }

    const character = getSelectedCharacter();
    const chatId = stripJsonlExtension(state.selected.chat);
    if (!character?.avatar || !chatId) {
        showToast('删除失败', '请先选择一个聊天文件。');
        return;
    }

    state.chatDeleteConfirm = {
        key: getChatCacheKey(character.avatar, state.selected.chat),
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
    const character = getSelectedCharacter();
    const chatId = stripJsonlExtension(state.chatDeleteConfirm.name);
    const deleteKey = getChatCacheKey(character?.avatar, state.selected.chat);
    if (!character?.avatar || !chatId || state.chatDeleteConfirm.key !== deleteKey) {
        throw new Error('删除目标已变化，请重新选择聊天。');
    }

    const result = await apiFetch('/api/chats/delete', {
        body: {
            avatar_url: character.avatar,
            chatfile: `${chatId}.jsonl`,
        },
    });
    if (result?.error) {
        throw new Error('聊天文件删除失败。');
    }

    const cacheKey = getChatCacheKey(character.avatar, chatId);
    delete state.chatMessages[cacheKey];
    delete state.chatMetadata[cacheKey];
    delete state.chatDrafts[cacheKey];
    state.chatRenaming = { key: '', name: '' };
    state.chatDeleteConfirm = { key: '', name: '' };
    state.selected.chat = '';
    await refreshSelectedChatList(character);
    const chats = getSelectedChatList();
    state.selected.chat = chats[0]?.file_id || '';
    if (state.selected.chat) {
        await loadChatMessages(character, state.selected.chat);
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
    const source = oaiSettings.chat_completion_source || state.settings.chat_completion_source || '';
    const modelField = chatCompletionModelFields[source];
    const modelInput = elements.content.querySelector('[data-api-model]');
    const endpointInput = elements.content.querySelector('[data-api-endpoint]');
    const model = modelInput?.value.trim() || '';
    const endpoint = endpointInput?.value || '';

    if (!modelField || !model) {
        throw new Error('当前连接暂不支持在现代页保存，或模型为空。');
    }

    state.settings.oai_settings = oaiSettings;
    oaiSettings[modelField] = model;
    if (source === 'siliconflow') {
        oaiSettings.siliconflow_endpoint = endpoint === 'global' ? 'global' : 'cn';
    }

    await apiFetch('/api/settings/save', { body: state.settings });
    await loadData({ silent: true });
    showToast('连接配置已保存', `${source} / ${model}`);
}

function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))];
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

function getActiveWorldNames(character, chatId) {
    const globalWorlds = getGlobalWorldNames();
    const characterWorld = character?.data?.extensions?.world || '';
    const chatWorld = getSelectedChatMetadata(character, chatId)?.world_info || '';
    return uniqueValues([...globalWorlds, characterWorld, chatWorld]);
}

function getWorldEntries(worldName, detail) {
    const entries = detail?.entries || {};
    return Object.values(entries).map(entry => ({
        ...entry,
        world: worldName,
    }));
}

function entryKeywordMatches(entry, text) {
    if (entry.constant) {
        return true;
    }
    if (!Array.isArray(entry.key) || entry.key.length === 0) {
        return false;
    }

    const caseSensitive = entry.caseSensitive ?? state.settings.world_info_settings?.world_info_case_sensitive;
    const sourceText = caseSensitive ? text : text.toLowerCase();
    return entry.key.some(keyword => {
        const value = String(keyword || '').trim();
        if (!value) {
            return false;
        }
        const needle = caseSensitive ? value : value.toLowerCase();
        return sourceText.includes(needle);
    });
}

function getWorldSearchText(character, messages) {
    return [
        getCharacterName(character),
        character?.data?.scenario || '',
        ...messages.slice(-8).map(message => message?.mes || ''),
    ].join('\n');
}

async function getModernWorldContext(character, messages) {
    const worldNames = getActiveWorldNames(character, state.selected.chat);
    if (!worldNames.length) {
        return '';
    }

    const searchText = getWorldSearchText(character, messages);
    const allEntries = [];
    for (const worldName of worldNames) {
        await loadWorldDetail(worldName);
        allEntries.push(...getWorldEntries(worldName, state.worldDetails[worldName]));
    }

    const matchedEntries = allEntries
        .filter(entry => !entry.disable && entry.content && entryKeywordMatches(entry, searchText))
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
        .slice(0, 8);

    return matchedEntries.map(entry => {
        const label = entry.comment || entry.key?.join(', ') || entry.world;
        return `[${entry.world}${label ? ` / ${label}` : ''}]\n${formatTemplate(entry.content, character)}`;
    }).join('\n\n');
}

function getPresetSystemPrompt(character) {
    const prompts = getOaiSettings().prompts || [];
    const mainPrompt = prompts.find(prompt => prompt.identifier === 'main' && prompt.content)?.content;
    return formatTemplate(mainPrompt || state.settings.power_user?.sysprompt?.content || `Write ${getCharacterName(character)}'s next reply in a fictional chat between ${getCharacterName(character)} and ${getUserName()}.`, character);
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

function buildModernSystemPrompt(character, worldContext = '') {
    const lines = [
        getPresetSystemPrompt(character),
        character?.data?.description ? `角色描述：${formatTemplate(character.data.description, character)}` : '',
        character?.data?.personality ? `性格：${formatTemplate(character.data.personality, character)}` : '',
        character?.data?.scenario ? `场景：${formatTemplate(character.data.scenario, character)}` : '',
        character?.data?.creator_notes ? `创作者备注：${formatTemplate(character.data.creator_notes, character)}` : '',
        worldContext ? `世界书：\n${worldContext}` : '',
    ];
    return lines.filter(Boolean).join('\n\n');
}

async function buildModernPromptMessages(character, messages) {
    const worldContext = await getModernWorldContext(character, messages);
    const promptMessages = [
        { role: 'system', content: buildModernSystemPrompt(character, worldContext) },
    ];

    messages
        .filter(message => message?.mes)
        .slice(-40)
        .forEach(message => {
            promptMessages.push({
                role: message.is_system ? 'system' : (message.is_user ? 'user' : 'assistant'),
                content: formatTemplate(message.mes, character),
            });
        });

    return promptMessages.filter(message => message.content);
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

async function generateModernReply(character, messages, signal) {
    const settings = getChatCompletionSettings();
    const promptMessages = await buildModernPromptMessages(character, messages);
    const response = await apiFetch('/api/backends/chat-completions/generate', {
        body: createChatCompletionRequestBody(settings, promptMessages),
        signal,
    });
    return {
        text: extractAssistantText(response),
        model: settings.model,
    };
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

async function refreshSelectedChatList(character) {
    delete state.chatLists[character.avatar];
    await loadCharacterChats(character);
}

async function startNewModernChat() {
    const character = getSelectedCharacter();
    if (!character?.avatar) {
        throw new Error('请先选择角色');
    }

    const chatId = createModernChatId();
    const greeting = getCharacterGreeting(character);
    const messages = greeting ? [createAssistantMessage(greeting, character)] : [];
    state.selected.chat = chatId;
    state.chatMetadata[getChatCacheKey(character.avatar, chatId)] = {};
    state.chatMessages[getChatCacheKey(character.avatar, chatId)] = messages;
    await saveModernChat(character, chatId, messages);
    await refreshSelectedChatList(character);
    showToast('新聊天已创建', `${getCharacterName(character)} 的新会话已选中。`);
    render();
}

async function sendModernMessage() {
    const draftKey = getCurrentDraftKey();
    const draft = (state.chatDrafts[draftKey] || '').trim();
    if (!draft || state.engine.generating) {
        return;
    }

    const character = getSelectedCharacter();
    if (!character?.avatar) {
        throw new Error('请先选择角色');
    }

    let chatId = state.selected.chat;
    let messages = chatId ? [...getSelectedChatMessages()] : [];
    if (!chatId) {
        chatId = createModernChatId();
        state.selected.chat = chatId;
        state.chatMetadata[getChatCacheKey(character.avatar, chatId)] = {};
        const greeting = getCharacterGreeting(character);
        messages = greeting ? [createAssistantMessage(greeting, character)] : [];
    }

    messages.push(createUserMessage(draft));
    state.chatMessages[getChatCacheKey(character.avatar, chatId)] = messages;
    state.chatDrafts[draftKey] = '';

    await saveModernChat(character, chatId, messages);
    await generateAndSaveModernReply(character, chatId, messages, '消息已生成', '回复已保存到当前聊天文件。');
}

async function generateAndSaveModernReply(character, chatId, messages, toastTitle, toastMessage) {
    if (state.engine.generating) {
        return;
    }

    state.engine.generating = true;
    state.engine.status = '生成中';
    state.engine.error = '';
    render();

    generationAbortController = new AbortController();

    try {
        const reply = await generateModernReply(character, messages, generationAbortController.signal);
        const savedMessages = [...messages, createAssistantMessage(reply.text, character, reply.model)];
        await saveModernChat(character, chatId, savedMessages);
        await refreshSelectedChatList(character);
        state.engine.status = '就绪';
        showToast(toastTitle, toastMessage);
    } catch (error) {
        if (error.name === 'AbortError') {
            state.engine.status = '已停止';
            showToast('已停止生成', '聊天文件未追加模型回复。');
        } else {
            state.engine.error = error.message;
            state.engine.status = '生成失败';
            throw error;
        }
    } finally {
        generationAbortController = null;
        state.engine.generating = false;
        render();
    }
}

async function regenerateModernReply() {
    if (state.engine.generating) {
        return;
    }

    const character = getSelectedCharacter();
    if (!character?.avatar || !state.selected.chat) {
        throw new Error('请先选择一个聊天文件');
    }

    const messages = getSelectedChatMessages();
    if (!messages.length) {
        throw new Error('当前聊天没有可重生成的上下文');
    }

    const lastMessage = messages[messages.length - 1];
    const replacesAssistant = lastMessage && !lastMessage.is_user && !lastMessage.is_system;
    const promptMessages = replacesAssistant ? messages.slice(0, -1) : [...messages];
    const toastMessage = replacesAssistant ? '最后一条助手回复已替换。' : '已为最后一条用户消息追加新回复。';
    await generateAndSaveModernReply(character, state.selected.chat, promptMessages, '回复已重生成', toastMessage);
}

async function continueModernReply() {
    if (state.engine.generating) {
        return;
    }

    const character = getSelectedCharacter();
    if (!character?.avatar || !state.selected.chat) {
        throw new Error('请先选择一个聊天文件');
    }

    const messages = getSelectedChatMessages();
    if (!messages.length) {
        throw new Error('当前聊天没有可继续生成的上下文');
    }

    await generateAndSaveModernReply(character, state.selected.chat, [...messages], '已继续生成', '新回复已追加到当前聊天。');
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

    const character = getSelectedCharacter();
    if (!character?.avatar || !state.selected.chat) {
        throw new Error('请先选择一个聊天文件');
    }

    const index = Number(messageIndex);
    const messages = [...getSelectedChatMessages()];
    if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
        throw new Error('消息位置无效，请刷新后重试。');
    }

    const [deletedMessage] = messages.splice(index, 1);
    await saveModernChat(character, state.selected.chat, messages);
    await refreshSelectedChatList(character);
    showToast('消息已删除', deletedMessage?.name || '当前聊天');
    render();
}

function beginModernMessageEdit(messageIndex) {
    if (state.engine.generating) {
        showToast('暂不能编辑', '生成中不能编辑消息。');
        return;
    }

    const character = getSelectedCharacter();
    const index = Number(messageIndex);
    const messages = getSelectedChatMessages();
    if (!character?.avatar || !state.selected.chat || !Number.isInteger(index) || index < 0 || index >= messages.length) {
        showToast('编辑失败', '消息位置无效，请刷新后重试。');
        return;
    }

    const message = messages[index];
    state.chatEditing = {
        key: getChatCacheKey(character.avatar, state.selected.chat),
        index,
        text: message.extra?.display_text || message.mes || '',
    };
    render();
}

function cancelModernMessageEdit() {
    state.chatEditing = { key: '', index: -1, text: '' };
    render();
}

async function saveModernMessageEdit() {
    if (state.engine.generating) {
        throw new Error('生成中不能保存编辑。');
    }

    const character = getSelectedCharacter();
    const editKey = getChatCacheKey(character?.avatar, state.selected.chat);
    const edit = state.chatEditing;
    const text = edit.text.trim();
    const messages = [...getSelectedChatMessages()];
    if (!character?.avatar || !state.selected.chat || edit.key !== editKey || edit.index < 0 || edit.index >= messages.length) {
        throw new Error('编辑目标已变化，请重新选择消息。');
    }
    if (!text) {
        throw new Error('消息内容不能为空。');
    }

    const nextMessage = {
        ...messages[edit.index],
        mes: text,
    };
    if (nextMessage.extra?.display_text !== undefined) {
        nextMessage.extra = { ...nextMessage.extra, display_text: text };
    }
    messages[edit.index] = nextMessage;

    await saveModernChat(character, state.selected.chat, messages);
    await refreshSelectedChatList(character);
    state.chatEditing = { key: '', index: -1, text: '' };
    showToast('消息已保存', nextMessage.name || '当前聊天');
    render();
}

function stopModernGeneration() {
    generationAbortController?.abort();
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
        await prepareChatForSelectedCharacter();
        render();
    }
}

function setTheme(theme) {
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('st-modern-theme', theme);
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
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-arrow-up-right-from-square"></i>
                打开原版
            </button>
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

function renderChat() {
    const characters = state.characters.filter(character => matchesQuery(character.name, character.avatar, character.data?.creator));
    const selected = getSelectedCharacter() || characters[0];
    if (selected && state.selected.character !== selected.avatar) {
        state.selected.character = selected.avatar;
    }
    const chats = getSelectedChatList();
    const isLoadingChats = !!state.loadingChats[state.selected.character];

    return `
        ${pageHead('聊天工作区', '角色、会话文件和消息预览。', `
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-arrow-up-right-from-square"></i>
                打开聊天
            </button>
        `)}
        <div class="chat-layout">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">角色</h2>
                        <p class="panel-subtitle">${formatNumber(characters.length)} 个匹配项</p>
                    </div>
                </div>
                <div class="resource-list">
                    ${characters.map(character => renderCharacterRow(character)).join('') || renderInlineEmpty('暂无匹配角色')}
                </div>
            </section>
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">聊天文件</h2>
                        <p class="panel-subtitle">${isLoadingChats ? '读取中' : `${formatNumber(chats.length)} 个会话`}</p>
                    </div>
                    <button class="icon-button" type="button" data-new-chat title="新聊天" ${selected ? '' : 'disabled'}>
                        <i class="fa-solid fa-plus"></i>
                    </button>
                </div>
                <div class="resource-list">
                    ${chats.map(chat => renderChatFileRow(chat)).join('') || renderInlineEmpty(selected ? '这个角色暂无聊天文件' : '先选择一个角色')}
                </div>
            </section>
            <section class="panel chat-thread">
                ${selected ? renderChatThread(selected) : renderEmptyState('fa-address-card', '没有可用角色', '当前目录没有可用角色卡。')}
            </section>
        </div>
    `;
}

function renderChatFileRow(chat) {
    const chatId = chat.file_id || String(chat.file_name || '').replace('.jsonl', '');
    const messageCount = Number(chat.chat_items || 0);
    const subtitle = [
        `${formatNumber(messageCount)} 条消息`,
        chat.file_size || '',
        formatDate(chat.last_mes),
    ].filter(Boolean).join(' · ');

    return `
        <button class="resource-row ${state.selected.chat === chatId ? 'active' : ''}" type="button" data-select-chat="${escapeHtml(chatId)}">
            <span class="avatar-fallback"><i class="fa-solid fa-message"></i></span>
            <span class="row-main">
                <span class="row-title">${escapeHtml(chat.file_name || chatId)}</span>
                <span class="row-subtitle">${escapeHtml(subtitle)}</span>
            </span>
        </button>
    `;
}

function renderChatThread(character) {
    const avatar = getAvatarUrl(character);
    const name = character.name || character.data?.name || '未命名角色';
    const chats = getSelectedChatList();
    const selectedChat = chats.find(chat => chat.file_id === state.selected.chat);
    const messages = getSelectedChatMessages();
    const isRenaming = state.chatRenaming.key === getChatCacheKey(character.avatar, state.selected.chat);
    const isDeleting = state.chatDeleteConfirm.key === getChatCacheKey(character.avatar, state.selected.chat);

    return `
        <div class="detail-hero">
            ${avatar ? `<img class="avatar large" src="${avatar}" alt="">` : '<span class="avatar-fallback large">C</span>'}
            <div>
                <h2 class="detail-title">${escapeHtml(name)}</h2>
                <p class="panel-subtitle">${escapeHtml(selectedChat?.file_name || character.data?.creator || character.avatar || '角色卡')}</p>
                <div class="tag-row detail-tags">
                    <span class="tag">${formatNumber(messages.length)} 条消息</span>
                    <span class="tag">${escapeHtml(selectedChat?.file_size || '0 B')}</span>
                    <span class="tag">${escapeHtml(formatDate(selectedChat?.last_mes))}</span>
                    <span class="tag">${escapeHtml(state.engine.status)}</span>
                </div>
            </div>
            ${selectedChat ? `
                <div class="page-actions detail-actions">
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

function renderMessageList(messages) {
    const startIndex = Math.max(messages.length - 80, 0);

    return `
        <div class="message-list">
            ${messages.slice(-80).map((message, index) => renderMessage(message, startIndex + index)).join('')}
        </div>
    `;
}

function renderMessage(message, messageIndex) {
    const name = message.name || (message.is_user ? 'You' : 'Character');
    const text = message.extra?.display_text || message.mes || '[空消息]';
    const model = message.extra?.model || message.extra?.api || '';
    const isEditing = state.chatEditing.key === getCurrentDraftKey() && state.chatEditing.index === messageIndex;

    return `
        <article class="message ${message.is_user ? 'user' : ''}">
            <header class="message-meta">
                <strong>${escapeHtml(name)}</strong>
                <span class="message-actions">
                    <span>${escapeHtml(formatDate(message.send_date))}</span>
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
            ` : `<div>${escapeHtml(text)}</div>`}
            ${model ? `<footer class="message-foot">${escapeHtml(model)}</footer>` : ''}
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
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-upload"></i>
                导入/编辑
            </button>
        `)}
        <div class="split-grid">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">角色列表</h2>
                        <p class="panel-subtitle">${formatNumber(characters.length)} 个匹配项</p>
                    </div>
                </div>
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
    const avatar = getAvatarUrl(character);
    const name = character.name || character.data?.name || '未命名角色';
    const tags = character.tags || character.data?.tags || [];

    return `
        <div class="detail-hero">
            ${avatar ? `<img class="avatar large" src="${avatar}" alt="">` : '<span class="avatar-fallback large">C</span>'}
            <div>
                <h2 class="detail-title">${escapeHtml(name)}</h2>
                <p class="panel-subtitle">${escapeHtml(character.avatar || '角色卡')}</p>
                <div class="tag-row detail-tags">
                    ${tags.slice(0, 8).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('') || '<span class="tag">未打标签</span>'}
                </div>
            </div>
        </div>
        <div class="table-wrap">
            <table>
                <tbody>
                    <tr><th>创建时间</th><td>${escapeHtml(formatDate(character.create_date || character.date_added))}</td></tr>
                    <tr><th>最近聊天</th><td>${escapeHtml(formatDate(character.date_last_chat))}</td></tr>
                    <tr><th>聊天占用</th><td>${escapeHtml(formatBytes(character.chat_size))}</td></tr>
                    <tr><th>卡片大小</th><td>${escapeHtml(formatBytes(character.data_size))}</td></tr>
                    <tr><th>作者</th><td>${escapeHtml(character.data?.creator || '未知')}</td></tr>
                    <tr><th>关联世界书</th><td>${escapeHtml(character.data?.extensions?.world || '未关联')}</td></tr>
                </tbody>
            </table>
        </div>
        <p class="detail-text">${escapeHtml(character.description || character.data?.creator_notes || '当前列表接口未返回完整角色描述。')}</p>
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
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-pen-to-square"></i>
                打开编辑器
            </button>
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
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr><th>键</th><th>注释</th><th>状态</th><th>操作</th></tr>
                    </thead>
                    <tbody>
                        ${entries.slice(0, 30).map(([entryKey, entry]) => renderWorldEntryRow(worldbook, entryKey, entry)).join('') || '<tr><td colspan="4">没有条目</td></tr>'}
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

    return `
        <tr>
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
            <td colspan="4">
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
            <td colspan="4">${formContent}</td>
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
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-pen-to-square"></i>
                打开编辑器
            </button>
        `)}
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
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-user-pen"></i>
                打开管理
            </button>
        `)}
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
                </article>
            `).join('') || renderEmptyState('fa-user-gear', '暂无用户人设', '当前目录没有用户人设。')}
        </div>
    `;
}

function renderAssets() {
    const groups = getAssetGroups().filter(group => matchesQuery(group.name));
    const backgrounds = state.backgrounds?.images || [];

    return `
        ${pageHead('素材库', '背景、音频、Live2D、VRM 和资产文件。', `
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-folder-open"></i>
                打开素材
            </button>
        `)}
        <div class="metrics-grid">
            ${metricCard('背景', formatNumber(backgrounds.length), '背景图片', 'fa-image')}
            ${metricCard('资产文件', formatNumber(getAssetCount()), 'assets 目录', 'fa-folder-tree')}
            ${metricCard('素材分类', formatNumber(groups.length), '有效分类', 'fa-layer-group')}
            ${metricCard('动画背景', formatNumber(backgrounds.filter(item => item.isAnimated).length), 'metadata 标记', 'fa-film')}
        </div>
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
                    <div class="tag-row">
                        ${renderAssetPreviewTags(group.detail)}
                    </div>
                </article>
            `).join('') || renderEmptyState('fa-folder-tree', '暂无素材', '当前资产目录还没有可显示文件。')}
        </div>
    `;
}

function renderAssetPreviewTags(detail) {
    if (Array.isArray(detail)) {
        return detail.slice(0, 8).map(item => `<span class="tag">${escapeHtml(String(item).split('/').pop())}</span>`).join('') || '<span class="tag">空</span>';
    }

    if (detail && typeof detail === 'object') {
        return Object.entries(detail).map(([key, value]) => `<span class="tag">${escapeHtml(key)} ${Array.isArray(value) ? value.length : 0}</span>`).join('');
    }

    return '<span class="tag">空</span>';
}

function renderApi() {
    const provider = getProviderInfo();
    const profiles = getApiProfiles();
    const checks = getApiChecks(provider, profiles);

    return `
        ${pageHead('API 连接管理', '连接、模型、预设和请求状态。', `
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-key"></i>
                打开连接配置
            </button>
            <button class="primary-button" type="button" data-test-api ${state.apiTest.running ? 'disabled' : ''}>
                <i class="fa-solid ${state.apiTest.running ? 'fa-circle-notch fa-spin' : 'fa-plug-circle-check'}"></i>
                ${state.apiTest.running ? '测试中' : '测试连接'}
            </button>
            <button class="secondary-button" type="button" data-refresh>
                <i class="fa-solid fa-rotate"></i>
                刷新
            </button>
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
    if (provider.api !== 'openai' || provider.chatSource !== 'siliconflow') {
        return `
            <div class="settings-form">
                <div class="muted">当前连接暂不在现代页编辑，仍可使用原版连接配置。</div>
            </div>
        `;
    }

    const settings = state.settings.oai_settings || {};
    const endpoint = settings.siliconflow_endpoint === 'global' ? 'global' : 'cn';

    return `
        <div class="settings-form">
            <label class="field-label">
                <span>SiliconFlow 模型</span>
                <input class="text-input" type="text" data-api-model value="${escapeHtml(provider.model)}" autocomplete="off">
            </label>
            <label class="field-label">
                <span>端点</span>
                <select class="select-input" data-api-endpoint>
                    <option value="cn" ${endpoint === 'cn' ? 'selected' : ''}>China (api.siliconflow.cn)</option>
                    <option value="global" ${endpoint === 'global' ? 'selected' : ''}>Global (api.siliconflow.com)</option>
                </select>
            </label>
            <button class="secondary-button" type="button" data-save-api-connection>
                <i class="fa-solid fa-floppy-disk"></i>
                保存连接字段
            </button>
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

function renderExtensions() {
    const extensions = state.extensions.filter(extension => matchesQuery(extension.name, extension.type));

    return `
        ${pageHead('扩展', '内置、本地和全局扩展。', `
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-puzzle-piece"></i>
                打开扩展
            </button>
        `)}
        <div class="table-wrap">
            <table>
                <thead>
                    <tr><th>扩展</th><th>类型</th><th>路径</th></tr>
                </thead>
                <tbody>
                    ${extensions.map(extension => `
                        <tr>
                            <td>${escapeHtml(extension.name.replace('third-party/', ''))}</td>
                            <td><span class="tag">${escapeHtml(extension.type)}</span></td>
                            <td class="mono">${escapeHtml(extension.name)}</td>
                        </tr>
                    `).join('') || '<tr><td colspan="3">暂无扩展</td></tr>'}
                </tbody>
            </table>
        </div>
    `;
}

function renderActivity() {
    const stats = state.stats || {};
    const rows = Object.entries(stats).slice(0, 60);

    return `
        ${pageHead('活动与统计', '统计缓存和使用记录。', `
            <button class="secondary-button" type="button" data-refresh>
                <i class="fa-solid fa-rotate"></i>
                刷新
            </button>
        `)}
        ${rows.length ? `
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr><th>字段</th><th>值</th></tr>
                    </thead>
                    <tbody>
                        ${rows.map(([key, value]) => `
                            <tr>
                                <td>${escapeHtml(key)}</td>
                                <td>${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : value)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        ` : renderEmptyState('fa-chart-line', '暂无统计数据', '统计缓存为空或尚未生成。')}
    `;
}

function renderSettings() {
    const bundle = state.settingsBundle || {};
    const requestCompression = bundle.request_compression || {};

    return `
        ${pageHead('设置中心', '账户、扩展、请求压缩和页面偏好。', `
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-gear"></i>
                打开设置
            </button>
        `)}
        <div class="grid-list">
            <article class="resource-card">
                <h2 class="card-title">用户与账户</h2>
                <div class="kv-list">
                    ${renderKeyValue('当前用户', state.me?.name || state.me?.handle || '默认用户')}
                    ${renderKeyValue('管理员', state.me?.admin ? '是' : '否')}
                    ${renderKeyValue('账户系统', bundle.enable_accounts ? '开启' : '关闭')}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">扩展</h2>
                <div class="kv-list">
                    ${renderKeyValue('扩展启用', bundle.enable_extensions ? '是' : '否')}
                    ${renderKeyValue('自动更新', bundle.enable_extensions_auto_update ? '是' : '否')}
                    ${renderKeyValue('发现数量', state.extensions.length)}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">请求压缩</h2>
                <div class="kv-list">
                    ${renderKeyValue('启用', requestCompression.enabled ? '是' : '否')}
                    ${renderKeyValue('最小载荷', formatBytes(requestCompression.minPayloadSize))}
                    ${renderKeyValue('最大载荷', formatBytes(requestCompression.maxPayloadSize))}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">本页偏好</h2>
                <div class="kv-list">
                    ${renderKeyValue('主题', state.theme)}
                    ${renderKeyValue('数据状态', state.errors.length ? '部分失败' : '正常')}
                    ${renderKeyValue('入口', '/modern/')}
                </div>
            </article>
        </div>
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
    const selectedWorldbook = state.worldbooks.find(worldbook => worldbook.file_id === state.selected.worldbook);
    const selectedChat = getSelectedChatList().find(chat => chat.file_id === state.selected.chat);

    elements.inspector.innerHTML = `
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
                ${renderKeyValue('角色', selectedCharacter?.name || selectedCharacter?.data?.name || '未选中')}
                ${renderKeyValue('角色文件', selectedCharacter?.avatar || '未选中')}
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
    const routeButton = event.target.closest('[data-route]');
    if (routeButton) {
        await setRoute(routeButton.dataset.route);
        elements.app.querySelector('.sidebar')?.classList.remove('open');
        return;
    }

    const characterButton = event.target.closest('[data-select-character]');
    if (characterButton) {
        state.selected.character = characterButton.dataset.selectCharacter;
        state.selected.chat = '';
        if (state.route === 'chat') {
            await prepareChatForSelectedCharacter();
        }
        render();
        return;
    }

    const chatButton = event.target.closest('[data-select-chat]');
    if (chatButton) {
        state.selected.chat = chatButton.dataset.selectChat;
        await loadChatMessages(getSelectedCharacter(), state.selected.chat);
        render();
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
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-worldbook-create-name]')) {
        state.worldbookCreating.name = event.target.value;
    }
    if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) && event.target.matches('[data-world-entry-field]')) {
        updateWorldEntryFormField(event.target);
    }
});
elements.content.addEventListener('change', event => {
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
