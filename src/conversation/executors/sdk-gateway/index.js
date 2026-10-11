import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createRedactor } from '../../providers/core/index.js';
import { fail, positiveLimit } from './contracts.js';
import { createDomainTools } from './tools.js';
import { filterRequest, responseInspector, sseFrames, frameData } from './protocol.js';
import { expandTranscript } from './history.js';
import { applyReasoning } from './reasoning.js';
import { aggregateUsage, mergeUsage, normalizeUsage } from './usage.js';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/** One gateway belongs to exactly one turn. No arbitrary proxy paths or retries. */
export function createSdkGateway({ protocol, connection, tools = [], limits = {}, signal,
    fetch: fetchImpl = globalThis.fetch, beforeRequest, onRequest, onEvent,
    countTokens = request => Buffer.byteLength(JSON.stringify(request), 'utf8') + 1024,
    inputBudget, maxOutputTokens, transcript }) {
    if (!['anthropic', 'responses'].includes(protocol)) throw fail('unsupported-protocol', 'Unsupported SDK wire protocol');
    positiveLimit(inputBudget, undefined, 'inputBudget');
    positiveLimit(maxOutputTokens, undefined, 'maxOutputTokens');
    const controller = new AbortController();
    const effective = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const token = randomBytes(32).toString('hex');
    const redact = createRedactor({ ...connection, headers: { ...connection.headers, gatewayToken: token } });
    const maxRequests = positiveLimit(limits.rounds, 5, 'rounds') + 1;
    const maxRequestBytes = positiveLimit(limits.requestBytes, 4 * 1024 * 1024, 'requestBytes');
    const maxResponseBytes = positiveLimit(limits.responseBytes, 8 * 1024 * 1024, 'responseBytes');
    const maxFrameBytes = positiveLimit(limits.frameBytes, 1024 * 1024, 'frameBytes');
    let server, baseUrl, active = false, fatal, requestIndex = 0, content = '', reasoning = '', closed = false;
    const requests = [];
    function check() { if (fatal) throw fatal; effective.throwIfAborted(); }
    function stop(error = fail('aborted', 'SDK turn stopped')) { fatal ??= error; controller.abort(); }
    async function emit(event) {
        check();
        try { await onEvent?.(redact(event)); } catch { const error = fail('event-persistence-failed', 'Could not persist SDK event', 500); stop(error); throw error; }
        check();
        if (event.type === 'text.delta') content += event.text;
        if (event.type === 'reasoning.delta') reasoning += event.text;
    }
    const domain = createDomainTools({ tools, signal: effective, limits, onEvent: emit, stop });
    async function mcp(message) {
        if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } }, 400);
        if (message.method.startsWith('notifications/')) return new Response(null, { status: 202 });
        let result;
        if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'domain', version: '1.0.0' } };
        else if (message.method === 'ping') result = {};
        else if (message.method === 'tools/list') result = { tools: domain.list() };
        else if (message.method === 'tools/call') result = await domain.call(message.params?.name, message.params?.arguments ?? {});
        else return json({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32601, message: 'Method not available' } });
        return json({ jsonrpc: '2.0', id: message.id ?? null, result });
    }
    async function model(body, requestSignal) {
        check();
        if (active) throw fail('concurrent-model-request', 'Only one model request may run per turn', 409);
        if (++requestIndex > maxRequests) throw fail('request-limit', 'SDK model request limit exceeded', 422);
        active = true;
        const index = requestIndex;
        const callSignal = AbortSignal.any([effective, requestSignal]);
        try {
            const expanded = expandTranscript(body, protocol, transcript);
            const { request, removedTools, requestedOutputTokens } = filterRequest(expanded, protocol, domain, connection.model, maxOutputTokens);
            applyReasoning(request, protocol === 'anthropic' ? 'claude' : 'codex', connection.reasoning,
                request[protocol === 'anthropic' ? 'max_tokens' : 'max_output_tokens']);
            const estimatedTokens = await countTokens(structuredClone(request));
            if (!Number.isSafeInteger(estimatedTokens) || estimatedTokens < 0) throw fail('invalid-token-estimate', 'Invalid token count');
            if (estimatedTokens > inputBudget) throw fail('budget-blocked', 'SDK request exceeds the input working budget', 422, { estimatedTokens, inputBudget });
            const actual = { protocol, historyMode: transcript.mode, requestIndex: index,
                sourceRefs: structuredClone(transcript.sourceRefs),
                request: structuredClone(request), messages: structuredClone(request.messages ?? request.input),
                estimatedTokens, budget: { workingBudget: inputBudget, hardInputBudget: inputBudget, maxOutputTokens }, signal: callSignal };
            await beforeRequest?.(actual);
            check(); callSignal.throwIfAborted();
            const upstreamBase = connection.baseUrl.replace(/\/$/, '');
            const suffix = protocol === 'anthropic' ? (upstreamBase.endsWith('/v1') ? '/messages' : '/v1/messages') : '/responses';
            const upstreamUrl = upstreamBase + suffix;
            // Tokens/headers from the CLI never propagate to the upstream service.
            const headers = new Headers(connection.headers ?? {});
            headers.set('content-type', 'application/json');
            if (protocol === 'anthropic') {
                headers.set('anthropic-version', '2023-06-01');
                if (connection.apiKey) headers.set('x-api-key', connection.apiKey);
            } else if (connection.apiKey) headers.set('authorization', `Bearer ${connection.apiKey}`);
            await onRequest?.(redact({ requestIndex: index, protocol, historyMode: transcript.mode,
                sourceRefs: transcript.sourceRefs,
                url: upstreamUrl, method: 'POST', headers: { 'content-type': 'application/json' },
                body: request, removedTools, requestedOutputTokens, estimatedTokens }));
            check(); callSignal.throwIfAborted();
            const record = { requestIndex: index, estimatedTokens, rawUsage: null, complete: false };
            requests.push(record);
            let upstream;
            try { upstream = await fetchImpl(upstreamUrl, { method: 'POST', headers, body: JSON.stringify(request), signal: callSignal, redirect: 'error' }); } catch {
                if (callSignal.aborted) throw fail('aborted', 'Model request stopped; external result may be unknown', 499, { outcome: 'unknown' });
                throw fail('model-result-unknown', 'Model transport failed; no automatic retry', 502);
            }
            if (!upstream.ok) { await upstream.body?.cancel(); throw fail('upstream-http-error', 'Model provider rejected request', 502, { upstreamStatus: upstream.status }); }
            const inspector = responseInspector({ protocol, domain, requestIndex: index, emit,
                usage(raw) { if (raw) record.rawUsage = mergeUsage(record.rawUsage, raw); } });
            const completed = async () => {
                if (record.complete) return;
                check(); callSignal.throwIfAborted(); inspector.assertComplete(); record.complete = true;
                const usage = aggregateUsage(protocol, requests);
                await emit({ type: 'usage.updated', requestIndex: index, rawUsage: record.rawUsage,
                    ...normalizeUsage(protocol, record.rawUsage), complete: usage.requests.at(-1).usageComplete, usage });
            };
            if (!(upstream.headers.get('content-type') ?? '').includes('text/event-stream')) {
                const text = await boundedBody(upstream, maxResponseBytes, callSignal);
                let data; try { data = JSON.parse(text); } catch { throw fail('invalid-model-response', 'Invalid JSON response', 502); }
                await inspector.inspect(data, false); await completed(); active = false;
                return json(data);
            }
            let responseBytes = 0;
            const iterator = (async function* () {
                try {
                    for await (const frame of sseFrames(upstream.body, callSignal, maxFrameBytes)) {
                        const data = frameData(frame);
                        responseBytes += Buffer.byteLength(frame);
                        if (responseBytes > maxResponseBytes) throw fail('response-size-limit', 'Model response exceeds size limit');
                        check();
                        if (data && data !== '[DONE]') {
                            let parsed; try { parsed = JSON.parse(data); } catch { throw fail('invalid-model-response', 'Invalid SSE data', 502); }
                            await inspector.inspect(parsed);
                            if (inspector.isComplete()) await completed();
                        }
                        // A frame containing forbidden tools is never delivered to the SDK.
                        yield new TextEncoder().encode(`${frame}\n\n`);
                    }
                    await completed();
                } catch (error) { stop(error?.code ? error : fail('model-result-unknown', 'Model stream interrupted', 502)); throw fatal; } finally { active = false; }
            })();
            return new Response(new ReadableStream({
                async pull(output) {
                    try { const item = await iterator.next(); if (item.done) output.close(); else output.enqueue(item.value); } catch (error) { output.error(error); }
                },
                async cancel() { if (!record.complete) stop(fail('aborted', 'SDK disconnected from model stream')); await iterator.return(); },
            }), { headers: { 'content-type': 'text/event-stream' } });
        } catch (error) { active = false; throw error; }
    }
    async function handle(request) {
        try {
            if (closed) return json({ error: { code: 'closed', message: 'Gateway closed' } }, 410);
            const url = new URL(request.url);
            if (request.headers.get('authorization') !== `Bearer ${token}` && request.headers.get('x-api-key') !== token) return json({ error: { code: 'unauthorized', message: 'Turn token required' } }, 401);
            check();
            const expected = protocol === 'anthropic' ? '/v1/messages' : '/v1/responses';
            const allowedQuery = !url.search || (protocol === 'anthropic' && url.pathname === expected && url.search === '?beta=true');
            if (request.method !== 'POST' || ![expected, '/mcp'].includes(url.pathname) || !allowedQuery) return json({ error: { code: 'forbidden-endpoint', message: 'Endpoint not available' } }, 403);
            if (request.headers.get('content-encoding')) throw fail('unsupported-encoding', 'Compressed requests are not accepted');
            const text = await boundedBody(request, maxRequestBytes, effective);
            let body; try { body = JSON.parse(text); } catch { throw fail('invalid-json', 'Invalid JSON request'); }
            return await (url.pathname === '/mcp' ? mcp(body) : model(body, request.signal));
        } catch (error) {
            const safe = error?.code && error?.name === 'ProtocolError' ? error : fail('gateway-failed', 'SDK gateway failed', 502);
            stop(safe);
            return json({ error: { code: safe.code, message: safe.message } }, safe.status ?? 502);
        }
    }
    async function start() {
        check();
        if (server) throw fail('gateway-already-started', 'Gateway already started');
        server = createServer(async (req, res) => {
            const disconnected = new AbortController();
            const onClose = () => { if (!res.writableEnded) disconnected.abort(); };
            res.on('close', onClose);
            try {
                const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers,
                    ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: req, duplex: 'half' }), signal: disconnected.signal });
                const response = await handle(request);
                res.writeHead(response.status, Object.fromEntries(response.headers));
                if (response.body) for await (const chunk of response.body) {
                    if (res.destroyed) break;
                    if (!res.write(chunk)) await new Promise(resolve => {
                        const done = () => { res.removeListener('drain', done); res.removeListener('close', done); resolve(); };
                        res.once('drain', done); res.once('close', done);
                    });
                }
                res.end();
            } catch { res.destroy(); } finally { res.removeListener('close', onClose); }
        });
        server.requestTimeout = 30000;
        server.headersTimeout = 10000;
        server.maxHeadersCount = 50;
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        return { baseUrl, token, mcpUrl: `${baseUrl}/mcp` };
    }
    async function close() {
        if (closed) return;
        closed = true; controller.abort();
        if (server) {
            const closing = new Promise(resolve => server.close(resolve));
            server.closeAllConnections(); await closing;
        }
    }
    return { start, close, handle, token, stop, check,
        get signal() { return effective; },
        result() { check(); return { content, reasoning, usage: aggregateUsage(protocol, requests), toolStates: domain.states() }; },
    };
}

async function boundedBody(source, limit, signal) {
    if (!source.body) throw fail('invalid-body', 'Missing JSON body');
    const reader = source.body.getReader();
    const chunks = []; let length = 0;
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
        while (true) {
            signal.throwIfAborted();
            const { value, done } = await reader.read();
            signal.throwIfAborted();
            if (done) break;
            length += value.length;
            if (length > limit) throw fail('body-size-limit', 'Body exceeds gateway limit', 413);
            chunks.push(value);
        }
        return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
