import test from 'node:test';
import assert from 'node:assert/strict';
import { createRetrieval, EMBED_BATCH_BYTES, EMBED_BATCH_SIZE } from '../../../../src/conversation/retrieval/index.js';
import { fakeStore } from '../memory/fake-store.mjs';
const vectors = texts => ({ model: 'fake', version: 'v1', dimensions: 2, vectors: texts.map(() => [1, 0]) });
test('keyword works without embedding; stale snapshot is filtered against current state', async () => {
    const store = fakeStore(); const retrieval = createRetrieval({ store }); const snapshot = store.getConversation();
    store.snapshot.messages[0].revision++; store.snapshot.messages[1].deletedAt = 1; store.snapshot.messages[2].candidateId = 'switched';
    const results = await retrieval.search('c', 'dragon', { snapshot });
    assert.equal(results.length, 2); assert.ok(results.every(r => r.method === 'keyword'));
});
test('vector results revalidate after async query embedding', async () => {
    const store = fakeStore();
    const retrieval = createRetrieval({ store, embed: async ({ texts, purpose }) => { if (purpose === 'query') store.snapshot.messages = []; return vectors(texts); } });
    await retrieval.index('c'); assert.deepEqual(await retrieval.search('c', 'unrelated'), []);
});
test('model/version/dimension mismatch cannot mix indexes', async () => {
    for (const change of [{ model: 'other' }, { version: 'v2' }, { dimensions: 3, vectors: [[1, 0, 0]] }]) {
        const store = fakeStore(); const retrieval = createRetrieval({ store, embed: async ({ texts, purpose }) => ({ ...vectors(texts), ...(purpose === 'query' ? change : {}) }) });
        await retrieval.index('c'); assert.deepEqual(await retrieval.search('c', 'unrelated'), []);
        assert.equal((await retrieval.search('c', 'dragon')).length, 5);
    }
});
test('derived revisions and transitive invalid parents filter out', async () => {
    const store = fakeStore();
    store.snapshot.summaries.push({ id: 'parent', revision: 1, status: 'stale', content: 'secret', sourceRefs: [] }, { id: 'child', revision: 1, status: 'valid', content: 'secret', sourceRefs: [], parentSummaryRefs: [{ id: 'parent', revision: 1 }] });
    store.snapshot.memories.push({ id: 'fixed', revision: 1, status: 'valid', content: 'secret', sourceRefs: [] });
    const snapshot = store.getConversation(); store.snapshot.memories[0].revision++;
    assert.deepEqual(await createRetrieval({ store }).search('c', 'secret', { snapshot }), []);
});
test('indexed semantic results carry sources; rebuild replaces index', async () => {
    const store = fakeStore(); const retrieval = createRetrieval({ store, embed: async ({ texts }) => vectors(texts) });
    await retrieval.index('c'); const result = await retrieval.search('c', 'unrelated', { limit: 1 });
    assert.equal(result[0].method, 'vector'); assert.equal(result[0].sourceRefs[0].revision, 1);
    store.snapshot.messages = []; await retrieval.rebuild('c'); assert.deepEqual(await retrieval.search('c', 'dragon'), []);
});
test('malformed embedding is rejected for index and keyword search remains usable', async () => {
    const store = fakeStore(); const retrieval = createRetrieval({ store, embed: async () => ({ model: 'fake', version: '1', dimensions: 1, vectors: [[NaN]] }) });
    await assert.rejects(retrieval.index('c'), { code: 'invalid-embedding' }); assert.equal((await retrieval.search('c', 'dragon')).length, 5);
});
test('already-aborted search never calls query embed, with or without an index', async () => {
    const store = fakeStore(); let queries = 0;
    const retrieval = createRetrieval({ store, embed: async ({ texts, purpose }) => { if (purpose === 'query') queries++; return vectors(texts); } });
    const controller = new AbortController(); controller.abort(new Error('stopped'));
    await assert.rejects(retrieval.search('c', 'dragon', { snapshot: store.getConversation(), signal: controller.signal }), /stopped/);
    await retrieval.index('c');
    await assert.rejects(retrieval.search('c', 'dragon', { signal: controller.signal }), /stopped/);
    assert.equal(queries, 0);
});
test('query receives the original signal and cancellation is not swallowed by keyword fallback', async () => {
    const store = fakeStore(); const controller = new AbortController(); let observed;
    const retrieval = createRetrieval({ store, embed: async ({ texts, purpose, signal }) => {
        if (purpose === 'query') {
            observed = signal;
            return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        }
        return vectors(texts);
    } });
    await retrieval.index('c');
    const pending = retrieval.search('c', 'dragon', { snapshot: store.getConversation(), signal: controller.signal });
    assert.equal(observed, controller.signal);
    controller.abort(new Error('cancel query'));
    await assert.rejects(pending, /cancel query/);
});
test('late embedding result after cancellation cannot return search results', async () => {
    const store = fakeStore(); const controller = new AbortController();
    const retrieval = createRetrieval({ store, embed: async ({ texts, purpose }) => {
        if (purpose === 'query') controller.abort(new Error('cancelled before response'));
        return vectors(texts);
    } });
    await retrieval.index('c');
    await assert.rejects(retrieval.search('c', 'dragon', { signal: controller.signal }), /cancelled before response/);
});
test('ordinary query failures retain keywords while provider AbortError propagates', async () => {
    for (const aborted of [false, true]) {
        const store = fakeStore(); const error = new Error('provider failure'); if (aborted) error.name = 'AbortError';
        const retrieval = createRetrieval({ store, embed: async ({ texts, purpose }) => { if (purpose === 'query') throw error; return vectors(texts); } });
        await retrieval.index('c');
        if (aborted) await assert.rejects(retrieval.search('c', 'dragon'), { name: 'AbortError' });
        else assert.equal((await retrieval.search('c', 'dragon')).length, 5);
    }
});

