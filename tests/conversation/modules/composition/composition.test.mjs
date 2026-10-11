import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationServices } from '../../../../src/conversation/composition/index.js';

const directory = '/virtual/conversation-v1';
const config = { provider: 'openai-compatible', model: 'unit', baseUrl: 'http://stub.invalid/v1', contextWindow: 32000, inputLimit: 30000, maxOutputTokens: 1000, outputLimit: 2000, workingBudget: 16000, apiKey: 'unit-secret', headers: { 'x-custom': 'unit-header-secret' } };
const cap = c => ({ supported: true, provider: c.provider, executor: c.executor, types: ['send', 'auxiliary'], tools: true, media: ['text'], contextWindow: c.contextWindow, inputLimit: c.inputLimit, outputLimit: c.outputLimit, maxOutputTokens: c.maxOutputTokens, workingBudget: c.workingBudget });
function harness(overrides = {}) {
    const calls = { closes: 0, trace: [], read: [], providers: [], retrieval: [], pi: [] };
    const resources = [{ id: 'main', revision: 1, kind: 'connection', data: structuredClone(config) }, { id: 'embed', revision: 1, kind: 'connection', data: { ...config, model: 'embedding' } }, { id: 'image', revision: 1, kind: 'connection', data: { ...config, model: 'image' } }];
    let snapshot = { conversationId: 'c', conversation: { id: 'c', activeTurnId: 't', settings: {} }, settings: { connectionId: 'main' }, resources, messages: [{ id: 'm', role: 'user', content: 'hello', media: [] }], memories: [], summaries: [], folds: [] };
    const latest = new Map(resources.map(r => [r.id, r]));
    const store = { close() { calls.closes++; }, getConversation() { return structuredClone(snapshot); }, getConnection(id, revision) { calls.read.push([id, revision]); return revision === undefined ? latest.get(id) : resources.find(r => r.id === id && r.revision === revision); }, saveTrace(value) { calls.trace.push(value); } };
    const rawTrace = { begin(value) { calls.trace.push(['begin', value]); return 'trace-id'; }, record(id, value) { calls.trace.push(['record', value]); }, finish(id, value) { calls.trace.push(['finish', value]); }, fail(id, value) { calls.trace.push(['fail', value]); } };
    const execution = async options => { calls.execution = options; return { content: '{"chapter":"summary"}', finishReason: 'stop', usage: { complete: true } }; };
    const dependencies = {
        createStore: () => store,
        createRuntime: args => { calls.runtime = args; return { close: async () => { calls.runtimeClosed = true; } }; },
        createTraceService: () => rawTrace,
        createResourceService: () => ({}), createAttachmentService: () => ({ read(id) { calls.attachmentRead = id; return { mime: 'image/png', bytes: Buffer.from('image') }; }, save: async input => ({ id: 'saved-image', ...input }) }),
        createMemoryService: args => { calls.memory = args; return {}; },
        createRetrieval: args => { calls.retrieval.push(args); return { search: async () => [], index: async () => ({}), rebuild: async () => ({}) }; },
        createToolRegistry: args => { calls.tools = args; return {}; }, createGroupScheduler: () => ({}), createMaintenance: () => ({}),
        createPiExecutor: deps => { calls.pi.push(deps); return { runTurn: execution }; },
        createClaudeExecutor: () => ({ getCapabilities: c => ({ ...cap(c), supported: false, reason: 'platform-disabled' }), preflight() {} }),
        createCodexExecutor: () => ({ getCapabilities: c => ({ ...cap(c), supported: false, reason: 'platform-disabled' }), preflight() {} }),
        getPiCapabilities: cap, getChatCapabilities: cap, getTextCapabilities: c => ({ ...cap(c), tools: false }), getAuxiliaryCapabilities: cap,
        createProviderAdapter: c => { calls.providers.push(c); return { embed: async texts => ({ embeddings: texts.map(() => [1, 2]), model: c.model, usage: { inputTokens: 2 } }), generateImage: async () => ({ images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }], usage: { cost: null } }) }; },
        createProviderStream: (c, deps) => { calls.bridge = deps; return () => {}; }, createProviderModel: c => ({ id: c.model, api: 'unit-text' }),
        compileContext: (snapshot, options) => { calls.compiled = { snapshot, options }; return { type: options.type, mode: 'chat', messages: snapshot.messages, budget: { workingBudget: options.workingBudget ?? 16000 } }; },
        ...overrides,
    };
    const services = createConversationServices({ directory, dependencies });
    return { services, calls, resources, latest, snapshot, store, setSnapshot: value => { snapshot = value; } };
}
const options = h => ({ snapshot: h.snapshot, requestPlan: { messages: h.snapshot.messages }, connection: config });

