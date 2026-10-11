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

for (const scenario of ['fits', 'still-over-budget', 'merged-over-budget']) test(`speculative compression commits only a fully validated plan: ${scenario}`, async () => {
    let prepared = 0, commits = 0;
    const executor = fakeExecutor();
    const memory = {
        async prepareCompact(snapshot) { prepared++; return { proposal: { id: prepared }, snapshot: { ...snapshot, folds: [...snapshot.folds, { id: prepared }] } }; },
        combineProposals: proposals => ({ proposals }),
        previewCompact: snapshot => ({ ...snapshot, folds: [{ id: 'merged' }], merged: true }),
    };
    const { runtime, store } = setup(executor, { memory, compile(snapshot) {
        if (!snapshot.folds.length || scenario === 'still-over-budget' || scenario === 'merged-over-budget' && snapshot.merged) {
            throw new ProtocolError('budget-blocked', 'Too much content');
        }
        return { messages: [], effects: [], budget: {} };
    } });
    store.commitDerived = () => { commits++; return { accepted: true }; };
    runtime.start('c', request);
    const turn = await runtime.wait('turn');
    assert.equal(prepared, scenario === 'still-over-budget' ? 2 : 1);
    assert.equal(commits, scenario === 'fits' ? 1 : 0);
    assert.equal(executor.calls.length, scenario === 'fits' ? 1 : 0);
    assert.equal(turn.status, scenario === 'fits' ? 'completed' : 'failed');
    await runtime.close();
});

for (const type of ['auxiliary', 'impersonate', 'send']) test(`${type} compiles unpersisted task instructions exactly where required`, async () => {
    let options;
    const { runtime } = setup(fakeExecutor(), { compile(snapshot, value) { options = value; return { messages: [], effects: [], budget: {} }; } });
    runtime.start('c', { ...request, type });
    assert.equal((await runtime.wait('turn')).status, 'completed');
    assert.equal(options.draft, type === 'send' ? undefined : 'Hello');
    await runtime.close();
});

test('registered model and tool media both survive turn completion without duplicate attachments', async () => {
    const image = { attachmentId: 'image', type: 'image' };
    const audio = { attachmentId: 'audio', type: 'audio' };
    const executor = { async runTurn() { return { content: '', finishReason: 'stop', media: [audio, image] }; } };
    const tools = { definitions: () => [], bindTurn() {}, release() {}, toolArtifacts: () => [image] };
    const { runtime } = setup(executor, { tools });
    runtime.start('c', request);
    const turn = await runtime.wait('turn');
    assert.equal(turn.status, 'completed');
    assert.deepEqual(turn.media, [audio, image]);
    await runtime.close();
});

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

test('committed source events coalesce refreshes, expose state and unsubscribe on close', async () => {
    let listener, unsubscribed = false, calls = 0;
    const events = [];
    const store = { subscribe(fn) { listener = fn; return () => { unsubscribed = true; }; },
        getConversation: () => ({ conversation: { id: 'c', activeTurnId: null } }), appendEvent: (id, type, payload) => events.push({ id, type, payload }) };
    const retrieval = { invalidate() {}, status: () => ({ status: 'not-ready', semanticReady: false, count: 0 }),
        async index() { calls++; throw new Error('private-token'); } };
    const runtime = createRuntime({ store, retrieval });
    listener({ conversationId: 'c', type: 'conversation.changed' });
    listener({ conversationId: 'c', type: 'memory.updated' });
    listener({ conversationId: 'c', type: 'retrieval.updated' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(runtime.retrievalStatus('c').status, 'not-ready');
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.error.code, 'index-failed');
    assert.equal(JSON.stringify(events).includes('private-token'), false);
    await runtime.close(); assert.equal(unsubscribed, true);
});

test('successful retrieval results are validated blocks in the runtime compiler snapshot', async () => {
    let received;
    const retrieval = { async search() { return [{ content: 'retrieved detail', sourceRefs: [], kind: 'message' }]; }, async index() {} };
    const { runtime } = setup(fakeExecutor(), { retrieval, compile(snapshot) { received = snapshot.retrieval; return { messages: [], effects: [], budget: {} }; } });
    runtime.start('c', { ...request, type: 'auxiliary' });
    await runtime.wait('turn');
    assert.equal(received[0].status, 'valid');
    assert.equal(received[0].id, 'retrieved-0');
    await runtime.close();
});

for (const notify of [true, false]) test(`fatal tool outcomes cannot become successful turns even when executor swallows errors (callback=${notify})`, async () => {
    let fatal, onFatal, nextRequest = false;
    const tools = { definitions: () => [{ name: 'generate_image', parameters: { type: 'object' } }],
        bindTurn(input) { onFatal = input.onFatal; }, beginRound() {}, release() {},
        fatalError: () => fatal,
        async execute() { fatal = new ProtocolError('tool-result-unknown', 'External result unknown', 409); fatal.fatal = true; if (notify) onFatal(fatal); throw fatal; } };
    const executor = { async runTurn(options) {
        try { await options.tools[0].execute('call', {}, options.signal); } catch { /* Simulate SDK converting this into a model-visible tool error. */ }
        assert.equal(options.signal.aborted, notify);
        try { await options.beforeRequest({ messages: [] }); nextRequest = true; } catch (error) { assert.equal(error.code, 'tool-result-unknown'); }
        return { content: 'Must not be successful', finishReason: 'stop' };
    } };
    const { runtime } = setup(executor, { tools });
    runtime.start('c', request);
    const turn = await runtime.wait('turn');
    assert.equal(turn.status, 'failed');
    assert.equal(turn.error.code, 'tool-result-unknown');
    assert.equal(nextRequest, false);
    await runtime.close();
});
