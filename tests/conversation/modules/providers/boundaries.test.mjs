import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { encodeNovelImage } from '../../../../src/conversation/providers/auxiliary/novelai.js';
import { createProviderAdapter } from '../../../../src/conversation/providers/chat/index.js';
import { fromPiContext, createProviderStream, createProviderModel } from '../../../../src/conversation/providers/chat/bridge.js';
const connection = (provider, type = 'chat', extra = {}) => ({ provider, type, model: 'model', baseUrl: 'https://synthetic.invalid', contextWindow: 8192, maxOutputTokens: 2048, workingBudget: 4096, stream: false, ...extra });
const messages = [{ role: 'user', content: 'input' }];
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

for (const model of ['nai-diffusion-4-full', 'nai-diffusion-4-curated-preview', 'nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated']) test(`NovelAI ${model} encodes positive/negative character captions`, () => {
    const input = Object.freeze({ prompt: 'scene', negativePrompt: 'undesired', characters: Object.freeze([Object.freeze({ prompt: 'actor', negativePrompt: 'hat', center: Object.freeze({ x: 0.1, y: 0.9 }) })]), useCoordinates: true });
    const output = encodeNovelImage(model, input);
    assert.equal(output.parameters.params_version, 3);
    assert.equal(output.parameters.v4_prompt.caption.base_caption, 'scene');
    assert.deepEqual(output.parameters.v4_prompt.caption.char_captions, [{ char_caption: 'actor', centers: [{ x: 0.1, y: 0.9 }] }]);
    assert.equal(output.parameters.v4_negative_prompt.caption.char_captions[0].char_caption, 'hat');
    assert.equal(output.parameters.v4_prompt.use_coords, true);
    output.parameters.characterPrompts[0].center.x = 0.5;
    assert.equal(input.characters[0].center.x, 0.1);
});
test('NovelAI classic format remains classic; V4 default captions work without characters', () => {
    assert.equal(encodeNovelImage('nai-diffusion-3', { prompt: 'scene' }).parameters.v4_prompt, undefined);
    assert.deepEqual(encodeNovelImage('nai-diffusion-4-full', { prompt: 'scene' }).parameters.v4_prompt.caption.char_captions, []);
    assert.throws(() => encodeNovelImage('nai-diffusion-3', { prompt: 'x', characters: [{ prompt: 'actor' }] }), { code: 'unsupported-parameters' });
    assert.throws(() => encodeNovelImage('nai-diffusion-4-full', { prompt: 'x', characters: [{ prompt: 'actor', center: { x: 2, y: 0 } }] }), { code: 'invalid-image-options' });
    assert.throws(() => encodeNovelImage('nai-diffusion-4-full', { prompt: 'x', width: 1000 }), { code: 'invalid-image-options' });
});
test('NovelAI V4 adapter sends native fields and decodes returned image ZIP', async () => {
    let body;
    const adapter = createProviderAdapter(connection('novelai', 'image', { model: 'nai-diffusion-4-5-full' }), { fetch: async request => {
        body = await request.json(); return new Response(zipSync({ 'image.png': strToU8('image-bytes') }));
    } });
    const result = await adapter.generateImage({ prompt: 'scene', negativePrompt: 'blur' });
    assert.equal(body.parameters.v4_negative_prompt.caption.base_caption, 'blur');
    assert.equal(result.images[0].mimeType, 'image/png');
});
test('unsupported image options are rejected before chargeable request', async () => {
    let called = false;
    const adapter = createProviderAdapter(connection('openai', 'image'), { fetch: async () => { called = true; } });
    await assert.rejects(adapter.generateImage({ prompt: 'scene', seed: 8 }), { code: 'unsupported-parameters' });
    await assert.rejects(adapter.generateImage({ prompt: 'scene', characters: [] }), { code: 'unsupported-parameters' });
    assert.equal(called, false);
});
test('archive with more than four images fails instead of unbounded decompression', async () => {
    const archive = zipSync(Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`${index}.png`, strToU8('image')])));
    const adapter = createProviderAdapter(connection('novelai', 'image'), { fetch: async () => new Response(archive) });
    await assert.rejects(adapter.generateImage({ prompt: 'scene' }), { code: 'provider-response-invalid' });
});
test('bare DONE and blocked responses cannot fabricate completion', async () => {
    const adapter = createProviderAdapter(connection('openai', 'chat', { stream: true }), { fetch: async () => new Response('data: [DONE]\n\n') });
    await assert.rejects(adapter.generate({ messages }), { code: 'provider-response-invalid' });
    const refusal = createProviderAdapter(connection('openai'), { fetch: async () => json({ choices: [{ message: { refusal: 'blocked', content: null }, finish_reason: 'stop' }] }) });
    await assert.rejects(refusal.generate({ messages }), { code: 'provider-content-blocked' });
});
test('Pi prefix section replacements remove old text; unknown assistant media never disappears', () => {
    const request = fromPiContext({ messages: [{ role: 'system', content: 'prefix', sections: { a: 'old' } }, { role: 'system', content: '', sections: { a: 'new' } }, ...messages] }, 'openai-chat');
    assert.deepEqual(request.messages.map(message => message.content), ['prefix', 'new', 'input']);
    assert.throws(() => fromPiContext({ messages: [{ role: 'assistant', content: [{ type: 'image', data: 'AAAA' }] }] }, 'openai-chat'), { code: 'unsupported-media' });
});
test('failed tool result retains error flag on Anthropic wire', async () => {
    let body;
    const adapter = createProviderAdapter(connection('anthropic'), { fetch: async request => { body = await request.json(); return json({ content: [{ type: 'text', text: 'answer' }], stop_reason: 'end_turn' }); } });
    await adapter.generate({ messages: [...messages, { role: 'assistant', content: '', toolCalls: [{ id: 'call', name: 'tool', args: {} }] }, { role: 'tool', toolCallId: 'call', content: 'failed', isError: true }] });
    assert.equal(body.messages.at(-1).content[0].is_error, true);
});
test('unknown cache usage stays unknown; reported cache/reasoning remain subsets', async () => {
    const c = connection('openai');
    const stream = createProviderStream(c, { fetch: async () => json({ choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20 } }) })(createProviderModel(c), { messages });
    for await (const _ of stream) { /* consume */ }
    assert.ok(Number.isNaN((await stream.result()).usage.cacheRead));
    const adapter = createProviderAdapter(c, { fetch: async () => json({ choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 5 }, completion_tokens_details: { reasoning_tokens: 12 } } }) });
    const result = await adapter.generate({ messages });
    assert.equal(result.usage.totalTokens, 30); assert.equal(result.usage.cacheReadTokens, 5); assert.equal(result.usage.reasoningTokens, 12);
});
test('Horde resume never re-submits; submitted ID is observable before poll errors', async () => {
    const requests = [];
    const adapter = createProviderAdapter(connection('horde', 'text', { pollIntervalMs: 0 }), { fetch: async request => { requests.push(request.method); return json({ done: true, generations: [{ text: 'recovered' }] }); } });
    assert.equal((await adapter.generate({ prompt: 'original', jobId: 'persisted-id' })).content, 'recovered');
    assert.deepEqual(requests, ['GET']);
    let saved;
    const broken = createProviderAdapter(connection('horde', 'text', { pollIntervalMs: 0 }), { fetch: async request => request.method === 'POST' ? json({ id: 'new-id' }) : new Response('', { status: 503 }) });
    await assert.rejects(broken.generate({ prompt: 'original', onJob: record => { saved = record.jobId; } }), error => error.details.jobId === 'new-id' && error.details.resubmit === false);
    assert.equal(saved, 'new-id');
});
test('Google embedding maps query task and validates requested dimensions', async () => {
    let body;
    const adapter = createProviderAdapter(connection('google', 'embedding'), { fetch: async request => { body = await request.json(); return json({ embeddings: [{ values: [1, 2] }] }); } });
    await adapter.embed(['query'], { inputType: 'search_query', dimensions: 2 });
    assert.equal(body.requests[0].taskType, 'RETRIEVAL_QUERY');
    await assert.rejects(adapter.embed(['query'], { dimensions: 3 }), { code: 'provider-response-invalid' });
});

