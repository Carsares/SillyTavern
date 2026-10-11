import { createModels, createProvider } from '@earendil-works/pi-ai';
import * as completions from '@earendil-works/pi-ai/api/openai-completions';
import { fail } from '../core/index.js';

export function createPrimaryModel(connection, capabilities = {}) {
    return {
        id: connection.model, name: connection.model, api: 'openai-completions', provider: 'conversation-primary',
        baseUrl: connection.baseUrl, reasoning: capabilities.reasoningEnabled === true, input: capabilities.media ?? ['text'],
        thinkingLevelMap: capabilities.reasoningEnabled ? Object.fromEntries(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(level => [level, capabilities.reasoningEfforts.includes(level) ? level : null])) : undefined,
        contextWindow: connection.contextWindow, maxTokens: connection.maxOutputTokens,
        cost: { input: NaN, output: NaN, cacheRead: NaN, cacheWrite: NaN },
        // Preserve system messages, including those interleaved with user/assistant history.
        compat: { supportsDeveloperRole: false, supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true, supportsUsageInStreaming: true, supportsStore: false },
    };
}

export function createPrimaryStream(connection, model) {
    const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
    models.setProvider(createProvider({
        id: model.provider, models: [model], api: completions,
        auth: { apiKey: { name: 'Connection API key', resolve: async () => ({ auth: { apiKey: connection.apiKey || 'local-no-key', headers: connection.headers } }) } },
    }));
    return (model, context, options) => models.streamSimple(model, context, options);
}

/** Sampling values cannot overwrite compiled history, tools, auth or budget. */
export function samplingParameters(parameters = {}) {
    const allowed = new Set(['temperature', 'top_p', 'top_k', 'min_p', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'seed', 'stop']);
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw fail('unsupported-parameters', 'Parameters must be an object');
    for (const [key, value] of Object.entries(parameters)) {
        if (!allowed.has(key)) throw fail('unsupported-parameters', `Unsupported sampling parameter: ${key}`);
        if (key === 'stop') {
            if (!(typeof value === 'string' || (Array.isArray(value) && value.every(x => typeof x === 'string')))) throw fail('invalid-parameters', 'Invalid stop parameter');
        } else if (typeof value !== 'number' || !Number.isFinite(value)) throw fail('invalid-parameters', 'Sampling values must be finite numbers');
    }
    return { ...parameters };
}
