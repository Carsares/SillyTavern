import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvaluationAdapter } from './adapter.mjs';
import { createBudgetTransport, pipelineQuote } from './transport-budget.mjs';
import { seedBackup } from './seed.mjs';
import { createDataset, publicInput } from './dataset.mjs';
import { validateBackup } from '../../../src/conversation/store/backup.js';
import { evaluationMatrix, runEvaluation } from './runner.mjs';

const pricing = { inputUsdPerMillionUpper: 2, outputUsdPerMillionUpper: 6, perRequestUsdUpper: 0.01, source: 'unit-test-only upper bounds' };
const connection = { provider: 'openai-compatible', model: 'unit-model', baseUrl: 'https://unit.invalid/v1/', contextWindow: 2000000, workingBudget: 1900000, maxOutputTokens: 4096, pricing };
const config = { connection, modelVersion: 'unit-version', maxRequestsPerBatch: 4 };
const condition = { executor: 'pi', budget: 'full', workingBudget: null, repeat: 1, cache: 'uncontrolled', sessionKey: 'pi/full/1' };
const dataset = createDataset();
const input = () => ({ ...publicInput(dataset, dataset.questions.slice(0, 2)), condition, preserveFullHistory: true });
const empty = () => ({ schemaVersion: 1, secretSchema: { version: 1, containsCredentials: true, purpose: 'internal-backup' },
    ...Object.fromEntries(['conversations', 'resources', 'messages', 'turns', 'snapshots', 'summaries', 'memories', 'folds', 'jobs', 'tools', 'traces', 'attachments', 'events'].map(k => [k, {}])) });
const priced = () => [{ ...connection, type: 'chat' }, { ...connection, model: 'embed-unit', type: 'embedding', maxOutputTokens: 0 }];
const post = (model = 'unit-model', extra = {}) => new Request(`https://unit.invalid/v1/${model === 'embed-unit' ? 'embeddings' : 'chat/completions'}`, {
    method: 'POST', body: JSON.stringify({ model, ...(model === 'embed-unit' ? { input: ['text'] } : { messages: [{ role: 'user', content: 'test' }], max_tokens: 50 }), ...extra }) });
const response = (extra = {}) => Response.json({ usage: { prompt_tokens: 100, completion_tokens: 20, ...extra }, choices: [] });

test('all adapters expose wiring without claiming verified cache or paid runtime results', async () => {
    let created = false;
    const adapter = createEvaluationAdapter({ config, dependencies: { makeDirectory() { created = true; } } });
    assert.equal(adapter.capabilities.runtimeWired, true); assert.equal(adapter.capabilities.verified, false); assert.equal(adapter.capabilities.cacheControl, false);
    for (const cache of ['cold', 'warm']) await assert.rejects(adapter.quote({ ...input(), condition: { ...condition, cache } }), { code: 'provider-cache-isolation-unverified' });
    assert.equal(created, false);
    for (const executor of ['claude', 'codex']) {
        const sdkAdapter = createEvaluationAdapter({ executor, config });
        assert.equal(sdkAdapter.capabilities.runtimeWired, true); assert.equal(sdkAdapter.capabilities.verified, false);
        assert.equal((await sdkAdapter.quote(input())).hardUpperBound, true);
    }
});

test('credentials and unpriced tools are blocked before directory/network work', async () => {
    for (const [changes, code] of [
        [{ connection: { ...connection, apiKey: 'unit-secret' } }, 'use-environment-credentials'],
        [{ connection: { ...connection, apiKeyEnv: 'MISSING' } }, 'credential-environment-missing'],
        [{ tools: ['generate_image'] }, 'unpriced-side-effect-tool'],
        [{ maxRequestsPerBatch: undefined }, 'pipeline-request-cap-required'],
        [{ connection: { ...connection, pricing: undefined } }, 'price-upper-bound-required'],
    ]) await assert.rejects(createEvaluationAdapter({ config: { ...config, ...changes }, env: {} }).quote(input()), { code });
});

