import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationServices } from '../../../../src/conversation/composition/index.js';
import { assertRequestBudget } from '../../../../src/conversation/composition/helpers.js';

const directory = '/virtual/conversation-v1';
const config = { provider: 'openai-compatible', model: 'unit', baseUrl: 'http://stub.invalid/v1', contextWindow: 32000, inputLimit: 30000, maxOutputTokens: 1000, outputLimit: 2000, workingBudget: 16000, apiKey: 'unit-secret', headers: { 'x-custom': 'unit-header-secret' } };
const cap = c => ({ supported: true, provider: c.provider, executor: c.executor, types: ['send', 'auxiliary'], tools: true, media: ['text'], contextWindow: c.contextWindow, inputLimit: c.inputLimit, outputLimit: c.outputLimit, maxOutputTokens: c.maxOutputTokens, workingBudget: c.workingBudget });
function harness(overrides = {}, fetch) {
    const calls = { closes: 0, trace: [], read: [], providers: [], retrieval: [], pi: [] };
    const resources = [{ id: 'main', revision: 1, kind: 'connection', data: structuredClone(config) }, { id: 'embed', revision: 1, kind: 'connection', data: { ...config, model: 'embedding' } }, { id: 'image', revision: 1, kind: 'connection', data: { ...config, model: 'image' } }];
    let snapshot = { conversationId: 'c', conversation: { id: 'c', activeTurnId: 't', settings: {} }, settings: { connectionId: 'main' }, resources, messages: [{ id: 'm', role: 'user', content: 'hello', media: [] }], memories: [], summaries: [], folds: [] };
    const latest = new Map(resources.map(r => [r.id, r]));
    const store = { close() { calls.closes++; }, getConversation() { return structuredClone(snapshot); }, getConnection(id, revision) { calls.read.push([id, revision]); return revision === undefined ? latest.get(id) : resources.find(r => r.id === id && r.revision === revision); }, saveTrace(value) { calls.trace.push(value); } };
    const attachmentRecords = new Map();
    store.getAttachment = id => { assert.ok(attachmentRecords.has(id)); return attachmentRecords.get(id); };
    const jobs = new Map();
    store.getTurn = id => ({ id, conversationId: 'c', request: id === 'retry' ? { retryTurnId: 't' } : {} });
    store.getTrace = () => ({});
    store.listTraces = () => [...new Map(calls.trace.filter(item => item.id).map(item => [item.id, item])).values()];
    store.listJobs = () => [...jobs.values()].map(value => structuredClone(value));
    store.createJob = input => { const job = { ...structuredClone(input), id: `job-${jobs.size}`, status: 'pending' }; jobs.set(job.id, job); return structuredClone(job); };
    store.updateJob = async (id, patch) => { await new Promise(resolve => setImmediate(resolve)); Object.assign(jobs.get(id), structuredClone(patch)); return structuredClone(jobs.get(id)); };
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
        getPiCapabilities: cap, getChatCapabilities: cap, getTextCapabilities: c => ({ ...cap(c), tools: false, asyncJobs: c.provider === 'horde' }), getAuxiliaryCapabilities: c => ({ ...cap(c), asyncJobs: c.provider === 'horde' }),
        createProviderAdapter: c => { calls.providers.push(c); return { embed: async texts => ({ embeddings: texts.map(() => [1, 2]), model: c.model, usage: { inputTokens: 2 } }), generateImage: async () => ({ images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }], usage: { cost: null } }) }; },
        createProviderStream: (c, deps) => { calls.bridge = deps; return () => {}; }, createProviderModel: c => ({ id: c.model, api: 'unit-text' }),
        compileContext: (snapshot, options) => { calls.compiled = { snapshot, options }; return { type: options.type, mode: 'chat', messages: snapshot.messages, budget: { workingBudget: options.workingBudget ?? 16000 } }; },
        ...overrides,
    };
    const attachmentFactory = dependencies.createAttachmentService;
    dependencies.createAttachmentService = input => { const service = attachmentFactory(input); return { ...service, save: async value => { const record = await service.save(value); attachmentRecords.set(record.id, record); return record; } }; };
    const services = createConversationServices({ directory, dependencies, fetch });
    return { services, calls, resources, latest, snapshot, store, setSnapshot: value => { snapshot = value; } };
}
const options = h => ({ snapshot: h.snapshot, requestPlan: { messages: h.snapshot.messages }, connection: config });

