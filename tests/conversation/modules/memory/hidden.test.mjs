import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceRef } from '../../../../public/shared/conversation/schemas/index.js';
import { createMemoryService, memoryProposal } from '../../../../src/conversation/memory/index.js';
import { sourcesValid, derivedSources, summaryParents, searchableEntries } from '../../../../src/conversation/memory/sources.js';
import { fakeStore } from './fake-store.mjs';

function setup() {
    const store = fakeStore({ completed: 6, settings: { memoryFrequency: 1 } });
    store.snapshot.messages[0].userHidden = true;
    store.snapshot.messages[0].content = 'HIDDEN_RAW';
    const ref = sourceRef(store.snapshot.messages[0]);
    const summary = { id: 'hidden-summary', revision: 1, status: 'valid', kind: 'chapter', content: 'HIDDEN_CHAPTER', sourceRefs: [ref] };
    const rolling = { id: 'hidden-rolling', revision: 1, status: 'valid', kind: 'rolling', content: 'HIDDEN_ROLLING', sourceRefs: [], parentSummaryRefs: [{ id: summary.id, revision: 1 }] };
    store.snapshot.summaries.push(summary, rolling);
    store.snapshot.memories.push({ id: 'hidden-memory', revision: 1, status: 'valid', kind: 'user-fact', content: 'HIDDEN_MEMORY', sourceRefs: [], parentSummaryRefs: [{ id: rolling.id, revision: 1 }] });
    return { store, ref };
}

test('hidden sources invalidate direct and transitive derived blocks even while status remains valid', () => {
    const { store, ref } = setup(), snapshot = store.getConversation();
    assert.equal(sourcesValid([ref], snapshot), false);
    for (const block of [...snapshot.summaries, ...snapshot.memories]) assert.equal(derivedSources(block, snapshot), null);
    assert.deepEqual(summaryParents(snapshot), []);
    assert.ok(!JSON.stringify(searchableEntries(snapshot)).includes('HIDDEN_'));
    assert.throws(() => memoryProposal(snapshot, { content: 'reintroduce' }, [ref]), { code: 'invalid-memory' });
});

test('foreground and background auxiliary inputs exclude hidden raw and all dependent text', async () => {
    for (const foreground of [true, false]) {
        const { store } = setup(); let request;
        const service = createMemoryService({ store, generate: async input => { request = input; return { chapter: 'visible facts only' }; } });
        if (foreground) {
            const { proposal } = await service.prepareCompact(store.getConversation());
            assert.ok(proposal.sourceRefs.every(ref => ref.messageId !== 'm1'));
        } else {
            const job = service.schedule('c');
            assert.ok(job.dependencies.sourceRefs.every(ref => ref.messageId !== 'm1'));
            await service.drain();
        }
        assert.ok(request);
        assert.ok(!JSON.stringify(request).includes('HIDDEN_'));
        assert.deepEqual(request.summaries, []); assert.deepEqual(request.memories, []);
        assert.equal(store.snapshot.messages[0].userHidden, true);
        assert.equal(store.snapshot.messages[0].content, 'HIDDEN_RAW');
    }
});

test('preview rejects a proposal if its source is hidden after preparation without changing revision', async () => {
    const store = fakeStore({ completed: 3 });
    const service = createMemoryService({ store, generate: async () => ({ chapter: 'summary' }) });
    const { proposal } = await service.prepareCompact(store.getConversation());
    const snapshot = store.getConversation();
    snapshot.messages.find(m => m.id === proposal.sourceRefs[0].messageId).userHidden = true;
    assert.throws(() => service.previewCompact(snapshot, proposal), { code: 'source-conflict' });
    assert.equal(store.commits.length, 0);
});
