import path from 'node:path';
import { invariant, canonicalJson } from '../../../public/shared/conversation/schemas/index.js';
import { inlineMedia } from '../providers/core/media.js';
import { estimatePiContext } from '../providers/core/index.js';

export function requireNewDirectory(directory) {
    invariant(typeof directory === 'string' && path.basename(path.resolve(directory)) === 'conversation-v1', 'invalid-directory', 'Use an explicit conversation-v1 data directory');
    return path.resolve(directory);
}

export const normalizeConnection = connection => ({ ...(connection?.data ?? connection), executor: (connection?.data ?? connection)?.executor ?? 'native' });

export function hydrateParts(parts, attachments, capabilities) {
    if (parts === undefined || typeof parts === 'string') return parts;
    invariant(Array.isArray(parts), 'invalid-media', 'Expected typed content parts');
    return parts.map(part => {
        if (!part.attachmentId) return structuredClone(part);
        const attachment = attachments.read(part.attachmentId);
        return inlineMedia({ type: part.type, data: attachment.bytes.toString('base64'), mimeType: attachment.mime, name: attachment.name }, capabilities);
    });
}

export function assertRequestBudget(context, connection, capability, plan) {
    const messages = context?.messages ?? context?.context?.messages;
    invariant(Array.isArray(messages), 'invalid-context', 'Executor must expose the complete request context');
    const limit = Math.min(connection.workingBudget, capability.inputLimit ?? connection.contextWindow,
        connection.contextWindow - connection.maxOutputTokens, plan.budget?.workingBudget ?? Infinity);
    const estimated = estimatePiContext(messages, capability);
    invariant(Number.isFinite(limit) && estimated <= limit, 'budget-blocked', 'Auxiliary context exceeds the conservative input budget', 422, { estimatedTokens: estimated, workingBudget: limit });
}

/** Use exactly the already-compiled template; never flatten text-provider history ad hoc. */
export function frozenTextPrompt(plan) {
    invariant(plan.mode === 'text' && typeof plan.prompt === 'string', 'missing-text-template', 'Text connections require a compiled text preset', 422);
    const normalize = messages => messages.map(message => {
        const content = message.providerParts ?? message.content;
        if (typeof content === 'string') return { role: message.role, content };
        invariant(Array.isArray(content), 'unsupported-content', 'Text context requires typed content');
        const normalized = content.map(part => {
            invariant(['text', 'image', 'audio', 'video', 'document'].includes(part.type), 'unsupported-content', 'Invalid text-provider content');
            return part;
        });
        return { role: message.role, content: normalized.every(part => part.type === 'text') ? normalized.map(part => part.text).join('') : normalized };
    });
    const expected = canonicalJson(normalize(plan.messages));
    return ({ messages, tools }) => {
        invariant(!tools.length && canonicalJson(normalize(messages)) === expected, 'text-context-changed', 'Text context changed after compiling its template', 422);
        return plan.prompt;
    };
}
