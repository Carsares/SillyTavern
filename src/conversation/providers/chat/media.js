// Input codecs only; no uploads, URL fetching, or implicit text extraction. Live models unverified.
import { fail } from '../core/index.js';

export function encodeMediaPart(part, api, capability) {
    if (!capability.media.includes(part.type)) throw fail('unsupported-media', 'Unsupported media for this protocol');
    if (Object.hasOwn(part, 'filename')) throw fail('invalid-content', 'Use the media name field');
    const data = part.data;
    const mime = part.mimeType;
    const url = part.url;
    if (data !== undefined && (typeof data !== 'string' || !data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))) throw fail('invalid-content', 'Media data must be base64');
    if (data !== undefined && url !== undefined) throw fail('invalid-content', 'Choose inline data or URL');
    if (!data && (typeof url !== 'string' || !/^(https?:\/\/|gs:\/\/)/.test(url))) throw fail('invalid-content', 'Media requires data or a provider-accessible URL');
    const matches = part.type === 'document' ? mime === 'application/pdf' || mime?.startsWith('text/')
        : mime?.startsWith(`${part.type}/`);
    if ((!mime && !(part.type === 'image' && url)) || (mime && !matches)) throw fail('invalid-content', 'Media MIME type does not match its type');
    if (api.startsWith('google')) {
        if (!mime) throw fail('invalid-content', 'Google media requires mimeType');
        return data ? { inlineData: { mimeType: mime, data } } : { fileData: { mimeType: mime, fileUri: url } };
    }
    if (url?.startsWith('gs:')) throw fail('unsupported-media', 'Cloud storage URI requires Google');
    if (api === 'anthropic-messages') {
        if (part.type === 'document' && mime !== 'application/pdf') throw fail('unsupported-media', 'Anthropic inline document requires PDF');
        return { type: part.type, source: data ? { type: 'base64', media_type: mime, data } : { type: 'url', url } };
    }
    if (part.type === 'audio') {
        const format = { 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3' }[mime];
        if (!data || !format) throw fail('unsupported-media', 'Chat audio requires inline WAV or MP3');
        return { type: 'input_audio', input_audio: { data, format } };
    }
    if (part.type === 'document') {
        if (!data || mime !== 'application/pdf') throw fail('unsupported-media', 'Chat document requires inline PDF');
        return { type: 'file', file: { filename: part.name ?? 'document.pdf', file_data: `data:${mime};base64,${data}` } };
    }
    if (part.type !== 'image') throw fail('unsupported-media', 'No codec for this media type');
    return { type: 'image_url', image_url: { url: data ? `data:${mime};base64,${data}` : url } };
}
