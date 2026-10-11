import test from 'node:test';
import assert from 'node:assert/strict';
import { auxiliaryBudget } from '../../../../src/conversation/memory/budget.js';
import { createMemoryService } from '../../../../src/conversation/memory/index.js';
import { fakeStore } from './fake-store.mjs';

function setup(auxiliary) {
    const store = fakeStore({ completed: 100 });
    store.snapshot.resources[0].data.auxiliary = auxiliary;
    for (const [id, workingBudget] of [['memory', 4000], ['summary', 5000], ['summarization', 6000], ['explicit', 7000]]) {
        store.snapshot.resources.push({ id, revision: 4, kind: 'connection', data: { contextWindow: 16000, inputLimit: 15000, maxOutputTokens: 1000, workingBudget } });
    }
    return store;
}

test('frozen auxiliary selection uses explicit then memory/summary/summarization then primary', () => {
    const cases = [
        [{ memory: 'memory', summary: 'summary', summarization: 'summarization' }, 'memory'],
        [{ memory: { connectionId: 'memory' }, summary: 'summary' }, 'memory'],
        [{ memory: '', summary: { connectionId: 'summary' }, summarization: 'summarization' }, 'summary'],
        [{ summary: null, summarization: { connectionId: 'summarization' } }, 'summarization'],
        [{ memory: {}, summary: '', summarization: null }, 'connection'],
    ];
    for (const [auxiliary, expected] of cases) {
        const store = setup(auxiliary);
        assert.equal(auxiliaryBudget(store.getConversation()).connectionId, expected);
        store.snapshot.settings.auxiliaryConnectionId = 'explicit';
        assert.equal(auxiliaryBudget(store.getConversation()).connectionId, 'explicit');
    }
});

test('missing nested connection and missing primary setting do not silently select another budget', () => {
    const store = setup({ memory: 'missing', summary: 'summary' });
    assert.throws(() => auxiliaryBudget(store.getConversation()), { code: 'budget-blocked' });
    store.snapshot.settings.auxiliaryConnectionId = 'missing-explicit';
    assert.throws(() => auxiliaryBudget(store.getConversation()), { code: 'budget-blocked' });
    const single = fakeStore(); delete single.snapshot.settings.connectionId;
    assert.throws(() => auxiliaryBudget(single.getConversation()), { code: 'budget-blocked' });
});

test('selection and budget use frozen resource values, including conversation.settings fallback', () => {
    const store = setup({ summary: 'summary' }), frozen = store.getConversation();
    store.snapshot.resources[0].data.auxiliary = { memory: 'memory' };
    store.snapshot.resources.find(r => r.id === 'summary').data.workingBudget = 10000;
    frozen.conversation.settings = frozen.settings; delete frozen.settings;
    const budget = auxiliaryBudget(frozen);
    assert.equal(budget.connectionId, 'summary'); assert.equal(budget.workingBudget, 5000);
});

test('nested auxiliary compression batches use selected limits and retain its resource revision', async () => {
    const store = setup({ summary: { connectionId: 'summary' } });
    let request;
    await createMemoryService({ store, generate: async input => { request = input; return { chapter: 'Bounded summary' }; } }).compact(store.getConversation());
    assert.equal(request.inputBudget.connectionId, 'summary'); assert.equal(request.inputBudget.workingBudget, 5000);
    assert.ok(request.estimatedInputTokens <= 5000); assert.ok(request.messages.length > 0 && request.messages.length < 99);
    assert.ok(store.commits[0].resourceRefs.some(ref => ref.id === 'summary' && ref.revision === 4));
});

test('foreground prefers last 20 messages, passes half-budget target and records bounded batches', async () => {
    const store = fakeStore({ completed: 40 }); let request;
    const memory = createMemoryService({ store, generate: async input => { request = input; return { chapter: 'brief' }; } });
    const { proposal } = await memory.prepareCompact(store.getConversation());
    assert.equal(request.compressionPolicy.targetTokens, 16384);
    assert.deepEqual(proposal.compressionPolicy.retainedMessageIds, store.snapshot.messages.slice(-20).map(m => m.id));
    assert.ok(proposal.folds[0].sourceRefs.every(r => Number(r.messageId.slice(1)) <= 20));
    assert.equal(request.compressionPolicy.summaryTargetTokens, Math.floor(Buffer.byteLength(request.messages.map(m => m.content).join('')) / 2));
    assert.deepEqual(memory.combineProposals([proposal], store.getConversation()).compressionPolicies, [proposal.compressionPolicy]);
});

test('recent preferences explicitly relax for short history and oversized mandatory last turn', async () => {
    const store = fakeStore({ completed: 3 });
    store.snapshot.messages.at(-1).content = 'x'.repeat(17000);
    const memory = createMemoryService({ store, generate: async () => ({ chapter: 'summary' }) });
    const { proposal } = await memory.prepareCompact(store.getConversation());
    const policy = proposal.compressionPolicy;
    assert.deepEqual(policy.retainedMessageIds, ['m3']);
    assert.ok(policy.relaxReasons.includes('latest-complete-turn-exceeds-recent-token-preference'));
    assert.ok(!proposal.folds[0].sourceRefs.some(r => r.messageId === 'm3'));
    assert.equal(store.commits.length, 0);
});
