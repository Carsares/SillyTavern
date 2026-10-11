export const PRESET_DEFAULTS = Object.freeze({
    mode: 'chat', system: '', blocks: Object.freeze([]), regex: Object.freeze([]),
    textTemplate: Object.freeze({ prefix: '', message: '{{role}}: {{content}}\n', suffix: 'assistant:', separator: '' }),
});
export const BLOCK_DEFAULTS = Object.freeze({ layer: 'L5', role: 'system', placement: Object.freeze({ type: 'tail' }), priority: 0, required: true, sourceRefs: Object.freeze([]), content: '' });
export const CONTEXT_LAYERS = Object.freeze(['L1', 'L2', 'L3', 'L4', 'L5']);
