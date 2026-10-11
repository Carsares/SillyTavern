import { randomUUID } from 'node:crypto';
import { invariant, sourceRef, canonicalJson } from '../../../public/shared/conversation/schemas/index.js';
import { derivedSources, sourcesValid, uniqueRefs, resourceRefs, resourcesValid, summaryParents } from './sources.js';

import { selectBatch, compressionPolicy } from './budget.js';
import { compactSnapshot, combineProposals } from './compaction.js';
export { combineProposals } from './compaction.js';

const KINDS = new Set(['character', 'relationship', 'world-state', 'timeline', 'user-fact']);
const copy = value => structuredClone(value);

export function memoryProposal(snapshot, input, refs) {
    invariant(input && typeof input === 'object', 'invalid-memory', 'Memory must be an object');
    invariant(['create', 'update', 'delete'].includes(input.op ?? 'create'), 'invalid-memory', 'Unknown memory operation');
    const existing = input.id && snapshot.memories.find(block => block.id === input.id);
    if (input.op === 'update' || input.op === 'delete') invariant(existing, 'invalid-memory', 'Memory block does not exist');
    if (existing) {
        invariant(!existing.locked && existing.origin !== 'manual', 'memory-protected', 'Automatic tools cannot overwrite manual or locked memory', 409);
        invariant(input.expectedBlockRevision === existing.revision, 'revision-conflict', 'Memory revision changed', 409);
    }
    invariant(KINDS.has(input.kind ?? existing?.kind ?? 'user-fact'), 'invalid-memory', 'Unknown memory kind');
    invariant(input.op === 'delete' || (typeof input.content === 'string' && input.content.trim() && input.content.length <= 8000), 'invalid-memory', 'Memory content is empty or too long');
    invariant(refs.length > 0 && sourcesValid(refs, snapshot), 'invalid-memory', 'Memory requires current message sources');
    return { id: existing?.id ?? randomUUID(), revision: (existing?.revision ?? 0) + 1,
        expectedBlockRevision: existing?.revision ?? 0, op: input.op ?? 'create', kind: input.kind ?? existing?.kind ?? 'user-fact',
        status: 'valid', origin: 'automatic', locked: false, content: input.content ?? '', sourceRefs: copy(refs), resourceRefs: resourceRefs(snapshot) };
}

