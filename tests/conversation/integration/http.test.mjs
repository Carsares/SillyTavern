import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startFixture } from './fixture.mjs';

test('HTTP → real pi loop → local wire → SQLite terminal, idempotency and replay', async t => {
    const app = await startFixture(); t.after(() => app.close());
    const body = { type: 'send', content: 'hello', clientRequestId: randomUUID(), expectedContentRevision: 0 };
    const first = await app.api(`/conversations/${app.conversation.id}/turns`, body);
    assert.equal(first.status, 202);
    const result = await app.wait(first.value.turnId);
    assert.equal(result.status, 'completed', JSON.stringify(result.error));
    const replay = await app.api(`/conversations/${app.conversation.id}/turns`, body);
    assert.equal(replay.value.replayed, true); assert.equal(replay.value.turnId, first.value.turnId);
    assert.equal(app.captured.length, 1);
    const snapshot = await app.snapshot();
    assert.deepEqual(snapshot.messages.map(message => message.content), ['hello', 'Local answer']);
    const usage = (await app.api(`/conversations/${app.conversation.id}/usage`)).value;
    assert.equal(usage.totals.calls, 1); assert.equal(usage.totals.totalTokens, 25);
    const abort = new AbortController();
    const events = await fetch(`${app.url}/api/conversation/v1/conversations/${app.conversation.id}/events?after=0`, { signal: abort.signal });
    const { value } = await events.body.getReader().read();
    assert.match(new TextDecoder().decode(value), /turn.accepted/); abort.abort();
    const root = await fetch(app.url, { redirect: 'manual' });
    assert.equal(root.headers.get('location'), '/modern/conversation/');
    assert.equal((await fetch(`${app.url}/api/chats/get`, { method: 'POST' })).status, 403);
});

test('real pi tool loop invokes domain tool once and sends result back to provider', async t => {
    const app = await startFixture(); t.after(() => app.close());
    const accepted = await app.send('USE_DICE');
    const result = await app.wait(accepted.value.turnId);
    assert.equal(result.status, 'completed', JSON.stringify(result.error));
    assert.equal(app.captured.length, 2);
    assert.ok(app.captured[1].body.messages.some(message => message.role === 'tool'));
    assert.equal((await app.snapshot()).messages.at(-1).content, 'Local dice completed');
});

