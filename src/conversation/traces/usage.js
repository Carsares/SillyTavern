const FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens', 'costUsd'];
const known = value => Number.isFinite(value) && value >= 0;
const empty = () => ({ calls: 0, ...Object.fromEntries(FIELDS.map(key => [key, 0])), complete: true });
function merge(target, source) {
    target.calls += source.calls;
    target.complete &&= source.complete;
    for (const key of FIELDS) target[key] = target[key] === null || source[key] === null ? null : target[key] + source[key];
}

/** Sum independently reported counts. Cache/reasoning subcounts never inflate totalTokens. */
export function summarizeUsage(traces) {
    const totals = empty(), categories = Object.fromEntries(['generation', 'memory', 'embedding', 'image'].map(kind => [kind, empty()]));
    const turns = new Map(), consumed = new Set();
    const requests = traces.filter(trace => trace.kind === 'outbound-request');
    const records = traces.filter(trace => trace.requestPlan || ['embedding-usage', 'image-usage'].includes(trace.kind));
    const groups = new Map();
    for (const trace of records) {
        const id = trace.providerJob?.resumed && trace.providerJob.originalTraceId || trace.id;
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(trace);
    }
    for (const [id, group] of groups) {
        const trace = group.find(item => item.id === id) ?? group[0];
        const category = trace.kind === 'memory' ? 'memory' : trace.kind?.startsWith('embedding') ? 'embedding' : trace.kind?.startsWith('image') ? 'image' : 'generation';
        const ids = new Set(group.map(item => item.id));
        const bound = requests.filter(request => ids.has(request.parentTraceId));
        bound.forEach(request => consumed.add(request.id));
        const usage = group.map(item => item.usage ?? item.events?.filter(event => event.type === 'usage.updated' && event.usage).at(-1)?.usage)
            .filter(Boolean).at(-1);
        const calls = Math.max(bound.length, usage?.requests?.length ?? (usage ? 1 : 0));
        if (!calls) continue;
        const count = { calls, complete: usage?.complete === true && (!usage.requests || usage.requests.length >= calls) };
        const missingRequests = usage?.requests && usage.requests.length < calls;
        for (const key of FIELDS) count[key] = !missingRequests && known(usage?.[key]) ? usage[key] : null;
        merge(totals, count); merge(categories[category], count);
        if (trace.turnId) { if (!turns.has(trace.turnId)) turns.set(trace.turnId, { turnId: trace.turnId, ...empty() }); merge(turns.get(trace.turnId), count); }
    }
    // An attempted outbound request without a completed usage record stays visibly incomplete.
    for (const trace of requests) if (!consumed.has(trace.id)) {
        const count = { calls: 1, ...Object.fromEntries(FIELDS.map(key => [key, null])), complete: false };
        merge(totals, count); merge(categories[Object.hasOwn(categories, trace.category) ? trace.category : 'generation'], count);
        if (trace.turnId) { if (!turns.has(trace.turnId)) turns.set(trace.turnId, { turnId: trace.turnId, ...empty() }); merge(turns.get(trace.turnId), count); }
    }
    return { totals, categories, turns: [...turns.values()], accounting: 'Reported totalTokens excludes separately adding cache/reasoning subcounts; null means unknown. Calls count attempted model requests.' };
}
