import { fail } from './contracts.js';

export const REASONING_LEVELS = Object.freeze({
    claude: ['off', 'adaptive', 'low', 'medium', 'high', 'xhigh', 'max'],
    codex: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'persistent'],
});

/** SDK interface support does not imply every selected model supports the level. */
export function reasoningControls(executor, value, maxOutputTokens) {
    if (value === undefined || value === null) return { sdk: {}, wire: null, mode: 'sdk-default' };
    const invalid = () => { throw fail('unsupported-reasoning', 'Unsupported reasoning setting for selected SDK', 422); };
    if (typeof value === 'string') {
        if (!REASONING_LEVELS[executor].includes(value)) invalid();
        if (executor === 'codex') return {
            sdk: value === 'off' ? {} : { modelReasoningEffort: value },
            wire: { reasoning: { effort: value === 'off' ? 'none' : value } }, mode: value,
        };
        const thinking = { type: value === 'off' ? 'disabled' : 'adaptive' };
        const effort = ['off', 'adaptive'].includes(value) ? undefined : value;
        return { sdk: { thinking, ...(effort ? { effort } : {}) },
            wire: { thinking, ...(effort ? { output_config: { effort } } : {}) }, mode: value };
    }
    if (executor !== 'claude' || typeof value !== 'object' || Array.isArray(value)) invalid();
    if (Object.keys(value).some(k => !['thinking', 'effort'].includes(k))) invalid();
    const thinking = value.thinking ?? { type: 'adaptive' };
    if (!thinking || typeof thinking !== 'object' || Object.keys(thinking).some(k => !['type', 'budgetTokens', 'display'].includes(k))) invalid();
    if (!['adaptive', 'enabled', 'disabled'].includes(thinking.type)) invalid();
    if (thinking.display !== undefined && !['summarized', 'omitted'].includes(thinking.display)) invalid();
    if (thinking.type !== 'enabled' && thinking.budgetTokens !== undefined) invalid();
    if (thinking.type === 'disabled' && (thinking.display !== undefined || value.effort !== undefined)) invalid();
    if (value.effort !== undefined && !['low', 'medium', 'high', 'xhigh', 'max'].includes(value.effort)) invalid();
    if (thinking.type === 'enabled' && (!Number.isSafeInteger(thinking.budgetTokens) || thinking.budgetTokens < 1024 || thinking.budgetTokens >= maxOutputTokens)) {
        throw fail('invalid-thinking-budget', 'Claude thinking budget must be at least 1024 and below the actual output cap', 422);
    }
    const wireThinking = { type: thinking.type, ...(thinking.display ? { display: thinking.display } : {}),
        ...(thinking.type === 'enabled' ? { budget_tokens: thinking.budgetTokens } : {}) };
    return { sdk: { thinking: structuredClone(thinking), ...(value.effort ? { effort: value.effort } : {}) },
        wire: { thinking: wireThinking, ...(value.effort ? { output_config: { effort: value.effort } } : {}) }, mode: thinking.type };
}

export function applyReasoning(request, executor, value, maxOutputTokens) {
    const controls = reasoningControls(executor, value, maxOutputTokens);
    if (controls.wire) {
        if (executor === 'claude') { delete request.thinking; delete request.output_config; }
        else delete request.reasoning;
        Object.assign(request, structuredClone(controls.wire));
    }
    // Also validate SDK defaults after the gateway clamps max_tokens.
    if (executor === 'claude' && request.thinking?.type === 'enabled' &&
        (!Number.isSafeInteger(request.thinking.budget_tokens) || request.thinking.budget_tokens < 1024 || request.thinking.budget_tokens >= maxOutputTokens)) {
        throw fail('invalid-thinking-budget', 'SDK thinking budget exceeds the actual output cap', 422);
    }
    return controls;
}
