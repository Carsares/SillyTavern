/**
 * NEW ARCHITECTURE INTEGRATION SUITE — final integration gate authorized.
 * Uses real SQLite store/runtime/compiler/memory/groups/maintenance. Only model
 * generation is injected; no listener, paid provider or real user data is used.
 * Child-process recovery checks use isolated temporary directories only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createStore } from '../../../src/conversation/store/index.js';
import { createRuntime } from '../../../src/conversation/runtime/index.js';
import { createMemoryService } from '../../../src/conversation/memory/index.js';
import { createGroupScheduler } from '../../../src/conversation/groups/index.js';
import { createMaintenance } from '../../../src/conversation/maintenance/index.js';
import { createAttachmentService } from '../../../src/conversation/resources/attachments.js';
import { compileContext } from '../../../public/shared/conversation/assembly/index.js';
import { ProtocolError, TURN_TYPES } from '../../../public/shared/conversation/schemas/index.js';

const code = expected => error => error.code === expected;
const capabilities = () => ({ supported: true, types: TURN_TYPES, tools: false, media: [], contextWindow: 131072 });
function gate() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
function abortable(promise, signal) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => { clean(); reject(signal.reason); };
        const clean = () => signal?.removeEventListener('abort', abort);
        signal?.addEventListener('abort', abort, { once: true });
        promise.then(value => { clean(); resolve(value); }, error => { clean(); reject(error); });
    });
}
async function fixture(t, { generate, run, workingBudget = 65536 } = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'conversation-consistency-'));
    let store, runtime;
    t.after(async () => {
        try { await runtime?.close(); } finally { store?.close(); await rm(directory, { recursive: true, force: true }); }
    });
    store = createStore({ directory });
    const data = { provider: 'openai', executor: 'pi', model: 'injected-no-network', contextWindow: 131072, inputLimit: 131072, outputLimit: 4096, maxOutputTokens: 1024, workingBudget };
    const connection = store.createResource({ kind: 'connection', name: 'Main', data });
    const auxiliary = store.createResource({ kind: 'connection', name: 'Memory', data: { ...data, workingBudget: 65536 } });
    const character = store.createResource({ kind: 'character', name: 'Before edit', data: { description: 'Original character.' } });
    const conversation = store.createConversation({ settings: { connectionId: connection.id, auxiliaryConnectionId: auxiliary.id, characterId: character.id, retrieval: false, memoryFrequency: 10000 } });
    const modelCalls = [], summaryCalls = [];
    const memory = createMemoryService({ store, generate: async input => {
        summaryCalls.push(input);
        return generate ? generate(input) : { chapter: 'A concise factual summary.', memories: [] };
    } });
    const executor = { async runTurn(options) {
        modelCalls.push(options);
        assert(Array.isArray(options.requestPlan.messages));
        await options.beforeRequest({ messages: options.requestPlan.messages });
        if (run) return run(options);
        await options.onEvent({ type: 'text.delta', text: 'Response.' });
        return { content: 'Response.', reasoning: '', usage: { input: 1, output: 1 }, finishReason: 'stop' };
    } };
    runtime = createRuntime({ store, executor, compile: compileContext, memory, groups: createGroupScheduler(), capabilities });
    const request = (extra = {}) => ({ schemaVersion: 1, clientRequestId: randomUUID(), expectedContentRevision: store.getConversation(conversation.id).conversation.contentRevision, type: 'send', content: 'Next message.', ...extra });
    const seed = (content = 'A prior fact.', answer = 'A prior response.') => {
        const { turn } = store.beginTurn(conversation.id, request({ content }));
        store.finishTurn(turn.id, { status: 'completed', content: answer }, turn.attemptEpoch);
        return turn;
    };
    const send = async extra => {
        const accepted = runtime.start(conversation.id, request(extra));
        return runtime.wait(accepted.turnId);
    };
    return { directory, store, runtime, memory, conversation, connection, character, request, seed, send, modelCalls, summaryCalls };
}

const options = { timeout: 15000, concurrency: false };

for (const type of ['send', 'group']) test(`real ${type} writer SIGKILL recovery preserves drafts, tool uncertainty and excludes a second process`, options, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'conversation-process-consistency-'));
    const moduleUrl = new URL('../../../src/conversation/store/index.js', import.meta.url).href;
    const prelude = `import { createStore } from ${JSON.stringify(moduleUrl)}; const directory = process.argv[1];`;
    const child = spawn(process.execPath, ['--input-type=module', '--eval', `${prelude}
        const store = createStore({ directory });
        const c = store.createConversation({});
        const request = { schemaVersion: 1, clientRequestId: 'process-request', type: ${JSON.stringify(type)}, content: 'accepted once', expectedContentRevision: 0 };
        const { turn } = store.beginTurn(c.id, request);
        if (request.type === 'group') {
            store.startMember(turn.id, { memberRunId: 'first', characterId: 'alice' }, 1);
            store.commitMember(turn.id, { memberRunId: 'first', characterId: 'alice', content: 'completed member', effects: [{ type: 'variable.set', name: 'temporary', previous: null, value: 1 }] }, 1);
            store.startMember(turn.id, { memberRunId: 'second', characterId: 'bob' }, 1);
        }
        store.appendDelta(turn.id, { text: 'durable partial', reasoning: 'durable reasoning' }, 1);
        const input = { conversationId: c.id, turnId: turn.id, toolCallId: 'uncertain-call', name: 'simulated-side-effect', requestHash: 'hash', args: {} };
        const { record } = store.recordTool(input);
        process.send({ cid: c.id, tid: turn.id, toolId: record.id, input, request, eventCount: store.events(c.id).length });
        setInterval(() => {}, 1000);
    `, directory], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    let reopened;
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await exited;
        reopened?.close();
        await rm(directory, { recursive: true, force: true });
    });
    const ready = await abortable(new Promise((resolve, reject) => {
        child.once('message', resolve);
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`Writer exited before readiness (${code}): ${stderr}`)));
    }), t.signal);
    const runProcess = async script => {
        const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', prelude + script, directory], { timeout: 5000, maxBuffer: 1024 * 1024 });
        return JSON.parse(stdout);
    };
    const contender = await runProcess(`
        try { const s = createStore({ directory }); s.close(); console.log(JSON.stringify({ opened: true })); }
        catch (error) { console.log(JSON.stringify({ code: error.code })); }
    `);
    assert.equal(contender.code, 'store-locked');
    assert.equal(child.kill('SIGKILL'), true);
    assert.deepEqual(await exited, { code: null, signal: 'SIGKILL' });
    const recovery = await runProcess(`
        const s = createStore({ directory });
        console.log(JSON.stringify({ turn: s.getTurn(${JSON.stringify(ready.tid)}), snapshot: s.getConversation(${JSON.stringify(ready.cid)}), tool: s.getTool(${JSON.stringify(ready.toolId)}), events: s.events(${JSON.stringify(ready.cid)}) }));
        s.close();
    `);
    assert.equal(recovery.turn.status, 'interrupted');
    assert.equal(recovery.turn.reasoning, 'durable reasoning');
    assert.equal(recovery.tool.status, 'unknown');
    assert.equal(recovery.snapshot.conversation.activeTurnId, null);
    assert.equal(recovery.snapshot.settings.worldInfo.turnIndex, 0);
    assert.equal(recovery.snapshot.settings.variables?.temporary, undefined);
    assert.equal(recovery.snapshot.messages.at(-1).content, 'durable partial');
    assert.equal(recovery.snapshot.messages.at(-1).status, 'partial');
    assert.equal(recovery.snapshot.messages.filter(m => m.role === 'user').length, 1);
    if (type === 'group') assert.equal(recovery.snapshot.messages[1].content, 'completed member');
    assert.equal(recovery.events.filter(e => e.type === 'turn.interrupted').length, 1);
    assert(recovery.events.length > ready.eventCount);
    assert.deepEqual(recovery.events.map(e => e.seq), recovery.events.map((_, i) => i + 1));
    reopened = createStore({ directory });
    assert.equal(reopened.beginTurn(ready.cid, ready.request).replayed, true);
    assert.equal(reopened.recordTool(ready.input).replayed, true);
    assert.equal(reopened.getTool(ready.toolId).status, 'unknown');
    assert.throws(() => reopened.appendDelta(ready.tid, { text: 'late' }, 1), code('late-callback'));
    assert.deepEqual(reopened.events(ready.cid), recovery.events);
});

test('real acceptance dedupes before version/activity checks and produces one model call and one terminal event', options, async t => {
    const started = gate(), release = gate();
    t.after(() => release.resolve());
    const f = await fixture(t, { run: async call => {
        await call.onEvent({ type: 'text.delta', text: 'durable draft' }); started.resolve();
        await abortable(release.promise, call.signal);
        return { content: 'durable draft', usage: { input: 1, output: 1 }, finishReason: 'stop' };
    } });
    const request = f.request(); const accepted = f.runtime.start(f.conversation.id, request);
    await abortable(started.promise, t.signal);
    const replay = f.runtime.start(f.conversation.id, request);
    assert.equal(replay.replayed, true); assert.equal(replay.turnId, accepted.turnId);
    assert.throws(() => f.runtime.start(f.conversation.id, { ...request, content: 'changed payload' }), code('idempotency-conflict'));
    assert.throws(() => f.runtime.start(f.conversation.id, f.request()), code('conversation-busy'));
    release.resolve(); assert.equal((await f.runtime.wait(accepted.turnId)).status, 'completed');
    assert.equal(f.runtime.start(f.conversation.id, request).replayed, true);
    assert.equal(f.modelCalls.length, 1);
    assert.equal(f.store.getConversation(f.conversation.id).messages.filter(m => m.role === 'user').length, 1);
    const events = f.store.events(f.conversation.id);
    assert.equal(events.filter(e => e.type === 'turn.completed').length, 1);
    assert.deepEqual(events.map(e => e.seq), events.map((_, i) => i + 1));
    assert.equal(events.find(e => e.type === 'text.delta').payload.offset, 0);
});

test('source edits during real memory generation reject the entire derived commit', options, async t => {
    const started = gate(), release = gate(); t.after(() => release.resolve());
    const f = await fixture(t, { generate: async input => { started.resolve(); await abortable(release.promise, input.signal); return { chapter: 'Obsolete summary.', memories: [{ kind: 'user-fact', content: 'Obsolete fact.' }] }; } });
    f.seed(); f.seed();
    const before = f.store.getConversation(f.conversation.id);
    const pending = f.memory.compact(before, { signal: t.signal });
    const rejected = assert.rejects(pending, error => ['source-conflict', 'revision-conflict'].includes(error.code));
    await abortable(started.promise, t.signal);
    const first = before.messages[0];
    f.store.command(f.conversation.id, { type: 'message.edit', messageId: first.id, content: 'Corrected fact.', expectedContentRevision: before.conversation.contentRevision });
    assert.throws(() => f.store.command(f.conversation.id, { type: 'message.edit', messageId: first.id, content: 'Stale edit.', expectedContentRevision: before.conversation.contentRevision }), code('revision-conflict'));
    release.resolve(); await rejected;
    const after = f.store.getConversation(f.conversation.id);
    assert.equal(after.messages[0].content, 'Corrected fact.');
    assert.equal(after.summaries.length, 0); assert.equal(after.memories.length, 0); assert.equal(after.folds.length, 0);
    assert.equal((await f.send()).status, 'completed');
});

test('manual compression enforces caller memory revision before invoking generation', options, async t => {
    const f = await fixture(t); f.seed(); f.seed();
    const old = f.store.getConversation(f.conversation.id);
    f.store.command(f.conversation.id, { type: 'memory.create', kind: 'user-fact', content: 'Manual setting.', expectedMemoryRevision: old.conversation.memoryRevision });
    await assert.rejects(f.runtime.compact(f.conversation.id, { expectedContentRevision: old.conversation.contentRevision, expectedMemoryRevision: old.conversation.memoryRevision }), code('revision-conflict'));
    assert.equal(f.summaryCalls.length, 0);
});

test('real group retry executes only unfinished persisted members and retains the original order and IDs', options, async t => {
    let failed = false; const seen = [];
    const f = await fixture(t, { run: async call => {
        const cid = call.snapshot.settings.characterId; seen.push(cid);
        if (seen.length === 2 && !failed) { failed = true; await call.onEvent({ type: 'text.delta', text: 'Partial member.' }); throw new ProtocolError('model-failed', 'Injected second member failure', 502); }
        await call.onEvent({ type: 'text.delta', text: 'Completed member.' });
        return { content: 'Completed member.', usage: { input: 1, output: 1 }, finishReason: 'stop' };
    } });
    const chars = [f.character, ...['Second', 'Third'].map(name => f.store.createResource({ kind: 'character', name, data: { description: name } }))];
    const group = f.store.createResource({ kind: 'group', name: 'Ordered', data: { mode: 'all', members: chars.map(c => c.id) } });
    f.store.command(f.conversation.id, { type: 'conversation.configure', expectedContentRevision: 0, settings: { groupId: group.id } });
    const first = await f.send({ type: 'group' });
    assert.equal(first.status, 'failed'); assert.equal(first.members.length, 1);
    const beforeRetry = f.store.getConversation(f.conversation.id);
    assert.equal(beforeRetry.messages.at(-1).status, 'partial');
    const retried = await f.send({ type: 'group', retryTurnId: first.id });
    assert.equal(retried.status, 'completed');
    assert.deepEqual(retried.plannedMembers, first.plannedMembers.slice(1));
    assert.deepEqual(seen, [chars[0].id, chars[1].id, chars[1].id, chars[2].id]);
    const snapshot = f.store.getConversation(f.conversation.id);
    assert.equal(snapshot.messages.filter(m => m.role === 'user').length, 1);
    assert.equal(snapshot.messages.filter(m => m.role === 'assistant' && m.status === 'completed').length, 3);
});

test('runtime budget compaction remains valid across a resource edit, then expires at terminal commit', options, async t => {
    const started = gate(), release = gate(); t.after(() => release.resolve());
    let f;
    f = await fixture(t, { workingBudget: 5000, generate: async input => {
        started.resolve(); await abortable(release.promise, input.signal);
        return { chapter: 'Compressed prior discussion.', memories: [] };
    }, run: async call => {
        assert.equal(call.snapshot.resources.find(r => r.id === f.character.id).revision, 1);
        assert(call.snapshot.folds.some(b => b.status === 'valid'));
        assert(call.requestPlan.blocks.some(b => b.content.includes('Compressed prior discussion.')));
        await call.onEvent({ type: 'text.delta', text: 'After compression.' });
        return { content: 'After compression.', usage: { input: 1, output: 1 }, finishReason: 'stop' };
    } });
    for (let i = 0; i < 4; i++) f.seed(`Historical user ${i}: ${'u'.repeat(1200)}`, `Historical reply ${i}: ${'a'.repeat(1200)}`);
    const accepted = f.runtime.start(f.conversation.id, f.request());
    await abortable(started.promise, t.signal);
    f.store.updateResource(f.character.id, { expectedRevision: 1, name: 'After edit', data: { description: 'Updated character.' } });
    assert.equal(f.store.getConversation(f.conversation.id).resources.find(r => r.id === f.character.id).revision, 1);
    release.resolve();
    const turn = await f.runtime.wait(accepted.turnId); assert.equal(turn.status, 'completed');
    assert(f.summaryCalls.length >= 1 && f.summaryCalls.length <= 2);
    const after = f.store.getConversation(f.conversation.id);
    assert.equal(after.resources.find(r => r.id === f.character.id).revision, 2);
    assert(after.summaries.length > 0 && after.summaries.every(b => b.status === 'stale'));
    assert(after.folds.length > 0 && after.folds.every(b => b.status === 'stale'));
});

test('large backup preserves real attachment bytes and references; malformed restore leaves an empty target', { ...options, timeout: 30000 }, async t => {
    const source = await fixture(t);
    const attachments = createAttachmentService({ store: source.store, directory: source.directory });
    const bytes = Buffer.alloc(8 * 1024 * 1024, 0x5a);
    const one = await attachments.save({ name: 'one.txt', mime: 'text/plain', base64: bytes.toString('base64') });
    const two = await attachments.save({ name: 'two.txt', mime: 'text/plain', base64: bytes.toString('base64') });
    // Seed attachment history directly: this test concerns backup, not model media capability.
    const { turn } = source.store.beginTurn(source.conversation.id, source.request({ media: [one, two].map(record => ({ attachmentId: record.id, type: 'document', mimeType: record.mime })) }));
    source.store.finishTurn(turn.id, { status: 'completed', content: 'Files retained.' }, 1);
    const maintenance = createMaintenance({ store: source.store, directory: source.directory });
    const backup = maintenance.backup();
    assert(Buffer.byteLength(JSON.stringify(backup)) > 20 * 1024 * 1024);
    assert.equal(backup.files.length, 2);
    const directory = await mkdtemp(join(tmpdir(), 'conversation-restore-consistency-'));
    const target = createStore({ directory });
    t.after(async () => { target.close(); await rm(directory, { recursive: true, force: true }); });
    const restore = createMaintenance({ store: target, directory });
    const bad = { ...backup, files: backup.files.map((file, i) => i ? file : { ...file, base64: 'aW52YWxpZA==' }) };
    await assert.rejects(restore.restore(bad), code('attachment-corrupt'));
    assert.equal(target.listConversations().length, 0); assert.equal(target.listAttachments().length, 0);
    await restore.restore(backup);
    const reader = createAttachmentService({ store: target, directory });
    assert.deepEqual(reader.read(one.id).bytes, bytes); assert.deepEqual(reader.read(two.id).bytes, bytes);
    assert.equal(target.getConversation(source.conversation.id).messages[0].media.length, 2);
    assert.deepEqual(target.events(source.conversation.id), source.store.events(source.conversation.id));
    // HTTP upload limits are deliberately left to the parent's separate HTTP suite.
});

test('group worldbook duration uses a fixed parent counter and only commits at successful terminal', options, async t => {
    const indices = [];
    let f;
    f = await fixture(t, { run: async call => {
        indices.push(call.snapshot.settings.worldInfo.turnIndex);
        assert.equal(f.store.getConversation(f.conversation.id).settings.worldInfo.state, undefined);
        assert(call.requestPlan.blocks.some(block => block.content.includes('Persistent world fact.')));
        return { content: 'Member response.', usage: { input: 1, output: 1 }, finishReason: 'stop' };
    } });
    const second = f.store.createResource({ kind: 'character', name: 'Second', data: {} });
    const book = f.store.createResource({ kind: 'worldbook', name: 'Timing', data: { entries: [{ id: 'constant', constant: true, content: 'Persistent world fact.', duration: 1, cooldown: 0 }] } });
    const group = f.store.createResource({ kind: 'group', name: 'Both', data: { mode: 'all', members: [f.character.id, second.id] } });
    f.store.command(f.conversation.id, { type: 'conversation.configure', expectedContentRevision: 0, settings: { groupId: group.id, worldbookIds: [book.id] } });
    const result = await f.send({ type: 'group' });
    assert.equal(result.status, 'completed'); assert.deepEqual(indices, [0, 0]);
    const state = f.store.getConversation(f.conversation.id).settings.worldInfo;
    assert.equal(state.turnIndex, 1);
    assert.equal(state.state[`${book.id}:constant`].activatedTurn, 0);
    assert.equal(result.pendingEffects.filter(effect => effect.type === 'worldbook.activate').length, 1);
});
