import { createHash } from 'node:crypto';
import { invariant, canonicalJson } from '../../../public/shared/conversation/schemas/index.js';
import { searchableEntries } from '../memory/sources.js';

// Inputs per index request: below the embedding adapter's 2048 cap and common provider batch limits (Cohere 96, Google 100).
export const EMBED_BATCH_SIZE = 96;
// UTF-8 bytes per index request. A token spans at least one byte, so a batch stays under per-request token caps (OpenAI 300k).
export const EMBED_BATCH_BYTES = 256 * 1024;

/** Takes the next batch off pending: at most EMBED_BATCH_SIZE inputs and EMBED_BATCH_BYTES, but always at least one input. */
function nextBatch(pending, texts) {
    let size = 0, bytes = 0;
    while (size < pending.length && size < EMBED_BATCH_SIZE) {
        bytes += Buffer.byteLength(texts.get(pending[size]));
        if (size && bytes > EMBED_BATCH_BYTES) break;
        size++;
    }
    return pending.splice(0, size);
}

function checkedEmbedding(value, count) {
    invariant(value && typeof value.model === 'string' && value.model && typeof value.version === 'string' && value.version,
        'invalid-embedding', 'Embedding model and version are required');
    invariant(Number.isSafeInteger(value.dimensions) && value.dimensions > 0 && value.dimensions <= 65536 && Array.isArray(value.vectors) && value.vectors.length === count,
        'invalid-embedding', 'Invalid embedding dimensions or count');
    invariant(value.vectors.every(vector => Array.isArray(vector) && vector.length === value.dimensions && vector.every(Number.isFinite) && vector.some(x => x !== 0)),
        'invalid-embedding', 'Invalid embedding vector');
    return value;
}
function cosine(a, b) {
    const scaleA = Math.max(...a.map(Math.abs));
    const scaleB = Math.max(...b.map(Math.abs));
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) { const x = a[i] / scaleA, y = b[i] / scaleB; dot += x * y; aa += x * x; bb += y * y; }
    return dot / Math.sqrt(aa * bb);
}
// Hidden originals and all derived entries depending on them are ineligible, even
// when a caller supplies an older snapshot whose derived status is still valid.
const visibleEntries = snapshot => searchableEntries({ ...snapshot, messages: snapshot.messages.filter(message => !message.userHidden) });
const fingerprint = entry => canonicalJson([entry.key, entry.revision, entry.content, entry.sourceRefs]);
const contentKey = text => createHash('sha256').update(text).digest('base64');
const sameEmbedding = (a, b) => a.model === b.model && a.version === b.version && a.dimensions === b.dimensions;

