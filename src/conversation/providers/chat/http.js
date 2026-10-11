// Shared adapter transport, read-only consumer of providers/core; no retries or ambient credentials.
import { setTimeout as delay } from 'node:timers/promises';
import { createCapturedFetch, createRedactor, fail } from '../core/index.js';

export function requireCapability(capability) {
    if (!capability.supported) throw fail('unsupported-provider', capability.reason);
}
export function parameters(connection, capability) {
    const result = { ...(connection.parameters ?? {}) };
    for (const [key, value] of Object.entries(result)) {
        if (!capability.parameters.includes(key)) throw fail('unsupported-parameters', `Unsupported parameter ${key}`);
        if (key === 'negative_prompt' ? typeof value !== 'string' : key === 'stop' ? !(typeof value === 'string' || Array.isArray(value) && value.every(item => typeof item === 'string')) : typeof value !== 'number' || !Number.isFinite(value)) {
            throw fail('invalid-parameters', `Invalid parameter ${key}`);
        }
    }
    if (result.guidance_scale !== undefined && result.guidance_scale <= 0) throw fail('invalid-parameters', 'guidance_scale must be positive');
    return result;
}
export function outputLimit(connection, requested) {
    const value = requested ?? connection.maxOutputTokens;
    if (!Number.isSafeInteger(value) || value <= 0 || value > (connection.outputLimit ?? connection.maxOutputTokens)
        || (connection.contextWindow !== undefined && value >= connection.contextWindow)) throw fail('invalid-budget', 'Invalid output reserve');
    return value;
}
export function createTransport(connection, capability, { fetch: fetchImpl = globalThis.fetch, onRequest, onPayload } = {}) {
    const redact = createRedactor(connection);
    const captured = createCapturedFetch({ fetchImpl, onRequest, redact });
    return async (path, { body, signal, method = 'POST', headers = {}, raw = false } = {}) => {
        signal?.throwIfAborted();
        const timeout = connection.timeoutMs ?? 120000;
        if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 600000) throw fail('invalid-connection', 'timeoutMs must be 1..600000');
        const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
        const url = new URL(`${capability.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
        const custom = new Headers(connection.headers ?? {});
        for (const name of ['host', 'content-length', 'authorization', 'api-key', 'x-api-key', 'x-goog-api-key', 'apikey']) custom.delete(name);
        if (connection.apiKey) custom.set('authorization', `Bearer ${connection.apiKey}`);
        for (const [name, value] of Object.entries(headers)) { if (value === null) custom.delete(name); else custom.set(name, value); }
        if (body instanceof FormData) custom.delete('content-type');
        if (body !== undefined && !(body instanceof FormData)) custom.set('content-type', 'application/json');
        let response;
        if (body !== undefined && !(body instanceof FormData)) await onPayload?.(structuredClone(body));
        try {
            response = await captured(url, { method, headers: custom, signal: combined, redirect: 'error',
                body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
        } catch (error) {
            if (combined.aborted) throw combined.reason;
            // Raw fetch errors may contain a credential-bearing URL or body.
            throw fail('provider-network-error', 'Provider transport failed; request outcome may be unknown');
        }
        combined.throwIfAborted();
        if (!response.ok) {
            await response.body?.cancel();
            const error = fail('provider-http-error', `Provider returned HTTP ${response.status}`);
            error.details = { status: response.status, retryable: false };
            throw error;
        }
        if (raw) return response;
        let result;
        try { result = await response.json(); } catch { combined.throwIfAborted(); throw fail('provider-response-invalid', 'Provider did not return valid JSON'); }
        combined.throwIfAborted();
        if (!result || result.error || result.success === false) throw fail('provider-error', 'Provider returned an error response');
        return result;
    };
}
export function usage(input, output, extra = {}) {
    const valid = value => Number.isFinite(value) && value >= 0;
    return { inputTokens: valid(input) ? input : null, outputTokens: valid(output) ? output : null,
        totalTokens: valid(input) && valid(output) ? input + output : null, source: 'provider', cost: null, costUsd: null, costSource: null, costEstimated: null, raw: null, ...extra };
}
export async function emitResult(result, onEvent, signal) {
    signal?.throwIfAborted();
    if (result.reasoning) await onEvent?.({ type: 'reasoning.delta', text: result.reasoning });
    if (result.content) await onEvent?.({ type: 'text.delta', text: result.content });
    if (result.toolCalls?.length) for (const call of result.toolCalls) await onEvent?.({ type: 'tool.call', ...call });
    if (result.usage) await onEvent?.({ type: 'usage', usage: result.usage });
    signal?.throwIfAborted();
    return result;
}
export function textResult(content, tokens = usage(), finishReason = 'stop') {
    if (typeof content !== 'string') throw fail('provider-response-invalid', 'Missing generated text');
    return { content, reasoning: '', toolCalls: [], usage: tokens, finishReason };
}
export async function pollHorde(transport, connection, body, { signal, image = false, jobId, onJob } = {}) {
    const prefix = image ? 'generate' : 'generate/text';
    const headers = { authorization: null, apikey: connection.apiKey || '0000000000', 'Client-Agent': 'ConversationV1:1:local' };
    const maxPolls = connection.maxPolls ?? 60;
    const interval = connection.pollIntervalMs ?? 1000;
    if (!Number.isSafeInteger(maxPolls) || maxPolls < 1 || maxPolls > 600 || !Number.isSafeInteger(interval) || interval < 0 || interval > 10000) throw fail('invalid-connection', 'Invalid bounded polling configuration');
    const resumed = jobId !== undefined;
    if (resumed && (typeof jobId !== 'string' || !/^[\w-]+$/.test(jobId))) throw fail('invalid-input', 'Invalid Horde resume job ID');
    const submitted = resumed ? { id: jobId } : await transport(`${prefix}/async`, { body, headers, signal });
    if (typeof submitted.id !== 'string' || !/^[\w-]+$/.test(submitted.id)) throw fail('provider-response-invalid', 'Invalid Horde job ID');
    try {
        // Runtime persists the ID here before polling; resumed requests never submit again.
        await onJob?.({ jobId: submitted.id, state: resumed ? 'resumed' : 'submitted', kind: image ? 'image' : 'text' });
        for (let attempt = 0; attempt < maxPolls; attempt++) {
            if (interval) await delay(interval, undefined, { signal });
            const status = await transport(`${prefix}/status/${submitted.id}`, { method: 'GET', headers, signal });
            if (status.faulted) throw fail('provider-job-failed', 'Horde job faulted');
            if (status.done) return { ...status, jobId: submitted.id };
        }
        const error = fail('provider-poll-limit', 'Horde job is still pending; do not automatically submit it again');
        error.details = { jobId: submitted.id, outcome: 'pending' };
        throw error;
    } catch (error) {
        const failure = error instanceof Error ? error : fail('provider-job-interrupted', 'Horde polling interrupted');
        failure.details = { ...failure.details, jobId: submitted.id, outcome: failure.details?.outcome ?? 'unknown', resubmit: false };
        throw failure;
    }
}