test('semantic lifecycle is observable, sanitized and source changes cannot publish stale ready data', async () => {
    const store = fakeStore(), events = [];
    let finish;
    const retrieval = createRetrieval({ store, onStatus: (id, state) => events.push({ id, ...state }), embed: ({ texts }) => new Promise(resolve => { finish = () => resolve(vectors(texts)); }) });
    assert.equal(retrieval.status('c').status, 'not-ready');
    const pending = retrieval.index('c');
    assert.equal(retrieval.status('c').status, 'indexing');
    store.snapshot.messages[0].revision++;
    finish(); await pending;
    assert.equal(retrieval.status('c').status, 'stale');
    assert.equal(retrieval.status('c').semanticReady, false);
    const next = retrieval.index('c'); finish(); await next;
    assert.equal(retrieval.status('c').semanticReady, true);
    assert.deepEqual(events.map(event => event.status), ['indexing', 'stale', 'indexing', 'ready']);
    retrieval.invalidate('c');
    assert.equal(retrieval.status('c').status, 'stale');
});

test('query failures and incompatible embeddings remain visible while keywords return valid provenance', async () => {
    const store = fakeStore();
    const retrieval = createRetrieval({ store, embed: async ({ texts, purpose }) => {
        if (purpose === 'query') throw new Error('Bearer private-test-secret');
        return vectors(texts);
    } });
    await retrieval.index('c');
    const results = await retrieval.search('c', 'dragon');
    assert.equal(results.length, 5);
    assert.ok(results.every(item => item.status === 'valid' && item.kind === 'message' && item.key.startsWith('message:')));
    assert.equal(retrieval.status('c').status, 'error');
    assert.equal(retrieval.status('c').error.code, 'query-embedding-failed');
    assert.equal(JSON.stringify(retrieval.status('c')).includes('private-test-secret'), false);
});

