// 跨角色聊天搜索（B2）。结果来自 POST /api/chats/search-all（src/endpoints/chats.js），存进 state.chatGlobalSearch：
// scope（'current' | 'all'，侧栏搜索框的范围开关）、query（输入框文字）、searchedQuery（结果对应的关键词）、
// loading、error、results、scannedFiles / totalFiles / partial / partialReason / elapsedMs（后端扫描情况）、
// token（每次搜索自增，过期响应据此丢弃）、controller（正在进行的请求的 AbortController）。
// 命令面板的「在全部聊天中搜索」（shell/router.js）也走 runChatGlobalSearch。
import { escapeHtml } from '../core/utils.js';

export const chatGlobalSearchLimit = 50;
export const chatGlobalSearchScopes = Object.freeze(['current', 'all']);

const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * 与后端同一条规则：关键词至少 2 个字符，含中日韩文字时 1 个字符也可以。
 * @param {unknown} query 输入的关键词
 * @returns {boolean} 是否可以发起全部聊天搜索
 */
export function isChatGlobalSearchQueryAllowed(query) {
    const text = String(query ?? '').trim();
    if (!text) {
        return false;
    }

    return [...text].length >= 2 || cjkPattern.test(text);
}

/**
 * 把后端给的高亮区间套到片段文本上：先转义文本，再给区间加 <mark>，片段内容不会作为 HTML 解释。
 * 非法、倒序或重叠的区间直接忽略。
 * @param {unknown} text 片段文本
 * @param {unknown} highlights [起点, 终点) 区间列表
 * @returns {string} 可直接放进 innerHTML 的字符串
 */
export function renderHighlightedSnippet(text, highlights) {
    const value = String(text ?? '');
    const ranges = (Array.isArray(highlights) ? highlights : [])
        .filter(range => Array.isArray(range) && Number.isInteger(range[0]) && Number.isInteger(range[1]) && range[0] >= 0 && range[1] > range[0] && range[1] <= value.length)
        .sort((a, b) => a[0] - b[0]);

    let html = '';
    let position = 0;
    for (const [start, end] of ranges) {
        if (start < position) {
            continue;
        }
        html += `${escapeHtml(value.slice(position, start))}<mark>${escapeHtml(value.slice(start, end))}</mark>`;
        position = end;
    }

    return html + escapeHtml(value.slice(position));
}

/**
 * 按角色/群聊分组，组和组内会话都保持后端给的「最近修改在前」顺序。
 * @param {any[]} results 后端的 results
 * @returns {{ key: string, kind: 'character' | 'group', avatar: string, groupId: string, entityName: string, hits: any[] }[]} 分组
 */
export function groupChatGlobalSearchResults(results) {
    const groups = new Map();
    for (const hit of Array.isArray(results) ? results : []) {
        const isGroup = hit.kind === 'group';
        const entityId = isGroup ? hit.groupId : hit.avatar;
        const key = `${isGroup ? 'group' : 'character'}:${entityId}`;
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                kind: isGroup ? 'group' : 'character',
                avatar: isGroup ? '' : String(hit.avatar || ''),
                groupId: isGroup ? String(hit.groupId || '') : '',
                entityName: String(hit.entityName || entityId || ''),
                hits: [],
            });
        }
        groups.get(key).hits.push(hit);
    }

    return [...groups.values()];
}

function normalizeHit(hit) {
    if (!hit || typeof hit !== 'object' || !hit.file_id || !(hit.avatar || hit.groupId)) {
        return null;
    }

    return {
        ...hit,
        kind: hit.groupId ? 'group' : 'character',
        message_count: Number(hit.message_count) || 0,
        matchCount: Number(hit.matchCount) || 0,
        snippets: Array.isArray(hit.snippets) ? hit.snippets : [],
    };
}

