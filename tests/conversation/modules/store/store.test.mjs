import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../../../src/conversation/store/index.js';
import { mediaType } from '../../../../src/conversation/store/media.js';
import { sourceRef } from '../../../../public/shared/conversation/schemas/index.js';

function fixture(t) {
    const directory = mkdtempSync(join(tmpdir(), 'conversation-store-'));
    const store = createStore({ directory });
    t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
    const c = store.createConversation({ title: 'unit' });
    return { store, directory, cid: c.id };
}
function request(store, cid, extra = {}) { return { schemaVersion: 1, clientRequestId: crypto.randomUUID(), type: 'send', content: 'hello', expectedContentRevision: store.getConversation(cid).conversation.contentRevision, ...extra }; }
function complete(store, cid) { const { turn } = store.beginTurn(cid, request(store, cid)); store.finishTurn(turn.id, { status: 'completed', content: 'answer' }, 1); return store.getConversation(cid); }
const code = expected => error => error.code === expected;

test('subscriptions run only after commit, isolate listeners and preserve reentrant event order', async t => {
    const { store, cid } = fixture(t); const seen = [];
    const stopThrowing = store.subscribe(() => { throw Error('listener failed'); });
    const stopRejecting = store.subscribe(async () => { throw Error('async listener failed'); });
    const stopWriter = store.subscribe(event => {
        if (event.type === 'test.first') store.appendEvent(cid, 'test.second', {});
    });
    const unsubscribe = store.subscribe(event => {
        assert.equal(store.events(cid).some(saved => saved.eventId === event.eventId), true);
        seen.push(event.type); event.payload.changed = true;
    });
    store.appendEvent(cid, 'test.first', {});
    assert.deepEqual(seen, ['test.first', 'test.second']);
    assert.equal(store.events(cid).at(-1).payload.changed, undefined);
    const before = store.events(cid);
    assert.throws(() => store.beginTurn(cid, request(store, cid), () => { throw Error('preflight rejected'); }), /preflight rejected/);
    assert.deepEqual(store.events(cid), before); assert.equal(seen.length, 2);
    const { turn } = store.beginTurn(cid, request(store, cid));
    const count = seen.length;
    assert.throws(() => store.finishTurn(turn.id, { status: 'completed', content: 'discard', memoryProposals: { summaries: [{ id: 'rollback-summary', content: 'discard' }] }, effects: [{ type: 'variable.set', name: 'x', previous: 99, value: 1 }] }, 1), code('revision-conflict'));
    assert.equal(seen.length, count); assert.equal(store.getConversation(cid).summaries.length, 0);
    unsubscribe(); unsubscribe(); stopWriter(); stopThrowing(); stopRejecting();
    store.appendEvent(cid, 'test.after-unsubscribe', {});
    assert.equal(seen.length, count);
    await new Promise(resolve => setImmediate(resolve));
});

test('listTools isolates conversation records and redacts returned copies', t => {
    const { store, cid } = fixture(t); const other = store.createConversation({});
    const { turn } = store.beginTurn(cid, request(store, cid));
    const { record } = store.recordTool({ conversationId: cid, turnId: turn.id, toolCallId: 'list', requestHash: 'hash', name: 'test', args: { apiKey: 'private' } });
    const records = store.listTools(cid);
    assert.equal(records[0].id, record.id); assert.equal(records[0].args.apiKey, undefined);
    records[0].status = 'completed'; assert.equal(store.listTools(cid)[0].status, 'intent');
    assert.deepEqual(store.listTools(other.id), []);
    assert.throws(() => store.listTools('missing'), code('not-found'));
});

test('proxy URL credentials remain private and are absent from public resources, snapshots and backup', t => {
    const { store, cid } = fixture(t);
    const proxy = { url: 'http://fixture-user:fixture-password@localhost:1234' };
    const connection = store.createResource({ kind: 'connection', data: { proxy, nested: { proxy } } });
    assert.equal(connection.data.proxy, undefined); assert.equal(connection.data.nested.proxy, undefined);
    assert.deepEqual(store.getConnection(connection.id, 1).data.proxy, proxy);
    assert.equal(store.getResource(connection.id).data.proxy, undefined);
    assert.equal(store.listResources('connection')[0].data.proxy, undefined);
    store.command(cid, { type: 'conversation.configure', settings: { connectionId: connection.id }, expectedContentRevision: 0 });
    const accepted = store.beginTurn(cid, request(store, cid));
    assert.equal(accepted.snapshot.resources[0].data.proxy, undefined);
    assert.equal(store.getTurnSnapshot(accepted.turn.id).resources[0].data.proxy, undefined);
    assert.equal(store.getConversation(cid).resources[0].data.proxy, undefined);
    const backup = store.exportData();
    assert.equal(backup.resources[connection.id].versions[1].data.proxy, undefined);
    assert.equal(JSON.stringify(backup).includes('fixture-password'), false);
    assert.deepEqual(store.getConnection(connection.id).data.proxy, proxy);
});

test('summary editing protects manual content and invalidates dependent summaries and folds', t => {
    const { store, cid } = fixture(t); const snap = complete(store, cid); const sourceRefs = [sourceRef(snap.messages[0])];
    store.commitDerived(cid, { summaries: [{ id: 'chapter', content: 'old', sourceRefs }, { id: 'rolling', content: 'old rolling', parentSummaryRefs: [{ id: 'chapter', revision: 1 }] }], folds: [{ id: 'fold', sourceRefs, summaryRef: { id: 'chapter', revision: 1 } }] });
    const before = store.getConversation(cid);
    store.command(cid, { type: 'summary.edit', summaryId: 'chapter', expectedBlockRevision: 1, content: 'manual correction' });
    const view = store.getConversation(cid); const chapter = view.summaries.find(b => b.id === 'chapter');
    assert.equal(chapter.origin, 'manual'); assert.equal(chapter.revision, 2); assert.equal(chapter.status, 'valid');
    assert.equal(view.conversation.contentRevision, before.conversation.contentRevision);
    assert.equal(view.summaries.find(b => b.id === 'rolling').status, 'stale'); assert.equal(view.folds[0].status, 'stale');
    assert.throws(() => store.command(cid, { type: 'summary.edit', summaryId: 'chapter', expectedBlockRevision: 1, content: 'stale edit' }), code('revision-conflict'));
    assert.throws(() => store.commitDerived(cid, { summaries: [{ id: 'chapter', expectedBlockRevision: 2, content: 'automatic replacement' }] }), code('memory-protected'));
    store.command(cid, { type: 'message.hide', messageId: snap.messages[0].id, hidden: true, expectedContentRevision: view.conversation.contentRevision });
    assert.equal(store.getConversation(cid).summaries.find(b => b.id === 'chapter').status, 'pending-confirm');
    store.command(cid, { type: 'fold.expand', foldId: 'fold', expectedContentRevision: store.getConversation(cid).conversation.contentRevision });
    assert.equal(store.getConversation(cid).messages[0].userHidden, true);
    assert.equal(store.getMessageHistory(cid, snap.messages[0].id).versions.length, 1);
});

test('unknown tools block successful finish and explicit terminal recovery is idle, atomic and idempotent', t => {
    const { store, cid } = fixture(t); const { turn } = store.beginTurn(cid, request(store, cid));
    const { record } = store.recordTool({ conversationId: cid, turnId: turn.id, toolCallId: 'recovery', requestHash: 'hash', name: 'simulated', args: {} });
    store.finishTool(record.id, { status: 'unknown' });
    const before = store.exportData();
    assert.throws(() => store.finishTurn(turn.id, { status: 'completed', content: 'must not commit' }, 1), code('tool-result-unknown'));
    assert.deepEqual(store.exportData(), before);
    store.finishTurn(turn.id, { status: 'failed' }, 1);
    const oldTurn = store.getTurn(turn.id), oldMessages = store.getConversation(cid).messages;
    const next = store.beginTurn(cid, request(store, cid)).turn;
    assert.throws(() => store.recoverTool(record.id, { status: 'completed', result: { value: 'resolved' } }), code('conversation-busy'));
    store.finishTurn(next.id, { status: 'failed' }, 1);
    const result = { status: 'completed', result: { value: 'resolved' }, usage: { cost: 1 } };
    assert.equal(store.recoverTool(record.id, result).replayed, false);
    const recovered = store.exportData();
    assert.equal(store.recoverTool(record.id, result).replayed, true); assert.deepEqual(store.exportData(), recovered);
    assert.throws(() => store.recoverTool(record.id, { status: 'failed' }), code('idempotency-conflict'));
    assert.deepEqual(store.getTurn(turn.id), oldTurn);
    assert.deepEqual(store.getConversation(cid).messages.slice(0, oldMessages.length), oldMessages);
    assert.equal(store.events(cid).filter(e => e.type === 'tool.recovered').length, 1);
});

