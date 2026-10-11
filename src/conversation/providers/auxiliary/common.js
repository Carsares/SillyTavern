import { fail } from '../core/index.js';
export function fields(input, allowed, kind) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('invalid-input', `${kind} options must be an object`);
    for (const key of Object.keys(input)) if (!allowed.includes(key)) throw fail('unsupported-parameters', `${kind} does not support ${key}`);
}
export function integer(value, name, min = 1, max = 4096) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw fail('invalid-input', `Invalid ${name}`);
    return value;
}
export function vectors(value, count) {
    if (!Array.isArray(value) || value.length !== count || value.some(v => !Array.isArray(v) || !v.length || v.length !== value[0].length || v.some(n => !Number.isFinite(n)))) throw fail('provider-response-invalid', 'Embedding count or dimensions are invalid');
    return value;
}
export function modelPath(model) {
    if (typeof model !== 'string' || !model || model.split('/').some(s => !s || s === '.' || s === '..') || /[?#\\]/.test(model)) throw fail('invalid-connection', 'Invalid model path');
    return model.split('/').map(encodeURIComponent).join('/');
}
export function imageList(images) {
    if (!Array.isArray(images) || !images.length || images.length > 4 || images.some(i => !i || !(typeof i.data === 'string' && i.data.length) && !(typeof i.url === 'string' && /^https?:\/\//.test(i.url)))) throw fail('provider-response-invalid', 'Missing or invalid images');
    for (const image of images) if (image.url) { const url = new URL(image.url); if (url.username || url.password) throw fail('provider-response-invalid', 'Credential-bearing image URL'); }
    for (const image of images) if (image.data && image.data.length > 28 * 1024 * 1024) throw fail('provider-response-invalid', 'Encoded image exceeds size limit');
    return images;
}
export async function binaryImage(response, signal) {
    const mimeType = response.headers.get('content-type')?.split(';')[0];
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw fail('provider-response-invalid', 'Expected PNG/JPEG/WebP response');
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        while (true) { signal?.throwIfAborted(); const { value, done } = await reader.read(); signal?.throwIfAborted(); if (done) break; size += value.length; if (size > 20 * 1024 * 1024) throw fail('provider-response-invalid', 'Image exceeds 20 MiB'); chunks.push(value); }
        if (!size) throw fail('provider-response-invalid', 'Empty image');
        return { data: Buffer.concat(chunks).toString('base64'), mimeType };
    } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
