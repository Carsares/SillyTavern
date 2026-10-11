import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { fail } from './contracts.js';

/** Replace exposed schemas with the domain registry's schemas, remove built-ins. */
export function filterRequest(body, protocol, domain, model, maxOutputTokens) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('invalid-model-request', 'A JSON model request is required');
    if (body.model !== model) throw fail('model-mismatch', 'SDK attempted an unselected model');
    if (body.previous_response_id || body.conversation || body.prompt) throw fail('hidden-model-context', 'Server-side history cannot bypass the gateway context budget');
    const request = structuredClone(body);
    const removedTools = [];
    function tools(list, namespace) {
        if (!Array.isArray(list)) throw fail('invalid-model-request', 'Invalid tool declarations');
        return list.flatMap(tool => {
            if (tool.type === 'namespace') {
                const nested = tools(tool.tools ?? [], tool.name);
                return nested.length ? [{ ...tool, tools: nested }] : [];
            }
            let name;
            try { name = domain.nameOf(tool.name, namespace); } catch { removedTools.push(typeof tool.name === 'string' ? tool.name : tool.type ?? 'unknown'); return []; }
            const definition = domain.definition(name);
            if (protocol === 'anthropic') return [{ name: tool.name, description: definition.description ?? '', input_schema: definition.parameters }];
            if (tool.type !== 'function') { removedTools.push(tool.name); return []; }
            return [{ type: 'function', name: tool.name, description: definition.description ?? '', parameters: definition.parameters, strict: false }];
        });
    }
    request.tools = tools(request.tools ?? []);
    if (request.tool_choice && typeof request.tool_choice === 'object' && request.tool_choice.name) domain.nameOf(request.tool_choice.name, request.tool_choice.namespace);
    if (!request.tools.length) {
        if (['required', 'any'].includes(request.tool_choice) || ['tool', 'function', 'any'].includes(request.tool_choice?.type)) throw fail('forbidden-tool-choice', 'Forced tool is not available');
        delete request.tool_choice;
    }
    const key = protocol === 'anthropic' ? 'max_tokens' : 'max_output_tokens';
    if (request[key] !== undefined && (!Number.isSafeInteger(request[key]) || request[key] <= 0)) throw fail('invalid-model-request', 'Invalid output token limit');
    const requestedOutputTokens = request[key] ?? null;
    request[key] = Math.min(request[key] ?? maxOutputTokens, maxOutputTokens);
    if (protocol === 'responses') request.store = false;
    return { request, removedTools, requestedOutputTokens };
}