test('default executor normalizes once and SDK disabled state remains disabled', async () => {
    const h = harness();
    assert.equal(h.services.capabilities(config).executor, 'native');
    assert.equal(h.services.capabilities({ ...config, executor: 'bogus' }).supported, false);
    assert.equal(h.services.capabilities({ ...config, executor: 'claude' }).supported, false);
    assert.deepEqual(h.services.capabilities({ ...config, type: 'image' }).types, []);
    const chosen = h.calls.runtime.executor(config);
    chosen.preflight({ connection: config });
    await chosen.runTurn(options(h));
    assert.equal(h.calls.execution.connection.executor, 'native');
    await h.services.close(); await h.services.close();
    assert.equal(h.calls.closes, 1);
});

test('text bridge uses the frozen template and only PI receives onRequest', async () => {
    const h = harness();
    const c = { ...config, provider: 'text-provider', executor: 'native', type: 'text' };
    const requestPlan = { mode: 'text', prompt: '<user>hello</user>', messages: [{ role: 'user', content: 'hello' }] };
    await h.calls.runtime.executor(c).runTurn({ ...options(h), connection: c, requestPlan });
    assert.equal(h.calls.bridge.onRequest, undefined);
    assert.equal(typeof h.calls.pi[0].onRequest, 'function');
    assert.equal(h.calls.bridge.renderPrompt({ tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] }), requestPlan.prompt);
    assert.throws(() => h.calls.bridge.renderPrompt({ tools: [], messages: [{ role: 'user', content: 'changed' }] }), { code: 'text-context-changed' });
    await h.services.close();
});

test('hydration handles historical content and draft media without mutating snapshot', async () => {
    const h = harness();
    const source = { ...h.snapshot, messages: [{ role: 'user', content: [{ type: 'image', attachmentId: 'a' }], media: [{ type: 'image', attachmentId: 'b' }] }] };
    const original = structuredClone(source);
    const capability = { ...cap(config), verified: true, media: ['text', 'image'], mediaTokenCost: { image: 100 } };
    h.calls.runtime.compile(source, { capabilities: capability, media: [{ type: 'image', attachmentId: 'draft' }] });
    assert.deepEqual(source, original);
    assert.equal(h.calls.compiled.snapshot.messages[0].content[0].data, Buffer.from('image').toString('base64'));
    assert.equal(h.calls.compiled.snapshot.messages[0].media[0].mimeType, 'image/png');
    assert.equal(h.calls.compiled.options.media[0].data, Buffer.from('image').toString('base64'));
    assert.throws(() => h.calls.runtime.compile(source, { capabilities: cap(config) }), { code: 'unsupported-media' });
    await h.services.close();
});

test('trace wrapper redacts custom header secrets and failure messages', async () => {
    const h = harness();
    const id = h.calls.runtime.trace.begin({ connection: config, content: config.apiKey + config.headers['x-custom'] });
    h.calls.runtime.trace.record(id, { output: config.headers['x-custom'] });
    h.calls.runtime.trace.fail(id, new Error(config.apiKey));
    assert.ok(!JSON.stringify(h.calls.trace).includes('unit-secret'));
    assert.ok(!JSON.stringify(h.calls.trace).includes('unit-header-secret'));
    await h.services.close();
});

