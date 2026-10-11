import { chatGlobalSearchLimit, groupChatGlobalSearchResults, renderHighlightedSnippet } from '../actions/chat-global-search.js';

// 聊天侧栏里「全部聊天」范围的界面：范围开关、文件列表面板的结果分组、扫描情况与「结果不完整」提示。
// 数据全部来自 state.chatGlobalSearch（actions/chat-global-search.js）；结果行是 data-route="chat" 的按钮，
// 由 shell/router.js 的 data-open-character-chat / data-open-group-chat + data-open-chat-file 打开对应会话。
export function createChatGlobalSearchComponents({
    state,
    escapeHtml,
    formatDate,
    formatNumber,
    renderInlineEmpty,
    getCharacterAvatarUrl,
    getGroupAvatarUrl,
}) {
    function isAllScope() {
        return state.chatGlobalSearch.scope === 'all';
    }

    function renderChatSearchScopeSwitch(entityLabel) {
        const all = isAllScope();
        return `
                    <div class="segmented-control chat-search-scope" role="tablist" aria-label="搜索范围">
                        <button class="${all ? '' : 'active'}" type="button" data-chat-search-scope="current" aria-selected="${!all}" title="只搜索当前${escapeHtml(entityLabel)}的聊天">当前</button>
                        <button class="${all ? 'active' : ''}" type="button" data-chat-search-scope="all" aria-selected="${all}" title="搜索所有角色和群聊的聊天内容">全部</button>
                    </div>`;
    }

    function formatElapsed(elapsedMs) {
        return elapsedMs >= 1000 ? `${(elapsedMs / 1000).toFixed(1)} 秒` : `${formatNumber(elapsedMs)} 毫秒`;
    }

    // 面板副标题保持很短（右边还要放刷新和新建按钮）；扫描了多少文件、用时多久放在结果列表顶部的 renderScanSummary
    function getChatGlobalSearchSummary() {
        const search = state.chatGlobalSearch;
        if (search.loading) {
            return '正在扫描…';
        }
        if (search.error) {
            return '搜索失败';
        }
        if (!search.searchedQuery) {
            return '搜索所有角色和群聊';
        }

        return `${formatNumber(search.results.length)} 个会话`;
    }

    function renderScanSummary() {
        const search = state.chatGlobalSearch;
        const scanned = search.partial
            ? `已扫描 ${formatNumber(search.scannedFiles)} / ${formatNumber(search.totalFiles)} 个聊天文件`
            : `已扫描 ${formatNumber(search.totalFiles)} 个聊天文件`;
        return `<div class="chat-global-summary" data-chat-global-summary>${escapeHtml(`${scanned} · 用时 ${formatElapsed(search.elapsedMs)}`)}</div>`;
    }

    function renderPartialNotice() {
        const search = state.chatGlobalSearch;
        if (!search.partial) {
            return '';
        }

        const reason = search.partialReason === 'limit'
            ? `已达到 ${formatNumber(chatGlobalSearchLimit)} 个会话的显示上限，更早的聊天里可能还有命中。可以多输入几个关键词缩小范围。`
            : `搜索超时，只扫描了 ${formatNumber(search.scannedFiles)} / ${formatNumber(search.totalFiles)} 个聊天文件。可以多输入几个关键词缩小范围后重试。`;
        return `
            <div class="chat-global-notice" role="status" data-chat-global-partial>
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span><strong>结果不完整</strong>${escapeHtml(reason)}</span>
            </div>`;
    }

    function resolveEntity(group) {
        if (group.kind === 'group') {
            const known = state.groups.find(item => item.id === group.groupId);
            const avatarUrl = known ? getGroupAvatarUrl(known) : '';
            return {
                name: known?.name || group.entityName || group.groupId,
                avatarHtml: avatarUrl ? `<img class="avatar" src="${escapeHtml(avatarUrl)}" alt="">` : '<span class="avatar-fallback"><i class="fa-solid fa-users"></i></span>',
            };
        }

        const known = state.characters.find(item => item.avatar === group.avatar);
        const avatarUrl = known ? getCharacterAvatarUrl(known) : '';
        return {
            name: known?.name || known?.data?.name || group.entityName || group.avatar,
            avatarHtml: avatarUrl ? `<img class="avatar" src="${escapeHtml(avatarUrl)}" alt="">` : '<span class="avatar-fallback">C</span>',
        };
    }

    function isOpenedHit(hit) {
        if (state.selected.chat !== hit.file_id) {
            return false;
        }

        return hit.kind === 'group'
            ? state.chatMode === 'group' && state.selected.group === hit.groupId
            : state.chatMode === 'character' && state.selected.character === hit.avatar;
    }

    function renderSnippet(snippet) {
        const speaker = snippet.name || (snippet.is_user ? '用户' : '角色');
        return `<span class="chat-global-snippet"><span class="chat-global-snippet-name">${escapeHtml(speaker)}</span>${renderHighlightedSnippet(snippet.text, snippet.highlights)}</span>`;
    }

    function renderHit(hit) {
        const subtitle = [
            hit.matchCount > 0 ? `命中 ${formatNumber(hit.matchCount)} 条消息` : '文件名匹配',
            `${formatNumber(hit.message_count)} 条消息`,
            hit.file_size || '',
            formatDate(hit.last_mes),
        ].filter(Boolean).join(' · ');
        const entityAttribute = hit.kind === 'group'
            ? `data-open-group-chat="${escapeHtml(hit.groupId)}"`
            : `data-open-character-chat="${escapeHtml(hit.avatar)}"`;
        const hiddenSnippetCount = hit.matchCount - hit.snippets.length;

        return `
            <button class="resource-row chat-global-hit ${isOpenedHit(hit) ? 'active' : ''}" type="button" data-route="chat" ${entityAttribute} data-open-chat-file="${escapeHtml(hit.file_id)}" data-chat-global-hit title="${escapeHtml(hit.file_name || hit.file_id)}">
                <span class="avatar-fallback"><i class="fa-solid fa-message"></i></span>
                <span class="row-main">
                    <span class="row-title">${escapeHtml(hit.file_id)}</span>
                    <span class="row-subtitle">${escapeHtml(subtitle)}</span>
                    ${hit.snippets.map(snippet => renderSnippet(snippet)).join('')}
                    ${hiddenSnippetCount > 0 ? `<span class="row-subtitle chat-global-more">还有 ${formatNumber(hiddenSnippetCount)} 条命中消息</span>` : ''}
                </span>
            </button>`;
    }

    function renderGroup(group) {
        const entity = resolveEntity(group);
        return `
            <section class="chat-global-group" data-chat-global-entity="${escapeHtml(group.key)}">
                <header class="chat-global-group-title">
                    ${entity.avatarHtml}
                    <span class="row-title">${escapeHtml(entity.name)}</span>
                    <span class="row-subtitle">${formatNumber(group.hits.length)} 个会话</span>
                </header>
                ${group.hits.map(hit => renderHit(hit)).join('')}
            </section>`;
    }

    function renderChatGlobalSearchResults() {
        const search = state.chatGlobalSearch;
        if (search.loading) {
            return '<div class="chat-global-status" role="status"><i class="fa-solid fa-circle-notch fa-spin"></i><span>正在扫描全部聊天文件…</span></div>';
        }
        if (search.error) {
            return `<div class="chat-global-notice is-error" role="alert"><i class="fa-solid fa-circle-exclamation"></i><span>${escapeHtml(search.error)}</span></div>`;
        }
        if (!search.searchedQuery) {
            return renderInlineEmpty('输入关键词，按 Enter 搜索所有角色和群聊的聊天内容。');
        }
        if (!search.results.length) {
            return `${renderScanSummary()}${renderPartialNotice()}${renderInlineEmpty(`没有找到包含“${search.searchedQuery}”的聊天`)}`;
        }

        return `${renderScanSummary()}${renderPartialNotice()}${groupChatGlobalSearchResults(search.results).map(group => renderGroup(group)).join('')}`;
    }

    return {
        getChatGlobalSearchSummary,
        renderChatGlobalSearchResults,
        renderChatSearchScopeSwitch,
    };
}
