import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticRequest, createAutomaticControl } from '../../../../public/modern/conversation/settings/automatic.js';
import { createClient } from '../../../../public/modern/conversation/core/client.js';
const snapshot = { conversation: { contentRevision: 8 }, settings: { groupId: 'g', connectionId: 'c' } };
test('enable checks saved group, connection and revision; disable has no CAS requirement', () => {
    assert.deepEqual(automaticRequest(null, false), { enabled: false });
    assert.deepEqual(automaticRequest(snapshot, true, { intervalMs: 30000, content: 'go' }), { enabled: true, intervalMs: 30000, content: 'go', expectedContentRevision: 8 });
    assert.throws(() => automaticRequest({ ...snapshot, settings: { groupId: 'g' } }, true, { intervalMs: 30000, content: 'go' }));
});
test('automatic state endpoint is a read-only GET and disable omits expected revision', async () => {
    const calls = [];
    const client = createClient({ csrf: false, fetcher: async (url, options) => { calls.push([url, options]); return new Response('{"enabled":false}'); } });
    await client.automaticState('c'); await client.automatic('c', automaticRequest(null, false));
    assert.equal(calls[0][0], '/api/conversation/v1/conversations/c/automatic');
    assert.equal(calls[0][1].method, 'GET');
    assert.deepEqual(JSON.parse(calls[1][1].body), { enabled: false, schemaVersion: 1 });
});
test('readback and external changes determine state; loading does not enable or resend', async () => {
    let enabled = false;
    const writes = [], states = [];
    const control = createAutomaticControl({ conversationId: 'c', onChange: state => states.push(state), api: {
        automaticState: async () => ({ enabled }),
        automatic: async (id, body) => { writes.push(body); enabled = body.enabled; },
    } });
    await control.refresh(); assert.equal(writes.length, 0); assert.equal(states.at(-1).enabled, false);
    await control.set(snapshot, true, { intervalMs: 30000, content: 'go' }); assert.equal(states.at(-1).enabled, true);
    enabled = false; await control.refresh(); assert.equal(states.at(-1).enabled, false); assert.equal(writes.length, 1);
    await control.set(null, false); assert.deepEqual(writes.at(-1), { enabled: false });
});
test('failed reads display unknown, and disposed reads cannot change a new view', async () => {
    const states = [];
    let resolve;
    const control = createAutomaticControl({ conversationId: 'c', onChange: state => states.push(state), api: { automaticState: async () => { throw new Error('offline'); } } });
    await control.refresh(); assert.equal(states.at(-1).enabled, null); assert.equal(states.at(-1).error, 'offline');
    const other = createAutomaticControl({ conversationId: 'other', onChange: state => states.push(state), api: { automaticState: () => new Promise(r => { resolve = r; }) } });
    const read = other.refresh(); other.dispose(); const count = states.length; resolve({ enabled: true }); await read;
    assert.equal(states.length, count);
});


test('automatic scheduling uses snapshot.settings only', () => {
    assert.throws(() => automaticRequest({ conversation: { contentRevision: 8, settings: { groupId: 'g', connectionId: 'c' } } }, true, { intervalMs: 30000, content: 'go' }));
});
