import { createChatBackupComponents } from './chat-backups.js';
import { createChatSidebarComponents } from './chat-sidebar.js';
import { createChatThreadComponents } from './chat-thread.js';

export function createChatLayoutComponents(ctx) {
    const {
        state,
        formatNumber,
        pageHead,
        renderCharacterRow,
        renderEmptyState,
        renderGroupRow,
        renderInlineEmpty,
        matchesQuery,
        isGroupChatMode,
        getSelectedChatEntity,
        getChatContextKey,
        getChatEntityEmptyTitle,
        getChatEntityEmptyDescription,
        getChatEntityListEmptyText,
        getSelectedChatList,
        getVisibleChatList,
    } = ctx;
    const { renderChatBackupsPanel } = createChatBackupComponents(ctx);
    const { renderChatSidebar } = createChatSidebarComponents(ctx);
    const { renderChatThread } = createChatThreadComponents(ctx);

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
        `)}
        <div class="chat-layout ${state.chatSidebarOpen ? '' : 'chat-sidebar-collapsed'}">
            ${state.chatSidebarOpen ? '<button class="chat-sidebar-scrim" type="button" data-toggle-chat-sidebar aria-label="关闭聊天列表"></button>' : ''}
            ${state.chatSidebarOpen ? renderChatSidebar({
        resourceCount,
        resourceRows,
        selected,
        chats,
        searchSummary,
        isSearching,
    }) : ''}
            <section class="panel chat-thread">
                ${selected ? renderChatThread(selected, { compactContext: !state.chatSidebarOpen, chatCount: allChats.length }) : renderEmptyState(isGroupChatMode() ? 'fa-users' : 'fa-address-card', getChatEntityEmptyTitle(), getChatEntityEmptyDescription())}
            </section>
        </div>
        ${state.chatBackups.open ? `
            <button class="chat-tools-scrim" type="button" data-chat-backups-toggle aria-label="关闭聊天备份"></button>
            <aside class="chat-tools-drawer" aria-label="聊天备份">
                ${renderChatBackupsPanel()}
            </aside>
        ` : ''}
    `;
    }

    return {
        renderChat,
    };
}