test('seed is a valid backup with selected evidence, source labels and frozen connections only', () => {
    const backup = seedBackup(empty(), dataset.snapshot, [{ ...connection, role: 'primary' }], { workingBudget: 32768, instruction: 'Answer with citations' });
    const checked = validateBackup(backup);
    assert.equal(Object.keys(checked.messages).length, 3040);
    assert.equal(Object.keys(checked.turns).length, 1600);
    assert.equal(checked.conversations.evaluation.settings.worldInfo.turnIndex, 1600);
    assert.deepEqual(Object.values(checked.turns).map(t => t.turnIndex), Array.from({ length: 1600 }, (_, i) => i));
    assert.ok(Object.values(checked.turns).every(t => Array.isArray(t.pendingEffects) && !t.pendingEffects.length));
    assert.equal(checked.resources['eval-connection-0'].versions[1].data.workingBudget, 32768);
    assert.match(checked.messages['fact-0001'].content, /sourceRef.*fact-0001/);
    assert.ok(!JSON.stringify(checked).includes('旧地-'));
    assert.equal(checked.messages['fact-0008'], undefined);
    assert.equal(dataset.snapshot.messages[0].content.includes('sourceRef'), false);
});

test('one transport ceiling covers main, summaries, embeddings and tool/retry requests', async () => {
    let calls = 0;
    const connections = priced(), ceiling = pipelineQuote(connections, 3);
    const transport = createBudgetTransport({ connections, ceiling, fetch: async () => { calls++; return response(); } });
    await transport.fetch(post()); // primary
    await transport.fetch(post()); // summary or SDK tool continuation: same egress
    await transport.fetch(post('embed-unit')); // index or recall tool
    const usage = await transport.finish();
    assert.equal(calls, 3); assert.equal(usage.providerRequests, 3); assert.equal(usage.inputTokens, 300); assert.equal(usage.outputTokens, 40);
    assert.equal(usage.costUsd, null); assert.equal(usage.costComplete, false); assert.ok(usage.costUpperBoundUsd <= ceiling.maxCostUsd);
    await assert.rejects(transport.fetch(post()), { code: 'evaluation-transport-closed' });
});

test('guard rejects unpriced operations, oversized requests/output and zero ceiling without dispatch', async () => {
    const connections = priced(); let calls = 0;
    const makeTransport = () => createBudgetTransport({ connections, ceiling: pipelineQuote(connections, 3), fetch: async () => { calls++; return response(); } });
    await assert.rejects(makeTransport().fetch('https://unit.invalid/v1/images/generations', { method: 'POST', body: '{}' }), { code: 'unpriced-provider-request' });
    await assert.rejects(makeTransport().fetch(post('unit-model', { max_tokens: 10000 })), { code: 'unbounded-provider-output' });
    await assert.rejects(makeTransport().fetch(post('unit-model', { messages: ['x'.repeat(2000000)] })), { code: 'provider-input-bound-exceeded' });
    const zero = createBudgetTransport({ connections, ceiling: { maxRequests: 0, maxInputTokens: 0, maxOutputTokens: 0, maxCostUsd: 0 }, fetch: async () => { calls++; } });
    await assert.rejects(zero.fetch(post()), { code: 'evaluation-budget-exhausted' });
    assert.equal(calls, 0);
});

test('unknown charged outcome keeps its reservation and abort prevents a later request', async () => {
    const controller = new AbortController(); let calls = 0;
    const transport = createBudgetTransport({ connections: priced(), ceiling: pipelineQuote(priced(), 1), signal: controller.signal,
        fetch: async () => { calls++; throw new Error('disconnected'); } });
    await assert.rejects(transport.fetch(post()));
    await assert.rejects(transport.fetch(post()), { code: 'evaluation-prior-outcome-unknown' });
    controller.abort(); await assert.rejects(transport.fetch(post()));
    const usage = await transport.finish(); assert.equal(calls, 1); assert.equal(usage.complete, false); assert.equal(usage.costUsd, null); assert.equal(usage.reservedRequests, 1);
});

test('SSE usage is observed without consuming the executor stream; billing requires explicit cost field', async () => {
    const text = 'data: {"choices":[]}\n\ndata: {"usage":{"prompt_tokens":100,"completion_tokens":20,"cost_usd":0.001}}\n\ndata: [DONE]\n\n';
    const connections = [{ ...priced()[0], providerCostField: 'usage.cost_usd' }];
    const transport = createBudgetTransport({ connections, ceiling: pipelineQuote(connections, 1), fetch: async () => new Response(text, { headers: { 'content-type': 'text/event-stream' } }) });
    const result = await transport.fetch(post()); assert.equal(await result.text(), text);
    const usage = await transport.finish(); assert.equal(usage.complete, true); assert.equal(usage.costUsd, 0.001);
});

