import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareProviderJob } from '../../../../src/conversation/composition/provider-jobs.js';

function setup() {
    const jobs = new Map();
    const turns = { t: { conversationId: 'c', request: {} }, retry: { conversationId: 'c', request: { retryTurnId: 't' } } };
    const store = {
        getTurn: id => turns[id], listJobs: () => [...jobs.values()],
        createJob: input => { const job = { ...structuredClone(input), id: `job-${jobs.size}`, status: 'pending' }; jobs.set(job.id, job); return structuredClone(job); },
        updateJob: async (id, patch) => { await new Promise(resolve => setImmediate(resolve)); Object.assign(jobs.get(id), structuredClone(patch)); return structuredClone(jobs.get(id)); },
    };
    const input = { store, conversationId: 'c', turnId: 't', connection: { id: 'conn', revision: 1, provider: 'horde', model: 'unit' }, request: { prompt: 'text' }, kind: 'text', traceId: 'trace-first' };
    return { store, jobs, input };
}

test('Horde saves intent before submit and awaits job persistence before owner callback', async () => {
    const { input, jobs } = setup();
    let called = false;
    const port = prepareProviderJob({ ...input, onJob: async value => {
        assert.equal(jobs.get(port.id).payload.jobId, value.jobId);
        assert.equal(jobs.get(port.id).status, 'running');
        await new Promise(resolve => setImmediate(resolve)); called = true;
    } });
    assert.equal(jobs.size, 1); assert.equal(port.jobId, undefined);
    await port.onJob({ jobId: 'remote-id', kind: 'text', state: 'submitted' });
    assert.equal(called, true);
    await port.fail();
    const resumed = prepareProviderJob({ ...input, turnId: 'retry', traceId: 'trace-new' });
    assert.equal(resumed.jobId, 'remote-id');
    assert.equal(resumed.id, port.id); assert.equal(resumed.traceId, 'trace-first');
    await resumed.onJob({ jobId: resumed.jobId, kind: 'text', state: 'resumed' });
    await resumed.finish();
    assert.equal(jobs.get(port.id).status, 'completed');
});

test('uncertain submit without persisted ID refuses resubmission even after a restart', () => {
    const { input } = setup();
    prepareProviderJob(input);
    assert.throws(() => prepareProviderJob({ ...input, turnId: 'retry' }), { code: 'provider-job-unknown' });
});

test('persisted provider jobs reject changed connection or remote job identity', async () => {
    const { input } = setup();
    const port = prepareProviderJob(input);
    await port.onJob({ jobId: 'remote-id', state: 'submitted', kind: 'text' });
    assert.throws(() => prepareProviderJob({ ...input, connection: { ...input.connection, revision: 2 } }), { code: 'provider-job-conflict' });
    assert.throws(() => prepareProviderJob({ ...input, jobId: 'other-id' }), { code: 'provider-job-conflict' });
    await assert.rejects(port.onJob({ jobId: 'other-id' }), { code: 'provider-job-conflict' });
});

test('memory inputs and group members receive distinct provider jobs', async () => {
    const { input, jobs } = setup();
    prepareProviderJob({ ...input, kind: 'memory' });
    prepareProviderJob({ ...input, kind: 'memory', request: { prompt: 'different' } });
    prepareProviderJob({ ...input, memberRunId: 'a' });
    prepareProviderJob({ ...input, memberRunId: 'b' });
    assert.equal(jobs.size, 4);
});

test('queued auxiliary handles persist submitting and resume without another submission', async () => {
    const { input, jobs } = setup();
    const handle = 'aux1.eyJyZW1vdGVJZCI6InJlbW90ZSJ9';
    const notifications = [];
    const port = prepareProviderJob({ ...input, kind: 'image', onJob: value => notifications.push(value) });
    await port.onJob({ jobId: null, state: 'submitting', kind: 'image' });
    assert.equal(jobs.get(port.id).payload.state, 'submitting');
    assert.equal(jobs.get(port.id).payload.jobId, undefined);
    await port.onJob({ jobId: handle, state: 'submitted', kind: 'image' });
    await port.fail();
    const resumed = prepareProviderJob({ ...input, kind: 'image', turnId: 'retry', jobId: handle });
    assert.equal(resumed.jobId, handle);
    await assert.rejects(resumed.onJob({ jobId: null, state: 'submitting', kind: 'image' }), { code: 'provider-job-conflict' });
    await resumed.onJob({ jobId: handle, state: 'resumed', kind: 'image' });
    assert.equal(notifications.length, 2);
});

test('async queue detection follows capabilities and API aliases', async () => {
    const { supportsAsyncJobs } = await import('../../../../src/conversation/composition/provider-jobs.js');
    for (const imageApi of ['comfy-image', 'bfl-image', 'fal-image', 'horde-image']) assert.equal(supportsAsyncJobs({ imageApi }), true);
    assert.equal(supportsAsyncJobs({ asyncJobs: true, api: 'future-queue' }), true);
    assert.equal(supportsAsyncJobs({ api: 'openai-auxiliary' }), false);
});
