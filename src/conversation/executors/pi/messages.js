import { fail } from '../../providers/core/index.js';
export const EMPTY_USAGE = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });

function parts(content) {
    if (typeof content === 'string') return [{ type: 'text', text: content }];
    if (!Array.isArray(content)) throw fail('unsupported-content', 'Message content must be text or typed content');
    return content.map(part => {
        if (part.type === 'text' && typeof part.text === 'string') return { type: 'text', text: part.text };
        if (part.type === 'thinking' && typeof part.thinking === 'string') return { ...part };
        if (part.type === 'toolCall' && typeof part.id === 'string' && typeof part.name === 'string' && part.arguments && typeof part.arguments === 'object') return structuredClone(part);
        throw fail('unsupported-content', 'Unsupported message content type');
    });
}

/** Keep roles and tool call IDs; never flatten history into a user prompt. */
export function toPiMessages(messages, model) {
    if (!Array.isArray(messages) || !messages.length) throw fail('invalid-context', 'A nonempty compiled history is required');
    const pending = new Map();
    const result = messages.map(message => {
        if (message.media?.length) throw fail('unsupported-media', 'This primary connection supports text only');
        const content = parts(message.content);
        const timestamp = message.timestamp ?? 0;
        if (message.role === 'system' || message.role === 'user') {
            if (content.some(p => p.type !== 'text')) throw fail('unsupported-content', 'Non-text blocks require an assistant role');
            return { role: message.role, content, timestamp };
        }
        if (message.role === 'assistant') {
            for (const part of content) if (part.type === 'toolCall') {
                if (pending.has(part.id)) throw fail('invalid-tool-history', 'Duplicate tool call ID');
                pending.set(part.id, part.name);
            }
            return { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, usage: structuredClone(EMPTY_USAGE), stopReason: content.some(p => p.type === 'toolCall') ? 'toolUse' : 'stop', timestamp };
        }
        if (message.role === 'tool' || message.role === 'toolResult') {
            const id = message.toolCallId ?? message.tool_call_id;
            const name = message.toolName ?? message.name ?? pending.get(id);
            if (!id || !name || pending.get(id) !== name || content.some(p => p.type !== 'text')) throw fail('invalid-tool-history', 'Tool result must match an earlier assistant tool call');
            pending.delete(id);
            return { role: 'toolResult', toolCallId: id, toolName: name, content, isError: message.isError === true, timestamp };
        }
        throw fail('unsupported-role', 'Unsupported message role');
    });
    if (pending.size) throw fail('invalid-tool-history', 'History contains unresolved tool calls');
    return result;
}
