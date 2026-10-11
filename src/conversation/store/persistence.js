import { invariant } from '../../../public/shared/conversation/schemas/index.js';

export const ENTITY_TABLES = ['conversations', 'resources', 'messages', 'turns', 'snapshots', 'summaries', 'memories', 'folds', 'jobs', 'tools', 'traces', 'attachments'];
export const UNIT = Symbol('sqlite-unit');
export const SECRET_SCHEMA = Object.freeze({ version: 1, containsCredentials: true, purpose: 'internal-backup' });
export const STORAGE_VERSION = '3';

export function initializeDatabase(db) {
    const tables = db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\'').all();
    if (tables.length) {
        invariant(tables.some(table => table.name === 'metadata'), 'schema-version', 'Unsupported storage schema', 409);
        const existing = db.prepare('SELECT value FROM metadata WHERE key=\'storageVersion\'').get();
        invariant(existing?.value === STORAGE_VERSION, 'schema-version', 'Unsupported storage schema', 409);
    }
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    db.exec('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.exec('BEGIN IMMEDIATE');
    try {
        for (const table of ENTITY_TABLES) {
            db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, conversation_id TEXT, data TEXT NOT NULL CHECK(json_valid(data)));
                CREATE INDEX IF NOT EXISTS ${table}_conversation ON ${table}(conversation_id)`);
        }
        db.exec(`CREATE TABLE IF NOT EXISTS events (
            conversation_id TEXT NOT NULL, seq INTEGER NOT NULL CHECK(seq > 0), event_id TEXT NOT NULL UNIQUE,
            data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(conversation_id, seq));
            CREATE UNIQUE INDEX IF NOT EXISTS turns_request ON turns(conversation_id, json_extract(data, '$.clientRequestId'));
            CREATE UNIQUE INDEX IF NOT EXISTS jobs_fingerprint ON jobs(json_extract(data, '$.fingerprint'));
            CREATE UNIQUE INDEX IF NOT EXISTS tools_call ON tools(conversation_id, json_extract(data, '$.turnId'), COALESCE(json_extract(data, '$.memberRunId'), ''), json_extract(data, '$.toolCallId'));`);
        db.exec(`CREATE TABLE IF NOT EXISTS trace_streams (
            trace_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, turn_id TEXT, status TEXT, next_seq INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS trace_events (
            trace_id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(trace_id,seq));`);
        db.prepare('INSERT OR IGNORE INTO metadata VALUES (\'storageVersion\', ?)').run(STORAGE_VERSION);
        db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
}

/** A transaction-local identity map: load records on demand and write only changed records. */
export function unitOfWork(db) {
    const tracked = [];
    const scoped = {};
    const state = { schemaVersion: 1 };
    for (const table of ENTITY_TABLES) {
        const cache = Object.create(null);
        const originals = new Map();
        const originalTraceEvents = new Map();
        const removed = new Set();
        const fetch = db.prepare(`SELECT data FROM ${table} WHERE id=?`);
        const keys = db.prepare(`SELECT id FROM ${table} ORDER BY rowid`);
        const load = key => {
            if (removed.has(key)) return undefined;
            if (Object.hasOwn(cache, key)) return cache[key];
            const row = fetch.get(key);
            if (!row) return undefined;
            originals.set(key, row.data);
            const value = JSON.parse(row.data);
            if (table === 'traces') {
                const rows = db.prepare('SELECT data FROM trace_events WHERE trace_id=? ORDER BY seq').all(key);
                originalTraceEvents.set(key, rows.map(r => r.data));
                if (rows.length || Object.hasOwn(value, 'events')) value.events = rows.map(r => JSON.parse(r.data));
            }
            return cache[key] = value;
        };
        const map = new Proxy(cache, {
            get: (_, key) => typeof key === 'string' ? load(key) : undefined,
            getOwnPropertyDescriptor: (_, key) => load(key) === undefined ? undefined : { configurable: true, enumerable: true, writable: true, value: cache[key] },
            ownKeys: () => [...new Set([...keys.all().map(row => row.id), ...Object.keys(cache)])].filter(key => !removed.has(key)),
            set: (_, key, value) => { load(key); removed.delete(key); cache[key] = value; return true; },
            deleteProperty: (_, key) => { load(key); removed.add(key); delete cache[key]; return true; },
        });
        state[table] = map;
        scoped[table] = cid => [...new Set([...db.prepare(`SELECT id FROM ${table} WHERE conversation_id=? ORDER BY rowid`).all(cid).map(row => row.id), ...Object.keys(cache)])].filter(key => !removed.has(key)).map(load).filter(value => value?.conversationId === cid);
        const upsert = db.prepare(`INSERT INTO ${table}(id,conversation_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET conversation_id=excluded.conversation_id,data=excluded.data`);
        const remove = db.prepare(`DELETE FROM ${table} WHERE id=?`);
        tracked.push(() => {
            for (const key of removed) {
                if (table === 'traces') {
                    db.prepare('DELETE FROM trace_events WHERE trace_id=?').run(key);
                    db.prepare('DELETE FROM trace_streams WHERE trace_id=?').run(key);
                    originalTraceEvents.delete(key);
                }
                remove.run(key); originals.delete(key);
            }
            removed.clear();
            for (const [key, value] of Object.entries(cache)) {
                const json = JSON.stringify(table === 'traces' && Object.hasOwn(value, 'events') ? { ...value, events: [] } : value);
                const changed = json !== originals.get(key);
                if (changed) { upsert.run(key, value.conversationId ?? (table === 'conversations' ? key : null), json); originals.set(key, json); }
                if (table === 'traces') {
                    const events = (value.events ?? []).map(e => JSON.stringify(e));
                    const previous = originalTraceEvents.get(key) ?? [];
                    let prefix = 0;
                    while (prefix < previous.length && prefix < events.length && previous[prefix] === events[prefix]) prefix++;
                    if (prefix < previous.length) db.prepare('DELETE FROM trace_events WHERE trace_id=? AND seq>?').run(key, prefix);
                    const insert = db.prepare('INSERT INTO trace_events(trace_id,seq,data) VALUES(?,?,?)');
                    for (let i = prefix; i < events.length; i++) insert.run(key, i + 1, events[i]);
                    originalTraceEvents.set(key, events);
                    if (changed || prefix !== previous.length || prefix !== events.length) db.prepare(`INSERT INTO trace_streams(trace_id,conversation_id,turn_id,status,next_seq) VALUES(?,?,?,?,?)
                        ON CONFLICT(trace_id) DO UPDATE SET status=excluded.status,next_seq=excluded.next_seq`).run(key, value.conversationId, value.turnId ?? null, value.detailsPrunedAt ? 'pruned' : value.status ?? null, events.length + 1);
                }
            }
        });
    }
    // Event lists are loaded only for exports/deletes. Streaming appends never read historical events.
    const eventCache = Object.create(null);
    const eventOriginals = new Map();
    const eventRemoved = new Set();
    const loadEvents = cid => {
        if (eventRemoved.has(cid)) return undefined;
        if (Object.hasOwn(eventCache, cid)) return eventCache[cid];
        const rows = db.prepare('SELECT data FROM events WHERE conversation_id=? ORDER BY seq').all(cid);
        if (!rows.length) return undefined;
        const list = rows.map(row => JSON.parse(row.data));
        eventOriginals.set(cid, new Map(list.map(e => [e.seq, JSON.stringify(e)])));
        return eventCache[cid] = list;
    };
    state.events = new Proxy(eventCache, {
        get: (_, key) => typeof key === 'string' ? loadEvents(key) : undefined,
        getOwnPropertyDescriptor: (_, key) => loadEvents(key) === undefined ? undefined : { configurable: true, enumerable: true, writable: true, value: eventCache[key] },
        ownKeys: () => [...new Set([...db.prepare('SELECT DISTINCT conversation_id FROM events').all().map(row => row.conversation_id), ...Object.keys(eventCache)])].filter(cid => !eventRemoved.has(cid)),
        set: (_, key, value) => { loadEvents(key); eventRemoved.delete(key); eventCache[key] = value; return true; },
        deleteProperty: (_, key) => { eventRemoved.add(key); delete eventCache[key]; return true; },
    });
    const append = db.prepare('INSERT INTO events(conversation_id,seq,event_id,data) VALUES(?,?,?,?)');
    state[UNIT] = {
        appendTraceEvent: (traceId, event) => {
            const stream = db.prepare('SELECT status,next_seq FROM trace_streams WHERE trace_id=?').get(traceId);
            invariant(stream, 'not-found', 'Trace not found', 404);
            invariant(stream.status === 'running', 'trace-finalized', 'Trace does not accept more events', 409);
            db.prepare('INSERT INTO trace_events(trace_id,seq,data) VALUES(?,?,?)').run(traceId, stream.next_seq, JSON.stringify(event));
            db.prepare('UPDATE trace_streams SET next_seq=next_seq+1 WHERE trace_id=?').run(traceId);
            return { traceId, seq: stream.next_seq };
        },
        nextSeq: cid => Number(db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM events WHERE conversation_id=?').get(cid).seq),
        appendEvent: e => append.run(e.conversationId, e.seq, e.eventId, JSON.stringify(e)),
        events: (cid, after) => db.prepare('SELECT data FROM events WHERE conversation_id=? AND seq>? ORDER BY seq').all(cid, after).map(row => JSON.parse(row.data)),
        values: (table, cid) => scoped[table](cid),
        isEmpty: () => [...ENTITY_TABLES, 'events', 'trace_streams', 'trace_events'].every(table => !db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()),
        flush: () => {
            for (const commit of tracked) commit();
            for (const cid of eventRemoved) { db.prepare('DELETE FROM events WHERE conversation_id=?').run(cid); eventOriginals.delete(cid); }
            eventRemoved.clear();
            for (const [cid, list] of Object.entries(eventCache)) for (const e of list) {
                if (eventOriginals.get(cid)?.get(e.seq) !== JSON.stringify(e)) { append.run(cid, e.seq, e.eventId, JSON.stringify(e)); if (!eventOriginals.has(cid)) eventOriginals.set(cid, new Map()); eventOriginals.get(cid).set(e.seq, JSON.stringify(e)); }
            }
        },
    };
    return state;
}

export function materialize(state) {
    return { schemaVersion: state.schemaVersion, secretSchema: { ...SECRET_SCHEMA },
        ...Object.fromEntries([...ENTITY_TABLES, 'events'].map(table => [table, Object.fromEntries(Object.entries(state[table]))])) };
}
