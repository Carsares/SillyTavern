import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuxiliaryAdapter } from '../../../../src/conversation/providers/auxiliary/index.js';
import { decodeJob } from '../../../../src/conversation/providers/auxiliary/jobs.js';
const c = provider => ({ provider, type: 'image', model: provider === 'bfl' ? 'flux-pro' : 'flux/dev', baseUrl: 'https://queue.invalid/v1', maxPolls: 1, pollIntervalMs: 0, apiKey: 'fake-secret' });
const workflow = { '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'old' } }, '2': { class_type: 'CLIPTextEncode', inputs: { text: 'old' } } };
const comfy = { prompt: 'scene', workflow, bindings: { model: [['1','ckpt_name']], prompt: [['2','text']] } };

for (const provider of ['bfl','falai','comfy']) test(`${provider}: durable ID before poll; resumed job never submits again`, async () => {
    const events = [], calls = [];
    let complete = false, persisted;
    const config = c(provider);
    const fetch = async request => {
        const url = new URL(request.url); calls.push({ path: url.pathname, method: request.method });
        if (request.method === 'POST') {
            const body = await request.json();
            if (provider === 'comfy') { assert.equal(body.prompt['2'].inputs.text, 'scene'); assert.equal(body.prompt['1'].inputs.ckpt_name, config.model); }
            return Response.json(provider === 'comfy' ? { prompt_id: 'remote-job' } : provider === 'bfl' ? { id: 'remote-job' } : { request_id: 'remote-job', status_url: 'https://queue.invalid/v1/flux/dev/requests/remote-job/status', response_url: 'https://queue.invalid/v1/flux/dev/requests/remote-job/response' });
        }
        assert.ok(persisted, 'persisted before first GET');
        if (provider === 'comfy') {
            if (url.pathname.endsWith('/view')) return new Response('image', { headers: { 'content-type': 'image/png' } });
            return Response.json(complete ? { 'remote-job': { status: { completed: true, status_str: 'success' }, outputs: { '3': { images: [{ filename: 'out.png', type: 'output', subfolder: '' }] } } } } : {});
        }
        if (provider === 'bfl') return Response.json(complete ? { status: 'Ready', result: { sample: 'https://images.invalid/out.png' } } : { status: 'Pending' });
        if (url.pathname.endsWith('/response')) return Response.json({ images: [{ url: 'https://images.invalid/out.png' }] });
        return Response.json({ status: complete ? 'COMPLETED' : 'IN_QUEUE' });
    };
    const onJob = async event => { events.push(event); if (event.jobId) persisted = event.jobId; };
    const input = provider === 'comfy' ? comfy : { prompt: 'scene' };
    const first = createAuxiliaryAdapter(config, { fetch, onJob });
    await assert.rejects(first.generateImage(input), e => e.code === 'provider-poll-limit' && e.details.jobId === persisted && e.details.resubmit === false);
    assert.ok(persisted.startsWith('aux1.')); assert.equal(events[0].state, 'submitting'); assert.equal(events[1].state, 'submitted');
    complete = true;
    const restored = createAuxiliaryAdapter(config, { fetch, onJob, jobId: persisted });
    const result = await restored.generateImage(input);
    assert.equal(result.jobId, persisted); assert.equal(result.images.length, 1);
    assert.equal(calls.filter(c => c.method === 'POST').length, 1);
    assert.equal(events.at(-1).state, 'completed');
    assert.equal(workflow['2'].inputs.text, 'old');
});

test('job persistence failure stops polling and exposes ID for recovery', async () => {
    let calls = 0;
    const adapter = createAuxiliaryAdapter(c('bfl'), { fetch: async () => { calls++; return Response.json({ id: 'remote-job' }); }, onJob: event => { if (event.state === 'submitted') throw new Error('store offline'); } });
    await assert.rejects(adapter.generateImage({ prompt: 'scene' }), e => e.details.jobId.startsWith('aux1.') && e.details.outcome === 'unknown');
    assert.equal(calls, 1);
});

test('abort after submission retains unknown job; cancellation is never assumed', async () => {
    const controller = new AbortController(); let calls = 0;
    const adapter = createAuxiliaryAdapter(c('bfl'), { fetch: async () => { calls++; return Response.json({ id: 'remote-job' }); }, onJob: event => { if (event.state === 'submitted') controller.abort(); } });
    await assert.rejects(adapter.generateImage({ prompt: 'scene', signal: controller.signal }), e => e.details?.jobId && e.details.outcome === 'unknown');
    assert.equal(calls, 1);
});

test('FAL uses authenticated per-job cancellation and accepts an empty 202 body', async () => {
    let id; const paths = [];
    const adapter = createAuxiliaryAdapter(c('falai'), { fetch: async request => {
        paths.push(request.method);
        if (request.method === 'PUT') { assert.equal(request.headers.get('authorization'), 'Key fake-secret'); return new Response(null, { status: 202 }); }
        return Response.json(request.method === 'POST' ? { request_id: 'job1', cancel_url: 'https://queue.invalid/v1/flux/dev/requests/job1/cancel' } : { status: 'IN_QUEUE' });
    }, onJob: event => { if (event.jobId) id = event.jobId; } });
    await assert.rejects(adapter.generateImage({ prompt: 'scene' }));
    assert.equal((await adapter.cancelJob(id)).state, 'cancel-requested');
    assert.equal(paths.at(-1), 'PUT');
});

test('Comfy cancellation removes only the requested pending job and never global interrupt', async () => {
    let id; const calls = [];
    const adapter = createAuxiliaryAdapter(c('comfy'), { fetch: async request => {
        const path = new URL(request.url).pathname; calls.push(path);
        if (path.endsWith('/prompt')) return Response.json({ prompt_id: 'job1' });
        if (path.endsWith('/queue') && request.method === 'GET') return Response.json({ queue_pending: [[0, 'job1']], queue_running: [[1, 'other']] });
        if (path.endsWith('/queue')) { assert.deepEqual(await request.json(), { delete: ['job1'] }); return Response.json({}); }
        return Response.json({});
    }, onJob: event => { if (event.jobId) id = event.jobId; } });
    await assert.rejects(adapter.generateImage(comfy));
    assert.equal((await adapter.cancelJob(id)).state, 'cancel-requested'); assert.ok(!calls.some(p => p.includes('interrupt')));
});

test('queue URLs cannot send credentials to a foreign origin; resumed payload cannot change', async () => {
    let id, calls = 0;
    const config = c('falai');
    const adapter = createAuxiliaryAdapter(config, { fetch: async request => { calls++; return Response.json(request.method === 'POST' ? { request_id: 'job1' } : { status: 'IN_QUEUE' }); }, onJob: e => { if (e.jobId) id = e.jobId; } });
    await assert.rejects(adapter.generateImage({ prompt: 'scene' }));
    const before = calls;
    await assert.rejects(adapter.generateImage({ prompt: 'changed', jobId: id }), { code: 'invalid-job' }); assert.equal(calls, before);
    const hostile = createAuxiliaryAdapter(config, { fetch: async () => Response.json({ request_id: 'job2', status_url: 'https://evil.invalid/steal' }) });
    await assert.rejects(hostile.generateImage({ prompt: 'scene' }), { code: 'invalid-job-url' });
    assert.equal(decodeJob(id, config, 'fal-image', config.baseUrl).remoteId, 'job1');
});

test('BFL official regional polling URL works without resubmission', async () => {
    const calls = [];
    const adapter = createAuxiliaryAdapter({ ...c('bfl'), baseUrl: 'https://api.bfl.ai/v1' }, { fetch: async request => {
        calls.push(request.url);
        return Response.json(request.method === 'POST' ? { id: 'job1', polling_url: 'https://api.us1.bfl.ai/v1/get_result?id=job1' } : { status: 'Ready', result: { sample: 'https://images.invalid/x.png' } });
    } });
    await adapter.generateImage({ prompt: 'scene' }); assert.equal(calls[1], 'https://api.us1.bfl.ai/v1/get_result?id=job1');
});
