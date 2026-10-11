import { ProxyAgent } from 'proxy-agent';
import nodeFetch from 'node-fetch';
import { Readable } from 'node:stream';
import { fail } from './index.js';

class VerifiedProxyAgent extends ProxyAgent {
    connect(request, options) {
        // agent-base forwards this object to the cached tunnelling agent too.
        // Enforce verification for destination TLS as well as HTTPS proxy TLS.
        options.rejectUnauthorized = true;
        return super.connect(request, options);
    }
}

/** Pull-based replacement for Readable.toWeb(). On Node 24 the adapter keeps
 * enqueuing buffered 'data' after the web stream is closed or errored and throws
 * an uncaught ERR_INVALID_STATE; reading only on pull never writes after close.
 */
function toWebStream(readable) {
    const chunks = readable[Symbol.asyncIterator]();
    let cancelled = false;
    return new ReadableStream({
        async pull(controller) {
            try {
                const { value, done } = await chunks.next();
                if (cancelled) return;
                if (done) controller.close();
                else controller.enqueue(typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value));
            } catch (error) {
                if (!cancelled) controller.error(error);
            }
        },
        async cancel(reason) {
            cancelled = true;
            readable.destroy(reason instanceof Error ? reason : undefined);
        },
    }, { highWaterMark: 0 });
}

/** Returns a normalized secret URL, or null for absent/explicitly cleared proxy.
 * Validation errors never contain the URL or its credentials.
 */
export function validateConnectionProxy(connection) {
    const proxy = (connection?.data ?? connection)?.proxy;
    if (proxy == null) return null;
    const invalid = () => fail('invalid-proxy', 'proxy must contain only an HTTP/HTTPS root URL of at most 4096 characters');
    if (typeof proxy !== 'object' || Array.isArray(proxy) || Object.keys(proxy).some(key => key !== 'url')
        || typeof proxy.url !== 'string' || !proxy.url.length || proxy.url.length > 4096
        || /[\s\\]/u.test(proxy.url) || !/^https?:\/\/[^/?#]+\/?$/i.test(proxy.url)) throw invalid();
    try {
        const url = new URL(proxy.url);
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.port === '0'
            || url.pathname !== '/' || url.search || url.hash) throw invalid();
        // Fail before the agent decodes malformed credentials; those exceptions echo input.
        for (const credential of [url.username, url.password]) {
            if (/[\u0000-\u001f\u007f]/u.test(decodeURIComponent(credential))) throw invalid();
        }
        return url.href;
    } catch { throw invalid(); }
}

/** One component per connection/turn, closed by its owner after body consumption.
 * Injected fetch receives (global Request, {agent, redirect:'error'}) and must
 * honor the Node agent when proxy is configured. Native fetch cannot do that.
 * Without injection, node-fetch handles both direct and proxy requests, so no
 * HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY or global dispatcher is consulted.
 * agent:'global' creates no agent: node-fetch (or an injected fetch, called with
 * {redirect:'error'} only) falls back to http(s).globalAgent, i.e. the host's
 * request proxy and private request filter. It rejects a connection proxy and
 * native fetch, which bypasses Node's global agents.
 */
export function createConnectionFetch(connection, { fetch: injectedFetch, agent: agentMode } = {}) {
    const proxyUrl = validateConnectionProxy(connection);
    if (agentMode !== undefined && agentMode !== 'global') throw fail('invalid-transport', 'agent must be omitted or \'global\'');
    if (injectedFetch !== undefined && typeof injectedFetch !== 'function') throw fail('invalid-transport', 'Injected fetch must be a function');
    if (agentMode === 'global' && proxyUrl) throw fail('invalid-transport', 'Global agent mode cannot use a connection proxy');
    if (agentMode === 'global' && injectedFetch === globalThis.fetch) throw fail('invalid-transport', 'Native fetch bypasses the global Node agents; omit fetch or inject a Node-agent-aware transport');
    if (proxyUrl && injectedFetch === globalThis.fetch) throw fail('invalid-transport', 'Native fetch cannot honor the proxy agent; omit fetch or inject an agent-aware transport');
    // Outer-agent socket reuse skips HttpProxyAgent's absolute request-target
    // rewrite on subsequent requests. Reuse agent objects, not those sockets.
    const agent = agentMode === 'global' ? null : new VerifiedProxyAgent({ getProxyForUrl: () => proxyUrl ?? '', rejectUnauthorized: true, keepAlive: false });
    const lifetime = new AbortController();
    let closed = false;
    return {
        async fetch(input, init) {
            if (closed) throw fail('transport-closed', 'Connection transport is closed');
            let request;
            try {
                const original = new Request(input, init);
                const target = new URL(original.url);
                if (!['http:', 'https:'].includes(target.protocol)) throw new Error();
                const headers = new Headers(original.headers);
                // Proxy authentication is controlled exclusively by the secret proxy URL.
                headers.delete('proxy-authorization'); headers.delete('proxy-connection');
                request = new Request(original, { headers, redirect: 'error', signal: AbortSignal.any([original.signal, lifetime.signal]) });
            } catch { throw fail('invalid-request', 'Invalid connection transport request'); }
            request.signal.throwIfAborted();
            let response;
            try {
                // Global mode omits the agent key entirely so node-fetch uses http(s).globalAgent.
                response = injectedFetch
                    ? await injectedFetch(request, agent ? { agent, redirect: 'error' } : { redirect: 'error' })
                    : await nodeFetch(request.url, { method: request.method, headers: Object.fromEntries(request.headers),
                        body: request.body ? Readable.fromWeb(request.body) : undefined,
                        signal: request.signal, redirect: 'error', ...(agent ? { agent } : {}) });
                request.signal.throwIfAborted();
                if (response instanceof Response) return response;
                const noBody = request.method === 'HEAD' || [204, 205, 304].includes(response.status);
                if (noBody) response.body?.destroy();
                const body = !noBody && response.body ? toWebStream(response.body) : null;
                const result = new Response(body, { status: response.status, statusText: response.statusText, headers: [...response.headers] });
                Object.defineProperties(result, { url: { value: response.url }, redirected: { value: false } });
                return result;
            } catch {
                response?.body?.destroy?.();
                if (request.signal.aborted) throw fail('aborted', 'Connection request was aborted');
                throw fail('provider-network-error', 'Connection transport failed; no direct fallback or automatic retry');
            }
        },
        close() {
            if (closed) return;
            closed = true;
            lifetime.abort();
            // Global mode owns no agent; never destroy the host's shared global agents.
            if (!agent) return;
            agent.destroy();
            // ProxyAgent.destroy() does not destroy its separately owned direct agents.
            agent.httpAgent.destroy(); agent.httpsAgent.destroy();
        },
    };
}
