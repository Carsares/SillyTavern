import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { temporaryDirectory } from '../../harness/index.mjs';
import { createMaintenance } from '../../../../src/conversation/maintenance/index.js';
import { createStore } from '../../../../src/conversation/store/index.js';
import { createAttachmentService } from '../../../../src/conversation/resources/attachments.js';
import { summarizeUsage } from '../../../../src/conversation/traces/usage.js';

test('cleanup releases registered unused files, preserves history references and retains usage after pruning trace details', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'conversation-maintenance-')), store = createStore({ directory }); t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
    const c = store.createConversation({});
    const attachments = createAttachmentService({ directory, store });
    const unused = await attachments.save({ name: 'unused.txt', mime: 'text/plain', base64: Buffer.from('unused').toString('base64') });
    const used = await attachments.save({ name: 'used.txt', mime: 'text/plain', base64: Buffer.from('used').toString('base64') });
    const { turn } = store.beginTurn(c.id, { schemaVersion: 1, type: 'send', content: 'original', clientRequestId: 'one', expectedContentRevision: 0, media: [{ type: 'document', attachmentId: used.id }] });
    store.finishTurn(turn.id, { status: 'completed', content: 'answer' }, 1);
    const usage = { complete: true, inputTokens: 5, outputTokens: 2, totalTokens: 7, costUsd: 0.01 };
    store.saveTrace({ id: 'trace', conversationId: c.id, turnId: turn.id, createdAt: new Date().toISOString(), status: 'completed', requestPlan: { messages: ['private prompt'] }, events: [{ type: 'text.delta', text: 'detailed text' }], usage });
    const totals = summarizeUsage(store.listTraces(c.id));
    const service = createMaintenance({ directory, store, now: () => Date.now() + 40 * 86400000 });
    const preview = service.previewCleanup();
    const occupation = service.status();
    assert.equal(occupation.traceCount, 1); assert(occupation.detailBytes > 0);
    assert.equal(occupation.traceBytes, Buffer.byteLength(JSON.stringify(store.getTrace('trace'))));
    assert.deepEqual(preview.entries.map(e => e.attachmentId), [unused.id]); assert.equal(preview.traces.length, 1);
    const events = store.events(c.id);
    const result = service.cleanup({ token: preview.token });
    assert.equal(result.tracesPruned, 1); assert.equal(result.deleted, 1);
    assert.equal(existsSync(join(directory, 'attachments', unused.id)), false);
    assert.equal(existsSync(join(directory, 'attachments', used.id)), true);
    assert.equal(store.listAttachments().length, 1);
    assert.equal(store.getTrace('trace').events, undefined);
    assert.equal(service.status().traceCount, 1); assert.equal(service.status().detailBytes, 0);
    assert.deepEqual(summarizeUsage(store.listTraces(c.id)), totals);
    assert.deepEqual(store.events(c.id), events);
    assert.equal(service.previewCleanup().traces.length, 0);
    const message = store.getConversation(c.id).messages[0];
    store.command(c.id, { type: 'message.delete', messageId: message.id, expectedContentRevision: store.getConversation(c.id).conversation.contentRevision });
    assert.equal(service.previewCleanup().entries.length, 0);
    const exported = service.export();
    assert.equal(exported.format, 'conversation-v1-export'); assert.equal(exported.conversations[0].messages.length, 1);
    const backup = service.backup();
    assert.equal(backup.format, 'conversation-v1-backup'); assert.equal(Object.keys(backup.repository.messages).length, 2);
    assert.equal(backup.files.length, 1);
});

test('effective export includes attachments referenced by typed content and attachmentRefs exactly once', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'conversation-export-')), store = createStore({ directory }); t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
    const c = store.createConversation({});
    const record = await createAttachmentService({ directory, store }).save({ name: 'typed.txt', mime: 'text/plain', base64: 'eA==' });
    const effectiveStore = { ...store, getConversation: () => ({ messages: [{ id: 'current', content: [{ type: 'document', attachmentId: record.id }], attachmentRefs: [record.id, { id: record.id }], media: [] }, { id: 'hidden', userHidden: true, content: [{ attachmentId: 'not-exported' }] }], summaries: [], memories: [] }) };
    const exported = createMaintenance({ directory, store: effectiveStore }).export();
    assert.equal(exported.conversations[0].id, c.id); assert.equal(exported.conversations[0].messages.length, 1);
    assert.equal(exported.attachments.length, 1); assert.equal(exported.attachments[0].id, record.id); assert.equal(exported.attachments[0].base64, 'eA==');
});

