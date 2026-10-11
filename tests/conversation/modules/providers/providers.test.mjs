import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { createProviderAdapter } from '../../../../src/conversation/providers/chat/index.js';
import { createProviderStream, createProviderModel, fromPiContext } from '../../../../src/conversation/providers/chat/bridge.js';
import { CHAT_PROVIDERS, getChatCapabilities } from '../../../../src/conversation/capabilities/chat/index.js';
import { TEXT_PROVIDERS } from '../../../../src/conversation/capabilities/text/index.js';
import { AUXILIARY_PROVIDERS } from '../../../../src/conversation/capabilities/auxiliary/index.js';

const base = (provider, type = 'chat', extra = {}) => ({ provider, type, executor: 'pi', baseUrl: 'https://synthetic.invalid/root', model: 'test-model',
    contextWindow: 8192, maxOutputTokens: 2048, workingBudget: 4096, apiKey: 'FAKE_TEST_SECRET', stream: false,
    deployment: 'deployment', apiVersion: 'test-version', ...extra });
const messages = [{ role: 'system', content: 'system' }, { role: 'user', content: 'hello' }];
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
function fake(data) {
    const requests = [];
    return { requests, fetch: async request => { requests.push({ url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body: request.method === 'GET' ? undefined : await request.clone().json() }); return json(typeof data === 'function' ? data(requests.length) : data); } };
}
function chatResponse(api) {
    if (api === 'anthropic-messages') return { content: [{ type: 'text', text: 'answer' }], usage: { input_tokens: 5, output_tokens: 2 }, stop_reason: 'end_turn' };
    if (api.startsWith('google')) return { candidates: [{ content: { parts: [{ text: 'answer' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 } };
    if (api === 'cohere-v2') return { message: { content: [{ type: 'text', text: 'answer' }] }, usage: { tokens: { input_tokens: 5, output_tokens: 2 } }, finish_reason: 'COMPLETE' };
    return { choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } };
}
for (const [provider, profile] of Object.entries(CHAT_PROVIDERS)) test(`chat codec: ${provider} -> ${profile.api}`, async () => {
    const mock = fake(chatResponse(profile.api));
    const result = await createProviderAdapter(base(provider), mock).generate({ messages });
    assert.equal(result.content, 'answer'); assert.equal(result.usage.inputTokens, 5);
    const sent = mock.requests[0];
    if (profile.api === 'anthropic-messages') { assert.equal(sent.body.system[0].text, 'system'); assert.equal(sent.headers['x-api-key'], 'FAKE_TEST_SECRET'); assert.ok(!sent.headers.authorization); }
    else if (profile.api.startsWith('google')) { assert.equal(sent.body.contents[0].parts[0].text, 'hello'); assert.equal(sent.body.systemInstruction.parts[0].text, 'system'); }
    else { assert.equal(sent.body.messages[1].content, 'hello'); assert.equal(sent.body.max_tokens, 2048); }
    if (profile.api === 'azure-chat') { assert.match(sent.url, /deployments\/deployment\/chat\/completions\?api-version=test-version/); assert.equal(sent.headers['api-key'], 'FAKE_TEST_SECRET'); }
});

function textResponse(api, count) {
    if (api === 'horde-text') return count === 1 ? { id: 'job-1' } : { done: true, generations: [{ text: 'answer' }] };
    if (api === 'kobold') return { results: [{ text: 'answer' }] };
    if (api === 'novelai') return { output: 'answer' };
    if (api === 'ollama-generate') return { response: 'answer', prompt_eval_count: 5, eval_count: 2, done: true };
    if (api === 'llamacpp') return { content: 'answer', tokens_evaluated: 5, tokens_predicted: 2 };
    if (api === 'huggingface-tgi') return { generated_text: 'answer', details: { generated_tokens: 2 } };
    return { choices: [{ text: 'answer', finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } };
}
for (const [provider, profile] of Object.entries(TEXT_PROVIDERS)) test(`text codec: ${provider} -> ${profile.api}`, async () => {
    const mock = fake(count => textResponse(profile.api, count));
    const adapter = createProviderAdapter(base(provider, 'text', { pollIntervalMs: 0 }), mock);
    const result = await adapter.generate({ prompt: 'formatted prompt' });
    assert.equal(result.content, 'answer'); assert.equal(adapter.capabilities.tools, false);
    assert.ok(JSON.stringify(mock.requests[0].body).includes('formatted prompt'));
    assert.match(mock.requests[0].url, new RegExp(profile.path.replaceAll('/', '\\/') + '$'));
    await assert.rejects(adapter.generate({ prompt: 'x', tools: [{ name: 'test' }] }), { code: 'unsupported-tools' });
});

function sse(frames) {
    const text = frames.map(item => typeof item === 'string' ? `data: ${item}\r\n\r\n` : `data: ${JSON.stringify(item)}\r\n\r\n`).join('');
    const bytes = new TextEncoder().encode(text);
    return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}
const openaiFrames = [
    { choices: [{ delta: { reasoning_content: 'think' } }] }, { choices: [{ delta: { content: '你好' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'recall', arguments: '{"q":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 9 } }, '[DONE]',
];
const anthropicFrames = [
    { type: 'message_start', message: { content: [], usage: { input_tokens: 5 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'think' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '你好' } },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'call-1', name: 'recall', input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"q":"x"}' } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } }, { type: 'message_stop' },
];
const googleFrames = [
    { candidates: [{ content: { parts: [{ text: 'think', thought: true, thoughtSignature: 'signed' }] } }] },
    { candidates: [{ content: { parts: [{ text: '你好' }, { functionCall: { name: 'recall', args: { q: 'x' } }, thoughtSignature: 'sig-tool' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 9, totalTokenCount: 14 } },
];
const cohereFrames = [
    { type: 'content-start', index: 0, delta: { message: { content: { type: 'thinking', thinking: '' } } } },
    { type: 'content-delta', index: 0, delta: { message: { content: { thinking: 'think' } } } },
    { type: 'content-start', index: 1, delta: { message: { content: { type: 'text', text: '' } } } },
    { type: 'content-delta', index: 1, delta: { message: { content: { text: '你好' } } } },
    { type: 'tool-call-start', index: 0, delta: { message: { tool_calls: { id: 'call-1', function: { name: 'recall', arguments: '' } } } } },
    { type: 'tool-call-delta', index: 0, delta: { message: { tool_calls: { function: { arguments: '{"q":"x"}' } } } } },
    { type: 'message-end', delta: { finish_reason: 'TOOL_CALL', usage: { tokens: { input_tokens: 5, output_tokens: 9 } } } },
];
for (const [provider, frames, config] of [
    ['openai-compatible', openaiFrames, { reasoning: 'high' }], ['anthropic', anthropicFrames, { reasoning: 'budget', reasoningBudget: 1024 }],
    ['google', googleFrames, { reasoning: 'high' }], ['cohere', cohereFrames, { reasoning: 'budget', reasoningBudget: 500 }],
]) test(`${provider}: fragmented SSE thinking/text/tools/usage and Pi stream`, async () => {
    const c = base(provider, 'chat', { stream: true, ...config });
    let body;
    const deps = { fetch: async request => { body = await request.json(); return sse(frames); } };
    const events = [];
    const result = await createProviderAdapter(c, deps).generate({ messages, onEvent: event => events.push(event) });
    assert.equal(result.content, '你好'); assert.equal(result.reasoning, 'think'); assert.deepEqual(result.toolCalls[0].args, { q: 'x' });
    assert.equal(result.usage.inputTokens, 5); assert.equal(events.filter(event => event.type === 'text.delta').map(event => event.text).join(''), '你好');
    if (provider === 'anthropic') { assert.equal(body.thinking.budget_tokens, 1024); assert.equal(result.providerContent[0].signature, 'signed'); }
    if (provider === 'google') assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'high');
    if (provider === 'cohere') assert.equal(body.thinking.token_budget, 500);
    if (provider === 'openai-compatible') assert.equal(body.reasoning_effort, 'high');
    const native = createProviderStream(c, deps)(createProviderModel(c), { messages: [{ role: 'system', content: 'system', toolsAdded: [{ name: 'recall', parameters: { type: 'object' } }] }, { role: 'user', content: 'hello' }] });
    const piEvents = []; for await (const event of native) piEvents.push(event.type);
    assert.equal(piEvents[0], 'start'); assert.equal(piEvents.at(-1), 'done');
    assert.ok(piEvents.includes('thinking_delta')); assert.ok(piEvents.includes('text_delta')); assert.ok(piEvents.includes('toolcall_end'));
    const final = await native.result(); assert.equal(final.stopReason, 'toolUse');
    assert.equal(final.usage.output, 9); assert.ok(Number.isNaN(final.usage.cost.total));
});

test('Pi SystemMessage tools are replayed and tool results preserve identity', () => {
    const request = fromPiContext({ messages: [
        { role: 'system', content: 'system', toolsAdded: [{ name: 'old' }] },
        { role: 'user', content: 'question' }, { role: 'system', content: '', toolsRemoved: [{ name: 'old' }], toolsAdded: [{ name: 'new', parameters: {} }] },
        { role: 'assistant', content: [{ type: 'toolCall', id: 'call', name: 'new', arguments: { x: 1 } }] },
        { role: 'toolResult', toolCallId: 'call', toolName: 'new', content: [{ type: 'text', text: 'result' }] },
    ] }, 'openai-chat');
    assert.deepEqual(request.tools.map(tool => tool.name), ['new']); assert.equal(request.messages.at(-1).toolCallId, 'call');
});

test('Pi text stream uses supplied prompt compiler, never an internal model loop', async () => {
    const c = base('kobold', 'text'); const mock = fake({ results: [{ text: 'answer' }] });
    const stream = createProviderStream(c, { ...mock, renderPrompt: request => request.messages.map(message => `${message.role}: ${message.content}`).join('\n') })(createProviderModel(c), { messages: [{ role: 'user', content: 'hello' }] });
    const events = []; for await (const event of stream) events.push(event.type);
    assert.equal(events.at(-1), 'done'); assert.equal((await stream.result()).content[0].text, 'answer'); assert.equal(mock.requests.length, 1);
});

test('malformed/truncated stream and abort never produce a success', async () => {
    await assert.rejects(createProviderAdapter(base('openai', 'chat', { stream: true }), { fetch: async () => sse([{ choices: [{ delta: { content: 'partial' } }] }]) }).generate({ messages }), { code: 'provider-stream-truncated' });
    const controller = new AbortController(); controller.abort(); let called = false;
    await assert.rejects(createProviderAdapter(base('openai'), { fetch: async () => { called = true; } }).generate({ messages, signal: controller.signal }), { name: 'AbortError' });
    assert.equal(called, false);
});

test('request traces are redacted; HTTP errors never echo secrets; no retry', async () => {
    const traces = []; let calls = 0;
    const adapter = createProviderAdapter(base('openai'), { onRequest: trace => traces.push(trace), fetch: async () => { calls++; return new Response('FAKE_TEST_SECRET', { status: 429 }); } });
    await assert.rejects(adapter.generate({ messages: [{ role: 'user', content: 'FAKE_TEST_SECRET' }] }), error => error.code === 'provider-http-error' && !error.message.includes('FAKE_TEST_SECRET'));
    assert.equal(calls, 1); assert.ok(!JSON.stringify(traces).includes('FAKE_TEST_SECRET'));
});

test('native system placement/media and parameter overwrite fail before network', async () => {
    let calls = 0; const deps = { fetch: async () => { calls++; return json({}); } };
    await assert.rejects(createProviderAdapter(base('anthropic'), deps).generate({ messages: [...messages, { role: 'system', content: 'late' }] }), { code: 'unsupported-system-placement' });
    await assert.rejects(createProviderAdapter(base('google'), deps).generate({ messages: [{ role: 'user', content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] }] }), { code: 'media-budget-unknown' });
    assert.throws(() => createProviderAdapter(base('openai', 'chat', { parameters: { messages: [] } }), deps), { code: 'unsupported-provider' });
    assert.equal(calls, 0);
});

test('Horde polling is bounded and exposes pending job without a second submit', async () => {
    const mock = fake(n => n === 1 ? { id: 'job' } : { done: false });
    const adapter = createProviderAdapter(base('horde', 'text', { maxPolls: 2, pollIntervalMs: 0 }), mock);
    await assert.rejects(adapter.generate({ prompt: 'x' }), error => error.code === 'provider-poll-limit' && error.details.jobId === 'job');
    assert.equal(mock.requests.filter(request => request.method === 'POST').length, 1); assert.equal(mock.requests.length, 3);
});

for (const provider of ['openai', 'openai-compatible', 'cohere', 'google', 'ollama']) test(`embedding protocol: ${provider}`, async () => {
    const data = provider === 'cohere' ? { embeddings: { float: [[1, 2], [3, 4]] } } : provider === 'google' ? { embeddings: [{ values: [1, 2] }, { values: [3, 4] }] }
        : provider === 'ollama' ? { embeddings: [[1, 2], [3, 4]] } : { data: [{ index: 1, embedding: [3, 4] }, { index: 0, embedding: [1, 2] }] };
    const mock = fake(data); const result = await createProviderAdapter(base(provider, 'embedding'), mock).embed(['a', 'b']);
    assert.deepEqual(result.embeddings, [[1, 2], [3, 4]]);
});

for (const provider of ['openai', 'openai-compatible', 'automatic1111', 'horde', 'stability', 'novelai']) test(`image protocol: ${provider}`, async () => {
    let count = 0;
    const fetch = async request => {
        count++;
        if (provider === 'stability') { const form = await request.formData(); assert.equal(form.get('prompt'), 'test'); return new Response('PNG', { headers: { 'content-type': 'image/png' } }); }
        if (provider === 'novelai') return new Response(zipSync({ 'image.png': strToU8('PNG') }));
        if (provider === 'horde') return json(count === 1 ? { id: 'job' } : { done: true, generations: [{ img: 'https://synthetic.invalid/image.webp' }] });
        if (provider === 'automatic1111') return json({ images: ['UE5H'] });
        return json({ data: [{ b64_json: 'UE5H' }] });
    };
    const result = await createProviderAdapter(base(provider, 'image', { pollIntervalMs: 0 }), { fetch }).generateImage({ prompt: 'test' });
    assert.equal(result.images.length, 1); assert.equal(result.usage.cost, null);
});

test('canonical catalogs retain every distinct provider and protocol', () => {
    const chats = 'openai anthropic openrouter ai21 google vertexai mistral openai-compatible cohere perplexity groq electronhub chutes nanogpt deepseek aimlapi xai pollinations moonshot fireworks cometapi azure_openai zai siliconflow workers_ai minimax'.split(' ');
    const texts = 'ooba mancer vllm aphrodite tabby koboldcpp togetherai llamacpp ollama infermaticai dreamgen openrouter featherless huggingface openai-compatible kobold novelai horde'.split(' ');
    assert.ok(chats.every(key => CHAT_PROVIDERS[key])); assert.ok(texts.every(key => TEXT_PROVIDERS[key]));
    assert.ok(Object.keys(AUXILIARY_PROVIDERS).length >= 8); assert.equal(getChatCapabilities(base('google')).liveVerified, false);
});

for (const [provider, frames] of [
    ['openai-compatible', [{ choices: [{ text: 'an' }] }, { choices: [{ text: 'swer', finish_reason: 'stop' }] }, '[DONE]']],
    ['llamacpp', [{ content: 'answer', stop: false }, { content: '', stop: true, tokens_evaluated: 2, tokens_predicted: 1 }]],
    ['huggingface', [{ token: { text: 'answer', special: false } }, { token: { text: '</s>', special: true }, generated_text: 'answer', details: { generated_tokens: 1 } }]],
    ['koboldcpp', [{ token: 'answer' }]], ['novelai', [{ token: 'answer' }]],
]) test(`native text stream: ${provider}`, async () => {
    const events = [];
    const adapter = createProviderAdapter(base(provider, 'text', { stream: true }), { fetch: async () => sse(frames) });
    const result = await adapter.generate({ prompt: 'prompt', onEvent: event => events.push(event) });
    assert.equal(result.content, 'answer'); assert.ok(events.some(event => event.type === 'text.delta'));
});

test('Ollama native NDJSON stream reports measured usage', async () => {
    const adapter = createProviderAdapter(base('ollama', 'text', { stream: true }), { fetch: async () => new Response('{"response":"an","done":false}\n{"response":"swer","done":true,"prompt_eval_count":7,"eval_count":3}\n') });
    const result = await adapter.generate({ prompt: 'prompt' }); assert.equal(result.content, 'answer'); assert.equal(result.usage.totalTokens, 10);
});

test('explicit image budget enables wire image parts and signed Anthropic reasoning survives Pi replay', async () => {
    const mock = fake(chatResponse('anthropic-messages'));
    const c = base('anthropic', 'chat', { capabilities: { mediaTokenCost: { image: 1024 } } });
    await createProviderAdapter(c, mock).generate({ messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'UE5H' }] }] });
    assert.equal(mock.requests[0].body.messages[0].content[0].source.data, 'UE5H');
    const replay = fromPiContext({ messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'thought', thinkingSignature: 'signed' }, { type: 'text', text: 'answer' }] }] }, 'anthropic-messages');
    assert.equal(replay.messages[0].providerContent[0].signature, 'signed');
});

test('malformed vectors and image errors do not return fabricated success', async () => {
    const mock = fake({ data: [{ index: 0, embedding: [1, 2] }] });
    await assert.rejects(createProviderAdapter(base('openai', 'embedding'), mock).embed(['one', 'two']), { code: 'provider-response-invalid' });
    await assert.rejects(createProviderAdapter(base('novelai', 'image'), { fetch: async () => new Response('bad zip') }).generateImage({ prompt: 'test' }), { code: 'provider-response-invalid' });
});