/** Validate tool envelopes before they reach the SDK, including streaming starts. */
export function responseInspector({ protocol, domain, requestIndex, emit, usage }) {
    const pending = new Map();
    let complete = false;
    function allowed(item) {
        if (item?.type === 'function_call') { domain.nameOf(item.name, item.namespace); return; }
        if (item?.type === 'tool_use') { domain.nameOf(item.name); return; }
        if (typeof item?.type === 'string' && (item.type.endsWith('_call') || item.type.includes('tool_use'))) throw fail('forbidden-tool', 'Provider returned a built-in or server-side tool call', 422);
    }
    function issue(item) {
        allowed(item);
        if (item.type === 'function_call') {
            let args;
            try { args = JSON.parse(item.arguments); } catch { throw fail('invalid-tool-call', 'Invalid function arguments'); }
            domain.permit(item.call_id ?? item.id, item.name, args, requestIndex, item.namespace);
        } else if (item.type === 'tool_use') domain.permit(item.id, item.name, item.input, requestIndex);
    }
    async function inspect(data, streaming = true) {
        if (data.error || data.type === 'error' || ['response.failed', 'response.incomplete'].includes(data.type)) throw fail('upstream-model-error', 'Model response failed or was incomplete', 502);
        if (!streaming) {
            const items = protocol === 'anthropic' ? data.content : data.output;
            if (!Array.isArray(items)) throw fail('invalid-model-response', 'Missing model output', 502);
            for (const item of items) {
                issue(item);
                if (item.type === 'text') await emit({ type: 'text.delta', text: item.text });
                if (item.type === 'thinking') await emit({ type: 'reasoning.delta', text: item.thinking });
                if (item.type === 'message') for (const part of item.content ?? []) if (part.type === 'output_text') await emit({ type: 'text.delta', text: part.text });
            }
            usage(data.usage ?? null);
            complete = protocol === 'anthropic' ? Boolean(data.stop_reason) : data.status === 'completed';
            return;
        }
        if (protocol === 'anthropic') {
            if (data.type === 'message_start') usage(data.message?.usage ?? null);
            if (data.type === 'content_block_start') {
                const block = data.content_block;
                allowed(block);
                pending.set(data.index, { ...block, args: '' });
                if (block?.type === 'text' && block.text) await emit({ type: 'text.delta', text: block.text });
            }
            if (data.type === 'content_block_delta') {
                const block = pending.get(data.index);
                if (!block) throw fail('invalid-model-response', 'Delta without content block', 502);
                if (data.delta?.type === 'text_delta') await emit({ type: 'text.delta', text: data.delta.text });
                if (data.delta?.type === 'thinking_delta') await emit({ type: 'reasoning.delta', text: data.delta.thinking });
                if (data.delta?.type === 'input_json_delta') {
                    if (block.type !== 'tool_use') throw fail('invalid-model-response', 'Tool arguments outside a tool block');
                    block.args += data.delta.partial_json;
                }
            }
            if (data.type === 'content_block_stop') {
                const block = pending.get(data.index);
                if (!block) throw fail('invalid-model-response', 'Unknown content block');
                if (block.type === 'tool_use') {
                    if (block.args) { try { block.input = JSON.parse(block.args); } catch { throw fail('invalid-tool-call', 'Malformed tool arguments'); } }
                    issue(block);
                }
                pending.delete(data.index);
            }
            if (data.type === 'message_delta') usage(data.usage ?? null);
            if (data.type === 'message_stop') complete = pending.size === 0;
        } else {
            if (data.item) allowed(data.item);
            if (data.type === 'response.output_item.done') issue(data.item);
            if (data.type === 'response.output_text.delta') await emit({ type: 'text.delta', text: data.delta });
            if (['response.reasoning_text.delta', 'response.reasoning_summary_text.delta'].includes(data.type)) await emit({ type: 'reasoning.delta', text: data.delta });
            if (data.type === 'response.completed') {
                for (const item of data.response?.output ?? []) issue(item);
                usage(data.response?.usage ?? null);
                complete = data.response?.status === 'completed';
            }
        }
    }
    return { inspect, isComplete: () => complete, assertComplete() { if (!complete) throw fail('incomplete-model-response', 'Model stream ended without a terminal response', 502); } };
}

/** SSE framing tolerates split UTF-8, CRLF, multi-line data and comments. */
export async function* sseFrames(stream, signal, maxBytes = 1048576) {
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '', frame = [], framesSinceYield = 0, lastYield = performance.now();
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
        while (true) {
            signal.throwIfAborted();
            const { value, done } = await reader.read();
            signal.throwIfAborted();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            if (Buffer.byteLength(buffer) + Buffer.byteLength(frame.join('\n')) > maxBytes) throw fail('response-size-limit', 'Model event exceeds size limit');
            let end;
            while ((end = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1);
                if (!line) {
                    if (frame.length) {
                        yield frame.join('\n'); frame = [];
                        // Buffered reads and async-generator next() can form an
                        // uninterrupted microtask chain. Give deadline timers a turn.
                        if (++framesSinceYield >= 32 || performance.now() - lastYield >= 8) {
                            await yieldToEventLoop();
                            framesSinceYield = 0; lastYield = performance.now();
                        }
                        signal.throwIfAborted();
                    }
                } else frame.push(line);
            }
            if (done) {
                if (buffer.trim() || frame.length) throw fail('incomplete-model-response', 'Truncated SSE frame', 502);
                break;
            }
        }
    } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function frameData(frame) {
    return frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
}
