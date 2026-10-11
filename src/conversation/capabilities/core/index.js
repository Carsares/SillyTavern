const TYPES = ['send', 'regenerate', 'continue', 'impersonate', 'auxiliary', 'group'];
const PROVIDERS = new Set(['openai', 'openai-compatible', 'openai_compatible']);
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const positive = value => Number.isSafeInteger(value) && value > 0;
export function reasoningEffort(connection) {
    if (connection.reasoningEnabled === false) return 'off';
    return connection.effort ?? (typeof connection.reasoning === 'string' ? connection.reasoning : connection.reasoning?.effort) ?? 'off';
}

/** Validate provider-owned capabilities without claiming support for unknown combinations. */
export function validateCapabilities(connection, capability) {
    const c = connection?.data ?? connection ?? {};
    const result = { ...capability };
    if (!result.supported) return result;
    let reason;
    if (!['native', 'pi'].includes(c.executor)) reason = 'Unsupported executor';
    else if (typeof c.model !== 'string' || !c.model.trim()) reason = 'A model ID is required';
    else if (![result.contextWindow, result.inputLimit, result.outputLimit, result.maxOutputTokens, result.workingBudget].every(positive)) reason = 'Finite positive integer budgets are required';
    else if (result.inputLimit > result.contextWindow || result.maxOutputTokens > result.outputLimit || result.maxOutputTokens >= result.contextWindow || result.workingBudget > Math.min(result.inputLimit, result.contextWindow - result.maxOutputTokens)) reason = 'Inconsistent model budgets';
    else if (!Array.isArray(result.types) || !result.types.length || result.types.some(type => !TYPES.includes(type)) || typeof result.tools !== 'boolean') reason = 'Invalid provider capability shape';
    else if (!Array.isArray(result.media) || !result.media.includes('text') || result.media.some(type => !['text', 'image'].includes(type))) reason = 'Unsupported media capability';
    else if (result.media.includes('image') && (result.verified !== true || !positive(result.mediaTokenCost?.image))) reason = 'Images require verified positive mediaTokenCost.image';
    else if (result.reasoningEnabled && (result.verified !== true || !Array.isArray(result.reasoningEfforts) || !result.reasoningEfforts.length || result.reasoningEfforts.some(level => !EFFORTS.includes(level)))) reason = 'Reasoning requires verified finite effort levels';
    else if (reasoningEffort(c) !== 'off' && (!result.reasoningEnabled || !result.reasoningEfforts.includes(reasoningEffort(c)))) reason = 'Unsupported reasoning effort';
    else if (c.reasoningEnabled === true && reasoningEffort(c) === 'off') reason = 'An enabled reasoning request requires an explicit effort';
    else {
        try {
            const url = new URL(c.baseUrl);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) reason = 'Invalid provider base URL';
        } catch { reason = 'Invalid provider base URL'; }
    }
    return reason ? { ...result, supported: false, types: [], tools: false, reason } : result;
}

/** Default primary profile. Other provider owners supply a synchronous capabilityResolver. */
export function getCapabilities(connection) {
    const c = connection?.data ?? connection ?? {};
    const profile = c.capabilities ?? {};
    const result = {
        supported: true, provider: c.provider, executor: c.executor, model: c.model,
        types: [...TYPES], tools: true, media: profile.media ?? ['text'],
        verified: profile.verified === true, mediaTokenCost: profile.mediaTokenCost,
        reasoningEnabled: profile.reasoningEnabled === true, reasoningEfforts: profile.reasoningEfforts ?? [],
        contextWindow: c.contextWindow, inputLimit: c.inputLimit ?? c.contextWindow,
        outputLimit: c.outputLimit ?? c.maxOutputTokens, maxOutputTokens: c.maxOutputTokens,
        workingBudget: c.workingBudget,
    };
    if (!PROVIDERS.has(c.provider) || c.type && c.type !== 'chat') return { ...result, supported: false, types: [], tools: false, reason: 'Unsupported primary provider/type; register a provider capability resolver and stream' };
    return validateCapabilities(c, result);
}
