// Provider-native controls; explicit configuration does not assert model support.
import { reasoningMode, CHAT_PROVIDERS } from '../../capabilities/chat/index.js';
import { fail } from '../core/index.js';
export function applyReasoning(body, c, api, maxOutputTokens) {
    const mode = reasoningMode(c) ?? (['deepseek', 'openrouter'].includes(c.provider) ? 'off' : undefined);
    if (!mode) return body;
    if (c.provider === 'deepseek') {
        body.thinking = { type: mode === 'off' ? 'disabled' : 'enabled' };
        if (mode !== 'off') {
            const effort = CHAT_PROVIDERS.deepseek.reasoningMapping[mode];
            if (!effort) throw fail('unsupported-reasoning', 'Unsupported DeepSeek effort');
            body.reasoning_effort = effort;
            for (const key of ['temperature', 'presence_penalty', 'frequency_penalty']) if (body[key] !== undefined) throw fail('unsupported-parameters', `DeepSeek thinking ignores ${key}`);
            if (body.top_p !== undefined && (body.top_p < 0.95 || body.top_p > 1)) throw fail('invalid-parameters', 'DeepSeek thinking top_p must be 0.95..1');
        } else {
            delete body.reasoning_effort;
            if (body.top_p !== undefined && body.top_p !== 1) throw fail('unsupported-parameters', 'DeepSeek non-thinking top_p is fixed at 1');
        }
        return body;
    }
    const budget = c.reasoningBudget;
    if (mode === 'budget' && (!Number.isSafeInteger(budget) || budget < 1 || budget >= maxOutputTokens)) throw fail('invalid-reasoning-budget', 'Reasoning budget must fit inside the output reserve');
    if (c.provider === 'openrouter') {
        body.reasoning = mode === 'off' ? { enabled: false } : { enabled: true, ...(mode === 'budget' ? { max_tokens: budget } : mode === 'on' ? {} : { effort: mode }) };
        return body;
    }
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
