import test from 'node:test';
import assert from 'node:assert/strict';
import { createDataset, validateDataset, publicInput, CATEGORIES } from './dataset.mjs';
import { scoreAnswers, summarizeMeasurements } from './scorer.mjs';
import { evaluationMatrix, runEvaluation, validateRunConfig } from './runner.mjs';

const dataset = createDataset();
const oracle = questions => ({ answers: questions.map(q => ({ id: q.id, answer: q.expected, sourceRefs: structuredClone(q.sourceRefs) })) });
const config = { allowPaid: true, batchSize: 200, budget: { maxCostUsd: 10, maxRequests: 1000, maxInputTokens: 10000000, maxOutputTokens: 1000000, deadlineMs: 100000 } };
const quote = { hardUpperBound: true, maxCostUsd: 0.01, maxInputTokens: 1000, maxOutputTokens: 100, maxRequests: 1 };
const capability = executor => ({ executor, verified: true, model: 'unit-test-only', modelVersion: 'fake-v1', contextWindow: 1000000, maxOutputTokens: 1000, budgets: ['32k', '64k', '128k', 'full'], cacheControl: true });
const mockAdapter = (executor, changes = {}) => ({ capabilities: capability(executor), quote: async () => quote,
    run: async request => {
        const questions = dataset.questions.filter(q => request.questions.some(input => input.id === q.id));
        return { output: oracle(questions), usage: { complete: true, costUsd: 0.001, inputTokens: 500, outputTokens: 50, providerRequests: 1 },
            cache: { mode: request.condition.cache, verified: true, sessionKey: request.condition.sessionKey } };
    }, ...changes });

