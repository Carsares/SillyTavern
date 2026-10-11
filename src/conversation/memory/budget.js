import { computeBudget, groupHistory, BUDGET_DEFAULTS } from '../../../public/shared/conversation/policy/index.js';
import { invariant } from '../../../public/shared/conversation/schemas/index.js';

import { estimateTokens } from '../../../public/shared/conversation/tokens/index.js';

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

export function selectBatch(snapshot, messages, { summaries, memories, compressionPolicy }) {
    const budget = auxiliaryBudget(snapshot);
    // Match composition.generateMemory's model-visible payload. Top-level
    // sourceRefs/resourceRefs are local proposal provenance, not prompt text.
    // Count the JSON payload inside a chat message: quotes/backslashes are
    // escaped again by the request serializer. Never drop protected memories.
    const measure = items => SUMMARY_PROMPT_RESERVE + estimateTokens({ mode: 'chat', tools: [], messages: [
        { role: 'system', content: '' },
        { role: 'user', content: JSON.stringify({ messages: items, summaries, memories, compressionPolicy }) },
    ] });
    const groups = groupHistory(messages).filter(group => group.complete);
    const fixedEstimatedTokens = measure([]);
    const minimumBatchEstimatedTokens = groups.length ? measure(groups[0].messages) : fixedEstimatedTokens;
    invariant(groups.length && minimumBatchEstimatedTokens <= budget.workingBudget, 'budget-blocked',
        'The earliest complete turn and summary dependencies exceed the auxiliary input budget', 409,
        { stage: 'auxiliary-batch', reason: fixedEstimatedTokens > budget.workingBudget ? 'fixed-context-over-budget' : 'complete-turn-over-budget',
            budget, reservedTokens: SUMMARY_PROMPT_RESERVE, fixedEstimatedTokens, minimumBatchEstimatedTokens,
            earliestTurnMessageCount: groups[0]?.messages.length ?? 0 });
    // Serialized size is monotone for successive whole-turn prefixes. Binary
    // search avoids repeatedly serializing the whole history for every turn.
    let low = 1, high = groups.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (measure(groups.slice(0, middle).flatMap(group => group.messages)) <= budget.workingBudget) low = middle;
        else high = middle - 1;
    }
    const selected = groups.slice(0, low).flatMap(group => group.messages);
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
