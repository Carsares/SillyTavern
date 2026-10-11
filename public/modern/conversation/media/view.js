import { el } from '../core/dom.js';
export function mediaView(api, part) {
    if (!part.attachmentId) return el('pre', {}, JSON.stringify(part, null, 2));
    const src = api.attachmentUrl(part.attachmentId);
    const mime = part.mimeType || part.mime || '';
    const preview = /^image\/(png|jpeg|gif|webp|avif)$/.test(mime) ? el('img', { src, alt: part.name || '附件图片', loading: 'lazy', class: 'attachment-preview' })
        : /^audio\//.test(mime) ? el('audio', { src, controls: true, preload: 'none' })
            : /^video\//.test(mime) ? el('video', { src, controls: true, preload: 'none', class: 'attachment-preview' }) : null;
    return el('figure', {}, preview, el('figcaption', {}, el('a', { href: src, download: part.name || 'attachment' }, part.name || part.attachmentId), ` · ${mime}`));
}