test('memory uses frozen auxiliary connection and closes failed traces', async () => {
    let h;
    h = harness({ createPiExecutor: () => ({ runTurn: async options => { h.calls.memoryExecution = options; throw new Error(config.apiKey); } }) });
    h.snapshot.settings.auxiliaryConnectionId = 'embed';
    await assert.rejects(h.calls.memory.generate({ snapshot: h.snapshot, messages: [], summaries: [], memories: [], inputBudget: 3000 }));
    assert.ok(h.calls.read.some(([id, revision]) => id === 'embed' && revision === 1));
    assert.equal(h.calls.compiled.options.workingBudget, 3000);
    assert.equal(h.calls.trace.at(-1)[0], 'fail');
    assert.ok(!JSON.stringify(h.calls.trace).includes('unit-secret'));
    await h.services.close();
});

test('malformed or truncated auxiliary output fails instead of completing its trace', async () => {
    for (const result of [{ content: 'bad', finishReason: 'stop' }, { content: '{"chapter":"x"}', finishReason: 'length' }, { content: '{}', finishReason: 'stop' }]) {
        const h = harness({ createPiExecutor: () => ({ runTurn: async () => result }) });
        await assert.rejects(h.calls.memory.generate({ snapshot: h.snapshot, messages: [], memories: [], summaries: [] }), { code: 'compression-failed' });
        assert.equal(h.calls.trace.at(-1)[0], 'fail');
        await h.services.close();
    }
});

test('retrieval refreshes when embeddings are enabled, revised or disabled', async () => {
    const h = harness();
    const retrieval = h.calls.runtime.retrieval;
    await retrieval.search('c', 'query');
    assert.equal(h.calls.retrieval[0].embed, undefined);
    h.snapshot.settings.embeddingConnectionId = 'embed';
    await retrieval.index('c');
    assert.equal(h.calls.retrieval.length, 2);
    const first = h.calls.retrieval[1];
    h.latest.set('embed', { ...h.resources[1], revision: 2, data: { ...config, model: 'revised' } });
    await retrieval.search('c', 'query');
    assert.equal(h.calls.retrieval.length, 3);
    const old = await first.embed({ texts: ['a'], purpose: 'index' });
    const current = await h.calls.retrieval[2].embed({ texts: ['a'], purpose: 'query' });
    assert.equal(old.version, 'embed:1'); assert.equal(current.version, 'embed:2');
    delete h.snapshot.settings.embeddingConnectionId;
    await retrieval.search('c', 'query');
    assert.equal(h.calls.retrieval.at(-1).embed, undefined);
    await h.services.close();
});

test('image calls use active frozen connection and save returned artifacts', async () => {
    let h;
    h = harness({ createPiExecutor: () => ({ runTurn: async () => h.calls.tools.image({ conversationId: 'c', turnId: 't', prompt: 'picture', idempotencyKey: 'job' }) }) });
    h.snapshot.settings.imageConnectionId = 'image';
    h.latest.set('image', { ...h.resources[2], revision: 2 });
    const result = await h.calls.runtime.executor(config).runTurn(options(h));
    assert.equal(result.images[0].id, 'saved-image');
    assert.ok(h.calls.read.some(([id, revision]) => id === 'image' && revision === 1));
    assert.ok(h.calls.trace.some(record => record.kind === 'image-usage'));
    await assert.rejects(h.calls.tools.image({ conversationId: 'c', turnId: 't', prompt: 'late' }), { code: 'invalid-turn' });
    await h.services.close();
});

test('startup failure and failing runtime shutdown both close the owned store', async () => {
    let closed = 0;
    assert.throws(() => harness({ createStore: () => ({ close() { closed++; } }), createAttachmentService: () => { throw new Error('setup'); } }), /setup/);
    assert.equal(closed, 1);
    const h = harness({ createRuntime: () => ({ close: async () => { throw new Error('shutdown'); } }) });
    await assert.rejects(h.services.close(), /shutdown/);
    assert.equal(h.calls.closes, 1);
    await assert.rejects(h.services.close(), /shutdown/);
    assert.equal(h.calls.closes, 1);
});

test('composition refuses old data root before any store factory is called', () => {
    let called = false;
    assert.throws(() => createConversationServices({ directory: '/virtual/data', dependencies: { createStore: () => { called = true; } } }), { code: 'invalid-directory' });
    assert.equal(called, false);
});

