const TYPES = ['send', 'regenerate', 'continue', 'impersonate', 'auxiliary', 'group'];
const PROVIDERS = new Set(['openai', 'openai-compatible']);
const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const positive = value => Number.isSafeInteger(value) && value > 0;
export function connectionShapeError(c) {
    if (!c || typeof c !== 'object' || Array.isArray(c) || Object.hasOwn(c, 'data')) return 'A flat connection object is required';
    if (Object.hasOwn(c, 'mediaTokenCost')) return 'Use capabilities.mediaTokenCost';
    if (Object.hasOwn(c, 'effort') || c.reasoning !== undefined && typeof c.reasoning !== 'string') return 'Use a reasoning mode string';
}
export function reasoningEffort(connection) {
    if (connection.reasoningEnabled === false) return 'off';
    return connection.reasoning ?? 'off';
}

/** Native codecs own the control vocabulary; the default SDK transport uses EFFORTS. */
export function reasoningCapabilityError(connection, capability) {
    const native = Array.isArray(capability.reasoning);
    const protocolModes = native ? capability.reasoning.filter(mode => mode !== 'off') : EFFORTS;
    const configured = capability.reasoningEfforts;
    const modes = native && (!configured || configured.length === 0) ? protocolModes : configured;
    if (capability.reasoningEnabled && (capability.verified !== true || !Array.isArray(modes) || !modes.length
        || modes.some(mode => typeof mode !== 'string' || !mode || !protocolModes.includes(mode))))
        return 'Reasoning requires verified controls supported by the provider protocol';
    const requested = reasoningEffort(connection);
    if (requested !== 'off' && (!capability.reasoningEnabled || !modes?.includes(requested))) return 'Unsupported reasoning control';
    if (connection.reasoningEnabled === true && requested === 'off') return 'An enabled reasoning request requires an explicit control';
}

/** Validate provider-owned capabilities without claiming support for unknown combinations. */
export function validateCapabilities(connection, capability) {
    const c = connection ?? {};
    const result = { ...capability };
    if (!result.supported) return result;
    let reason;
    const reasoningError = reasoningCapabilityError(c, result);
    if (connectionShapeError(c)) reason = connectionShapeError(c);
    else if (!['native', 'pi'].includes(c.executor)) reason = 'Unsupported executor';
    else if (typeof c.model !== 'string' || !c.model.trim()) reason = 'A model ID is required';
    else if (![result.contextWindow, result.inputLimit, result.outputLimit, result.maxOutputTokens, result.workingBudget].every(positive)) reason = 'Finite positive integer budgets are required';
    else if (result.inputLimit > result.contextWindow || result.maxOutputTokens > result.outputLimit || result.maxOutputTokens >= result.contextWindow || result.workingBudget > Math.min(result.inputLimit, result.contextWindow - result.maxOutputTokens)) reason = 'Inconsistent model budgets';
    else if (!Array.isArray(result.types) || !result.types.length || result.types.some(type => !TYPES.includes(type)) || typeof result.tools !== 'boolean') reason = 'Invalid provider capability shape';
    else if (!Array.isArray(result.media) || !result.media.includes('text') || result.media.some(type => !['text', 'image', 'audio', 'video', 'document'].includes(type))) reason = 'Unsupported media capability';
    else if (result.media.some(type => type !== 'text' && (result.verified !== true || !positive(result.mediaTokenCost?.[type])))) reason = 'Media requires verified positive mediaTokenCost for every type';
    else if (reasoningError) reason = reasoningError;
    else {
        try {
            const url = new URL(result.baseUrl ?? c.baseUrl);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) reason = 'Invalid provider base URL';
        } catch { reason = 'Invalid provider base URL'; }
    }
    return reason ? { ...result, supported: false, types: [], tools: false, reason } : result;
}

/** Default primary profile. Other provider owners supply a synchronous capabilityResolver. */
export function getCapabilities(connection) {
    const c = connection ?? {};
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
    if (result.media.some(type => !['text', 'image'].includes(type))) return { ...result, supported: false, types: [], tools: false, reason: 'Extended media requires a protocol capability resolver and stream' };
    return validateCapabilities(c, result);
}