test('auxiliary budget validates canonical messages and rejects the obsolete nested envelope', () => {
    const messages = [{ role: 'user', content: 'Summarize this.' }];
    const plan = { budget: { workingBudget: config.workingBudget } };
    assert.doesNotThrow(() => assertRequestBudget({ messages }, config, cap(config), plan));
    assert.throws(() => assertRequestBudget({ context: { messages } }, config, cap(config), plan), { code: 'invalid-context' });
    assert.throws(() => assertRequestBudget({ messages: [{ role: 'user', content: 'x'.repeat(10000) }] }, config, cap(config), { budget: { workingBudget: 1 } }), { code: 'budget-blocked' });
});

test('only embedding and image connection types use auxiliary provider capabilities', async () => {
    const auxiliaryTypes = [];
    const h = harness({ getAuxiliaryCapabilities: c => { auxiliaryTypes.push(c.type); return cap(c); } });
    for (const type of ['embedding', 'image']) assert.deepEqual(h.services.capabilities({ ...config, type }).types, []);
    for (const type of ['chat', 'text']) assert.ok(h.services.capabilities({ ...config, type }).types.includes('auxiliary'));
    h.services.capabilities({ ...config, type: 'auxiliary' });
    assert.deepEqual(auxiliaryTypes, ['embedding', 'image']);
    await h.services.close();
});

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