test('invalidated in-flight index cannot restore ready or erase the newer index', async () => {
    const store = fakeStore(); const finishers = [];
    const retrieval = createRetrieval({ store, embed: ({ texts }) => new Promise(resolve => finishers.push(() => resolve(vectors(texts)))) });
    const first = retrieval.index('c'); retrieval.invalidate('c');
    const second = retrieval.index('c'); finishers[1](); await second;
    finishers[0](); assert.equal((await first).status, 'superseded');
    assert.equal(retrieval.status('c').status, 'ready');
});

test('hidden sources and their derived facts are absent even with a previously indexed snapshot', async () => {
    const store = fakeStore();
    const source = store.snapshot.messages[0];
    store.snapshot.memories.push({ id: 'hidden-memory', revision: 1, status: 'valid', content: 'dragon derived', sourceRefs: [{ messageId: source.id, revision: source.revision, candidateId: source.candidateId, candidateRevision: source.candidateRevision }] });
    const retrieval = createRetrieval({ store, embed: async ({ texts }) => vectors(texts) });
    await retrieval.index('c');
    const old = store.getConversation();
    source.userHidden = true;
    const found = await retrieval.search('c', 'dragon', { snapshot: old });
    assert.equal(found.length, 4);
    assert.ok(found.every(item => item.sourceRefs.every(ref => ref.messageId !== source.id)));
    assert.equal(retrieval.status('c').status, 'stale');
});

test('large histories are embedded in bounded batches and stay searchable', async () => {
    const store = fakeStore({ completed: 2100 }); const batches = [];
    const retrieval = createRetrieval({ store, embed: async ({ texts, purpose }) => {
        assert.ok(texts.length <= 2048, 'provider adapter rejects more than 2048 inputs');
        if (purpose === 'index') batches.push(texts.length);
        return vectors(texts);
    } });
    const state = await retrieval.index('c');
    assert.equal(state.status, 'ready'); assert.equal(state.count, 2100);
    assert.equal(batches.length, Math.ceil(2100 / EMBED_BATCH_SIZE));
    assert.ok(batches.every(size => size <= EMBED_BATCH_SIZE));
    assert.equal(batches.reduce((sum, size) => sum + size, 0), 2100);
    assert.equal((await retrieval.search('c', 'unrelated', { limit: 1 }))[0].method, 'vector');
});

test('reindex embeds only new or edited content and rebuild embeds everything', async () => {
    const store = fakeStore(); let embedded = [];
    const retrieval = createRetrieval({ store, embed: async ({ texts, purpose }) => { if (purpose === 'index') embedded.push(...texts); return vectors(texts); } });
    await retrieval.index('c');
    assert.equal(embedded.length, 5);
    embedded = [];
    store.snapshot.messages[0].revision++;
    retrieval.invalidate('c'); assert.equal((await retrieval.index('c')).status, 'ready');
    assert.deepEqual(embedded, []);
    store.snapshot.messages[1].content = 'dragon edited';
    store.snapshot.messages.push({ id: 'm6', turnId: 't5', role: 'assistant', content: 'dragon arrives', status: 'completed', revision: 1, candidateId: 'a6', candidateRevision: 1 });
    retrieval.invalidate('c'); const state = await retrieval.index('c');
    assert.deepEqual(embedded.sort(), ['dragon arrives', 'dragon edited']);
    assert.equal(state.count, 6); assert.equal(state.model, 'fake');
    assert.equal((await retrieval.search('c', 'unrelated')).length, 6);
    embedded = [];
    await retrieval.rebuild('c');
    assert.equal(embedded.length, 6);
});

