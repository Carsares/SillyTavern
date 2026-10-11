// Wire-protocol coverage, not a claim that any remote model/platform was live-verified.
export const GENERATION_TYPES = Object.freeze(['send', 'regenerate', 'continue', 'impersonate', 'auxiliary', 'group']);
export const deepFreeze = object => { for (const value of Object.values(object)) if (value && typeof value === 'object') deepFreeze(value); return Object.freeze(object); };
const common = ['temperature', 'top_p', 'stop', 'frequency_penalty', 'presence_penalty', 'seed'];
const endpoints = {
    openai: 'https://api.openai.com/v1', 'openai-compatible': null, openai_compatible: null, custom: null,
    openrouter: 'https://openrouter.ai/api/v1', mistralai: 'https://api.mistral.ai/v1',
    perplexity: 'https://api.perplexity.ai', groq: 'https://api.groq.com/openai/v1',
    electronhub: null, chutes: null, nanogpt: null, deepseek: 'https://api.deepseek.com/v1',
    aimlapi: null, xai: 'https://api.x.ai/v1', pollinations: 'https://gen.pollinations.ai/v1',
    moonshot: 'https://api.moonshot.ai/v1', fireworks: 'https://api.fireworks.ai/inference/v1',
    cometapi: null, zai: 'https://api.z.ai/api/paas/v4', siliconflow: 'https://api.siliconflow.com/v1',
    workers_ai: null, minimax: 'https://api.minimax.io/v1',
};
const profiles = Object.fromEntries(Object.entries(endpoints).map(([id, baseUrl]) => [id, {
    api: 'openai-chat', baseUrl, path: 'chat/completions', tools: !['perplexity', 'pollinations'].includes(id),
    media: ['text', 'image'], parameters: common, systemPlacement: 'any',
}]));
Object.assign(profiles, {
    anthropic: { api: 'anthropic-messages', baseUrl: 'https://api.anthropic.com/v1', path: 'messages', tools: true, media: ['text', 'image'], parameters: ['temperature', 'top_p', 'top_k', 'stop'], systemPlacement: 'prefix' },
    google: { api: 'google-generate-content', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', path: 'models/{model}:generateContent', tools: true, media: ['text', 'image'], parameters: ['temperature', 'top_p', 'top_k', 'stop', 'seed'], systemPlacement: 'prefix' },
    vertexai: { api: 'google-vertex', baseUrl: null, path: 'models/{model}:generateContent', tools: true, media: ['text', 'image'], parameters: ['temperature', 'top_p', 'top_k', 'stop', 'seed'], systemPlacement: 'prefix' },
    cohere: { api: 'cohere-v2', baseUrl: 'https://api.cohere.com/v2', path: 'chat', tools: true, media: ['text'], parameters: ['temperature', 'top_p', 'top_k', 'stop', 'frequency_penalty', 'presence_penalty', 'seed'], systemPlacement: 'any' },
    ai21: { api: 'ai21-jamba', baseUrl: 'https://api.ai21.com/studio/v1', path: 'chat/completions', tools: true, media: ['text'], parameters: ['temperature', 'top_p', 'stop', 'frequency_penalty', 'presence_penalty'], systemPlacement: 'any' },
    azure_openai: { api: 'azure-chat', baseUrl: null, path: 'openai/deployments/{deployment}/chat/completions', tools: true, media: ['text', 'image'], parameters: common, systemPlacement: 'any' },
});
profiles.claude = profiles.anthropic;
profiles.makersuite = profiles.google;
for (const profile of Object.values(profiles)) {
    profile.streaming = true;
    profile.reasoning = profile.api === 'anthropic-messages' ? ['off', 'budget', 'adaptive']
        : profile.api.startsWith('google') ? ['off', 'budget', 'low', 'medium', 'high']
            : profile.api === 'cohere-v2' ? ['off', 'budget', 'on']
                : profile.api === 'ai21-jamba' ? [] : ['off', 'minimal', 'low', 'medium', 'high'];
}
export const CHAT_PROVIDERS = deepFreeze(profiles);

export function describeCapability(connection, registry, type) {
    const c = connection?.data ?? connection ?? {};
    const p = registry[c.provider];
    if (!p) return { supported: false, provider: c.provider, reason: 'Unknown provider', types: [], tools: false, media: [] };
    let reason;
    const baseUrl = c.baseUrl ?? p.baseUrl;
    try { const u = new URL(baseUrl); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) reason = 'Invalid baseUrl'; } catch { reason = 'Explicit baseUrl required'; }
    if (!c.model || typeof c.model !== 'string') reason = 'Explicit model required';
    if (type !== 'auxiliary' && ![c.contextWindow, c.maxOutputTokens].every(value => Number.isSafeInteger(value) && value > 0)) reason = 'Finite contextWindow and maxOutputTokens required';
    if (c.provider === 'azure_openai' && (!c.deployment || !c.apiVersion)) reason = 'Azure deployment and apiVersion required';
    if (c.reasoning && c.reasoning !== 'off' && !(p.reasoning ?? []).includes(c.reasoning)) reason = 'Unsupported reasoning control for this API';
    const controls = c.parameters ?? {};
    if (!controls || typeof controls !== 'object' || Array.isArray(controls) || Object.keys(controls).some(key => !p.parameters.includes(key))) reason = 'Unsupported parameter';
    return { ...p, provider: c.provider, baseUrl, type, supported: !reason, reason,
        types: reason ? [] : [...GENERATION_TYPES], tools: !reason && p.tools,
        protocolMedia: [...p.media], media: p.media.filter(item => item === 'text' || Number.isSafeInteger((c.mediaTokenCost ?? c.capabilities?.mediaTokenCost)?.[item])),
        mediaTokenCost: c.mediaTokenCost ?? c.capabilities?.mediaTokenCost,
        verified: c.capabilities?.verified === true,
        reasoningEnabled: c.capabilities?.reasoningEnabled === true,
        reasoningEfforts: c.capabilities?.reasoningEfforts ?? [],
        parameters: [...p.parameters], liveVerified: false,
        validation: 'fake-fetch-protocol-only', streaming: p.streaming ?? false,
        contextWindow: c.contextWindow, maxOutputTokens: c.maxOutputTokens,
        inputLimit: c.inputLimit ?? c.contextWindow, outputLimit: c.outputLimit ?? c.maxOutputTokens,
        workingBudget: c.workingBudget, modelFeatureVerification: 'required-per-model' };
}
export const getChatCapabilities = connection => describeCapability(connection, CHAT_PROVIDERS, 'chat');
export const getCapabilities = getChatCapabilities;
