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
    loadingChats: {},
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
    const chatSource = settings.chat_completion_source || settings.oai_settings?.chat_completion_source || '';
    const model = settings.openai_model
        || settings.oai_settings?.openai_model
        || settings.textgenerationwebui_settings?.openrouter_model
        || settings.textgenerationwebui_settings?.custom_model
        || settings.model
        || '';
    const preset = settings.preset_settings || settings.openai_settings || settings.textgenerationwebui_settings || '';

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
        const messages = Array.isArray(result) ? result.filter(message => message && !message.chat_metadata) : [];
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
                <p class="page-description">${escapeHtml(description)}</p>
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
    const presetGroups = getPresetGroups().filter(group => group.names.length > 0);

    return `
        ${pageHead('现代工作台', '把聊天入口、资源管理、API 状态和配置检查拆成稳定的工作区。当前版本只读现有数据，不改变旧 UI 行为。', `
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-arrow-up-right-from-square"></i>
                原版界面
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
        <section class="panel" style="margin-top: 14px;">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">预设分布</h2>
                    <p class="panel-subtitle">按 SillyTavern 原有预设目录聚合。</p>
                </div>
            </div>
            <div class="grid-list">
                ${presetGroups.map(group => `
                    <article class="resource-card">
                        <div class="card-head">
                            <div>
                                <h3 class="card-title">${escapeHtml(group.label)}</h3>
                                <div class="card-meta">${formatNumber(group.names.length)} 个预设</div>
                            </div>
                            <span class="badge">${escapeHtml(group.id)}</span>
                        </div>
                        <div class="tag-row">
                            ${group.names.slice(0, 6).map(name => `<span class="tag">${escapeHtml(name)}</span>`).join('')}
                            ${group.names.length > 6 ? `<span class="tag">+${group.names.length - 6}</span>` : ''}
                        </div>
                    </article>
                `).join('') || renderInlineEmpty('暂无预设')}
            </div>
        </section>
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
        ${pageHead('聊天工作区', '按角色切换聊天文件，直接预览 jsonl 消息记录。发送和生成仍走原版链路，避免改变现有保存语义。', `
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-arrow-up-right-from-square"></i>
                用原版继续聊
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
                </div>
                <div class="resource-list">
                    ${chats.map(chat => renderChatFileRow(chat)).join('') || renderInlineEmpty(selected ? '这个角色暂无聊天文件' : '先选择一个角色')}
                </div>
            </section>
            <section class="panel chat-thread">
                ${selected ? renderChatThread(selected) : renderEmptyState('fa-address-card', '没有可用角色', '先导入角色卡，再从这里进入聊天工作区。')}
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

    return `
        <div class="detail-hero">
            ${avatar ? `<img class="avatar large" src="${avatar}" alt="">` : '<span class="avatar-fallback large">C</span>'}
            <div>
                <h2 class="detail-title">${escapeHtml(name)}</h2>
                <p class="panel-subtitle">${escapeHtml(selectedChat?.file_name || character.data?.creator || character.avatar || '角色卡')}</p>
                <div class="tag-row" style="margin-top: 10px;">
                    <span class="tag">${formatNumber(messages.length)} 条消息</span>
                    <span class="tag">${escapeHtml(selectedChat?.file_size || '0 B')}</span>
                    <span class="tag">${escapeHtml(formatDate(selectedChat?.last_mes))}</span>
                </div>
            </div>
        </div>
        ${messages.length ? renderMessageList(messages) : renderEmptyState('fa-comments', chats.length ? '聊天文件为空' : '暂无聊天记录', chats.length ? '这个聊天文件没有可显示消息。' : '选择原版界面开始聊天后，这里会显示历史记录。')}
        <div class="composer">
            <textarea disabled placeholder="发送和生成仍使用原版聊天链路。"></textarea>
            <button class="primary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-arrow-up-right-from-square"></i>
                原版发送
            </button>
        </div>
    `;
}

function renderMessageList(messages) {
    return `
        <div class="message-list">
            ${messages.slice(-80).map(message => renderMessage(message)).join('')}
        </div>
    `;
}

function renderMessage(message) {
    const name = message.name || (message.is_user ? 'You' : 'Character');
    const text = message.extra?.display_text || message.mes || '[空消息]';
    const model = message.extra?.model || message.extra?.api || '';

    return `
        <article class="message ${message.is_user ? 'user' : ''}">
            <header class="message-meta">
                <strong>${escapeHtml(name)}</strong>
                <span>${escapeHtml(formatDate(message.send_date))}</span>
            </header>
            <div>${escapeHtml(text)}</div>
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
        ${pageHead('角色库', '把角色卡从聊天侧栏中独立出来，便于筛选、检查来源、查看关联世界书和聊天占用。', `
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
                <div class="tag-row" style="margin-top: 10px;">
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
        <p class="detail-text">${escapeHtml(character.description || character.data?.creator_notes || '当前列表接口未返回完整角色描述；需要编辑时请进入原版角色编辑器。')}</p>
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
        ${pageHead('世界书', '把知识库从聊天设置里拆出来，集中查看文件、条目和扩展元数据。编辑动作第一期仍交给原版。', `
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-pen-to-square"></i>
                原版编辑
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
                <div class="resource-list">
                    ${worldbooks.map(worldbook => `
                        <button class="resource-row ${state.selected.worldbook === worldbook.file_id ? 'active' : ''}" type="button" data-select-worldbook="${escapeHtml(worldbook.file_id)}">
                            <span class="avatar-fallback"><i class="fa-solid fa-book-open"></i></span>
                            <span class="row-main">
                                <span class="row-title">${escapeHtml(worldbook.name || worldbook.file_id)}</span>
                                <span class="row-subtitle">${escapeHtml(worldbook.file_id)}</span>
                            </span>
                        </button>
                    `).join('') || renderInlineEmpty('暂无世界书')}
                </div>
            </section>
            <section class="panel">
                ${selected ? renderWorldbookDetail(selected) : renderEmptyState('fa-book-open', '暂无世界书', '当前用户目录里没有世界书。')}
            </section>
        </div>
    `;
}

function renderWorldbookDetail(worldbook) {
    const detail = state.worldDetails[worldbook.file_id];
    const entries = detail?.entries ? Object.values(detail.entries) : [];
    const enabledEntries = entries.filter(entry => !entry.disable);

    return `
        <div class="panel-header">
            <div>
                <h2 class="panel-title">${escapeHtml(worldbook.name || worldbook.file_id)}</h2>
                <p class="panel-subtitle">${escapeHtml(worldbook.file_id)}.json</p>
            </div>
            <button class="secondary-button" type="button" data-load-worldbook="${escapeHtml(worldbook.file_id)}">
                <i class="fa-solid fa-database"></i>
                读取条目
            </button>
        </div>
        ${detail ? `
            <div class="metrics-grid" style="grid-template-columns: repeat(3, minmax(0, 1fr));">
                ${metricCard('条目', formatNumber(entries.length), '全部 entries', 'fa-list')}
                ${metricCard('启用', formatNumber(enabledEntries.length), '未禁用条目', 'fa-toggle-on')}
                ${metricCard('扩展字段', formatNumber(Object.keys(detail.extensions || {}).length), 'metadata', 'fa-code-branch')}
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr><th>键</th><th>注释</th><th>状态</th></tr>
                    </thead>
                    <tbody>
                        ${entries.slice(0, 30).map(entry => `
                            <tr>
                                <td>${escapeHtml(Array.isArray(entry.key) ? entry.key.join(', ') : entry.key || '无关键词')}</td>
                                <td>${escapeHtml(entry.comment || entry.name || '未命名条目')}</td>
                                <td>${entry.disable ? '<span class="danger">禁用</span>' : '<span class="success">启用</span>'}</td>
                            </tr>
                        `).join('') || '<tr><td colspan="3">没有条目</td></tr>'}
                    </tbody>
                </table>
            </div>
        ` : renderEmptyState('fa-database', '尚未读取条目', '点击“读取条目”查看这个世界书的 entries。')}
    `;
}

function renderPresets() {
    const groups = getPresetGroups()
        .map(group => ({ ...group, names: group.names.filter(name => matchesQuery(name, group.label, group.id)) }))
        .filter(group => group.names.length > 0);

    return `
        ${pageHead('预设管理', '把模型参数、指令模板、系统提示词、上下文模板放在统一页面浏览。第一期只读，不写回预设文件。', `
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-pen-to-square"></i>
                原版编辑
            </button>
        `)}
        <div class="grid-list">
            ${groups.map(group => `
                <article class="resource-card">
                    <div class="card-head">
                        <div>
                            <h2 class="card-title">${escapeHtml(group.label)}</h2>
                            <div class="card-meta">${escapeHtml(group.id)} · ${formatNumber(group.names.length)} 个</div>
                        </div>
                        <span class="badge">${formatNumber(group.names.length)}</span>
                    </div>
                    <div class="resource-list" style="max-height: 280px;">
                        ${group.names.map((name, index) => `
                            <div class="resource-row">
                                <span class="avatar-fallback"><i class="fa-solid fa-file-lines"></i></span>
                                <span class="row-main">
                                    <span class="row-title">${escapeHtml(name)}</span>
                                    <span class="row-subtitle">${escapeHtml(getPresetSummary(group.contents[index]))}</span>
                                </span>
                            </div>
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
        ${pageHead('用户人设', '用户人设独立于角色卡，用来定义“你是谁”。这里集中查看头像、标题和默认人设。', `
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-user-pen"></i>
                原版管理
            </button>
        `)}
        <div class="grid-list">
            ${personas.map(persona => `
                <article class="resource-card">
                    <div class="detail-hero" style="margin-bottom: 0;">
                        <img class="avatar large" src="${getPersonaUrl(persona.avatarId)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'), { className: 'avatar-fallback large', textContent: 'P' }))">
                        <div>
                            <h2 class="card-title">${escapeHtml(persona.name || '未命名人设')}</h2>
                            <div class="card-meta">${escapeHtml(persona.title || persona.avatarId)}</div>
                            ${persona.default ? '<span class="tag">默认</span>' : ''}
                        </div>
                    </div>
                    <p class="detail-text">${escapeHtml(persona.description || '暂无描述')}</p>
                </article>
            `).join('') || renderEmptyState('fa-user-gear', '暂无用户人设', '可以在原版用户人设管理中创建。')}
        </div>
    `;
}

function renderAssets() {
    const groups = getAssetGroups().filter(group => matchesQuery(group.name));
    const backgrounds = state.backgrounds?.images || [];

    return `
        ${pageHead('素材库', '聚合背景、音频、Live2D、VRM 和其他资产，让素材管理从聊天页中分离出来。', `
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-folder-open"></i>
                原版素材面板
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
        ${pageHead('API 连接管理', '集中查看当前连接、模型、预设和安全状态。这里不会读取或展示密钥明文。', `
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-key"></i>
                原版连接配置
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
                            <tr><th>项目</th><th>状态</th><th>说明</th></tr>
                        </thead>
                        <tbody>${checks.map(check => renderApiCheckRow(check)).join('')}</tbody>
                    </table>
                </div>
            </section>
        </div>
        <section class="panel" style="margin-top: 14px;">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">连接档案</h2>
                    <p class="panel-subtitle">按调用类型整理当前可见配置，敏感字段已省略。</p>
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
        <section class="panel" style="margin-top: 14px;">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">诊断字段</h2>
                    <p class="panel-subtitle">保留必要 raw 字段，便于和原版连接配置对照。</p>
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

function getApiProfiles() {
    const settings = state.settings || {};
    const textgen = settings.textgenerationwebui_settings || {};
    const openaiSource = settings.chat_completion_source || settings.oai_settings?.chat_completion_source || '';
    const openaiModel = settings.openai_model || settings.oai_settings?.openai_model || '';
    const textgenModel = textgen.openrouter_model || textgen.custom_model || textgen.generic_model || textgen.ollama_model || textgen.model || '';

    return [
        {
            title: '主连接',
            kind: 'generation',
            active: true,
            source: settings.main_api || '',
            model: openaiModel || textgenModel || settings.model || '',
            preset: settings.preset_settings || settings.active_preset || '',
            endpoint: maskEndpoint(settings.api_server || settings.api_server_textgenerationwebui || ''),
        },
        {
            title: '聊天补全',
            kind: 'chat-completions',
            active: settings.main_api === 'openai',
            source: openaiSource,
            model: openaiModel,
            preset: settings.preset_settings || '',
            endpoint: maskEndpoint(settings.reverse_proxy || settings.custom_url || settings.openai_reverse_proxy || ''),
        },
        {
            title: '文本补全',
            kind: 'text-completions',
            active: settings.main_api === 'textgenerationwebui',
            source: textgen.type || settings.textgen_type || '',
            model: textgenModel,
            preset: settings.textgenerationwebui_preset || settings.textgenerationwebui_settings_preset || '',
            endpoint: maskEndpoint(textgen.server_urls?.[textgen.type] || textgen.api_server || settings.api_server_textgenerationwebui || ''),
        },
    ];
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
        ${pageHead('扩展', '扩展独立成管理页，便于区分内置、本地和全局扩展。第一期不执行安装、更新、删除。', `
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-puzzle-piece"></i>
                原版扩展面板
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
        ${pageHead('活动与统计', '聚合 SillyTavern 已有统计缓存。不同版本统计结构可能不同，所以这里用通用键值表展示。', `
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
        ${pageHead('设置中心', '把账户、扩展、请求压缩、主题和模板等配置集中到后台式页面。第一期只做可读检查。', `
            <button class="secondary-button" type="button" data-open-legacy>
                <i class="fa-solid fa-gear"></i>
                原版设置
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

    const worldbookButton = event.target.closest('[data-select-worldbook]');
    if (worldbookButton) {
        state.selected.worldbook = worldbookButton.dataset.selectWorldbook;
        render();
        return;
    }

    const loadWorldbookButton = event.target.closest('[data-load-worldbook]');
    if (loadWorldbookButton) {
        await loadWorldDetail(loadWorldbookButton.dataset.loadWorldbook);
        render();
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
