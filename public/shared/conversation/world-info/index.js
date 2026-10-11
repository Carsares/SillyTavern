import { ProtocolError } from '../schemas/index.js';

export const WORLD_INFO_DEFAULTS = Object.freeze({ scanDepth: 20, maxRecursion: 4, entries: Object.freeze([]) });
export const WORLD_ENTRY_DEFAULTS = Object.freeze({ enabled: true, keys: Object.freeze([]), secondaryKeys: Object.freeze([]),
    secondaryMode: 'any', constant: false, recursive: true, caseSensitive: false, matchWholeWords: false, probability: 100,
    group: '', priority: 0, required: false, role: 'system', placement: Object.freeze({ type: 'prefix' }), cooldown: 0, duration: 0, content: '' });

/** Stable per-entry draw: omitting a sibling entry does not change this entry's probability. */
export function seededValue(seed, key) {
    let hash = 2166136261;
    for (const char of `${seed}:${key}`) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
    return (hash >>> 0) / 4294967296;
}

const order = (a, b) => b.priority - a.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function selectWorldInfo(worldbooks, { history = [], seed = 0, turnIndex = 0, state = {} } = {}) {
    if (!Number.isSafeInteger(turnIndex) || turnIndex < 0) throw new ProtocolError('invalid-worldbook', 'turnIndex must be nonnegative');
    const candidates = [];
    const ids = new Set();
    for (const book of worldbooks) {
        const data = { ...WORLD_INFO_DEFAULTS, ...book.data };
        if (!Number.isSafeInteger(data.scanDepth) || data.scanDepth < 0 || !Number.isSafeInteger(data.maxRecursion) || data.maxRecursion < 0 || data.maxRecursion > 32) {
            throw new ProtocolError('invalid-worldbook', 'Invalid scanDepth or maxRecursion (0..32)');
        }
        for (const raw of data.entries) {
            const entry = { ...WORLD_ENTRY_DEFAULTS, ...raw, key: `${book.id}:${raw.id}`, bookId: book.id, bookRevision: book.revision };
            if (!raw.id || ids.has(entry.key)) throw new ProtocolError('invalid-worldbook', 'Entries require unique IDs within each worldbook');
            ids.add(entry.key);
            if (!entry.enabled) continue;
            if (!Array.isArray(entry.keys) || !Array.isArray(entry.secondaryKeys) || [...entry.keys, ...entry.secondaryKeys].some(key => typeof key !== 'string' || !key.length)
                || !['any', 'all', 'none'].includes(entry.secondaryMode) || typeof entry.content !== 'string' || typeof entry.matchWholeWords !== 'boolean'
                || !Number.isFinite(entry.priority) || !Number.isFinite(entry.probability) || entry.probability < 0 || entry.probability > 100
                || ![entry.cooldown, entry.duration].every(value => Number.isSafeInteger(value) && value >= 0)) {
                throw new ProtocolError('invalid-worldbook', `Invalid worldbook entry ${entry.key}`);
            }
            const previous = state[entry.key];
            // Resource edits invalidate old timing effects, just like other frozen dependencies.
            const timing = previous?.bookRevision === book.revision ? previous : undefined;
            const active = timing && turnIndex < timing.activeUntil;
            if (!active && timing && turnIndex < timing.nextEligibleTurn) continue;
            const text = data.scanDepth === 0 ? '' : history.slice(-data.scanDepth).join('\n');
            candidates.push({ ...entry, active: Boolean(active), timing, previous, text, maxRecursion: data.maxRecursion });
        }
    }
    const selected = [];
    const groups = new Set();
    const picked = new Set();
    const maxRecursion = Math.max(0, ...candidates.map(entry => entry.maxRecursion));
    for (let round = 0; round <= maxRecursion; round++) {
        const additions = [];
        const recursiveText = selected.map(entry => entry.content).join('\n');
        for (const entry of candidates.filter(entry => !picked.has(entry.key)).sort(order)) {
            if (round > entry.maxRecursion || (round > 0 && !entry.recursive) || (entry.group && groups.has(entry.group))) continue;
            const normalize = text => entry.caseSensitive ? text : text.toLocaleLowerCase('en-US');
            const haystack = normalize(entry.text + (round > 0 ? `\n${recursiveText}` : ''));
            const match = key => {
                const needle = normalize(key);
                // Preserve literal workspace matching: multiword phrases use substring matching.
                if (!entry.matchWholeWords || needle.split(/\s+/).length > 1) return haystack.includes(needle);
                const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`).test(haystack);
            };
            const secondary = !entry.secondaryKeys.length || (entry.secondaryMode === 'all' ? entry.secondaryKeys.every(match)
                : entry.secondaryMode === 'none' ? !entry.secondaryKeys.some(match) : entry.secondaryKeys.some(match));
            if (!entry.active && !(entry.constant || (entry.keys.some(match) && secondary))) continue;
            if (!entry.active && seededValue(`${seed}:${turnIndex}`, entry.key) * 100 >= entry.probability) continue;
            picked.add(entry.key);
            if (entry.group) groups.add(entry.group);
            additions.push({ ...entry, activationRound: round });
        }
        if (!additions.length) break;
        selected.push(...additions);
    }
    return { entries: selected.map(entry => ({ ...entry })), effects: selected.filter(entry => !entry.active).map(entry => ({
        type: 'worldbook.activate', key: entry.key, entryId: entry.id, bookId: entry.bookId, bookRevision: entry.bookRevision,
        previous: entry.previous ? { ...entry.previous } : null,
        value: { bookRevision: entry.bookRevision, activatedTurn: turnIndex, activeUntil: turnIndex + Math.max(1, entry.duration),
            nextEligibleTurn: turnIndex + Math.max(1, entry.duration) + entry.cooldown },
    })) };
}