test('recomputed job updates dependencies and fingerprint atomically before derived commit', t => {
    const { store, cid } = fixture(t); const snapshot = complete(store, cid);
    const message = snapshot.messages[0];
    const job = store.createJob({ conversationId: cid, kind: 'memory', dependencies: { sourceRefs: [sourceRef(message)] }, payload: {} });
    store.command(cid, { type: 'message.edit', messageId: message.id, content: 'corrected source', expectedContentRevision: snapshot.conversation.contentRevision });
    const dependencies = { sourceRefs: [sourceRef(store.getConversation(cid).messages[0])] };
    const saved = store.updateJob(job.id, { status: 'running', attempts: 1, dependencies });
    assert.deepEqual(saved.dependencies, dependencies); assert.notEqual(saved.fingerprint, job.fingerprint);
    assert.equal(store.createJob({ conversationId: cid, kind: 'memory', dependencies, payload: {} }).id, job.id);
    store.updateJob(job.id, { status: 'ready', result: { proposal: { ...dependencies, summaries: [{ id: 'recomputed-summary', content: 'correct summary' }] } } });
    assert.equal(store.commitDerivedJob(job.id).accepted, true);
    assert.deepEqual(store.getConversation(cid).summaries[0].sourceRefs, dependencies.sourceRefs);
    const other = store.createJob({ conversationId: cid, kind: 'memory', dependencies: { sourceRefs: [] }, payload: {} });
    const before = store.exportData();
    assert.throws(() => store.updateJob(other.id, { dependencies, status: 'running', attempts: 1 }), code('idempotency-conflict'));
    assert.deepEqual(store.exportData(), before);
    assert.throws(() => store.updateJob(job.id, { dependencies: { sourceRefs: [] } }), code('idempotency-conflict'));
    assert.deepEqual(store.exportData(), before);
});

for (const status of ['failed', 'stopped', 'interrupted']) test(`group ${status} discards durable effects and retry inherits completed temporary effects`, t => {
    const { store, cid } = fixture(t);
    const chars = ['a', 'b'].map(name => store.createResource({ kind: 'character', name, data: {} }));
    store.command(cid, { type: 'conversation.configure', resourceRefs: chars.map(r => ({ id: r.id })), expectedContentRevision: 0 });
    const members = chars.map((r, i) => ({ id: `member-${i}`, characterId: r.id }));
    const first = store.beginTurn(cid, request(store, cid, { type: 'group' }), () => ({ members })).turn;
    store.commitMember(first.id, { memberRunId: members[0].id, characterId: chars[0].id, content: 'one', effects: [{ type: 'variable.set', name: 'score', previous: null, value: 1 }] }, 1);
    assert.equal(store.getTurnSnapshot(first.id).settings.variables.score, 1);
    assert.equal(store.getTurnSnapshot(first.id).settings.worldInfo.turnIndex, 0);
    if (status === 'stopped') store.requestStop(first.id);
    store.finishTurn(first.id, { status }, 1);
    assert.equal(store.getConversation(cid).settings.variables?.score, undefined);
    assert.equal(store.getConversation(cid).settings.worldInfo.turnIndex, 0);
    const retry = store.beginTurn(cid, request(store, cid, { type: 'group', retryTurnId: first.id })).turn;
    assert.equal(store.getTurnSnapshot(retry.id).settings.variables.score, 1);
    assert.deepEqual(retry.plannedMembers, members.slice(1));
    store.commitMember(retry.id, { memberRunId: members[1].id, characterId: chars[1].id, content: 'two', effects: [{ type: 'variable.set', name: 'score', previous: 1, value: 2 }] }, 1);
    store.finishTurn(retry.id, { status: 'completed' }, 1);
    assert.equal(store.getConversation(cid).settings.variables.score, 2);
    assert.equal(store.getConversation(cid).settings.worldInfo.turnIndex, 1);
});

test('business counter is server controlled and drafts do not persist effects or advance it', t => {
    const { store, cid } = fixture(t);
    store.command(cid, { type: 'conversation.configure', settings: { worldInfo: { turnIndex: 99 } }, expectedContentRevision: 0 });
    assert.equal(store.getConversation(cid).settings.worldInfo.turnIndex, 0);
    for (const type of ['auxiliary', 'impersonate']) {
        const { turn } = store.beginTurn(cid, request(store, cid, { type }));
        store.finishTurn(turn.id, { status: 'completed', content: 'draft', effects: [{ type: 'variable.set', name: 'x', value: 1 }] }, 1);
        assert.equal(store.getConversation(cid).settings.worldInfo.turnIndex, 0);
        assert.equal(store.getConversation(cid).settings.variables?.x, undefined);
    }
    complete(store, cid);
    assert.equal(store.getConversation(cid).settings.worldInfo.turnIndex, 1);
    const target = store.getConversation(cid).messages.at(-1).id;
    for (const type of ['regenerate', 'continue']) {
        const { turn } = store.beginTurn(cid, request(store, cid, { type, targetMessageId: target }));
        store.finishTurn(turn.id, { status: 'completed', content: 'reply' }, 1);
    }
    assert.equal(store.getConversation(cid).settings.worldInfo.turnIndex, 3);
});

test('derived job commit is atomic, blocks active turns and replays without more events', t => {
    const { store, cid } = fixture(t); const snap = complete(store, cid);
    const refs = [sourceRef(snap.messages[0])];
    const job = store.createJob({ conversationId: cid, kind: 'memory', dependencies: { sourceRefs: refs }, payload: {} });
    const proposal = { sourceRefs: refs, summaries: [{ id: 'job-summary', content: 'summary' }], memories: [{ id: 'job-memory', content: 'fact', sourceRefs: [{ ...refs[0], revision: 999 }] }] };
    store.updateJob(job.id, { status: 'ready', result: { proposal } });
    const before = store.exportData();
    assert.throws(() => store.commitDerivedJob(job.id), code('source-conflict'));
    assert.deepEqual(store.exportData(), before);
    proposal.memories = [];
    store.updateJob(job.id, { status: 'ready', result: { proposal } });
    const { turn } = store.beginTurn(cid, request(store, cid));
    assert.throws(() => store.commitDerivedJob(job.id), code('conversation-busy'));
    store.finishTurn(turn.id, { status: 'failed' }, 1);
    assert.equal(store.commitDerivedJob(job.id).status, 'completed');
    const after = store.exportData();
    assert.equal(store.commitDerivedJob(job.id).replayed, true);
    assert.deepEqual(store.exportData(), after);
    assert.equal(store.getConversation(cid).summaries.length, 1);
});

function imagePart(store, id) {
    store.saveAttachment({ id, name: `${id}.png`, mime: 'image/png', size: 10, sha256: 'a'.repeat(64), path: `opaque-${id}`, createdAt: 1 });
    return { attachmentId: id, type: 'image', mimeType: 'image/png' };
}

