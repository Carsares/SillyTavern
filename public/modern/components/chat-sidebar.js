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
}) {
    function renderUnreadBadge(count) {
        if (!count) {
            return '';
        }

        return `<span class="unread-badge" data-unread-count="${count}" aria-label="${formatNumber(count)} 条未读消息"><span class="dot danger"></span>${formatNumber(count)}</span>`;
    }

    function renderChatSidebar({
        resourceCount,
        resourceRows,
        selected,
        chats,
        searchSummary,
        isSearching,
        isLoadingChats,
    }) {
        return `
                <aside class="chat-browser">
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
                        <div class="panel-actions">
                            <button class="icon-button" type="button" data-refresh-chat-list title="刷新聊天列表" ${selected && !isLoadingChats ? '' : 'disabled'}>
                                <i class="fa-solid ${isLoadingChats ? 'fa-circle-notch fa-spin' : 'fa-rotate'}"></i>
                            </button>
                            <button class="icon-button" type="button" data-new-chat title="新聊天" ${selected ? '' : 'disabled'}>
                                <i class="fa-solid fa-plus"></i>
                            </button>
                        </div>
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
        const preview = chat.preview_message || '';

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