test('generation and memory requests carry their usage parent and category', async () => {
    let h;
    h = harness({ createPiExecutor: dependencies => ({ runTurn: async input => {
        await dependencies.onRequest({ method: 'POST', body: { text: config.apiKey } });
        return { content: '{"chapter":"summary"}', finishReason: 'stop' };
    } }) });
    await h.calls.runtime.executor(config).runTurn({ ...options(h), traceId: 'generation-parent' });
    await h.calls.memory.generate({ snapshot: h.snapshot, messages: [], summaries: [], memories: [] });
    const requests = h.calls.trace.filter(item => item.kind === 'outbound-request');
    assert.deepEqual(requests.map(item => [item.parentTraceId, item.category]), [['generation-parent', 'generation'], ['trace-id', 'memory']]);
    assert.ok(!JSON.stringify(requests).includes(config.apiKey));
    await h.services.close();
});

test('embedding and image usage preserve attempted calls on success and failure, excluding polling', async () => {
    const { summarizeUsage } = await import('../../../../src/conversation/traces/usage.js');
    for (const category of ['embedding', 'image']) for (const fail of [false, true]) {
        let h;
        const usage = { inputTokens: 2, outputTokens: 0, totalTokens: 2, complete: false };
        h = harness({
            createProviderAdapter: (_connection, dependencies) => {
                const invoke = async () => {
                    await dependencies.onRequest({ method: 'POST', url: 'https://stub.invalid/submit' });
                    await dependencies.onRequest({ method: 'GET', url: 'https://stub.invalid/status' });
                    await dependencies.onRequest({ method: 'GET', url: 'https://stub.invalid/result' });
                    if (fail) throw new Error(config.apiKey);
                    return { model: 'stub', embeddings: [[1, 2]], images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }], usage };
                };
                return { embed: invoke, generateImage: invoke };
            },
            createPiExecutor: () => ({ runTurn: async () => h.calls.tools.image({ conversationId: 'c', turnId: 't', prompt: 'picture' }) }),
        });
        h.snapshot.settings.embeddingConnectionId = 'embed';
        h.snapshot.settings.imageConnectionId = 'image';
        const invoke = async () => {
            if (category === 'image') return h.calls.runtime.executor(config).runTurn(options(h));
            await h.calls.runtime.retrieval.index('c');
            return h.calls.retrieval[0].embed({ texts: ['text'], purpose: 'index' });
        };
        if (fail) await assert.rejects(invoke()); else await invoke();
        const records = h.calls.trace.filter(item => item.kind === `${category}-usage`);
        assert.equal(new Set(records.map(item => item.id)).size, 1);
        assert.match(records[0].id, /^[0-9a-f-]{36}$/);
        const last = records.at(-1);
        assert.equal(last.status, fail ? 'failed' : 'completed');
        assert.equal(last.attemptedRequests, 1);
        assert.equal(last.usageMissing, fail);
        assert.deepEqual(last.usage, fail ? null : usage);
        const outbound = h.calls.trace.filter(item => item.kind === 'outbound-request');
        assert.equal(outbound.length, 1);
        assert.equal(outbound[0].parentTraceId, last.id);
        assert.equal(outbound[0].category, category);
        assert.equal(h.calls.trace.filter(item => item.kind === 'outbound-poll').length, 2);
        // Mimic store.saveTrace upsert, with unique IDs for capture records.
        const persisted = new Map(h.calls.trace.map((item, i) => [item.id ?? `request-${i}`, { ...item, id: item.id ?? `request-${i}` }]));
        const summary = summarizeUsage([...persisted.values()]);
        assert.equal(summary.totals.calls, 1);
        assert.equal(summary.categories[category].calls, 1);
        assert.equal(summary.categories.generation.calls, 0);
        assert.equal(summary.totals.totalTokens, fail ? null : 2);
        assert.ok(!JSON.stringify(h.calls.trace).includes(config.apiKey));
        await h.services.close();
    }
});
