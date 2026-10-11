import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageJobService } from '../../../../src/conversation/composition/image-jobs.js';

function setup(adapter = {}) {
    const job = { id: 'j', kind: 'provider-request', dependencies: { origin: 'tool', kind: 'image' }, payload: { jobId: 'remote-existing', connectionId: 'c', connectionRevision: 2, provider: 'horde', model: 'image', state: 'unknown' }, status: 'failed' };
    const record = { id: 'tool', conversationId: 'conversation', turnId: 'turn', name: 'generate_image', args: { prompt: 'draw' }, status: 'unknown' };
    let busy = false, recovered = 0, queries = 0, cancels = 0;
    const store = {
        getConversation: () => ({ conversation: { activeTurnId: busy ? 'other' : null } }),
        listJobs: cid => cid === 'conversation' ? [structuredClone(job)] : [],
        getTool: () => structuredClone(record),
        updateJob(id, patch) { assert.equal(id, 'j'); Object.assign(job, structuredClone(patch)); return structuredClone(job); },
        recoverTool(id, patch) { assert.equal(id, 'tool'); assert.equal(busy, false); Object.assign(record, patch); recovered++; },
    };
    const service = createImageJobService({ store,
        connectionFor(id, revision) { assert.equal(id, 'c'); assert.equal(revision, 2); return { provider: 'horde', model: 'image' }; },
        registerMedia: async () => [{ attachmentId: 'saved', type: 'image' }],
        accountingFor: () => ({ onRequest() {}, finish() {}, fail() {} }),
        createAdapter: () => ({
            async generateImage(input) { queries++; assert.equal(input.jobId, 'remote-existing'); assert.equal(input.prompt, 'draw'); return { images: [], usage: { cost: null } }; },
            async cancelJob(id) { cancels++; assert.equal(id, 'remote-existing'); },
            ...adapter,
        }),
    });
    return { service, job, record, state: () => ({ recovered, queries, cancels }), busy(value) { busy = value; } };
}

test('explicit image recovery uses saved handle and frozen connection; completed replay is local', async () => {
    const h = setup();
    const result = await h.service.resume('conversation', 'j');
    assert.equal(result.status, 'completed');
    assert.equal(result.payload.result.media[0].attachmentId, 'saved');
    assert.equal(h.record.status, 'completed');
    await h.service.resume('conversation', 'j');
    assert.deepEqual(h.state(), { queries: 1, recovered: 1, cancels: 0 });
    await h.service.close();
});

test('missing handle, other conversation, active turn and new submission are rejected', async () => {
    const h = setup();
    await assert.rejects(h.service.resume('other', 'j'), { code: 'invalid-provider-job' });
    h.busy(true);
    await assert.rejects(h.service.resume('conversation', 'j'), { code: 'conversation-busy' });
    h.busy(false); delete h.job.payload.jobId;
    await assert.rejects(h.service.resume('conversation', 'j'), { code: 'provider-job-unknown' });
    assert.equal(h.state().queries, 0);
    const changed = setup({ generateImage: async input => { await input.onJob({ jobId: 'new', state: 'submitting' }); } });
    await assert.rejects(changed.service.resume('conversation', 'j'), { code: 'provider-job-conflict' });
    assert.equal(changed.job.payload.jobId, 'remote-existing');
    assert.equal(changed.record.status, 'unknown');
});

test('cancel preserves unknown tool outcome and does not submit or repeat cancellation', async () => {
    const h = setup();
    await h.service.cancel('conversation', 'j'); await h.service.cancel('conversation', 'j');
    assert.equal(h.job.payload.state, 'cancel-requested');
    assert.equal(h.record.status, 'unknown');
    assert.deepEqual(h.state(), { queries: 0, recovered: 0, cancels: 1 });
});

test('one query per job; shutdown aborts and joins without losing its handle', async () => {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const h = setup({ generateImage: input => new Promise((resolve, reject) => {
        started(); input.signal.addEventListener('abort', () => reject(Object.assign(Error(), { code: 'aborted' })), { once: true });
    }) });
    const pending = h.service.resume('conversation', 'j');
    await ready;
    assert.equal(h.service.busy(), true);
    await assert.rejects(h.service.resume('conversation', 'j'), { code: 'provider-job-busy' });
    const rejected = assert.rejects(pending, { code: 'aborted' });
    await h.service.close(); await rejected;
    assert.equal(h.job.payload.jobId, 'remote-existing');
    assert.equal(h.service.busy(), false);
    await assert.rejects(h.service.resume('conversation', 'j'), { code: 'service-closed' });
});
