import { refOf } from './dataset.mjs';
import { canonicalJson } from '../../../public/shared/conversation/schemas/index.js';

/** Build a NEW-store backup containing only selected synthetic evidence. No old user data.
 * Identifiers stay unchanged so generated citations can be scored without remapping. */
export function seedBackup(empty, snapshot, connections, { workingBudget, tools = [], memoryFrequency = 5, instruction }) {
    const data = structuredClone(empty), cid = snapshot.conversationId ?? snapshot.conversation.id;
    const resources = connections.map((connection, i) => ({ id: `eval-connection-${i}`, revision: 1, kind: 'connection', name: `Evaluation ${i}`, data: { ...connection,
        workingBudget: Math.min(connection.role === 'primary' ? workingBudget : Infinity, connection.workingBudget ?? workingBudget, connection.contextWindow - (connection.maxOutputTokens ?? 0)) } }));
    resources.push({ id: 'eval-preset', revision: 1, kind: 'preset', name: 'Evaluation facts', data: { system: instruction } });
    const settings = { worldInfo: { turnIndex: new Set(snapshot.messages.map(m => m.turnId)).size }, connectionId: resources[0].id, presetId: 'eval-preset', tools, memoryFrequency,
        ...(connections.findIndex(c => c.role === 'memory') >= 0 ? { auxiliaryConnectionId: resources[connections.findIndex(c => c.role === 'memory')].id } : {}),
        ...(connections.findIndex(c => c.role === 'embedding') >= 0 ? { embeddingConnectionId: resources[connections.findIndex(c => c.role === 'embedding')].id } : {}) };
    const refs = resources.map(({ id, revision }) => ({ id, revision }));
    const conversation = { ...structuredClone(snapshot.conversation), id: cid, title: 'Synthetic evaluation', activeTurnId: null, settings, resourceRefs: refs, explicitResourceRefs: [], createdAt: '2026-01-01T00:00:00.000Z' };
    data.conversations[cid] = conversation;
    for (const r of resources) data.resources[r.id] = { revision: 1, versions: { 1: r } };
    let turnIndex = 0;
    for (const message of snapshot.messages) {
        const m = { ...structuredClone(message), conversationId: cid, content: `[sourceRef ${JSON.stringify(refOf(message))}]\n${message.content}` };
        data.messages[m.id] = { ...m, versions: [structuredClone(m)] };
        if (!data.turns[m.turnId]) {
            const request = { schemaVersion: 1, type: 'send', clientRequestId: `seed-${m.turnId}`, expectedContentRevision: 0, content: 'Imported synthetic turn' };
            data.turns[m.turnId] = { id: m.turnId, conversationId: cid, type: 'send', clientRequestId: request.clientRequestId, request, payloadHash: canonicalJson(request),
                snapshotId: 'eval-seed-snapshot', turnIndex: turnIndex++, pendingEffects: [], status: 'completed', attemptEpoch: 1, content: '', reasoning: '', cancelRequested: false, usage: null };
        }
    }
    for (const kind of ['summaries', 'memories', 'folds']) for (const block of snapshot[kind] ?? []) data[kind][block.id] = { ...structuredClone(block), conversationId: cid, content: `[sourceRefs ${JSON.stringify(block.sourceRefs)}]\n${block.content}` };
    data.snapshots['eval-seed-snapshot'] = { ...structuredClone(snapshot), id: 'eval-seed-snapshot', conversationId: cid, conversation, settings, resources, messages: Object.values(data.messages).map(({ versions, ...message }) => message),
        ...Object.fromEntries(['summaries', 'memories', 'folds'].map(kind => [kind, Object.values(data[kind])])) };
    data.events[cid] = [];
    return data;
}