test('canonical OpenAI providers retain direct PI routing without the removed underscore alias', async () => {
    const h = harness({ getChatCapabilities: c => ({ ...cap(c), supported: false, reason: 'unsupported-provider' }) });
    for (const provider of ['openai', 'openai-compatible']) {
        const connection = { ...config, provider };
        assert.equal(h.services.capabilities(connection).supported, true);
        const executor = h.calls.runtime.executor(connection);
        executor.preflight({ connection });
        await executor.runTurn({ ...options(h), connection });
        assert.equal(h.calls.pi.at(-1).streamFn, undefined);
        assert.equal(h.calls.execution.connection.provider, provider);
    }
    const removed = { ...config, provider: 'openai_compatible' };
    assert.equal(h.services.capabilities(removed).supported, false);
    assert.throws(() => h.calls.runtime.executor(removed).preflight({ connection: removed }), { code: 'unsupported-connection' });
    await h.services.close();
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
    assert.equal(result.images[0].attachmentId, 'saved-image');
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

test('Horde text bridge awaits persisted job and retry polls the original submission', async () => {
    const { createProviderStream } = await import('../../../../src/conversation/providers/chat/bridge.js');
    let h, submits = 0, polls = 0;
    const fakeFetch = async request => {
        if (request.method === 'POST') { submits++; return Response.json({ id: 'remote-text' }); }
        polls++;
        assert.equal(h.store.listJobs()[0].payload.jobId, 'remote-text');
        return Response.json({ done: true, generations: [{ text: 'result' }] });
    };
    h = harness({
        createProviderStream: (c, dependencies) => createProviderStream(c, { ...dependencies, fetch: fakeFetch }),
        createPiExecutor: dependencies => ({ runTurn: async () => {
            const stream = dependencies.streamFn({ api: 'horde-text', provider: 'horde', id: 'unit' }, { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] });
            let result;
            for await (const event of stream) { if (event.type === 'error') throw new Error(event.error.errorMessage); if (event.type === 'done') result = event.message; }
            return result;
        } }),
    });
    const c = { ...config, id: 'main', revision: 1, provider: 'horde', executor: 'native', type: 'text', pollIntervalMs: 0 };
    const requestPlan = { type: 'send', mode: 'text', messages: [{ role: 'user', content: 'hello' }], prompt: 'hello' };
    await h.calls.runtime.executor(c).runTurn({ ...options(h), requestPlan, traceId: 'first-trace' });
    h.snapshot.conversation.activeTurnId = 'retry';
    await h.calls.runtime.executor(c).runTurn({ ...options(h), requestPlan, traceId: 'retry-trace' });
    assert.equal(submits, 1); assert.equal(polls, 2);
    assert.deepEqual(h.calls.trace.find(record => record.id === 'retry-trace').providerJob,
        { id: 'job-0', resumed: true, originalTraceId: 'first-trace' });
    await h.services.close();
});

test('Horde image recovery reuses usage identity and awaits tools owner onJob', async () => {
    let h, submits = 0, polls = 0, callbackCompleted = false;
    h = harness({ createProviderAdapter: (_c, dependencies) => ({ generateImage: async input => {
        if (!input.jobId) { submits++; await dependencies.onRequest({ method: 'POST' }); }
        await input.onJob({ jobId: input.jobId ?? 'remote-image', state: input.jobId ? 'resumed' : 'submitted', kind: 'image' });
        assert.equal(callbackCompleted, true);
        assert.equal(h.store.listJobs()[0].payload.jobId, 'remote-image');
        polls++; await dependencies.onRequest({ method: 'GET' });
        return { images: [], usage: null };
    } }) });
    h.snapshot.settings.imageConnectionId = 'image';
    h.resources[2].data.provider = 'horde';
    const input = { conversationId: 'c', turnId: 't', recordId: 'tool-record', snapshot: h.snapshot, prompt: 'picture', onJob: async value => {
        assert.equal(value.jobId, 'remote-image');
        await new Promise(resolve => setImmediate(resolve)); callbackCompleted = true;
    } };
    await h.calls.tools.image(input);
    callbackCompleted = false;
    await h.calls.tools.image(input);
    assert.equal(submits, 1); assert.equal(polls, 2);
    const records = h.calls.trace.filter(item => item.kind === 'image-usage');
    assert.equal(new Set(records.map(record => record.id)).size, 1);
    assert.equal(records.at(-1).attemptedRequests, 1);
    await h.services.close();
});

test('hydration preserves verified audio, video and document attachment types', async () => {
    const mimes = { audio: 'audio/wav', video: 'video/mp4', document: 'application/pdf' };
    const h = harness({ createAttachmentService: () => ({ read: type => ({ mime: mimes[type], name: `${type}.file`, bytes: Buffer.from(type) }) }) });
    const capability = { ...cap(config), verified: true, media: ['text', ...Object.keys(mimes)], mediaTokenCost: { audio: 100, video: 200, document: 300 } };
    h.calls.runtime.compile(h.snapshot, { capabilities: capability, media: Object.keys(mimes).map(type => ({ type, attachmentId: type })) });
    assert.deepEqual(h.calls.compiled.options.media.map(part => [part.type, part.mimeType, part.name]), Object.entries(mimes).map(([type, mime]) => [type, mime, `${type}.file`]));
    await h.services.close();
});

test('memory accepts structured input budget and rejects mismatched connection or invalid limits', async () => {
    const h = harness();
    const base = { snapshot: h.snapshot, messages: [], summaries: [], memories: [] };
    await h.calls.memory.generate({ ...base, inputBudget: { workingBudget: 3000, hardInputBudget: 2500, safetyTokens: 100, connectionId: 'main' } });
    assert.equal(h.calls.compiled.options.workingBudget, 2500);
    assert.match(h.calls.compiled.snapshot.resources[1].data.system, /expectedBlockRevision/);
    for (const inputBudget of [{ workingBudget: NaN }, { workingBudget: 0 }, { workingBudget: 1000, connectionId: 'other' }, { workingBudget: 1000, hardInputBudget: -1 }]) {
        await assert.rejects(h.calls.memory.generate({ ...base, inputBudget }), { code: 'budget-blocked' });
    }
    await h.services.close();
});

test('image output exposes registered media references without attachment internals', async () => {
    let h;
    h = harness({
        createAttachmentService: () => ({ save: async () => ({ id: 'opaque-id', mime: 'image/png', name: 'generated-image', size: 4, path: '/private/internal', base64: 'secret-bytes' }) }),
        createPiExecutor: () => ({ runTurn: async () => h.calls.tools.image({ conversationId: 'c', turnId: 't', prompt: 'picture' }) }),
    });
    h.snapshot.settings.imageConnectionId = 'image';
    const result = await h.calls.runtime.executor(config).runTurn(options(h));
    assert.deepEqual(result.media, [{ type: 'image', attachmentId: 'opaque-id', mimeType: 'image/png', name: 'generated-image', size: 4 }]);
    assert.deepEqual(result.images, result.media);
    assert.ok(!JSON.stringify(result).includes('/private/internal'));
    assert.ok(!JSON.stringify(result).includes('secret-bytes'));
    await h.services.close();
});

test('non-Horde async image profiles receive opaque handles and persistence callbacks', async () => {
    let h, submits = 0;
    const handle = 'aux1.eyJyZW1vdGVJZCI6InJlbW90ZSJ9';
    h = harness({
        getAuxiliaryCapabilities: c => ({ ...cap(c), imageApi: 'comfy-image' }),
        createProviderAdapter: () => ({ generateImage: async input => {
            if (!input.jobId) {
                await input.onJob({ jobId: null, state: 'submitting', kind: 'image' });
                assert.equal(h.store.listJobs()[0].payload.state, 'submitting');
                submits++;
                await input.onJob({ jobId: handle, state: 'submitted', kind: 'image' });
            } else assert.equal(input.jobId, handle);
            assert.equal(h.store.listJobs()[0].payload.jobId, handle);
            return { images: [], usage: null };
        } }),
    });
    h.snapshot.settings.imageConnectionId = 'image';
    const input = { conversationId: 'c', turnId: 't', snapshot: h.snapshot, recordId: 'tool-id', prompt: 'image' };
    await h.calls.tools.image(input);
    await h.calls.tools.image(input);
    assert.equal(submits, 1);
    await h.services.close();
});

test('provider result URL media is downloaded and registered before runtime receives it', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    let saved;
    const h = harness({
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        createAttachmentService: () => ({ save: async input => { saved = input; return { id: 'registered', name: input.name, mime: input.mime, size: 8, path: 'private-path' }; } }),
        createPiExecutor: () => ({ runTurn: async () => ({ content: 'picture', media: [{ type: 'image', url: 'https://cdn.example/a' }] }) }),
    }, async request => {
        assert.equal(request.headers.has('authorization'), false);
        assert.equal(request.headers.has('x-custom'), false);
        return new Response(png, { headers: { 'content-type': 'image/png' } });
    });
    const result = await h.calls.runtime.executor(config).runTurn(options(h));
    assert.equal(saved.base64, png.toString('base64'));
    assert.deepEqual(result.media, [{ type: 'image', attachmentId: 'registered', name: 'generated-image', mimeType: 'image/png', size: 8 }]);
    assert.ok(!JSON.stringify(result).includes('private-path'));
    await h.services.close();
});

