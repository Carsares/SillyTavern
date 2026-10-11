// Explicit isolated integration: real HTTP/store/runtime and a local fake image provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startFixture, IMAGE_BASE64 } from './fixture.mjs';

test('manual image recovery followed by original-turn retry reuses images without another provider request', async t => {
    const requests = [];
    let failPoll = true;
    const peer = http.createServer((req, res) => {
        requests.push([req.method, req.url]); req.resume();
        if (req.method === 'POST') res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"original-image-job"}');
        else if (failPoll) res.writeHead(503).end();
        else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ done: true, generations: [{ img: IMAGE_BASE64 }] }));
    });
    await new Promise(resolve => peer.listen(0, '127.0.0.1', resolve));
    t.after(async () => { peer.closeAllConnections(); await new Promise(resolve => peer.close(resolve)); });
    const app = await startFixture(); t.after(() => app.close());
    const image = await app.api('/resources', { kind: 'connection', name: 'Isolated image peer', data: {
        ...app.connectionData, provider: 'horde', type: 'image', model: 'local-image',
        baseUrl: `http://127.0.0.1:${peer.address().port}/api/v2`, maxPolls: 1, pollIntervalMs: 0,
    } });
    assert.equal(image.status, 201);
    assert.equal((await app.api(`/conversations/${app.conversation.id}/commands`, { type: 'conversation.configure', expectedContentRevision: 0,
        settings: { connectionId: app.connection.id, imageConnectionId: image.value.id, tools: ['generate_image'], memoryFrequency: 1000 } })).status, 200);
    const accepted = await app.send('USE_IMAGE'); assert.equal(accepted.status, 202);
    const original = await app.wait(accepted.value.turnId); assert.equal(original.status, 'failed');
    const store = app.application.services.store;
    const job = store.listJobs(app.conversation.id).find(item => item.kind === 'provider-request');
    failPoll = false;
    const restored = await app.api(`/conversations/${app.conversation.id}/jobs/${job.id}/resume`, {});
    assert.equal(restored.status, 200);
    const historical = store.getTool(job.dependencies.origin);
    assert.equal(historical.status, 'completed');
    const before = requests.length;
    const retried = await app.send('USE_IMAGE', { retryTurnId: original.id }); assert.equal(retried.status, 202);
    const terminal = await app.wait(retried.value.turnId); assert.equal(terminal.status, 'completed');
    assert.equal(requests.length, before, 'Retry must not even poll the provider again');
    assert.equal(requests.filter(([method]) => method === 'POST').length, 1);
    assert.deepEqual(store.getTool(historical.id), historical);
    const reused = store.listTools(app.conversation.id).find(record => record.turnId === terminal.id);
    assert.equal(reused.result.reusedFromToolId, historical.id); assert.equal(reused.usage.cost, 0);
    const snapshot = await app.snapshot();
    assert.ok(snapshot.messages.some(m => m.turnId === terminal.id && m.media?.length));
    assert.ok(!snapshot.messages.some(m => m.turnId === original.id && m.media?.length));
});
