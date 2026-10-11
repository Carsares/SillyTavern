// Unified entry point; all catalog providers have real codecs, no legacy engine imports.
import { getChatCapabilities } from '../../capabilities/chat/index.js';
import { createTextAdapter } from '../text/index.js';
import { createAuxiliaryAdapter } from '../auxiliary/index.js';
import { fail } from '../core/index.js';
import { createTransport, requireCapability, parameters, outputLimit, emitResult } from './http.js';
import { encodeChat, decodeChat } from './protocol.js';
import { decodeChatStream } from './stream.js';
import { applyReasoning } from './reasoning.js';

export function createChatAdapter(connection, options = {}) {
    const c = structuredClone(connection.data ?? connection);
    const capability = getChatCapabilities(c);
    requireCapability(capability);
    const send = createTransport(c, capability, options);
    const sampling = parameters(c, capability);
    return { capabilities: capability,
        async generate({ messages, tools = [], signal, maxOutputTokens, onEvent, stream = c.stream !== false } = {}) {
            for (const message of messages ?? []) for (const part of Array.isArray(message.content) ? message.content : []) {
                if (part.type !== 'text') {
                    const cost = (c.mediaTokenCost ?? c.capabilities?.mediaTokenCost)?.[part.type];
                    if (!Number.isSafeInteger(cost) || cost < 1) throw fail('media-budget-unknown', 'Explicit positive mediaTokenCost is required');
                }
            }
            const body = encodeChat(c, capability, { messages, tools, maxOutputTokens: outputLimit(c, maxOutputTokens) }, sampling);
            applyReasoning(body, c, capability.api, outputLimit(c, maxOutputTokens));
            if (!capability.api.startsWith('google')) body.stream = stream;
            if (stream && c.provider === 'openai') body.stream_options = { include_usage: true };
            let path = capability.path;
            const headers = {};
            if (capability.api === 'anthropic-messages') Object.assign(headers, { authorization: null, 'x-api-key': c.apiKey ?? '', 'anthropic-version': '2023-06-01' });
            if (capability.api.startsWith('google')) {
                path = `models/${encodeURIComponent(c.model.replace(/^models\//, ''))}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
                if (capability.api === 'google-generate-content') Object.assign(headers, { authorization: null, 'x-goog-api-key': c.apiKey ?? '' });
            }
            if (capability.api === 'azure-chat') {
                path = `openai/deployments/${encodeURIComponent(c.deployment)}/chat/completions?api-version=${encodeURIComponent(c.apiVersion)}`;
                Object.assign(headers, { authorization: null, 'api-key': c.apiKey ?? '' });
            }
            const response = await send(path, { body, headers, signal, raw: stream });
            if (stream) return decodeChatStream(capability.api, response, { signal, onEvent, provider: c.provider });
            return emitResult(decodeChat(capability.api, response, { provider: c.provider }), onEvent, signal);
        },
    };
}
export function createProviderAdapter(connection, options = {}) {
    const c = connection.data ?? connection;
    if (c.type === 'text') return createTextAdapter(c, options);
    if (['embedding', 'image', 'auxiliary'].includes(c.type)) return createAuxiliaryAdapter(c, options);
    if (c.type && c.type !== 'chat') throw fail('unsupported-provider', 'Unknown connection type');
    return createChatAdapter(c, options);
}
