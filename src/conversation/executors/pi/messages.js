import { fail } from '../../providers/core/index.js';
import { MEDIA_TYPES, inlineMedia } from '../../providers/core/media.js';
export const EMPTY_USAGE = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });

export function toPiContent(content, capabilities) {
    if (typeof content === 'string') return [{ type: 'text', text: content }];
    if (!Array.isArray(content)) throw fail('unsupported-content', 'Message content must be text or typed content');
    return content.map(part => {
        if (part.type === 'text' && typeof part.text === 'string') return { type: 'text', text: part.text };
        if (MEDIA_TYPES.includes(part.type)) return inlineMedia(part, capabilities);
        if (part.type === 'thinking' && typeof part.thinking === 'string') return { ...part };
        if (part.type === 'toolCall' && typeof part.id === 'string' && typeof part.name === 'string' && part.arguments && typeof part.arguments === 'object') return structuredClone(part);
        throw fail('unsupported-content', 'Unsupported message content type');
    });
}

/** Keep roles and tool call IDs; never flatten history into a user prompt. */
export function toPiMessages(messages, model, capabilities = {}) {
    if (!Array.isArray(messages) || !messages.length) throw fail('invalid-context', 'A nonempty compiled history is required');
    const pending = new Map();
    const result = messages.map(message => {
        if (message.providerParts !== undefined && !Array.isArray(message.providerParts)) throw fail('unsupported-content', 'providerParts must contain the complete ordered content');
        const content = toPiContent(message.providerParts ?? message.content, capabilities);
        if (message.providerParts === undefined && message.media?.length) content.push(...toPiContent(message.media, capabilities));
        if (message.reasoning) {
            if (message.role !== 'assistant' || typeof message.reasoning !== 'string') throw fail('unsupported-content', 'Reasoning requires assistant text');
            content.push({ type: 'thinking', thinking: message.reasoning, ...(message.thinkingSignature ? { thinkingSignature: message.thinkingSignature } : {}) });
        }
        for (const call of message.toolCalls ?? []) {
            if (message.role !== 'assistant' || !call.id || !call.name) throw fail('invalid-tool-history', 'Invalid assistant tool call');
            content.push({ type: 'toolCall', id: call.id, name: call.name, arguments: structuredClone(call.args ?? call.arguments ?? {}), ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}) });
        }
        const extended = message.providerParts !== undefined || content.some(part => ['audio', 'video', 'document'].includes(part.type));
        const providerFields = extended ? { providerParts: structuredClone(content) } : {};
        const sdkContent = extended ? content.filter(part => ['text', 'image'].includes(part.type)) : content;
        const timestamp = message.timestamp ?? 0;
        if (message.role === 'system' || message.role === 'user') {
            if (content.some(p => p.type !== 'text' && !(message.role === 'user' && MEDIA_TYPES.includes(p.type)))) throw fail('unsupported-content', 'Non-text blocks require an assistant role');
            return { role: message.role, content: sdkContent, ...providerFields, timestamp };
        }
        if (message.role === 'assistant') {
            if (content.some(p => MEDIA_TYPES.includes(p.type))) throw fail('unsupported-media', 'Assistant media output is unsupported');
            for (const part of content) if (part.type === 'toolCall') {
                if (pending.has(part.id)) throw fail('invalid-tool-history', 'Duplicate tool call ID');
                pending.set(part.id, part.name);
            }
            return { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, usage: structuredClone(EMPTY_USAGE), ...(message.providerContent ? { providerContent: structuredClone(message.providerContent) } : {}), stopReason: content.some(p => p.type === 'toolCall') ? 'toolUse' : 'stop', timestamp };
        }
        if (message.role === 'tool' || message.role === 'toolResult') {
            const id = message.toolCallId ?? message.tool_call_id;
            const name = message.toolName ?? message.name ?? pending.get(id);
            if (!id || !name || pending.get(id) !== name || content.some(p => !['text', ...MEDIA_TYPES].includes(p.type))) throw fail('invalid-tool-history', 'Tool result must match an earlier assistant tool call');
            pending.delete(id);
            return { role: 'toolResult', toolCallId: id, toolName: name, content: sdkContent, ...providerFields, isError: message.isError === true, timestamp };
        }
        throw fail('unsupported-role', 'Unsupported message role');
    });
    if (pending.size) throw fail('invalid-tool-history', 'History contains unresolved tool calls');
    return result;
}