test('synthetic dataset has 1600 questions, over 1500 messages and complete provenance/categories', () => {
    const result = validateDataset(dataset); assert.equal(result.status, 'passed'); assert.equal(result.questions, 1600); assert.ok(result.messages >= 1500);
    assert.equal(createDataset().fingerprint, dataset.fingerprint);
    for (const category of CATEGORIES) assert.equal(dataset.questions.filter(q => q.category === category).length, 160);
    assert.ok(dataset.snapshot.memories.every(m => m.locked && m.origin === 'manual'));
});
test('provider projection never contains answers, archives or mutation history', () => {
    const input = publicInput(dataset);
    assert.deepEqual(Object.keys(input.questions[0]), ['id', 'prompt']);
    assert.equal(input.archivedMessages, undefined); assert.equal(input.mutations, undefined);
    assert.ok(!JSON.stringify(input).includes('旧地-')); assert.ok(!JSON.stringify(input).includes('unselected-'));
});
test('integrity check catches invalid source and accidentally exposed deleted facts', () => {
    const bad = structuredClone(dataset); bad.questions[0].sourceRefs[0].revision = 900;
    assert.equal(validateDataset(bad).status, 'failed');
    bad.snapshot.messages.push(bad.archivedMessages.find(m => m.deletedAt));
    assert.ok(validateDataset(bad).errors.some(e => e.startsWith('stale-answer-visible:')));
});
test('72 conditions cover four budgets, three executors, cold/warm and three repeats', () => {
    const plan = evaluationMatrix(); assert.equal(plan.length, 72); assert.equal(new Set(plan.map(c => c.id)).size, 72);
    for (let i = 0; i < plan.length; i += 2) { assert.equal(plan[i].cache, 'cold'); assert.equal(plan[i + 1].cache, 'warm'); assert.equal(plan[i].sessionKey, plan[i + 1].sessionKey); }
});
test('exact oracle is only a scorer fixture, not provider quality evidence', () => {
    const score = scoreAnswers(dataset.questions, oracle(dataset.questions));
    assert.equal(score.accuracy, 1); assert.equal(score.staleLeaks, 0); assert.equal(score.gate, 'passed');
});
test('missing, malformed and duplicate answers cannot pass on an empty denominator', () => {
    const qs = dataset.questions.slice(0, 10);
    for (const output of ['invalid json', { answers: [] }, { answers: [oracle(qs).answers[0], oracle(qs).answers[0]] }]) {
        const score = scoreAnswers(qs, output); assert.equal(score.complete, false); assert.equal(score.gate, 'failed'); assert.ok(score.accuracy < 1);
    }
    assert.equal(scoreAnswers([], { answers: [] }).gate, 'failed');
});
test('negated substring answers, invented facts and wrong citations are rejected', () => {
    const qs = dataset.questions.slice(0, 3); const answer = oracle(qs);
    answer.answers[0].answer = `不是${qs[0].expected}`;
    answer.answers[1].sourceRefs[0].revision++;
    answer.answers[2].answer = '虚构之地';
    const score = scoreAnswers(qs, answer); assert.equal(score.correct, 0); assert.equal(score.inventedAnswers, 2);
});
test('deleted and unselected facts/sources leak even when other answers are correct', () => {
    const qs = dataset.questions.slice(0, 10), output = oracle(qs);
    for (const index of [7, 8]) { output.answers[index].answer = qs[index].forbiddenAnswers[0]; output.answers[index].sourceRefs = qs[index].forbiddenSourceRefs; }
    const score = scoreAnswers(qs, output); assert.equal(score.staleLeaks, 2); assert.equal(score.gate, 'failed');
});
test('missing cost and latency remain null rather than fake zero', () => {
    assert.equal(summarizeMeasurements([]).costUsd, null);
    const stats = summarizeMeasurements([{ status: 'completed', elapsedMs: 20, usage: {} }]); assert.equal(stats.costComplete, false); assert.equal(stats.costUsd, null); assert.equal(stats.firstTokenMedianMs, null);
});
test('unconfigured/unauthorized paid runs stop before any adapter work', async () => {
    let called = false;
    const result = await runEvaluation({ adapters: { pi: { quote: () => { called = true; } } }, dataset });
    assert.equal(result.status, 'blocked'); assert.equal(result.quality, null); assert.equal(called, false); assert.equal(result.evidence, 'not-run');
    assert.equal(validateRunConfig({ allowPaid: true }), 'explicit-budget-required');
});
test('known budget reserves prevent external work and all remaining conditions stay blocked', async () => {
    const adapter = mockAdapter('pi', { run: () => assert.fail('cannot exceed cost cap') });
    const result = await runEvaluation({ config: { ...config, budget: { ...config.budget, maxCostUsd: 0.001 } }, adapters: { pi: adapter }, dataset, evidence: 'mock' });
    assert.equal(result.conditions[0].reason, 'budget-exhausted'); assert.equal(result.measurements.length, 0); assert.equal(result.quality, null);
});
test('uncertain paid outcome is not retried and never assigned zero cost', async () => {
    let calls = 0;
    const adapter = mockAdapter('pi', { run: async () => { calls++; throw new Error('private provider detail'); } });
    const result = await runEvaluation({ config, adapters: { pi: adapter }, dataset, evidence: 'mock' });
    assert.equal(calls, 1); assert.equal(result.measurements[0].status, 'unknown'); assert.equal(result.ledger.actualCostUsd, null);
    assert.ok(!JSON.stringify(result).includes('private provider detail'));
});
test('unknown usage halts and unverified cache never counts as an evaluated condition', async () => {
    for (const response of [{ output: {}, usage: null }, { output: {}, usage: { complete: true, costUsd: 0.001, inputTokens: 1, outputTokens: 1, providerRequests: 1 }, cache: { verified: false } }]) {
        const result = await runEvaluation({ config, adapters: { pi: mockAdapter('pi', { run: async () => response }) }, dataset, evidence: 'mock' });
        assert.equal(result.conditions[0].status, 'blocked'); assert.equal(result.quality, null); assert.equal(result.conditions[1].status, 'blocked');
    }
});
test('mock execution records admission intent and remains labeled mock with partial executor coverage', async () => {
    const events = [];
    const result = await runEvaluation({ config: { ...config, budget: { ...config.budget, maxRequests: 1 } }, adapters: { pi: mockAdapter('pi') }, dataset, evidence: 'mock', onRecord: r => events.push(r) });
    assert.equal(events[0].phase, 'intent'); assert.equal(result.evidence, 'mock'); assert.equal(result.measurements[0].score.gate, 'passed');
    assert.equal(result.conditions[0].score, null); assert.equal(result.quality, null); assert.equal(result.ledger.reservedRequests, 1);
});
test('CLI plans without provider imports and --run without configuration exits blocked', async () => {
    const { spawnSync } = await import('node:child_process');
    const script = new URL('./run.mjs', import.meta.url);
    const { fileURLToPath } = await import('node:url');
    const plan = spawnSync(process.execPath, [fileURLToPath(script)], { encoding: 'utf8' });
    assert.equal(plan.status, 0); const output = JSON.parse(plan.stdout); assert.equal(output.status, 'not-run'); assert.equal(output.conditions.length, 72);
    const blocked = spawnSync(process.execPath, [fileURLToPath(script), '--run'], { encoding: 'utf8' });
    assert.equal(blocked.status, 2); assert.equal(JSON.parse(blocked.stdout).status, 'blocked'); assert.equal(JSON.parse(blocked.stdout).quality, null);
});
