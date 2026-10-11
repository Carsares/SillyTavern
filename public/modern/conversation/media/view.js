import { el } from '../core/dom.js';
export function mediaView(api, part, metadata = {}) {
    if (!part.attachmentId) {
        const external = part.externalURL || part.externalUrl || part.url;
        if (typeof external === 'string') {
            let url;
            try { url = new URL(external); } catch { /* Display invalid URLs as text. */ }
            return url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
                ? el('p', {}, '外部媒体链接（未持久化）：', el('a', { href: url.href, target: '_blank', rel: 'noopener noreferrer' }, part.name || url.href))
                : el('p', {}, '外部媒体地址无效或不受支持');
        }
        return el('p', {}, '媒体未返回持久化附件引用');
    }
    const src = api.attachmentUrl(part.attachmentId);
    const mime = part.mimeType || part.mime || metadata.mime || '';
    const name = part.name || metadata.name;
    const preview = /^image\/(png|jpeg|gif|webp|avif)$/.test(mime) ? el('img', { src, alt: name || '附件图片', loading: 'lazy', class: 'attachment-preview' })
        : /^audio\//.test(mime) ? el('audio', { src, controls: true, preload: 'none' })
            : /^video\//.test(mime) ? el('video', { src, controls: true, preload: 'none', class: 'attachment-preview' }) : null;
    return el('figure', {}, preview, el('figcaption', {}, el('a', { href: src, download: name || 'attachment' }, name || part.attachmentId), ` · ${mime}`));
}

/** Render only explicit persisted refs or external links; never inline provider data. */
export function toolMediaView(api, value, attachments = {}) {
    const parts = new Map();
    function visit(item) {
        if (!item || typeof item !== 'object') return;
        if (typeof item.attachmentId === 'string') parts.set(`attachment:${item.attachmentId}`, item);
        else if (typeof (item.externalURL || item.externalUrl) === 'string') parts.set(`external:${item.externalURL || item.externalUrl}`, item);
        if (item.type === 'text' && typeof item.text === 'string') {
            try { visit(JSON.parse(item.text)); } catch { /* Plain text, not structured media. */ }
        }
        for (const child of Object.values(item)) visit(child);
    }
    visit(value);
    return el('div', {}, [...parts.values()].map(part => mediaView(api, part, attachments[part.attachmentId])));
}