test('runtime idempotency metadata is accepted without inventing an upstream field', async () => {
    let body;
    const adapter = createProviderAdapter(connection('openai', 'image'), { fetch: async request => { body = await request.json(); return json({ data: [{ b64_json: 'UE5H' }] }); } });
    await adapter.generateImage({ prompt: 'scene', idempotencyKey: 'durable-tool-id' });
    assert.equal(body.idempotencyKey, undefined);
    assert.deepEqual(adapter.capabilities.types, []);
    assert.ok(adapter.capabilities.operationParameters.generateImage.includes('prompt'));
});

test('multipart boundary replaces stale custom content type', async () => {
    let contentType;
    const adapter = createProviderAdapter(connection('stability', 'image', { headers: { 'content-type': 'application/json' } }), { fetch: async request => {
        contentType = request.headers.get('content-type');
        assert.equal((await request.formData()).get('prompt'), 'scene');
        return new Response('image', { headers: { 'content-type': 'image/png' } });
    } });
    await adapter.generateImage({ prompt: 'scene' });
    assert.match(contentType, /^multipart\/form-data; boundary=/);
});

test('Google audio/video/PDF and file URI preserve typed input and explicit budget', async () => {
    const content = [
        { type: 'audio', mimeType: 'audio/wav', data: 'AAAA' },
        { type: 'video', mimeType: 'video/mp4', url: 'gs://test-bucket/movie.mp4' },
        { type: 'document', mimeType: 'application/pdf', data: 'BBBB' },
    ];
    let body;
    await createProviderAdapter(connection('google', 'chat', { mediaTokenCost: { audio: 100, video: 200, document: 300 } }), {
        fetch: async request => { body = await request.json(); return json({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }); },
    }).generate({ messages: [{ role: 'user', content }] });
    assert.deepEqual(body.contents[0].parts, [
        { inlineData: { mimeType: 'audio/wav', data: 'AAAA' } },
        { fileData: { mimeType: 'video/mp4', fileUri: 'gs://test-bucket/movie.mp4' } },
        { inlineData: { mimeType: 'application/pdf', data: 'BBBB' } },
    ]);
    await assert.rejects(createProviderAdapter(connection('google'), { fetch: () => assert.fail('network') }).generate({ messages: [{ role: 'user', content }] }), { code: 'media-budget-unknown' });
});

