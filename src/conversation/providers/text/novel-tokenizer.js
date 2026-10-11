// Local tokenizer assets only. No legacy engine/state imports, downloads, or estimates.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { novelTokenizerFamily } from '../../capabilities/text/novel-tokenizers.js';
import { fail } from '../core/index.js';

export function createNovelTokenizer() {
    const instances = new Map();
    return async (text, { model, signal } = {}) => {
        signal?.throwIfAborted();
        const family = novelTokenizerFamily(model);
        if (!family) throw fail('unsupported-tokenizer', 'NovelAI model requires an explicit tokenize injection');
        if (!instances.has(family)) instances.set(family, (async () => {
            if (family === 'erato') {
                const { Tokenizer } = await import('@agnai/web-tokenizers');
                return Tokenizer.fromJSON(await readFile(new URL('../../../tokenizers/llama3.json', import.meta.url)));
            }
            const { SentencePieceProcessor } = await import('@agnai/sentencepiece-js');
            const instance = new SentencePieceProcessor();
            await instance.load(fileURLToPath(new URL(`../../../tokenizers/${family === 'clio' ? 'nerdstash' : 'nerdstash_v2'}.model`, import.meta.url)));
            return instance;
        })());
        let instance;
        try { instance = await instances.get(family); } catch { instances.delete(family); throw fail('tokenizer-unavailable', 'Could not load the local NovelAI tokenizer'); }
        signal?.throwIfAborted();
        return Array.from(family === 'erato' ? instance.encode(text) : instance.encodeIds(text));
    };
}
export const tokenizeNovelText = createNovelTokenizer();

export async function novelParameters(sampling, model, tokenize = tokenizeNovelText, signal) {
    const { stop, ...result } = sampling;
    if (stop === undefined) return result;
    const strings = typeof stop === 'string' ? [stop] : stop;
    if (!Array.isArray(strings) || strings.length > 1024 || strings.some(text => typeof text !== 'string' || !text.length || text.length > 16384)) throw fail('invalid-parameters', 'NovelAI stop requires at most 1024 nonempty bounded strings');
    const sequences = [];
    for (const text of strings) {
        signal?.throwIfAborted();
        const encoded = await tokenize(text, { model, signal });
        signal?.throwIfAborted();
        if (!(Array.isArray(encoded) || ArrayBuffer.isView(encoded))) throw fail('invalid-tokenization', 'Tokenizer must return token IDs');
        const ids = Array.from(encoded);
        if (!ids.length || ids.length > 16384 || ids.some(id => !Number.isSafeInteger(id) || id < 0 || id > 0x7fffffff)) throw fail('invalid-tokenization', 'Invalid stop token IDs');
        sequences.push(ids);
    }
    return { ...result, stop_sequences: sequences };
}
