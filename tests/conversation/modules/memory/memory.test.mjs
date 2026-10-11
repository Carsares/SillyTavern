import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryService } from '../../../../src/conversation/memory/index.js';
import { fakeStore } from './fake-store.mjs';

const generate = async () => ({ chapter: 'The dragon arrived.', rolling: 'A dragon arrived.', memories: [{ kind: 'world-state', content: 'Dragon present.' }] });
test('schedule only every five completed turns and dedupe dependencies', () => {
    const store = fakeStore({ completed: 4 });
    const memory = createMemoryService({ store, generate });
    assert.equal(memory.schedule('c'), null);
    const five = fakeStore(); const service = createMemoryService({ store: five, generate });
    assert.equal(service.schedule('c').id, service.schedule('c').id); assert.equal(five.jobs.size, 1);
});
test('ready results persist while active, then commit together without regenerating', async () => {
    const store = fakeStore({ active: true }); let calls = 0;
    const service = createMemoryService({ store, generate: async () => { calls++; return generate(); } });
    service.schedule('c'); await service.drain();
    assert.equal([...store.jobs.values()][0].status, 'ready'); assert.equal(store.commits.length, 0);
    store.snapshot.conversation.activeTurnId = null;
    await createMemoryService({ store, generate: () => assert.fail('must reuse persisted proposal') }).drain();
    assert.equal(calls, 1); assert.equal(store.commits.length, 1);
    assert.equal(store.commits[0].summaries.length, 2); assert.equal(store.commits[0].folds.length, 0); assert.equal(store.commits[0].memories.length, 1);
});
test('source changes cause at most one recomputation', async () => {
    const store = fakeStore(); let calls = 0;
    const service = createMemoryService({ store, generate: async () => { calls++; store.snapshot.messages[0].revision++; return generate(); } });
    service.schedule('c'); await service.drain(); await service.drain();
    assert.equal(calls, 2); assert.equal([...store.jobs.values()][0].status, 'stale'); assert.equal(store.commits.length, 0);
});
test('foreground excludes latest complete turn and submits epoch atomically', async () => {
    const store = fakeStore({ active: true });
    const service = createMemoryService({ store, generate });
    await service.compact(store.getConversation(), { turnId: 'active', attemptEpoch: 1, budget: 1000 });
    assert.equal(store.commits.length, 1); assert.equal(store.commits[0].sourceRefs.length, 4); assert.equal(store.commits[0].attemptEpoch, 1);
});
test('empty or overbudget summaries do not fold history', async () => {
    for (const output of [{ chapter: '' }, { chapter: 'long summary' }]) {
        const store = fakeStore(); const service = createMemoryService({ store, generate: async () => output });
        await assert.rejects(service.compact(store.getConversation(), { budget: 1 })); assert.equal(store.commits.length, 0);
    }
});
test('manual memory and locked blocks cannot be overwritten by generator', async () => {
    const store = fakeStore(); store.snapshot.memories.push({ id: 'manual', revision: 1, locked: true, origin: 'manual', content: 'fixed' });
    const service = createMemoryService({ store, generate: async () => ({ chapter: 'summary', memories: [{ id: 'manual', expectedBlockRevision: 1, content: 'overwrite' }] }) });
    await assert.rejects(service.compact(store.getConversation()), { code: 'memory-protected' }); assert.equal(store.commits.length, 0);
});
test('rolling summary preserves transitive source and parent refs', async () => {
    const store = fakeStore(); const ref = { messageId: 'm5', revision: 1, candidateId: 'a5', candidateRevision: 1 };
    store.snapshot.summaries.push({ id: 'parent', kind: 'chapter', revision: 2, status: 'valid', content: 'old', sourceRefs: [ref] });
    await createMemoryService({ store, generate }).compact(store.getConversation());
    const rolling = store.commits[0].summaries[1]; assert.equal(rolling.sourceRefs.length, 5); assert.deepEqual(rolling.parentSummaryRefs[0], { id: 'parent', revision: 2 });
});
test('abort before generation or after generation prevents commits', async () => {
    const store = fakeStore(); const controller = new AbortController();
    const service = createMemoryService({ store, generate: async () => { controller.abort(); return generate(); } });
    await assert.rejects(service.compact(store.getConversation(), { signal: controller.signal })); assert.equal(store.commits.length, 0);
});
test('recovered running jobs with two attempts never call generator again', async () => {
    const store = fakeStore(); const service = createMemoryService({ store, generate: () => assert.fail('retry cap') });
    const job = service.schedule('c'); store.updateJob(job.id, { status: 'running', attempts: 2 });
    await service.drain(); assert.equal(store.jobs.get(job.id).status, 'stale');
});
test('background never folds latest history; later foreground still has compressible turns', async () => {
    const store = fakeStore(); const service = createMemoryService({ store, generate });
    service.schedule('c'); await service.drain();
    assert.equal(store.snapshot.folds.length, 0);
    await service.compact(store.getConversation());
    assert.equal(store.snapshot.folds.length, 1);
    assert.equal(store.snapshot.folds[0].sourceRefs.length, 4);
    assert.ok(store.snapshot.folds[0].sourceRefs.every(ref => ref.messageId !== 'm5'));
    assert.equal(store.commits[1].memories.length, 1, 'compression computes memories in the same atomic proposal');
});
test('summary parents include current rolling and uncovered chapters only', async () => {
    const store = fakeStore(); const ref = i => ({ messageId: `m${i}`, revision: 1, candidateId: `a${i}`, candidateRevision: 1 });
    store.snapshot.summaries = [
        { id: 'chapter1', kind: 'chapter', revision: 1, status: 'valid', content: 'chapter1', sourceRefs: [ref(1)] },
        { id: 'old', kind: 'rolling', revision: 1, status: 'valid', content: 'old', sourceRefs: [ref(1)] },
        { id: 'current', kind: 'rolling', revision: 1, status: 'valid', content: 'current', sourceRefs: [ref(1), ref(2)] },
        { id: 'uncovered', kind: 'chapter', revision: 1, status: 'valid', content: 'chapter3', sourceRefs: [ref(3)] },
    ];
    let observed;
    const service = createMemoryService({ store, generate: async request => { observed = request; return generate(); } });
    service.schedule('c'); await service.drain();
    assert.deepEqual(observed.summaries.map(s => s.id), ['current', 'uncovered']);
    assert.deepEqual(observed.messages.map(m => m.id), ['m4', 'm5']);
    assert.equal(store.commits[0].summaries[1].sourceRefs.length, 5);
});
test('memoryFrequency controls scheduling; invalid configuration is explicit', () => {
    const store = fakeStore({ completed: 3, settings: { memoryFrequency: 3 } });
    const service = createMemoryService({ store, generate }); assert.ok(service.schedule('c'));
    store.snapshot.settings.memoryFrequency = 4; assert.equal(service.schedule('c'), null);
    store.snapshot.settings.memoryFrequency = 0; assert.throws(() => service.schedule('c'), { code: 'invalid-memory-frequency' });
});
test('each derived block carries resource revisions and resource changes conflict atomically', async () => {
    const store = fakeStore(); store.snapshot.resources.push({ id: 'character', revision: 1 }, { id: 'worldbook', revision: 7 });
    const frozen = store.getConversation();
    await createMemoryService({ store, generate }).compact(frozen);
    const proposal = store.commits[0];
    for (const block of [...proposal.summaries, ...proposal.memories, ...proposal.folds]) assert.deepEqual(block.resourceRefs, frozen.resources.map(({ id, revision }) => ({ id, revision })));
    const competing = fakeStore(); competing.snapshot.resources.push({ id: 'character', revision: 1 });
    const service = createMemoryService({ store: competing, generate: async () => { competing.snapshot.resources[1].revision++; return generate(); } });
    await assert.rejects(service.compact(competing.getConversation()), { code: 'source-conflict' }); assert.equal(competing.commits.length, 0);
});
test('background with already summarized history completes without recomputation or folding', async () => {
    const store = fakeStore(); const service = createMemoryService({ store, generate });
    service.schedule('c'); await service.drain();
    const old = [...store.jobs.values()][0]; old.status = 'pending'; old.result = undefined; old.payload.snapshot = store.getConversation();
    await createMemoryService({ store, generate: () => assert.fail('already summarized') }).drain();
    assert.equal(store.commits.length, 1); assert.equal(old.status, 'completed');
});
test('1500-message summary input is bounded by auxiliary budget and advances oldest complete batches', async () => {
    const store = fakeStore({ completed: 1500 }); store.snapshot.resources[0].data.workingBudget = 5000;
    const requests = [];
    const service = createMemoryService({ store, generate: async request => { requests.push(request); return { chapter: 'Small summary', memories: [] }; } });
    await service.compact(store.getConversation());
    const first = requests[0];
    assert.ok(first.messages.length > 0 && first.messages.length < 1500);
    assert.equal(first.messages[0].id, 'm1'); assert.equal(first.snapshot.messages.length, first.messages.length);
    assert.ok(first.estimatedInputTokens <= 5000);
    // The newest complete turn is never included in a foreground batch.
    assert.ok(!first.messages.some(m => m.id === 'm1500'));
});
test('smallest full turn exceeding auxiliary limits fails without a model request or retry', async () => {
    const store = fakeStore(); store.snapshot.resources[0].data.workingBudget = 2200;
    const service = createMemoryService({ store, generate: () => assert.fail('must not call model') });
    await assert.rejects(service.compact(store.getConversation()), { code: 'budget-blocked' });
    service.schedule('c'); await service.drain(); await service.drain();
    assert.equal([...store.jobs.values()][0].attempts, 1); assert.equal([...store.jobs.values()][0].status, 'failed');
    assert.equal(store.commits.length, 0);
});
test('batch selection never separates user/assistant messages of one turn', async () => {
    const store = fakeStore();
    store.snapshot.messages.splice(0, 0, { ...store.snapshot.messages[0], id: 'user1', role: 'user', candidateId: null, candidateRevision: null, content: 'x'.repeat(3000) });
    store.snapshot.resources[0].data.workingBudget = 3000;
    await assert.rejects(createMemoryService({ store, generate: () => assert.fail('cannot truncate user message') }).compact(store.getConversation()), { code: 'budget-blocked' });
});
test('compression uses frozen auxiliaryConnectionId limits rather than main or memoryConnectionId', async () => {
    const store = fakeStore({ completed: 100 });
    store.snapshot.settings = { connectionId: 'connection', auxiliaryConnectionId: 'auxiliary', memoryConnectionId: 'connection' };
    store.snapshot.resources.push({ id: 'auxiliary', kind: 'connection', revision: 4,
        data: { contextWindow: 10000, inputLimit: 6000, maxOutputTokens: 2000, workingBudget: 4000 } });
    let request;
    await createMemoryService({ store, generate: async input => { request = input; return { chapter: 'Summary' }; } }).compact(store.getConversation());
    assert.equal(request.inputBudget.connectionId, 'auxiliary');
    assert.equal(request.inputBudget.hardInputBudget, 5744);
    assert.equal(request.inputBudget.workingBudget, 4000);
    assert.ok(request.estimatedInputTokens <= 4000); assert.ok(request.messages.length < 99);
    assert.ok(store.commits[0].resourceRefs.some(ref => ref.id === 'auxiliary' && ref.revision === 4));
});
test('missing configured auxiliary resource blocks instead of using larger primary limits', async () => {
    const store = fakeStore(); store.snapshot.settings = { connectionId: 'connection', auxiliaryConnectionId: 'missing' };
    await assert.rejects(createMemoryService({ store, generate: () => assert.fail('missing frozen connection') }).compact(store.getConversation()), { code: 'budget-blocked' });
    assert.equal(store.commits.length, 0);
});
test('small auxiliary window blocks even if primary window can fit the complete turn', async () => {
    const store = fakeStore(); store.snapshot.settings = { connectionId: 'connection', auxiliaryConnectionId: 'auxiliary' };
    store.snapshot.resources.push({ id: 'auxiliary', kind: 'connection', revision: 1,
        data: { contextWindow: 4000, inputLimit: 4000, maxOutputTokens: 2000, workingBudget: 4000 } });
    await assert.rejects(createMemoryService({ store, generate: () => assert.fail('auxiliary input is too small') }).compact(store.getConversation()), { code: 'budget-blocked' });
});
