// Concrete embedding/image codecs; no auto-retry of chargeable image submissions; live-unverified.
import { unzipSync } from 'fflate';
import { getAuxiliaryCapabilities } from '../../capabilities/auxiliary/index.js';
import { fail } from '../core/index.js';
import { createTransport, requireCapability, usage, pollHorde } from '../chat/http.js';

function vectors(value, count) {
    if (!Array.isArray(value) || value.length !== count || value.some(vector => !Array.isArray(vector) || !vector.length || vector.length !== value[0].length || vector.some(number => !Number.isFinite(number)))) {
        throw fail('provider-response-invalid', 'Embedding count or dimensions are invalid');
    }
    return value;
}
const positive = (value, name, max) => { if (!Number.isSafeInteger(value) || value < 1 || value > max) throw fail('invalid-image-options', `Invalid ${name}`); return value; };

export function createAuxiliaryAdapter(connection, options = {}) {
    const c = structuredClone(connection.data ?? connection);
    const capability = getAuxiliaryCapabilities(c);
    requireCapability(capability);
    const send = createTransport(c, capability, options);
    const check = operation => { if (!capability.operations.includes(operation)) throw fail('unsupported-operation', `Provider does not implement ${operation}`); };
    return { capabilities: capability,
        async embed(texts, { signal, inputType = 'search_document', dimensions } = {}) {
            check('embed');
            if (!Array.isArray(texts) || !texts.length || texts.some(text => typeof text !== 'string')) throw fail('invalid-input', 'embed requires a nonempty string array');
            if (dimensions !== undefined) positive(dimensions, 'dimensions', 65536);
            const api = capability.api;
            let response, embeddings, tokens;
            if (api === 'openai-auxiliary') {
                response = await send('embeddings', { signal, body: { model: c.model, input: texts, encoding_format: 'float', ...(dimensions ? { dimensions } : {}) } });
                const data = response.data;
                if (!Array.isArray(data) || new Set(data.map(item => item.index)).size !== texts.length || data.some(item => !Number.isInteger(item.index) || item.index < 0 || item.index >= texts.length)) throw fail('provider-response-invalid', 'Invalid embedding indices');
                embeddings = [...data].sort((a, b) => a.index - b.index).map(item => item.embedding);
                tokens = usage(response.usage?.prompt_tokens, 0);
            } else if (api === 'cohere-embed') {
                if (!['search_document', 'search_query', 'classification', 'clustering'].includes(inputType)) throw fail('invalid-input', 'Invalid Cohere inputType');
                response = await send('embed', { signal, body: { model: c.model, texts, input_type: inputType, embedding_types: ['float'], ...(dimensions ? { output_dimension: dimensions } : {}) } });
                embeddings = response.embeddings?.float; tokens = usage(response.meta?.billed_units?.input_tokens, 0);
            } else if (api === 'google-embed') {
                const model = `models/${c.model.replace(/^models\//, '')}`;
                response = await send(`${model}:batchEmbedContents`, { signal, headers: { authorization: null, 'x-goog-api-key': c.apiKey ?? '' },
                    body: { requests: texts.map(text => ({ model, content: { parts: [{ text }] }, ...(dimensions ? { outputDimensionality: dimensions } : {}) })) } });
                embeddings = response.embeddings?.map(item => item.values); tokens = usage();
            } else if (api === 'ollama-embed') {
                response = await send('api/embed', { signal, body: { model: c.model, input: texts, truncate: false, ...(dimensions ? { dimensions } : {}) } });
                embeddings = response.embeddings; tokens = usage(response.prompt_eval_count, 0);
            }
            return { embeddings: vectors(embeddings, texts.length), model: c.model, usage: tokens };
        },
        async generateImage({ prompt, negativePrompt = '', width = 1024, height = 1024, count = 1, seed = 0, steps = 28, signal, onEvent } = {}) {
            check('generateImage');
            if (typeof prompt !== 'string' || !prompt.trim()) throw fail('invalid-input', 'Image prompt required');
            positive(width, 'width', 4096); positive(height, 'height', 4096); positive(count, 'count', 4); positive(steps, 'steps', 150);
            if (!Number.isSafeInteger(seed) || seed < 0) throw fail('invalid-image-options', 'Invalid seed');
            let images, response, tokens = usage();
            const api = capability.api;
            if (api === 'openai-auxiliary') {
                if (negativePrompt) throw fail('unsupported-parameters', 'OpenAI images do not support a separate negative prompt');
                response = await send('images/generations', { signal, body: { model: c.model, prompt, size: `${width}x${height}`, n: count } });
                images = response.data?.map(item => item.b64_json ? { data: item.b64_json, mimeType: 'image/png' } : { url: item.url });
                tokens = usage(response.usage?.input_tokens, response.usage?.output_tokens);
            } else if (api === 'sd-webui-image') {
                response = await send('sdapi/v1/txt2img', { signal, body: { prompt, negative_prompt: negativePrompt, width, height,
                    batch_size: count, n_iter: 1, steps, seed, override_settings: { sd_model_checkpoint: c.model }, override_settings_restore_afterwards: true } });
                images = response.images?.map(data => ({ data, mimeType: 'image/png' }));
            } else if (api === 'horde-image') {
                response = await pollHorde(send, c, { prompt: negativePrompt ? `${prompt} ### ${negativePrompt}` : prompt,
                    models: [c.model], params: { width, height, n: count, steps, seed: String(seed) }, r2: true }, { signal, image: true });
                images = response.generations?.map(item => /^https?:\/\//.test(item.img) ? { url: item.img } : { data: item.img, mimeType: 'image/webp' });
            } else if (api === 'stability-image') {
                if (count !== 1) throw fail('unsupported-parameters', 'Stability request generates one image');
                const ratio = `${width}:${height}`;
                const gcd = (a, b) => b ? gcd(b, a % b) : a;
                const divisor = gcd(width, height);
                const aspect = `${width / divisor}:${height / divisor}`;
                if (!['1:1', '16:9', '21:9', '2:3', '3:2', '4:5', '5:4', '9:16', '9:21'].includes(aspect)) throw fail('unsupported-parameters', `Unsupported aspect ratio ${ratio}`);
                const form = new FormData();
                for (const [key, value] of Object.entries({ prompt, negative_prompt: negativePrompt, aspect_ratio: aspect, seed, output_format: 'png', model: c.model })) form.set(key, String(value));
                response = await send('v2beta/stable-image/generate/sd3', { signal, body: form, headers: { accept: 'image/*' }, raw: true });
                if (!response.headers.get('content-type')?.startsWith('image/')) throw fail('provider-response-invalid', 'Expected an image response');
                images = [{ data: Buffer.from(await response.arrayBuffer()).toString('base64'), mimeType: response.headers.get('content-type') }];
            } else if (api === 'novelai-image') {
                response = await send('ai/generate-image', { signal, body: { input: prompt, model: c.model, action: 'generate',
                    parameters: { width, height, n_samples: count, seed, steps, scale: 5, sampler: 'k_euler', negative_prompt: negativePrompt } }, raw: true });
                const archive = new Uint8Array(await response.arrayBuffer());
                if (archive.length > 20 * 1024 * 1024) throw fail('provider-response-invalid', 'Image archive exceeds 20 MiB');
                try {
                    const files = unzipSync(archive, { filter: file => /\.(png|webp|jpe?g)$/i.test(file.name) && file.originalSize <= 10 * 1024 * 1024 });
                    images = Object.entries(files).map(([name, bytes]) => ({ data: Buffer.from(bytes).toString('base64'), mimeType: /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg' }));
                } catch { throw fail('provider-response-invalid', 'Invalid image ZIP'); }
            }
            if (!images?.length || images.some(image => !(typeof image.data === 'string' && image.data.length) && !(typeof image.url === 'string' && /^https?:\/\//.test(image.url)))) throw fail('provider-response-invalid', 'Missing generated images');
            signal?.throwIfAborted();
            const result = { images, usage: tokens, ...(response?.jobId ? { jobId: response.jobId } : {}) };
            await onEvent?.({ type: 'image.completed', count: images.length });
            return result;
        },
    };
}
export const createProviderAdapter = createAuxiliaryAdapter;