test('assistant image-only results persist, continuation merges media and regeneration replaces it immutably', t => {
    const { store, cid } = fixture(t);
    const first = imagePart(store, 'first'), second = imagePart(store, 'second');
    const { turn } = store.beginTurn(cid, request(store, cid));
    const before = store.exportData();
    for (const part of [{ ...first, path: '/tmp/injected' }, { ...first, attachmentId: 'missing' }, { ...first, type: 'document' }]) {
        assert.throws(() => store.finishTurn(turn.id, { status: 'completed', media: [part] }, 1), code('invalid-media'));
        assert.deepEqual(store.exportData(), before);
    }
    store.finishTurn(turn.id, { status: 'completed', media: [first] }, 1);
    const original = store.getConversation(cid).messages.at(-1);
    assert.equal(original.role, 'assistant'); assert.equal(original.content, ''); assert.deepEqual(original.media, [first]);
    const continued = store.beginTurn(cid, request(store, cid, { type: 'continue', targetMessageId: original.id })).turn;
    store.finishTurn(continued.id, { status: 'completed', media: [second] }, 1);
    assert.deepEqual(store.getConversation(cid).messages.at(-1).media, [first, second]);
    const regenerated = store.beginTurn(cid, request(store, cid, { type: 'regenerate', targetMessageId: original.id })).turn;
    store.finishTurn(regenerated.id, { status: 'completed', media: [second] }, 1);
    assert.deepEqual(store.getConversation(cid).messages.at(-1).media, [second]);
    const history = store.getMessageHistory(cid, original.id);
    assert.equal(history.messageId, original.id); assert.equal(history.conversationId, cid); assert.equal(history.deletedAt, null);
    assert.deepEqual(history.versions.map(v => v.media), [[first], [first, second], [second]]);
    assert.throws(() => store.deleteAttachment(first.attachmentId), code('attachment-in-use'));
    const other = store.createConversation({});
    assert.throws(() => store.getMessageHistory(other.id, original.id), code('not-found'));
    history.versions[0].media.length = 0;
    assert.deepEqual(store.getMessageHistory(cid, original.id).versions[0].media, [first]);
    store.command(cid, { type: 'message.delete', messageId: original.id, expectedContentRevision: store.getConversation(cid).conversation.contentRevision });
    assert.ok(store.getMessageHistory(cid, original.id).deletedAt);
});

test('image-only group members keep stream IDs, replay once and preserve partial member media', t => {
    const { store, cid } = fixture(t); const media = [imagePart(store, 'group-image')];
    const { turn } = store.beginTurn(cid, request(store, cid, { type: 'group' }));
    const started = store.startMember(turn.id, { memberRunId: 'one', characterId: 'alice' }, 1);
    const input = { memberRunId: 'one', characterId: 'alice', media };
    const before = store.exportData();
    assert.throws(() => store.commitMember(turn.id, { ...input, media: [{ ...media[0], url: 'file:///tmp/x' }] }, 1), code('invalid-media'));
    assert.deepEqual(store.exportData(), before);
    store.commitMember(turn.id, input, 1); store.commitMember(turn.id, input, 1);
    const completed = store.getConversation(cid).messages.at(-1);
    assert.equal(completed.id, started.messageId); assert.equal(completed.candidateId, started.candidateId);
    assert.equal(completed.content, ''); assert.deepEqual(completed.media, media);
    const next = store.startMember(turn.id, { memberRunId: 'two', characterId: 'bob' }, 1);
    store.finishTurn(turn.id, { status: 'failed', media }, 1);
    const messages = store.getConversation(cid).messages;
    assert.equal(messages.length, 3); assert.equal(messages.at(-1).id, next.messageId);
    assert.equal(messages.at(-1).status, 'partial'); assert.deepEqual(messages.at(-1).media, media);
    const restoredDirectory = mkdtempSync(join(tmpdir(), 'conversation-group-image-'));
    const restored = createStore({ directory: restoredDirectory });
    t.after(() => { restored.close(); rmSync(restoredDirectory, { recursive: true, force: true }); });
    restored.restoreData(store.exportData());
    assert.deepEqual(restored.getConversation(cid).messages, messages);
    assert.deepEqual(restored.getTurn(turn.id).members[0].media, media);
});

test('document attachments accept explicit provider MIME types and survive backup restore', t => {
    const { store, cid } = fixture(t);
    const parts = ['application/pdf', 'text/plain'].map((mime, i) => {
        const record = { id: `document-${i}`, name: `document-${i}`, mime, size: 10, sha256: 'a'.repeat(64), path: `opaque-document-${i}`, createdAt: 1 };
        store.saveAttachment(record);
        assert.equal(mediaType(mime), 'document');
        return { attachmentId: record.id, type: 'document', mimeType: mime, name: record.name, size: record.size };
    });
    const before = store.exportData();
    for (const part of [{ ...parts[0], type: 'file' }, { ...parts[1], type: 'image' }, { ...parts[0], mimeType: 'text/plain' }]) {
        assert.throws(() => store.beginTurn(cid, request(store, cid, { media: [part] })), code('invalid-media'));
        assert.deepEqual(store.exportData(), before);
    }
    const { turn } = store.beginTurn(cid, request(store, cid, { media: parts }));
    store.finishTurn(turn.id, { status: 'completed', content: 'documents read' }, 1);
    const restoredDirectory = mkdtempSync(join(tmpdir(), 'conversation-document-restore-'));
    const restored = createStore({ directory: restoredDirectory });
    t.after(() => { restored.close(); rmSync(restoredDirectory, { recursive: true, force: true }); });
    restored.restoreData(store.exportData());
    assert.deepEqual(restored.getConversation(cid).messages[0].media, parts);
    assert.equal(restored.getConversation(cid).attachments['document-0'].mime, 'application/pdf');
});

test('unknown files may be registered but cannot be sent or disguised as documents', t => {
    const { store, cid } = fixture(t);
    for (const [i, mime] of ['application/octet-stream', 'application/msword', 'text/html'].entries()) {
        assert.equal(mediaType(mime), 'file');
        store.saveAttachment({ id: `file-${i}`, name: 'document.pdf', mime, size: 10, sha256: 'a'.repeat(64), path: `opaque-file-${i}`, createdAt: 1 });
        const before = store.exportData();
        for (const part of [
            { attachmentId: `file-${i}`, type: 'file', mimeType: mime },
            { attachmentId: `file-${i}`, type: 'document', mimeType: mime },
            { attachmentId: `file-${i}`, type: 'document', mimeType: 'application/pdf' },
        ]) {
            assert.throws(() => store.beginTurn(cid, request(store, cid, { media: [part] })), code('invalid-media'));
            assert.deepEqual(store.exportData(), before);
        }
    }
    assert.equal(store.listAttachments().length, 3);
});

test('canonical dedupe precedes revision, activity, resources and preflight; rollback on preflight failure', t => {
    const { store, cid } = fixture(t); const r = request(store, cid); let calls = 0;
    const first = store.beginTurn(cid, r, () => { calls++; });
    assert.equal(store.beginTurn(cid, { ...r }, () => { throw Error('must not run'); }).replayed, true);
    assert.equal(calls, 1);
    assert.throws(() => store.beginTurn(cid, { ...r, content: 'changed' }), code('idempotency-conflict'));
    assert.throws(() => store.beginTurn(cid, request(store, cid)), code('conversation-busy'));
    store.finishTurn(first.turn.id, { status: 'completed', content: 'ok' }, 1);
    const before = store.exportData();
    assert.throws(() => store.beginTurn(cid, request(store, cid), () => { throw Error('reject'); }), /reject/);
    assert.deepEqual(store.exportData(), before);
    assert.equal(store.beginTurn(cid, r).turn.id, first.turn.id);
});

test('deltas persist stable message IDs, stop rejects late callbacks and finalizes once', t => {
    const { store, cid } = fixture(t); const { turn } = store.beginTurn(cid, request(store, cid));
    store.appendDelta(turn.id, { text: 'abc', reasoning: 'r' }, 1);
    assert.equal(store.getTurn(turn.id).content, 'abc');
    const delta = store.events(cid).find(e => e.type === 'text.delta');
    store.requestStop(turn.id);
    assert.throws(() => store.appendDelta(turn.id, { text: 'late' }, 1), code('late-callback'));
    assert.throws(() => store.finishTurn(turn.id, { status: 'completed' }, 1), code('late-callback'));
    store.finishTurn(turn.id, { status: 'stopped' }, 1);
    const snap = store.getConversation(cid);
    assert.equal(snap.messages.at(-1).id, delta.payload.messageId);
    assert.equal(snap.messages.at(-1).status, 'partial');
    assert.equal(snap.conversation.activeTurnId, null);
    assert.throws(() => store.finishTurn(turn.id, { status: 'stopped' }, 1), code('late-callback'));
    assert.deepEqual(store.events(cid).map(e => e.seq), store.events(cid).map((_, i) => i + 1));
});

