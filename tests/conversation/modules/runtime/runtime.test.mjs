import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../../../../src/conversation/runtime/index.js';
import { fakeExecutor } from '../../harness/index.mjs';
import { ProtocolError } from '../../../../public/shared/conversation/schemas/index.js';

function setup(executor, options = {}) {
    const snapshot = { conversation: { id: 'c', contentRevision: 0 }, settings: { connectionId: 'connection' }, resources: [{ id: 'connection', revision: 1, kind: 'connection' }], messages: [], folds: [] };
    const events = [];
    let current;
    let userWrites = 0;
    const store = {
        getConversation: () => snapshot,
        getConnection: () => ({ id: 'connection', revision: 1, data: { model: 'test', contextWindow: 8192, maxOutputTokens: 512, workingBudget: 4096 } }),
        beginTurn(cid, request, preflight) {
            if (current) return { turn: current, snapshot, replayed: true };
            preflight(snapshot, request);
            userWrites++;
            current = { id: 'turn', conversationId: cid, type: request.type, status: 'queued', attemptEpoch: 1, content: '', reasoning: '' };
            snapshot.conversation.contentRevision++;
            return { turn: current, snapshot, replayed: false };
        },
        getTurn: () => current,
        appendDelta(id, delta) { if (delta.text) current.content += delta.text; if (delta.reasoning) current.reasoning += delta.reasoning; events.push(delta); },
        appendEvent(cid, type, payload) { events.push({ type, payload, seq: events.length + 1 }); },
        advanceTurn(id, status) { current.status = status; },
        finishTurn(id, result) { Object.assign(current, result); },
        requestStop() { current.cancelRequested = true; return current; },
        events: () => events,
    };
    const runtime = createRuntime({ store, executor, compile: () => ({ messages: [], effects: [], budget: {} }), capabilities: () => ({ supported: true, tools: true }), ...options });
    return { runtime, store, events, writes: () => userWrites };
}
const request = { schemaVersion: 1, clientRequestId: 'request', expectedContentRevision: 0, type: 'send', content: 'Hello' };

test('replayed acceptance does not repeat provider calls or user message writes', async () => {
    const executor = fakeExecutor(); const { runtime, writes } = setup(executor);
    runtime.start('c', request);
    const result = runtime.start('c', request);
    assert.equal(result.replayed, true);
    const turn = await runtime.wait('turn');
    assert.equal(turn.status, 'completed'); assert.equal(turn.content, 'Hello world');
    assert.equal(writes(), 1); assert.equal(executor.calls.length, 1);
    await runtime.close();
});

test('unsupported executor is rejected before accepting a user message', () => {
    const { runtime, writes } = setup(fakeExecutor(), { capabilities: () => ({ supported: false, reason: 'Unavailable' }) });
    assert.throws(() => runtime.start('c', request), error => error.code === 'unsupported-connection');
    assert.equal(writes(), 0);
});

test('stop propagates to the model and preserves already persisted partial text', async () => {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const executor = { async runTurn({ onEvent, signal }) {
        await onEvent({ type: 'text.delta', text: 'partial' }); started();
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } };
    const { runtime } = setup(executor);
    runtime.start('c', request); await ready; runtime.stop('turn');
    const turn = await runtime.wait('turn');
    assert.equal(turn.status, 'stopped'); assert.equal(turn.content, 'partial');
    await runtime.close();
});

test('failed model step cannot become successful terminal state', async () => {
    const { runtime } = setup(fakeExecutor({ failure: new ProtocolError('model-failed', 'Remote failed', 502) }));
    runtime.start('c', request); const turn = await runtime.wait('turn');
    assert.equal(turn.status, 'failed'); assert.equal(turn.error.code, 'model-failed');
    await runtime.close();
});

test('auxiliary memory failure leaves completed reply intact and emits separate status', async () => {
    const { runtime, events } = setup(fakeExecutor(), { memory: { schedule() { throw new Error('unavailable'); } } });
    runtime.start('c', request); const turn = await runtime.wait('turn');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(turn.status, 'completed');
    assert.ok(events.some(event => event.type === 'memory.updated' && event.payload.status === 'failed'));
    await runtime.close();
});

test('automatic groups reject stale settings before replacing a scheduler and stop after failure', async () => {
    const { runtime } = setup(fakeExecutor({ failure: new ProtocolError('model-failed', 'failed') }), { groups: { select: () => [] } });
    assert.throws(() => runtime.setAutomatic('c', { enabled: true, expectedContentRevision: 99 }), error => error.code === 'revision-conflict');
    runtime.setAutomatic('c', { enabled: true, expectedContentRevision: 0 });
    assert.deepEqual(runtime.automaticStatus('c'), { enabled: true });
    runtime.start('c', request);
    await runtime.wait('turn');
    assert.deepEqual(runtime.automaticStatus('c'), { enabled: false });
    await runtime.close();
});

test('actual tool-step budget includes tool schemas and preserves failed state', async () => {
    const tools = { definitions: () => [{ name: 'huge', description: 'x'.repeat(5000), parameters: {} }], bindTurn() {}, release() {} };
    const { runtime } = setup(fakeExecutor(), { tools });
    runtime.start('c', request);
    const turn = await runtime.wait('turn');
    assert.equal(turn.status, 'failed');
    assert.equal(turn.error.code, 'budget-blocked');
    await runtime.close();
});
