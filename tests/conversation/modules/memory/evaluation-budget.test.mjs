// Offline regression using the full synthetic evaluation dataset; no credentials,
// network, SDK processes or provider calls are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDataset } from '../../evaluation/dataset.mjs';
import { seedBackup } from '../../evaluation/seed.mjs';
import { createMemoryService } from '../../../../src/conversation/memory/index.js';
import { compileContext } from '../../../../public/shared/conversation/assembly/index.js';

const config = JSON.parse(readFileSync(new URL('../../evaluation/config.deepseek.example.json', import.meta.url))).executors.pi;
const dataset = createDataset();
function snapshotFor(workingBudget, independent = true) {
    const connection = { ...config.connection, role: 'primary', executor: 'native', type: 'chat' };
    const connections = [connection, ...(independent ? [{ ...config.memoryConnection, role: 'memory', executor: 'native', type: 'chat' }] : [])];
    const empty = { schemaVersion: 1, ...Object.fromEntries(['conversations', 'resources', 'messages', 'turns', 'snapshots', 'summaries', 'memories', 'folds', 'jobs', 'tools', 'traces', 'attachments', 'events'].map(k => [k, {}])) };
    const backup = seedBackup(empty, dataset.snapshot, connections, { workingBudget, tools: [], memoryFrequency: 5, instruction: 'Offline evaluation' });
    return backup.snapshots['eval-seed-snapshot'];
}
const storeFor = snapshot => ({ getTurn: () => ({ status: 'completed' }), getConversation: () => structuredClone(snapshot) });

test('shared 32k auxiliary budget legitimately blocks all 160 locked memories before generation with exact diagnostics', async () => {
    const snapshot = snapshotFor(32768, false); let calls = 0;
    const service = createMemoryService({ store: storeFor(snapshot), generate: async () => { calls++; } });
    await assert.rejects(service.prepareCompact(snapshot), error => {
        assert.equal(error.code, 'budget-blocked'); assert.equal(error.details.reason, 'fixed-context-over-budget');
        assert.equal(error.details.budget.workingBudget, 32768);
        assert.ok(error.details.fixedEstimatedTokens > 32768);
        assert.ok(error.details.minimumBatchEstimatedTokens > error.details.fixedEstimatedTokens);
        return true;
    });
    assert.equal(snapshot.memories.length, 160); assert.ok(snapshot.memories.every(m => m.locked)); assert.equal(calls, 0);
});

for (const workingBudget of [32768, 65536, 131072]) test(`full dataset ${workingBudget}: two bounded batches retain locked memories and count escaped auxiliary JSON`, async t => {
    const initial = snapshotFor(workingBudget), before = structuredClone(initial); const requests = [];
    const service = createMemoryService({ store: storeFor(initial), generate: async input => {
        const connection = input.snapshot.resources.find(r => r.id === input.inputBudget.connectionId);
        const auxiliary = { ...input.snapshot, settings: { connectionId: connection.id, presetId: 'summary-preset' },
            resources: [connection, { id: 'summary-preset', kind: 'preset', data: { system: 'Summarize facts. '.repeat(40) } }],
            messages: [{ id: 'auxiliary', role: 'user', content: JSON.stringify({ messages: input.messages, summaries: input.summaries, memories: input.memories, compressionPolicy: input.compressionPolicy }) }],
            summaries: [], memories: [], folds: [],
        };
        const plan = compileContext(auxiliary, { type: 'auxiliary', workingBudget: input.inputBudget.workingBudget });
        assert.ok(plan.estimatedTokens <= input.estimatedInputTokens, 'batch bound includes request serialization and policy overhead');
        assert.ok(input.estimatedInputTokens <= 950000);
        assert.deepEqual(input.memories, initial.memories);
        requests.push({ messages: input.messages.length, estimated: input.estimatedInputTokens, actual: plan.estimatedTokens });
        return { chapter: 'Offline short chapter', rolling: 'Offline short rolling' };
    } });
    const first = await service.prepareCompact(initial), second = await service.prepareCompact(first.snapshot);
    const proposal = service.combineProposals([first.proposal, second.proposal], initial);
    const preview = service.previewCompact(initial, proposal);
    const folded = new Set(proposal.folds.flatMap(f => f.sourceRefs.map(r => r.messageId)));
    assert.ok(folded.size >= initial.messages.length - 21, 'only the preferred recent complete-turn suffix remains');
    assert.deepEqual(initial, before); assert.deepEqual(preview.memories, initial.memories);
    let final;
    try { final = { fits: true, estimated: compileContext(preview, { workingBudget }).estimatedTokens }; }
    catch (error) { assert.equal(error.code, 'budget-blocked'); final = { fits: false, estimated: error.details.estimatedTokens }; }
    t.diagnostic(JSON.stringify({ workingBudget, requests, folded: folded.size, final }));
});