/** Derived index stays in memory; never opens old data paths or writes files. */
export function createRetrieval({ store, embed, onStatus }) {
    const indexes = new Map();
    const epochs = new Map();
    const states = new Map();
    // Content-addressed vectors outlive invalidation so only new or edited texts are embedded again.
    const vectorCache = new Map();
    const signature = entries => canonicalJson(entries.map(fingerprint));
    function remember(conversationId, result, keys) {
        let cache = vectorCache.get(conversationId);
        if (!cache || !sameEmbedding(cache, result)) vectorCache.set(conversationId, cache = { model: result.model, version: result.version, dimensions: result.dimensions, vectors: new Map() });
        keys.forEach((key, i) => cache.vectors.set(key, result.vectors[i]));
    }
    function status(conversationId) {
        const state = states.get(conversationId) ?? { status: embed ? 'not-ready' : 'keyword-only', semanticReady: false, count: 0 };
        const cached = indexes.get(conversationId);
        if (state.status === 'ready' && cached && cached.signature !== signature(visibleEntries(store.getConversation(conversationId)))) {
            return { ...state, status: 'stale', semanticReady: false };
        }
        return structuredClone(state);
    }
    function publish(conversationId, value) {
        const next = { semanticReady: value.status === 'ready', ...value };
        const changed = canonicalJson(states.get(conversationId) ?? null) !== canonicalJson(next);
        states.set(conversationId, next);
        if (changed) onStatus?.(conversationId, structuredClone(next));
        return structuredClone(next);
    }
    function invalidate(conversationId) {
        epochs.set(conversationId, (epochs.get(conversationId) ?? 0) + 1);
        indexes.delete(conversationId);
        return publish(conversationId, { status: embed ? 'stale' : 'keyword-only', semanticReady: false, count: 0 });
    }
    async function index(conversationId, { signal } = {}) {
        const epoch = (epochs.get(conversationId) ?? 0) + 1;
        epochs.set(conversationId, epoch);
        signal?.throwIfAborted();
        const entries = visibleEntries(store.getConversation(conversationId));
        if (!embed) {
            indexes.delete(conversationId);
            return publish(conversationId, { status: 'keyword-only', count: entries.length });
        }
        publish(conversationId, { status: 'indexing', count: entries.length });
        try {
            const keys = entries.map(entry => contentKey(entry.content));
            const texts = new Map(entries.map((entry, i) => [keys[i], entry.content]));
            const cached = vectorCache.get(conversationId);
            let identity = cached && { model: cached.model, version: cached.version, dimensions: cached.dimensions };
            const found = new Map([...texts.keys()].filter(key => cached?.vectors.has(key)).map(key => [key, cached.vectors.get(key)]));
            let pending = [...texts.keys()].filter(key => !found.has(key)), confirmed = false;
            while (pending.length) {
                const batch = nextBatch(pending, texts);
                const result = checkedEmbedding(await embed({ texts: batch.map(key => texts.get(key)), purpose: 'index', signal }), batch.length);
                if (!identity || !sameEmbedding(identity, result)) {
                    // Reused vectors from another model, version or dimension count are discarded; an index never mixes them.
                    invariant(!confirmed, 'invalid-embedding', 'Embedding model, version or dimensions changed during indexing');
                    identity = { model: result.model, version: result.version, dimensions: result.dimensions };
                    found.clear();
                    pending = [...texts.keys()].filter(key => !batch.includes(key));
                }
                confirmed = true;
                // Completed batches stay reusable even if this run is superseded or aborted below.
                remember(conversationId, result, batch);
                batch.forEach((key, i) => found.set(key, result.vectors[i]));
                signal?.throwIfAborted();
                if (epochs.get(conversationId) !== epoch) return { status: 'superseded', semanticReady: false, count: 0 };
            }
            signal?.throwIfAborted();
            if (epochs.get(conversationId) !== epoch) return { status: 'superseded', semanticReady: false, count: 0 };
            if (signature(entries) !== signature(visibleEntries(store.getConversation(conversationId)))) return invalidate(conversationId);
            const cache = vectorCache.get(conversationId);
            if (cache && identity && sameEmbedding(cache, identity)) for (const key of cache.vectors.keys()) if (!texts.has(key)) cache.vectors.delete(key);
            const embedded = entries.length && identity ? identity : {};
            indexes.set(conversationId, { ...embedded, vectors: keys.map(key => found.get(key)), signature: signature(entries), entries: structuredClone(entries) });
            return publish(conversationId, { status: 'ready', count: entries.length, ...embedded });
        } catch (error) {
            if (epochs.get(conversationId) === epoch) {
                indexes.delete(conversationId);
                publish(conversationId, { status: signal?.aborted ? 'not-ready' : 'error', count: 0,
                    error: { code: signal?.aborted ? 'index-aborted' : 'index-failed', message: 'Semantic index unavailable; keyword retrieval remains available' } });
            }
            throw error;
        }
    }
    async function search(conversationId, query, { limit = 8, snapshot, signal } = {}) {
        signal?.throwIfAborted();
        invariant(typeof query === 'string' && query.trim() && query.length <= 4096, 'invalid-query', 'Search query is empty or too long');
        invariant(Number.isSafeInteger(limit) && limit > 0 && limit <= 100, 'invalid-query', 'Search limit must be 1 to 100');
        snapshot ??= store.getConversation(conversationId);
        invariant((snapshot.conversationId ?? snapshot.conversation.id) === conversationId, 'invalid-snapshot', 'Snapshot belongs to another conversation');
        const entries = visibleEntries(snapshot);
        const allowed = new Set(entries.map(fingerprint));
        const terms = [...new Set(query.toLocaleLowerCase().trim().split(/\s+/u))];
        const candidates = new Map();
        for (const entry of entries) {
            const text = entry.content.toLocaleLowerCase();
            const score = terms.filter(term => text.includes(term)).length / terms.length;
            if (score > 0) candidates.set(fingerprint(entry), { ...entry, score, method: 'keyword' });
        }
        const cached = indexes.get(conversationId);
        if (cached?.entries.length && embed) {
            // A failed or incompatible embedding never removes available keyword results.
            try {
                signal?.throwIfAborted();
                const result = checkedEmbedding(await embed({ texts: [query], purpose: 'query', signal }), 1);
                signal?.throwIfAborted();
                if (result.model === cached.model && result.version === cached.version && result.dimensions === cached.dimensions) {
                    if (cached.signature === signature(visibleEntries(store.getConversation(conversationId)))) publish(conversationId, { status: 'ready', count: cached.entries.length, model: cached.model, version: cached.version, dimensions: cached.dimensions });
                    cached.entries.forEach((entry, i) => {
                        const key = fingerprint(entry);
                        if (!allowed.has(key)) return;
                        const score = cosine(cached.vectors[i], result.vectors[0]);
                        if (score <= 0) return;
                        const prior = candidates.get(key);
                        candidates.set(key, { ...entry, score: Math.max(score, prior?.score ?? 0), method: prior ? 'hybrid' : 'vector' });
                    });
                } else {
                    vectorCache.delete(conversationId);
                    publish(conversationId, { status: 'error', count: cached.entries.length, error: { code: 'embedding-mismatch', message: 'Embedding model, version or dimensions changed; rebuild the semantic index' } });
                }
            } catch (error) {
                signal?.throwIfAborted();
                if (error?.name === 'AbortError') throw error;
                publish(conversationId, { status: 'error', count: cached.entries.length, error: { code: 'query-embedding-failed', message: 'Semantic query failed; using keyword results' } });
            }
        }
        // Re-read AFTER asynchronous embedding: edits, deletes, candidate switches and manual
        // memory revisions must not leak even if an old snapshot/index is still in memory.
        signal?.throwIfAborted();
        const currentEntries = visibleEntries(store.getConversation(conversationId));
        const current = new Set(currentEntries.map(fingerprint));
        if (cached && cached.signature !== signature(currentEntries)) publish(conversationId, { status: 'stale', count: cached.entries.length });
        const seen = new Set();
        return [...candidates.entries()].filter(([key]) => current.has(key))
            .map(([, entry]) => entry).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
            .filter(entry => { const key = canonicalJson([entry.sourceRefs, entry.content]); if (seen.has(key)) return false; seen.add(key); return true; })
            .slice(0, limit).map(({ key, content, sourceRefs, score, method }) => ({ key, kind: key.startsWith('message:') ? 'message' : 'derived', status: 'valid', content, sourceRefs: structuredClone(sourceRefs), score, method }));
    }
    return { search, index, status, invalidate, rebuild(conversationId) { vectorCache.delete(conversationId); invalidate(conversationId); return index(conversationId); } };
}
