import { ProtocolError } from '../../../../public/shared/conversation/schemas/index.js';

export function fail(code, message) { return new ProtocolError(code, message); }

/** Redact known credentials even when an upstream error echoes them in a string. */
export function createRedactor(connection) {
    const secrets = [connection.apiKey, ...Object.values(connection.headers ?? {})].filter(x => typeof x === 'string' && x.length);
    const sensitive = /authorization|cookie|api[-_]?key|(?:^|[_-])(?:access[_-]?token|refresh[_-]?token|token)(?:$|[_-])|secret|password|credential/i;
    function redact(value) {
        if (typeof value === 'string') {
            for (const secret of secrets) value = value.split(secret).join('[REDACTED]');
            return value;
        }
        if (Array.isArray(value)) return value.map(redact);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitive.test(key) ? '[REDACTED]' : redact(item)]));
        return value;
    }
    return redact;
}

/** Capture the serialized request, before any network operation; never expose auth headers. */
export function createCapturedFetch({ fetchImpl = globalThis.fetch, onRequest, redact, check }) {
    let attempt = 0;
    return async (input, init) => {
        check?.();
        const request = new Request(input, init);
        const url = new URL(request.url);
        url.username = ''; url.password = '';
        for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[REDACTED]');
        const headers = {};
        for (const key of ['content-type', 'accept']) if (request.headers.has(key)) headers[key] = request.headers.get(key);
        const text = await request.clone().text();
        let body;
        try { body = JSON.parse(text); } catch { body = '[non-JSON body omitted]'; }
        await onRequest?.(redact({ attempt: ++attempt, url: url.href, method: request.method, headers, body }));
        check?.();
        request.signal.throwIfAborted();
        return fetchImpl(request);
    };
}

/** Upper-bound byte estimate, not a tokenizer or provider-reported usage. */
export function estimateContext(messages) { return Buffer.byteLength(JSON.stringify(messages), 'utf8') + 64; }

/** Replace media bytes with verified token costs for the fallback estimate. */
export function estimatePiContext(messages, capabilities) {
    let mediaTokens = 0;
    const stripped = messages.map(message => {
        const { providerParts, content, ...rest } = message;
        const parts = providerParts ?? content;
        if (providerParts !== undefined && !Array.isArray(providerParts)) throw fail('unsupported-content', 'Invalid providerParts');
        return { ...rest, content: Array.isArray(parts) ? parts.map(part => {
            if (!['image', 'audio', 'video', 'document'].includes(part.type)) return part;
            const cost = capabilities?.mediaTokenCost?.[part.type];
            if (!capabilities?.verified || !Number.isSafeInteger(cost) || cost <= 0) throw fail('unsupported-media', 'Media token cost must be verified');
            mediaTokens += cost;
            return { type: part.type };
        }) : parts };
    });
    return estimateContext(stripped) + mediaTokens;
}