test('factory wires runtime, tracks background work, reports first token and removes only its isolated directory', async () => {
    const calls = []; let restored, composed;
    const dependencies = {
        makeDirectory: async () => '/fake/evaluation/own/conversation-v1', removeDirectory: async dir => calls.push(['remove', dir]),
        fetch: async () => { calls.push(['http']); return response(); },
        factories: {
            createStore: () => ({ exportData: empty, restoreData(data) { restored = validateBackup(data); }, getConversation: () => ({ conversation: { contentRevision: 481 } }), appendDelta() { calls.push(['delta']); } }),
            createMemoryService: () => ({ compact: () => assert.fail('full history cannot compact'), drain: async () => { await composed.fetch(post()); calls.push(['background']); } }),
            createRetrieval: () => ({ index: async () => { await composed.fetch(post('embed-unit')); }, rebuild: async () => {} }),
            createServices(options) {
                composed = options;
                const store = options.dependencies.createStore({}), memory = options.dependencies.createMemoryService({}), retrieval = options.dependencies.createRetrieval({});
                return { store, runtime: {
                    start(id, request) { calls.push(['start', id, request.type]); return { turnId: 'test-turn' }; },
                    async wait() { await options.fetch(post()); store.appendDelta('test-turn', { text: 'answer' }, 1); void memory.drain(); void retrieval.index(); return { status: 'completed', content: '{"answers":[]}' }; },
                    stop() { calls.push(['stop']); },
                }, close: async () => calls.push(['close']) };
            },
        },
    };
    const adapter = createEvaluationAdapter({ config: { ...config, connection: { ...connection, apiKeyEnv: 'UNIT_KEY' }, embeddingConnection: { ...connection, model: 'embed-unit' } }, env: { UNIT_KEY: 'unit-secret' }, dependencies });
    const request = input(), ceiling = await adapter.quote(request);
    const result = await adapter.run({ ...request, ceiling, onFirstToken: () => calls.push(['first']) });
    assert.equal(result.usage.providerRequests, 3); assert.equal(result.execution.backgroundIncluded, true); assert.equal(result.cache.verified, false);
    assert.ok(calls.findIndex(c => c[0] === 'background') < calls.findIndex(c => c[0] === 'close'));
    assert.ok(calls.some(c => c[0] === 'first')); assert.deepEqual(calls.at(-1), ['remove', '/fake/evaluation/own/conversation-v1']);
    assert.equal(restored.resources['eval-connection-0'].versions[1].data.apiKey, 'unit-secret');
    assert.ok(!JSON.stringify({ capabilities: adapter.capabilities, ceiling, result }).includes('unit-secret'));
});

test('uncontrolled matrix is explicit and unknown billed cost stays null with enforced upper accounting', async () => {
    assert.equal(evaluationMatrix(['uncontrolled']).length, 36);
    const aliasConfig = { ...config, connection: { ...connection, provider: 'deepseek', model: 'deepseek-v4-flash' } };
    const adapter = { capabilities: { ...createEvaluationAdapter({ config: aliasConfig }).capabilities }, quote: async () => pipelineQuote(priced(), 1),
        run: async r => ({ output: { answers: [] }, usage: { complete: true, providerRequests: 1, inputTokens: 1, outputTokens: 1, costUsd: null, costUpperBoundUsd: 0.001, costBasis: 'configured-price-upper-bound' }, cache: { mode: 'uncontrolled', sessionKey: r.condition.sessionKey, verified: false } }) };
    const result = await runEvaluation({ config: { allowPaid: true, cacheModes: ['uncontrolled'], batchSize: 200, budget: { maxCostUsd: 1000, maxRequests: 1, maxInputTokens: 10000000, maxOutputTokens: 100000, deadlineMs: 10000 } }, adapters: { pi: adapter }, dataset, evidence: 'mock' });
    assert.equal(result.measurements[0].status, 'completed'); assert.equal(result.measurements[0].usage.costUsd, null); assert.equal(result.ledger.actualCostUsd, null); assert.equal(result.quality, null);
    assert.equal(result.measurements[0].modelResolution.versionPinned, false);
    assert.equal(result.measurements[0].modelResolution.documentedResolvedModel, 'DeepSeek-V4.1-Flash');
});

