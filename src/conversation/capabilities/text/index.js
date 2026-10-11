// Every textgen_types value has a concrete wire mapping; all live platforms remain unverified.
import { novelStopCapability } from './novel-tokenizers.js';
import { deepFreeze, describeCapability } from '../chat/index.js';
const sampling = ['temperature', 'top_p', 'top_k', 'min_p', 'repetition_penalty', 'seed', 'stop'];
const compatible = {
    ooba: [null, 'v1/completions'], mancer: ['https://neuro.mancer.tech', 'oai/v1/completions'],
    vllm: [null, 'v1/completions'], aphrodite: [null, 'v1/completions'], tabby: [null, 'v1/completions'],
    togetherai: ['https://api.together.xyz', 'v1/completions'], infermaticai: ['https://api.totalgpt.ai', 'v1/completions'],
    dreamgen: ['https://dreamgen.com', 'api/openai/v1/completions'],
    openrouter: ['https://openrouter.ai/api', 'v1/completions'],
    featherless: ['https://api.featherless.ai', 'v1/completions'], generic: [null, 'v1/completions'],
};
const profiles = Object.fromEntries(Object.entries(compatible).map(([id, [baseUrl, path]]) => [id, { api: 'openai-text', baseUrl, path, parameters: sampling }]));
Object.assign(profiles, {
    kobold: { api: 'kobold', baseUrl: null, path: 'api/v1/generate', parameters: sampling },
    koboldcpp: { api: 'kobold', baseUrl: null, path: 'api/v1/generate', parameters: sampling },
    novelai: { api: 'novelai', baseUrl: 'https://text.novelai.net', path: 'ai/generate', parameters: ['temperature', 'top_p', 'top_k', 'repetition_penalty', 'seed', 'stop'] },
    horde: { api: 'horde-text', baseUrl: 'https://aihorde.net/api/v2', path: 'generate/text/async', parameters: ['temperature', 'top_p', 'top_k', 'repetition_penalty', 'seed', 'stop'] },
    llamacpp: { api: 'llamacpp', baseUrl: null, path: 'completion', parameters: sampling },
    ollama: { api: 'ollama-generate', baseUrl: 'http://127.0.0.1:11434', path: 'api/generate', parameters: sampling },
    huggingface: { api: 'huggingface-tgi', baseUrl: null, path: 'generate', parameters: ['temperature', 'top_p', 'top_k', 'repetition_penalty', 'seed', 'stop'] },
});
for (const [id, profile] of Object.entries(profiles)) Object.assign(profile, { tools: false, media: ['text'], systemPlacement: 'text-template', streaming: !['horde', 'kobold'].includes(id) });
for (const id of ['ooba', 'koboldcpp']) {
    profiles[id].parameters = [...profiles[id].parameters, 'guidance_scale', 'negative_prompt'];
    profiles[id].guidance = { scale: 'guidance_scale', negativePrompt: 'negative_prompt', positivePrompt: 'prompt' };
}
profiles.koboldcpp.media = ['text', 'image', 'audio'];
profiles.ollama.media = ['text', 'image'];
export const TEXT_PROVIDERS = deepFreeze(profiles);
export function getTextCapabilities(connection, dependencies = {}) {
    const c = connection?.data ?? connection ?? {};
    const result = describeCapability(c, TEXT_PROVIDERS, 'text');
    if (c.provider !== 'novelai') return result;
    const stopTokenization = novelStopCapability(c, dependencies);
    return { ...result, stopTokenization, ...(stopTokenization.reason ? { supported: false, reason: stopTokenization.reason, types: [], tools: false } : {}) };
}
export const getCapabilities = getTextCapabilities;
