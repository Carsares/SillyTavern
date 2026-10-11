import nodeFetch from 'node-fetch';
import { Agent as HttpsAgent } from 'node:https';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { invariant } from '../../../public/shared/conversation/schemas/index.js';

const MAX_BYTES = 8 * 1024 * 1024;
const signature = (bytes, mime) => mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : mime === 'image/gif' ? ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())
            : mime === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';

/** Injected transports must honor the pinned agent; fake fetch can intercept without I/O. */
export async function downloadImage(value, { fetch: fetchImpl = globalThis.fetch, lookup: resolve = lookup, signal } = {}) {
    const fetch = fetchImpl === globalThis.fetch ? (request, options) => nodeFetch(request.url, {
        ...options, signal: request.signal, method: 'GET', redirect: 'manual', headers: { accept: 'image/png,image/jpeg,image/webp,image/gif' },
    }) : fetchImpl;
    const deadline = AbortSignal.timeout(30000);
    const effectiveSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let url;
    try { url = new URL(value); } catch { invariant(false, 'invalid-image', 'Invalid image URL'); }
    for (let redirects = 0; redirects <= 3; redirects++) {
        effectiveSignal.throwIfAborted();
        invariant(url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443'), 'invalid-image', 'Image downloads require credential-free HTTPS on port 443');
        const host = url.hostname.replace(/^\[|\]$/g, '');
        let abort;
        const cancelled = new Promise((_, reject) => {
            abort = () => reject(effectiveSignal.reason);
            effectiveSignal.addEventListener('abort', abort, { once: true });
            if (effectiveSignal.aborted) abort();
        });
        let addresses;
        try { addresses = await Promise.race([resolve(host, { all: true }), cancelled]); } finally { effectiveSignal.removeEventListener('abort', abort); }
        effectiveSignal.throwIfAborted();
        invariant(addresses.length && addresses.every(({ address }) => ipaddr.process(address).range() === 'unicast'), 'invalid-image', 'Image downloads require public addresses');
        const pinned = addresses[0];
        const agent = new HttpsAgent({ keepAlive: false, lookup: (_host, options, callback) => {
            if (options?.all) callback(null, [pinned]); else callback(null, pinned.address, pinned.family);
        } });
        let response;
        try {
            const request = new Request(url, { method: 'GET', headers: { accept: 'image/png,image/jpeg,image/webp,image/gif' }, redirect: 'manual', credentials: 'omit', signal: effectiveSignal });
            response = await fetch(request, { agent });
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                invariant(redirects < 3 && response.headers.get('location'), 'invalid-image', 'Image redirect limit exceeded');
                url = new URL(response.headers.get('location'), url);
                continue;
            }
            invariant(response.ok && response.body, 'image-download-failed', 'Image download failed', 502);
            const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
            invariant(['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime), 'invalid-image', 'Unsupported image MIME');
            const declared = response.headers.get('content-length');
            invariant(declared === null || /^\d+$/.test(declared) && Number(declared) <= MAX_BYTES, 'attachment-limit', 'Image exceeds attachment limit', 413);
            const chunks = [];
            let size = 0;
            for await (const chunk of response.body) {
                effectiveSignal.throwIfAborted();
                size += chunk.length;
                invariant(size <= MAX_BYTES, 'attachment-limit', 'Image exceeds attachment limit', 413);
                chunks.push(Buffer.from(chunk));
            }
            const bytes = Buffer.concat(chunks);
            invariant(size > 0 && signature(bytes, mime), 'invalid-image', 'Image bytes do not match MIME');
            return { mime, base64: bytes.toString('base64') };
        } finally {
            if (response?.body?.cancel) await response.body.cancel().catch(() => {});
            else response?.body?.destroy?.();
            agent.destroy();
        }
    }
}
