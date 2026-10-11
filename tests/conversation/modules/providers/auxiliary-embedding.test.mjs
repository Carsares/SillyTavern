import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuxiliaryAdapter } from '../../../../src/conversation/providers/auxiliary/index.js';
import { AUXILIARY_PROVIDERS, getAuxiliaryCapabilities } from '../../../../src/conversation/capabilities/auxiliary/index.js';
const connection = provider => ({ provider, type: 'embedding', model: 'test-model', baseUrl: 'https://provider.invalid/v1', accountId: 'account', apiKey: 'test-secret' });
const vectors = [[1,2], [3,4]];
const wire = {
    'openai-auxiliary': { data: [{ index: 1, embedding: vectors[1] }, { index: 0, embedding: vectors[0] }] },
    'cohere-embed': { embeddings: { float: vectors } }, 'google-embed': { embeddings: vectors.map(values => ({ values })) },
    'vertex-embed': { predictions: vectors.map(values => ({ embeddings: { values } })) }, 'ollama-embed': { embeddings: vectors },
    'nomic-embed': { embeddings: vectors }, 'extras-embed': { embedding: vectors }, 'workers-embed': { success: true, result: { data: vectors } },
};
for (const [provider, profile] of Object.entries(AUXILIARY_PROVIDERS).filter(([, p]) => p.embedApi && p.embedApi !== 'transformers-embed')) {
    test(`named embedding ${provider} uses ${profile.embedApi}`, async () => {
        const calls = [];
        const adapter = createAuxiliaryAdapter(connection(provider), { fetch: async request => { calls.push({ url: request.url, body: await request.json(), headers: request.headers }); return Response.json(profile.embedApi === 'vertex-embed' ? { predictions: [{ embeddings: { values: vectors[calls.length - 1] } }] } : wire[profile.embedApi]); } });
        const result = await adapter.embed(['a', 'b']);
        assert.deepEqual(result.embeddings, vectors); assert.equal(calls.length, profile.embedApi === 'vertex-embed' ? 2 : 1);
        const c = calls[0];
        if (profile.embedApi === 'openai-auxiliary') { assert.ok(c.url.endsWith('/embeddings')); assert.deepEqual(c.body.input, ['a','b']); }
        if (profile.embedApi === 'nomic-embed') { assert.ok(c.url.endsWith('/embedding/text')); assert.equal(c.body.task_type, 'search_document'); }
        if (profile.embedApi === 'vertex-embed') { assert.ok(c.url.endsWith('/models/test-model:predict')); assert.equal(c.body.parameters.autoTruncate, false); }
        if (profile.embedApi === 'extras-embed') assert.deepEqual(c.body, { text: ['a','b'] });
        if (profile.embedApi === 'workers-embed') assert.ok(c.url.includes('/accounts/account/ai/run/test-model'));
    });
}
test('all 19 required vector identifiers except explicitly excluded webllm are registered', () => {
    const names = ['transformers','mistral','togetherai','nomicai','cohere','openai','extras','palm','ollama','llamacpp','vllm','koboldcpp','vertexai','electronhub','openrouter','chutes','nanogpt','siliconflow','workers_ai'];
    for (const name of names) assert.ok(AUXILIARY_PROVIDERS[name].operations.includes('embed'));
    assert.equal(getAuxiliaryCapabilities(connection('webllm')).supported, false);
});
test('local transformers pipeline is offline, disposes after inference, and makes no fetch', async () => {
    let disposed = false, factoryOptions;
    const adapter = createAuxiliaryAdapter({ provider: 'transformers', model: 'local', localModelPath: '/fake/model' }, {
        fetch: async () => assert.fail('local inference must not use network'),
        pipelineFactory: async (task, model, options) => {
            assert.equal(task, 'feature-extraction'); assert.equal(model, '/fake/model'); factoryOptions = options;
            const pipeline = async (texts, args) => { assert.deepEqual(texts, ['a','b']); assert.deepEqual(args, { pooling: 'mean', normalize: true }); return { tolist: () => vectors }; };
            pipeline.dispose = async () => { disposed = true; }; return pipeline;
        },
    });
    assert.deepEqual((await adapter.embed(['a','b'])).embeddings, vectors);
    assert.equal(factoryOptions.local_files_only, true); assert.equal(disposed, true);
});
test('unsupported media/params/task types reject before any embedding request', async () => {
    let calls = 0;
    const adapter = createAuxiliaryAdapter(connection('extras'), { fetch: async () => { calls++; } });
    for (const options of [{ dimensions: 3 }, { media: [] }, { inputType: 'search_query' }, { arbitrary: 1 }]) await assert.rejects(adapter.embed(['x'], options), { code: 'unsupported-parameters' });
    assert.equal(calls, 0);
    assert.throws(() => createAuxiliaryAdapter({ ...connection('extras'), parameters: { ignored: true } }), { code: 'unsupported-provider' });
});
test('Vertex and Nomic query/dimension controls are encoded and dimensions checked', async () => {
    for (const provider of ['vertexai','nomicai']) {
        let body;
        const adapter = createAuxiliaryAdapter(connection(provider), { fetch: async request => { body = await request.json(); return Response.json(provider === 'vertexai' ? { predictions: [{ embeddings: { values: vectors[body.instances[0].content === 'a' ? 0 : 1] } }] } : wire[AUXILIARY_PROVIDERS[provider].embedApi]); } });
        await adapter.embed(['a','b'], { dimensions: 2, inputType: 'search_query' });
        if (provider === 'vertexai') { assert.equal(body.instances[0].task_type, 'RETRIEVAL_QUERY'); assert.equal(body.parameters.outputDimensionality, 2); }
        else { assert.equal(body.task_type, 'search_query'); assert.equal(body.dimensionality, 2); }
        await assert.rejects(adapter.embed(['a','b'], { dimensions: 3 }), { code: 'provider-response-invalid' });
    }
});

test('local runtime cancellation terminates its owned worker', async () => {
    const { EventEmitter } = await import('node:events');
    const { localEmbeddings } = await import('../../../../src/conversation/providers/auxiliary/local-embedding.js');
    const controller = new AbortController(); let terminated = false;
    const worker = new EventEmitter(); worker.terminate = async () => { terminated = true; };
    const pending = localEmbeddings({ localModelPath: '/fake/model' }, ['x'], controller.signal, (_url, options) => { assert.equal(options.workerData.modelPath, '/fake/model'); return worker; });
    controller.abort(); await assert.rejects(pending, { code: 'aborted' }); assert.equal(terminated, true);
});
test('local runtime worker result is returned and owned worker is joined', async () => {
    const { EventEmitter } = await import('node:events');
    const { localEmbeddings } = await import('../../../../src/conversation/providers/auxiliary/local-embedding.js');
    let terminated = false;
    const result = await localEmbeddings({ localModelPath: '/fake/model' }, ['x'], undefined, () => {
        const worker = new EventEmitter(); worker.terminate = async () => { terminated = true; };
        queueMicrotask(() => worker.emit('message', { embeddings: [[1,2]] })); return worker;
    });
    assert.deepEqual(result, [[1,2]]); assert.equal(terminated, true);
});