test('cleanup rejects a stale preview when an unused attachment becomes referenced', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'conversation-maintenance-')), store = createStore({ directory }); t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
    const c = store.createConversation({});
    const record = await createAttachmentService({ directory, store }).save({ name: 'file.txt', mime: 'text/plain', base64: 'eA==' });
    const service = createMaintenance({ directory, store, now: () => Date.now() + 40 * 86400000 });
    const preview = service.previewCleanup();
    store.saveTrace({ conversationId: c.id, attachmentId: record.id, createdAt: new Date().toISOString() });
    assert.throws(() => service.cleanup({ token: preview.token }), error => error.code === 'cleanup-conflict');
    assert.equal(existsSync(join(directory, 'attachments', record.id)), true);
    assert.equal(store.getAttachment(record.id).id, record.id);
});

test('untimed request and usage records from before timestamps age from their parent, turn or conversation', t => {
    const directory = mkdtempSync(join(tmpdir(), 'conversation-maintenance-'));
    let clock = '2026-01-01T00:00:00.000Z';
    const store = createStore({ directory, now: () => clock }); t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
    const c = store.createConversation({});
    clock = '2026-03-01T00:00:00.000Z';
    const late = store.createConversation({});
    const { turn } = store.beginTurn(c.id, { schemaVersion: 1, type: 'send', content: 'hello', clientRequestId: 'one', expectedContentRevision: 0 });
    store.finishTurn(turn.id, { status: 'completed', content: 'answer' }, 1);
    const usage = { complete: true, inputTokens: 2, outputTokens: 0, totalTokens: 2 };
    const capture = { provider: 'openai-compatible', executor: 'pi', request: { method: 'POST', body: 'private input' } };
    const auxiliary = { provider: 'openai-compatible', executor: 'pi', usage, status: 'completed', attemptedRequests: 1, usageMissing: false };
    // A timed trace-service parent, then the untimed shapes request capture and auxiliary usage saved before timestamps.
    for (const record of [
        { id: 'generation', conversationId: c.id, turnId: turn.id, requestPlan: { messages: ['private prompt'] }, status: 'completed', usage, createdAt: '2026-02-01T00:00:00.000Z', finishedAt: '2026-02-01T00:00:05.000Z' },
        { id: 'generation-request', conversationId: c.id, turnId: turn.id, parentTraceId: 'generation', category: 'generation', kind: 'outbound-request', ...capture },
        { id: 'image', conversationId: c.id, turnId: turn.id, kind: 'image-usage', ...auxiliary },
        { id: 'image-request', conversationId: c.id, turnId: turn.id, parentTraceId: 'image', category: 'image', kind: 'outbound-request', ...capture },
        { id: 'embedding', conversationId: c.id, kind: 'embedding-usage', ...auxiliary },
        { id: 'embedding-request', conversationId: c.id, parentTraceId: 'embedding', category: 'embedding', kind: 'outbound-request', ...capture },
        { id: 'late-embedding', conversationId: late.id, kind: 'embedding-usage', ...auxiliary },
    ]) store.saveTrace(record);
    const selected = at => createMaintenance({ directory, store, now: () => Date.parse(at) }).previewCleanup().traces.map(trace => trace.id).sort();
    // Parent finish (02-01) wins over turn completion (03-01); usage without turn or parent falls back to its conversation.
    assert.deepEqual(selected('2026-03-05T00:00:00.000Z'), ['embedding', 'embedding-request', 'generation', 'generation-request']);
    assert.deepEqual(selected('2026-04-01T00:00:00.000Z'), ['embedding', 'embedding-request', 'generation', 'generation-request', 'image', 'image-request', 'late-embedding']);
    const totals = summarizeUsage(store.listTraces(c.id));
    const service = createMaintenance({ directory, store, now: () => Date.parse('2026-03-05T00:00:00.000Z') });
    assert.equal(service.cleanup({ token: service.previewCleanup().token }).tracesPruned, 4);
    assert.equal(store.getTrace('embedding-request').request, undefined); assert.equal(store.getTrace('image-request').request.body, 'private input');
    assert.deepEqual(summarizeUsage(store.listTraces(c.id)), totals);
});

test('interrupted restore resumes only identical attachment bytes', async t => {
    const directory = temporaryDirectory(t), id = randomUUID();
    const bytes = Buffer.from('recovered attachment');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const root = join(directory, 'attachments'); mkdirSync(root);
    const file = join(root, id); writeFileSync(file, bytes);
    let restored = 0;
    const store = { listConversations: () => [], listResources: () => [], validateBackup() {}, restoreData() { restored++; return { restored: true }; } };
    const service = createMaintenance({ store, directory });
    const backup = { format: 'conversation-v1-backup', schemaVersion: 1, repository: { attachments: { [id]: { id, path: id, sha256, size: bytes.length } } }, files: [{ id, base64: bytes.toString('base64') }] };
    await service.restore(backup);
    assert.equal(restored, 1); assert.deepEqual(readFileSync(file), bytes);
    writeFileSync(file, 'unrelated');
    await assert.rejects(service.restore(backup), error => error.code === 'restore-file-exists');
    assert.equal(restored, 1); assert.equal(readFileSync(file, 'utf8'), 'unrelated');
});
