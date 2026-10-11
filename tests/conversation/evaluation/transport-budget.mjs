import { wireProtocol, upstreamEndpoint, outputKey, usageReader } from './protocols.mjs';

const positive = value => Number.isSafeInteger(value) && value > 0;
export function blocked(code) { return Object.assign(new Error(code), { code, blocked: true }); }

/** Native, Anthropic and Responses egress guard shared by primary, summaries and embeddings.
 * Configured prices are explicit upper bounds, never reported as billed prices. */
export function createBudgetTransport({ connections, ceiling, fetch: fetchImpl, signal }) {
    const records = [], observers = [];
    let closed = false, fault;
    if (!ceiling || !['maxRequests', 'maxInputTokens', 'maxOutputTokens'].every(k => Number.isSafeInteger(ceiling[k]) && ceiling[k] >= 0) || !Number.isFinite(ceiling.maxCostUsd) || ceiling.maxCostUsd < 0) throw blocked('invalid-transport-ceiling');
    const totals = { requests: 0, input: 0, output: 0, costUpper: 0 };
    for (const c of connections) {
        const p = c.pricing;
        if (!p || ![p.inputUsdPerMillionUpper, p.outputUsdPerMillionUpper, p.perRequestUsdUpper].every(x => Number.isFinite(x) && x >= 0) || !p.source) throw blocked('price-upper-bound-required');
    }
    async function observe(response, record) {
        const usage = usageReader(record.kind);
        let reader, abort;
        try {
            reader = response.body?.getReader(); if (!reader) return;
            abort = () => { void reader.cancel().catch(() => {}); };
            record.signal?.addEventListener('abort', abort, { once: true });
            record.signal?.throwIfAborted();
            let buffer = '', bytes = 0;
            const decoder = new TextDecoder();
            const parse = text => { try { usage.accept(JSON.parse(text)); } catch {} };
            let frame = [];
            const line = text => {
                if (!text) { if (frame.length) parse(frame.join('\n')); frame = []; }
                else if (text.startsWith('data:')) frame.push(text.slice(5).trimStart());
            };
            for (;;) {
                const { value, done } = await reader.read(); record.signal?.throwIfAborted(); if (done) break;
                bytes += value.byteLength;
                if (bytes > 16 * 1024 * 1024) { void reader.cancel().catch(() => {}); return; }
                buffer += decoder.decode(value, { stream: true });
                if (response.headers.get('content-type')?.includes('text/event-stream')) {
                    let newline;
                    while ((newline = buffer.indexOf('\n')) >= 0) {
                        line(buffer.slice(0, newline).replace(/\r$/, '')); buffer = buffer.slice(newline + 1);
                    }
                }
            }
            buffer += decoder.decode();
            if (response.headers.get('content-type')?.includes('text/event-stream')) { if (buffer) line(buffer.replace(/\r$/, '')); line(''); } else parse(buffer);
            const { inputTokens: input, outputTokens: output, raw: last, terminal } = usage.result();
            record.terminal = terminal;
            record.usage = { inputTokens: Number.isSafeInteger(input) && input >= 0 ? input : null,
                outputTokens: Number.isSafeInteger(output) && output >= 0 ? output : null,
                costUsd: record.costField === 'usage.cost_usd' && Number.isFinite(last?.cost_usd) && last.cost_usd >= 0 ? last.cost_usd : null };
            if (input > record.reservedInput || output > record.reservedOutput || record.usage.costUsd > record.reservedCost) record.boundViolation = true;
        } catch { record.usage = null; } finally {
            record.signal?.removeEventListener('abort', abort);
            reader?.releaseLock();
        }
    }
    async function fetchGuard(input, init = {}) {
        if (closed) throw blocked('evaluation-transport-closed');
        if (fault) throw blocked('evaluation-prior-outcome-unknown');
        signal?.throwIfAborted(); init.signal?.throwIfAborted();
        const request = new Request(input, init);
        request.signal.throwIfAborted();
        const url = new URL(request.url);
        if (request.method !== 'POST') throw blocked('unpriced-provider-request');
        const payload = await request.clone().text();
        let body; try { body = JSON.parse(payload); } catch { throw blocked('unpriced-provider-request'); }
        const matches = connections.filter(c => c.model === body.model && upstreamEndpoint(c) === url.href);
        if (!matches.length) throw blocked('unpriced-provider-request');
        const kind = wireProtocol(matches[0]);
        if (matches.some(c => wireProtocol(c) !== kind)) throw blocked('ambiguous-provider-protocol');
        if (['anthropic', 'responses'].includes(kind) && (body.previous_response_id || body.conversation || body.prompt)) throw blocked('unbounded-server-context');
        // Identical endpoint/model roles must use their strictest limits and largest prices.
        const c = { ...matches[0], maxOutputTokens: Math.min(...matches.map(c => c.maxOutputTokens ?? 0)),
            pricing: Object.fromEntries(['inputUsdPerMillionUpper', 'outputUsdPerMillionUpper', 'perRequestUsdUpper'].map(k => [k, Math.max(...matches.map(c => c.pricing[k]))])) };
        const output = kind === 'embedding' ? 0 : kind === 'chat' ? body.max_completion_tokens ?? body.max_tokens : body[outputKey(kind)];
        if (kind !== 'embedding' && (!positive(output) || output > c.maxOutputTokens || body.n && body.n !== 1)) throw blocked('unbounded-provider-output');
        const inputBound = Buffer.byteLength(payload) + 2048;
        const inputMax = Math.min(...matches.map(c => Math.min(c.inputLimit ?? c.contextWindow, c.contextWindow - (c.maxOutputTokens ?? 0))));
        if (inputBound > inputMax) throw blocked('provider-input-bound-exceeded');
        const cost = (inputBound * c.pricing.inputUsdPerMillionUpper + output * c.pricing.outputUsdPerMillionUpper) / 1e6 + c.pricing.perRequestUsdUpper;
        if (totals.requests + 1 > ceiling.maxRequests || totals.input + inputBound > ceiling.maxInputTokens || totals.output + output > ceiling.maxOutputTokens || totals.costUpper + cost > ceiling.maxCostUsd) throw blocked('evaluation-budget-exhausted');
        signal?.throwIfAborted(); request.signal.throwIfAborted();
        if (closed) throw blocked('evaluation-transport-closed');
        if (fault) throw blocked('evaluation-prior-outcome-unknown');
        totals.requests++; totals.input += inputBound; totals.output += output; totals.costUpper += cost;
        const effectiveSignal = signal ? AbortSignal.any([signal, request.signal]) : request.signal;
        const record = { kind, signal, reservedInput: inputBound, reservedOutput: output, reservedCost: cost, costField: c.providerCostField, status: 'intent' };
        records.push(record);
        // Budget reservations precede ALL HTTP calls and are never refunded on unknown outcomes.
        const response = await fetchImpl(request, { redirect: 'error', signal: effectiveSignal });
        record.status = response.ok ? 'response' : 'http-error';
        observers.push(observe(response.clone(), record));
        return response;
    }
    return { async fetch(...args) { try { return await fetchGuard(...args); } catch (error) { fault ??= error; throw error; } }, get dispatched() { return records.length; }, get reservations() { return { ...totals }; }, close() { closed = true; }, async finish() {
        closed = true; await Promise.allSettled(observers);
        const complete = records.length > 0 && records.every(r => r.status === 'response' && r.terminal && r.usage?.inputTokens !== null && r.usage?.inputTokens !== undefined && r.usage?.outputTokens !== null && r.usage?.outputTokens !== undefined);
        const costsKnown = records.length > 0 && records.every(r => r.usage?.costUsd !== null && r.usage?.costUsd !== undefined);
        if (fault?.blocked && records.length) throw fault;
        if (records.some(r => r.boundViolation)) throw blocked('provider-exceeded-declared-bound');
        return { complete, providerRequests: records.length,
            inputTokens: complete ? records.reduce((n, r) => n + r.usage.inputTokens, 0) : null,
            outputTokens: complete ? records.reduce((n, r) => n + r.usage.outputTokens, 0) : null,
            costUsd: costsKnown ? records.reduce((n, r) => n + r.usage.costUsd, 0) : null,
            costComplete: costsKnown, costUpperBoundUsd: totals.costUpper, costBasis: 'configured-price-upper-bound',
            reservedRequests: totals.requests, reservedInputTokens: totals.input, reservedOutputTokens: totals.output };
    } };
}

