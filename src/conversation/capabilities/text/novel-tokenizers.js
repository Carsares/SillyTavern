// Explicit aliases only: never assume a future model revision uses the same vocabulary.
export const NOVEL_TOKENIZER_MODELS = Object.freeze({
    clio: 'clio', 'clio-v1': 'clio',
    kayra: 'kayra', 'kayra-v1': 'kayra',
    erato: 'erato', 'erato-v1': 'erato',
});
export const novelTokenizerFamily = model => Object.hasOwn(NOVEL_TOKENIZER_MODELS, model ?? '') ? NOVEL_TOKENIZER_MODELS[model] : undefined;

export function novelStopCapability(connection, { tokenize } = {}) {
    const family = novelTokenizerFamily(connection.model);
    const injected = typeof tokenize === 'function';
    const stop = connection.parameters?.stop;
    const strings = typeof stop === 'string' ? [stop] : stop;
    const valid = stop === undefined || Array.isArray(strings) && strings.length <= 1024 && strings.every(text => typeof text === 'string' && text.length > 0 && text.length <= 16384);
    const supported = Boolean(family || injected);
    return { supported, family: family ?? null, source: injected ? 'injected' : family ? 'bundled-local' : 'unavailable',
        reason: !valid ? 'NovelAI stop requires at most 1024 nonempty bounded strings'
            : strings?.length && !supported ? 'NovelAI stop tokenizer unavailable for this model; inject tokenize or choose an explicitly supported model' : undefined };
}