test('regenerate and continuation preserve immutable history and stopped candidates stay unselected', t => {
    const { store, cid } = fixture(t); const original = complete(store, cid).messages.at(-1);
    const { turn } = store.beginTurn(cid, request(store, cid, { type: 'regenerate', targetMessageId: original.id }));
    store.finishTurn(turn.id, { status: 'stopped', content: 'partial' }, 1);
    assert.equal(store.getConversation(cid).messages.at(-1).content, 'answer');
    assert.equal(store.getMessageHistory(cid, original.id).versions.length, 2);
    const next = store.beginTurn(cid, request(store, cid, { type: 'continue', targetMessageId: original.id }));
    store.finishTurn(next.turn.id, { status: 'completed', content: ' more' }, 1);
    assert.equal(store.getConversation(cid).messages.at(-1).content, 'answer more');
    assert.equal(store.getMessageHistory(cid, original.id).versions[0].content, 'answer');
});

test('derived commits are atomic and invalidate transitive summaries, folds and locked memories', t => {
    const { store, cid } = fixture(t); const snap = complete(store, cid); const ref = sourceRef(snap.messages[0]);
    store.commitDerived(cid, { summaries: [{ id: 's1', content: 'one', sourceRefs: [ref] }, { id: 's2', content: 'two', parentSummaryRefs: [{ id: 's1', revision: 1 }] }], memories: [{ id: 'm1', content: 'fact', sourceRefs: [ref] }], folds: [{ id: 'f1', summaryRef: { id: 's2', revision: 1 } }] });
    store.command(cid, { type: 'memory.lock', memoryId: 'm1', expectedBlockRevision: 1 });
    const before = store.exportData();
    assert.throws(() => store.commitDerived(cid, { summaries: [{ id: 'new', content: 'x' }], memories: [{ id: 'm1', revision: 2, content: 'overwrite' }] }), code('memory-protected'));
    assert.deepEqual(store.exportData(), before);
    const edited = store.command(cid, { type: 'message.edit', messageId: ref.messageId, content: 'changed', expectedContentRevision: snap.conversation.contentRevision });
    assert.deepEqual(edited.summaries.map(b => b.status), ['stale', 'stale']);
    assert.equal(edited.folds[0].status, 'stale');
    assert.equal(edited.memories[0].status, 'pending-confirm');
});

test('resource revisions frozen and credentials only available through internal connection API', t => {
    const { store, cid } = fixture(t); const r = store.createResource({ kind: 'connection', name: 'x', data: { apiKey: 'sensitive', maxOutputTokens: 200, headers: { Authorization: 'secret' } } });
    assert.equal(r.data.apiKey, undefined); assert.equal(r.data.maxOutputTokens, 200);
    store.command(cid, { type: 'conversation.configure', settings: { connectionId: r.id }, expectedContentRevision: 0 });
    const req = request(store, cid); const first = store.beginTurn(cid, req);
    store.updateResource(r.id, { expectedRevision: 1, data: { apiKey: 'new', maxOutputTokens: 400 } });
    store.deleteResource(r.id, 2);
    assert.equal(store.beginTurn(cid, req).snapshot.resources[0].revision, 1);
    assert.equal(store.getResource(r.id, 1).data.apiKey, undefined);
    assert.equal(first.snapshot.resources[0].data.maxOutputTokens, 200);
});

test('process lock, reopening recovery, unknown tool dedupe and consistent backup restore', t => {
    const { store, cid, directory } = fixture(t);
    assert.throws(() => createStore({ directory }), code('store-locked'));
    const { turn } = store.beginTurn(cid, request(store, cid));
    const input = { conversationId: cid, turnId: turn.id, toolCallId: 'call', requestHash: 'hash', name: 'image', args: {} };
    const { record } = store.recordTool(input);
    store.appendDelta(turn.id, { text: 'persisted' }, 1);
    store.close();
    const reopened = createStore({ directory });
    t.after(() => reopened.close());
    assert.equal(reopened.getTurn(turn.id).status, 'interrupted');
    assert.equal(reopened.getTool(record.id).status, 'unknown');
    assert.equal(reopened.recordTool(input).replayed, true);
    const dest = mkdtempSync(join(tmpdir(), 'conversation-restore-')); const restored = createStore({ directory: dest });
    t.after(() => { restored.close(); rmSync(dest, { recursive: true, force: true }); });
    restored.restoreData(reopened.exportData());
    assert.deepEqual(restored.getConversation(cid).messages, reopened.getConversation(cid).messages);
    assert.deepEqual(restored.events(cid), reopened.events(cid));
    assert.throws(() => restored.restoreData(reopened.exportData()), code('restore-not-empty'));
    reopened.close();
});

