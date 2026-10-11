import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../../../../src/conversation/store/index.js';
import { initializeDatabase, STORAGE_VERSION } from '../../../../src/conversation/store/persistence.js';
import { createTraceService } from '../../../../src/conversation/traces/index.js';
import { summarizeUsage } from '../../../../src/conversation/traces/usage.js';
import { canonicalJson } from '../../../../public/shared/conversation/schemas/index.js';

function fixture(t) {
    const directory = mkdtempSync(join(tmpdir(), 'conversation-trace-'));
    const f = { directory, store: createStore({ directory }) };
    t.after(() => { f.store.close(); rmSync(directory, { recursive: true, force: true }); });
    return f;
}
const code = expected => error => error.code === expected;

test('trace events append independently; terminal save retains plan, ordered evidence and usage', t => {
    const { store, directory } = fixture(t);
    const c = store.createConversation({});
    const service = createTraceService({ store, now: () => '2026-01-01T00:00:00.000Z' });
    const requestPlan = { messages: [{ role: 'user', content: 'Small functional fixture.' }] };
    const tid = service.begin({ conversationId: c.id, requestPlan });
    const db = new DatabaseSync(join(directory, 'store.sqlite')); t.after(() => db.close());
    db.exec(`CREATE TABLE trace_writes (kind TEXT);
        CREATE TRIGGER trace_header_update AFTER UPDATE ON traces BEGIN INSERT INTO trace_writes VALUES ('header'); END;
        CREATE TRIGGER trace_event_insert AFTER INSERT ON trace_events BEGIN INSERT INTO trace_writes VALUES ('event'); END;`);
    for (let i = 0; i < 4; i++) service.record(tid, { type: 'text.delta', text: String(i) });
    service.record(tid, { type: 'usage.updated', usage: { totalTokens: 7, complete: true }, apiKey: 'fixture-secret' });
    assert.equal(db.prepare("SELECT count(*) n FROM trace_writes WHERE kind='header'").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM trace_writes WHERE kind='event'").get().n, 5);
    const raw = JSON.parse(db.prepare('SELECT data FROM traces WHERE id=?').get(tid).data);
    assert.deepEqual(raw.events, []); assert.deepEqual(raw.requestPlan, requestPlan);
    assert.equal(store.getTrace(tid).events.length, 5);
    assert.equal(JSON.stringify(store.getTrace(tid)).includes('fixture-secret'), false);
    service.finish(tid, { usage: { totalTokens: 7, complete: true } });
    const trace = store.getTrace(tid);
    assert.equal(trace.status, 'completed'); assert.equal(trace.usage.totalTokens, 7);
    assert.deepEqual(trace.requestPlan, requestPlan);
    assert.deepEqual(trace.events.slice(0, 4).map(e => e.text), ['0', '1', '2', '3']);
    assert.equal(db.prepare("SELECT count(*) n FROM trace_writes WHERE kind='header'").get().n, 1);
    assert.equal(db.prepare("SELECT count(*) n FROM trace_writes WHERE kind='event'").get().n, 5);
    service.record(tid, { type: 'text.delta', text: 'ignored after finish' });
    assert.throws(() => store.appendTraceEvent(tid, { type: 'late' }), code('trace-finalized'));
    assert.deepEqual(store.getTrace(tid), trace);
});

test('failed trace append rolls back event and sequence; failure terminal preserves prior evidence', t => {
    const { store, directory } = fixture(t); const c = store.createConversation({});
    const service = createTraceService({ store });
    const tid = service.begin({ conversationId: c.id, requestPlan: {} });
    service.record(tid, { type: 'text.delta', text: 'saved' });
    const db = new DatabaseSync(join(directory, 'store.sqlite')); t.after(() => db.close());
    db.exec("CREATE TRIGGER reject_sequence BEFORE UPDATE ON trace_streams BEGIN SELECT RAISE(ABORT, 'injected sequence failure'); END;");
    assert.throws(() => service.record(tid, { type: 'text.delta', text: 'not committed' }), /injected sequence failure/);
    assert.equal(db.prepare('SELECT count(*) n FROM trace_events WHERE trace_id=?').get(tid).n, 1);
    assert.equal(db.prepare('SELECT next_seq FROM trace_streams WHERE trace_id=?').get(tid).next_seq, 2);
    db.exec('DROP TRIGGER reject_sequence');
    service.record(tid, { type: 'usage.updated', usage: { totalTokens: 3 } });
    service.fail(tid, { code: 'model-failed', message: 'private detail' });
    assert.equal(store.getTrace(tid).status, 'failed');
    assert.equal(store.getTrace(tid).events.length, 2);
    assert.equal(store.getTrace(tid).error.code, 'model-failed');
    assert.equal(JSON.stringify(store.getTrace(tid)).includes('private detail'), false);
});

test('reopening and backup restore assemble the same trace; pruning preserves usage and deletes event rows', t => {
    const f = fixture(t); const c = f.store.createConversation({});
    // Direct trace writers may omit events initially.
    const trace = f.store.saveTrace({ conversationId: c.id, status: 'running', requestPlan: {} });
    f.store.appendTraceEvent(trace.id, { type: 'usage.updated', usage: { totalTokens: 2, complete: true } });
    const expected = f.store.getTrace(trace.id);
    f.store.close(); f.store = createStore({ directory: f.directory });
    assert.deepEqual(f.store.getTrace(trace.id), expected);
    const backup = f.store.exportData();
    assert.deepEqual(backup.traces[trace.id], expected);
    assert.equal(Object.hasOwn(backup, 'trace_events'), false);
    const target = fixture(t); target.store.restoreData(backup);
    assert.deepEqual(target.store.listTraces(c.id), [expected]);
    const totals = summarizeUsage(target.store.listTraces(c.id));
    target.store.pruneTraces([{ id: trace.id, fingerprint: canonicalJson(expected) }]);
    assert.deepEqual(summarizeUsage(target.store.listTraces(c.id)), totals);
    assert.equal(target.store.getTrace(trace.id).events, undefined);
    assert.throws(() => target.store.appendTraceEvent(trace.id, { type: 'late' }), code('trace-finalized'));
    const db = new DatabaseSync(join(target.directory, 'store.sqlite')); t.after(() => db.close());
    assert.equal(db.prepare('SELECT count(*) n FROM trace_events').get().n, 0);
    target.store.deleteConversation(c.id, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM trace_streams').get().n, 0);
});

test('invalid trace event backup fails validation without partial writes', t => {
    const source = fixture(t), target = fixture(t); const c = source.store.createConversation({});
    const trace = source.store.saveTrace({ conversationId: c.id, events: [] });
    const backup = source.store.exportData(); backup.traces[trace.id].events = [null];
    assert.throws(() => target.store.restoreData(backup), code('invalid-backup'));
    assert.deepEqual(target.store.listConversations(), []);
});

test('only empty databases or the current layout open; unsupported layouts are not migrated', () => {
    for (const setup of ["CREATE TABLE unrelated (value TEXT)", "CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT); INSERT INTO metadata VALUES ('storageVersion','unsupported')"]) {
        const db = new DatabaseSync(':memory:');
        try {
            db.exec(setup);
            const before = db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
            assert.throws(() => initializeDatabase(db), code('schema-version'));
            assert.deepEqual(db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(), before);
        } finally { db.close(); }
    }
    const db = new DatabaseSync(':memory:');
    try {
        initializeDatabase(db); initializeDatabase(db);
        assert.equal(db.prepare("SELECT value FROM metadata WHERE key='storageVersion'").get().value, STORAGE_VERSION);
    } finally { db.close(); }
});
