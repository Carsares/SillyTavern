import { computeBudget, groupHistory } from '../../../public/shared/conversation/policy/index.js';
import { invariant, sourceRef } from '../../../public/shared/conversation/schemas/index.js';

export const SUMMARY_PROMPT_RESERVE = 2048;
/** The composition layer must select the same frozen memory connection. */
export function auxiliaryBudget(snapshot) {
    const connections = (snapshot.resources ?? []).filter(r => r.kind === 'connection');
    const selected = snapshot.settings?.auxiliaryConnectionId ?? snapshot.settings?.connectionId;
    const connection = selected != null ? connections.find(r => r.id === selected) : connections.length === 1 ? connections[0] : undefined;
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
