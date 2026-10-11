import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../../../../src/conversation/store/index.js';
import { ENTITY_TABLES, SECRET_SCHEMA } from '../../../../src/conversation/store/persistence.js';

function makeStore(t) {
    const directory = mkdtempSync(join(tmpdir(), 'conversation-entities-'));
    const store = createStore({ directory });
    t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
    return { store, directory };
}
const request = (revision = 0, extra = {}) => ({ schemaVersion: 1, clientRequestId: crypto.randomUUID(), type: 'send', content: 'hello', expectedContentRevision: revision, ...extra });
function populated(t) {
    const { store } = makeStore(t); const c = store.createConversation({});
    const { turn } = store.beginTurn(c.id, request());
    store.finishTurn(turn.id, { status: 'completed', content: 'answer' }, 1);
    store.commitDerived(c.id, { summaries: [{ id: 'summary', content: 'summary', sourceRefs: [{ messageId: turn.userMessageId, revision: 1, candidateId: null, candidateRevision: null }] }], memories: [], folds: [] });
    return { store, cid: c.id, turn };
}

test('1500+ retained messages: streaming updates only its turn and inserts its event', t => {
    const source = populated(t); const backup = source.store.exportData();
    const sample = Object.values(backup.messages)[0];
    for (let i = 0; i < 1500; i++) {
        const m = structuredClone(sample); m.id = `history-${i}`; m.content = `history content ${i}`;
        m.versions = m.versions.map(v => ({ ...v, id: m.id, content: m.content })); backup.messages[m.id] = m;
    }
    const { store, directory } = makeStore(t);
    store.restoreData(backup);
    assert.equal(store.getConversation(source.cid).messages.length, 1502);
    const other = store.createConversation({ title: 'unrelated' });
    const accepted = store.beginTurn(source.cid, request(store.getConversation(source.cid).conversation.contentRevision));
    const db = new DatabaseSync(join(directory, 'store.sqlite'));
    t.after(() => { if (db.isOpen) db.close(); });
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='repository'").get().n, 0);
    db.exec('CREATE TABLE writes (entity TEXT, operation TEXT)');
    for (const table of [...ENTITY_TABLES, 'events']) for (const operation of ['INSERT', 'UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER audit_${table}_${operation} AFTER ${operation} ON ${table} BEGIN INSERT INTO writes VALUES ('${table}', '${operation}'); END`);
    store.appendDelta(accepted.turn.id, { text: 'stream text' }, 1);
    assert.deepEqual(db.prepare('SELECT entity,operation FROM writes ORDER BY entity').all().map(row => ({ ...row })), [
        { entity: 'events', operation: 'INSERT' }, { entity: 'turns', operation: 'UPDATE' },
    ]);
    assert.equal(store.getTurn(accepted.turn.id).content, 'stream text');
    assert.equal(store.getConversation(other.id).messages.length, 0);
    assert.equal(store.events(source.cid).at(-1).payload.text, 'stream text');
    db.close();
});

test('backup preflight is read-only; malformed schemas and every reference family fail atomically', t => {
    const source = populated(t); const valid = source.store.exportData();
    assert.deepEqual(valid.secretSchema, SECRET_SCHEMA);
    const { store, directory } = makeStore(t);
    const observer = new DatabaseSync(join(directory, 'store.sqlite')); t.after(() => { if (observer.isOpen) observer.close(); });
    const version = observer.prepare('PRAGMA data_version').get().data_version;
    assert.deepEqual(store.validateBackup(valid), { valid: true });
    assert.equal(observer.prepare('PRAGMA data_version').get().data_version, version);
    assert.equal(store.listConversations().length, 0);
    const mutations = [
        b => { delete b.secretSchema; },
        b => { b.secretSchema.containsCredentials = false; },
        b => { b.attachments = []; },
        b => { b.snapshots = {}; },
        b => { b.messages[Object.keys(b.messages)[0]].versions[0].turnId = 'missing'; },
        b => { b.turns[source.turn.id].attemptEpoch = -1; },
        b => { b.turns[source.turn.id].request.clientRequestId = 'different'; },
        b => { b.summaries.summary.sourceRefs[0].revision = 999; },
        b => { b.events[source.cid][0].seq = 100; },
        b => { b.events[source.cid][0].turnId = 'missing'; },
        b => { b.events.orphan = []; },
        b => { b.snapshots[source.turn.snapshotId].messages[0].media = [{ attachmentId: 'missing' }]; },
        b => { b.conversations[source.cid].activeTurnId = source.turn.id; },
        b => { b.attachments.file = { id: 'file', name: 'file', mime: 'image/png', size: 1, sha256: 'a'.repeat(64), path: '../escape', createdAt: 1 }; },
        b => { b.traces.bad = { id: 'bad', conversationId: source.cid, turnId: 'missing' }; },
    ];
    for (const mutate of mutations) {
        const bad = structuredClone(valid); mutate(bad);
        assert.throws(() => store.validateBackup(bad), error => ['invalid-backup', 'schema-version'].includes(error.code));
        assert.throws(() => store.restoreData(bad), error => ['invalid-backup', 'schema-version'].includes(error.code));
        assert.equal(store.listConversations().length, 0);
        assert.equal(observer.prepare('SELECT COUNT(*) AS n FROM events').get().n, 0);
    }
    store.restoreData(valid); assert.equal(store.getConversation(source.cid).messages.length, 2);
    assert.throws(() => store.validateBackup(valid), error => error.code === 'restore-not-empty');
    observer.close();
});

test('even an attachment-only target is not empty; attachment-backed backup validates and restores', t => {
    const { store: source } = makeStore(t);
    const record = { id: 'asset', name: 'pic', mime: 'image/png', size: 1, sha256: 'b'.repeat(64), path: 'opaque-asset', createdAt: 1 };
    source.saveAttachment(record);
    const c = source.createConversation({}); const { turn } = source.beginTurn(c.id, request(0, { media: [{ attachmentId: 'asset', type: 'image' }] }));
    source.finishTurn(turn.id, { status: 'failed' }, 1);
    const backup = source.exportData();
    const { store: dest } = makeStore(t); dest.saveAttachment({ ...record, id: 'unrelated', path: 'unrelated' });
    assert.throws(() => dest.validateBackup(backup), error => error.code === 'restore-not-empty');
    assert.throws(() => dest.restoreData(backup), error => error.code === 'restore-not-empty');
    dest.deleteAttachment('unrelated'); dest.validateBackup(backup); dest.restoreData(backup);
    assert.equal(dest.getConversation(c.id).messages[0].media[0].attachmentId, 'asset');
    assert.deepEqual(dest.getAttachment('asset'), record);
});

test('active backup recovery and event insertion stay in one transaction', t => {
    const { store: source } = makeStore(t); const c = source.createConversation({});
    const { turn } = source.beginTurn(c.id, request()); source.appendDelta(turn.id, { text: 'partial' }, 1);
    const { store: dest } = makeStore(t); dest.restoreData(source.exportData());
    assert.equal(dest.getTurn(turn.id).status, 'interrupted');
    assert.equal(dest.getConversation(c.id).messages.at(-1).content, 'partial');
    assert.equal(dest.events(c.id).at(-1).type, 'turn.interrupted');
    assert.equal(dest.getConversation(c.id).conversation.activeTurnId, null);
});

test('SQLite failure after some restored entities are inserted rolls back the entire restore', t => {
    const source = populated(t); const backup = source.store.exportData();
    const { store, directory } = makeStore(t);
    const db = new DatabaseSync(join(directory, 'store.sqlite')); t.after(() => { if (db.isOpen) db.close(); });
    db.exec("CREATE TRIGGER reject_restore BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'injected restore failure'); END");
    const before = store.exportData();
    assert.throws(() => store.restoreData(backup), /injected restore failure/);
    assert.deepEqual(store.exportData(), before);
    for (const table of [...ENTITY_TABLES, 'events']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
    db.exec('DROP TRIGGER reject_restore');
    store.restoreData(backup);
    assert.equal(store.getConversation(source.cid).messages.length, 2);
    db.close();
});

test('backup retains frozen auxiliary revisions and rejects missing auxiliary graph entries', t => {
    const { store: source } = makeStore(t);
    const aux = source.createResource({ kind: 'connection', name: 'image', data: { apiKey: 'image-key' } });
    const main = source.createResource({ kind: 'connection', name: 'main', data: { auxiliary: { image: { connectionId: aux.id } } } });
    const c = source.createConversation({ settings: { connectionId: main.id, imageConnectionId: aux.id } });
    const { turn } = source.beginTurn(c.id, request()); source.finishTurn(turn.id, { status: 'completed', content: 'ok' }, 1);
    const backup = source.exportData(); const { store: dest } = makeStore(t);
    dest.validateBackup(backup);
    const missingSnapshot = structuredClone(backup); missingSnapshot.snapshots[turn.snapshotId].resources = missingSnapshot.snapshots[turn.snapshotId].resources.filter(r => r.id !== aux.id);
    assert.throws(() => dest.validateBackup(missingSnapshot), error => error.code === 'invalid-backup');
    const missingResource = structuredClone(backup); delete missingResource.resources[aux.id];
    assert.throws(() => dest.validateBackup(missingResource), error => error.code === 'invalid-backup');
    dest.restoreData(backup);
    assert.equal(dest.getConnection(aux.id, 1).data.apiKey, 'image-key');
    assert.equal(dest.getConversation(c.id).resources.find(r => r.id === aux.id).data.apiKey, undefined);
});