export function pipelineQuote(connections, maxRequests) {
    if (!positive(maxRequests)) throw blocked('pipeline-request-cap-required');
    // Validate the same pricing contract without making any request.
    createBudgetTransport({ connections, ceiling: { maxRequests: 0, maxInputTokens: 0, maxOutputTokens: 0, maxCostUsd: 0 }, fetch: () => { throw blocked('not-running'); } });
    const input = Math.max(...connections.map(c => Math.min(c.inputLimit ?? c.contextWindow, c.contextWindow - (c.maxOutputTokens ?? 0))));
    const output = Math.max(...connections.map(c => c.maxOutputTokens ?? 0));
    const cost = (input * Math.max(...connections.map(c => c.pricing.inputUsdPerMillionUpper)) + output * Math.max(...connections.map(c => c.pricing.outputUsdPerMillionUpper))) / 1e6 + Math.max(...connections.map(c => c.pricing.perRequestUsdUpper));
    if (!positive(input) || !positive(output) || !Number.isFinite(cost)) throw blocked('invalid-pipeline-bounds');
    const quote = { hardUpperBound: true, maxRequests, maxInputTokens: input * maxRequests, maxOutputTokens: output * maxRequests, maxCostUsd: cost * maxRequests };
    if (![quote.maxRequests, quote.maxInputTokens, quote.maxOutputTokens].every(positive) || !Number.isFinite(quote.maxCostUsd)) throw blocked('invalid-pipeline-bounds');
    return quote;
}
