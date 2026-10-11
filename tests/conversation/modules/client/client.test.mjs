import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, EventParser, subscribe, ApiError, LONG_WRITE_TIMEOUT_MS, TRANSFER_TIMEOUT_MS } from '../../../../public/modern/conversation/core/client.js';

const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
test('writes include schema, authentication and expected revisions; GET does not fetch CSRF', async () => {
    const calls = [];
    const client = createClient({ fetcher: async (url, options) => {
        calls.push({ url, ...options }); return response(url === '/csrf-token' ? { token: 'private' } : { id: 'ok' });
    } });
    await client.snapshot('id/with space');
    await client.command('id', { type: 'message.delete', expectedContentRevision: 3, messageId: 'm', schemaVersion: 88 });
    await client.stop('t');
    assert.equal(calls[0].url, '/api/conversation/v1/conversations/id%2Fwith%20space');
    assert.equal(calls.filter(c => c.url === '/csrf-token').length, 1);
    assert.equal(calls[2].headers['X-CSRF-Token'], 'private');
    assert.equal(calls[2].credentials, 'same-origin');
    assert.deepEqual(JSON.parse(calls[2].body), { schemaVersion: 1, type: 'message.delete', expectedContentRevision: 3, messageId: 'm' });
});
test('structured conflict survives transport without automatic POST retry', async () => {
    let calls = 0;
    const client = createClient({ csrf: false, fetcher: async () => { calls++; return response({ error: { code: 'revision-conflict', message: 'stale', details: { actual: 4 } } }, 409); } });
    await assert.rejects(client.start('c', {}), error => error instanceof ApiError && error.status === 409 && error.details.actual === 4);
    assert.equal(calls, 1);
});
test('HTML success response is not mistaken for API success', async () => {
    const client = createClient({ fetcher: async () => new Response('<html>login</html>') });
    await assert.rejects(client.conversations(), /有效 JSON/);
});
test('SSE parser handles split CRLF frames, comments, and multiline data', () => {
    const entries = [];
    const parser = new EventParser((event, id) => entries.push({ event, id }));
    parser.feed(': heartbeat\r\n\r\nid: 7\r\ndata: {"text":\r');
    parser.feed('\ndata: "中文"}\r\n\r');
    assert.equal(entries.length, 0);
    parser.feed('\nid: 8\ndata: {"next":true}\n\n');
    assert.deepEqual(entries, [{ event: { text: '中文' }, id: '7' }, { event: { next: true }, id: '8' }]);
});
test('stream decodes UTF8 across byte boundaries and includes persisted cursor', async () => {
    const data = new TextEncoder().encode('id: 9\ndata: {"text":"中文"}\n\n');
    let url;
    const client = createClient({ fetcher: async target => {
        url = target;
        return new Response(new ReadableStream({ start(controller) { for (const byte of data) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
    } });
    const events = [];
    await client.stream('c', 8, { onEvent: event => events.push(event) });
    assert.equal(url, '/api/conversation/v1/conversations/c/events?after=8');
    assert.deepEqual(events, [{ text: '中文' }]);
});
test('reconnect uses accepted cursor, deduplicates, and cancellation prevents retry', async () => {
    const cursors = [], received = [], queue = [];
    const event = seq => ({ schemaVersion: 1, seq, conversationId: 'c', type: 'turn.delta', payload: {} });
    const client = { async stream(id, cursor, { onEvent }) { cursors.push(cursor); onEvent(event(1)); onEvent(event(2)); throw new Error('offline'); } };
    const stop = subscribe(client, 'c', { onEvent: e => received.push(e.seq), schedule: fn => { queue.push(fn); return queue.length; }, unschedule: () => {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(received, [1, 2]);
    await queue.shift()();
    assert.deepEqual(cursors, [0, 2]);
    assert.deepEqual(received, [1, 2]);
    stop();
});
test('consumer errors do not advance reconnect cursor', async () => {
    const cursors = [], queue = [];
    const client = { async stream(id, cursor, { onEvent }) { cursors.push(cursor); onEvent({ schemaVersion: 1, seq: 4, conversationId: id }); } };
    const stop = subscribe(client, 'c', { onEvent: () => { throw new Error('bad'); }, schedule: fn => { queue.push(fn); }, unschedule() {} });
    await new Promise(resolve => setImmediate(resolve));
    await queue.shift()(); stop();
    assert.deepEqual(cursors, [0, 0]);
});
test('resource and maintenance versioned writes use dedicated new endpoints', async () => {
    const calls = [];
    const client = createClient({ csrf: false, fetcher: async (url, options) => { calls.push([url, options]); return response({}); } });
    await client.updateResource('r', { expectedRevision: 6, data: { model: 'm' } });
    await client.deleteConversation('c', 5);
    await client.maintenance('restore', { data: { conversations: [] } });
    assert.equal(calls[0][1].method, 'PATCH');
    assert.equal(JSON.parse(calls[0][1].body).expectedRevision, 6);
    assert.equal(JSON.parse(calls[1][1].body).expectedContentRevision, 5);
    assert.equal(calls[2][0], '/api/conversation/v1/maintenance/restore');
});
test('expired cursor reloads snapshot before replaying from zero', async () => {
    const order = [], queue = [];
    const client = { async stream(id, cursor) { order.push(cursor); throw new ApiError(409, { code: 'cursor-expired' }); } };
    const stop = subscribe(client, 'c', { after: 9, onEvent() {}, onReset: async () => { order.push('snapshot'); }, schedule: fn => { queue.push(fn); }, unschedule() {} });
    await new Promise(resolve => setImmediate(resolve));
    await queue.shift()(); stop();
    assert.deepEqual(order, [9, 'snapshot', 0, 'snapshot']);
});
test('attachment endpoints stay within the versioned API and cleanup token is sent without display redaction', async () => {
    const calls = [];
    const client = createClient({ csrf: false, fetcher: async (url, options) => { calls.push([url, options]); return response({ id: 'a', mime: 'image/png' }); } });
    await client.uploadAttachment({ name: 'image.png', mime: 'image/png', base64: 'YQ==' });
    await client.maintenance('cleanup', { token: 'confirmation' });
    assert.equal(client.attachmentUrl('a/b'), '/api/conversation/v1/attachments/a%2Fb');
    assert.equal(calls[0][0], '/api/conversation/v1/attachments');
    assert.equal(JSON.parse(calls[1][1].body).token, 'confirmation');
});
test('media estimate sends typed references without browser filesystem paths or inline bytes', async () => {
    const { estimateRequest } = await import('../../../../public/modern/conversation/core/state.js');
    const { attachmentPart } = await import('../../../../public/modern/conversation/media/model.js');
    const calls = [];
    const client = createClient({ csrf: false, fetcher: async (url, options) => { calls.push([url, JSON.parse(options.body)]); return response({ estimatedTokens: 12 }); } });
    const media = [attachmentPart({ id: 'image-id', name: 'picture.png', mime: 'image/png', size: 10, path: '/private/path', base64: 'secret-bytes' })];
    const body = estimateRequest('看图', media);
    media[0].name = 'edited-after-request';
    await client.estimate('c', body);
    assert.equal(calls[0][0], '/api/conversation/v1/conversations/c/estimate');
    assert.deepEqual(calls[0][1], { schemaVersion: 1, draft: '看图', type: 'send', media: [{ type: 'image', attachmentId: 'image-id', mimeType: 'image/png', name: 'picture.png', size: 10 }] });
});
test('manual memory creation carries the captured memory version and preserves structured conflicts', async () => {
    const { versionedCommand } = await import('../../../../public/modern/conversation/core/state.js');
    let sent;
    const client = createClient({ csrf: false, fetcher: async (url, options) => {
        sent = JSON.parse(options.body);
        return response({ error: { code: 'revision-conflict', message: 'memory changed' } }, 409);
    } });
    const command = versionedCommand({ conversation: { contentRevision: 3, memoryRevision: 7 } }, 'memory.create', { kind: 'user-fact', content: '人工事实', locked: true });
    await assert.rejects(client.command('c', command), error => error.code === 'revision-conflict');
    assert.deepEqual(sent, { schemaVersion: 1, type: 'memory.create', expectedContentRevision: 3, expectedMemoryRevision: 7, kind: 'user-fact', content: '人工事实', locked: true });
    assert.equal(command.content, '人工事实');
});
test('long server-side writes wait far longer than the 30-second default for ordinary requests', async () => {
    const original = AbortSignal.timeout;
    const waits = [];
    AbortSignal.timeout = ms => { waits.push(ms); return original.call(AbortSignal, ms); };
    try {
        const client = createClient({ csrf: false, fetcher: async () => response({}) });
        const wait = async call => { waits.length = 0; await call(); return waits[0]; };
        for (const call of [() => client.snapshot('c'), () => client.command('c', {}), () => client.maintenance('status'), () => client.maintenance('cleanup', { token: 't' })]) {
            assert.equal(await wait(call), 30000);
        }
        for (const call of [() => client.compact('c', {}), () => client.maintenance('reindex', { conversationId: 'c' }), () => client.resumeJob('c', 'j'), () => client.cancelJob('c', 'j')]) {
            assert.equal(await wait(call), LONG_WRITE_TIMEOUT_MS);
        }
        for (const call of [() => client.maintenance('backup', {}), () => client.maintenance('restore', { data: {} })]) {
            assert.equal(await wait(call), TRANSFER_TIMEOUT_MS);
        }
        assert.ok(LONG_WRITE_TIMEOUT_MS >= 10 * 60 * 1000 && TRANSFER_TIMEOUT_MS > LONG_WRITE_TIMEOUT_MS);
    } finally { AbortSignal.timeout = original; }
});
test('an unanswered long write reports an unknown result after re-reading, while a rejection stays a rejection', async () => {
    const { runUncertainWrite } = await import('../../../../public/modern/conversation/core/operations.js');
    let refreshes = 0;
    const refresh = async () => { refreshes++; };
    await assert.rejects(runUncertainWrite(async () => { throw new DOMException('signal timed out', 'TimeoutError'); }, refresh),
        error => error.resultUnknown === true && /结果未知（等待服务器响应超时）.*已重新读取状态.*不要重复提交/.test(error.message) && !/signal timed out/.test(error.message));
    assert.equal(refreshes, 1);
    for (const failure of [new TypeError('Failed to fetch'), new ApiError(502, { code: 'invalid-response', message: 'bad gateway' }), new ApiError(408, {})]) {
        await assert.rejects(runUncertainWrite(async () => { throw failure; }, refresh), error => error.resultUnknown === true);
    }
    assert.equal(refreshes, 4);
    const conflict = new ApiError(409, { code: 'revision-conflict', message: 'stale' });
    await assert.rejects(runUncertainWrite(async () => { throw conflict; }, refresh), error => error === conflict);
    assert.equal(refreshes, 4);
    await assert.rejects(runUncertainWrite(async () => { throw new TypeError('offline'); }, async () => { throw new Error('still offline'); }),
        /结果未知（offline）.*重新读取状态失败（still offline）.*不要重复提交/);
    assert.deepEqual(await runUncertainWrite(async () => ({ ok: true }), refresh), { ok: true });
});
