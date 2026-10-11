import { invariant } from '../../../public/shared/conversation/schemas/index.js';

/** Keep explicit document MIME support aligned with providers/core/media.js. */
export function mediaType(mime = '') {
    if (['application/pdf', 'text/plain'].includes(mime)) return 'document';
    return ['image', 'audio', 'video'].find(prefix => mime.startsWith(`${prefix}/`)) ?? 'file';
}

/** Only registered attachment references may enter persisted user media. Bytes and paths are internal. */
export function validateMediaReferences(attachments, media) {
    invariant(Array.isArray(media), 'invalid-media', 'Media must be an array');
    const fields = new Set(['attachmentId', 'type', 'mimeType', 'name', 'size']);
    for (const part of media) {
        invariant(part && typeof part === 'object' && !Array.isArray(part)
            && Object.keys(part).every(key => fields.has(key)) && typeof part.attachmentId === 'string'
            && Object.hasOwn(attachments, part.attachmentId), 'invalid-media', 'Media must reference a registered attachment without external paths or inline data');
        const record = attachments[part.attachmentId];
        const type = mediaType(record.mime);
        invariant(type !== 'file' && part.type === type && (part.mimeType === undefined || part.mimeType === record.mime)
            && (part.size === undefined || part.size === record.size) && (part.name === undefined || part.name === record.name),
        'invalid-media', 'Media type and metadata must match the registered attachment');
    }
}
