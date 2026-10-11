import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startFixture } from './fixture.mjs';

test('saved connection proxy routes real PI traffic and remains absent from public state', async t => {
    const app = await startFixture(); t.after(() => app.close());
    let routed = 0;
    const target = new URL(app.connectionData.baseUrl);
    const proxy = http.createServer((req, res) => {
        const url = new URL(req.url);
        assert.equal(url.origin, target.origin);
        assert.equal(req.headers['proxy-authorization'], `Basic ${Buffer.from('local-user:local-password').toString('base64')}`);
        routed++;
        const headers = { ...req.headers }; delete headers['proxy-authorization'];
        const upstream = http.request(url, { method: req.method, headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
        upstream.on('error', () => res.writeHead(502).end()); req.pipe(upstream);
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    t.after(async () => { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); });
    const updated = await app.api(`/resources/${app.connection.id}`, { expectedRevision: 1, data: { ...app.connectionData, proxy: { url: `http://local-user:local-password@127.0.0.1:${proxy.address().port}` } } }, 'PATCH');
    assert.equal(updated.status, 200);
    assert.equal(updated.value.data.proxy, undefined);
    const accepted = await app.send('Proxy route');
    const terminal = await app.wait(accepted.value.turnId);
    assert.equal(terminal.status, 'completed', JSON.stringify(terminal.error));
    assert.equal(routed, 1); assert.equal(app.captured.length, 1);
    const publicState = JSON.stringify([await app.snapshot(), (await app.api(`/conversations/${app.conversation.id}/traces`)).value, (await app.api('/maintenance/backup', {})).value]);
    assert.equal(publicState.includes('local-user'), false); assert.equal(publicState.includes('local-password'), false);
    const cleared = await app.api(`/resources/${app.connection.id}`, { expectedRevision: 2, data: { ...app.connectionData, proxy: null } }, 'PATCH');
    assert.equal(cleared.status, 200);
    const direct = await app.send('Direct route');
    assert.equal((await app.wait(direct.value.turnId)).status, 'completed');
    assert.equal(routed, 1); assert.equal(app.captured.length, 2);
});
