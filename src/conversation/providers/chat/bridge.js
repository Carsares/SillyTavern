// Pi 1.0.2 AssistantMessageEventStream adapter. Pi alone owns the model/tool loop.
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { createProviderAdapter } from './index.js';
import { getChatCapabilities, reasoningMode } from '../../capabilities/chat/index.js';
import { getTextCapabilities } from '../../capabilities/text/index.js';
import { fail } from '../core/index.js';

export const providerCapabilities = (connection, dependencies = {}) => (connection.type === 'text' ? getTextCapabilities : getChatCapabilities)(connection, dependencies);
export function createProviderModel(connection, dependencies = {}) {
    const capability = providerCapabilities(connection, dependencies);
    return { id: connection.model, name: connection.model, api: capability.api, provider: connection.provider,
        baseUrl: capability.baseUrl, contextWindow: connection.contextWindow, maxTokens: connection.maxOutputTokens,
        reasoning: Boolean(reasoningMode(connection) && reasoningMode(connection) !== 'off'), input: capability.media.filter(type => ['text', 'image'].includes(type)), providerMedia: capability.media,
        cost: { input: NaN, output: NaN, cacheRead: NaN, cacheWrite: NaN } };
}

/** Replay toolsAdded/toolsRemoved; never flatten mid-history system instructions to a prefix. */
export function fromPiContext(context, api) {
    const tools = new Map((context.tools ?? []).map(tool => [tool.name, tool]));
    const messages = [];
    if (context.systemPrompt) messages.push({ role: 'system', content: context.systemPrompt });
    let conversationStarted = false;
    const sections = new Map();
    let sectionMessage;
    for (const native of context.messages) {
        if (native.role === 'system') {
            for (const tool of native.toolsAdded ?? []) tools.set(tool.name, { name: tool.name, description: tool.description, parameters: tool.parameters });
            for (const tool of native.toolsRemoved ?? []) tools.delete(tool.name);
            if (native.sections && conversationStarted) throw fail('unsupported-system-sections', 'Mid-history named section replacement needs a provider-aware compiler');
            const content = typeof native.content === 'string' ? native.content : (native.content ?? []).map(part => part.text).join('');
            if (content) messages.push({ role: 'system', content });
            if (native.sections) {
                for (const [key, value] of Object.entries(native.sections)) { if (value === null) sections.delete(key); else sections.set(key, value); }
                if (!sectionMessage) { sectionMessage = { role: 'system', content: '' }; messages.push(sectionMessage); }
                sectionMessage.content = [...sections.values()].join('');
            }
            continue;
        }
        conversationStarted = true;
        if (native.providerParts !== undefined && !Array.isArray(native.providerParts)) throw fail('invalid-content', 'providerParts must be the complete typed block array');
        if (native.role === 'user') { messages.push({ role: 'user', content: structuredClone(native.providerParts ?? native.content) }); continue; }
        if (native.role === 'toolResult') {
            messages.push({ role: 'tool', toolCallId: native.toolCallId, name: native.toolName, isError: native.isError === true, content: structuredClone(native.providerParts ?? native.content) }); continue;
        }
        if (native.role !== 'assistant') throw fail('unsupported-role', 'Unknown Pi message role');
        if (!Array.isArray(native.content) || native.content.some(part => !['text', 'thinking', 'toolCall'].includes(part.type))) throw fail('unsupported-media', 'Unsupported assistant content cannot be discarded');
        const content = native.content.filter(part => part.type === 'text').map(part => part.text).join('');
        const thinking = native.content.filter(part => part.type === 'thinking');
        const toolCalls = native.content.filter(part => part.type === 'toolCall').map(part => ({ id: part.id, name: part.name, args: part.arguments, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) }));
        const message = { role: 'assistant', content, toolCalls, ...(thinking.length ? { reasoning: thinking.map(part => part.thinking).join('') } : {}) };
        if (api === 'openai-chat' && native.providerContent) message.providerContent = structuredClone(native.providerContent);
        if (api === 'anthropic-messages') message.providerContent = native.content.map(part => {
            if (part.type === 'thinking') {
                if (!part.thinkingSignature) throw fail('unsupported-reasoning-replay', 'Anthropic thinking requires its signature');
                return part.redacted ? { type: 'redacted_thinking', data: part.thinkingSignature } : { type: 'thinking', thinking: part.thinking, signature: part.thinkingSignature };
            }
            if (part.type === 'toolCall') return { type: 'tool_use', id: part.id, name: part.name, input: part.arguments };
            if (part.type === 'text') return { type: 'text', text: part.text };
            throw fail('unsupported-media', 'Unsupported assistant content');
        });
        if (api.startsWith('google')) message.providerContent = native.providerContent ?? native.content.map(part => {
            if (part.type === 'thinking') return { text: part.thinking, thought: true, ...(part.thinkingSignature ? { thoughtSignature: part.thinkingSignature } : {}) };
            if (part.type === 'toolCall') return { functionCall: { name: part.name, args: part.arguments }, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) };
            return { text: part.text, ...(part.textSignature ? { thoughtSignature: part.textSignature } : {}) };
        });
        messages.push(message);
    }
    return { messages: messages.filter(message => message !== sectionMessage || message.content), tools: [...tools.values()] };
}