test('Anthropic PDF and OpenAI audio/file use their distinct native codecs', async () => {
    for (const provider of ['anthropic', 'openai']) {
        let body;
        const content = [{ type: 'document', mimeType: 'application/pdf', data: 'AAAA', filename: 'a.pdf' }];
        if (provider === 'openai') content.push({ type: 'audio', mimeType: 'audio/mpeg', data: 'BBBB' });
        await createProviderAdapter(connection(provider, 'chat', { mediaTokenCost: { document: 100, audio: 100 } }), {
            fetch: async request => { body = await request.json(); return json(provider === 'anthropic' ? { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' } : { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }); },
        }).generate({ messages: [{ role: 'user', content }] });
        const actual = body.messages[0].content;
        if (provider === 'anthropic') assert.deepEqual(actual, [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' } }]);
        else assert.deepEqual(actual, [{ type: 'file', file: { filename: 'a.pdf', file_data: 'data:application/pdf;base64,AAAA' } }, { type: 'input_audio', input_audio: { data: 'BBBB', format: 'mp3' } }]);
    }
});

test('unsupported media and malformed MIME fail before network', async () => {
    for (const [provider, content] of [
        ['anthropic', [{ type: 'audio', mimeType: 'audio/wav', data: 'AAAA' }]],
        ['openai', [{ type: 'video', mimeType: 'video/mp4', data: 'AAAA' }]],
        ['google', [{ type: 'document', mimeType: 'video/mp4', data: 'AAAA' }]],
        ['openai', [{ type: 'audio', mimeType: 'audio/wav', url: 'https://test.invalid/a.wav' }]],
    ]) await assert.rejects(createProviderAdapter(connection(provider, 'chat', { mediaTokenCost: { audio: 100, video: 100, document: 100 } }), { fetch: () => assert.fail('network') }).generate({ messages: [{ role: 'user', content }] }));
});

test('Pi providerParts carries full user blocks; model retains legal Pi input types', async () => {
    const providerParts = [{ type: 'text', text: 'read' }, { type: 'document', mimeType: 'application/pdf', data: 'AAAA' }];
    const c = connection('google', 'chat', { mediaTokenCost: { document: 100 } });
    const context = { messages: [{ role: 'user', content: [{ type: 'text', text: 'read' }], providerParts }] };
    assert.deepEqual(fromPiContext(context, 'google-generate-content').messages[0].content, providerParts);
    const model = createProviderModel(c);
    assert.deepEqual(model.input, ['text']); assert.deepEqual(model.providerMedia, ['text', 'document']);
    let body;
    const stream = createProviderStream(c, { fetch: async request => { body = await request.json(); return json({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 } }); } })(model, context);
    const events = []; for await (const event of stream) events.push(event);
    assert.equal(events.at(-1).type, 'done');
    assert.equal(body.contents[0].parts[1].inlineData.mimeType, 'application/pdf');
    assert.equal(events.at(-1).message.providerUsage.raw.totalTokenCount, 7);
});

for (const provider of ['ooba', 'koboldcpp']) test(`text guidance payload: ${provider}`, async () => {
    for (const stream of [false, true]) {
        let body;
        const c = connection(provider, 'text', { stream, parameters: { guidance_scale: 1.5, negative_prompt: 'avoid this' } });
        const adapter = createProviderAdapter(c, { fetch: async request => {
            body = await request.json();
            if (stream) return new Response(provider === 'ooba' ? 'data: {"choices":[{"text":"yes","finish_reason":"stop"}]}\n\ndata: [DONE]\n\n' : 'data: {"token":"yes"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
            return json(provider === 'ooba' ? { choices: [{ text: 'yes' }] } : { results: [{ text: 'yes' }] });
        } });
        assert.equal((await adapter.generate({ prompt: 'positive' })).content, 'yes');
        assert.equal(body.prompt, 'positive'); assert.equal(body.guidance_scale, 1.5); assert.equal(body.negative_prompt, 'avoid this');
    }
    assert.throws(() => createProviderAdapter(connection(provider, 'text', { parameters: { guidance_scale: 0 } })), { code: 'invalid-parameters' });
});

test('guidance unsupported providers reject explicit configuration', () => {
    assert.throws(() => createProviderAdapter(connection('ollama', 'text', { parameters: { negative_prompt: 'x' } })), { code: 'unsupported-provider' });
});

test('native text multimodal side channels preserve inline bytes and reject unsupported types', async () => {
    for (const provider of ['koboldcpp', 'ollama']) {
        let body;
        const content = [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }];
        if (provider === 'koboldcpp') content.push({ type: 'audio', mimeType: 'audio/wav', data: 'BBBB' });
        const adapter = createProviderAdapter(connection(provider, 'text', { mediaTokenCost: { image: 100, audio: 100 } }), { fetch: async request => { body = await request.json(); return json(provider === 'ollama' ? { response: 'ok' } : { results: [{ text: 'ok' }] }); } });
        await adapter.generate({ prompt: 'compiled', messages: [{ role: 'user', content }] });
        assert.deepEqual(body.images, ['AAAA']); if (provider === 'koboldcpp') assert.deepEqual(body.audio, ['BBBB']);
    }
});

test('chat raw usage keeps vendor extensions without double-counting compatible subsets', async () => {
    const raw = { prompt_tokens: 20, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 8 }, completion_tokens_details: { reasoning_tokens: 4 }, vendor_billing: { units: 7 } };
    const result = await createProviderAdapter(connection('openai'), { fetch: async () => json({ choices: [{ message: { content: 'ok' } }], usage: raw }) }).generate({ messages });
    assert.deepEqual(result.usage.raw, raw); assert.equal(result.usage.totalTokens, 30);
    assert.equal(result.usage.cacheReadIncludedInInput, true); assert.equal(result.usage.reasoningIncludedInOutput, true);
});

test('text usage retains raw provider counters for JSON and streams; bare terminator fails', async () => {
    for (const stream of [false, true]) {
        const usage = { prompt_tokens: 9, completion_tokens: 3, vendor_units: 2 };
        const data = { choices: [{ text: 'ok', finish_reason: 'stop' }], usage };
        const result = await createProviderAdapter(connection('generic', 'text', { stream }), { fetch: async () => stream ? new Response(`data: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n`) : json(data) }).generate({ prompt: 'x' });
        assert.deepEqual(result.usage.raw, usage); assert.equal(result.usage.totalTokens, 12);
    }
    await assert.rejects(createProviderAdapter(connection('generic', 'text', { stream: true }), { fetch: async () => new Response('data: [DONE]\n\n') }).generate({ prompt: 'x' }), { code: 'provider-response-invalid' });
});

for (const stream of [false, true]) test(`DeepSeek explicit thinking toggle, native effort and raw usage (stream=${stream})`, async () => {
    const raw = { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, prompt_cache_hit_tokens: 8, prompt_cache_miss_tokens: 12, completion_tokens_details: { reasoning_tokens: 4 } };
    for (const [settings, enabled, effort] of [
        [{}, false], [{ reasoning: 'off' }, false], [{ reasoning: 'high' }, true, 'high'], [{ reasoning: 'max' }, true, 'max'],
        [{ reasoning: 'medium' }, true, 'high'], [{ effort: 'low' }, true, 'low'], [{ reasoning: { effort: 'max' } }, true, 'max'],
        [{ reasoning: 'max', reasoningEnabled: false }, false],
    ]) {
        let body;
        const c = connection('deepseek', 'chat', { model: 'deepseek-v4-flash', stream, ...settings });
        const result = await createProviderAdapter(c, { fetch: async request => {
            body = await request.json();
            if (!stream) return json({ choices: [{ message: { content: 'answer', reasoning_content: enabled ? 'think' : '' }, finish_reason: 'stop' }], usage: raw });
            return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'answer', reasoning_content: enabled ? 'think' : '' }, finish_reason: 'stop' }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: raw })}\n\ndata: [DONE]\n\n`);
        } }).generate({ messages });
        assert.deepEqual(body.thinking, { type: enabled ? 'enabled' : 'disabled' }); assert.equal(body.reasoning_effort, effort);
        assert.equal(body.model, 'deepseek-v4-flash'); assert.deepEqual(result.usage.raw, raw);
        assert.equal(result.usage.cacheReadTokens, 8); assert.equal(result.usage.cacheMissTokens, 12);
        assert.equal(result.usage.totalTokens, 30); assert.equal(result.usage.reasoningTokens, 4);
        assert.equal(result.usage.reasoningIncludedInOutput, true); assert.equal(result.usage.cacheReadIncludedInInput, true);
    }
});

test('DeepSeek ignored sampling controls reject before fetch and tool reasoning replays intact', async () => {
    for (const [reasoning, parameters] of [['high', { temperature: 0.5 }], ['high', { top_p: 0.8 }], ['off', { top_p: 0.8 }]]) {
        await assert.rejects(createProviderAdapter(connection('deepseek', 'chat', { reasoning, parameters }), { fetch: () => assert.fail('network') }).generate({ messages }));
    }
    let body;
    const replay = fromPiContext({ messages: [
        { role: 'user', content: 'question' },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'preserved' }, { type: 'toolCall', id: 'call', name: 'lookup', arguments: {} }] },
        { role: 'toolResult', toolCallId: 'call', toolName: 'lookup', content: [{ type: 'text', text: 'found' }] },
    ], tools: [{ name: 'lookup', parameters: { type: 'object' } }] }, 'openai-chat');
    await createProviderAdapter(connection('deepseek', 'chat', { reasoning: 'max' }), { fetch: async request => { body = await request.json(); return json({ choices: [{ message: { content: 'ok' } }] }); } }).generate(replay);
    assert.equal(body.messages[1].reasoning_content, 'preserved'); assert.equal(body.tools[0].function.name, 'lookup');
});

test('OpenRouter uses native off/effort/budget objects; generic APIs stay unchanged', async () => {
    for (const [settings, expected] of [[{reasoning:'off'},{enabled:false}], [{reasoning:'high'},{enabled:true,effort:'high'}], [{reasoning:'budget',reasoningBudget:1024},{enabled:true,max_tokens:1024}], [{reasoning:'on'},{enabled:true}]]) {
        let body;
        await createProviderAdapter(connection('openrouter','chat',settings), { fetch: async request => { body=await request.json(); return json({choices:[{message:{content:'ok'}}]}); } }).generate({messages});
        assert.deepEqual(body.reasoning,expected); assert.equal(body.reasoning_effort,undefined);
    }
});

test('OpenRouter JSON signed/encrypted reasoning survives Pi done and tool continuation', async () => {
    const details=[{type:'reasoning.text',text:'think',signature:'signed',index:0},{type:'reasoning.encrypted',data:'opaque',id:'r1',index:1}];
    const c=connection('openrouter','chat',{reasoning:'high'});
    let body;
    const streamFn=createProviderStream(c,{fetch:async request=>{body=await request.json();return json({choices:[{message:{content:'',reasoning:'think',reasoning_details:details,tool_calls:[{id:'t1',function:{name:'lookup',arguments:'{}'}}]},finish_reason:'tool_calls'}]});}});
    const initial={messages:[{role:'user',content:'x'}],tools:[{name:'lookup',parameters:{type:'object'}}]};
    const events=[];for await(const e of streamFn(createProviderModel(c),initial)) events.push(e);
    const assistant=events.at(-1).message;
    assert.equal(events.at(-1).type,'done');assert.deepEqual(assistant.providerContent,details);
    assert.equal(assistant.content.find(p=>p.type==='thinking').thinking,'think');
    const replay=fromPiContext({...initial,messages:[...initial.messages,assistant,{role:'toolResult',toolCallId:'t1',toolName:'lookup',content:[{type:'text',text:'found'}]}]},'openai-chat');
    await createProviderAdapter(c,{fetch:async request=>{body=await request.json();return json({choices:[{message:{content:'done'}}]});}}).generate(replay);
    assert.deepEqual(body.messages[1].reasoning_details,details);assert.equal(body.messages[1].reasoning,'think');assert.equal(body.messages[1].reasoning_content,undefined);
});

test('OpenRouter streamed detail fragments concatenate signatures and opaque data without losing blocks',async()=>{
    const chunks=[
        {reasoning_details:[{type:'reasoning.text',index:0,text:'th',signature:null}]},
        {reasoning_details:[{type:'reasoning.text',index:0,text:'ink',signature:'sig'}]},
        {reasoning_details:[{type:'reasoning.text',index:0,signature:'nature'},{type:'reasoning.encrypted',index:1,data:'AA'}]},
        {reasoning_details:[{type:'reasoning.encrypted',index:1,data:'BB'}],content:'ok'},
    ];
    const frames=chunks.map((delta,i)=>`data: ${JSON.stringify({choices:[{delta,...(i===3?{finish_reason:'stop'}:{})}]})}\n\n`).join('')+'data: [DONE]\n\n';
    const result=await createProviderAdapter(connection('openrouter','chat',{stream:true}),{fetch:async()=>new Response(frames)}).generate({messages});
    assert.equal(result.reasoning,'think');assert.equal(result.content,'ok');
    assert.deepEqual(result.providerContent,[{type:'reasoning.text',index:0,text:'think',signature:'signature'},{type:'reasoning.encrypted',index:1,data:'AABB'}]);
});

test('OpenAI only requests stream usage when streaming, and receives the usage-only final chunk',async()=>{
    for (const stream of [true,false]) {
        let body;
        const result=await createProviderAdapter(connection('openai','chat',{stream}),{fetch:async request=>{
            body=await request.json();
            if (!stream) return json({choices:[{message:{content:'ok'}}]});
            assert.deepEqual(body.stream_options,{include_usage:true});
            return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\ndata: [DONE]\n\n');
        }}).generate({messages});
        if(stream) assert.equal(result.usage.raw.total_tokens,7);else assert.equal(body.stream_options,undefined);
    }
});

for (const stream of [false,true]) test(`NovelAI stop injection encodes native token arrays (stream=${stream})`,async()=>{
    let body;const seen=[];
    const adapter=createProviderAdapter(connection('novelai','text',{stream,parameters:{stop:['END','停止']}}),{
        tokenize:async(text,{model})=>{seen.push([text,model]);return text==='END'?[1,2]:new Int32Array([3]);},
        fetch:async request=>{body=await request.json();return stream?new Response('data: {"token":"ok"}\n\n'):json({output:'ok'});},
    });
    assert.equal((await adapter.generate({prompt:'x'})).content,'ok');
    assert.deepEqual(body.parameters.stop_sequences,[[1,2],[3]]);assert.equal(body.parameters.stop,undefined);assert.equal(seen.length,2);
});

test('NovelAI bundled tokenizer emits actual Clio/Kayra/Erato IDs without remote calls',async()=>{
    for(const [model,expected] of [['clio-v1',[13071]],['kayra-v1',[13071]],['erato-v1',[9906]]]) {
        let body;
        await createProviderAdapter(connection('novelai','text',{model,parameters:{stop:'Hello'}}),{fetch:async request=>{body=await request.json();return json({output:'ok'});}}).generate({prompt:'x'});
        assert.deepEqual(body.parameters.stop_sequences,[expected]);
    }
});

test('NovelAI invalid tokens, missing model tokenizer, empty stop and abort all fail before generation',async()=>{
    for(const tokenize of [async()=>[],async()=>[-1],async()=>[1.5],async()=>['1']]) await assert.rejects(createProviderAdapter(connection('novelai','text',{parameters:{stop:'x'}}),{tokenize,fetch:()=>assert.fail('network')}).generate({prompt:'x'}),{code:'invalid-tokenization'});
    assert.throws(()=>createProviderAdapter(connection('novelai','text',{parameters:{stop:'x'}}),{fetch:()=>assert.fail('network')}),{code:'unsupported-provider'});
    assert.throws(()=>createProviderAdapter(connection('novelai','text',{parameters:{stop:''}}),{fetch:()=>assert.fail('network')}),{code:'unsupported-provider'});
    const controller=new AbortController();
    await assert.rejects(createProviderAdapter(connection('novelai','text',{parameters:{stop:'x'}}),{tokenize:async()=>{controller.abort();return [1];},fetch:()=>assert.fail('network')}).generate({prompt:'x',signal:controller.signal}),{name:'AbortError'});
});

test('NovelAI capability preflight rejects unknown tokenizer models before adapter creation',async()=>{
    const { getTextCapabilities }=await import('../../../../src/conversation/capabilities/text/index.js');
    for(const model of ['new-model','kayra-v2','erato-next']) {
        const c=connection('novelai','text',{model,parameters:{stop:'END'}});
        const cap=getTextCapabilities(c);
        assert.equal(cap.supported,false);assert.deepEqual(cap.types,[]);assert.match(cap.reason,/tokenizer unavailable/);
        assert.equal(cap.stopTokenization.source,'unavailable');
        assert.throws(()=>createProviderAdapter(c,{fetch:()=>assert.fail('network')}),{code:'unsupported-provider'});
        const injected=getTextCapabilities(c,{tokenize:async()=>[1]});
        assert.equal(injected.supported,true);assert.equal(injected.stopTokenization.source,'injected');
        assert.equal(getTextCapabilities({...c,parameters:{}}).supported,true);
    }
    assert.equal(getTextCapabilities(connection('novelai','text',{model:'kayra-v1',parameters:{stop:'END'}})).stopTokenization.family,'kayra');
});

test('fresh Clio Kayra Erato tokenizer loading succeeds with all network entry points disabled',async(t)=>{
    const http=await import('node:http'); const https=await import('node:https');const net=await import('node:net');
    const noNetwork=()=>assert.fail('Tokenizer attempted network I/O');
    t.mock.method(globalThis,'fetch',noNetwork);
    for(const module of [http.default,https.default]) for(const method of ['request','get']) t.mock.method(module,method,noNetwork);
    t.mock.method(net.default.Socket.prototype,'connect',noNetwork);
    const { createNovelTokenizer }=await import('../../../../src/conversation/providers/text/novel-tokenizer.js');
    const tokenize=createNovelTokenizer();
    for(const [model,expected] of [['clio-v1',[13071]],['kayra-v1',[13071]],['erato-v1',[9906]]]) assert.deepEqual(await tokenize('Hello',{model}),expected);
});
