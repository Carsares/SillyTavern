import { computeBudget, groupHistory, BUDGET_DEFAULTS } from '../../../public/shared/conversation/policy/index.js';
import { invariant, sourceRef } from '../../../public/shared/conversation/schemas/index.js';

export const SUMMARY_PROMPT_RESERVE = 2048;
/** The composition layer must select the same frozen memory connection. */
export function auxiliaryBudget(snapshot) {
    const connections = (snapshot.resources ?? []).filter(r => r.kind === 'connection');
    const settings = snapshot.settings ?? snapshot.conversation?.settings ?? {};
    const primary = connections.find(r => r.id === settings.connectionId);
    let selected = settings.auxiliaryConnectionId;
    if (!selected) {
        const auxiliary = primary?.data?.auxiliary ?? {};
        for (const role of ['memory', 'summary', 'summarization']) {
            const value = auxiliary[role];
            if (typeof value === 'string' && value) { selected = value; break; }
            if (value?.connectionId) { selected = value.connectionId; break; }
        }
        selected ||= settings.connectionId;
    }
    const connection = connections.find(r => r.id === selected);
    invariant(connection, 'budget-blocked', 'A frozen memory connection with finite limits is required', 409);
    return { ...computeBudget(connection.data), connectionId: connection.id };
}

export function selectBatch(snapshot, messages, { summaries, memories, sourceRefs, resourceRefs }) {
    const budget = auxiliaryBudget(snapshot);
    const fixed = { summaries, memories, sourceRefs, resourceRefs };
    const measure = items => SUMMARY_PROMPT_RESERVE + Buffer.byteLength(JSON.stringify({ ...fixed, messages: items,
        sourceRefs: [...sourceRefs, ...items.map(sourceRef)] }), 'utf8');
    const selected = [];
    for (const group of groupHistory(messages)) {
        if (!group.complete) continue;
        const candidate = [...selected, ...group.messages];
        if (measure(candidate) > budget.workingBudget) break;
        selected.push(...group.messages);
    }
    invariant(selected.length > 0, 'budget-blocked', 'The earliest complete turn and summary dependencies exceed the auxiliary input budget', 409,
        { budget, reservedTokens: SUMMARY_PROMPT_RESERVE });
    return { messages: selected, budget, estimatedInputTokens: measure(selected) };
}

/** Preferences never split turns; the most recent complete turn is mandatory. */
export function compressionPolicy(snapshot, messages) {
    const groups = groupHistory(messages).filter(group => group.complete);
    const primary = snapshot.resources.find(r => r.id === snapshot.settings?.connectionId && r.kind === 'connection');
    const workingBudget = computeBudget(primary?.data ?? {}).workingBudget;
    const targetTokens = Math.floor(workingBudget * BUDGET_DEFAULTS.compressionRatio);
    const bytes = items => Buffer.byteLength(items.map(m => m.content ?? '').join(''), 'utf8');
    const reasons = [];
    let retained = [], count = 0;
    for (const group of [...groups].reverse()) {
        if (retained.length && (count >= BUDGET_DEFAULTS.recentMessages || bytes([...group.messages, ...retained.flatMap(g => g.messages)]) > BUDGET_DEFAULTS.recentTokens)) break;
        retained.unshift(group); count += group.messages.length;
    }
    if (count < BUDGET_DEFAULTS.recentMessages) reasons.push('recent-message-preference-exceeds-available-history-or-token-cap');
    if (bytes(retained.flatMap(g => g.messages)) > BUDGET_DEFAULTS.recentTokens) reasons.push('latest-complete-turn-exceeds-recent-token-preference');
    // If all history falls inside the preferred suffix, or the suffix alone is
    // over the target, release oldest complete turns while always keeping one.
    if (retained.length === groups.length && groups.length > 1) {
        retained = retained.slice(1);
        reasons.push('recent-message-preference-relaxed-to-allow-progress');
    }
    while (retained.length > 1 && bytes(retained.flatMap(g => g.messages)) > targetTokens) {
        retained.shift();
        if (!reasons.includes('recent-preference-exceeds-compression-target')) reasons.push('recent-preference-exceeds-compression-target');
    }
    const keep = new Set(retained.map(g => g.id));
    return { messages: groups.filter(g => !keep.has(g.id)).flatMap(g => g.messages),
        policy: { compressionRatio: BUDGET_DEFAULTS.compressionRatio, targetTokens, recentMessages: BUDGET_DEFAULTS.recentMessages, recentTokens: BUDGET_DEFAULTS.recentTokens,
            retainedMessageIds: retained.flatMap(g => g.messages.map(m => m.id)),
            retainedEstimatedTokens: bytes(retained.flatMap(g => g.messages)), relaxReasons: reasons,
            estimateMethod: 'utf8-bytes-upper-bound' } };
}
