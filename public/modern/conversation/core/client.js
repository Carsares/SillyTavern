import { API_BASE, SCHEMA_VERSION } from '../../../shared/conversation/schemas/index.js';

export class ApiError extends Error {
    constructor(status, error = {}) {
        super(error.message || `HTTP ${status}`);
        this.name = 'ApiError';
        this.status = status;
        this.code = error.code || 'http-error';
        this.details = error.details;
    }
}

/** Incremental SSE parser: UTF-8 decoding is owned by the transport. */
export class EventParser {
    constructor(onEvent) { this.onEvent = onEvent; this.buffer = ''; }
    feed(text) {
        this.buffer += text;
        // CRLF may be split across chunks, so normalize only complete frames.
        let match;
        while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
            const frame = this.buffer.slice(0, match.index).replace(/\r\n/g, '\n');
            this.buffer = this.buffer.slice(match.index + match[0].length);
            let id = '';
            const data = [];
            for (const line of frame.split('\n')) {
                if (line.startsWith('id:')) id = line.slice(3).trim();
                if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
            }
            if (data.length) this.onEvent(JSON.parse(data.join('\n')), id);
        }
        if (this.buffer.length > 4 * 1024 * 1024) throw new Error('事件帧超过大小限制');
    }
}

const segment = value => encodeURIComponent(value);
export function createClient({ base = API_BASE, fetcher = globalThis.fetch.bind(globalThis), csrf = true } = {}) {
    let tokenPromise;
    async function token() {
        if (!csrf) return '';
        tokenPromise ??= fetcher('/csrf-token', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30000) })
            .then(async response => {
                if (!response.ok) throw new ApiError(response.status, { message: '无法获取请求安全令牌' });
                const value = await response.json();
                if (typeof value?.token !== 'string' || !value.token) throw new ApiError(response.status, { code: 'invalid-csrf', message: '服务器未返回请求安全令牌' });
                return value.token;
            }).catch(error => { tokenPromise = undefined; throw error; });
        return tokenPromise;
    }
    async function request(path, { method = 'GET', body, signal } = {}) {
        const headers = { Accept: 'application/json' };
        if (method !== 'GET') {
            headers['Content-Type'] = 'application/json';
            headers['X-CSRF-Token'] = await token();
        }
        const response = await fetcher(`${base}${path}`, {
            method, headers, credentials: 'same-origin', cache: 'no-store', signal: signal || AbortSignal.timeout(30000),
            ...(method !== 'GET' ? { body: JSON.stringify({ ...body, schemaVersion: SCHEMA_VERSION }) } : {}),
        });
        const text = await response.text();
        let value;
        try { value = text ? JSON.parse(text) : null; } catch {
            throw new ApiError(response.status, { code: 'invalid-response', message: '服务器未返回有效 JSON；请检查新接口是否已挂载' });
        }
        if (!response.ok) {
            if (response.status === 403) tokenPromise = undefined;
            throw new ApiError(response.status, value?.error);
        }
        return value;
    }
    return {
        request,
        uploadAttachment: body => request('/attachments', { method: 'POST', body }),
        attachmentUrl: id => `${base}/attachments/${segment(id)}`,
        resources: kind => request(`/resources${kind ? `?kind=${segment(kind)}` : ''}`),
        resource: id => request(`/resources/${segment(id)}`),
        createResource: body => request('/resources', { method: 'POST', body }),
        updateResource: (id, body) => request(`/resources/${segment(id)}`, { method: 'PATCH', body }),
        deleteResource: (id, expectedRevision) => request(`/resources/${segment(id)}`, { method: 'DELETE', body: { expectedRevision } }),
        conversations: () => request('/conversations'),
        createConversation: body => request('/conversations', { method: 'POST', body }),
        snapshot: id => request(`/conversations/${segment(id)}`),
        deleteConversation: (id, expectedContentRevision) => request(`/conversations/${segment(id)}`, { method: 'DELETE', body: { expectedContentRevision } }),
        start: (id, body) => request(`/conversations/${segment(id)}/turns`, { method: 'POST', body }),
        turn: id => request(`/turns/${segment(id)}`),
        stop: id => request(`/turns/${segment(id)}/stop`, { method: 'POST', body: {} }),
        command: (id, body) => request(`/conversations/${segment(id)}/commands`, { method: 'POST', body }),
        estimate: (id, body) => request(`/conversations/${segment(id)}/estimate`, { method: 'POST', body }),
        capabilities: id => request(`/capabilities${id ? `?connectionId=${segment(id)}` : ''}`),
        jobs: id => request(`/conversations/${segment(id)}/jobs`),
        usage: id => request(`/conversations/${segment(id)}/usage`),
        traces: id => request(`/conversations/${segment(id)}/traces`),
        trace: id => request(`/traces/${segment(id)}`),
        tool: id => request(`/tools/${segment(id)}`),
        // Additional v1 routes confirmed by the API integrator.
        candidates: (id, messageId) => request(`/conversations/${segment(id)}/messages/${segment(messageId)}/candidates`),
        automaticState: id => request(`/conversations/${segment(id)}/automatic`),
        automatic: (id, body) => request(`/conversations/${segment(id)}/automatic`, { method: 'POST', body }),
        compact: (id, body) => request(`/conversations/${segment(id)}/compact`, { method: 'POST', body }),
        maintenance: (action, body) => request(`/maintenance/${action}`, body === undefined ? {} : { method: 'POST', body }),
        async stream(id, after, { signal, onEvent, onOpen = () => {} }) {
            const response = await fetcher(`${base}/conversations/${segment(id)}/events?after=${after}`, {
                credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'text/event-stream' },
            });
            if (!response.ok) {
                let value;
                try { value = await response.json(); } catch { /* Preserve the HTTP failure. */ }
                throw new ApiError(response.status, value?.error);
            }
            if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
                throw new Error('服务器未返回事件流');
            }
            onOpen();
            const parser = new EventParser(onEvent);
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            try {
                while (!signal?.aborted) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    parser.feed(decoder.decode(value, { stream: true }));
                }
                parser.feed(decoder.decode());
            } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        },
    };
}

/** One connection per conversation; explicit cursor, backoff, no automatic write retry. */
export function subscribe(client, id, { after = 0, onEvent, onStatus = () => {}, onReset = async () => {}, schedule = setTimeout, unschedule = clearTimeout } = {}) {
    let cursor = after;
    let failures = 0;
    let stopped = false;
    let timer;
    let controller;
    async function connect() {
        if (stopped) return;
        controller = new AbortController();
        onStatus(failures ? 'reconnecting' : 'connecting');
        try {
            await client.stream(id, cursor, { signal: controller.signal, onOpen() { onStatus('connected'); }, onEvent(event) {
                if (event.schemaVersion !== SCHEMA_VERSION || event.conversationId !== id || !Number.isSafeInteger(event.seq)) {
                    throw new Error('事件版本、会话或序号不匹配');
                }
                if (event.seq <= cursor) return;
                onEvent(event); // Advance only after the consumer accepts the event.
                cursor = event.seq;
                failures = 0;
                onStatus('connected');
            } });
            if (!stopped) throw new Error('事件连接已关闭');
        } catch (error) {
            if (stopped) return;
            let failure = error;
            if (error.code === 'cursor-expired') {
                try { await onReset(); cursor = 0; } catch (resetError) { failure = resetError; }
            }
            if (stopped) return;
            failures++;
            onStatus('reconnecting', failure);
            timer = schedule(connect, Math.min(30000, 500 * 2 ** Math.min(failures, 6)));
        }
    }
    void connect();
    return () => { stopped = true; unschedule(timer); controller?.abort(); };
}
