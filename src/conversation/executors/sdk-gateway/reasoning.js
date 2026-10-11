import { fail } from './contracts.js';

export const REASONING_LEVELS = Object.freeze({
    claude: ['off', 'adaptive', 'low', 'medium', 'high', 'xhigh', 'max'],
    codex: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'persistent'],
});

/** SDK interface support does not imply every selected model supports the level. */
export function reasoningControls(executor, value) {
    if (value === undefined) return { sdk: {}, wire: null, mode: 'sdk-default' };
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
    invalid();
}

export function applyReasoning(request, executor, value, maxOutputTokens) {
    const controls = reasoningControls(executor, value);
    if (controls.wire) {
        if (executor === 'claude') { delete request.thinking; delete request.output_config; } else delete request.reasoning;
        Object.assign(request, structuredClone(controls.wire));
    }
    // Also validate SDK defaults after the gateway clamps max_tokens.
    if (executor === 'claude' && request.thinking?.type === 'enabled' &&
        (!Number.isSafeInteger(request.thinking.budget_tokens) || request.thinking.budget_tokens < 1024 || request.thinking.budget_tokens >= maxOutputTokens)) {
        throw fail('invalid-thinking-budget', 'SDK thinking budget exceeds the actual output cap', 422);
    }
    return controls;
}