test('swallowed background budget rejection still fails the final measurement', async () => {
    let calls = 0;
    const transport = createBudgetTransport({ connections: priced(), ceiling: pipelineQuote(priced(), 1), fetch: async () => { calls++; return response(); } });
    await transport.fetch(post());
    await assert.rejects(transport.fetch(post('embed-unit')), { code: 'evaluation-budget-exhausted' });
    await assert.rejects(transport.finish(), { code: 'evaluation-budget-exhausted' });
    assert.equal(calls, 1); assert.equal(transport.reservations.requests, 1);
});

test('per-request price and token ceilings cannot be omitted or negative', () => {
    for (const ceiling of [{}, { maxRequests: 1, maxInputTokens: 1, maxOutputTokens: 1, maxCostUsd: -1 }]) {
        assert.throws(() => createBudgetTransport({ connections: priced(), ceiling, fetch: () => assert.fail() }), { code: 'invalid-transport-ceiling' });
    }
});

test('auxiliary budget stays independent of the primary 32k condition', () => {
    const seed = seedBackup(empty(), dataset.snapshot, [{ ...connection, role: 'primary' }, { ...connection, role: 'memory', workingBudget: 65536 }], { workingBudget: 32768, instruction: 'test' });
    assert.equal(seed.resources['eval-connection-0'].versions[1].data.workingBudget, 32768);
    assert.equal(seed.resources['eval-connection-1'].versions[1].data.workingBudget, 65536);
});

test('full-history compaction fails before generation and cleans up without reporting a paid outcome', async () => {
    let compacted = false, removed = false;
    const adapter = createEvaluationAdapter({ config, dependencies: {
        makeDirectory: async () => '/fake/owned/conversation-v1', removeDirectory: async () => { removed = true; },
        fetch: () => assert.fail('no provider dispatch'), factories: {
            createStore: () => ({ exportData: empty, restoreData: () => {}, getConversation: () => ({ conversation: { contentRevision: 1 } }) }),
            createMemoryService: () => ({ compact: () => { compacted = true; }, drain: async () => {} }),
            createRetrieval: () => ({}),
            createServices({ dependencies }) {
                const memory = dependencies.createMemoryService({});
                return { store: dependencies.createStore({}), runtime: { start: () => ({ turnId: 'unit-turn' }), wait: async () => memory.prepareCompact({}) }, close: async () => {} };
            },
        },
    } });
    const request = input();
    await assert.rejects(adapter.run({ ...request, ceiling: await adapter.quote(request) }), { code: 'full-history-budget-blocked', dispatched: false });
    assert.equal(compacted, false); assert.equal(removed, true);
});

test('default cold/warm remains blocked even for configured repository-native adapter', async () => {
    const result = await runEvaluation({ dataset, adapters: { pi: createEvaluationAdapter({ config }) },
        config: { allowPaid: true, budget: { maxCostUsd: 1, maxRequests: 1, maxInputTokens: 1, maxOutputTokens: 1, deadlineMs: 1000 } }, evidence: 'mock' });
    assert.equal(result.conditions.length, 72); assert.equal(result.conditions[0].reason, 'provider-cache-isolation-unverified');
    assert.equal(result.measurements.length, 0); assert.equal(result.quality, null);
});

test('DeepSeek native alias is supported and explicitly not a pinned model version', async () => {
    const adapter = createEvaluationAdapter({ config: { ...config, connection: { ...connection, provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEnabled: false, reasoning: 'off' } } });
    assert.equal(adapter.capabilities.runtimeWired, true);
    assert.equal(adapter.capabilities.modelVersion, 'DeepSeek-V4.1-Flash');
    assert.equal(adapter.capabilities.modelResolution.requestedModel, 'deepseek-v4-flash');
    assert.equal(adapter.capabilities.modelResolution.versionPinned, false);
    assert.equal(adapter.capabilities.modelResolution.responseVerified, false);
    assert.equal((await adapter.quote(input())).hardUpperBound, true);
});

