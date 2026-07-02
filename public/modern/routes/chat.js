export function createChatRoute(ctx) {
    const {
        state,
        escapeHtml,
        formatBytes,
        formatDate,
        formatNumber,
        pageHead,
        renderCharacterRow,
        renderEmptyState,
        renderGroupRow,
        renderInlineEmpty,
        matchesQuery,
        isGroupChatMode,
        getChatModeLabel,
        getSelectedChatEntity,
        getChatContextKey,
        getChatEntityName,
        getChatEntityAvatarUrl,
        getChatEntityFallbackIcon,
        getChatEntityEmptyTitle,
        getChatEntityEmptyDescription,
        getChatEntityListEmptyText,
        getSelectedChatList,
        getChatId,
        getChatMessageCount,
        getVisibleChatList,
        getSelectedChatMessages,
        getCurrentMessageLimit,
        getChatCacheKey,
        getCurrentDraftKey,
        getCurrentDraft,
        render,
        showToast,
        clearChatSearch,
        prepareChatForSelectedContext,
        loadChatMessages,
        searchSelectedChats,
        increaseCurrentMessageLimit,
        toggleChatBackups,
        loadChatBackups,
        exportModernChat,
        viewChatBackup,
        restoreChatBackup,
        beginChatBackupDelete,
        cancelChatBackupDelete,
        confirmChatBackupDelete,
        sendModernMessage,
        stopModernGeneration,
        checkLegacyGenerationEngine,
        regenerateModernReply,
        continueModernReply,
        swipeModernMessage,
        copyModernMessage,
        beginModernMessageDelete,
        cancelModernMessageDelete,
        confirmModernMessageDelete,
        beginModernMessageEdit,
        cancelModernMessageEdit,
        saveModernMessageEdit,
        startNewModernChat,
        beginModernChatRename,
        cancelModernChatRename,
        saveModernChatRename,
        beginModernChatDelete,
        cancelModernChatDelete,
        confirmModernChatDelete,
        setCurrentDraft,
        importModernChatFiles,
    } = ctx;

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
                    <button class="secondary-button" type="button" data-delete-chat>
                        <i class="fa-solid fa-ellipsis"></i>
                        管理
                    </button>
                </div>
            ` : ''}
        </div>
        ${renderGenerationEnginePanel(entity, selectedChat)}
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

    function renderGenerationEnginePanel(entity, selectedChat) {
        const engine = state.engine;
        const isBusy = engine.generating || engine.checking;
        const statusClass = engine.error ? 'danger' : (engine.ready ? 'success' : '');

        return `
        <div class="settings-form inline-form engine-panel">
            <div>
                <strong>生成引擎</strong>
                <p class="panel-subtitle">${escapeHtml(engine.detail || '生成引擎会在首次发送时自动加载。')}</p>
                ${engine.error ? `<p class="danger">${escapeHtml(engine.error)}</p>` : ''}
            </div>
            <div class="message-edit-actions">
                <span class="badge ${statusClass}">${escapeHtml(engine.status)}</span>
                <button class="secondary-button" type="button" data-check-generation-engine ${isBusy || !entity ? 'disabled' : ''}>
                    <i class="fa-solid ${engine.checking ? 'fa-circle-notch fa-spin' : 'fa-plug-circle-check'}"></i>
                    ${engine.checking ? '检查中' : (selectedChat ? '检查引擎' : '预热引擎')}
                </button>
            </div>
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
                    <button class="secondary-button" type="button" data-delete-chat-backup="${escapeHtml(name)}" ${isBusy ? 'disabled' : ''}>
                        <i class="fa-solid fa-ellipsis"></i>
                        管理
                    </button>
                `}
            </div>
        </article>
    `;
    }

    function renderMessageList(messages) {
        const limit = getCurrentMessageLimit();
        const startIndex = Math.max(messages.length - limit, 0);
        const hiddenCount = startIndex;

        return `
        <div class="message-list">
            ${hiddenCount ? `
                <button class="secondary-button load-earlier-button" type="button" data-load-earlier-messages>
                    <i class="fa-solid fa-clock-rotate-left"></i>
                    加载更早消息 ${formatNumber(hiddenCount)}
                </button>
            ` : ''}
            ${messages.slice(startIndex).map((message, index) => renderMessage(message, startIndex + index)).join('')}
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
        const isDeleting = state.chatMessageDeleteConfirm.key === getCurrentDraftKey() && state.chatMessageDeleteConfirm.index === messageIndex;
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
                    <button class="icon-button mini" type="button" data-delete-message="${messageIndex}" title="管理消息" ${isDeleting ? 'disabled' : ''}>
                        <i class="fa-solid fa-ellipsis"></i>
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
            ${isDeleting ? renderMessageDeletePanel(message) : ''}
        </article>
    `;
    }

    function renderMessageDeletePanel(message) {
        return `
        <div class="settings-form inline-form danger-panel message-delete-panel">
            <div>
                <strong>删除消息</strong>
                <p class="panel-subtitle">将删除 ${escapeHtml(message.name || '当前消息')} 的这一条记录。</p>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-message-delete>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button danger-action" type="button" data-confirm-message-delete>
                    <i class="fa-solid fa-trash"></i>
                    确认删除
                </button>
            </div>
        </div>
    `;
    }

    async function handleClick(event) {
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
            return true;
        }

        const chatButton = event.target.closest('[data-select-chat]');
        if (chatButton) {
            state.selected.chat = chatButton.dataset.selectChat;
            await loadChatMessages(getSelectedChatEntity(), state.selected.chat);
            render();
            return true;
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
            return true;
        }

        if (event.target.closest('[data-chat-search-clear]')) {
            clearChatSearch();
            render();
            return true;
        }

        if (event.target.closest('[data-load-earlier-messages]')) {
            increaseCurrentMessageLimit();
            return true;
        }

        if (event.target.closest('[data-chat-backups-toggle]')) {
            try {
                await toggleChatBackups();
            } catch (error) {
                state.errors.push({ key: 'chat-backups', message: error.message });
                showToast('备份读取失败', error.message);
                render();
            }
            return true;
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
            return true;
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
            return true;
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
            return true;
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
            return true;
        }

        const deleteChatBackupButton = event.target.closest('[data-delete-chat-backup]');
        if (deleteChatBackupButton) {
            beginChatBackupDelete(deleteChatBackupButton.dataset.deleteChatBackup);
            return true;
        }

        if (event.target.closest('[data-cancel-chat-backup-delete]')) {
            cancelChatBackupDelete();
            return true;
        }

        if (event.target.closest('[data-confirm-chat-backup-delete]')) {
            try {
                await confirmChatBackupDelete();
            } catch (error) {
                state.errors.push({ key: 'chat-backup-delete', message: error.message });
                showToast('备份删除失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-send-message]')) {
            try {
                await sendModernMessage();
            } catch (error) {
                state.errors.push({ key: 'modern-send', message: error.message });
                showToast('发送失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-stop-generation]')) {
            await stopModernGeneration();
            return true;
        }

        if (event.target.closest('[data-check-generation-engine]')) {
            try {
                await checkLegacyGenerationEngine();
            } catch (error) {
                state.errors.push({ key: 'legacy-engine-check', message: error.message });
                showToast('生成引擎检查失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-regenerate-message]')) {
            try {
                await regenerateModernReply();
            } catch (error) {
                state.errors.push({ key: 'regenerate', message: error.message });
                showToast('重生成失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-continue-message]')) {
            try {
                await continueModernReply();
            } catch (error) {
                state.errors.push({ key: 'continue-message', message: error.message });
                showToast('继续生成失败', error.message);
                render();
            }
            return true;
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
            return true;
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
            return true;
        }

        const deleteMessageButton = event.target.closest('[data-delete-message]');
        if (deleteMessageButton) {
            beginModernMessageDelete(deleteMessageButton.dataset.deleteMessage);
            return true;
        }

        if (event.target.closest('[data-cancel-message-delete]')) {
            cancelModernMessageDelete();
            return true;
        }

        if (event.target.closest('[data-confirm-message-delete]')) {
            try {
                await confirmModernMessageDelete();
            } catch (error) {
                state.errors.push({ key: 'delete-message', message: error.message });
                showToast('删除消息失败', error.message);
                render();
            }
            return true;
        }

        const editMessageButton = event.target.closest('[data-edit-message]');
        if (editMessageButton) {
            beginModernMessageEdit(editMessageButton.dataset.editMessage);
            return true;
        }

        if (event.target.closest('[data-cancel-edit-message]')) {
            cancelModernMessageEdit();
            return true;
        }

        if (event.target.closest('[data-save-edit-message]')) {
            try {
                await saveModernMessageEdit();
            } catch (error) {
                state.errors.push({ key: 'edit-message', message: error.message });
                showToast('保存消息失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-new-chat]')) {
            try {
                await startNewModernChat();
            } catch (error) {
                state.errors.push({ key: 'new-chat', message: error.message });
                showToast('新聊天创建失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-rename-chat]')) {
            beginModernChatRename();
            return true;
        }

        if (event.target.closest('[data-cancel-chat-rename]')) {
            cancelModernChatRename();
            return true;
        }

        if (event.target.closest('[data-save-chat-rename]')) {
            try {
                await saveModernChatRename();
            } catch (error) {
                state.errors.push({ key: 'rename-chat', message: error.message });
                showToast('聊天重命名失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-delete-chat]')) {
            beginModernChatDelete();
            return true;
        }

        if (event.target.closest('[data-cancel-chat-delete]')) {
            cancelModernChatDelete();
            return true;
        }

        if (event.target.closest('[data-confirm-chat-delete]')) {
            try {
                await confirmModernChatDelete();
            } catch (error) {
                state.errors.push({ key: 'delete-chat', message: error.message });
                showToast('聊天删除失败', error.message);
                render();
            }
            return true;
        }

        return false;
    }

    function handleInput(event) {
        if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-chat-input]')) {
            setCurrentDraft(event.target.value);
            return true;
        }
        if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-edit-message-input]')) {
            state.chatEditing.text = event.target.value;
            return true;
        }
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-chat-rename-input]')) {
            state.chatRenaming.name = event.target.value;
            return true;
        }
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-chat-search-input]')) {
            state.chatSearch.query = event.target.value;
            return true;
        }

        return false;
    }

    async function handleChange(event) {
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
            return true;
        }

        return false;
    }

    function handleKeydown(event) {
        if (event.target instanceof HTMLElement && event.target.matches('[data-chat-input]') && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            sendModernMessage().catch(error => {
                state.errors.push({ key: 'modern-send', message: error.message });
                showToast('发送失败', error.message);
                render();
            });
            return true;
        }

        if (event.target instanceof HTMLElement && event.target.matches('[data-chat-search-input]') && event.key === 'Enter') {
            event.preventDefault();
            if (!state.chatSearch.query.trim()) {
                clearChatSearch();
                render();
                return true;
            }
            searchSelectedChats().then(() => render()).catch(error => {
                state.errors.push({ key: 'chat-search', message: error.message });
                showToast('聊天搜索失败', error.message);
                render();
            });
            return true;
        }

        return false;
    }

    return {
        render: renderChat,
        handleClick,
        handleInput,
        handleChange,
        handleKeydown,
    };
}
