import { MODERN_MESSAGE_SOURCE } from '../actions/chat-context-selectors.js';
import { canOfferAlternateGreetings, canSwitchGreetingLocally, clampSwipeId, countAlternateGreetings } from '../actions/chat-greetings.js';
import { getLatestChatSummary } from '../core/chat-summary.js';
import {
    canTranslateMessage,
    getLanguageShortLabel,
    getMessageTranslationView,
    getMessageUiKey,
    getTranslatorLabel,
    resolveTranslateSettings,
} from '../core/translation.js';
import { isImageMessage } from '../core/image-message.js';
import { createChatImageMessageComponents } from './chat-image-message.js';
import { createChatImageSelectionComponents } from './chat-image-selection.js';
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

export function createChatMessageComponents(ctx) {
    const {
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
        // 翻译（B3）：当前翻译服务的隐私提示，由 actions/chat-translation.js 提供
        getChatTranslationNotice = () => ({ text: '', providerLabel: '', targetLabel: '' }),
    } = ctx;
    // 会话内生图：图片消息与任务卡片（components/chat-image-message.js）、从消息生成的勾选（components/chat-image-selection.js）
    const { renderImageMessage, renderImageJobCard } = createChatImageMessageComponents(ctx);
    const { getMessageSelection, renderSelectionBanner } = createChatImageSelectionComponents(ctx);
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
        // 持有最新聊天摘要的那条消息（A6）：整个列表只算一次，传给每条消息渲染
        const summaryIndex = getLatestChatSummary(messages).index;

        // data-chat-key / data-first-index let the chat route tell a chat switch or a "load earlier"
        // prepend apart from an in-place update when it restores the scroll position after render.
        return `
        <div class="message-list-frame">
            <div class="message-list" data-message-list data-chat-key="${escapeHtml(getCurrentDraftKey())}" data-first-index="${startIndex}">
                ${renderSelectionBanner()}
                ${hiddenCount ? `
                    <button class="secondary-button load-earlier-button" type="button" data-load-earlier-messages>
                        <i class="fa-solid fa-clock-rotate-left"></i>
                        加载更早消息 ${formatNumber(hiddenCount)}
                    </button>
                ` : ''}
                ${messages.slice(startIndex).map((message, index) => renderMessage(message, startIndex + index, summaryIndex)).join('')}
                ${renderStreamingBubble()}
                ${renderImageJobCard()}
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

    function renderMessage(message, messageIndex, summaryIndex = -1) {
        const selection = getMessageSelection(message, messageIndex);
        if (isImageMessage(message)) {
            const deleting = state.chatMessageDeleteConfirm.key === getCurrentDraftKey() && state.chatMessageDeleteConfirm.index === messageIndex;
            return renderImageMessage(message, messageIndex, {
                isDeleting: deleting,
                managePanelHtml: deleting ? renderMessageManagePanel(message, messageIndex) : '',
                selection,
            });
        }
        const name = message.name || (message.is_user ? 'You' : 'Character');
        const translationKey = getMessageUiKey(getCurrentDraftKey(), messageIndex);
        // 译文（extra.display_text）只用于显示；「原文 / 译文」开关只在界面状态里，过期的译文默认显示原文
        const translation = getMessageTranslationView(message, state.chatTranslation?.viewOriginal?.[translationKey]);
        const rawText = translation.text;
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
        <article class="message ${message.is_user ? 'user' : ''} ${selection.className}" ${selection.attrs}>
            <header class="message-meta">
                ${selection.controlHtml}
                <strong>${escapeHtml(name)}</strong>
                ${messageIndex === summaryIndex ? '<span class="badge message-summary-marker" title="这条消息上挂着聊天摘要">摘要</span>' : ''}
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
                    ${renderTranslateButton(message, messageIndex, translation, translationKey)}
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
                    ${translation.hasTranslation ? '<p class="panel-subtitle message-edit-translation-hint" data-edit-translation-hint><i class="fa-solid fa-language"></i> 这里编辑的是原文。保存后这条消息的译文会被清除，需要时可以重新翻译。</p>' : ''}
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
            ${isEditing ? '' : renderMessageTranslation(message, messageIndex, translation, translationKey)}
            ${renderMessageReasoning(message, translation.reasoning)}
            ${renderMessageAttachments(message)}
            ${renderMessageFoot(message, model, { hideSwipeCount: !!greetingCounter && !isEditing })}
            ${isDeleting ? renderMessageManagePanel(message, messageIndex) : ''}
        </article>
    `;
    }

    // 动作栏里的「翻译」按钮：只给 AI 回复；生成中、正在翻译、没有内容时不可点
    function renderTranslateButton(message, messageIndex, translation, translationKey) {
        if (!canTranslateMessage(message)) {
            return '';
        }

        const settings = resolveTranslateSettings(state.settings);
        const providerLabel = getTranslatorLabel(settings);
        const busy = Boolean(state.chatTranslation?.busy?.[translationKey]);
        const empty = !String(message.mes ?? '').trim();
        const disabled = busy || empty || state.engine.generating;
        const title = busy
            ? '正在翻译…'
            : state.engine.generating
                ? '生成中不能翻译'
                : `${translation.hasTranslation ? '重新翻译' : '翻译'}为${getLanguageShortLabel(settings.target_language)}（${providerLabel}）`;
        return `
                    <button class="icon-button mini" type="button" data-translate-message="${messageIndex}" title="${escapeHtml(title)}" aria-label="翻译消息" ${disabled ? 'disabled' : ''} ${busy ? 'aria-busy="true"' : ''}>
                        <i class="fa-solid ${busy ? 'fa-circle-notch fa-spin' : 'fa-language'}"></i>
                    </button>`;
    }

    // 消息下面的翻译状态条：隐私确认、翻译中、失败、有译文时的「原文 / 译文」开关；都没有时不占位置
    function renderMessageTranslation(message, messageIndex, translation, translationKey) {
        if (!canTranslateMessage(message)) {
            return '';
        }

        const ui = state.chatTranslation || {};
        if (ui.busy?.[translationKey]) {
            return `
            <div class="message-translation" role="status" data-message-translation="busy">
                <i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>
                <span>正在翻译…</span>
            </div>`;
        }

        if (ui.confirm === translationKey) {
            const notice = getChatTranslationNotice();
            return `
            <div class="message-translation is-confirm" role="note" data-message-translation="confirm">
                <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
                <span>${escapeHtml(notice.text)}译文只用于显示，不会改动原文。要翻译成${escapeHtml(notice.targetLabel)}吗？</span>
                <button class="secondary-button compact-button" type="button" data-cancel-message-translation>取消</button>
                <button class="primary-button compact-button" type="button" data-confirm-message-translation="${messageIndex}">同意并翻译</button>
            </div>`;
        }

        const error = ui.errors?.[translationKey];
        if (error) {
            return `
            <div class="message-translation is-error" role="alert" data-message-translation="error">
                <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
                <span>${escapeHtml(error)}</span>
                <button class="secondary-button compact-button" type="button" data-translate-message="${messageIndex}" ${state.engine.generating ? 'disabled' : ''}>重试</button>
                <button class="secondary-button compact-button" type="button" data-dismiss-message-translation-error="${messageIndex}">关闭</button>
            </div>`;
        }

        if (!translation.controls) {
            return '';
        }

        const showingTranslation = translation.showing === 'translation';
        const language = translation.lang ? getLanguageShortLabel(translation.lang) : '';
        const generating = state.engine.generating;
        return `
            <div class="message-translation ${translation.stale ? 'is-stale' : ''}" data-message-translation="${translation.stale ? 'stale' : 'ready'}" data-translation-showing="${translation.showing}">
                <span class="message-translation-badge">${showingTranslation ? `译文${language ? ` · ${escapeHtml(language)}` : ''}` : '原文'}</span>
                ${translation.stale ? '<span class="message-translation-stale" data-translation-stale><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> 译文已过期：翻译之后原文变过</span>' : ''}
                <button class="secondary-button compact-button" type="button" data-toggle-message-translation="${messageIndex}">${showingTranslation ? '显示原文' : '显示译文'}</button>
                <button class="secondary-button compact-button" type="button" data-translate-message="${messageIndex}" ${generating ? 'disabled' : ''}>重新翻译</button>
                <button class="secondary-button compact-button" type="button" data-clear-message-translation="${messageIndex}" ${generating ? 'disabled' : ''}>清除译文</button>
            </div>`;
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
