// Manual headless-UI fixture. Local protocol peers only; never discovers credentials.
import assert from 'node:assert/strict';
import http from 'node:http';
import { startFixture, IMAGE_BASE64 } from '../../integration/fixture.mjs';
let submitted = 0, canceled = 0;
const peer = http.createServer((req, res) => {
    req.resume();
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') { submitted++; res.end('{"id":"existing-ui-job"}'); }
    else if (req.method === 'DELETE') { canceled++; res.end('{}'); }
    else if (!canceled) res.writeHead(503).end('{}');
    else res.end(JSON.stringify({ done: true, generations: [{ img: IMAGE_BASE64 }] }));
});
await new Promise(resolve => peer.listen(0, '127.0.0.1', resolve));
const fixture = await startFixture();
const empty = await startFixture({ seed: false });
const image = await fixture.api('/resources', { kind: 'connection', name: 'Local image job', data: { ...fixture.connectionData, provider: 'horde', type: 'image', model: 'local-image', baseUrl: `http://127.0.0.1:${peer.address().port}/api/v2`, maxPolls: 1, pollIntervalMs: 0 } });
assert.equal(image.status, 201);
assert.equal((await fixture.api(`/conversations/${fixture.conversation.id}/commands`, { type: 'conversation.configure', expectedContentRevision: 0, settings: { connectionId: fixture.connection.id, imageConnectionId: image.value.id, tools: ['generate_image'], memoryFrequency: 1000 } })).status, 200);
const turn = await fixture.send('USE_IMAGE');
assert.equal((await fixture.wait(turn.value.turnId)).status, 'failed');
console.log(JSON.stringify({ url: fixture.url, emptyUrl: empty.url }));
let closing = false;
async function close() {
    if (closing) return;
    closing = true;
    console.log(JSON.stringify({ submitted, canceled }));
    await fixture.close(); await empty.close();
    peer.closeAllConnections(); await new Promise(resolve => peer.close(resolve));
    assert.equal(submitted, 1, 'UI must never submit a second image request');
}
process.once('SIGTERM', close);
process.once('SIGINT', close);
