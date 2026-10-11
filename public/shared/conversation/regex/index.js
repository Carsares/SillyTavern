import { ProtocolError } from '../schemas/index.js';

export const REGEX_STAGES = Object.freeze(['before-macros', 'after-macros', 'history', 'output']);
export const REGEX_DEFAULTS = Object.freeze({ enabled: true, stage: 'after-macros', pattern: '', flags: 'g', replacement: '', roles: Object.freeze([]) });

export function applyRegex(text, rules = [], { stage, role = 'system' } = {}) {
    if (!REGEX_STAGES.includes(stage)) throw new ProtocolError('invalid-regex-stage', 'Unknown regex stage');
    let content = String(text);
    for (const rule of rules) {
        if (rule.enabled === false) continue;
        if (!REGEX_STAGES.includes(rule.stage)) throw new ProtocolError('invalid-regex-stage', 'Unknown regex rule stage');
        if (rule.stage !== stage || (rule.roles?.length && !rule.roles.includes(role))) continue;
        try {
            if (typeof rule.pattern !== 'string' || typeof rule.replacement !== 'string') throw new Error('Pattern and replacement must be strings');
            content = content.replace(new RegExp(rule.pattern, rule.flags ?? 'g'), rule.replacement);
        } catch (error) {
            throw new ProtocolError('invalid-regex', `Invalid regex rule ${rule.id ?? ''}: ${error.message}`);
        }
    }
    return content;
}
