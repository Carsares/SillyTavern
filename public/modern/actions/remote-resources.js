import { BRIDGE_ACTIONS, BRIDGE_TIMEOUTS } from '../core/bridge-protocol.js';
import { downloadFile } from '../core/utils.js';

const remoteResourceTypes = new Set(['', 'character', 'worldbook', 'extension', 'asset', 'preset']);

// 后端 /api/presets/save 认可的 apiId 集合，非该集合的值会被后端拒绝。
const presetApiIds = new Set(['kobold', 'koboldhorde', 'novel', 'textgenerationwebui', 'openai', 'instruct', 'context', 'sysprompt', 'reasoning']);

// 前端按资源站逐个请求搜索时的并发上限：与浏览器同源 HTTP/1.1 连接数（6）一致，
// 既让快的资源站先出结果，又不把其他接口请求挤在连接队列后面。
const REMOTE_SEARCH_CONCURRENCY = 6;
const REMOTE_SEARCH_LIMIT = 48;

// 资源站失败提示的长度上限：简述用于行内提示和 toast，详情放进 title 供悬停查看。
const REMOTE_ERROR_SUMMARY_MAX_LENGTH = 120;
const REMOTE_ERROR_DETAIL_MAX_LENGTH = 600;
// 常见 HTTP 状态码的中文简述；未列出的按 4xx / 5xx 归类。
const HTTP_STATUS_LABELS = {
    400: '请求无效',
    401: '未授权',
    403: '被拒绝',
    404: '未找到',
    408: '请求超时',
    410: '已下线',
    429: '请求过于频繁',
    500: '服务器错误',
    502: '网关错误',
    503: '服务不可用',
    504: '网关超时',
};
const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', '#39': '\'', '#039': '\'', nbsp: ' ' };

/**
 * 把错误文本整理成一行纯文本：去掉 script / style 块、注释和标签（含被截断的半个标签），解码常见实体并合并空白。
 * 后端已做同样处理，这里作为兜底，防止旧后端或其他来源把整页 HTML 带进提示。
 * @param {unknown} value 错误文本
 * @param {number} maxLength 最大长度，超出部分以省略号结尾
 * @returns {string} 纯文本
 */