test('changed embedding model, version or dimensions never reuses earlier vectors', async () => {
    for (const change of [{ model: 'other' }, { version: 'v2' }, { dimensions: 3 }]) {
        const store = fakeStore(); let current = {}, embedded = 0;
        const embed = async ({ texts, purpose }) => {
            if (purpose === 'index') embedded += texts.length;
            const value = { ...vectors(texts), ...current };
            return { ...value, vectors: texts.map(() => Array.from({ length: value.dimensions }, (_, i) => (i === 0 ? 1 : 0))) };
        };
        const retrieval = createRetrieval({ store, embed });
        await retrieval.index('c');
        current = change; embedded = 0;
        store.snapshot.messages[0].content = 'dragon edited';
        retrieval.invalidate('c'); const state = await retrieval.index('c');
        assert.equal(embedded, 5);
        assert.equal(state.model, change.model ?? 'fake'); assert.equal(state.version, change.version ?? 'v1'); assert.equal(state.dimensions, change.dimensions ?? 2);
        assert.ok((await retrieval.search('c', 'unrelated')).every(item => item.method === 'vector'));
    }
});

test('query embedding mismatch drops reusable vectors so the next index re-embeds', async () => {
    const store = fakeStore(); let query = {}, embedded = 0;
    const retrieval = createRetrieval({ store, embed: async ({ texts, purpose }) => {
        if (purpose === 'index') embedded += texts.length;
        return { ...vectors(texts), ...(purpose === 'query' ? query : {}) };
    } });
    await retrieval.index('c');
    query = { version: 'v2' };
    await retrieval.search('c', 'dragon');
    assert.equal(retrieval.status('c').error.code, 'embedding-mismatch');
    embedded = 0;
    retrieval.invalidate('c'); await retrieval.index('c');
    assert.equal(embedded, 5);
});

test('superseded or aborted indexing stops between batches and keeps finished batches reusable', async () => {
    for (const interruption of ['superseded', 'aborted']) {
        const store = fakeStore({ completed: 2100 }); const controller = new AbortController(); let calls = 0, embedded = 0;
        const retrieval = createRetrieval({ store, embed: async ({ texts }) => {
            calls++; embedded += texts.length;
            if (calls === 1) { if (interruption === 'superseded') retrieval.invalidate('c'); else controller.abort(new Error('stopped')); }
            return vectors(texts);
        } });
        if (interruption === 'superseded') assert.equal((await retrieval.index('c', { signal: controller.signal })).status, 'superseded');
        else {
            await assert.rejects(retrieval.index('c', { signal: controller.signal }), /stopped/);
            assert.equal(retrieval.status('c').status, 'not-ready');
        }
        assert.equal(calls, 1); assert.equal(embedded, EMBED_BATCH_SIZE);
        const state = await retrieval.index('c');
        assert.equal(state.status, 'ready'); assert.equal(state.count, 2100);
        assert.equal(embedded, 2100);
    }
});

test('long entries split batches by UTF-8 bytes and an oversized entry is sent alone', async () => {
    const store = fakeStore({ completed: 40 }); const batches = [];
    // 16000 CJK characters (48000 bytes) is the longest summary; mixed with short messages and one entry above the byte cap.
    store.snapshot.messages.forEach((message, i) => { message.content = i % 4 === 0 ? `${i}${'龙'.repeat(16000)}` : `dragon event ${i}`; });
    store.snapshot.messages[7].content = `oversized ${'x'.repeat(EMBED_BATCH_BYTES + 10)}`;
    const retrieval = createRetrieval({ store, embed: async ({ texts, purpose }) => {
        if (purpose === 'index') batches.push(texts.map(text => Buffer.byteLength(text)));
        return vectors(texts);
    } });
    const state = await retrieval.index('c');
    assert.equal(state.status, 'ready'); assert.equal(state.count, 40);
    assert.equal(batches.flat().length, 40);
    for (const sizes of batches) {
        const total = sizes.reduce((sum, size) => sum + size, 0);
        assert.ok(sizes.length === 1 || total <= EMBED_BATCH_BYTES, `batch of ${sizes.length} inputs has ${total} bytes`);
    }
    assert.ok(batches.some(sizes => sizes.length === 1 && sizes[0] > EMBED_BATCH_BYTES));
    assert.ok(batches.length > 1);
});