test('stop preserves persisted partial output', async t => {
    const app = await startFixture(); t.after(() => app.close());
    const accepted = await app.send('WAIT_FOR_STOP');
    const until = Date.now() + 10000;
    while (!app.application.services.store.getTurn(accepted.value.turnId).content && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(app.application.services.store.getTurn(accepted.value.turnId).content, 'Local ');
    await app.api(`/turns/${accepted.value.turnId}/stop`, {});
    assert.equal((await app.wait(accepted.value.turnId)).status, 'stopped');
    const snapshot = await app.snapshot();
    assert.equal(snapshot.messages.at(-1).content, 'Local ');
    assert.equal(snapshot.messages.at(-1).status, 'partial');
});

test('backup restores resources history and attachments into a different empty workspace', async t => {
    const app = await startFixture(), target = await startFixture({ seed: false });
    t.after(() => app.close()); t.after(() => target.close());
    const accepted = await app.send('backup me'); await app.wait(accepted.value.turnId);
    const asset = await app.api('/attachments', { name: 'test.txt', mime: 'text/plain', base64: Buffer.from('attachment').toString('base64') });
    assert.equal(asset.status, 201);
    const backup = await app.api('/maintenance/backup', {});
    assert.equal(backup.status, 200);
    assert.equal(JSON.stringify(backup.value).includes('local-protocol-test-key'), false);
    const restored = await target.api('/maintenance/restore', { backup: backup.value });
    assert.equal(restored.status, 200, JSON.stringify(restored.value));
    const snapshot = (await target.api(`/conversations/${app.conversation.id}`)).value;
    assert.equal(snapshot.messages.at(-1).content, 'Local answer');
    const file = await fetch(`${target.url}/api/conversation/v1/attachments/${asset.value.id}`);
    assert.equal(await file.text(), 'attachment');
});

async function completed(app, content, extra = {}) {
    const accepted = await app.send(content, extra);
    assert.equal(accepted.status, 202, JSON.stringify(accepted.value));
    const terminal = await app.wait(accepted.value.turnId);
    assert.equal(terminal.status, 'completed', JSON.stringify(terminal.error));
    const persisted = await app.api(`/turns/${accepted.value.turnId}`);
    assert.equal(persisted.value.status, 'completed');
    return persisted.value;
}

async function eventually(read, predicate) {
    const deadline = Date.now() + 5000;
    let value;
    do {
        value = await read();
        if (predicate(value)) return value;
        await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    assert.fail(`Timed out waiting for persisted state: ${JSON.stringify(value)}`);
}

test('HTTP generation types preserve candidate, continuation and separate draft semantics', async t => {
    const app = await startFixture(); t.after(() => app.close());
    await completed(app, 'hello');
    const original = (await app.snapshot()).messages.at(-1);
    await completed(app, '', { type: 'regenerate', targetMessageId: original.id });
    let snapshot = await app.snapshot();
    assert.equal(snapshot.messages.length, 2);
    assert.equal(snapshot.messages.at(-1).id, original.id);
    assert.notEqual(snapshot.messages.at(-1).candidateId, original.candidateId);
    const regenerated = snapshot.messages.at(-1);
    await completed(app, '', { type: 'continue', targetMessageId: original.id });
    snapshot = await app.snapshot();
    assert.equal(snapshot.messages.at(-1).content, 'Local answerLocal answer');
    assert.equal(snapshot.messages.at(-1).candidateId, regenerated.candidateId);
    assert.ok(snapshot.messages.at(-1).candidateRevision > regenerated.candidateRevision);
    const candidates = await app.api(`/conversations/${app.conversation.id}/messages/${original.id}/candidates`);
    assert.equal(candidates.status, 200);
    assert.equal(candidates.value.length, 3);
    for (const type of ['auxiliary', 'impersonate']) {
        const turn = await completed(app, `Draft for ${type}`, { type });
        assert.equal(turn.content, 'Local answer');
        assert.deepEqual((await app.snapshot()).messages, snapshot.messages);
        assert.ok(JSON.stringify(app.captured.at(-1).body.messages).includes(`Draft for ${type}`));
    }
    assert.equal(app.captured.length, 5);
});

test('HTTP image tool stores bytes and persists only attachment references on the reply', async t => {
    const app = await startFixture(); t.after(() => app.close());
    const image = await app.api('/resources', { kind: 'connection', name: 'Local image', data: { ...app.connectionData, type: 'image' } });
    assert.equal(image.status, 201);
    const configured = await app.api(`/conversations/${app.conversation.id}/commands`, { type: 'conversation.configure', expectedContentRevision: 0, settings: { imageConnectionId: image.value.id, tools: ['generate_image'] } });
    assert.equal(configured.status, 200, JSON.stringify(configured.value));
    await completed(app, 'USE_IMAGE');
    const reply = (await app.snapshot()).messages.at(-1);
    assert.equal(reply.media.length, 1);
    assert.equal(reply.media[0].type, 'image');
    assert.ok(reply.media[0].attachmentId);
    assert.equal(reply.media[0].data, undefined);
    assert.equal(reply.media[0].base64, undefined);
    const file = await fetch(`${app.url}/api/conversation/v1/attachments/${reply.media[0].attachmentId}`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/png');
    const { IMAGE_BASE64 } = await import('./fixture.mjs');
    assert.equal(Buffer.from(await file.arrayBuffer()).toString('base64'), IMAGE_BASE64);
    assert.deepEqual(app.captured.map(request => request.path), ['/v1/chat/completions', '/v1/images/generations', '/v1/chat/completions']);
    const usage = (await app.api(`/conversations/${app.conversation.id}/usage`)).value;
    assert.equal(usage.categories.generation.calls, 2);
    assert.equal(usage.categories.image.calls, 1);
    assert.equal(usage.categories.image.complete, false);
});

test('HTTP manual memory compaction persists summaries, folds and memory usage', async t => {
    const app = await startFixture(); t.after(() => app.close());
    await completed(app, 'First fact');
    await completed(app, 'Second fact');
    const before = await app.snapshot();
    const compact = await app.api(`/conversations/${app.conversation.id}/compact`, { expectedContentRevision: before.conversation.contentRevision, expectedMemoryRevision: before.conversation.memoryRevision });
    assert.equal(compact.status, 200, JSON.stringify(compact.value));
    const after = await app.snapshot();
    assert.equal(after.summaries.filter(item => item.status === 'valid').length, 2);
    assert.equal(after.folds.filter(item => item.status === 'valid').length, 1);
    assert.equal(after.memories[0].content, 'Local remembered fact');
    assert.deepEqual(after.messages, before.messages);
    const usage = (await app.api(`/conversations/${app.conversation.id}/usage`)).value;
    assert.equal(usage.categories.memory.calls, 1);
    assert.equal(usage.categories.memory.totalTokens, 25);
    const traces = (await app.api(`/conversations/${app.conversation.id}/traces`)).value;
    const memory = traces.find(item => item.kind === 'memory');
    assert.equal(memory.turnId, null);
    assert.ok(traces.some(item => item.category === 'memory' && item.parentTraceId === memory.id));
});

test('HTTP background memory completes its persisted job after a completed turn', async t => {
    const app = await startFixture({ settings: { memoryFrequency: 1 } }); t.after(() => app.close());
    await completed(app, 'Remember this fact');
    const jobs = await eventually(async () => (await app.api(`/conversations/${app.conversation.id}/jobs`)).value,
        jobs => jobs.some(job => job.kind === 'memory' && ['completed', 'failed'].includes(job.status)));
    const job = jobs.find(job => job.kind === 'memory');
    assert.equal(job.status, 'completed', JSON.stringify(job));
    const snapshot = await app.snapshot();
    assert.equal(snapshot.summaries.length, 2);
    assert.equal(snapshot.folds.length, 0);
    assert.equal(snapshot.memories[0].content, 'Local remembered fact');
    const usage = (await app.api(`/conversations/${app.conversation.id}/usage`)).value;
    assert.equal(usage.categories.generation.calls, 1);
    assert.equal(usage.categories.memory.calls, 1);
    const traces = (await app.api(`/conversations/${app.conversation.id}/traces`)).value;
    assert.equal(traces.find(item => item.kind === 'memory').turnId, null);
});

test('HTTP generation budget triggers foreground memory with the active turn trace', async t => {
    const app = await startFixture({ settings: { tools: [], retrieval: false } }); t.after(() => app.close());
    const auxiliary = await app.api('/resources', { kind: 'connection', name: 'Local memory', data: app.connectionData });
    assert.equal(auxiliary.status, 201);
    await completed(app, 'First fact '.repeat(250));
    await completed(app, 'Second fact '.repeat(250));
    const primary = await app.api('/resources', { kind: 'connection', name: 'Small generation budget', data: { ...app.connectionData, workingBudget: 5000 } });
    const before = await app.snapshot();
    const configured = await app.api(`/conversations/${app.conversation.id}/commands`, { type: 'conversation.configure', expectedContentRevision: before.conversation.contentRevision,
        settings: { connectionId: primary.value.id, auxiliaryConnectionId: auxiliary.value.id } });
    assert.equal(configured.status, 200);
    const turn = await completed(app, 'A short third fact');
    const snapshot = await app.snapshot();
    assert.ok(snapshot.folds.some(item => item.status === 'valid'));
    const traces = (await app.api(`/conversations/${app.conversation.id}/traces`)).value;
    const memory = traces.find(item => item.kind === 'memory');
    assert.ok(memory);
    assert.equal(memory.turnId, turn.id);
    assert.ok(traces.some(item => item.category === 'memory' && item.parentTraceId === memory.id));
    const usage = (await app.api(`/conversations/${app.conversation.id}/usage`)).value;
    assert.equal(usage.categories.memory.calls, 1);
    assert.equal(usage.turns.find(item => item.turnId === turn.id).calls, 2);
    assert.equal(snapshot.messages.at(-1).content, 'Local answer');
});

async function readEvents(app, { after, lastEventId, until }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Event replay timed out')), 5000);
    const events = [];
    try {
        const response = await fetch(`${app.url}/api/conversation/v1/conversations/${app.conversation.id}/events${after === undefined ? '' : `?after=${after}`}`, {
            headers: lastEventId === undefined ? {} : { 'Last-Event-ID': String(lastEventId) }, signal: controller.signal,
        });
        assert.equal(response.status, 200);
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let pending = '';
        while (!events.some(event => event.type === until)) {
            const { value, done } = await reader.read();
            assert.equal(done, false, 'Event stream ended before the expected event');
            pending += decoder.decode(value, { stream: true });
            let boundary;
            while ((boundary = pending.indexOf('\n\n')) !== -1) {
                const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
                const data = frame.split('\n').find(line => line.startsWith('data: '));
                if (!data) continue;
                const event = JSON.parse(data.slice(6));
                assert.equal(Number(frame.split('\n').find(line => line.startsWith('id: '))?.slice(4)), event.seq);
                events.push(event);
            }
        }
        return events;
    } finally { clearTimeout(timer); controller.abort(); }
}

test('HTTP event replay resumes strictly after query/header cursors without gaps', async t => {
    const app = await startFixture(); t.after(() => app.close());
    await completed(app, 'USE_DICE');
    const all = await readEvents(app, { after: 0, until: 'turn.completed' });
    assert.deepEqual(all.map(event => event.seq), all.map((_, index) => index + 1));
    const cursor = all.find(event => event.type === 'tool.call').seq;
    const suffix = all.filter(event => event.seq > cursor);
    assert.deepEqual(await readEvents(app, { lastEventId: cursor, until: 'turn.completed' }), suffix);
    // An explicit query cursor takes precedence over a stale reconnect header.
    assert.deepEqual(await readEvents(app, { after: cursor, lastEventId: 0, until: 'turn.completed' }), suffix);
    for (const [after, status, code] of [[-1, 400, 'invalid-cursor'], [all.at(-1).seq + 1, 409, 'cursor-expired']]) {
        const response = await app.api(`/conversations/${app.conversation.id}/events?after=${after}`);
        assert.equal(response.status, status);
        assert.equal(response.value.error.code, code);
    }
});

test('HTTP stale revisions return 409 before mutation or model requests', async t => {
    const app = await startFixture(); t.after(() => app.close());
    await completed(app, 'Current history');
    const before = await app.snapshot();
    const staleTurn = await app.send('Must not be accepted', { expectedContentRevision: 0 });
    assert.equal(staleTurn.status, 409);
    assert.equal(staleTurn.value.error.code, 'revision-conflict');
    const staleEdit = await app.api(`/conversations/${app.conversation.id}/commands`, { type: 'message.edit', messageId: before.messages[0].id, content: 'Must not overwrite', expectedContentRevision: 0 });
    assert.equal(staleEdit.status, 409);
    assert.equal(staleEdit.value.error.code, 'revision-conflict');
    const compact = await app.api(`/conversations/${app.conversation.id}/compact`, { expectedContentRevision: before.conversation.contentRevision, expectedMemoryRevision: before.conversation.memoryRevision + 1 });
    assert.equal(compact.status, 409);
    assert.equal(compact.value.error.code, 'revision-conflict');
    const after = await app.snapshot();
    // Each read creates a fresh snapshot ID; compare all persisted state.
    assert.deepEqual({ ...after, id: before.id }, before);
    assert.equal(app.captured.length, 1);
});

test('HTTP tool traces redact synthetic credentials while retaining tool and usage evidence', async t => {
    const app = await startFixture(); t.after(() => app.close());
    const syntheticBearer = 'synthetic-trace-only-credential';
    await completed(app, `USE_TRACE ${app.connectionData.apiKey} Bearer ${syntheticBearer}`);
    const traces = (await app.api(`/conversations/${app.conversation.id}/traces`)).value;
    const generation = traces.find(trace => trace.requestPlan);
    assert.ok(generation.events.some(event => event.type === 'tool.call' && event.name === 'recall_memory'));
    assert.ok(generation.events.some(event => event.type === 'tool.result' && event.name === 'recall_memory' && event.isError === false));
    assert.equal(generation.usage.requests.length, 2);
    assert.equal(traces.filter(trace => trace.kind === 'outbound-request').length, 2);
    assert.ok(app.captured[0].body.messages.some(message => JSON.stringify(message).includes(syntheticBearer)), 'The test must actually deliver the synthetic secret before inspecting redaction');
    for (const trace of traces) {
        const detail = await app.api(`/traces/${trace.id}`);
        assert.equal(detail.status, 200);
        assert.deepEqual(detail.value, trace);
        const json = JSON.stringify(detail.value);
        assert.equal(json.includes(syntheticBearer), false);
        assert.equal(json.includes(app.connectionData.apiKey), false);
    }
    assert.match(JSON.stringify(generation.events.find(event => event.type === 'tool.call').args), /redacted/);
});

test('HTTP restore accepts a valid backup above 20 MiB while ordinary JSON routes reject it', { timeout: 30000 }, async t => {
    const source = await startFixture(), target = await startFixture({ seed: false });
    t.after(() => source.close()); t.after(() => target.close());
    const bytes = Buffer.alloc(8 * 1024 * 1024, 0x5a), base64 = bytes.toString('base64');
    const ids = [];
    for (const name of ['large-one.txt', 'large-two.txt']) {
        const uploaded = await source.api('/attachments', { name, mime: 'text/plain', base64 });
        assert.equal(uploaded.status, 201);
        ids.push(uploaded.value.id);
    }
    await completed(source, 'Large backup history');
    const exported = await source.api('/maintenance/backup', {});
    assert.equal(exported.status, 200);
    const body = { backup: exported.value };
    assert.ok(Buffer.byteLength(JSON.stringify({ schemaVersion: 1, ...body })) > 20 * 1024 * 1024);
    const rejected = await target.api('/resources', body);
    assert.equal(rejected.status, 413);
    assert.deepEqual((await target.api('/resources')).value, []);
    assert.deepEqual((await target.api('/conversations')).value, []);
    const restored = await target.api('/maintenance/restore', body);
    assert.equal(restored.status, 200, JSON.stringify(restored.value));
    assert.equal((await target.snapshot(source.conversation.id)).messages.at(-1).content, 'Local answer');
    for (const id of ids) {
        const file = await fetch(`${target.url}/api/conversation/v1/attachments/${id}`);
        assert.equal(file.status, 200);
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
    }
});

test('HTTP generation recalls a folded original without duplicating recent history', async t => {
    const app = await startFixture({ settings: { tools: [] } }); t.after(() => app.close());
    await completed(app, 'The obsidian-key belongs to Mira.');
    await completed(app, 'A recent unrelated fact.');
    const snapshot = await app.snapshot();
    const compact = await app.api(`/conversations/${app.conversation.id}/compact`, { expectedContentRevision: snapshot.conversation.contentRevision, expectedMemoryRevision: snapshot.conversation.memoryRevision });
    assert.equal(compact.status, 200);
    await completed(app, 'obsidian-key');
    const sent = app.captured.at(-1).body.messages;
    const text = sent.map(message => typeof message.content === 'string' ? message.content : (message.content ?? []).map(part => part.text ?? '').join(''));
    assert.equal(text.filter(value => value === 'The obsidian-key belongs to Mira.').length, 1);
    assert.equal(text.filter(value => value === 'obsidian-key').length, 1);
    assert.ok(text.includes('Local rolling'));
    const traces = (await app.api(`/conversations/${app.conversation.id}/traces`)).value;
    const latest = traces.filter(trace => trace.requestPlan?.type === 'send').at(-1);
    assert.ok(latest.requestPlan.blocks.some(block => block.layer === 'L3' && block.content.includes('obsidian-key belongs to Mira')));
    const state = app.application.services.runtime.retrievalStatus(app.conversation.id);
    assert.equal(state.status, 'keyword-only');
    assert.equal(state.semanticReady, false);
    assert.ok(app.application.services.store.events(app.conversation.id).some(event => event.type === 'retrieval.updated' && event.payload.status === 'keyword-only'));
});

test('HTTP history edits automatically refresh the semantic index and expose failures without stopping keyword retrieval', async t => {
    const app = await startFixture({ settings: { tools: [] } }); t.after(() => app.close());
    const embedding = await app.api('/resources', { kind: 'connection', name: 'Local embedding', data: { ...app.connectionData, type: 'embedding' } });
    assert.equal(embedding.status, 201);
    const configured = await app.api(`/conversations/${app.conversation.id}/commands`, { type: 'conversation.configure', expectedContentRevision: 0, settings: { embeddingConnectionId: embedding.value.id } });
    assert.equal(configured.status, 200);
    await completed(app, 'Old indexed fact');
    const runtime = app.application.services.runtime;
    await eventually(() => runtime.retrievalStatus(app.conversation.id), state => state.status === 'ready' && state.count === 2);
    const before = await app.snapshot();
    const edit = await app.api(`/conversations/${app.conversation.id}/commands`, { type: 'message.edit', messageId: before.messages[0].id,
        content: 'Edited indexed fact', expectedContentRevision: before.conversation.contentRevision });
    assert.equal(edit.status, 200);
    await eventually(() => app.captured.filter(item => item.path === '/v1/embeddings'), calls => calls.some(call => call.body.input.includes('Edited indexed fact')));
    await eventually(() => runtime.retrievalStatus(app.conversation.id), state => state.status === 'ready');
    const current = await app.snapshot();
    const failure = await app.api(`/conversations/${app.conversation.id}/commands`, { type: 'message.edit', messageId: current.messages[0].id,
        content: 'FAIL_INDEX', expectedContentRevision: current.conversation.contentRevision });
    assert.equal(failure.status, 200);
    const state = await eventually(() => runtime.retrievalStatus(app.conversation.id), value => value.status === 'error');
    assert.equal(state.semanticReady, false);
    assert.equal(state.error.code, 'index-failed');
    assert.ok(app.application.services.store.events(app.conversation.id).some(event => event.type === 'retrieval.updated' && event.payload.status === 'error'));
    await completed(app, 'Still generate without embeddings');
});

test('HTTP user-hidden history and dependent summaries never reach the next request', async t => {
    const app = await startFixture({ settings: { tools: [] } }); t.after(() => app.close());
    await completed(app, 'The hidden-vault code is orchid-seven.');
    await completed(app, 'Recent public fact.');
    let snapshot = await app.snapshot();
    assert.equal((await app.api(`/conversations/${app.conversation.id}/compact`, { expectedContentRevision: snapshot.conversation.contentRevision, expectedMemoryRevision: snapshot.conversation.memoryRevision })).status, 200);
    snapshot = await app.snapshot();
    const hide = await app.api(`/conversations/${app.conversation.id}/commands`, { type: 'message.hide', messageId: snapshot.messages[0].id,
        hidden: true, expectedContentRevision: snapshot.conversation.contentRevision });
    assert.equal(hide.status, 200, JSON.stringify(hide.value));
    assert.equal((await app.snapshot()).messages[0].userHidden, true);
    await completed(app, 'hidden-vault');
    const wire = JSON.stringify(app.captured.at(-1).body.messages);
    assert.equal(wire.includes('orchid-seven'), false);
    assert.equal(wire.includes('Local rolling'), false);
    assert.equal(wire.includes('Local chapter'), false);
    const status = await app.api(`/conversations/${app.conversation.id}/retrieval`);
    assert.equal(status.status, 200);
    assert.equal(status.value.status, 'keyword-only');
});
