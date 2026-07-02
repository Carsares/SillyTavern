export function createChatMessageComponents({
    state,
    escapeHtml,
    formatBytes,
    formatDate,
    formatNumber,
    getCurrentMessageLimit,
    getCurrentDraftKey,
    getSelectedChatMessages,
}) {
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
            ${isDeleting ? renderMessageManagePanel(message, messageIndex) : ''}
        </article>
    `;
    }

    function renderMessageManagePanel(message, messageIndex) {
        return `
        <div class="settings-form inline-form message-manage-panel message-delete-panel">
            <div>
                <strong>消息管理</strong>
                <p class="panel-subtitle">编辑或删除 ${escapeHtml(message.name || '当前消息')} 的这一条记录。</p>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-edit-message="${messageIndex}">
                    <i class="fa-solid fa-pen"></i>
                    编辑消息
                </button>
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

    return {
        renderMessageList,
    };
}
