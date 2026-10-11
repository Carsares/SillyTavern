import test from 'node:test';
import assert from 'node:assert/strict';
import { applySnapshotCommand, acceptedTurn, requireSnapshot } from '../../../../public/modern/conversation/core/operations.js';
import { MEMORY_KINDS, memoryInput } from '../../../../public/modern/conversation/memory/model.js';
import { initialState, hydrate, reduceEvent } from '../../../../public/modern/conversation/core/state.js';
import { usageRows, usageValue } from '../../../../public/modern/conversation/diagnostics/usage.js';
import { createClient } from '../../../../public/modern/conversation/core/client.js';
const snapshot = { conversation: { id: 'c', contentRevision: 3, memoryRevision: 2 }, messages: [] };
test('command snapshot commits before readback and a failed read does not invite duplicate creation', async () => {
    const committed = { ...snapshot, conversation: { ...snapshot.conversation, memoryRevision: 3 }, memories: [{ id: 'new' }] };
    const order = [];
    const result = await applySnapshotCommand({ api: { command: async () => { order.push('write'); return committed; } }, conversationId: 'c', snapshot, type: 'memory.create', fields: memoryInput('user-fact', 'fact', false),
        onCommitted: value => { assert.equal(value, committed); order.push('committed'); }, refresh: async () => { order.push('read'); throw new Error('offline'); }, onWarning: value => { assert.match(value, /写入已获服务器确认/); order.push('warning'); },
    });
    assert.equal(result, committed); assert.deepEqual(order, ['write', 'committed', 'read', 'warning']);
});
test('rejected write never updates local state or triggers a refresh', async () => {
    await assert.rejects(applySnapshotCommand({ api: { command: async () => { throw new Error('conflict'); } }, conversationId: 'c', snapshot, type: 'message.edit', fields: {}, onCommitted() { assert.fail(); }, refresh() { assert.fail(); } }), /conflict/);
});
test('snapshot ID is not the conversation ID and foreign snapshots are rejected', () => {
    assert.equal(requireSnapshot({ ...snapshot, id: 'snapshot-id' }, 'c').conversation.id, 'c');
    assert.throws(() => requireSnapshot({ ...snapshot, id: 'c', conversation: { id: 'foreign' } }, 'c'));
});
test('late acceptance response cannot erase already streamed or terminal content', () => {
    const current = { id: 't', conversationId: 'c', status: 'completed', content: 'persisted' };
    assert.equal(acceptedTurn({ turnId: 't', status: 'queued' }, { type: 'send' }, 'c', current), current);
    assert.equal(acceptedTurn({ turnId: 'next', status: 'queued' }, { type: 'send' }, 'c', current).id, 'next');
});
test('memory creation uses the five store kinds, not the rejected generic fact kind', () => {
    assert.deepEqual(MEMORY_KINDS.map(([kind]) => kind), ['character', 'relationship', 'world-state', 'timeline', 'user-fact']);
    assert.throws(() => memoryInput('fact', 'text', false));
    assert.throws(() => memoryInput('user-fact', 'x'.repeat(8001), false));
    assert.deepEqual(memoryInput('timeline', 'text', true), { kind: 'timeline', content: 'text', locked: true });
});
test('group member delta cannot merge into previous member even with identical prefix', () => {
    const state = hydrate(initialState(), snapshot, { id: 't', status: 'generating', messageId: 'member1', candidateId: 'first', content: 'hello' });
    const next = reduceEvent(state, { schemaVersion: 1, seq: 1, conversationId: 'c', turnId: 't', type: 'text.delta', payload: { messageId: 'member2', candidateId: 'second', text: 'hello world', offset: 0 } });
    assert.equal(next.turn.content, 'hello'); assert.equal(next.needsRefresh, true);
});
test('usage renders server totals once and keeps missing totals/cost unknown', () => {
    const rows = usageRows({ totals: { calls: 2, inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, reasoningTokens: 2, totalTokens: 15, costUsd: null, complete: false }, categories: {} });
    assert.equal(rows.find(row => row.label === '总 tokens').cells[0], '15');
    assert.equal(rows.find(row => row.label === '费用 USD').cells[0], '未知');
    assert.equal(rows.find(row => row.label === '统计完整性').cells[0], '不完整');
    assert.equal(usageRows({ totals: { inputTokens: 10, outputTokens: 5 } }).find(row => row.label === '总 tokens').cells[0], '未知');
    assert.equal(usageValue(0, 'costUsd'), '0');
});
test('usage endpoint remains read-only and does not derive call counts from prepare events', async () => {
    let received;
    const payload = { totals: { calls: 3, costUsd: null }, categories: {}, turns: [{ turnId: 'partial', calls: 1 }] };
    const api = createClient({ fetcher: async (url, options) => { received = [url, options.method]; return new Response(JSON.stringify(payload)); } });
    assert.deepEqual(await api.usage('c'), payload);
    assert.deepEqual(received, ['/api/conversation/v1/conversations/c/usage', 'GET']);
});
test('invalid CSRF response prevents the business write', async () => {
    const calls = [];
    const api = createClient({ fetcher: async url => { calls.push(url); return new Response('{}'); } });
    await assert.rejects(api.createConversation({}), error => error.code === 'invalid-csrf');
    assert.deepEqual(calls, ['/csrf-token']);
});

test('tool results are fetched using only the versioned read endpoint', async () => {
    const calls = [];
    const api = createClient({ fetcher: async (url, options) => { calls.push([url, options.method]); return new Response(JSON.stringify({ id: 'tool-id', result: { full: 'content' } })); } });
    assert.deepEqual(await api.tool('tool-id'), { id: 'tool-id', result: { full: 'content' } });
    assert.deepEqual(calls, [['/api/conversation/v1/tools/tool-id', 'GET']]);
});
test('backup size follows shared limit and counts UTF-8 restore envelope bytes', async () => {
    const { restoreBody, BACKUP_MAX_BYTES } = await import('../../../../public/modern/conversation/maintenance/model.js');
    assert.equal(BACKUP_MAX_BYTES, 256 * 1024 * 1024);
    const data = { text: '中文' };
    const bytes = Buffer.byteLength(JSON.stringify({ data, schemaVersion: 1 }));
    assert.deepEqual(restoreBody(data, bytes), { data });
    assert.throws(() => restoreBody(data, bytes - 1), /包体超过/);
});
