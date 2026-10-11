// Native codecs for all CHAT_PROVIDERS APIs. Real remote model/platform behavior is unverified.
import { fail } from '../core/index.js';
import { randomUUID } from 'node:crypto';
import { usage } from './http.js';

const parts = message => typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content ?? [];
function imageSource(part) {
    if (part.data && part.mimeType) return { data: part.data, mimeType: part.mimeType };
    const match = /^data:([^;]+);base64,(.+)$/s.exec(part.url ?? '');
    if (match) return { data: match[2], mimeType: match[1] };
    return { url: part.url };
}
function contentParts(message, api, capability) {
    return parts(message).map(part => {
        if (part.type === 'text') {
            if (typeof part.text !== 'string') throw fail('invalid-content', 'Text part requires text');
            return api.startsWith('google') ? { text: part.text } : { type: 'text', text: part.text };
        }
        if (part.type !== 'image' || !capability.media.includes('image')) throw fail('unsupported-media', 'Unsupported media for this protocol');
        const image = imageSource(part);
        if (!image.data && (typeof image.url !== 'string' || !/^https?:\/\//.test(image.url))) throw fail('invalid-content', 'Image requires base64 data or HTTP URL');
        if (api === 'anthropic-messages') return { type: 'image', source: image.data ? { type: 'base64', media_type: image.mimeType, data: image.data } : { type: 'url', url: image.url } };
        if (api.startsWith('google')) {
            if (!image.data) throw fail('unsupported-media', 'Google image parts require inline base64 data');
            return { inlineData: { mimeType: image.mimeType, data: image.data } };
        }
        return { type: 'image_url', image_url: { url: image.data ? `data:${image.mimeType};base64,${image.data}` : image.url } };
    });
}
function validateMessages(messages, tools, capability) {
    if (!Array.isArray(messages) || !messages.length) throw fail('invalid-content', 'Nonempty messages required');
    if (!capability.tools && (tools.length || messages.some(message => message.toolCalls?.length || message.role === 'tool'))) throw fail('unsupported-tools', 'Tools are unsupported by this provider');
    let nonSystem = false;
    const calls = new Set();
    for (const message of messages) {
        if (!['system', 'user', 'assistant', 'tool'].includes(message.role)) throw fail('unsupported-role', 'Unsupported message role');
        if (message.role === 'system' && nonSystem && capability.systemPlacement === 'prefix') throw fail('unsupported-system-placement', 'Native protocol supports prefix system instructions only');
        if (message.role !== 'system') nonSystem = true;
        if (message.reasoning && !message.providerContent && capability.api === 'anthropic-messages') throw fail('unsupported-reasoning-replay', 'Anthropic thinking replay requires signed providerContent');
        for (const call of message.toolCalls ?? []) { if (!call.id || calls.has(call.id)) throw fail('invalid-tool-group', 'Duplicate or missing tool call ID'); calls.add(call.id); }
        if (message.role === 'tool' && !calls.delete(message.toolCallId)) throw fail('invalid-tool-group', 'Orphan tool result');
    }
    if (calls.size) throw fail('invalid-tool-group', 'Finish pending tool results before another model call');
}
const stops = value => typeof value === 'string' ? [value] : value;
const callWire = call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args ?? call.arguments ?? {}) } });
const toolWire = tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } });

