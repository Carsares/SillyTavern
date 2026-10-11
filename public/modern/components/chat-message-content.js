import { renderMessageMarkdown } from '../core/message-markdown.js';

export function createChatMessageContentComponents({
    state,
    escapeHtml,
    formatBytes,
    formatNumber,
}) {
    // 渲染委托 showdown（Markdown，含代码块/表格/段落），XSS 由 DOMPurify 白名单兜底；
    // stripEmphasis 保留新版既定的 RP 阅读风格：*动作*/_心声_ 渲染成纯文本（粗体仍保留），空消息用占位兜底。
    function renderMessageText(value) {
        return renderMessageMarkdown(String(value || '[空消息]'), { stripEmphasis: true });
    }

    function getMessageReasoning(message) {
        return message.extra?.reasoning_display_text || message.extra?.reasoning || message.swipe_info?.[message.swipe_id || 0]?.extra?.reasoning || '';
    }

    function hasMessageAttachments(message) {
        return (Array.isArray(message.extra?.media) && message.extra.media.length > 0)
            || (Array.isArray(message.extra?.files) && message.extra.files.length > 0);
    }

    // Modern 的 API 页只为聊天补全提供 Max Tokens（oai_settings.openai_max_tokens），其他主 API 不显示当前值。
    function getReplyTokenLimit() {
        const settings = state.settings || {};
        if (settings.main_api && settings.main_api !== 'openai') {
            return null;
        }
        const value = Number(settings.oai_settings?.openai_max_tokens);
        return Number.isFinite(value) && value > 0 ? value : null;
    }

    // 推理模型把 Max Tokens 全用在推理上时正文为空，只剩折叠的「推理内容」；在气泡里直接说明原因和去处。
    function renderEmptyReplyHint(message, text) {
        if (message.is_user || message.is_system || String(text || '').trim() || hasMessageAttachments(message)) {
            return '';
        }
        if (!String(getMessageReasoning(message)).trim()) {
            return '';
        }

        const limit = getReplyTokenLimit();
        const limitText = limit === null ? '' : `（当前 ${formatNumber(limit)}）`;
        return `
        <div class="message-empty-hint" role="note" data-empty-reply-hint>
            <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
            <span>回复正文为空：推理内容可能用完了 Max Tokens${escapeHtml(limitText)}。可在 API 页调高后重生成。</span>
            <button class="secondary-button compact-button" type="button" data-route="api">
                <i class="fa-solid fa-sliders"></i>
                打开 API 设置
            </button>
        </div>
    `;
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

    // hideSwipeCount：开场消息的候选计数已经显示在它自己的标题栏里（「开场白 i/N」），页脚不再重复
    function renderMessageFoot(message, model, { hideSwipeCount = false } = {}) {
        const details = [
            model,
            !hideSwipeCount && Array.isArray(message.swipes) && message.swipes.length > 1 ? `候选 ${(message.swipe_id || 0) + 1}/${message.swipes.length}` : '',
            message.extra?.token_count ? `${formatNumber(message.extra.token_count)} tokens` : '',
        ].filter(Boolean);

        return details.length ? `<footer class="message-foot">${details.map(detail => `<span>${escapeHtml(detail)}</span>`).join('')}</footer>` : '';
    }

    return {
        renderEmptyReplyHint,
        renderMessageAttachments,
        renderMessageFoot,
        renderMessageReasoning,
        renderMessageText,
    };
}
