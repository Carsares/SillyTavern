import { ProtocolError, sourceRef } from '../schemas/index.js';

export const BUDGET_DEFAULTS = Object.freeze({ workingBudget: 65536, compressionRatio: 0.5, recentMessages: 20, recentTokens: 16384 });

export function computeBudget({ contextWindow, inputLimit = contextWindow, maxOutputTokens, workingBudget = BUDGET_DEFAULTS.workingBudget }) {
    for (const [name, value] of Object.entries({ contextWindow, inputLimit, maxOutputTokens, workingBudget })) {
        if (!Number.isSafeInteger(value) || value <= 0) throw new ProtocolError('invalid-budget', `${name} must be a positive safe integer`);
    }
    const safetyTokens = Math.max(256, Math.ceil(Math.min(inputLimit, contextWindow) * 0.02));
    const hardInputBudget = Math.min(inputLimit, contextWindow - maxOutputTokens) - safetyTokens;
    if (hardInputBudget <= 0) throw new ProtocolError('invalid-budget', 'Output and safety reserves leave no input budget');
    return { hardInputBudget, workingBudget: Math.min(workingBudget, hardInputBudget), safetyTokens };
}

export const sourceKey = ref => JSON.stringify([ref.messageId, ref.revision, ref.candidateId ?? null, ref.candidateRevision ?? null]);
export const uniqueSources = refs => [...new Map(refs.map(ref => [sourceKey(ref), { ...ref }])).values()];

/** Resolve transitive summary dependencies; stale parents and cycles invalidate a block. */
export function resolveSources(block, snapshot, visiting = new Set()) {
    if (block.status !== 'valid' || visiting.has(block)) return null;
    const path = new Set(visiting).add(block);
    const refs = [...(block.sourceRefs ?? [])];
    for (const parent of block.parentSummaryRefs ?? []) {
        const summary = (snapshot.summaries ?? []).find(item => item.id === parent.id && item.revision === parent.revision);
        const inherited = summary && resolveSources(summary, snapshot, path);
        if (!inherited) return null;
        refs.push(...inherited);
    }
    const current = new Map((snapshot.messages ?? []).filter(message => !message.deletedAt && !message.userHidden).map(message => [message.id, sourceKey(sourceRef(message))]));
    if (refs.some(ref => current.get(ref.messageId) !== sourceKey(ref))) return null;
    return uniqueSources(refs);
}

/** User/assistant/tool messages in one turn are indivisible. Missing turn IDs start at user messages. */
export function groupHistory(messages) {
    const groups = [];
    const seen = new Set();
    for (const message of messages) {
        const previous = groups.at(-1);
        const same = previous && (message.turnId ? previous.id === message.turnId : !previous.explicit && message.role !== 'user');
        if (same) previous.messages.push(message);
        else {
            const id = message.turnId ?? `message:${message.id}`;
            if (seen.has(id)) throw new ProtocolError('invalid-history', 'Turn messages must be contiguous');
            seen.add(id);
            groups.push({ id, explicit: Boolean(message.turnId), messages: [message] });
        }
    }
    for (const group of groups) {
        const pending = new Set();
        const calls = new Set();
        for (const message of group.messages) {
            for (const call of message.toolCalls ?? []) {
                if (message.role !== 'assistant' || !call.id || calls.has(call.id)) throw new ProtocolError('invalid-tool-group', 'Invalid or duplicate tool call');
                calls.add(call.id);
                pending.add(call.id);
            }
            if (message.role === 'tool') {
                if (!pending.delete(message.toolCallId)) throw new ProtocolError('invalid-tool-group', 'Tool result must follow its call in the same turn');
            }
        }
        group.open = pending.size > 0;
        group.complete = !group.open && group.messages.some(message => message.role === 'assistant' && message.status === 'completed');
    }
    return groups;
}

export function compressibleSources(groups) {
    const lastComplete = groups.findLastIndex(group => group.complete);
    return uniqueSources(groups.filter((group, index) => !group.open && index !== lastComplete && index !== groups.length - 1)
        .flatMap(group => group.messages.map(sourceRef)));
}
