import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuxiliaryAdapter } from '../../../../src/conversation/providers/auxiliary/index.js';
import { AUXILIARY_PROVIDERS } from '../../../../src/conversation/capabilities/auxiliary/index.js';
const connection = provider => ({ provider, type: 'image', model: 'test-model', baseUrl: 'https://provider.invalid/v1', accountId: 'account', apiKey: 'test-secret' });
const jsonImage = { data: [{ b64_json: 'aW1hZ2U=' }] };
const binary = () => new Response('image', { headers: { 'content-type': 'image/png' } });
const cases = [
    ['togetherai','/images/generations',jsonImage], ['electronhub','/images/generations',jsonImage], ['aimlapi','/images/generations',jsonImage], ['xai','/images/generations',jsonImage], ['zai','/images/generations',jsonImage],
    ['extras','/api/image',{ image: 'aW1hZ2U=' }], ['sdcpp','/sdapi/v1/txt2img',{ images: ['aW1hZ2U='] }], ['vlad','/sdapi/v1/txt2img',{ images: ['aW1hZ2U='] }], ['drawthings','/sdapi/v1/txt2img',{ images: ['aW1hZ2U='] }],
    ['nanogpt','/generate-image',jsonImage], ['chutes','/generate',binary], ['huggingface','/test-model',binary], ['pollinations','/image/scene',binary],
    ['google','/models/test-model:generateContent',{ candidates: [{ content: { parts: [{ inlineData: { data: 'aW1hZ2U=', mimeType: 'image/png' } }] } }] }],
    ['vertexai','/models/test-model:predict',{ predictions: [{ bytesBase64Encoded: 'aW1hZ2U=', mimeType: 'image/png' }] }],
    ['openrouter','/chat/completions',{ choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,aW1hZ2U=' } }] } }] }],
    ['workers_ai','/accounts/account/ai/run/test-model',{ success: true, result: { image: 'aW1hZ2U=' } }],
];
for (const [provider, path, response] of cases) test(`native/named image ${provider}`, async () => {
    const calls = [];
    const adapter = createAuxiliaryAdapter(connection(provider), { fetch: async request => { calls.push({ url: new URL(request.url), init: request, body: request.method === 'GET' ? undefined : await request.json() }); return typeof response === 'function' ? response() : Response.json(response); } });
    const result = await adapter.generateImage({ prompt: 'scene' });
    assert.equal(result.images.length, 1); assert.ok(calls[0].url.pathname.endsWith(path)); assert.equal(calls.length, 1);
    if (provider === 'openrouter') assert.deepEqual(calls[0].body.modalities, ['image','text']);
    if (provider === 'nanogpt') assert.equal(calls[0].init.headers.get('x-api-key'), 'test-secret');
});
test('all original 24 image identifiers have concrete profiles', () => {
    for (const id of ['extras','horde','automatic1111','sdcpp','novelai','vlad','openai','aimlapi','comfy','togetherai','drawthings','pollinations','stability','huggingface','chutes','electronhub','nanogpt','bfl','falai','xai','google','zai','openrouter','workers_ai']) assert.ok(AUXILIARY_PROVIDERS[id].operations.includes('generateImage'));
});
test('Google Imagen uses prediction instead of Gemini content and retains sample count', async () => {
    let body;
    const adapter = createAuxiliaryAdapter({ ...connection('google'), model: 'imagen-4.0-generate-001' }, { fetch: async request => { assert.ok(request.url.endsWith(':predict')); body = await request.json(); return Response.json({ predictions: [{ bytesBase64Encoded: 'abc' }] }); } });
    await adapter.generateImage({ prompt: 'scene', aspectRatio: '16:9', count: 2 });
    assert.deepEqual(body.parameters, { sampleCount: 2, aspectRatio: '16:9' });
    await assert.rejects(adapter.generateImage({ prompt: 'scene', imageSize: '2K' }), { code: 'unsupported-parameters' });
});
test('Workers raw binary and flux-2 multipart are separate supported responses', async () => {
    const adapter = createAuxiliaryAdapter({ ...connection('workers_ai'), model: '@cf/black-forest-labs/flux-2-dev' }, { fetch: async request => { const body = await request.formData(); assert.equal(body.get('prompt'), 'scene'); return binary(); } });
    assert.equal((await adapter.generateImage({ prompt: 'scene', width: 512 })).images[0].mimeType, 'image/png');
});
test('all image codecs reject unlisted params and media before fetching', async () => {
    for (const [provider, p] of Object.entries(AUXILIARY_PROVIDERS).filter(([,p]) => p.imageApi)) {
        const adapter = createAuxiliaryAdapter(connection(provider), { fetch: async () => assert.fail('must reject before request') });
        for (const key of ['media', 'unknown']) await assert.rejects(adapter.generateImage({ prompt: 'scene', [key]: [] }), { code: 'unsupported-parameters' });
    }
});

test('xAI uses aspect/resolution while ZAI uses size and no unimplemented n field', async () => {
    for (const provider of ['xai','zai']) {
        let body;
        const adapter = createAuxiliaryAdapter(connection(provider), { fetch: async request => { body = await request.json(); return Response.json(jsonImage); } });
        await adapter.generateImage(provider === 'xai' ? { prompt: 'scene', aspectRatio: '16:9', resolution: '2k' } : { prompt: 'scene', width: 768, height: 1024 });
        if (provider === 'xai') { assert.equal(body.aspect_ratio, '16:9'); assert.equal(body.resolution, '2k'); assert.equal(body.size, undefined); }
        else { assert.equal(body.size, '768x1024'); assert.equal(body.n, undefined); }
        await assert.rejects(adapter.generateImage({ prompt: 'scene', style: 'vivid' }), { code: 'unsupported-parameters' });
    }
});
