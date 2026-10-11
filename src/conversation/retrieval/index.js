import { invariant, canonicalJson } from '../../../public/shared/conversation/schemas/index.js';
import { searchableEntries } from '../memory/sources.js';

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
const fingerprint = entry => canonicalJson([entry.key, entry.revision, entry.content, entry.sourceRefs]);

/** Derived index stays in memory; never opens old data paths or writes files. */
export function createRetrieval({ store, embed }) {
    const indexes = new Map();
    const epochs = new Map();
    async function index(conversationId, { signal } = {}) {
        const epoch = (epochs.get(conversationId) ?? 0) + 1;
        epochs.set(conversationId, epoch);
        signal?.throwIfAborted();
        const entries = searchableEntries(store.getConversation(conversationId));
        if (!embed || !entries.length) {
            indexes.delete(conversationId);
            return { status: embed ? 'ready' : 'keyword-only', count: entries.length };
        }
        const result = checkedEmbedding(await embed({ texts: entries.map(e => e.content), purpose: 'index', signal }), entries.length);
        signal?.throwIfAborted();
        if (epochs.get(conversationId) !== epoch) return { status: 'superseded', count: 0 };
        indexes.set(conversationId, { ...result, entries: structuredClone(entries) });
        return { status: 'ready', count: entries.length, model: result.model, version: result.version, dimensions: result.dimensions };
    }
    async function search(conversationId, query, { limit = 8, snapshot, signal } = {}) {
        signal?.throwIfAborted();
        invariant(typeof query === 'string' && query.trim() && query.length <= 4096, 'invalid-query', 'Search query is empty or too long');
        invariant(Number.isSafeInteger(limit) && limit > 0 && limit <= 100, 'invalid-query', 'Search limit must be 1 to 100');
        snapshot ??= store.getConversation(conversationId);
        invariant((snapshot.conversationId ?? snapshot.conversation.id) === conversationId, 'invalid-snapshot', 'Snapshot belongs to another conversation');
        const entries = searchableEntries(snapshot);
        const allowed = new Set(entries.map(fingerprint));
        const terms = [...new Set(query.toLocaleLowerCase().trim().split(/\s+/u))];
        const candidates = new Map();
        for (const entry of entries) {
            const text = entry.content.toLocaleLowerCase();
            const score = terms.filter(term => text.includes(term)).length / terms.length;
            if (score > 0) candidates.set(fingerprint(entry), { ...entry, score, method: 'keyword' });
        }
        const cached = indexes.get(conversationId);
        if (cached && embed) {
            // A failed or incompatible embedding never removes available keyword results.
            try {
                signal?.throwIfAborted();
                const result = checkedEmbedding(await embed({ texts: [query], purpose: 'query', signal }), 1);
                signal?.throwIfAborted();
                if (result.model === cached.model && result.version === cached.version && result.dimensions === cached.dimensions) {
                    cached.entries.forEach((entry, i) => {
                        const key = fingerprint(entry);
                        if (!allowed.has(key)) return;
                        const score = cosine(cached.vectors[i], result.vectors[0]);
                        if (score <= 0) return;
                        const prior = candidates.get(key);
                        candidates.set(key, { ...entry, score: Math.max(score, prior?.score ?? 0), method: prior ? 'hybrid' : 'vector' });
                    });
                }
            } catch (error) {
                signal?.throwIfAborted();
                if (error?.name === 'AbortError') throw error;
                // Ordinary embedding failures retain keyword results; cancellation does not.
            }
        }
        // Re-read AFTER asynchronous embedding: edits, deletes, candidate switches and manual
        // memory revisions must not leak even if an old snapshot/index is still in memory.
        signal?.throwIfAborted();
        const current = new Set(searchableEntries(store.getConversation(conversationId)).map(fingerprint));
        const seen = new Set();
        return [...candidates.entries()].filter(([key]) => current.has(key))
            .map(([, entry]) => entry).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
            .filter(entry => { const key = canonicalJson([entry.sourceRefs, entry.content]); if (seen.has(key)) return false; seen.add(key); return true; })
            .slice(0, limit).map(({ content, sourceRefs, score, method }) => ({ content, sourceRefs: structuredClone(sourceRefs), score, method }));
    }
    return { search, index, rebuild(conversationId) { indexes.delete(conversationId); return index(conversationId); } };
}
