import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, hydrate, reduceEvent, turnRequest, versionedCommand, terminal, redact, list } from '../../../../public/modern/conversation/core/state.js';
const snapshot = { conversation: { id: 'c', contentRevision: 7, memoryRevision: 2 }, messages: [] };
const state = () => hydrate(initialState(), snapshot, { id: 't', status: 'generating', content: '你', reasoning: '' });
const event = (seq, payload, extra = {}) => ({ schemaVersion: 1, conversationId: 'c', turnId: 't', seq, type: 'text.delta', payload, ...extra });
test('replayed and overlapping deltas do not duplicate recovered persisted content', () => {
    let value = state();
    value = reduceEvent(value, event(1, { text: '你', offset: 0 }));
    assert.equal(value.turn.content, '你');
    value = reduceEvent(value, event(2, { text: '你好', offset: 0 }));
    assert.equal(value.turn.content, '你好');
    assert.equal(reduceEvent(value, event(2, { text: '好', offset: 1 })), value);
});
test('gaps and inconsistent offsets request authoritative refresh', () => {
    assert.equal(reduceEvent(state(), event(1, { text: 'bad', offset: 10 })).needsRefresh, true);
    assert.equal(reduceEvent(state(), event(1, { text: 'bad', offset: 0 })).needsRefresh, true);
});
test('cross-conversation data ignored; terminal turn cannot accept late delta', () => {
    const value = state();
    assert.equal(reduceEvent(value, event(1, { text: '好', offset: 1 }, { conversationId: 'other' })), value);
    value.turn.status = 'stopped';
    const next = reduceEvent(value, event(1, { text: '好', offset: 1 }));
    assert.equal(next.turn.content, '你'); assert.equal(next.needsRefresh, true);
});
test('reasoning stream is independent from text', () => {
    const next = reduceEvent(state(), event(1, { text: 'thinking', offset: 0 }, { type: 'reasoning.delta' }));
    assert.equal(next.turn.reasoning, 'thinking'); assert.equal(next.turn.content, '你');
});
test('new requests carry exact immutable request identity and expected version', () => {
    assert.deepEqual(turnRequest(snapshot, 'send', 'hello', undefined, 'req-1'), { schemaVersion: 1, clientRequestId: 'req-1', expectedContentRevision: 7, type: 'send', content: 'hello' });
    assert.throws(() => turnRequest(snapshot, 'send', ' ', undefined, 'r'));
    assert.throws(() => turnRequest(snapshot, 'continue', '', undefined, 'r'));
    assert.equal(turnRequest(snapshot, 'impersonate', '', undefined, 'r').type, 'impersonate');
    assert.equal(versionedCommand(snapshot, 'memory.lock', { expectedBlockRevision: 3 }).expectedBlockRevision, 3);
});
test('redaction strips nested credentials while preserving budget and usage', () => {
    assert.deepEqual(redact({ apiKey: 'secret', data: { headers: { a: 'x' }, accessToken: 'a', maxOutputTokens: 5 }, usage: { inputTokens: 3 }, resources: [{ password: 'p', content: 'visible' }] }), { data: { maxOutputTokens: 5 }, usage: { inputTokens: 3 }, resources: [{ content: 'visible' }] });
});
test('all four terminal states recover as final', () => {
    for (const status of ['completed', 'stopped', 'failed', 'interrupted']) assert.equal(terminal({ status }), true);
    assert.equal(terminal({ status: 'generating' }), false);
});
test('manual memory create requires a known memory version and does not trust a field override', () => {
    assert.equal(versionedCommand(snapshot, 'memory.create', { expectedMemoryRevision: 99 }).expectedMemoryRevision, 2);
    assert.throws(() => versionedCommand({ conversation: { contentRevision: 1 } }, 'memory.create', {}));
});


test('list responses use arrays only; named wrappers are rejected', () => {
    const values = [{ id: 'a' }];
    assert.equal(list(values, 'resources'), values);
    for (const value of [{ resources: values }, null, {}]) assert.throws(() => list(value, 'resources'));
});

test('obsolete event aliases never append text and instead request authoritative refresh', () => {
    for (const type of ['turn.delta', 'turn.reasoning', 'turn.reasoning.delta']) {
        const next = reduceEvent(state(), event(1, { text: 'alias', offset: 1 }, { type }));
        assert.equal(next.turn.content, '你'); assert.equal(next.turn.reasoning, '');
        assert.equal(next.needsRefresh, true);
    }
});