test('memory usage trace belongs to the foreground turn or explicit null in background', async () => {
    for (const activeTurnId of ['t', undefined]) {
        const h = harness();
        h.snapshot.conversation.activeTurnId = activeTurnId;
        await h.calls.memory.generate({ snapshot: h.snapshot, messages: [], summaries: [], memories: [] });
        const trace = h.calls.trace.find(item => Array.isArray(item) && item[0] === 'begin')[1];
        assert.equal(trace.kind, 'memory');
        assert.equal(trace.turnId, activeTurnId ?? null);
        assert.equal(h.calls.execution.traceId, 'trace-id');
        await h.services.close();
    }
});

test('auxiliary connections use only explicit snapshot settings, never nested primary aliases', async () => {
    const h = harness();
    h.resources[0].data.auxiliary = { memory: 'embed', summary: { connectionId: 'embed' }, summarization: 'embed', embedding: 'embed', image: { connectionId: 'image' } };
    await h.calls.memory.generate({ snapshot: h.snapshot, messages: h.snapshot.messages, summaries: [], memories: [] });
    assert.equal(h.calls.execution.connection.id, 'main');
    await h.calls.runtime.retrieval.search('c', 'query');
    assert.equal(h.calls.retrieval.at(-1).embed, undefined);
    await assert.rejects(h.calls.tools.image({ conversationId: 'c', turnId: 't', prompt: 'picture', snapshot: h.snapshot }), { code: 'connection-required' });
    h.snapshot.settings.auxiliaryConnectionId = 'embed';
    await h.calls.memory.generate({ snapshot: h.snapshot, messages: h.snapshot.messages, summaries: [], memories: [] });
    assert.equal(h.calls.execution.connection.id, 'embed');
    await h.services.close();
});