test('evaluation rejects proxy at top-level and every role before any work, including direct transport use', async () => {
    let network = 0;
    const proxy = { url: 'http://unit.invalid:1234' };
    for (const patch of [{ proxy }, ...['connection', 'memoryConnection', 'embeddingConnection'].map(role => ({ [role]: { ...connection, proxy } }))]) {
        const adapter = createEvaluationAdapter({ config: { ...config, ...patch }, dependencies: {
            fetch: async () => { network++; assert.fail('No direct egress'); }, makeDirectory: () => assert.fail('No filesystem work'),
        } });
        await assert.rejects(adapter.quote(input()), { code: 'evaluation-proxy-unsupported' });
        await assert.rejects(adapter.run(input()), { code: 'evaluation-proxy-unsupported' });
    }
    assert.throws(() => createBudgetTransport({ connections: [{ ...connection, proxy }], ceiling: pipelineQuote(priced(), 1), fetch: () => { network++; } }), { code: 'evaluation-proxy-unsupported' });
    assert.equal(network, 0);
});

test('DeepSeek uses real native codec thinking disabled through bounded fake transport', async () => {
    const { createChatAdapter } = await import('../../../src/conversation/providers/chat/index.js');
    let captured;
    const c = { ...connection, provider: 'deepseek', model: 'deepseek-v4-flash', executor: 'native', type: 'chat', reasoningEnabled: false, reasoning: 'off', stream: false };
    const transport = createBudgetTransport({ connections: [c], ceiling: pipelineQuote([c], 1), fetch: async request => {
        captured = await request.json();
        return Response.json({ choices: [{ message: { content: 'unit only' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    } });
    const output = await createChatAdapter(c, { fetch: transport.fetch }).generate({ messages: [{ role: 'user', content: 'unit' }], maxOutputTokens: 10, stream: false });
    assert.equal(output.content, 'unit only'); assert.deepEqual(captured.thinking, { type: 'disabled' });
    assert.equal(captured.model, 'deepseek-v4-flash');
    assert.equal((await transport.finish()).providerRequests, 1);
});

test('DeepSeek example prepares all three protocols with mutable alias and keeps paid work disabled', async () => {
    const { readFile } = await import('node:fs/promises');
    const example = JSON.parse(await readFile(new URL('./config.deepseek.example.json', import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(example.executors), ['pi', 'claude', 'codex']);
    assert.equal(example.allowPaid, false);
    for (const key of ['maxCostUsd', 'maxRequests', 'maxInputTokens', 'maxOutputTokens']) assert.equal(example.budget[key], 0);
    const expected = { pi: ['deepseek', 'https://api.deepseek.com'], claude: ['anthropic', 'https://api.deepseek.com/anthropic'], codex: ['openai-compatible', 'https://api.deepseek.com'] };
    for (const [executor, config] of Object.entries(example.executors)) {
        assert.deepEqual([config.connection.provider, config.connection.baseUrl], expected[executor]);
        assert.equal(config.connection.model, 'deepseek-v4-flash');
        assert.equal(config.connection.apiKeyEnv, 'EVALUATION_API_KEY');
        const adapter = createEvaluationAdapter({ executor, config, env: { EVALUATION_API_KEY: 'offline-test-only' } });
        assert.equal(adapter.capabilities.runtimeWired, true);
        assert.equal(adapter.capabilities.modelResolution.versionPinned, false);
        assert.equal(adapter.capabilities.modelResolution.documentedResolvedModel, 'DeepSeek-V4.1-Flash');
        assert.equal((await adapter.quote({ ...input(), condition: { ...condition, executor } })).hardUpperBound, true);
        if (executor !== 'pi') assert.equal(config.memoryConnection.provider, 'deepseek');
    }
    const result = await runEvaluation({ config: example, dataset });
    assert.equal(result.reason, 'paid-authorization-required');
    assert.equal(result.evaluationScope, 'uncontrolled-diagnostic');
    assert.equal(result.fullG5, false); assert.equal(result.measurements.length, 0);
});
