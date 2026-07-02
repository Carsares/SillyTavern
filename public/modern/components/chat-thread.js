import { createChatComposerComponents } from './chat-composer.js';
import { createChatMessageComponents } from './chat-message.js';

export function createChatThreadComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatDate,
        formatNumber,
        renderEmptyState,
        isGroupChatMode,
        getChatModeLabel,
        getChatEntityAvatarUrl,
        getChatEntityName,
        getChatContextKey,
        getChatEntityFallbackIcon,
        getSelectedChatList,
        getChatId,
        getVisibleChatList,
        getSelectedChatMessages,
        getChatCacheKey,
    } = ctx;
    const { renderChatComposer } = createChatComposerComponents(ctx);
    const { renderMessageList } = createChatMessageComponents(ctx);

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
                    <button class="secondary-button" type="button" data-delete-chat ${isDeleting ? 'disabled' : ''}>
                        <i class="fa-solid fa-ellipsis"></i>
                        管理聊天
                    </button>
                </div>
            ` : ''}
        </div>
        ${renderGenerationEnginePanel(entity, selectedChat)}
        ${isRenaming ? renderChatRenamePanel() : ''}
        ${isDeleting ? renderChatManagePanel() : ''}
        ${messages.length ? renderMessageList(messages) : renderEmptyState('fa-comments', chats.length ? '聊天文件为空' : '暂无聊天记录', chats.length ? '这个聊天文件没有可显示消息。' : '历史消息会在这里显示。')}
        ${renderChatComposer(messages)}
    `;
    }

    function renderGenerationEnginePanel(entity, selectedChat) {
        const engine = state.engine;
        const isBusy = engine.generating || engine.checking;
        const statusClass = engine.error ? 'danger' : (engine.ready ? 'success' : '');

        return `
        <section class="engine-panel">
            <div class="engine-panel-main">
                <strong>生成引擎</strong>
                <p class="panel-subtitle">${escapeHtml(engine.detail || '生成引擎会在首次发送时自动加载。')}</p>
                ${engine.error ? `<p class="danger">${escapeHtml(engine.error)}</p>` : ''}
            </div>
            <div class="engine-panel-actions">
                <span class="badge ${statusClass}">${escapeHtml(engine.status)}</span>
                <button class="secondary-button" type="button" data-check-generation-engine ${isBusy || !entity ? 'disabled' : ''}>
                    <i class="fa-solid ${engine.checking ? 'fa-circle-notch fa-spin' : 'fa-plug-circle-check'}"></i>
                    ${engine.checking ? '检查中' : (selectedChat ? '检查引擎' : '预热引擎')}
                </button>
            </div>
        </section>
    `;
    }

    function renderChatManagePanel() {
        return `
        <div class="settings-form inline-form chat-manage-panel">
            <div>
                <strong>聊天文件管理</strong>
                <p class="panel-subtitle">导出、重命名，或删除 ${escapeHtml(state.chatDeleteConfirm.name)}.jsonl。</p>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-export-chat="txt">
                    <i class="fa-solid fa-file-lines"></i>
                    导出 TXT
                </button>
                <button class="secondary-button" type="button" data-export-chat="jsonl">
                    <i class="fa-solid fa-file-code"></i>
                    导出 JSONL
                </button>
                <button class="secondary-button" type="button" data-rename-chat>
                    <i class="fa-solid fa-pen-to-square"></i>
                    重命名
                </button>
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

    return {
        renderChatThread,
    };
}
