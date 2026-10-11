import { canonicalJson, sourceRef } from '../../../public/shared/conversation/schemas/index.js';

export function uniqueRefs(refs) {
    return [...new Map(refs.map(ref => [canonicalJson(ref), structuredClone(ref)])).values()];
}

export function sourcesValid(refs, snapshot) {
    return Array.isArray(refs) && refs.every(ref => snapshot.messages.some(message =>
        !message.deletedAt && !message.userHidden && message.id === ref.messageId && canonicalJson(sourceRef(message)) === canonicalJson(ref)));
}

export function resourceRefs(snapshot) {
    return uniqueRefs((snapshot.resources ?? []).map(({ id, revision }) => ({ id, revision })));
}

export function resourcesValid(refs = [], snapshot) {
    return Array.isArray(refs) && refs.every(ref => (snapshot.resources ?? []).some(resource =>
        resource.id === ref.id && resource.revision === ref.revision));
}

/** Include transitive sources; cycles and missing/stale parents fail closed. */
export function derivedSources(block, snapshot, visiting = new Set()) {
    if (block.status !== 'valid' || visiting.has(block.id) || !sourcesValid(block.sourceRefs, snapshot) || !resourcesValid(block.resourceRefs, snapshot)) return null;
    const next = new Set(visiting).add(block.id);
    const refs = [...block.sourceRefs];
    for (const parent of block.parentSummaryRefs ?? []) {
        const summary = snapshot.summaries.find(item => item.id === parent.id && item.revision === parent.revision);
        const inherited = summary && derivedSources(summary, snapshot, next);
        if (!inherited) return null;
        refs.push(...inherited);
    }
    return uniqueRefs(refs);
}

export function searchableEntries(snapshot) {
    const messages = snapshot.messages.filter(m => !m.deletedAt && !m.userHidden && (!m.status || m.status === 'completed'))
        .map(m => ({ key: `message:${m.id}`, content: m.content, sourceRefs: [sourceRef(m)] }));
    const derived = [...(snapshot.summaries ?? []), ...(snapshot.memories ?? [])].flatMap(block => {
        const refs = derivedSources(block, snapshot);
        return refs ? [{ key: `derived:${block.id}`, revision: block.revision, content: block.content, sourceRefs: refs }] : [];
    });
    return [...messages, ...derived].filter(item => typeof item.content === 'string' && item.content.trim());
}

/** Snapshot order is commit order. Keep only the latest valid rolling summary,
 * plus chapters not fully represented by that rolling summary/newer chapters. */
export function summaryParents(snapshot) {
    const valid = (snapshot.summaries ?? []).filter(summary => derivedSources(summary, snapshot));
    const rolling = valid.filter(summary => summary.kind === 'rolling').at(-1);
    const covered = new Set((rolling ? derivedSources(rolling, snapshot) : []).map(canonicalJson));
    const chapters = [];
    for (const chapter of valid.filter(summary => summary.kind === 'chapter').reverse()) {
        const refs = derivedSources(chapter, snapshot);
        if (refs.length && refs.every(ref => covered.has(canonicalJson(ref)))) continue;
        chapters.unshift(chapter);
        refs.forEach(ref => covered.add(canonicalJson(ref)));
    }
    return [...(rolling ? [rolling] : []), ...chapters];
}
