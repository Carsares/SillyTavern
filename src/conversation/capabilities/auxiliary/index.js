// Auxiliary operations are independent of chat model support; never inferred from model names.
import { deepFreeze, describeCapability } from '../chat/index.js';
export const AUXILIARY_PROVIDERS = deepFreeze({
    openai: { api: 'openai-auxiliary', baseUrl: 'https://api.openai.com/v1', operations: ['embed', 'generateImage'], media: ['text'], tools: false, parameters: [] },
    'openai-compatible': { api: 'openai-auxiliary', baseUrl: null, operations: ['embed', 'generateImage'], media: ['text'], tools: false, parameters: [] },
    cohere: { api: 'cohere-embed', baseUrl: 'https://api.cohere.com/v2', operations: ['embed'], media: ['text'], tools: false, parameters: [] },
    google: { api: 'google-embed', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', operations: ['embed'], media: ['text'], tools: false, parameters: [] },
    ollama: { api: 'ollama-embed', baseUrl: 'http://127.0.0.1:11434', operations: ['embed'], media: ['text'], tools: false, parameters: [] },
    stability: { api: 'stability-image', baseUrl: 'https://api.stability.ai', operations: ['generateImage'], media: ['text'], tools: false, parameters: [] },
    automatic1111: { api: 'sd-webui-image', baseUrl: null, operations: ['generateImage'], media: ['text'], tools: false, parameters: [] },
    horde: { api: 'horde-image', baseUrl: 'https://aihorde.net/api/v2', operations: ['generateImage'], media: ['text'], tools: false, parameters: [] },
    novelai: { api: 'novelai-image', baseUrl: 'https://image.novelai.net', operations: ['generateImage'], media: ['text'], tools: false, parameters: [] },
});
export const getAuxiliaryCapabilities = connection => describeCapability(connection, AUXILIARY_PROVIDERS, 'auxiliary');
export const getCapabilities = getAuxiliaryCapabilities;
