import { auxiliaryUsage } from './usage.js';
// Concrete embedding/image codecs; no auto-retry of chargeable image submissions; live-unverified.
import { unzipSync } from 'fflate';
import { getAuxiliaryCapabilities } from '../../capabilities/auxiliary/index.js';
import { fail } from '../core/index.js';
import { createTransport, requireCapability, pollHorde } from '../chat/http.js';
import { encodeNovelImage } from './novelai.js';
import { embedTexts } from './embedding.js';
import { generateNativeImage, validateImageOptions, cancelNativeJob } from './image-native.js';
import { relativeJobUrl } from './jobs.js';
import { imageList } from './common.js';

const positive = (value, name, max) => { if (!Number.isSafeInteger(value) || value < 1 || value > max) throw fail('invalid-image-options', `Invalid ${name}`); return value; };

export function createAuxiliaryAdapter(connection, options = {}) {
    const c = structuredClone(connection.data ?? connection);
    const capability = getAuxiliaryCapabilities(c);
    requireCapability(capability);
    const imageCapability = { ...capability, api: capability.imageApi,
        baseUrl: c.imageBaseUrl ?? c.baseUrl ?? capability.imageBaseUrl ?? capability.baseUrl };
    const embeddingCapability = { ...capability, api: capability.embedApi,
        baseUrl: c.embeddingBaseUrl ?? c.baseUrl ?? capability.baseUrl };
    const imageSend = createTransport(c, imageCapability, options);
    const send = (path, init) => {
        if (!/^https?:/.test(path)) return imageSend(path, init);
        const checked = relativeJobUrl(path, imageCapability.baseUrl, imageCapability.imageApi === 'bfl-image');
        if (!/^https?:/.test(checked)) return imageSend(checked, init);
        const url = new URL(checked);
        return createTransport(c, { ...imageCapability, baseUrl: url.origin }, options)(`${url.pathname}${url.search}`, init);
    };
    const embedSend = createTransport(c, embeddingCapability, options);
    const check = operation => { if (!capability.operations.includes(operation)) throw fail('unsupported-operation', `Provider does not implement ${operation}`); };
    const adapter = { capabilities: capability,
        async embed(texts, input = {}) {
            check('embed');
            return embedTexts(c, embeddingCapability, embedSend, texts, input, options);
        },
        async cancelJob(jobId, input = {}) {
            check('generateImage');
            if (capability.imageApi === 'horde-image') {
                if (typeof jobId !== 'string' || !/^[\w-]+$/.test(jobId)) throw fail('invalid-input', 'Invalid Horde job ID');
                await send(`generate/status/${jobId}`, { method: 'DELETE', signal: input.signal, headers: { authorization: null, apikey: c.apiKey || '0000000000' } });
                const result = { jobId, state: 'cancel-requested', resubmit: false };
                await (input.onJob ?? options.onJob)?.(result); return result;
            }
            if (!['comfy-image', 'bfl-image', 'fal-image'].includes(capability.imageApi)) throw fail('unsupported-operation', 'This image API has no queued cancellation');
            return cancelNativeJob(c, imageCapability, send, jobId, { ...input, onJob: input.onJob ?? options.onJob });
        },
        async generateImage(input = {}) {
            const { prompt, negativePrompt = '', width = 1024, height = 1024, count = 1, seed = 0, steps = 28, signal, onEvent } = input;
            check('generateImage');
            validateImageOptions(input, capability);
            if (!['openai-auxiliary', 'sd-webui-image', 'horde-image', 'stability-image', 'novelai-image'].includes(capability.imageApi)) {
                return generateNativeImage(c, imageCapability, send, { ...input, ...(input.jobId === undefined && options.jobId !== undefined ? { jobId: options.jobId } : {}) }, options);
            }
            if (typeof prompt !== 'string' || !prompt.trim()) throw fail('invalid-input', 'Image prompt required');
            positive(width, 'width', 4096); positive(height, 'height', 4096); positive(count, 'count', 4); positive(steps, 'steps', 150);
            if (!Number.isSafeInteger(seed) || seed < 0) throw fail('invalid-image-options', 'Invalid seed');
            let images, response;
            const api = capability.imageApi;
            if (api === 'openai-auxiliary') {
                if (negativePrompt) throw fail('unsupported-parameters', 'OpenAI images do not support a separate negative prompt');
                response = await send('images/generations', { signal, body: { model: c.model, prompt, size: `${width}x${height}`, n: count, ...(input.quality !== undefined ? { quality: input.quality } : {}), ...(input.style !== undefined ? { style: input.style } : {}), ...(input.outputFormat !== undefined ? { output_format: input.outputFormat } : {}) } });
                images = response.data?.map(item => item.b64_json ? { data: item.b64_json, mimeType: `image/${input.outputFormat ?? 'png'}` } : { url: item.url });
            } else if (api === 'sd-webui-image') {
                response = await send('sdapi/v1/txt2img', { signal, body: { prompt, negative_prompt: negativePrompt, width, height,
                    batch_size: count, n_iter: 1, steps, seed, ...(input.scale !== undefined ? { cfg_scale: input.scale } : {}), ...(input.sampler !== undefined ? { sampler_name: input.sampler } : {}), override_settings: { sd_model_checkpoint: c.model }, override_settings_restore_afterwards: true } });
                images = response.images?.map(data => ({ data, mimeType: 'image/png' }));
            } else if (api === 'horde-image') {
                response = await pollHorde(send, c, { prompt: negativePrompt ? `${prompt} ### ${negativePrompt}` : prompt,
                    models: [c.model], params: { width, height, n: count, steps, seed: String(seed) }, r2: true }, { signal, image: true, jobId: input.jobId ?? options.jobId, onJob: input.onJob ?? options.onJob });
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
                response = await send('ai/generate-image', { signal, body: encodeNovelImage(c.model, input), raw: true });
                const archive = new Uint8Array(await response.arrayBuffer());
                if (archive.length > 20 * 1024 * 1024) throw fail('provider-response-invalid', 'Image archive exceeds 20 MiB');
                try {
                    let imageCount = 0, totalBytes = 0;
                    const files = unzipSync(archive, { filter: file => {
                        if (!/\.(png|webp|jpe?g)$/i.test(file.name)) return false;
                        totalBytes += file.originalSize;
                        if (++imageCount > 4 || file.originalSize > 10 * 1024 * 1024 || totalBytes > 40 * 1024 * 1024) throw fail('provider-response-invalid', 'Image archive exceeds decoded limits');
                        return true;
                    } });
                    images = Object.entries(files).map(([name, bytes]) => ({ data: Buffer.from(bytes).toString('base64'), mimeType: /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg' }));
                } catch { throw fail('provider-response-invalid', 'Invalid image ZIP'); }
            }
            imageList(images);
            signal?.throwIfAborted();
            const result = { images, usage: auxiliaryUsage(api, response, { completed: true }), ...(response?.jobId ? { jobId: response.jobId } : {}) };
            await onEvent?.({ type: 'image.completed', count: images.length });
            return result;
        },
    };
    return { ...adapter, async generateImage(input) {
        try { return await adapter.generateImage(input); } catch (error) {
            const failure = error instanceof Error ? error : fail('provider-image-failed', 'Image generation failed');
            if (!['invalid-input', 'invalid-image-options', 'invalid-workflow', 'invalid-job', 'unsupported-operation', 'unsupported-parameters'].includes(failure.code)) {
                failure.details = { ...failure.details, outcome: failure.details?.outcome ?? 'unknown', resubmit: false };
            }
            throw failure;
        }
    } };
}
export const createProviderAdapter = createAuxiliaryAdapter;
