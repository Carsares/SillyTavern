// Provider-native controls; explicit configuration does not assert model support.
import { fail } from '../core/index.js';
export function applyReasoning(body, c, api, maxOutputTokens) {
    if (!c.reasoning) return body;
    const mode = c.reasoning;
    const budget = c.reasoningBudget;
    if (mode === 'budget' && (!Number.isSafeInteger(budget) || budget < 1 || budget >= maxOutputTokens)) throw fail('invalid-reasoning-budget', 'Reasoning budget must fit inside the output reserve');
    if (api === 'anthropic-messages') {
        if (mode === 'off') body.thinking = { type: 'disabled' };
        else if (mode === 'adaptive') body.thinking = { type: 'adaptive' };
        else {
            if (budget < 1024) throw fail('invalid-reasoning-budget', 'Anthropic enabled thinking requires at least 1024 tokens');
            body.thinking = { type: 'enabled', budget_tokens: budget };
        }
    } else if (api.startsWith('google')) {
        body.generationConfig.thinkingConfig = mode === 'off' ? { thinkingBudget: 0 } : mode === 'budget'
            ? { thinkingBudget: budget, includeThoughts: true } : { thinkingLevel: mode, includeThoughts: true };
    } else if (api === 'cohere-v2') {
        body.thinking = mode === 'off' ? { type: 'disabled' } : { type: 'enabled', ...(mode === 'budget' ? { token_budget: budget } : {}) };
    } else if (api !== 'ai21-jamba' && mode !== 'off') body.reasoning_effort = mode;
    // "off" on compatible APIs means no effort override; it cannot disable a reasoning-only model.
    return body;
}
