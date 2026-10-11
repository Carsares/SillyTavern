import { fail } from '../core/index.js';

/** Preserve opaque signed/encrypted blocks; never convert them to ordinary text. */
export function reasoningDetails(value) {
    if (!Array.isArray(value) || value.length > 4096 || value.some(part => !part || typeof part !== 'object' || Array.isArray(part) || !['reasoning.text', 'reasoning.summary', 'reasoning.encrypted'].includes(part.type))) throw fail('provider-response-invalid', 'Invalid reasoning details');
    return structuredClone(value);
}
export const reasoningText = details => details.map(part => part.type === 'reasoning.text' ? part.text ?? '' : part.type === 'reasoning.summary' ? part.summary ?? '' : '').join('');

export function mergeReasoningDetails(target, delta) {
    for (const part of reasoningDetails(delta)) {
        if (part.index !== undefined && (!Number.isSafeInteger(part.index) || part.index < 0 || part.index > 4096)) throw fail('provider-response-invalid', 'Invalid reasoning detail index');
        const found = target.find(item => part.index !== undefined ? item.index === part.index : part.id != null && item.id === part.id);
        if (!found) { target.push(part); continue; }
        if (found.type !== part.type) throw fail('provider-response-invalid', 'Reasoning detail type changed');
        for (const [key, value] of Object.entries(part)) {
            if (['text', 'summary', 'data', 'signature'].includes(key) && typeof value === 'string') found[key] = (found[key] ?? '') + value;
            else if (value !== null) found[key] = value;
        }
    }
    if (target.length > 4096) throw fail('provider-response-invalid', 'Too many reasoning details');
}
