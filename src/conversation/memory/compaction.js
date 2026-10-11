import { invariant } from '../../../public/shared/conversation/schemas/index.js';
import { derivedSources, resourcesValid, sourcesValid, uniqueRefs } from './sources.js';
const copy = structuredClone;
const kinds = ['summaries', 'memories', 'folds'];

/** A disposable compiler view; no store writes and no committed revision advance. */
export function compactSnapshot(snapshot, proposal) {
    invariant(proposal.expectedMemoryRevision === snapshot.conversation.memoryRevision, 'revision-conflict', 'Compaction base revision changed', 409);
    invariant(sourcesValid(proposal.sourceRefs, snapshot) && resourcesValid(proposal.resourceRefs, snapshot), 'source-conflict', 'Compaction sources changed', 409);
    const view = copy(snapshot), cid = snapshot.conversationId;
    for (const kind of kinds) {
        invariant(Array.isArray(proposal[kind]), 'invalid-compaction', 'Compaction requires all derived collections');
        invariant(new Set(proposal[kind].map(b => b.id)).size === proposal[kind].length, 'invalid-compaction', 'Duplicate derived targets');
        for (const input of proposal[kind]) {
            const index = view[kind].findIndex(b => b.id === input.id), old = view[kind][index];
            if (old) {
                invariant(!old.locked && old.origin !== 'manual', 'memory-protected', 'Automatic compaction cannot replace protected blocks', 409);
                invariant(input.expectedBlockRevision === old.revision, 'revision-conflict', 'Prepared block revision changed', 409);
            } else invariant((input.expectedBlockRevision ?? 0) === 0, 'revision-conflict', 'Prepared block is missing', 409);
            const block = { ...copy(input), conversationId: cid, revision: (old?.revision ?? 0) + 1,
                status: input.op === 'delete' ? 'stale' : 'valid', origin: 'automatic', locked: false,
                scopeTurnId: proposal.turnId ?? null, scopeAttemptEpoch: proposal.attemptEpoch ?? null };
            if (index < 0) view[kind].push(block); else view[kind][index] = block;
        }
    }
    for (const kind of kinds) for (const input of proposal[kind]) {
        const block = view[kind].find(b => b.id === input.id);
        invariant(sourcesValid(block.sourceRefs, view) && resourcesValid(block.resourceRefs, view)
            && (block.status !== 'valid' || derivedSources(block, view)), 'source-conflict', 'Invalid prepared dependencies', 409);
        if (kind === 'folds') invariant(view.summaries.some(s => s.id === block.summaryRef?.id && s.revision === block.summaryRef.revision && derivedSources(s, view)),
            'source-conflict', 'Prepared fold requires a valid prepared summary', 409);
    }
    return view;
}

/** Collapse at most two speculative passes into one CAS update against the initial view. */
export function combineProposals(proposals, initialSnapshot) {
    invariant(Array.isArray(proposals) && proposals.length >= 1 && proposals.length <= 2, 'invalid-compaction', 'Combine one or two compaction proposals');
    const first = proposals[0];
    let view = initialSnapshot;
    for (const proposal of proposals) {
        invariant(proposal.turnId === first.turnId && proposal.attemptEpoch === first.attemptEpoch,
            'invalid-compaction', 'Prepared proposals must belong to the same turn attempt', 409);
        view = compactSnapshot(view, proposal);
    }
    const memories = new Map();
    for (const proposal of proposals) for (const block of proposal.memories) {
        const previous = memories.get(block.id);
        memories.set(block.id, { ...copy(block), sourceRefs: uniqueRefs([...(previous?.sourceRefs ?? []), ...block.sourceRefs]),
            resourceRefs: uniqueRefs([...(previous?.resourceRefs ?? []), ...(block.resourceRefs ?? [])]) });
    }
    const merged = { compressionPolicies: proposals.flatMap(p => p.compressionPolicies ?? (p.compressionPolicy ? [copy(p.compressionPolicy)] : [])), summaries: proposals.flatMap(p => copy(p.summaries)), folds: proposals.flatMap(p => copy(p.folds)),
        memories: [...memories.values()].flatMap(block => {
            const original = initialSnapshot.memories.find(m => m.id === block.id);
            if (!original && block.op === 'delete') return [];
            return [{ ...block, expectedBlockRevision: original?.revision ?? 0, revision: (original?.revision ?? 0) + 1,
                op: block.op === 'delete' ? 'delete' : original ? 'update' : 'create' }];
        }),
        sourceRefs: uniqueRefs(proposals.flatMap(p => p.sourceRefs)), resourceRefs: uniqueRefs(proposals.flatMap(p => p.resourceRefs)),
        expectedMemoryRevision: initialSnapshot.conversation.memoryRevision,
        ...(first.turnId !== undefined ? { turnId: first.turnId } : {}), ...(first.attemptEpoch !== undefined ? { attemptEpoch: first.attemptEpoch } : {}) };
    // Validate the collapsed revision graph, including first-pass summaries used by
    // second-pass rolling summaries, before handing it to the sole store commit.
    compactSnapshot(initialSnapshot, merged);
    return merged;
}
