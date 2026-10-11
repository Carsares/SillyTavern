const TYPES = ['send', 'regenerate', 'continue', 'impersonate', 'auxiliary', 'group'];
const PROVIDERS = new Set(['openai', 'openai-compatible', 'openai_compatible']);
const positive = value => Number.isSafeInteger(value) && value > 0;

/** Pure synchronous preflight. Unknown protocols and unbounded budgets are disabled. */
export function getCapabilities(connection) {
    const c = connection?.data ?? connection ?? {};
    const result = {
        supported: false, provider: c.provider, executor: c.executor, model: c.model,
        types: [...TYPES], tools: true, media: ['text'],
        contextWindow: c.contextWindow, inputLimit: c.inputLimit ?? c.contextWindow,
        outputLimit: c.outputLimit ?? c.maxOutputTokens, maxOutputTokens: c.maxOutputTokens,
        workingBudget: c.workingBudget,
    };
    let reason;
    if (!['native', 'pi'].includes(c.executor) || !PROVIDERS.has(c.provider)) reason = 'Unsupported executor/provider combination';
    else if (c.type && c.type !== 'chat') reason = 'Only chat completion models are supported';
    else if (typeof c.model !== 'string' || !c.model.trim()) reason = 'A model ID is required';
    else if (c.reasoning && c.reasoning !== 'off') reason = 'Reasoning controls require a verified model capability';
    else if (![result.contextWindow, result.inputLimit, result.outputLimit, result.maxOutputTokens, result.workingBudget].every(positive)) reason = 'Finite positive integer budgets are required';
    else if (result.inputLimit > result.contextWindow || result.maxOutputTokens > result.outputLimit || result.maxOutputTokens >= result.contextWindow || result.workingBudget > Math.min(result.inputLimit, result.contextWindow - result.maxOutputTokens)) reason = 'Inconsistent model budgets';
    else {
        try {
            const url = new URL(c.baseUrl);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) reason = 'Invalid provider base URL';
        } catch { reason = 'Invalid provider base URL'; }
    }
    return reason ? { ...result, types: [], tools: false, reason } : { ...result, supported: true };
}
