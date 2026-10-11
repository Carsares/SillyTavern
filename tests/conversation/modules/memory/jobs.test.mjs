import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryService } from '../../../../src/conversation/memory/index.js';
import { fakeStore } from './fake-store.mjs';
const generate = async () => ({ chapter: 'summary', memories: [] });

test('background uses one-argument atomic job port, never split derived/completed writes', async () => {
    const store = fakeStore(); const atomic = store.commitDerivedJob.bind(store), update = store.updateJob.bind(store); let count = 0;
    store.updateJob = (id, patch) => { assert.notEqual(patch.status, 'completed'); return update(id, patch); };
    store.commitDerivedJob = (...args) => { assert.equal(args.length, 1); assert.ok(store.jobs.get(args[0]).result.proposal); count++; return atomic(...args); };
    const memory = createMemoryService({ store, generate }); memory.schedule('c'); await memory.drain();
    assert.equal(count, 1); assert.equal(store.commits.length, 1); assert.equal([...store.jobs.values()][0].status, 'completed');
});

test('atomic completion acknowledgement loss never overwrites completed or regenerates', async () => {
    const store = fakeStore(), atomic = store.commitDerivedJob.bind(store);
    store.commitDerivedJob = id => { atomic(id); throw new Error('lost acknowledgement'); };
    const memory = createMemoryService({ store, generate }); memory.schedule('c');
    assert.equal((await memory.drain())[0].status, 'completed'); assert.equal([...store.jobs.values()][0].status, 'completed');
    await createMemoryService({ store, generate: () => assert.fail('completed job must not regenerate') }).drain();
    assert.equal(store.commits.length, 1);
});

test('failed local atomic commit keeps ready proposal for recovery without a model retry', async () => {
    const store = fakeStore(), atomic = store.commitDerivedJob.bind(store);
    store.commitDerivedJob = () => { throw new Error('storage unavailable'); };
    const memory = createMemoryService({ store, generate }); memory.schedule('c');
    assert.equal((await memory.drain())[0].status, 'ready'); assert.equal([...store.jobs.values()][0].status, 'ready'); assert.equal(store.commits.length, 0);
    store.commitDerivedJob = atomic;
    await createMemoryService({ store, generate: () => assert.fail('reuse persisted ready result') }).drain();
    assert.equal(store.commits.length, 1); assert.equal([...store.jobs.values()][0].attempts, 1);
});

test('recomputation updates original job dependencies before the second generation and atomic commit', async () => {
    const store = fakeStore(); let calls = 0;
    const memory = createMemoryService({ store, generate: async request => {
        calls++;
        assert.equal([...store.jobs.values()][0].dependencies.sourceRefs[0].revision, request.messages[0].revision);
        if (calls === 1) store.snapshot.messages[0].revision++;
        return generate();
    } });
    const job = memory.schedule('c'); await memory.drain();
    assert.equal(calls, 2); assert.equal(store.jobs.get(job.id).attempts, 2); assert.equal(store.jobs.get(job.id).status, 'completed');
    assert.equal(store.jobs.get(job.id).dependencies.sourceRefs[0].revision, 2); assert.equal(store.commits.length, 1);
});

test('missing atomic port fails closed before generating or changing pending jobs', async () => {
    const store = fakeStore(); delete store.commitDerivedJob;
    const memory = createMemoryService({ store, generate: () => assert.fail('atomic persistence required') }); const job = memory.schedule('c');
    await assert.rejects(memory.drain(), { code: 'atomic-job-commit-required' }); assert.equal(store.jobs.get(job.id).status, 'pending'); assert.equal(store.commits.length, 0);
});