function piUsage(value) {
    // Pi's numeric fields use NaN for unavailable counts/prices; never claim unknown means zero.
    const input = value?.inputTokens ?? NaN, output = value?.outputTokens ?? NaN;
    return { input, output, cacheRead: value?.cacheReadTokens ?? NaN, cacheWrite: value?.cacheWriteTokens ?? NaN,
        totalTokens: value?.totalTokens ?? NaN, ...(value?.reasoningTokens != null ? { reasoning: value.reasoningTokens } : {}),
        cost: { input: NaN, output: NaN, cacheRead: NaN, cacheWrite: NaN, total: NaN } };
}
function finalContent(result) {
    if (result.providerContent?.some(part => ['thinking', 'redacted_thinking', 'tool_use'].includes(part.type))) {
        return result.providerContent.map(part => part.type === 'thinking' ? { type: 'thinking', thinking: part.thinking, thinkingSignature: part.signature }
            : part.type === 'redacted_thinking' ? { type: 'thinking', thinking: '', thinkingSignature: part.data, redacted: true }
                : part.type === 'tool_use' ? { type: 'toolCall', id: part.id, name: part.name, arguments: part.input } : { type: 'text', text: part.text });
    }
    if (result.providerContent?.some(part => !part.type && (part.text !== undefined || part.functionCall))) {
        let callIndex = 0;
        return result.providerContent.filter(part => part.text !== undefined || part.functionCall).map(part => {
            if (part.functionCall) { const call = result.toolCalls[callIndex++]; return { type: 'toolCall', id: call.id, name: call.name, arguments: call.args, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) }; }
            return part.thought ? { type: 'thinking', thinking: part.text, ...(part.thoughtSignature ? { thinkingSignature: part.thoughtSignature } : {}) }
                : { type: 'text', text: part.text, ...(part.thoughtSignature ? { textSignature: part.thoughtSignature } : {}) };
        });
    }
    return [...(result.reasoning ? [{ type: 'thinking', thinking: result.reasoning }] : []),
        ...(result.content ? [{ type: 'text', text: result.content }] : []),
        ...result.toolCalls.map(call => ({ type: 'toolCall', id: call.id, name: call.name, arguments: call.args, ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}) }))];
}

