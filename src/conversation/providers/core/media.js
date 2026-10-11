import { fail } from './index.js';

export const MEDIA_TYPES = Object.freeze(['image', 'audio', 'video', 'document']);

/** Attachment bytes stay typed through the custom PI stream; codecs own wire encoding. */
export function inlineMedia(part, capabilities) {
    const type = part.type;
    if (!MEDIA_TYPES.includes(type) || !capabilities?.media?.includes(type)
        || capabilities.verified !== true || !Number.isSafeInteger(capabilities.mediaTokenCost?.[type]) || capabilities.mediaTokenCost[type] <= 0)
        throw fail('unsupported-media', 'Media requires a supported type and verified positive token cost');
    const mime = part.mimeType;
    const validMime = type === 'image' ? ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)
        : type === 'document' ? ['application/pdf', 'text/plain'].includes(mime)
            : typeof mime === 'string' && new RegExp(`^${type}/[\\w.+-]+$`).test(mime);
    if (!validMime || typeof part.data !== 'string' || !part.data.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(part.data) || part.data.length % 4 !== 0)
        throw fail('unsupported-media', 'Media requires matching MIME and inline base64 data');
    return { type, data: part.data, mimeType: mime, ...(typeof part.name === 'string' ? { name: part.name } : {}) };
}