export function sanitizeRemoteErrorText(value, maxLength) {
    const text = String(value ?? '')
        .replace(/<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
        .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/<[^>]*$/, ' ')
        .replace(/&(amp|lt|gt|quot|apos|#0?39|nbsp);/g, (_match, name) => HTML_ENTITIES[name])
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

/**
 * 把一条资源站错误归纳为简述和详情：带 HTTP 状态码的保留状态码并附中文说明，超时和网络错误归类，其余截断原文。
 * @param {unknown} message 错误文本
 * @returns {{ summary: string, detail: string }} 简述与完整（已清理）详情
 */
export function summarizeRemoteError(message) {
    const detail = sanitizeRemoteErrorText(message, REMOTE_ERROR_DETAIL_MAX_LENGTH) || '未知错误';
    const status = detail.match(/(?:^|[\s:(（])([45]\d{2})(?=$|[\s),.;:，。；）])/)?.[1];
    if (status) {
        const label = HTTP_STATUS_LABELS[status] || (status.startsWith('5') ? '服务器错误' : '请求失败');
        return { summary: `${status} ${label}`, detail };
    }
    if (/timed?\s*out|timeout|ETIMEDOUT/i.test(detail)) {
        return { summary: '请求超时', detail };
    }
    if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed|failed to fetch/i.test(detail)) {
        return { summary: '网络连接失败', detail };
    }
    return { summary: sanitizeRemoteErrorText(detail, REMOTE_ERROR_SUMMARY_MAX_LENGTH), detail };
}

/**
 * 生成单个资源站的失败记录；后端在 errors 字符串前加了「资源站名: 」前缀，这里去掉以免名称重复。
 * @param {{ id: string, name?: string }} provider 资源站
 * @param {unknown} message 错误文本
 * @returns {{ providerId: string, providerName: string, summary: string, detail: string }} 失败记录
 */
export function describeRemoteSearchError(provider, message) {
    const providerName = provider.name || provider.id;
    let text = String(message ?? '');
    for (const separator of [': ', '：']) {
        if (text.startsWith(`${providerName}${separator}`)) {
            text = text.slice(providerName.length + separator.length);
            break;
        }
    }
    return { providerId: provider.id, providerName, ...summarizeRemoteError(text) };
}

/**
 * 失败记录的展示文本，行内提示与 toast 共用，名称与搜索进度里的「失败」名单一致。
 * @param {{ providerName: string, summary: string }} error 失败记录
 * @returns {string} 例如「Character Tavern：404 未找到」
 */
export function formatRemoteSearchError(error) {
    return `${error.providerName}：${error.summary}`;
}

// toast 只列前两个资源站，其余以总数概括，完整名单在页面内的提示里。
function formatRemoteSearchErrorToast(errors) {
    const shown = errors.slice(0, 2).map(formatRemoteSearchError).join('；');
    return errors.length > 2 ? `${shown} 等 ${errors.length} 个资源站` : shown;
}

// 仅在强信号命中时返回具体 apiId，弱信号或无判据一律返回 null，交给用户在卡片内联选择，避免误判。
function inferPresetApiId(preset) {
    if (!preset || typeof preset !== 'object') {
        return null;
    }
    const has = key => Object.prototype.hasOwnProperty.call(preset, key);
    // openai：Chat Completion 专有字段，或同时具备提示词编排结构
    if (has('chat_completion_source') || has('openai_model') || (has('prompts') && has('prompt_order'))) {
        return 'openai';
    }
    // textgenerationwebui：仅用 textgen 独有强信号；sampler_order/rep_pen 与 KoboldAI 共享，属弱信号，
    // 命中即返回会把 KoboldAI 预设误判进 textgen 目录，故交用户选择而非强判。
    if (has('dynatemp') || has('max_tokens_second')) {
        return 'textgenerationwebui';
    }
    // instruct：指令模板同时含输入与输出序列
    if (has('input_sequence') && has('output_sequence')) {
        return 'instruct';
    }
    // context：上下文模板同时含 story_string 与 chat_start
    if (has('story_string') && has('chat_start')) {
        return 'context';
    }
    // 其余（sysprompt/novel/kobold/reasoning 等弱信号）交给用户选择
    return null;
}

export function createRemoteResourceActions({
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
    confirmAction = message => window.confirm(message),
}) {
    let remoteSearchToken = null;
    let remoteSearchController = null;

    function getRemoteResourceCount() {
        return state.remoteResources.records.length;
    }

    async function loadRemoteResources({ force = false } = {}) {
        if (!force && state.remoteResources.loaded) {
            return;
        }

        state.remoteResources.loading = true;
        render();
        try {
            const [providers, records] = await Promise.all([
                apiFetch('/api/remote-resources/providers', { method: 'GET' }),
                apiFetch('/api/remote-resources/records', { method: 'GET' }),
            ]);
            state.remoteResources.providers = Array.isArray(providers) ? providers : [];
            state.remoteResources.records = Array.isArray(records) ? records : [];
            if (!state.remoteResources.selectedProviders.length) {
                state.remoteResources.selectedProviders = state.remoteResources.providers
                    .filter(provider => provider.supportsSearch)
                    .map(provider => provider.id);
            }
            state.remoteResources.loaded = true;
        } finally {
            state.remoteResources.loading = false;
            render();
        }
    }

    async function refreshRemoteResources() {
        await loadRemoteResources({ force: true });
        showToast('远程资源已刷新', '资源站与导入记录已更新');
    }

    function setRemoteResourceTab(tab) {
        state.remoteResources.activeTab = ['discover', 'url', 'records', 'accounts'].includes(tab) ? tab : 'discover';
        localStorage.setItem('st-modern-remote-resource-tab', state.remoteResources.activeTab);
        render();
    }

    function setRemoteResourceType(resourceType) {
        state.remoteResources.resourceType = remoteResourceTypes.has(resourceType) ? resourceType : '';
        render();
    }

    function setRemoteResourceQuery(query) {
        state.remoteResources.query = query;
    }

    function setRemoteUrlImport(url) {
        state.remoteResources.urlImport.url = url;
    }

    function toggleRemoteProvider(providerId, checked) {
        const providers = new Set(state.remoteResources.selectedProviders);
        if (checked) {
            providers.add(providerId);
        } else {
            providers.delete(providerId);
        }
        state.remoteResources.selectedProviders = [...providers];
        render();
    }

    // 搜索按资源站拆成独立请求（并发上限 REMOTE_SEARCH_CONCURRENCY），每个资源站返回即合并渲染。
    // 合并结果始终按所选资源站顺序拼接，搜索全部结束后与后端一次性聚合的结果、total、errors 完全一致。
    async function searchRemoteResources() {
        const searchToken = Symbol('remote-search');
        remoteSearchToken = searchToken;
        // 新搜索立即中止上一轮仍在等待的请求；上一轮迟到的响应也会因 token 失效被丢弃，不会混入本轮结果。
        abortRemoteSearchRequests();
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        remoteSearchController = controller;
        const isCurrentSearch = () => remoteSearchToken === searchToken;
        const query = state.remoteResources.query.trim();
        const resourceType = state.remoteResources.resourceType;
        const selectedProviders = [...state.remoteResources.selectedProviders];
        try {
            if (!state.remoteResources.loaded) {
                await loadRemoteResources();
            }
            if (!isCurrentSearch()) {
                return;
            }

            const providers = resolveSearchProviders(selectedProviders);
            if (!providers.length) {
                throw new Error('没有可搜索的已启用资源站，请勾选或启用资源站后再搜索。');
            }

            const remote = state.remoteResources;
            remote.searching = true;
            remote.searched = true;
            remote.results = [];
            remote.total = 0;
            remote.errors = [];
            remote.resultPage = 1;
            remote.searchProgress = {
                providers: providers.map(provider => ({ id: provider.id, name: provider.name, status: 'queued' })),
                cancelled: false,
            };

            const outcomes = new Map();
            const queue = [...providers];
            const takeNextProvider = () => {
                const provider = queue.shift();
                if (provider) {
                    setSearchProviderStatus(provider.id, 'running');
                }
                return provider;
            };
            const publishOutcomes = () => {
                const settled = providers.map(provider => outcomes.get(provider.id)).filter(Boolean);
                remote.results = settled.flatMap(outcome => outcome.items);
                remote.total = settled.reduce((sum, outcome) => sum + outcome.total, 0) || remote.results.length;
                remote.errors = settled.flatMap(outcome => outcome.errors);
            };
            const runWorker = async () => {
                let provider = takeNextProvider();
                while (provider) {
                    const outcome = await searchSingleProvider(provider, { query, resourceType, signal: controller?.signal });
                    if (!isCurrentSearch()) {
                        return;
                    }
                    outcomes.set(provider.id, outcome);
                    setSearchProviderStatus(provider.id, outcome.errors.length ? 'failed' : 'done');
                    publishOutcomes();
                    // 先领取下一个资源站再渲染，进度里的「等待中」名单与实际在途请求保持一致。
                    provider = takeNextProvider();
                    renderPreservingQueryFocus();
                }
            };

            const workers = Array.from({ length: Math.min(REMOTE_SEARCH_CONCURRENCY, providers.length) }, () => runWorker());
            renderPreservingQueryFocus();
            await Promise.all(workers);
            if (!isCurrentSearch()) {
                return;
            }

            const requestErrors = [...outcomes.values()].map(outcome => outcome.requestError).filter(Boolean);
            // 所有资源站请求都在传输层失败（如会话失效、服务不可达）时，沿用旧的整体失败提示。
            if (requestErrors.length === providers.length) {
                throw requestErrors[0];
            }
            if (remote.errors.length) {
                showToast('部分资源站读取失败', formatRemoteSearchErrorToast(remote.errors));
            }
        } catch (error) {
            if (isCurrentSearch()) {
                throw error;
            }
        } finally {
            if (isCurrentSearch()) {
                state.remoteResources.searching = false;
                if (remoteSearchController === controller) {
                    remoteSearchController = null;
                }
                renderPreservingQueryFocus();
            }
        }
    }

    // 取消只中止仍在等待的资源站请求，已返回的结果全部保留，搜索按钮随 searching=false 恢复。
    function cancelRemoteSearch() {
        const remote = state.remoteResources;
        if (!remote.searching) {
            return;
        }
        remoteSearchToken = null;
        abortRemoteSearchRequests();
        remote.searching = false;
        if (remote.searchProgress) {
            remote.searchProgress.cancelled = true;
            for (const provider of remote.searchProgress.providers) {
                if (provider.status === 'queued' || provider.status === 'running') {
                    provider.status = 'cancelled';
                }
            }
        }
        renderPreservingQueryFocus();
        showToast('已取消搜索', `已保留 ${remote.results.length} 条结果`);
    }

    function setRemoteResultPage(page) {
        state.remoteResources.resultPage = Math.max(1, Math.trunc(Number(page)) || 1);
        render();
    }

    function abortRemoteSearchRequests() {
        remoteSearchController?.abort();
        remoteSearchController = null;
    }

    // 只请求已知、可搜索且未被禁用的资源站；后端同样会跳过禁用项，这里提前过滤让进度总数与实际请求一致。
    function resolveSearchProviders(selectedProviders) {
        const searchable = state.remoteResources.providers.filter(provider => provider.supportsSearch && provider.enabled !== false);
        if (!selectedProviders.length) {
            return searchable;
        }
        const byId = new Map(searchable.map(provider => [provider.id, provider]));
        return [...new Set(selectedProviders)].map(id => byId.get(id)).filter(Boolean);
    }

    async function searchSingleProvider(provider, { query, resourceType, signal }) {
        try {
            const result = await apiFetch('/api/remote-resources/search', {
                body: {
                    query,
                    resourceType,
                    providers: [provider.id],
                    page: 1,
                    limit: REMOTE_SEARCH_LIMIT,
                },
                signal,
            });
            const items = Array.isArray(result?.items) ? result.items : [];
            // 优先读后端的结构化 providerErrors（不带名称前缀），旧响应只有 errors 字符串时退回读取它。
            const providerErrors = Array.isArray(result?.providerErrors) ? result.providerErrors.map(error => error?.message) : [];
            const messages = providerErrors.length ? providerErrors : (Array.isArray(result?.errors) ? result.errors : []);
            return {
                items,
                total: Number(result?.total) || items.length,
                errors: messages.map(message => describeRemoteSearchError(provider, message)),
                requestError: null,
            };
        } catch (error) {
            return {
                items: [],
                total: 0,
                errors: [describeRemoteSearchError(provider, error?.message || String(error))],
                requestError: error,
            };
        }
    }

    function setSearchProviderStatus(providerId, status) {
        const entry = state.remoteResources.searchProgress?.providers.find(provider => provider.id === providerId);
        if (entry) {
            entry.status = status;
        }
    }

    // 渐进渲染会整页重绘；用户在搜索期间继续输入关键词时，保留输入框焦点与光标位置，避免每个资源站返回都打断输入。
    function renderPreservingQueryFocus() {
        const active = typeof document === 'undefined' ? null : document.activeElement;
        const queryInput = active && active instanceof HTMLInputElement && active.matches('[data-remote-resource-query]') ? active : null;
        const selection = queryInput ? [queryInput.selectionStart, queryInput.selectionEnd] : null;
        render();
        if (!queryInput || document.activeElement === queryInput) {
            return;
        }
        const nextInput = document.querySelector('[data-remote-resource-query]');
        if (nextInput instanceof HTMLInputElement) {
            nextInput.focus();
            if (selection && selection[0] !== null) {
                nextInput.setSelectionRange(selection[0], selection[1]);
            }
        }
    }

    async function importRemoteUrl() {
        const url = state.remoteResources.urlImport.url.trim();
        if (!url) {
            throw new Error('请输入远程资源 URL。');
        }
        const parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            throw new Error('远程资源 URL 只支持 HTTP 或 HTTPS。');
        }

        state.remoteResources.urlImport.running = true;
        render();
        try {
            const response = await apiFetchResponse('/api/content/importURL', { body: { url } });
            const resourceType = response.headers.get('x-custom-content-type') === 'lorebook' ? 'worldbook' : response.headers.get('x-custom-content-type') || 'character';
            const blob = await response.blob();
            const fileName = getResponseFileName(response) || getFileNameFromUrl(url, resourceType === 'worldbook' ? 'remote-worldbook.json' : 'remote-character.png');
            const localId = await importBlobAsLocalResource(blob, fileName, resourceType);
            await saveRemoteRecord({
                providerId: getUrlProviderId(parsedUrl.hostname),
                providerName: parsedUrl.hostname,
                remoteId: url,
                resourceType,
                title: fileName.replace(/\.[^/.]+$/, ''),
                sourceUrl: url,
                localType: resourceType,
                localId,
                action: 'import-url',
            });
            state.remoteResources.urlImport = { url: '', running: false };
            showToast(resourceType === 'worldbook' ? '世界书已导入' : '角色已导入', localId || fileName);
        } finally {
            state.remoteResources.urlImport.running = false;
            render();
        }
    }

    async function importRemoteResource(index) {
        const item = state.remoteResources.results[index];
        if (!item) {
            throw new Error('远程资源不存在，请重新搜索。');
        }

        if (item.resourceType === 'extension') {
            await installRemoteExtension(item);
            return;
        }

        if (item.resourceType === 'asset') {
            await downloadRemoteAsset(item);
            return;
        }

        if (item.resourceType === 'preset') {
            await importRemotePreset(index);
            return;
        }

        if (!['character', 'worldbook'].includes(item.resourceType)) {
            await downloadRemoteResource(index);
            return;
        }

        state.remoteResources.operation = { key: itemKey(item), running: true };
        render();
        try {
            const response = await apiFetchResponse('/api/remote-resources/download', {
                body: {
                    providerId: item.providerId,
                    resourceId: item.id,
                    resourceType: item.resourceType,
                },
            });
            const blob = await response.blob();
            const fileName = getResponseFileName(response) || `${item.title || item.id}.json`;
            const localId = await importBlobAsLocalResource(blob, fileName, item.resourceType);
            await saveRemoteRecord({
                providerId: item.providerId,
                providerName: item.providerName,
                remoteId: item.id,
                resourceType: item.resourceType,
                title: item.title,
                sourceUrl: item.sourceUrl,
                localType: item.resourceType,
                localId,
                action: 'import',
                metadata: item.metadata,
            });
            showToast(item.resourceType === 'worldbook' ? '世界书已导入' : '角色已导入', localId || item.title);
        } finally {
            state.remoteResources.operation = { key: '', running: false };
            render();
        }
    }

    // 远程预设导入：先按字段特征自动推断 apiId，推不出再让用户在卡片内联选择类型。
    async function importRemotePreset(index) {
        const item = state.remoteResources.results[index];
        if (!item) {
            throw new Error('远程资源不存在，请重新搜索。');
        }

        // RisuAI 的预设是 preset-risu-v1 专有格式，非 ST 原生，直接提示不支持，不落盘。
        if (item.providerId === 'risu-realm') {
            showToast('暂不支持导入', '该来源为 RisuAI 专有格式');
            return;
        }

        state.remoteResources.operation = { key: itemKey(item), running: true };
        render();
        try {
            const preset = await downloadRemotePreset(item);
            const apiId = inferPresetApiId(preset);
            if (!apiId) {
                // 推断不出类型时记录待选状态，卡片会渲染内联 select 让用户选，本轮不落盘。
                state.remoteResources.presetPrompt = { key: itemKey(item), index };
                return;
            }
            await savePresetImport(item, preset, apiId);
        } finally {
            state.remoteResources.operation = { key: '', running: false };
            render();
        }
    }

    // 用户在内联 select 选定类型后确认导入的入口。
    async function importPresetWithType(index, apiId) {
        if (!presetApiIds.has(apiId)) {
            throw new Error('请选择有效的预设类型。');
        }
        const item = state.remoteResources.results[index];
        if (!item) {
            throw new Error('远程资源不存在，请重新搜索。');
        }

        state.remoteResources.presetPrompt = null;
        state.remoteResources.operation = { key: itemKey(item), running: true };
        render();
        try {
            const preset = await downloadRemotePreset(item);
            await savePresetImport(item, preset, apiId);
        } finally {
            state.remoteResources.operation = { key: '', running: false };
            render();
        }
    }

    function cancelPresetImport() {
        state.remoteResources.presetPrompt = null;
        render();
    }

    async function downloadRemotePreset(item) {
        const response = await apiFetchResponse('/api/remote-resources/download', {
            body: {
                providerId: item.providerId,
                resourceId: item.id,
                resourceType: item.resourceType,
            },
        });
        const blob = await response.blob();
        const text = await blob.text();
        try {
            return JSON.parse(text);
        } catch {
            throw new Error('预设文件解析失败，返回内容不是有效 JSON。');
        }
    }

    async function savePresetImport(item, preset, apiId) {
        const name = (item.title || item.id || 'preset').trim();
        // 预设导入默认非破坏性：先以 overwrite:false 试写，命中同名（409）时需用户确认才覆盖，避免静默销毁本地定制预设。
        let saved;
        try {
            saved = await apiFetch('/api/presets/save', { body: { name, preset, apiId, overwrite: false } });
        } catch (error) {
            if (error?.status !== 409) {
                throw error;
            }
            if (!confirmAction(`同名预设“${name}”已存在，继续导入将覆盖现有内容。是否继续？`)) {
                throw new Error('已取消预设覆盖。');
            }
            saved = await apiFetch('/api/presets/save', { body: { name, preset, apiId, overwrite: true } });
        }
        const savedName = saved?.name || name;
        await saveRemoteRecord({
            providerId: item.providerId,
            providerName: item.providerName,
            remoteId: item.id,
            resourceType: item.resourceType,
            title: item.title,
            sourceUrl: item.sourceUrl,
            localType: 'preset',
            localId: savedName,
            action: 'import',
            metadata: item.metadata,
        });
        showToast('预设已导入', savedName);
    }

    async function downloadRemoteResource(index) {
        const item = state.remoteResources.results[index];
        if (!item) {
            throw new Error('远程资源不存在，请重新搜索。');
        }
        if (!item.capabilities?.download) {
            throw new Error('该资源没有可下载文件。');
        }

        state.remoteResources.operation = { key: itemKey(item), running: true };
        render();
        try {
            const response = await apiFetchResponse('/api/remote-resources/download', {
                body: {
                    providerId: item.providerId,
                    resourceId: item.id,
                    resourceType: item.resourceType,
                },
            });
            const blob = await response.blob();
            const fileName = getResponseFileName(response) || getFileNameFromUrl(item.downloadUrl || item.sourceUrl, `${item.id}.json`);
            downloadFile(blob, fileName, blob.type || 'application/octet-stream');
            await saveRemoteRecord({
                providerId: item.providerId,
                providerName: item.providerName,
                remoteId: item.id,
                resourceType: item.resourceType,
                title: item.title,
                sourceUrl: item.sourceUrl,
                localType: '',
                localId: fileName,
                action: 'download',
                metadata: item.metadata,
            });
            showToast('下载已开始', fileName);
        } finally {
            state.remoteResources.operation = { key: '', running: false };
            render();
        }
    }

    async function downloadRemoteAsset(item) {
        const category = item.metadata?.assetCategory || 'ambient';
        const filename = item.metadata?.filename || getFileNameFromUrl(item.downloadUrl, `${item.id}.bin`);
        if (!item.downloadUrl) {
            throw new Error('该素材没有下载 URL。');
        }

        state.remoteResources.operation = { key: itemKey(item), running: true };
        render();
        try {
            await apiFetch('/api/assets/download', {
                body: {
                    url: item.downloadUrl,
                    category,
                    filename,
                },
            });
            await saveRemoteRecord({
                providerId: item.providerId,
                providerName: item.providerName,
                remoteId: item.id,
                resourceType: item.resourceType,
                title: item.title,
                sourceUrl: item.sourceUrl,
                localType: 'asset',
                localId: `${category}/${filename}`,
                action: 'download',
                metadata: item.metadata,
            });
            await loadData({ silent: true });
            showToast('素材已下载', `${category}/${filename}`);
        } finally {
            state.remoteResources.operation = { key: '', running: false };
            render();
        }
    }

    async function installRemoteExtension(item) {
        const installUrl = item.installUrl || item.sourceUrl;
        if (!installUrl) {
            throw new Error('该扩展没有 Git URL。');
        }
        const parsedUrl = new URL(installUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            throw new Error('扩展 URL 只支持 HTTP 或 HTTPS。');
        }
        if (!isOfficialExtensionUrl(parsedUrl.href) && !confirmAction('即将安装第三方扩展。第三方扩展可以运行前端代码，请确认你信任该来源。')) {
            throw new Error('已取消扩展安装。');
        }

        state.remoteResources.operation = { key: itemKey(item), running: true };
        render();
        try {
            const result = await apiFetch('/api/extensions/install', {
                body: {
                    url: parsedUrl.href,
                    branch: '',
                    global: false,
                },
            });
            await saveRemoteRecord({
                providerId: item.providerId,
                providerName: item.providerName,
                remoteId: item.id,
                resourceType: item.resourceType,
                title: item.title,
                sourceUrl: item.sourceUrl,
                localType: 'extension',
                localId: result?.folderName || item.title,
                action: 'install',
                metadata: item.metadata,
            });
            await loadData({ silent: true });
            showToast('扩展已安装', result?.display_name || result?.folderName || item.title);
            try {
                await callLegacyBridge(BRIDGE_ACTIONS.EXTENSION_INSTALLED, { response: result }, BRIDGE_TIMEOUTS.EXTENSION);
            } catch (error) {
                showToast('扩展已安装，请刷新页面完成初始化', error.message);
            }
        } finally {
            state.remoteResources.operation = { key: '', running: false };
            render();
        }
    }

    async function saveRemoteProviderCredential(providerId, credentialId, value) {
        if (!value.trim()) {
            throw new Error('请输入凭据内容。');
        }
        state.remoteResources.credentialSaving = `${providerId}:${credentialId}`;
        render();
        try {
            const result = await apiFetch('/api/remote-resources/credentials', {
                body: { providerId, credentialId, value },
            });
            state.remoteResources.providers = Array.isArray(result?.providers) ? result.providers : state.remoteResources.providers;
            state.remoteResources.credentialDrafts[`${providerId}:${credentialId}`] = '';
            showToast('资源站凭据已保存', providerId);
        } finally {
            state.remoteResources.credentialSaving = '';
            render();
        }
    }

    async function deleteRemoteProviderCredential(providerId, credentialId) {
        state.remoteResources.credentialSaving = `${providerId}:${credentialId}`;
        render();
        try {
            const result = await apiFetch('/api/remote-resources/credentials', {
                method: 'DELETE',
                body: { providerId, credentialId },
            });
            state.remoteResources.providers = Array.isArray(result?.providers) ? result.providers : state.remoteResources.providers;
            showToast('资源站凭据已删除', providerId);
        } finally {
            state.remoteResources.credentialSaving = '';
            render();
        }
    }

    function setRemoteCredentialDraft(providerId, credentialId, value) {
        state.remoteResources.credentialDrafts[`${providerId}:${credentialId}`] = value;
    }

    // Persist a per-provider enabled preference so a broken resource site can be disabled globally.
    async function toggleProviderEnabled(providerId, enabled) {
        state.remoteResources.providerToggling = providerId;
        render();
        try {
            const result = await apiFetch('/api/remote-resources/providers/preferences', {
                body: { providerId, enabled },
            });
            state.remoteResources.providers = Array.isArray(result?.providers) ? result.providers : state.remoteResources.providers;
            showToast(enabled ? '资源站已启用' : '资源站已禁用', providerId);
        } finally {
            state.remoteResources.providerToggling = '';
            render();
        }
    }

    async function deleteRemoteRecord(id) {
        await apiFetch(`/api/remote-resources/records/${encodeURIComponent(id)}`, { method: 'DELETE' });
        state.remoteResources.records = state.remoteResources.records.filter(record => record.id !== id);
        showToast('导入记录已删除', '');
        render();
    }

    async function saveRemoteRecord(record) {
        const saved = await apiFetch('/api/remote-resources/records', { body: record });
        if (saved) {
            state.remoteResources.records = [saved, ...state.remoteResources.records.filter(item => item.id !== saved.id)];
        }
    }

    async function importBlobAsLocalResource(blob, fileName, resourceType) {
        if (resourceType === 'worldbook') {
            const importFileName = ensureExtension(fileName, 'json');
            const sanitizedFileName = await apiFetch('/api/files/sanitize-filename', { body: { fileName: importFileName } });
            const worldName = typeof sanitizedFileName?.fileName === 'string' ? sanitizedFileName.fileName.replace(/\.json$/i, '') : '';
            if (!worldName) {
                throw new Error('世界书文件名清理后为空，请使用其他文件名。');
            }
            async function importWorldbook(shouldOverwrite) {
                ensureWorldbookFileWriteAllowed(worldName);
                const formData = new FormData();
                formData.append('avatar', new File([blob], importFileName, { type: blob.type || 'application/json' }));
                if (shouldOverwrite) {
                    formData.set('overwrite', 'true');
                }
                return apiFetch('/api/worldinfo/import', { body: formData, omitContentType: true });
            }

            function confirmWorldbookOverwrite(name) {
                if (!confirmAction(`同名世界书“${name}”已存在，继续导入将覆盖现有内容。是否继续？`)) {
                    throw new Error('已取消世界书覆盖。');
                }
                return true;
            }

            const knownWorldNames = new Set([
                ...(state.worldbooks || []).map(worldbook => worldbook.file_id),
                ...(state.settingsBundle?.world_names || []),
            ]);
            // Worldbook imports are non-destructive unless the user explicitly confirms replacement.
            let overwrite = false;
            if (knownWorldNames.has(worldName)) {
                overwrite = confirmWorldbookOverwrite(worldName);
            }

            let result;
            try {
                result = await importWorldbook(overwrite);
            } catch (error) {
                if (error?.status !== 409 || overwrite) {
                    throw error;
                }
                result = await importWorldbook(confirmWorldbookOverwrite(worldName));
            }

            const importedName = result?.name || worldName;
            restoreWorldbookFile(importedName);
            state.selected.worldbook = importedName;
            delete state.worldDetails[importedName];
            await loadData({ silent: true });
            await loadWorldDetail(importedName);
            return importedName;
        }

        const extension = getFileExtension(fileName) || (blob.type === 'image/png' ? 'png' : 'json');
        const formData = new FormData();
        formData.set('avatar', new File([blob], ensureExtension(fileName, extension), { type: blob.type || 'application/octet-stream' }));
        formData.set('file_type', extension);
        const result = await apiFetch('/api/characters/import', { body: formData, omitContentType: true });
        if (result?.error) {
            throw new Error('角色卡导入失败。');
        }
        const avatar = result?.file_name ? String(result.file_name).replace(/\.png$/i, '') + '.png' : '';
        if (avatar) {
            state.selected.character = avatar;
            state.selected.chat = '';
        }
        await loadData({ silent: true });
        return avatar || fileName;
    }

    return {
        cancelPresetImport,
        cancelRemoteSearch,
        deleteRemoteProviderCredential,
        deleteRemoteRecord,
        downloadRemoteResource,
        getRemoteResourceCount,
        importPresetWithType,
        importRemoteResource,
        importRemoteUrl,
        loadRemoteResources,
        refreshRemoteResources,
        saveRemoteProviderCredential,
        searchRemoteResources,
        setRemoteCredentialDraft,
        setRemoteResourceQuery,
        setRemoteResourceTab,
        setRemoteResourceType,
        setRemoteResultPage,
        setRemoteUrlImport,
        toggleProviderEnabled,
        toggleRemoteProvider,
    };
}

function itemKey(item) {
    return `${item.providerId}:${item.resourceType}:${item.id}`;
}

function isOfficialExtensionUrl(url) {
    try {
        return /^https:\/\/github\.com\/SillyTavern\/(.+)$/i.test(new URL(url).href);
    } catch {
        return false;
    }
}

function getResponseFileName(response) {
    const disposition = response.headers.get('content-disposition') || '';
    const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    if (utfMatch) {
        return decodeURIComponent(utfMatch[1]);
    }
    const match = /filename="?([^";]+)"?/i.exec(disposition);
    return match ? decodeURIComponent(match[1]) : '';
}

function getFileNameFromUrl(url, fallback) {
    try {
        return new URL(url).pathname.split('/').pop() || fallback;
    } catch {
        return fallback;
    }
}

function getUrlProviderId(hostname) {
    if (hostname.includes('chub.ai') || hostname.includes('characterhub.org')) {
        return 'chub';
    }
    if (hostname.includes('risuai.net')) {
        return 'risu-realm';
    }
    return 'url';
}

function getFileExtension(fileName) {
    return fileName.split('.').pop()?.toLowerCase() || '';
}

function ensureExtension(fileName, extension) {
    if (fileName.toLowerCase().endsWith(`.${extension}`)) {
        return fileName;
    }
    return `${fileName.replace(/\.[^/.]+$/, '')}.${extension}`;
}