export function encodeChat(connection, capability, { messages, tools = [], maxOutputTokens }, sampling) {
    validateMessages(messages, tools, capability);
    const api = capability.api;
    if (api === 'anthropic-messages') {
        const { stop, ...rest } = sampling;
        return { model: connection.model, max_tokens: maxOutputTokens, ...rest, ...(stop ? { stop_sequences: stops(stop) } : {}),
            system: messages.filter(message => message.role === 'system').flatMap(message => contentParts(message, api, capability)),
            messages: messages.filter(message => message.role !== 'system').map(message => {
                if (message.role === 'tool') return { role: 'user', content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: contentParts(message, api, capability) }] };
                const content = message.providerContent ? structuredClone(message.providerContent) : contentParts(message, api, capability);
                if (!message.providerContent) for (const call of message.toolCalls ?? []) content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args ?? call.arguments ?? {} });
                return { role: message.role, content };
            }), ...(tools.length ? { tools: tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}) };
    }
    if (api.startsWith('google')) {
        const names = new Map(messages.flatMap(message => (message.toolCalls ?? []).map(call => [call.id, call.name])));
        const config = { maxOutputTokens };
        for (const [key, value] of Object.entries(sampling)) config[{ top_p: 'topP', top_k: 'topK', stop: 'stopSequences' }[key] ?? key] = key === 'stop' ? stops(value) : value;
        return { generationConfig: config,
            ...(messages.some(message => message.role === 'system') ? { systemInstruction: { parts: messages.filter(message => message.role === 'system').flatMap(message => contentParts(message, api, capability)) } } : {}),
            contents: messages.filter(message => message.role !== 'system').map(message => {
                if (message.role === 'tool') return { role: 'user', parts: [{ functionResponse: { name: names.get(message.toolCallId), response: { result: message.content } } }] };
                const output = message.providerContent ? structuredClone(message.providerContent) : contentParts(message, api, capability);
                if (!message.providerContent) for (const call of message.toolCalls ?? []) output.push({ functionCall: { name: call.name, args: call.args ?? call.arguments ?? {} }, ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}) });
                return { role: message.role === 'assistant' ? 'model' : 'user', parts: output };
            }), ...(tools.length ? { tools: [{ functionDeclarations: tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) }] } : {}) };
    }
    const transformed = messages.map(message => {
        const content = contentParts(message, api, capability);
        const output = { role: message.role, content: typeof message.content === 'string' ? message.content : content };
        if (message.name) output.name = message.name;
        if (message.toolCallId) output.tool_call_id = message.toolCallId;
        if (message.toolCalls?.length) output.tool_calls = message.toolCalls.map(callWire);
        if (message.reasoning) output.reasoning_content = message.reasoning;
        return output;
    });
    if (api === 'cohere-v2') {
        const params = {};
        for (const [key, value] of Object.entries(sampling)) params[{ top_p: 'p', top_k: 'k', stop: 'stop_sequences' }[key] ?? key] = key === 'stop' ? stops(value) : value;
        return { model: connection.model, messages: transformed, max_tokens: maxOutputTokens, ...params, ...(tools.length ? { tools: tools.map(toolWire) } : {}) };
    }
    return { model: connection.model, messages: transformed, ...sampling,
        [connection.maxTokensField === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens']: maxOutputTokens,
        ...(tools.length ? { tools: tools.map(toolWire) } : {}) };
}
function parseArgs(text) {
    if (text === undefined || text === '') return {};
    if (typeof text === 'object' && text !== null) return text;
    try { return JSON.parse(text); } catch { throw fail('provider-response-invalid', 'Invalid tool arguments'); }
}
export function decodeChat(api, data) {
    let content, reasoning = '', toolCalls = [], tokens, finishReason, providerContent;
    if (api === 'anthropic-messages') {
        if (!Array.isArray(data.content)) throw fail('provider-response-invalid', 'Missing Anthropic content');
        providerContent = data.content;
        content = data.content.filter(part => part.type === 'text').map(part => part.text).join('');
        reasoning = data.content.filter(part => part.type === 'thinking').map(part => part.thinking).join('');
        toolCalls = data.content.filter(part => part.type === 'tool_use').map(part => ({ id: part.id, name: part.name, args: part.input }));
        const input = data.usage?.input_tokens;
        const output = data.usage?.output_tokens;
        const cacheRead = data.usage?.cache_read_input_tokens;
        const cacheWrite = data.usage?.cache_creation_input_tokens;
        tokens = usage(input, output, { cacheReadTokens: cacheRead ?? null, cacheWriteTokens: cacheWrite ?? null,
            totalTokens: Number.isFinite(input) && Number.isFinite(output) ? input + output + (cacheRead ?? 0) + (cacheWrite ?? 0) : null });
        finishReason = data.stop_reason;
    } else if (api.startsWith('google')) {
        const candidate = data.candidates?.[0];
        if (!candidate?.content?.parts) throw fail('provider-response-invalid', 'No Google candidate (possibly blocked)');
        providerContent = candidate.content.parts;
        content = providerContent.filter(part => part.text && !part.thought).map(part => part.text).join('');
        reasoning = providerContent.filter(part => part.thought).map(part => part.text ?? '').join('');
        const responseId = data.responseId ?? randomUUID();
        toolCalls = providerContent.filter(part => part.functionCall).map((part, index) => ({ id: part.functionCall.id ?? `${responseId}-${index}`, name: part.functionCall.name, args: part.functionCall.args ?? {}, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) }));
        const output = data.usageMetadata?.candidatesTokenCount;
        tokens = usage(data.usageMetadata?.promptTokenCount, Number.isFinite(output) ? output + (data.usageMetadata?.thoughtsTokenCount ?? 0) : undefined, { reasoningTokens: data.usageMetadata?.thoughtsTokenCount ?? null, totalTokens: data.usageMetadata?.totalTokenCount ?? null });
        finishReason = candidate.finishReason;
    } else {
        const message = api === 'cohere-v2' ? data.message : data.choices?.[0]?.message;
        if (!message) throw fail('provider-response-invalid', 'Missing assistant message');
        content = typeof message.content === 'string' ? message.content : (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('');
        reasoning = message.reasoning_content ?? (Array.isArray(message.content) ? message.content.filter(part => part.type === 'thinking').map(part => part.thinking).join('') : '');
        toolCalls = (message.tool_calls ?? []).map(call => ({ id: call.id, name: call.function.name, args: parseArgs(call.function.arguments) }));
        tokens = api === 'cohere-v2' ? usage(data.usage?.tokens?.input_tokens, data.usage?.tokens?.output_tokens) : usage(data.usage?.prompt_tokens, data.usage?.completion_tokens);
        finishReason = api === 'cohere-v2' ? data.finish_reason : data.choices[0].finish_reason;
    }
    if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'content_filter', 'ERROR', 'ERROR_TOXIC'].includes(finishReason)) throw fail('provider-content-blocked', 'Provider did not complete the requested output');
    if (typeof content !== 'string' || toolCalls.some(call => !call.id || !call.name || !call.args || typeof call.args !== 'object' || Array.isArray(call.args))) throw fail('provider-response-invalid', 'Invalid assistant content or tool calls');
    return { content, reasoning, toolCalls, usage: tokens, finishReason: toolCalls.length ? 'toolUse' : ['length', 'MAX_TOKENS', 'max_tokens'].includes(finishReason) ? 'length' : 'stop', rawFinishReason: finishReason, ...(providerContent ? { providerContent } : {}) };
}