export function createChatGlobalSearchActions({ state, apiFetch, render, showToast }) {
    // render 会重建整个侧栏；用户在搜索框里按 Enter 或接着改关键词时，焦点和光标要留在搜索框里
    function renderKeepingSearchFocus() {
        const active = typeof document === 'undefined' ? null : document.activeElement;
        const hadFocus = active instanceof HTMLInputElement && active.matches('[data-chat-search-input]');
        const caret = hadFocus ? active.selectionStart : null;
        render();
        if (!hadFocus) {
            return;
        }

        const input = document.querySelector('[data-chat-search-input]');
        if (input instanceof HTMLInputElement) {
            input.focus();
            if (caret !== null) {
                input.setSelectionRange(caret, caret);
            }
        }
    }

    function clearChatGlobalSearch() {
        const search = state.chatGlobalSearch;
        search.controller?.abort();
        Object.assign(search, {
            query: '',
            searchedQuery: '',
            loading: false,
            error: '',
            results: [],
            scannedFiles: 0,
            totalFiles: 0,
            partial: false,
            partialReason: '',
            elapsedMs: 0,
            token: (search.token || 0) + 1,
            controller: null,
        });
    }

    // 切到「全部」时，若还没有全部范围的关键词，沿用当前范围搜索框里的文字；不自动发起搜索（一次扫描最多 8 秒）
    function setChatSearchScope(scope) {
        const search = state.chatGlobalSearch;
        const nextScope = scope === 'all' ? 'all' : 'current';
        search.scope = nextScope;
        if (nextScope === 'all' && !search.query && state.chatSearch.query) {
            search.query = state.chatSearch.query;
        }
    }

    // 运行即切到「全部」范围；后发的搜索会让先发的失效（取消请求，晚到的响应按 token 丢弃）
    async function runChatGlobalSearch(rawQuery) {
        const search = state.chatGlobalSearch;
        const query = String(rawQuery ?? search.query ?? '').trim();
        search.controller?.abort();
        const token = (search.token || 0) + 1;
        search.scope = 'all';

        if (!query) {
            clearChatGlobalSearch();
            renderKeepingSearchFocus();
            return;
        }

        if (!isChatGlobalSearchQueryAllowed(query)) {
            Object.assign(search, {
                query,
                searchedQuery: '',
                loading: false,
                error: '请至少输入 2 个字符（中文、日文、韩文 1 个字也可以）。',
                results: [],
                token,
                controller: null,
            });
            renderKeepingSearchFocus();
            return;
        }

        const controller = new AbortController();
        Object.assign(search, { query, loading: true, error: '', token, controller });
        renderKeepingSearchFocus();

        try {
            const response = await apiFetch('/api/chats/search-all', {
                body: { query, limit: chatGlobalSearchLimit, snippetsPerChat: 3 },
                signal: controller.signal,
            });
            if (search.token !== token) {
                return;
            }

            const data = response && typeof response === 'object' ? response : {};
            Object.assign(search, {
                searchedQuery: query,
                loading: false,
                error: '',
                results: (Array.isArray(data.results) ? data.results : []).map(normalizeHit).filter(Boolean),
                scannedFiles: Number(data.scannedFiles) || 0,
                totalFiles: Number(data.totalFiles) || 0,
                partial: !!data.partial,
                partialReason: String(data.partialReason || ''),
                elapsedMs: Number(data.elapsedMs) || 0,
                controller: null,
            });
        } catch (error) {
            if (search.token !== token || error?.name === 'AbortError') {
                return;
            }

            Object.assign(search, { searchedQuery: '', loading: false, results: [], error: error.message || '搜索失败', controller: null });
            state.errors.push({ key: 'chat-global-search', message: error.message });
            showToast('全部聊天搜索失败', error.message);
        }

        if (search.token === token) {
            renderKeepingSearchFocus();
        }
    }

    return {
        clearChatGlobalSearch,
        runChatGlobalSearch,
        setChatSearchScope,
    };
}
