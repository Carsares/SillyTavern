import { ProtocolError } from '../schemas/index.js';

export const MACRO_DEFAULTS = Object.freeze({ unknown: 'error', maxLength: 1000000 });
const validName = name => /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name) && !['__proto__', 'constructor', 'prototype'].includes(name);

/** Single pass, no eval, no recursive interpolation of user supplied variable values. */
export function expandMacros(text, { variables = {}, bindings = {}, allowWrites = true } = {}) {
    const state = Object.assign(Object.create(null), variables);
    const effects = [];
    const content = String(text).replace(/\{\{([^{}]+)\}\}/g, (_, expression) => {
        const parts = expression.trim().split('::');
        const [operation, name, ...rest] = parts;
        if (parts.length === 1 && Object.hasOwn(bindings, operation)) return String(bindings[operation]);
        if (operation === 'get' && parts.length === 2 && validName(name)) return String(state[name] ?? '');
        if (['set', 'inc'].includes(operation) && validName(name) && parts.length >= 3) {
            if (!allowWrites) throw new ProtocolError('macro-write-forbidden', 'Variable writes are not permitted in this template');
            const raw = rest.join('::');
            const value = operation === 'set' ? raw : Number(state[name] ?? 0) + Number(raw);
            if (operation === 'inc' && (!raw.trim() || !Number.isFinite(value))) throw new ProtocolError('invalid-macro', 'Increment requires finite numbers');
            effects.push({ type: 'variable.set', name, previous: state[name] ?? null, value });
            state[name] = value;
            return '';
        }
        throw new ProtocolError('invalid-macro', `Unknown or malformed macro: ${expression}`);
    });
    if (content.length > MACRO_DEFAULTS.maxLength) throw new ProtocolError('invalid-macro', 'Expanded template is too long');
    return { content, variables: { ...state }, effects };
}
