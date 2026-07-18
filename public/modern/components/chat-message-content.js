import { renderMessageMarkdown } from '../core/message-markdown.js';

export function createChatMessageContentComponents({
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

    return {
        renderMessageAttachments,
        renderMessageFoot,
        renderMessageReasoning,
        renderMessageText,
    };
}
