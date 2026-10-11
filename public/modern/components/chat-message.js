import { MODERN_MESSAGE_SOURCE } from '../actions/chat-context-selectors.js';
import { canOfferAlternateGreetings, canSwitchGreetingLocally, clampSwipeId, countAlternateGreetings } from '../actions/chat-greetings.js';
import { createChatMessageContentComponents } from './chat-message-content.js';

// extra.api values that mark where a message came from rather than which API produced it: greetings the
// Modern UI writes and messages inserted by slash commands (/sendas, /sys ...). They are not shown as a label.
const internalMessageSources = new Set([MODERN_MESSAGE_SOURCE, 'manual']);

// Label under a message: the model name when recorded, otherwise the API name unless it is an internal marker.
function getMessageSourceLabel(extra) {
    const model = String(extra?.model || '').trim();
    if (model) {
        return model;
    }
    const api = String(extra?.api || '').trim();
    return internalMessageSources.has(api) ? '' : api;
}

export function createChatMessageComponents({
    state,
    escapeHtml,
    formatBytes,
    formatDate,
    formatNumber,
    getCurrentMessageLimit,
    getCurrentDraftKey,
    getSelectedChatEntity,
    getSelectedChatMessages,
    isGroupChatMode,
}) {
    const {
        renderEmptyReplyHint,
        renderMessageAttachments,
        renderMessageFoot,
        renderMessageReasoning,
        renderMessageText,
    } = createChatMessageContentComponents({
        state,
        escapeHtml,
        formatBytes,
        formatNumber,
    });

    function renderMessageList(messages) {
        const limit = getCurrentMessageLimit();
        const startIndex = Math.max(messages.length - limit, 0);
        const hiddenCount = startIndex;

        // data-chat-key / data-first-index let the chat route tell a chat switch or a "load earlier"
        // prepend apart from an in-place update when it restores the scroll position after render.
        return `
        <div class="message-list-frame">
            <div class="message-list" data-message-list data-chat-key="${escapeHtml(getCurrentDraftKey())}" data-first-index="${startIndex}">
                ${hiddenCount ? `
                    <button class="secondary-button load-earlier-button" type="button" data-load-earlier-messages>
                        <i class="fa-solid fa-clock-rotate-left"></i>
                        加载更早消息 ${formatNumber(hiddenCount)}
                    </button>
                ` : ''}
                ${messages.slice(startIndex).map((message, index) => renderMessage(message, startIndex + index)).join('')}
                ${renderStreamingBubble()}
            </div>
            <button class="secondary-button compact-button message-jump-latest" type="button" data-scroll-to-latest hidden>
                <i class="fa-solid fa-arrow-down"></i>
                最新消息
            </button>
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
        const rawText = message.extra?.display_text || message.mes || '';
        const text = rawText || '[空消息]';
        const model = getMessageSourceLabel(message.extra);
        const isEditing = state.chatEditing.key === getCurrentDraftKey() && state.chatEditing.index === messageIndex;
        const isDeleting = state.chatMessageDeleteConfirm.key === getCurrentDraftKey() && state.chatMessageDeleteConfirm.index === messageIndex;
        const chatMessages = getSelectedChatMessages();
        const canSwipe = !message.is_user && !message.is_system && messageIndex === chatMessages.length - 1;
        const isOpeningMessage = messageIndex === 0 && !message.is_user && !message.is_system;
        const chatMetadata = state.chatMetadata?.[getCurrentDraftKey()];
        // 开场消息有多个候选时显示「开场白 i/N」；聊天里只有开场白、没对话过时，左右按钮切的就是开场白（本地切换，不调用引擎）
        const greetingCount = isOpeningMessage && Array.isArray(message.swipes) ? message.swipes.length : 0;
        const greetingCounter = greetingCount > 1 ? `开场白 ${clampSwipeId(message.swipe_id, greetingCount) + 1}/${greetingCount}` : '';
        const swipeNoun = isOpeningMessage && canSwitchGreetingLocally(chatMessages, chatMetadata) ? '开场白' : '候选';
        const loadAlternatesTarget = isOpeningMessage && canOfferAlternateGreetings({
            entity: getSelectedChatEntity(),
            groupMode: isGroupChatMode(),
            messages: chatMessages,
            metadata: chatMetadata,
        }) ? getSelectedChatEntity() : null;

        return `
        <article class="message ${message.is_user ? 'user' : ''}">
            <header class="message-meta">
                <strong>${escapeHtml(name)}</strong>
                <span class="message-actions">
                    <span>${escapeHtml(formatDate(message.send_date))}</span>
                    ${canSwipe ? `
                        <button class="icon-button mini" type="button" data-swipe-message="${messageIndex}" data-swipe-direction="left" title="上一个${swipeNoun}" aria-label="上一个${swipeNoun}">
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                        <button class="icon-button mini" type="button" data-swipe-message="${messageIndex}" data-swipe-direction="right" title="下一个${swipeNoun}" aria-label="下一个${swipeNoun}">
                            <i class="fa-solid fa-chevron-right"></i>
                        </button>
                    ` : ''}
                    <button class="icon-button mini" type="button" data-copy-message="${messageIndex}" title="复制消息">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                    <button class="icon-button mini" type="button" data-delete-message="${messageIndex}" title="编辑或删除消息" aria-label="编辑或删除消息" ${isDeleting ? 'disabled' : ''}>
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
            ` : renderMessageBody(text, messageIndex, isOpeningMessage, { counter: greetingCounter, alternatesTarget: loadAlternatesTarget })}
            ${isEditing ? '' : renderEmptyReplyHint(message, rawText)}
            ${renderMessageReasoning(message)}
            ${renderMessageAttachments(message)}
            ${renderMessageFoot(message, model, { hideSwipeCount: !!greetingCounter && !isEditing })}
            ${isDeleting ? renderMessageManagePanel(message, messageIndex) : ''}
        </article>
    `;
    }

    function renderMessageBody(text, messageIndex, isOpeningMessage, { counter = '', alternatesTarget = null } = {}) {
        if (!isOpeningMessage) {
            return `<div class="message-body">${renderMessageText(text)}</div>`;
        }

        const canExpand = text.length > 260;
        const toggleId = `opening-message-toggle-${messageIndex}`;
        return `
        <section class="message-opening">
            ${canExpand ? `<input class="visually-hidden message-opening-toggle" id="${toggleId}" type="checkbox" data-opening-message-toggle>` : ''}
            <div class="message-opening-header">
                <div class="message-opening-heading">
                    <h3 class="message-opening-title">开场消息</h3>
                    ${counter ? `<span class="message-opening-counter" data-greeting-counter>${escapeHtml(counter)}</span>` : ''}
                </div>
                ${canExpand ? `
                    <label class="secondary-button message-opening-action" for="${toggleId}" data-toggle-opening-message>
                        <span class="message-opening-expand"><i class="fa-solid fa-chevron-down"></i> 展开</span>
                        <span class="message-opening-collapse"><i class="fa-solid fa-chevron-up"></i> 收起</span>
                    </label>
                ` : ''}
            </div>
            <div class="message-body">${renderMessageText(text)}</div>
            ${alternatesTarget ? `
                <div class="message-opening-alternates">
                    <button class="secondary-button compact-button" type="button" data-load-alternate-greetings ${state.engine.generating ? 'disabled' : ''} title="把角色卡上的备用开场白加进这条开场消息，之后可以左右切换">
                        <i class="fa-solid fa-layer-group"></i>
                        载入备用开场白（${countAlternateGreetings(alternatesTarget)} 条）
                    </button>
                </div>
            ` : ''}
        </section>
    `;
    }

    // 两步删除：面板先给出「编辑消息」「删除消息」，点「删除消息」才露出「确认删除这条消息？取消 / 确认删除」。
    // 第二步用原生 <details> 切换，不需要新的事件或状态；data-message-delete-step 让 routes/chat-scroll.js
    // 在重渲染后恢复展开状态。取消/确认沿用 data-cancel-message-delete / data-confirm-message-delete。
    function renderMessageManagePanel(message, messageIndex) {
        const stepKey = `${getCurrentDraftKey()}:${messageIndex}`;
        return `
        <div class="settings-form inline-form message-manage-panel message-delete-panel">
            <div>
                <strong>编辑或删除消息</strong>
                <p class="panel-subtitle">编辑或删除 ${escapeHtml(message.name || '当前消息')} 的这一条记录。</p>
            </div>
            <div class="message-edit-actions message-manage-actions">
                <button class="secondary-button" type="button" data-edit-message="${messageIndex}">
                    <i class="fa-solid fa-pen"></i>
                    编辑消息
                </button>
                <details class="message-delete-step" data-message-delete-step="${escapeHtml(stepKey)}">
                    <summary class="secondary-button danger-action" data-request-message-delete>
                        <i class="fa-solid fa-trash"></i>
                        删除消息
                    </summary>
                    <strong class="message-delete-question" role="alert">确认删除这条消息？</strong>
                </details>
                <button class="secondary-button" type="button" data-cancel-message-delete>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button danger-action message-delete-confirm" type="button" data-confirm-message-delete>
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
