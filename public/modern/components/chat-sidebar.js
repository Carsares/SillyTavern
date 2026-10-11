import { createChatGlobalSearchComponents } from './chat-global-search.js';

// The backend's chat summary (getChatInfo in src/endpoints/chats.js) fills an empty last message with this
// English placeholder; message bubbles say [空消息], so search-result previews use the same wording.
const backendEmptyMessagePlaceholder = '[The message is empty]';

export function createChatSidebarComponents({
    state,
    escapeHtml,
    formatDate,
    formatNumber,
    renderInlineEmpty,
    renderRouteFilter,
    getChatModeLabel,
    getChatEntityListEmptyText,
    getChatId,
    getChatMessageCount,
    getChatUnreadCount,
    getCharacterAvatarUrl,
    getGroupAvatarUrl,
}) {
    const { getChatGlobalSearchSummary, renderChatGlobalSearchResults, renderChatSearchScopeSwitch } = createChatGlobalSearchComponents({
        state,
        escapeHtml,
        formatDate,
        formatNumber,
        renderInlineEmpty,
        getCharacterAvatarUrl,
        getGroupAvatarUrl,
    });

    function getChatPreviewText(chat) {
        const preview = String(chat?.preview_message || '');
        return preview.trim() === backendEmptyMessagePlaceholder ? '[空消息]' : preview;
    }

    function renderUnreadBadge(count) {
        if (!count) {
            return '';
        }

        return `<span class="unread-badge" data-unread-count="${count}" aria-label="${formatNumber(count)} 条未读消息"><span class="dot danger"></span>${formatNumber(count)}</span>`;
    }

    // data-chat-entity-list / data-chat-file-list identify the two lists for routes/chat-scroll.js, which keeps
    // their scroll position across re-renders and route switches; the values tell which list content is shown.
    function renderChatSidebar({
        resourceCount,
        resourceRows,
        selected,
        contextKey,
        chats,
        searchSummary,
        isSearching,
        isLoadingChats,
    }) {
        const globalSearch = state.chatGlobalSearch;
        const allScope = globalSearch.scope === 'all';
        const searchQuery = allScope ? globalSearch.query : state.chatSearch.query;
        const searchBusy = allScope ? globalSearch.loading : isSearching;
        const canRunSearch = allScope ? !globalSearch.loading : (selected && !isSearching);
        const canClearSearch = allScope
            ? !!(globalSearch.query || globalSearch.searchedQuery || globalSearch.error)
            : !!(state.chatSearch.query || state.chatSearch.searchedQuery);
        const searchPlaceholder = allScope ? '在所有角色和群聊中搜索消息内容' : '搜索文件名和消息内容';

        return `
                <aside class="chat-browser ${allScope ? 'chat-browser-global' : ''}">
                <section class="panel chat-browser-panel">
                    <div class="panel-header">
                        <div>
                            <h2 class="panel-title">${getChatModeLabel()}</h2>
                            <p class="panel-subtitle">${formatNumber(resourceCount)} 个匹配项</p>
                        </div>
                        ${renderRouteFilter(isGroupMode() ? '筛选群聊' : '筛选角色', isGroupMode() ? '群组名称、ID 或成员文件名' : '角色名称、文件名或作者')}
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
                    <div class="resource-list" data-chat-entity-list="${escapeHtml(state.chatMode)}">
                        ${resourceRows}
                    </div>
                </section>
                <section class="panel chat-browser-panel">
                    <div class="panel-header">
                        <div>
                            <h2 class="panel-title">${allScope ? '全部聊天' : '聊天文件'}</h2>
                            <p class="panel-subtitle">${escapeHtml(allScope ? getChatGlobalSearchSummary() : searchSummary)}</p>
                        </div>
                        <div class="panel-actions">
                            <button class="icon-button" type="button" data-refresh-chat-list title="刷新聊天列表" ${selected && !isLoadingChats ? '' : 'disabled'}>
                                <i class="fa-solid ${isLoadingChats ? 'fa-circle-notch fa-spin' : 'fa-rotate'}"></i>
                            </button>
                            <button class="icon-button" type="button" data-new-chat title="新聊天" ${selected ? '' : 'disabled'}>
                                <i class="fa-solid fa-plus"></i>
                            </button>
                        </div>
                    </div>
                    <div class="chat-search-block">
                        ${renderChatSearchScopeSwitch(getChatModeLabel())}
                        <div class="chat-search-row" data-chat-search-scope-active="${allScope ? 'all' : 'current'}">
                            <input class="text-input" type="search" data-chat-search-input value="${escapeHtml(searchQuery)}" placeholder="${searchPlaceholder}">
                            <button class="icon-button" type="button" data-chat-search-run title="${allScope ? '搜索全部聊天' : '搜索聊天'}" ${canRunSearch ? '' : 'disabled'}>
                                <i class="fa-solid ${searchBusy ? 'fa-circle-notch fa-spin' : 'fa-magnifying-glass'}"></i>
                            </button>
                            <button class="icon-button" type="button" data-chat-search-clear title="清空搜索" ${canClearSearch ? '' : 'disabled'}>
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    </div>
                    ${allScope ? `
                    <div class="resource-list chat-global-results" data-chat-file-list="global-search">
                        ${renderChatGlobalSearchResults()}
                    </div>` : `
                    <div class="resource-list" data-chat-file-list="${escapeHtml(contextKey || '')}">
                        ${chats.map(chat => renderChatFileRow(chat)).join('') || renderInlineEmpty(selected ? `这个${getChatModeLabel()}暂无聊天文件` : `先选择一个${getChatModeLabel()}`)}
                    </div>`}
                </section>
            </aside>
    `;
    }

    function renderChatFileRow(chat) {
        const chatId = getChatId(chat);
        const messageCount = getChatMessageCount(chat);
        const unreadCount = getChatUnreadCount(chat);
        const subtitle = [
            `${formatNumber(messageCount)} 条消息`,
            chat.file_size || '',
            formatDate(chat.last_mes),
        ].filter(Boolean).join(' · ');
        const preview = getChatPreviewText(chat);

        return `
        <button class="resource-row ${state.selected.chat === chatId ? 'active' : ''} ${unreadCount ? 'unread' : ''}" type="button" data-select-chat="${escapeHtml(chatId)}">
            <span class="avatar-fallback"><i class="fa-solid fa-message"></i></span>
            <span class="row-main">
                <span class="row-title">${escapeHtml(chat.file_name || chatId)}</span>
                <span class="row-subtitle">${escapeHtml(subtitle)}</span>
                ${preview ? `<span class="row-subtitle chat-preview">${escapeHtml(preview)}</span>` : ''}
            </span>
            ${renderUnreadBadge(unreadCount)}
        </button>
    `;
    }

    function isGroupMode() {
        return state.chatMode === 'group';
    }

    return {
        renderChatSidebar,
    };
}
