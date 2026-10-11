import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryService } from '../../../../src/conversation/memory/index.js';
import { fakeStore } from './fake-store.mjs';

function setup() {
    const store = fakeStore({ completed: 8, active: true });
    store.snapshot.messages.forEach(m => { m.content = 'fact '.repeat(150); });
    store.snapshot.resources[0].data.workingBudget = 5500;
    return store;
}
const opts = { turnId: 'active', attemptEpoch: 1 };
const summary = () => ({ chapter: 'chapter', rolling: 'rolling' });

test('two prepared batches and a failed final compile leave store and initial snapshot unchanged', async () => {
    const store = setup(), initial = store.getConversation(), original = structuredClone(initial);
    const memory = createMemoryService({ store, generate: async () => summary() });
    const first = await memory.prepareCompact(initial, opts);
    const second = await memory.prepareCompact(first.snapshot, opts);
    const merged = memory.combineProposals([first.proposal, second.proposal], initial);
    const preview = memory.previewCompact(initial, merged);
    assert.equal(preview.folds.length, 2); assert.equal(merged.expectedMemoryRevision, initial.conversation.memoryRevision);
    assert.equal(merged.turnId, 'active'); assert.equal(merged.attemptEpoch, 1);
    const ids1 = new Set(first.proposal.folds[0].sourceRefs.map(r => r.messageId));
    assert.ok(second.proposal.folds[0].sourceRefs.every(r => !ids1.has(r.messageId)));
    assert.ok(merged.folds.every(f => f.sourceRefs.every(r => r.messageId !== 'm8')));
    assert.ok(second.proposal.summaries.at(-1).parentSummaryRefs.some(r => first.proposal.summaries.some(s => s.id === r.id)));
    assert.throws(() => { throw Object.assign(new Error('compile over budget'), { code: 'budget-blocked' }); });
    assert.deepEqual(initial, original); assert.deepEqual(store.getConversation(), original); assert.equal(store.commits.length, 0);
    // Runtime alone authorizes the final commit after its compiler accepts preview.
    store.commitDerived('c', merged); assert.equal(store.commits.length, 1);
});

test('second generation failure or abort cannot retain the first speculative fold', async () => {
    for (const abort of [false, true]) {
        const store = setup(), initial = store.getConversation(), controller = new AbortController(); let calls = 0;
        const memory = createMemoryService({ store, generate: async () => { if (++calls === 2) { if (abort) controller.abort(); else throw new Error('generation failed'); } return summary(); } });
        const first = await memory.prepareCompact(initial, opts);
        await assert.rejects(memory.prepareCompact(first.snapshot, { ...opts, signal: controller.signal }));
        assert.deepEqual(store.getConversation(), initial); assert.equal(store.commits.length, 0);
    }
});

test('same-memory updates collapse to initial CAS revision and final preview matches merged version', async () => {
    const store = setup();
    store.snapshot.memories.push({ id: 'existing', revision: 3, status: 'valid', kind: 'world-state', origin: 'automatic', locked: false, content: 'before', sourceRefs: [], resourceRefs: [] });
    let calls = 0;
    const memory = createMemoryService({ store, generate: async request => ({ ...summary(), memories: [{ id: 'existing', op: 'update', expectedBlockRevision: request.memories.find(m => m.id === 'existing').revision, content: `pass${++calls}` }] }) });
    const initial = store.getConversation(), first = await memory.prepareCompact(initial, opts), second = await memory.prepareCompact(first.snapshot, opts);
    assert.equal(second.snapshot.memories[0].revision, 5);
    const merged = memory.combineProposals([first.proposal, second.proposal], initial), preview = memory.previewCompact(initial, merged);
    assert.equal(merged.memories.length, 1); assert.equal(merged.memories[0].expectedBlockRevision, 3); assert.equal(merged.memories[0].revision, 4);
    assert.equal(preview.memories[0].revision, 4); assert.equal(preview.memories[0].content, 'pass2');
    assert.ok(first.proposal.memories[0].sourceRefs.every(ref => merged.memories[0].sourceRefs.some(r => r.messageId === ref.messageId)));
    assert.equal(store.snapshot.memories[0].content, 'before'); assert.equal(store.commits.length, 0);
});

test('new-memory update collapses to create; create then delete leaves no phantom memory', async () => {
    for (const op of ['update', 'delete']) {
        const store = setup(); let calls = 0;
        const memory = createMemoryService({ store, generate: async request => ({ ...summary(), memories: ++calls === 1 ? [{ content: 'first' }] : [{ id: request.memories[0].id, expectedBlockRevision: 1, op, content: 'last' }] }) });
        const initial = store.getConversation(), first = await memory.prepareCompact(initial, opts), second = await memory.prepareCompact(first.snapshot, opts);
        const merged = memory.combineProposals([first.proposal, second.proposal], initial), preview = memory.previewCompact(initial, merged);
        if (op === 'delete') { assert.equal(merged.memories.length, 0); assert.equal(preview.memories.length, 0); }
        else { assert.equal(merged.memories[0].op, 'create'); assert.equal(merged.memories[0].revision, 1); assert.equal(merged.memories[0].expectedBlockRevision, 0); assert.equal(preview.memories[0].content, 'last'); }
    }
});

test('merge rejects stale base, missing prepared parents, mixed epochs and a third pass', async () => {
    const store = setup(), initial = store.getConversation(), memory = createMemoryService({ store, generate: async () => summary() });
    const first = await memory.prepareCompact(initial, opts), second = await memory.prepareCompact(first.snapshot, opts);
    assert.throws(() => memory.combineProposals([first.proposal, second.proposal, second.proposal], initial), { code: 'invalid-compaction' });
    assert.throws(() => memory.combineProposals([first.proposal, { ...second.proposal, attemptEpoch: 2 }], initial), { code: 'invalid-compaction' });
    assert.throws(() => memory.combineProposals([second.proposal], initial), { code: 'source-conflict' });
    const changed = structuredClone(initial); changed.messages[0].revision++;
    assert.throws(() => memory.combineProposals([first.proposal], changed), { code: 'source-conflict' });
    changed.conversation.memoryRevision++;
    assert.throws(() => memory.previewCompact(changed, first.proposal), { code: 'revision-conflict' });
});

test('prepared updates require expectedBlockRevision and do not interpret legacy expectedRevision', async () => {
    const store = setup();
    store.snapshot.memories.push({ id: 'existing', revision: 3, status: 'valid', kind: 'world-state', origin: 'automatic', locked: false, content: 'old', sourceRefs: [], resourceRefs: [] });
    const service = createMemoryService({ store, generate: async () => ({ chapter: 'summary', memories: [{ id: 'existing', expectedBlockRevision: 3, op: 'update', content: 'new' }] }) });
    const initial = store.getConversation(), { proposal } = await service.prepareCompact(initial, opts);
    proposal.memories[0].expectedRevision = 3;
    delete proposal.memories[0].expectedBlockRevision;
    assert.throws(() => service.previewCompact(initial, proposal), { code: 'revision-conflict' });
});