export function createMemoryService({ store, generate, now = Date.now }) {
    let draining;
    function eligible(snapshot) {
        const turnIds = [...new Set(snapshot.messages.filter(m => !m.deletedAt && !m.userHidden && m.turnId).map(m => m.turnId))];
        const completed = new Set(turnIds.filter(id => store.getTurn(id)?.status === 'completed'));
        return snapshot.messages.filter(m => !m.deletedAt && !m.userHidden && completed.has(m.turnId) && (!m.status || m.status === 'completed'));
    }
    async function propose(snapshot, { signal, budget, foreground = false } = {}) {
        signal?.throwIfAborted();
        invariant(typeof generate === 'function', 'memory-unavailable', 'No memory generator configured', 503);
        let messages = eligible(snapshot);
        let policy;
        const parents = summaryParents(snapshot);
        const parentRefs = uniqueRefs(parents.flatMap(s => derivedSources(s, snapshot)));
        const resources = uniqueRefs([...resourceRefs(snapshot), ...parents.flatMap(s => s.resourceRefs ?? [])]);
        const folded = (snapshot.folds ?? []).filter(f => f.status === 'valid' && resourcesValid(f.resourceRefs, snapshot) && sourcesValid(f.sourceRefs, snapshot)
            && (snapshot.summaries ?? []).some(s => s.id === f.summaryRef?.id && s.revision === f.summaryRef.revision && derivedSources(s, snapshot)));
        messages = messages.filter(m => !folded.some(f => f.sourceRefs.some(ref => canonicalJson(ref) === canonicalJson(sourceRef(m)))));
        if (foreground) {
            const selected = compressionPolicy(snapshot, messages);
            messages = selected.messages; policy = selected.policy;
        }
        if (!foreground) {
            const covered = new Set(parentRefs.map(canonicalJson));
            // Retain complete turns whenever at least one message is not yet summarized.
            const newTurns = new Set(messages.filter(m => !covered.has(canonicalJson(sourceRef(m)))).map(m => m.turnId));
            messages = messages.filter(m => newTurns.has(m.turnId));
            if (!messages.length) return { summaries: [], memories: [], folds: [], sourceRefs: [], resourceRefs: resources, expectedMemoryRevision: snapshot.conversation.memoryRevision };
        }
        invariant(messages.length > 0, 'budget-blocked', 'No complete unfurled turns can be compressed', 409);
        const validMemories = snapshot.memories.filter(m => derivedSources(m, snapshot));
        const eligibleCount = messages.length;
        const batch = selectBatch(snapshot, messages, { summaries: parents, memories: validMemories, sourceRefs: parentRefs, resourceRefs: resources });
        messages = batch.messages;
        if (policy) {
            const sourceBytes = Buffer.byteLength([...messages, ...parents].map(m => m.content ?? '').join(''));
            policy.summaryTargetTokens = Math.max(1, Math.floor(sourceBytes * policy.compressionRatio));
            if (messages.length < eligibleCount) policy.relaxReasons.push('auxiliary-batch-may-require-additional-compaction');
        }
        const refs = messages.map(sourceRef);
        const allRefs = uniqueRefs([...refs, ...parentRefs]);
        const response = await generate({ type: 'memory', snapshot: copy({ ...snapshot, messages, summaries: parents, memories: validMemories, folds: [] }), messages: copy(messages),
            summaries: copy(parents), memories: copy(validMemories), sourceRefs: copy(allRefs), resourceRefs: copy(resources), budget, inputBudget: batch.budget, estimatedInputTokens: batch.estimatedInputTokens, compressionPolicy: copy(policy), signal,
            outputSchema: { chapter: 'nonempty string', rolling: 'optional nonempty string', memories: 'array of memory proposals' } });
        signal?.throwIfAborted();
        const output = typeof response === 'string' ? JSON.parse(response) : response;
        invariant(output && typeof output.chapter === 'string' && output.chapter.trim() && output.chapter.length <= 16000,
            'compression-failed', 'Generator must return a bounded nonempty chapter');
        invariant(output.rolling === undefined || (typeof output.rolling === 'string' && output.rolling.trim() && output.rolling.length <= 16000), 'compression-failed', 'Invalid rolling summary');
        invariant(output.memories === undefined || (Array.isArray(output.memories) && output.memories.length <= 32), 'compression-failed', 'Invalid memory proposals');
        const chapter = { id: randomUUID(), revision: 1, status: 'valid', kind: 'chapter', content: output.chapter, sourceRefs: refs, resourceRefs: copy(resources), parentSummaryRefs: [] };
        const summaries = [chapter];
        if (output.rolling) summaries.push({ id: randomUUID(), revision: 1, status: 'valid', kind: 'rolling', content: output.rolling,
            sourceRefs: allRefs, resourceRefs: copy(resources), parentSummaryRefs: [...parents.map(s => ({ id: s.id, revision: s.revision })), { id: chapter.id, revision: 1 }] });
        const memories = (output.memories ?? []).map(input => memoryProposal(snapshot, input, allRefs));
        invariant(new Set(memories.map(m => m.id)).size === memories.length, 'compression-failed', 'Duplicate memory targets');
        const folds = foreground ? [{ id: randomUUID(), revision: 1, status: 'valid', content: chapter.content, sourceRefs: refs, resourceRefs: copy(resources), summaryRef: { id: chapter.id, revision: 1 } }] : [];
        const cap = typeof budget === 'number' ? budget : budget?.summaryTokens;
        if (cap != null) invariant(Number.isFinite(cap) && cap > 0 && Buffer.byteLength(summaries.map(s => s.content).join('') + memories.map(m => m.content).join('')) <= cap,
            'budget-blocked', 'Derived content exceeds conservative summary token budget', 409);
        if (policy) {
            policy.summaryEstimatedTokens = Buffer.byteLength(summaries.map(s => s.content).join('') + memories.map(m => m.content).join(''));
            if (policy.summaryEstimatedTokens > policy.summaryTargetTokens) policy.relaxReasons.push('generated-summary-exceeds-half-source-target');
        }
        return { ...(policy ? { compressionPolicy: policy } : {}), summaries, memories, folds, sourceRefs: allRefs, resourceRefs: resources, expectedMemoryRevision: snapshot.conversation.memoryRevision };
    }
    async function prepareCompact(snapshot, { signal, budget, turnId, attemptEpoch } = {}) {
        const proposal = { ...await propose(snapshot, { signal, budget, foreground: true }),
            ...(turnId !== undefined ? { turnId } : {}), ...(attemptEpoch !== undefined ? { attemptEpoch } : {}) };
        signal?.throwIfAborted();
        return { proposal, snapshot: compactSnapshot(snapshot, proposal) };
    }
    async function compact(snapshot, options = {}) {
        const { proposal } = await prepareCompact(snapshot, options);
        options.signal?.throwIfAborted();
        const result = store.commitDerived(snapshot.conversationId ?? snapshot.conversation.id, proposal);
        invariant(result !== false && result?.conflict !== true && result?.accepted !== false, 'revision-conflict', 'Derived commit conflicted', 409);
        return result;
    }
    const dependenciesOf = snapshot => ({ sourceRefs: eligible(snapshot).map(sourceRef), resourceRefs: resourceRefs(snapshot) });
    function schedule(conversationId) {
        const snapshot = store.getConversation(conversationId);
        const messages = eligible(snapshot);
        const count = new Set(messages.map(m => m.turnId)).size;
        const frequency = snapshot.settings?.memoryFrequency ?? 5;
        invariant(Number.isSafeInteger(frequency) && frequency > 0, 'invalid-memory-frequency', 'memoryFrequency must be a positive integer');
        if (!count || count % frequency !== 0) return null;
        const dependencies = dependenciesOf(snapshot);
        return store.createJob({ conversationId, kind: 'memory', dependencies,
            payload: { snapshot: copy(snapshot), completedTurns: count }, status: 'pending', attempts: 0, createdAt: now() });
    }
    async function runJobs({ signal } = {}) {
        invariant(typeof store.commitDerivedJob === 'function', 'atomic-job-commit-required', 'Store must atomically commit a ready derived job', 503);
        const results = [];
        for (const initial of store.listJobs()) {
            if (initial.kind !== 'memory' || ['completed', 'failed'].includes(initial.status) || (initial.status === 'stale' && initial.attempts >= 2)) continue;
            let job = initial, committing = false;
            if (job.status === 'stale') job = { ...job, result: { snapshot: store.getConversation(job.conversationId) } };
            try {
                for (;;) {
                    signal?.throwIfAborted();
                    let proposal = job.result?.proposal;
                    if (!proposal) {
                        if ((job.attempts ?? 0) >= 2) {
                            store.updateJob(job.id, { status: 'stale', error: { code: 'retry-limit' } });
                            results.push({ id: job.id, status: 'stale' }); break;
                        }
                        job = { ...job, attempts: (job.attempts ?? 0) + 1, status: 'running' };
                        const generationSnapshot = job.result?.snapshot ?? job.payload.snapshot;
                        const dependencies = dependenciesOf(generationSnapshot);
                        const saved = store.updateJob(job.id, { attempts: job.attempts, status: 'running', dependencies, ...(job.result ? { result: job.result } : {}) });
                        invariant(canonicalJson(saved.dependencies) === canonicalJson(dependencies), 'job-dependencies-not-updated', 'Store must persist recomputed job dependencies and fingerprint', 503);
                        proposal = await propose(generationSnapshot, { signal });
                        job.result = { ...job.result, proposal };
                        store.updateJob(job.id, { status: 'ready', result: job.result });
                    }
                    signal?.throwIfAborted();
                    const current = store.getConversation(job.conversationId);
                    if (current.conversation.activeTurnId) { results.push({ id: job.id, status: 'ready' }); break; }
                    try {
                        committing = true;
                        const result = store.commitDerivedJob(job.id);
                        invariant(result !== false && result?.conflict !== true && result?.accepted !== false, 'revision-conflict', 'Derived commit conflicted', 409);
                        results.push({ id: job.id, status: 'completed' }); break;
                    } catch (error) {
                        const persisted = store.listJobs().find(item => item.id === job.id);
                        if (persisted?.status === 'completed') { results.push({ id: job.id, status: 'completed' }); break; }
                        if (error.code === 'conversation-busy') { results.push({ id: job.id, status: 'ready' }); break; }
                        if (!['revision-conflict', 'source-conflict', 'stale-source', 'memory-protected', 'dependency-conflict', 'memory-locked'].includes(error.code)) throw error;
                        committing = false;
                        if (job.attempts >= 2) {
                            store.updateJob(job.id, { status: 'stale', error: { code: error.code } });
                            results.push({ id: job.id, status: 'stale' }); break;
                        }
                        job.result = { snapshot: copy(current) };
                        store.updateJob(job.id, { status: 'pending', dependencies: dependenciesOf(current), result: job.result });
                    }
                }
            } catch (error) {
                // An atomic commit may have succeeded before its acknowledgement was
                // lost. Never overwrite completed, or discard a ready proposal on an
                // uncertain storage failure. Recovery retries the local commit only.
                if (committing) {
                    const persisted = store.listJobs().find(item => item.id === job.id);
                    results.push({ id: job.id, status: persisted?.status === 'completed' ? 'completed' : 'ready', error: { code: error.code ?? 'job-commit-unknown' } });
                    if (signal?.aborted) break;
                    continue;
                }
                store.updateJob(job.id, { status: 'failed', error: { code: error.code ?? (signal?.aborted ? 'aborted' : 'memory-failed') } });
                results.push({ id: job.id, status: 'failed' });
                if (signal?.aborted) break;
            }
        }
        return results;
    }
    return { compact, prepareCompact, previewCompact: compactSnapshot, combineProposals, schedule, drain(options) {
        if (!draining) draining = runJobs(options).finally(() => { draining = undefined; });
        return draining;
    } };
}
