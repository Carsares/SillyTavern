// Native SSE framing and deltas. No provider/model loop. EOF without a terminal event fails.
import { mergeReasoningDetails, reasoningText } from './openrouter.js';
import { randomUUID } from 'node:crypto';
import { fail } from '../core/index.js';
import { decodeChat } from './protocol.js';

export async function* readSSE(response, signal) {
    if (!response.body) throw fail('provider-response-invalid', 'Missing stream body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', data = [], event = '', frameSize = 0;
    const aborted = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', aborted, { once: true });
    try {
        while (true) {
            signal?.throwIfAborted();
            const chunk = await reader.read();
            signal?.throwIfAborted();
            buffer += decoder.decode(chunk.value, { stream: !chunk.done });
            if (buffer.length > 8 * 1024 * 1024) throw fail('provider-response-invalid', 'Oversized stream frame');
            if (chunk.done && buffer) buffer += '\n';
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1);
                if (!line) {
                    if (data.length) yield { event, data: data.join('\n') };
                    data = []; event = ''; frameSize = 0;
                } else if (line.startsWith('data:')) {
                    frameSize += line.length;
                    if (frameSize > 8 * 1024 * 1024) throw fail('provider-response-invalid', 'Oversized stream frame');
                    data.push(line.slice(5).replace(/^ /, ''));
                } else if (line.startsWith('event:')) event = line.slice(6).trim();
            }
            if (chunk.done) { if (data.length) yield { event, data: data.join('\n') }; break; }
        }
    } finally { signal?.removeEventListener('abort', aborted); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function decodeChatStream(api, response, { signal, onEvent } = {}) {
    const state = api === 'anthropic-messages' ? { content: [], usage: {} }
        : api.startsWith('google') ? { responseId: randomUUID(), candidates: [{ content: { parts: [] } }], usageMetadata: {} }
            : api === 'cohere-v2' ? { message: { content: [], tool_calls: [] }, usage: {} }
                : { choices: [{ message: { content: '', reasoning_content: '', tool_calls: [] } }], usage: {} };
    const jsonBuffers = new Map();
    let terminal = false, sawResponse = false;
    const delta = async (type, text, extra = {}) => { if (text) await onEvent?.({ type, text, ...extra }); };
    const mergeCall = async (calls, index, call) => {
        if (!Number.isSafeInteger(index) || index < 0 || index > 4096) throw fail('provider-response-invalid', 'Invalid streamed tool index');
        const current = calls[index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (call.id) current.id = call.id;
        if (call.function?.name) current.function.name += call.function.name;
        if (call.function?.arguments) {
            current.function.arguments += call.function.arguments;
            await delta('tool.delta', call.function.arguments, { index, id: current.id, name: current.function.name });
        }
    };
    for await (const frame of readSSE(response, signal)) {
        if (frame.data === '[DONE]') {
            if (!sawResponse || ['anthropic-messages', 'cohere-v2', 'google-generate-content', 'google-vertex'].includes(api)) throw fail('provider-response-invalid', 'Unexpected stream terminator');
            terminal = true; break;
        }
        let item;
        try { item = JSON.parse(frame.data); } catch { throw fail('provider-response-invalid', 'Invalid JSON stream frame'); }
        if (item.error || item.type === 'error') throw fail('provider-stream-error', 'Provider reported a stream error');
        if (item.index !== undefined && (!Number.isSafeInteger(item.index) || item.index < 0 || item.index > 4096)) throw fail('provider-response-invalid', 'Invalid content block index');
        if (item.choices?.length || item.candidates?.length || item.type === 'message_start' || item.type === 'message-start' || item.type === 'content-start') sawResponse = true;
        if (api === 'anthropic-messages') {
            if (item.type === 'message_start') Object.assign(state, item.message);
            else if (item.type === 'content_block_start') state.content[item.index] = { ...item.content_block };
            else if (item.type === 'content_block_delta') {
                const block = state.content[item.index];
                if (!block) throw fail('provider-response-invalid', 'Delta before content block');
                const d = item.delta;
                if (d.type === 'text_delta') { block.text = (block.text ?? '') + d.text; await delta('text.delta', d.text); } else if (d.type === 'thinking_delta') { block.thinking = (block.thinking ?? '') + d.thinking; await delta('reasoning.delta', d.thinking); } else if (d.type === 'signature_delta') block.signature = (block.signature ?? '') + d.signature;
                else if (d.type === 'input_json_delta') {
                    jsonBuffers.set(item.index, (jsonBuffers.get(item.index) ?? '') + d.partial_json);
                    await delta('tool.delta', d.partial_json, { index: item.index, id: block.id, name: block.name });
                }
            } else if (item.type === 'message_delta') { Object.assign(state, item.delta); Object.assign(state.usage, item.usage); } else if (item.type === 'message_stop') terminal = true;
        } else if (api.startsWith('google')) {
            if (item.responseId) state.responseId = item.responseId;
            if (item.usageMetadata) Object.assign(state.usageMetadata, item.usageMetadata);
            const candidate = item.candidates?.[0];
            for (const part of candidate?.content?.parts ?? []) {
                state.candidates[0].content.parts.push(part);
                if (part.text) await delta(part.thought ? 'reasoning.delta' : 'text.delta', part.text);
            }
            if (candidate?.finishReason) { state.candidates[0].finishReason = candidate.finishReason; terminal = true; }
            if (item.promptFeedback?.blockReason) throw fail('provider-content-blocked', 'Google blocked the input');
        } else if (api === 'cohere-v2') {
            const d = item.delta?.message;
            if (item.type === 'content-start') state.message.content[item.index] = { ...d.content };
            else if (item.type === 'content-delta') {
                const block = state.message.content[item.index] ??= { type: d.content.type ?? 'text' };
                if (d.content.text) { block.text = (block.text ?? '') + d.content.text; await delta('text.delta', d.content.text); }
                if (d.content.thinking) { block.type = 'thinking'; block.thinking = (block.thinking ?? '') + d.content.thinking; await delta('reasoning.delta', d.content.thinking); }
            } else if (['tool-call-start', 'tool-call-delta'].includes(item.type)) await mergeCall(state.message.tool_calls, item.index, d.tool_calls);
            else if (item.type === 'message-end') { state.finish_reason = item.delta?.finish_reason; state.usage = item.delta?.usage ?? {}; terminal = true; }
        } else {
            const choice = item.choices?.[0];
            const target = state.choices[0];
            const d = choice?.delta ?? {};
            if (d.content) { target.message.content += d.content; await delta('text.delta', d.content); }
            if (d.reasoning_details) mergeReasoningDetails(target.message.reasoning_details ??= [], d.reasoning_details);
            const thinking = d.reasoning_content ?? d.reasoning ?? (d.reasoning_details ? reasoningText(d.reasoning_details) : '');
            if (thinking) { target.message.reasoning_content += thinking; await delta('reasoning.delta', thinking); }
            for (const call of d.tool_calls ?? []) await mergeCall(target.message.tool_calls, call.index, call);
            if (choice?.finish_reason) { target.finish_reason = choice.finish_reason; terminal = true; }
            if (item.usage) state.usage = item.usage;
        }
    }
    if (!terminal || !sawResponse) throw fail('provider-stream-truncated', 'Stream ended before a complete response');
    for (const [index, json] of jsonBuffers) {
        try { state.content[index].input = JSON.parse(json); } catch { throw fail('provider-response-invalid', 'Incomplete tool argument JSON'); }
    }
    const result = decodeChat(api, state);
    for (const call of result.toolCalls) await onEvent?.({ type: 'tool.call', ...call });
    await onEvent?.({ type: 'usage', usage: result.usage });
    return result;
}
