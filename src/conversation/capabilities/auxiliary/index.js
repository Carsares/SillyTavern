// Explicit operation protocols. No remote model is claimed live-verified.
import { deepFreeze, describeCapability } from '../chat/index.js';
const profiles = {};
function add(id, embedApi, imageApi, baseUrl, extra = {}) {
    profiles[id] = { api: imageApi ?? embedApi, embedApi, imageApi, baseUrl,
        operations: [...(embedApi ? ['embed'] : []), ...(imageApi ? ['generateImage'] : [])], media: ['text'], tools: false, parameters: [], ...extra };
}
add('openai', 'openai-auxiliary', 'openai-auxiliary', 'https://api.openai.com/v1');
add('openai-compatible', 'openai-auxiliary', 'openai-auxiliary', null);
add('cohere', 'cohere-embed', null, 'https://api.cohere.com/v2');
add('google', 'google-embed', 'google-image', 'https://generativelanguage.googleapis.com/v1beta');
add('vertexai', 'vertex-embed', 'vertex-image', null);
add('ollama', 'ollama-embed', null, 'http://127.0.0.1:11434');
add('stability', null, 'stability-image', 'https://api.stability.ai');
add('automatic1111', null, 'sd-webui-image', null);
add('horde', null, 'horde-image', 'https://aihorde.net/api/v2');
add('novelai', null, 'novelai-image', 'https://image.novelai.net');
for (const [id, baseUrl] of Object.entries({ mistral: 'https://api.mistral.ai/v1', llamacpp: null, vllm: null, koboldcpp: null, siliconflow: 'https://api.siliconflow.com/v1' })) add(id, 'openai-auxiliary', null, baseUrl);
add('togetherai', 'openai-auxiliary', 'together-image', 'https://api.together.xyz/v1');
add('electronhub', 'openai-auxiliary', 'openai-auxiliary', 'https://api.electronhub.ai/v1');
add('openrouter', 'openai-auxiliary', 'openrouter-image', 'https://openrouter.ai/api/v1');
add('chutes', 'openai-auxiliary', 'chutes-image', null, { imageBaseUrl: 'https://image.chutes.ai' });
add('nanogpt', 'openai-auxiliary', 'nanogpt-image', 'https://nano-gpt.com/api/v1', { imageBaseUrl: 'https://nano-gpt.com/api' });
add('workers_ai', 'workers-embed', 'workers-image', 'https://api.cloudflare.com/client/v4');
add('nomicai', 'nomic-embed', null, 'https://api-atlas.nomic.ai/v1');
add('extras', 'extras-embed', 'extras-image', null);
add('transformers', 'transformers-embed', null, null);
add('sdcpp', null, 'sdcpp-image', null);
add('vlad', null, 'sd-webui-image', null);
add('drawthings', null, 'sd-webui-image', null);
add('aimlapi', null, 'openai-auxiliary', 'https://api.aimlapi.com/v1');
add('xai', null, 'xai-image', 'https://api.x.ai/v1');
add('zai', null, 'zai-image', 'https://api.z.ai/api/paas/v4');
add('pollinations', null, 'pollinations-image', 'https://gen.pollinations.ai');
add('huggingface', null, 'huggingface-image', 'https://router.huggingface.co/hf-inference/models');
add('comfy', null, 'comfy-image', null);
add('bfl', null, 'bfl-image', 'https://api.bfl.ai/v1');
add('falai', null, 'fal-image', 'https://queue.fal.run');
const imageFields = {
    'xai-image': ['prompt', 'aspectRatio', 'resolution', 'count', 'quality'],
    'zai-image': ['prompt', 'width', 'height', 'quality'],
    'openai-auxiliary': ['prompt', 'width', 'height', 'count', 'quality', 'style', 'outputFormat'],
    'sd-webui-image': ['prompt', 'negativePrompt', 'width', 'height', 'count', 'seed', 'steps', 'scale', 'sampler'],
    'sdcpp-image': ['prompt', 'negativePrompt', 'width', 'height', 'count', 'seed', 'steps', 'scale', 'sampler', 'scheduler'],
    'horde-image': ['prompt', 'negativePrompt', 'width', 'height', 'count', 'seed', 'steps', 'jobId', 'onJob'],
    'novelai-image': ['prompt', 'negativePrompt', 'width', 'height', 'count', 'seed', 'steps', 'scale', 'sampler', 'noiseSchedule', 'characters', 'useCoordinates'],
    'stability-image': ['prompt', 'negativePrompt', 'width', 'height', 'count', 'seed'],
    'together-image': ['prompt', 'negativePrompt', 'width', 'height', 'count', 'seed', 'steps'],
    'extras-image': ['prompt', 'negativePrompt', 'width', 'height', 'seed', 'steps', 'scale', 'sampler'],
    'pollinations-image': ['prompt', 'negativePrompt', 'width', 'height', 'seed', 'enhance'],
    'huggingface-image': ['prompt', 'negativePrompt', 'width', 'height', 'steps', 'scale', 'seed'],
    'chutes-image': ['prompt', 'negativePrompt', 'width', 'height', 'steps', 'scale'],
    'nanogpt-image': ['prompt', 'negativePrompt', 'width', 'height', 'steps', 'scale'],
    'google-image': ['prompt', 'aspectRatio', 'imageSize', 'count'],
    'vertex-image': ['prompt', 'negativePrompt', 'aspectRatio', 'count', 'seed'],
    'openrouter-image': ['prompt', 'aspectRatio', 'imageSize'],
    'workers-image': ['prompt', 'negativePrompt', 'width', 'height', 'steps', 'scale', 'seed'],
    'comfy-image': ['prompt', 'negativePrompt', 'width', 'height', 'count', 'seed', 'steps', 'scale', 'workflow', 'bindings', 'jobId', 'onJob'],
    'bfl-image': ['prompt', 'width', 'height', 'seed', 'steps', 'scale', 'aspectRatio', 'promptUpsampling', 'outputFormat', 'jobId', 'onJob'],
    'fal-image': ['prompt', 'negativePrompt', 'width', 'height', 'count', 'seed', 'steps', 'scale', 'jobId', 'onJob'],
};
for (const profile of Object.values(profiles)) {
    profile.operationParameters = {};
    if (profile.embedApi) profile.operationParameters.embed = [
        ...(!['extras-embed', 'workers-embed', 'transformers-embed'].includes(profile.embedApi) ? ['dimensions'] : []),
        ...(['cohere-embed', 'google-embed', 'vertex-embed', 'nomic-embed'].includes(profile.embedApi) ? ['inputType'] : []),
    ];
    if (profile.imageApi) profile.operationParameters.generateImage = imageFields[profile.imageApi];
}
for (const [alias, canonical] of Object.entries({ auto: 'automatic1111', novel: 'novelai', palm: 'google', makersuite: 'google', workersai: 'workers_ai', comfyui: 'comfy', fal: 'falai', mistralai: 'mistral', openai_compatible: 'openai-compatible' })) profiles[alias] = profiles[canonical];
export const AUXILIARY_PROVIDERS = deepFreeze(profiles);
export function getAuxiliaryCapabilities(connection) {
    const c = connection?.data ?? connection ?? {};
    const profile = profiles[c.provider];
    // Local inference needs no HTTP origin; no connection to this placeholder is ever made.
    const local = profile?.embedApi === 'transformers-embed';
    const effective = { ...c, ...(local ? { baseUrl: 'http://localhost' } : {}) };
    if (c.provider === 'chutes' && c.type !== 'image' && !c.baseUrl && /^[a-z0-9-]+$/.test(c.model ?? '')) effective.baseUrl = `https://${c.model}.chutes.ai/v1`;
    if (profile?.imageBaseUrl && c.type === 'image' && !c.baseUrl) effective.baseUrl = profile.imageBaseUrl;
    const result = { ...describeCapability(effective, AUXILIARY_PROVIDERS, 'auxiliary'), types: [], local };
    result.api = c.type === 'embedding' ? profile?.embedApi : c.type === 'image' ? profile?.imageApi : result.api;
    result.operationParameters = structuredClone(result.operationParameters ?? {});
    result.jobRecovery = ['comfy-image', 'bfl-image', 'fal-image', 'horde-image'].includes(profile?.imageApi);
    result.cancellation = local ? 'terminate-local-worker' : profile?.imageApi === 'comfy-image' ? 'pending-job-only'
        : ['fal-image', 'horde-image'].includes(profile?.imageApi) ? 'remote-request-confirmation-required' : 'stop-waiting-remote-outcome-unknown';
    result.modelSelection = c.provider === 'extras' ? 'server-configured' : 'request';
    if (profile?.imageApi === 'google-image') result.operationParameters.generateImage = /^(imagen-|imagegeneration)/.test(c.model ?? '') ? ['prompt', 'aspectRatio', 'count'] : ['prompt', 'aspectRatio', 'imageSize', 'count'];
    for (const key of ['embeddingBaseUrl', 'imageBaseUrl']) if (c[key] !== undefined) {
        try { const u = new URL(c[key]); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw 0; }
        catch { Object.assign(result, { supported: false, reason: `Invalid ${key}` }); }
    }
    if (local) result.baseUrl = null;
    if (profile?.embedApi === 'workers-embed' && (typeof c.accountId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(c.accountId))) Object.assign(result, { supported: false, reason: 'Workers accountId required' });
    return result;
}
export const getCapabilities = getAuxiliaryCapabilities;
