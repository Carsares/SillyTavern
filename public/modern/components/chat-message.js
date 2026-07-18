import { createChatMessageContentComponents } from './chat-message-content.js';

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
    const {
        renderMessageAttachments,
        renderMessageFoot,
        renderMessageReasoning,
        renderMessageText,
    } = createChatMessageContentComponents({
        escapeHtml,
        formatBytes,
        formatNumber,
    });

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
            ${renderStreamingBubble()}
        </div>
    `;
    }

    // 流式气泡：生成期间追加在消息列表末尾，onProgress 定点更新其 message-body；text 用于全量重渲染时的兜底恢复
    function renderStreamingBubble() {
        const streaming = state.engine.streaming;
        // 仅在气泡属于当前正查看的聊天时渲染，避免生成期切换聊天把上段生成泄漏到别的聊天视图。
        if (!streaming?.active || streaming.chatId !== state.selected.chat) {
            return '';
        }

        // 流式期间用纯文本预览（避免在 app 启动期把 lib.js/markdown 拉进核心导入图）；结束后由真实消息走完整 markdown 渲染。
        const body = streaming.text ? escapeHtml(String(streaming.text)) : '';
        return `
        <article class="message message-streaming" data-streaming-bubble>
            <div class="message-body">${body}</div>
        </article>
    `;
    }

    function renderMessage(message, messageIndex) {
        const name = message.name || (message.is_user ? 'You' : 'Character');
        const text = message.extra?.display_text || message.mes || '[空消息]';
        const model = message.extra?.model || message.extra?.api || '';
        const isEditing = state.chatEditing.key === getCurrentDraftKey() && state.chatEditing.index === messageIndex;
        const isDeleting = state.chatMessageDeleteConfirm.key === getCurrentDraftKey() && state.chatMessageDeleteConfirm.index === messageIndex;
        const canSwipe = !message.is_user && !message.is_system && messageIndex === getSelectedChatMessages().length - 1;
        const isOpeningMessage = messageIndex === 0 && !message.is_user && !message.is_system;

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
            ` : renderMessageBody(text, messageIndex, isOpeningMessage)}
            ${renderMessageReasoning(message)}
            ${renderMessageAttachments(message)}
            ${renderMessageFoot(message, model)}
            ${isDeleting ? renderMessageManagePanel(message, messageIndex) : ''}
        </article>
    `;
    }

    function renderMessageBody(text, messageIndex, isOpeningMessage) {
        if (!isOpeningMessage) {
            return `<div class="message-body">${renderMessageText(text)}</div>`;
        }

        const canExpand = text.length > 260;
        const toggleId = `opening-message-toggle-${messageIndex}`;
        return `
        <section class="message-opening">
            ${canExpand ? `<input class="visually-hidden message-opening-toggle" id="${toggleId}" type="checkbox" data-opening-message-toggle>` : ''}
            <div class="message-opening-header">
                <h3 class="message-opening-title">开场消息</h3>
                ${canExpand ? `
                    <label class="secondary-button message-opening-action" for="${toggleId}" data-toggle-opening-message>
                        <span class="message-opening-expand"><i class="fa-solid fa-chevron-down"></i> 展开</span>
                        <span class="message-opening-collapse"><i class="fa-solid fa-chevron-up"></i> 收起</span>
                    </label>
                ` : ''}
            </div>
            <div class="message-body">${renderMessageText(text)}</div>
        </section>
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