test('a lock left by a killed writer that reused this PID is taken over, while this process still cannot open a store twice', t => {
    const directory = mkdtempSync(join(tmpdir(), 'conversation-store-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const lock = join(directory, '.writer.lock');
    // Docker restarts give node the same PID; the old { pid } format and another instance are both leftovers.
    for (const leftover of [{ pid: process.pid }, { pid: process.pid, instance: 'previous-container-run' }]) {
        writeFileSync(lock, JSON.stringify(leftover));
        const store = createStore({ directory });
        const owner = JSON.parse(readFileSync(lock, 'utf8'));
        assert.equal(owner.pid, process.pid);
        assert.equal(typeof owner.instance, 'string');
        assert.notEqual(owner.instance, 'previous-container-run');
        assert.throws(() => createStore({ directory }), code('store-locked'));
        store.close();
        assert.throws(() => readFileSync(lock), { code: 'ENOENT' });
    }
});

test('group members commit exactly once and finalization never adds parent bubble', t => {
    const { store, cid } = fixture(t); const { turn } = store.beginTurn(cid, request(store, cid, { type: 'group' }));
    const member = { memberRunId: 'm1', characterId: 'alice', content: 'hello', usage: { input: 1 } };
    store.commitMember(turn.id, member, 1); store.commitMember(turn.id, member, 1);
    assert.equal(store.getTurn(turn.id).members.length, 1);
    store.finishTurn(turn.id, { status: 'completed', content: 'hello' }, 1);
    assert.equal(store.getConversation(cid).messages.length, 2);
    assert.throws(() => store.commitMember(turn.id, { ...member, memberRunId: 'late' }, 1), code('late-callback'));
});

test('jobs dedupe by dependencies and have bounded recomputation; traces redact secrets', t => {
    const { store, cid } = fixture(t); const input = { conversationId: cid, kind: 'memory', dependencies: [], payload: {} };
    const job = store.createJob(input); assert.equal(store.createJob(input).id, job.id);
    store.updateJob(job.id, { attempts: 2, status: 'failed' });
    assert.throws(() => store.updateJob(job.id, { attempts: 3 }), code('retry-limit'));
    const trace = store.saveTrace({ conversationId: cid, nested: { apiKey: 'hidden', content: 'ok' } });
    assert.equal(store.getTrace(trace.id).nested.apiKey, undefined);
});

test('deleted resources do not prevent reading accepted snapshots; new requests reject before writes', t => {
    const { store, cid } = fixture(t);
    const r = store.createResource({ kind: 'connection', data: { apiKey: 'secret', model: 'x' } });
    assert.equal(store.getConnection(r.id).data.apiKey, 'secret');
    store.command(cid, { type: 'conversation.configure', settings: { connectionId: r.id }, expectedContentRevision: 0 });
    const req = request(store, cid); const accepted = store.beginTurn(cid, req);
    store.deleteResource(r.id, 1);
    store.finishTurn(accepted.turn.id, { status: 'completed', content: 'saved' }, 1);
    assert.equal(store.getConversation(cid).messages.at(-1).content, 'saved');
    const before = store.exportData();
    assert.throws(() => store.beginTurn(cid, request(store, cid)), code('not-found'));
    assert.deepEqual(store.exportData(), before);
});

test('unknown tools block successful finalization and failed turn retains uncertainty', t => {
    const { store, cid } = fixture(t); const { turn } = store.beginTurn(cid, request(store, cid));
    const { record } = store.recordTool({ conversationId: cid, turnId: turn.id, toolCallId: '1', requestHash: 'h', name: 'image', args: {} });
    store.finishTool(record.id, { status: 'unknown' });
    assert.throws(() => store.finishTurn(turn.id, { status: 'completed', content: 'result' }, 1), code('tool-result-unknown'));
    assert.equal(store.getTurn(turn.id).status, 'queued');
    store.finishTurn(turn.id, { status: 'failed', error: { code: 'unknown' } }, 1);
    assert.equal(store.getTool(record.id).status, 'unknown');
});

test('active derived updates require matching epoch; background updates and manual changes reject', t => {
    const { store, cid } = fixture(t); complete(store, cid);
    const { turn } = store.beginTurn(cid, request(store, cid));
    assert.throws(() => store.commitDerived(cid, { summaries: [] }), code('conversation-busy'));
    assert.throws(() => store.commitDerived(cid, { turnId: turn.id, attemptEpoch: 2, summaries: [] }), code('late-callback'));
    store.commitDerived(cid, { turnId: turn.id, attemptEpoch: 1, summaries: [{ content: 'compact', sourceRefs: [sourceRef(store.getConversation(cid).messages[0])] }] });
    assert.throws(() => store.command(cid, { type: 'conversation.configure', settings: {}, expectedContentRevision: 3 }), code('conversation-busy'));
});

test('restore rejects broken references without leaving partial content', t => {
    const { store, cid } = fixture(t); complete(store, cid);
    const directory = mkdtempSync(join(tmpdir(), 'conversation-invalid-backup-')); const target = createStore({ directory });
    t.after(() => { target.close(); rmSync(directory, { recursive: true, force: true }); });
    const backup = store.exportData(); backup.snapshots = {};
    assert.throws(() => target.restoreData(backup), code('invalid-backup'));
    assert.equal(target.listConversations().length, 0);
});

test('phase events, frozen internal credentials and candidate listing extensions', t => {
    const { store, cid } = fixture(t); const r = store.createResource({ kind: 'connection', data: { apiKey: 'old' } });
    store.updateResource(r.id, { expectedRevision: 1, data: { apiKey: 'new' } });
    assert.equal(store.getConnection(r.id, 1).data.apiKey, 'old');
    assert.equal(store.getConnection(r.id).data.apiKey, 'new');
    const { turn } = store.beginTurn(cid, request(store, cid));
    store.advanceTurn(turn.id, 'preparing', 1); store.advanceTurn(turn.id, 'generating', 1);
    store.advanceTurn(turn.id, 'tool_running', 1); store.advanceTurn(turn.id, 'generating', 1);
    store.advanceTurn(turn.id, 'finalizing', 1);
    assert.throws(() => store.advanceTurn(turn.id, 'generating', 1), code('invalid-status'));
    store.finishTurn(turn.id, { status: 'completed', content: 'text' }, 1);
    assert.equal(store.events(cid).filter(e => e.type === 'turn.phase').length, 5);
    const message = store.getConversation(cid).messages.at(-1);
    const candidates = store.getCandidates(cid, message.id);
    assert.equal(candidates.length, 1); assert.equal(candidates[0].selected, true);
});

test('successful effects update variables and worldbook timing atomically and once', t => {
    const { store, cid } = fixture(t); const { turn } = store.beginTurn(cid, request(store, cid));
    const result = { status: 'completed', content: 'ok', effects: [
        { type: 'variable.set', name: 'score', previous: null, value: 1 },
        { type: 'worldbook.activate', key: 'book:entry', previous: null, value: { activeUntil: 2 } },
    ] };
    store.finishTurn(turn.id, result, 1);
    assert.equal(store.getConversation(cid).settings.variables.score, 1);
    assert.equal(store.getConversation(cid).settings.worldInfo.state['book:entry'].activeUntil, 2);
    assert.throws(() => store.finishTurn(turn.id, result, 1), code('late-callback'));
    const next = store.beginTurn(cid, request(store, cid)); const before = store.exportData();
    assert.throws(() => store.finishTurn(next.turn.id, result, 1), code('revision-conflict'));
    assert.deepEqual(store.exportData(), before);
});

test('trace saves retain supplied ID and reject ownership changes', t => {
    const { store, cid } = fixture(t); const { turn } = store.beginTurn(cid, request(store, cid));
    const trace = { id: 'trace-stable', conversationId: cid, turnId: turn.id, calls: [] };
    store.saveTrace(trace); store.saveTrace({ ...trace, calls: [{ status: 'completed' }] });
    assert.equal(store.listTraces(cid).length, 1);
    assert.equal(store.getTrace(trace.id).calls.length, 1);
    assert.throws(() => store.saveTrace({ ...trace, turnId: undefined }), code('trace-conflict'));
    const other = store.createConversation({});
    assert.throws(() => store.saveTrace({ ...trace, conversationId: other.id }), code('invalid-trace'));
});

test('retry uses a new request ID but reuses the original user message', t => {
    const { store, cid } = fixture(t);
    const initialRequest = request(store, cid); const first = store.beginTurn(cid, initialRequest);
    store.finishTurn(first.turn.id, { status: 'failed' }, 1);
    const retry = request(store, cid, { retryTurnId: first.turn.id });
    const next = store.beginTurn(cid, retry);
    assert.equal(next.turn.userMessageId, first.turn.userMessageId);
    assert.equal(store.getConversation(cid).messages.filter(m => m.role === 'user').length, 1);
    assert.equal(store.beginTurn(cid, retry).replayed, true);
    store.finishTurn(next.turn.id, { status: 'failed' }, 1);
    assert.throws(() => store.beginTurn(cid, request(store, cid, { retryTurnId: first.turn.id, content: 'different' })), code('invalid-retry'));
    const again = store.beginTurn(cid, request(store, cid, { retryTurnId: next.turn.id }));
    assert.equal(again.turn.userMessageId, first.turn.userMessageId);
    assert.equal(store.getConversation(cid).messages.filter(m => m.role === 'user').length, 1);
});

test('group resources expand members and each member stream has isolated IDs and text', t => {
    const { store, cid } = fixture(t);
    const alice = store.createResource({ kind: 'character', name: 'Alice', data: {} });
    const bob = store.createResource({ kind: 'character', name: 'Bob', data: {} });
    const group = store.createResource({ kind: 'group', name: 'Group', data: { members: [alice.id, { characterId: bob.id }] } });
    store.command(cid, { type: 'conversation.configure', expectedContentRevision: 0, settings: { groupId: group.id } });
    const { turn, snapshot } = store.beginTurn(cid, request(store, cid, { type: 'group' }));
    assert(snapshot.resources.some(r => r.id === alice.id)); assert(snapshot.resources.some(r => r.id === bob.id));
    const a = store.startMember(turn.id, { memberRunId: 'a', characterId: alice.id }, 1);
    store.appendDelta(turn.id, { text: 'Alice', reasoning: 'Alice reason' }, 1);
    assert.equal(store.startMember(turn.id, { memberRunId: 'a', characterId: alice.id }, 1).messageId, a.messageId);
    store.commitMember(turn.id, { memberRunId: 'a', characterId: alice.id, content: 'Alice' }, 1);
    assert.equal(store.getConversation(cid).messages.at(-1).id, a.messageId);
    const b = store.startMember(turn.id, { memberRunId: 'b', characterId: bob.id }, 1);
    assert.notEqual(a.messageId, b.messageId);
    assert.equal(store.getTurn(turn.id).content, ''); assert.equal(store.getTurn(turn.id).reasoning, '');
    store.appendDelta(turn.id, { text: 'Bob partial' }, 1);
    store.requestStop(turn.id); store.finishTurn(turn.id, { status: 'stopped' }, 1);
    assert.equal(store.getConversation(cid).messages.at(-1).id, b.messageId);
    assert.equal(store.getConversation(cid).messages.at(-1).content, 'Bob partial');
    assert.equal(store.getConversation(cid).messages.at(-1).status, 'partial');
});

test('attachments use safe opaque paths, immutable records and retained-history reference protection', t => {
    const { store, cid } = fixture(t);
    const record = { id: 'attachment-1', name: '../../display-only.png', mime: 'image/png', size: 12, sha256: 'a'.repeat(64), path: 'opaque-file.png', createdAt: new Date().toISOString() };
    assert.throws(() => store.saveAttachment({ ...record, path: '../escape' }), code('invalid-attachment'));
    store.saveAttachment(record); store.saveAttachment(record);
    assert.deepEqual(store.getAttachment(record.id), record);
    assert.throws(() => store.saveAttachment({ ...record, size: 20 }), code('attachment-conflict'));
    const { turn } = store.beginTurn(cid, request(store, cid, { media: [{ attachmentId: record.id, type: 'image' }] }));
    store.finishTurn(turn.id, { status: 'failed' }, 1);
    assert.throws(() => store.deleteAttachment(record.id), code('attachment-in-use'));
    const msg = store.getConversation(cid).messages[0];
    store.command(cid, { type: 'message.delete', messageId: msg.id, expectedContentRevision: 1 });
    assert.throws(() => store.deleteAttachment(record.id), code('attachment-in-use'));
    const orphan = { ...record, id: 'orphan', path: 'orphan-file' }; store.saveAttachment(orphan);
    store.deleteAttachment(orphan.id); assert.equal(store.listAttachments().length, 1);
});

test('configured and transitive auxiliary connections freeze versions without exposing credentials', t => {
    const { store, cid } = fixture(t);
    const connection = (name, auxiliary) => store.createResource({ kind: 'connection', name, data: { apiKey: `${name}-v1`, headers: { Authorization: name }, auxiliary } });
    const embedding = connection('embedding'); const image = connection('image'); const summary = connection('summary');
    const auxiliary = connection('auxiliary', { embedding: { connectionId: embedding.id }, imageConnectionId: image.id, summary: summary.id, model: 'not-a-resource' });
    const main = connection('main', { memory: { connectionId: auxiliary.id }, connectionIds: [embedding.id] });
    // Cyclic references must terminate and each resource appears once.
    store.updateResource(summary.id, { expectedRevision: 1, data: { apiKey: 'summary-v2', auxiliary: { connectionId: main.id } } });
    store.command(cid, { type: 'conversation.configure', expectedContentRevision: 0, settings: {
        connectionId: main.id, auxiliaryConnectionId: auxiliary.id, embeddingConnectionId: embedding.id, imageConnectionId: image.id,
    } });
    const req = request(store, cid); const accepted = store.beginTurn(cid, req);
    assert.equal(accepted.snapshot.resources.length, 5);
    const frozen = accepted.snapshot.resources.find(r => r.id === embedding.id);
    assert.equal(frozen.revision, 1); assert.equal(frozen.data.apiKey, undefined); assert.equal(frozen.data.headers, undefined);
    assert.equal(accepted.snapshot.conversation.resourceRefs.find(r => r.id === summary.id).revision, 2);
    store.updateResource(embedding.id, { expectedRevision: 1, data: { apiKey: 'embedding-v2' } });
    assert.equal(store.getConnection(embedding.id, frozen.revision).data.apiKey, 'embedding-v1');
    assert.equal(store.getConnection(embedding.id).data.apiKey, 'embedding-v2');
    assert.equal(store.getResource(embedding.id).data.apiKey, undefined);
    assert.equal(store.listResources('connection').find(r => r.id === embedding.id).data.apiKey, undefined);
    assert.deepEqual(store.beginTurn(cid, req).snapshot, accepted.snapshot);
    store.finishTurn(accepted.turn.id, { status: 'completed', content: 'done' }, 1);
    const next = store.beginTurn(cid, request(store, cid));
    assert.equal(next.snapshot.resources.find(r => r.id === embedding.id).revision, 2);
});

test('invalid auxiliary connection references reject acceptance without writes', t => {
    const { store, cid } = fixture(t);
    const character = store.createResource({ kind: 'character', name: 'not-connection', data: {} });
    const before = store.exportData();
    assert.throws(() => store.command(cid, { type: 'conversation.configure', expectedContentRevision: 0, settings: { imageConnectionId: character.id } }), code('invalid-resource'));
    assert.deepEqual(store.exportData(), before);
    const connection = store.createResource({ kind: 'connection', name: 'bad-aux', data: { auxiliary: { embedding: { connectionId: 'missing' } } } });
    assert.throws(() => store.command(cid, { type: 'conversation.configure', expectedContentRevision: 0, settings: { connectionId: connection.id } }), code('not-found'));
    assert.equal(store.getConversation(cid).conversation.contentRevision, 0);
});

test('manual memory.create uses memory CAS only, is immediately visible and remains protected', t => {
    const { store, cid } = fixture(t);
    const snapshot = store.command(cid, { type: 'memory.create', kind: 'world-state', content: 'Fixed setting', expectedMemoryRevision: 0, locked: true });
    const memory = snapshot.memories[0];
    assert.equal(memory.origin, 'manual'); assert.equal(memory.revision, 1); assert.equal(memory.locked, true);
    assert.equal(memory.status, 'valid'); assert.deepEqual(memory.sourceRefs, []);
    assert.equal(snapshot.conversation.memoryRevision, 1); assert.equal(snapshot.conversation.contentRevision, 0);
    assert.equal(store.getConversation(cid).memories[0].id, memory.id);
    const before = store.exportData();
    assert.throws(() => store.command(cid, { type: 'memory.create', kind: 'user-fact', content: 'stale', expectedMemoryRevision: 0 }), code('revision-conflict'));
    assert.deepEqual(store.exportData(), before);
    assert.throws(() => store.commitDerived(cid, { memories: [{ id: memory.id, expectedBlockRevision: 1, content: 'automatic' }] }), code('memory-protected'));
    const unlocked = store.command(cid, { type: 'memory.create', kind: 'user-fact', content: 'Manual but unlocked', expectedMemoryRevision: 1 });
    assert.equal(unlocked.memories[1].locked, false);
    store.beginTurn(cid, request(store, cid));
    assert.throws(() => store.command(cid, { type: 'memory.create', kind: 'user-fact', content: 'busy', expectedMemoryRevision: 2 }), code('conversation-busy'));
});

test('memory.create validates inputs and snapshot attachment index contains only current references', t => {
    const { store, cid } = fixture(t);
    for (const patch of [{ kind: 'unknown' }, { content: ' ' }, { locked: 'true' }]) {
        assert.throws(() => store.command(cid, { type: 'memory.create', kind: 'user-fact', content: 'valid', expectedMemoryRevision: 0, ...patch }), code('invalid-memory'));
    }
    assert.equal(store.getConversation(cid).conversation.memoryRevision, 0);
    const attachment = { id: 'visible', name: 'picture', mime: 'image/png', size: 1, sha256: 'a'.repeat(64), path: 'opaque-picture', createdAt: 1 };
    store.saveAttachment(attachment); store.saveAttachment({ ...attachment, id: 'unreferenced', path: 'unreferenced-picture' });
    const { turn } = store.beginTurn(cid, request(store, cid, { media: [{ attachmentId: attachment.id, type: 'image' }] }));
    const snapshot = store.getConversation(cid);
    assert.deepEqual(Object.keys(snapshot.attachments), ['visible']);
    assert.equal(snapshot.attachments.visible.name, 'picture'); assert.equal(snapshot.attachments.visible.path, undefined);
    store.finishTurn(turn.id, { status: 'failed' }, 1);
    store.command(cid, { type: 'message.delete', messageId: turn.userMessageId, expectedContentRevision: 1 });
    assert.deepEqual(store.getConversation(cid).attachments, {});
});

for (const status of ['failed', 'stopped', 'interrupted']) test(`group ${status} preserves previous members and persisted current delta even with empty callback content`, t => {
    const { store, cid } = fixture(t); const { turn } = store.beginTurn(cid, request(store, cid, { type: 'group' }));
    const first = store.startMember(turn.id, { memberRunId: 'first', characterId: 'alice' }, 1);
    store.appendDelta(turn.id, { text: 'complete first' }, 1);
    store.commitMember(turn.id, { memberRunId: 'first', characterId: 'alice', content: 'complete first' }, 1);
    const second = store.startMember(turn.id, { memberRunId: 'second', characterId: 'bob' }, 1);
    store.appendDelta(turn.id, { text: 'partial second', reasoning: 'partial reasoning' }, 1);
    if (status === 'stopped') store.requestStop(turn.id);
    store.finishTurn(turn.id, { status, content: '' }, 1);
    const replies = store.getConversation(cid).messages.filter(m => m.role === 'assistant');
    assert.deepEqual(replies.map(m => [m.id, m.content, m.status]), [[first.messageId, 'complete first', 'completed'], [second.messageId, 'partial second', 'partial']]);
    assert.equal(replies[1].reasoning, 'partial reasoning');
    assert.equal(store.getTurn(turn.id).members.length, 1);
    assert.throws(() => store.commitMember(turn.id, { memberRunId: 'second', characterId: 'bob', content: 'late' }, 1), code('late-callback'));
});

test('group member effects become visible immediately, replay once and never reapply at finish', t => {
    const { store, cid } = fixture(t); const { turn } = store.beginTurn(cid, request(store, cid, { type: 'group' }));
    const effects = [{ type: 'variable.set', name: 'score', previous: null, value: 1 }, { type: 'worldbook.activate', key: 'book:entry', previous: null, value: { activeUntil: 2 } }];
    store.startMember(turn.id, { memberRunId: 'a', characterId: 'alice' }, 1);
    const first = { memberRunId: 'a', characterId: 'alice', content: 'one', effects };
    store.commitMember(turn.id, first, 1); store.commitMember(turn.id, first, 1);
    assert.equal(store.getConversation(cid).settings.variables?.score, undefined);
    assert.equal(store.getTurnSnapshot(turn.id).settings.variables.score, 1);
    assert.equal(store.getTurnSnapshot(turn.id).settings.worldInfo.state['book:entry'].activeUntil, 2);
    store.startMember(turn.id, { memberRunId: 'b', characterId: 'bob' }, 1);
    store.commitMember(turn.id, { memberRunId: 'b', characterId: 'bob', content: 'two', effects: [{ type: 'variable.set', name: 'score', previous: 1, value: 2 }] }, 1);
    store.finishTurn(turn.id, { status: 'completed', effects }, 1);
    assert.equal(store.getConversation(cid).settings.variables.score, 2);
    assert.equal(store.getConversation(cid).messages.filter(m => m.role === 'assistant').length, 2);
});

test('member effect conflict rolls back settings, message, member state and events together', t => {
    const { store, cid } = fixture(t); const { turn } = store.beginTurn(cid, request(store, cid, { type: 'group' }));
    store.startMember(turn.id, { memberRunId: 'a', characterId: 'alice' }, 1);
    store.appendDelta(turn.id, { text: 'pending' }, 1);
    const before = store.exportData();
    assert.throws(() => store.commitMember(turn.id, { memberRunId: 'a', characterId: 'alice', content: 'reply', effects: [
        { type: 'variable.set', name: 'first', previous: null, value: 1 },
        { type: 'variable.set', name: 'second', previous: 99, value: 2 },
    ] }, 1), code('revision-conflict'));
    assert.deepEqual(store.exportData(), before);
});

test('media requires matching registered type and forbids paths, URLs, bytes and nested alternate sources', t => {
    const { store, cid } = fixture(t);
    store.saveAttachment({ id: 'image', name: 'picture.png', mime: 'image/png', size: 10, sha256: 'a'.repeat(64), path: 'opaque-file', createdAt: 1 });
    const valid = { attachmentId: 'image', type: 'image', mimeType: 'image/png', name: 'picture.png', size: 10 };
    const invalid = [
        { type: 'image', url: 'https://example.com/image.png' },
        { ...valid, attachmentId: 'missing' }, { ...valid, type: 'audio' }, { ...valid, mimeType: 'image/jpeg' },
        { ...valid, size: 11 }, { ...valid, path: '/etc/passwd' }, { ...valid, filePath: '../outside' },
        { ...valid, url: 'file:///etc/passwd' }, { ...valid, data: 'AAAA' }, { ...valid, image_url: { url: 'https://example.com' } },
    ];
    const before = store.exportData();
    for (const part of invalid) {
        assert.throws(() => store.beginTurn(cid, request(store, cid, { media: [part] })), code('invalid-media'));
        assert.deepEqual(store.exportData(), before);
    }
    const { turn } = store.beginTurn(cid, request(store, cid, { media: [valid] }));
    store.finishTurn(turn.id, { status: 'failed' }, 1);
    assert.throws(() => store.command(cid, { type: 'message.edit', messageId: turn.userMessageId, media: [{ ...valid, path: '/tmp/injected' }], expectedContentRevision: 1 }), code('invalid-media'));
    assert.deepEqual(store.getConversation(cid).messages[0].media, [valid]);
});

test('idle snapshots resolve current resources while active snapshots retain accepted revisions', t => {
    const { store, cid } = fixture(t);
    const character = store.createResource({ kind: 'character', name: 'v1', data: { description: 'old' } });
    store.command(cid, { type: 'conversation.configure', settings: { characterId: character.id }, expectedContentRevision: 0 });
    store.updateResource(character.id, { expectedRevision: 1, name: 'v2', data: { description: 'new' } });
    const idle = store.getConversation(cid);
    assert.equal(idle.resources[0].revision, 2); assert.equal(idle.conversation.resourceRefs[0].revision, 2);
    const req = request(store, cid); const { turn } = store.beginTurn(cid, req);
    store.updateResource(character.id, { expectedRevision: 2, name: 'v3', data: { description: 'latest' } });
    assert.equal(store.getConversation(cid).resources[0].revision, 2);
    store.deleteResource(character.id, 3);
    assert.equal(store.getConversation(cid).resources[0].revision, 2);
    assert.equal(store.beginTurn(cid, req).snapshot.resources[0].revision, 2);
    store.finishTurn(turn.id, { status: 'completed', content: 'done' }, 1);
    const deleted = store.getConversation(cid);
    assert.equal(deleted.resources[0].missing, true); assert(deleted.resources[0].deletedAt);
    assert.equal(deleted.resources[0].name, 'v3'); assert.deepEqual(deleted.resources[0].data, {});
    assert.throws(() => store.beginTurn(cid, request(store, cid)), code('not-found'));
});

test('cancelled settings references and their auxiliary/member expansions do not accumulate', t => {
    const { store, cid } = fixture(t);
    const aux = store.createResource({ kind: 'connection', name: 'aux', data: {} });
    const old = store.createResource({ kind: 'connection', name: 'old', data: { auxiliary: { imageConnectionId: aux.id } } });
    const next = store.createResource({ kind: 'connection', name: 'next', data: {} });
    store.command(cid, { type: 'conversation.configure', settings: { connectionId: old.id }, expectedContentRevision: 0 });
    store.deleteResource(old.id, 1); store.deleteResource(aux.id, 1);
    const configured = store.command(cid, { type: 'conversation.configure', settings: { connectionId: next.id }, expectedContentRevision: 1 });
    assert.deepEqual(configured.resources.map(r => r.id), [next.id]);
    assert.deepEqual(configured.conversation.explicitResourceRefs, []);
    const cleared = store.command(cid, { type: 'conversation.configure', settings: { connectionId: null }, expectedContentRevision: 2 });
    assert.deepEqual(cleared.resources, []);
    assert.deepEqual(cleared.conversation.resourceRefs, []);
});

test('explicit refs survive settings deselection until explicitly removed', t => {
    const { store } = fixture(t);
    const shared = store.createResource({ kind: 'character', name: 'explicit', data: {} });
    const c = store.createConversation({ resourceRefs: [{ id: shared.id, revision: 1 }], settings: { characterId: shared.id } });
    const cleared = store.command(c.id, { type: 'conversation.configure', settings: { characterId: null }, expectedContentRevision: 0 });
    assert.deepEqual(cleared.resources.map(r => r.id), [shared.id]);
    store.deleteResource(shared.id, 1);
    assert.equal(store.getConversation(c.id).resources[0].missing, true);
    const removed = store.command(c.id, { type: 'conversation.configure', resourceRefs: [], expectedContentRevision: 1 });
    assert.deepEqual(removed.resources, []);
});

test('empty terminal memory proposals do not invalidate unrelated background memory revision', t => {
    const { store, cid } = fixture(t); const initial = complete(store, cid); const version = initial.conversation.memoryRevision;
    const { turn } = store.beginTurn(cid, request(store, cid));
    store.finishTurn(turn.id, { status: 'completed', content: 'new answer', memoryProposals: [] }, 1);
    assert.equal(store.getConversation(cid).conversation.memoryRevision, version);
    store.commitDerived(cid, { expectedMemoryRevision: version, summaries: [{ content: 'older history', sourceRefs: [sourceRef(initial.messages[0])] }] });
    assert.equal(store.getConversation(cid).conversation.memoryRevision, version + 1);
});

test('derived proposal-level resource dependencies are validated and retained on blocks', t => {
    const { store, cid } = fixture(t); const r = store.createResource({ kind: 'character', name: 'person', data: {} });
    store.commitDerived(cid, { resourceRefs: [{ id: r.id, revision: 1 }], memories: [{ content: 'resource-bound memory', sourceRefs: [] }] });
    assert.deepEqual(store.getConversation(cid).memories[0].resourceRefs, [{ id: r.id, revision: 1 }]);
    store.updateResource(r.id, { expectedRevision: 1, data: { changed: true } });
    assert.equal(store.getConversation(cid).memories[0].status, 'stale');
    const before = store.exportData();
    assert.throws(() => store.commitDerived(cid, { resourceRefs: [{ id: r.id, revision: 1 }], summaries: [{ content: 'stale resource' }] }), code('source-conflict'));
    assert.deepEqual(store.exportData(), before);
});

test('resource changes stale pending jobs without reviving completed jobs', t => {
    const { store, cid } = fixture(t); const r = store.createResource({ kind: 'character', name: 'person', data: {} });
    const input = { conversationId: cid, dependencies: { sourceRefs: [], resourceRefs: [{ id: r.id, revision: 1 }] }, payload: {} };
    const pending = store.createJob({ ...input, kind: 'pending-memory' });
    const done = store.createJob({ ...input, kind: 'done-memory' });
    store.updateJob(done.id, { status: 'completed' });
    store.updateResource(r.id, { expectedRevision: 1, data: { changed: true } });
    assert.equal(store.listJobs(cid).find(j => j.id === pending.id).status, 'stale');
    assert.equal(store.listJobs(cid).find(j => j.id === done.id).status, 'completed');
    assert(store.events(cid).some(e => e.type === 'job.updated' && e.payload.id === pending.id && e.payload.status === 'stale'));
});

for (const status of ['completed', 'failed', 'stopped']) test(`foreground compaction uses frozen resource versions until ${status}, then invalidates transitively`, t => {
    const { store, cid } = fixture(t);
    const character = store.createResource({ kind: 'character', name: 'old', data: {} });
    store.command(cid, { type: 'conversation.configure', settings: { characterId: character.id }, expectedContentRevision: 0 });
    const ref = { id: character.id, revision: 1 };
    store.commitDerived(cid, { summaries: [{ id: 'previous', content: 'previous', sourceRefs: [], resourceRefs: [ref] }] });
    const { turn } = store.beginTurn(cid, request(store, cid));
    store.updateResource(character.id, { expectedRevision: 1, data: { newer: true } });
    assert.equal(store.getConversation(cid).summaries[0].status, 'valid');
    store.commitDerived(cid, { turnId: turn.id, attemptEpoch: 1, resourceRefs: [ref], summaries: [{ id: 'front', content: 'frozen summary', parentSummaryRefs: [{ id: 'previous', revision: 1 }] }], folds: [{ id: 'fold', summaryRef: { id: 'front', revision: 1 } }] });
    const during = store.getConversation(cid);
    assert(during.summaries.every(b => b.status === 'valid')); assert.equal(during.folds[0].status, 'valid');
    if (status === 'stopped') store.requestStop(turn.id);
    store.finishTurn(turn.id, { status }, 1);
    const after = store.getConversation(cid);
    assert(after.summaries.every(b => b.status === 'stale')); assert.equal(after.folds[0].status, 'stale');
    assert.throws(() => store.commitDerived(cid, { turnId: turn.id, attemptEpoch: 1, summaries: [{ content: 'late' }] }), code('late-callback'));
});

test('frozen resource scope rejects background work, wrong epoch and resources outside acceptance', t => {
    const { store, cid } = fixture(t);
    const selected = store.createResource({ kind: 'character', name: 'selected', data: {} });
    const other = store.createResource({ kind: 'character', name: 'unselected', data: {} });
    store.command(cid, { type: 'conversation.configure', settings: { characterId: selected.id }, expectedContentRevision: 0 });
    const { turn } = store.beginTurn(cid, request(store, cid));
    store.deleteResource(selected.id, 1);
    const proposal = { resourceRefs: [{ id: selected.id, revision: 1 }], summaries: [{ content: 'old but frozen' }] };
    assert.throws(() => store.commitDerived(cid, proposal), code('conversation-busy'));
    assert.throws(() => store.commitDerived(cid, { ...proposal, turnId: turn.id, attemptEpoch: 2 }), code('late-callback'));
    assert.throws(() => store.commitDerived(cid, { turnId: turn.id, attemptEpoch: 1, summaries: [{ content: 'outside', resourceRefs: [{ id: other.id, revision: 1 }] }] }), code('source-conflict'));
    store.commitDerived(cid, { ...proposal, turnId: turn.id, attemptEpoch: 1 });
    assert.equal(store.getConversation(cid).summaries[0].status, 'valid');
    store.finishTurn(turn.id, { status: 'failed' }, 1);
    assert.throws(() => store.commitDerived(cid, { ...proposal, summaries: [{ content: 'forged', scopeTurnId: turn.id, scopeAttemptEpoch: 1 }] }), code('source-conflict'));
});

test('group retry chains retain original member IDs/order and exclude all previously completed roles', t => {
    const { store, cid } = fixture(t);
    const chars = ['A', 'B', 'C'].map(name => store.createResource({ kind: 'character', name, data: {} }));
    const group = store.createResource({ kind: 'group', name: 'group', data: { members: chars.map(c => c.id) } });
    store.command(cid, { type: 'conversation.configure', settings: { groupId: group.id }, expectedContentRevision: 0 });
    const plan = chars.map((c, i) => ({ id: `original-${i}`, characterId: c.id }));
    const initial = store.beginTurn(cid, request(store, cid, { type: 'group' }), () => ({ members: plan }));
    assert.deepEqual(initial.turn.plannedMembers, plan);
    const commit = (tid, m) => { store.startMember(tid, { memberRunId: m.id, characterId: m.characterId }, 1); store.commitMember(tid, { memberRunId: m.id, characterId: m.characterId, content: 'done' }, 1); };
    commit(initial.turn.id, plan[0]); store.finishTurn(initial.turn.id, { status: 'failed' }, 1);
    const retryReq = request(store, cid, { type: 'group', retryTurnId: initial.turn.id });
    const retry = store.beginTurn(cid, retryReq, () => ({ members: [...plan].reverse().map(m => ({ ...m, id: 'wrong-new-id' })) }));
    assert.deepEqual(retry.turn.plannedMembers, plan.slice(1));
    assert.deepEqual(store.beginTurn(cid, retryReq, () => { throw Error('no replay preflight'); }).turn.plannedMembers, plan.slice(1));
    assert.throws(() => store.startMember(retry.turn.id, { memberRunId: plan[0].id, characterId: plan[0].characterId }, 1), code('invalid-member'));
    commit(retry.turn.id, plan[1]); store.finishTurn(retry.turn.id, { status: 'stopped' }, 1);
    const last = store.beginTurn(cid, request(store, cid, { type: 'group', retryTurnId: retry.turn.id }), () => ({ members: plan }));
    assert.deepEqual(last.turn.plannedMembers, plan.slice(2));
    commit(last.turn.id, plan[2]); store.finishTurn(last.turn.id, { status: 'completed' }, 1);
    assert.equal(store.getConversation(cid).messages.filter(m => m.role === 'user').length, 1);
    assert.equal(store.getConversation(cid).messages.filter(m => m.role === 'assistant').length, 3);
});
