import { AssistantMessageEventStream, getDeclaredTools, getSystemMessageText } from '@earendil-works/pi-ai';
import { EMPTY_USAGE } from './messages.js';

/**
 * Adapt one provider generate call to one pi stream; Agent alone owns continuation.
 * generate({ model, messages, tools, maxOutputTokens, signal, reasoning, fetch,
 *            onPayload, onEvent }) returns { content, reasoning?, toolCalls?,
 *            usage?, finishReason?, providerContent? }.
 * Adapter tool calls are {id,name,args,thoughtSignature?}; usage uses
 * inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens/reasoningTokens.
 * Bind the connection in generate's closure. Forward the supplied fetch to keep
 * request capture active. Preserve providerContent for signed reasoning replay.
 */
export function createPiStreamBridge({ generate }) {
    if (typeof generate !== 'function') throw new TypeError('generate must be a function');
    return (model, context, options = {}) => {
        const stream = new AssistantMessageEventStream();
        const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, content: [], usage: structuredClone(EMPTY_USAGE), stopReason: 'pending', timestamp: Date.now() };
        const accumulated = { text: '', thinking: '' };
        const streamedCalls = [];
        let latestUsage;
        function delta(kind, text) {
            if (typeof text !== 'string') throw new TypeError('Delta must be text');
            if (!text) return;
            let index = message.content.findIndex(part => part.type === kind);
            if (index < 0) { index = message.content.length; message.content.push(kind === 'text' ? { type: kind, text: '' } : { type: kind, thinking: '' }); }
            message.content[index][kind === 'text' ? 'text' : 'thinking'] += text;
            accumulated[kind] += text;
            stream.push({ type: kind === 'text' ? 'text_delta' : 'thinking_delta', contentIndex: index, delta: text, partial: message });
        }
        void (async () => {
            try {
                options.signal?.throwIfAborted();
                const messages = context.messages.map(entry => {
                    if (entry.role === 'system') return { role: 'system', content: getSystemMessageText(entry) };
                    if (entry.role === 'toolResult') return { role: 'tool', toolCallId: entry.toolCallId, toolName: entry.toolName, content: entry.providerParts ?? entry.content, isError: entry.isError };
                    if (entry.role === 'user') return { role: 'user', content: entry.providerParts ?? entry.content };
                    if (entry.role !== 'assistant') throw new TypeError('Unsupported SDK role');
                    return { role: 'assistant', content: entry.content.filter(part => part.type === 'text'),
                        reasoning: entry.content.filter(part => part.type === 'thinking').map(part => part.thinking).join(''),
                        toolCalls: entry.content.filter(part => part.type === 'toolCall').map(part => ({ id: part.id, name: part.name, args: part.arguments, ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) })),
                        ...(entry.providerContent ? { providerContent: entry.providerContent } : {}),
                    };
                }).filter(entry => entry.role !== 'system' || entry.content !== '');
                stream.push({ type: 'start', partial: message });
                const result = await abortable(() => generate({ model, messages, tools: getDeclaredTools(context.messages), maxOutputTokens: options.maxTokens, signal: options.signal,
                    reasoning: options.reasoning ?? 'off', fetch: options.fetch, onPayload: options.onPayload,
                    onEvent: async event => {
                        options.signal?.throwIfAborted();
                        if (event.type === 'text.delta') delta('text', event.text);
                        else if (event.type === 'reasoning.delta') delta('thinking', event.text);
                        else if (event.type === 'tool.call') streamedCalls.push(event);
                        else if (event.type === 'usage' || event.type === 'usage.updated') latestUsage = event.usage;
                    },
                }), options.signal);
                options.signal?.throwIfAborted();
                if (!result || !['stop', 'length', 'toolUse', 'tool_calls', 'tool_use'].includes(result.finishReason ?? 'stop')) throw new Error('Invalid provider result');
                for (const [key, kind] of [['content', 'text'], ['reasoning', 'thinking']]) {
                    if (result[key] === undefined) continue;
                    if (typeof result[key] !== 'string' || !result[key].startsWith(accumulated[kind])) throw new Error('Final output differs from streamed output');
                    delta(kind, result[key].slice(accumulated[kind].length));
                }
                const toolCalls = result.toolCalls ?? streamedCalls;
                const callIds = new Set();
                if (['toolUse', 'tool_calls', 'tool_use'].includes(result.finishReason) && !toolCalls.length) throw new Error('Missing tool calls');
                for (const call of toolCalls) {
                    const args = call.args ?? call.arguments;
                    if (callIds.has(call.id) || typeof call.id !== 'string' || typeof call.name !== 'string' || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid provider tool call');
                    callIds.add(call.id);
                    message.content.push({ type: 'toolCall', id: call.id, name: call.name, arguments: args, ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}) });
                }
                if (result.providerContent) message.providerContent = structuredClone(result.providerContent);
                const usage = result.usage ?? latestUsage;
                if (usage) {
                    const count = value => Number.isFinite(value) && value >= 0 ? value : 0;
                    message.usage = { ...structuredClone(EMPTY_USAGE), input: count(usage.inputTokens), output: count(usage.outputTokens), cacheRead: count(usage.cacheReadTokens), cacheWrite: count(usage.cacheWriteTokens), reasoning: count(usage.reasoningTokens), totalTokens: count(usage.totalTokens ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))) };
                    await options.onProviderStreamEvent?.({ usage }, model);
                }
                message.stopReason = result.finishReason === 'length' ? 'length' : message.content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop';
                stream.push({ type: 'done', reason: message.stopReason, message });
            } catch {
                message.stopReason = options.signal?.aborted ? 'aborted' : 'error';
                message.errorMessage = options.signal?.aborted ? 'Provider generation aborted' : 'Provider generation failed';
                stream.push({ type: 'error', reason: message.stopReason, error: message });
            }
        })();
        return stream;
    };
}

async function abortable(run, signal) {
    signal?.throwIfAborted();
    if (!signal) return run();
    let listener;
    try {
        return await Promise.race([Promise.resolve().then(run), new Promise((_, reject) => {
            listener = () => reject(signal.reason);
            signal.addEventListener('abort', listener, { once: true });
            if (signal.aborted) listener();
        })]);
    } finally { signal.removeEventListener('abort', listener); }
}