/** deps.renderPrompt({messages,tools}, context) is required for text, using the compiled template. */
export function createProviderStream(connection, deps = {}) {
    return (model, context, options = {}) => {
        const stream = new AssistantMessageEventStream();
        const partial = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
            usage: piUsage(), stopReason: 'pending', timestamp: (deps.now ?? Date.now)() };
        void (async () => {
            try {
                options.signal?.throwIfAborted();
                const adapter = createProviderAdapter(connection, { ...deps, fetch: options.fetch ?? deps.fetch,
                    onPayload: payload => options.onPayload?.(payload, model) });
                const request = fromPiContext(context, adapter.capabilities.api);
                if (connection.type === 'text') {
                    if (request.tools.length) throw fail('unsupported-tools', 'Pi text bridge cannot expose tools');
                    if (!deps.renderPrompt) throw fail('missing-text-template', 'Provide renderPrompt for the text bridge');
                    request.prompt = deps.renderPrompt(structuredClone(request), context);
                }
                stream.push({ type: 'start', partial });
                const indices = new Map();
                const toolIndices = new Map();
                const startTool = (id, name) => {
                    if (toolIndices.has(id)) return toolIndices.get(id);
                    const index = partial.content.length;
                    partial.content.push({ type: 'toolCall', id, name, arguments: {} });
                    toolIndices.set(id, index);
                    stream.push({ type: 'toolcall_start', contentIndex: index, partial });
                    return index;
                };
                const append = (kind, text) => {
                    let index = indices.get(kind);
                    if (index === undefined) {
                        index = partial.content.length; indices.set(kind, index);
                        partial.content.push(kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' });
                        stream.push({ type: `${kind}_start`, contentIndex: index, partial });
                    }
                    partial.content[index][kind === 'text' ? 'text' : 'thinking'] += text;
                    stream.push({ type: `${kind}_delta`, contentIndex: index, delta: text, partial });
                };
                const result = await adapter.generate({ ...request, signal: options.signal, maxOutputTokens: options.maxTokens,
                    async onEvent(event) {
                        options.signal?.throwIfAborted();
                        if (event.type === 'text.delta') append('text', event.text);
                        if (event.type === 'reasoning.delta') append('thinking', event.text);
                        if (event.type === 'tool.delta' && event.id && event.name) {
                            const index = startTool(event.id, event.name);
                            stream.push({ type: 'toolcall_delta', contentIndex: index, delta: event.text, partial });
                        }
                        if (event.type === 'usage') await options.onProviderStreamEvent?.({ usage: event.usage });
                        await deps.onEvent?.(event);
                    } });
                options.signal?.throwIfAborted();
                for (const [kind, index] of indices) stream.push({ type: `${kind}_end`, contentIndex: index, content: partial.content[index][kind === 'text' ? 'text' : 'thinking'], partial });
                // Complete tool JSON is emitted only after validation; never execute partial JSON.
                for (const call of result.toolCalls) {
                    const alreadyStarted = toolIndices.has(call.id);
                    const index = startTool(call.id, call.name);
                    const toolCall = partial.content[index];
                    if (call.thoughtSignature) toolCall.thoughtSignature = call.thoughtSignature;
                    if (!alreadyStarted) stream.push({ type: 'toolcall_delta', contentIndex: index, delta: JSON.stringify(call.args), partial });
                    toolCall.arguments = call.args;
                    stream.push({ type: 'toolcall_end', contentIndex: index, toolCall, partial });
                }
                partial.content = finalContent(result);
                if (result.providerContent) partial.providerContent = structuredClone(result.providerContent);
                partial.usage = piUsage(result.usage);
                partial.providerUsage = structuredClone(result.usage);
                partial.stopReason = ['length', 'toolUse'].includes(result.finishReason) ? result.finishReason : 'stop';
                stream.push({ type: 'done', reason: partial.stopReason, message: partial });
            } catch (error) {
                partial.stopReason = options.signal?.aborted ? 'aborted' : 'error';
                partial.errorMessage = error?.code ? `${error.code}: Provider request failed` : 'Provider request failed';
                stream.push({ type: 'error', reason: partial.stopReason, error: partial });
            }
        })();
        return stream;
    };
}
