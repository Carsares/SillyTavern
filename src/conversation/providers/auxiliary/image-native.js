import { fail } from '../core/index.js';
import { usage } from '../chat/http.js';
import { binaryImage, imageList, modelPath, integer, fields } from './common.js';
import { runJob, decodeJob, relativeJobUrl } from './jobs.js';

const values = (input, mapping) => Object.fromEntries(Object.entries(mapping).filter(([key]) => input[key] !== undefined).map(([key, wire]) => [wire, input[key]]));
const openaiImages = data => data?.map(i => i.b64_json ? { data: i.b64_json, mimeType: 'image/png' } : { url: i.url });
function inlineImage(url) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(url ?? '');
    if (!match) throw fail('provider-response-invalid', 'Expected an inline generated image');
    return { mimeType: match[1], data: match[2] };
}
export function validateImageOptions(input, capability) {
    fields(input, [...capability.operationParameters.generateImage, 'signal', 'onEvent', 'idempotencyKey'], 'Image');
    if (typeof input.prompt !== 'string' || !input.prompt.trim()) throw fail('invalid-input', 'Image prompt required');
    for (const key of ['width', 'height']) if (input[key] !== undefined) integer(input[key], key, 1, 4096);
    if (input.count !== undefined) integer(input.count, 'count', 1, 4);
    if (input.steps !== undefined) integer(input.steps, 'steps', 1, 150);
    if (input.seed !== undefined) integer(input.seed, 'seed', 0, Number.MAX_SAFE_INTEGER);
    if (input.scale !== undefined && (!Number.isFinite(input.scale) || input.scale <= 0 || input.scale > 100)) throw fail('invalid-input', 'Invalid scale');
    for (const key of ['negativePrompt', 'sampler', 'scheduler', 'imageSize', 'resolution', 'quality', 'style', 'outputFormat', 'idempotencyKey']) if (input[key] !== undefined && (typeof input[key] !== 'string' || (key !== 'negativePrompt' && !input[key]))) throw fail('invalid-input', `Invalid ${key}`);
    if (input.aspectRatio !== undefined && (typeof input.aspectRatio !== 'string' || !/^\d{1,3}:\d{1,3}$/.test(input.aspectRatio) || input.aspectRatio.split(':').some(n => Number(n) === 0))) throw fail('invalid-input', 'Invalid aspectRatio');
    for (const key of ['enhance', 'promptUpsampling']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw fail('invalid-input', `Invalid ${key}`);
    if (input.outputFormat !== undefined && !['png', 'jpeg', 'webp'].includes(input.outputFormat)) throw fail('invalid-input', 'Invalid outputFormat');
}
export function comfyWorkflow(c, input) {
    const workflow = structuredClone(input.workflow ?? c.workflow);
    const bindings = input.bindings ?? c.bindings;
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow) || !Object.keys(workflow).length || !bindings || typeof bindings !== 'object') throw fail('invalid-workflow', 'Comfy API-format workflow and explicit input bindings are required');
    if (JSON.stringify(workflow).length > 1024 * 1024 || Object.keys(workflow).length > 512) throw fail('invalid-workflow', 'Workflow exceeds limits');
    for (const node of Object.values(workflow)) if (!node || typeof node.class_type !== 'string' || !node.inputs || typeof node.inputs !== 'object') throw fail('invalid-workflow', 'Invalid Comfy node');
    const controls = { model: c.model, prompt: input.prompt, ...Object.fromEntries(['negativePrompt', 'width', 'height', 'count', 'seed', 'steps', 'scale'].filter(k => input[k] !== undefined).map(k => [k, input[k]])) };
    for (const key of Object.keys(bindings)) if (!['model', 'prompt', 'negativePrompt', 'width', 'height', 'count', 'seed', 'steps', 'scale'].includes(key)) throw fail('invalid-workflow', 'Unknown workflow control binding');
    for (const [key, value] of Object.entries(controls)) {
        const targets = bindings[key];
        if (!Array.isArray(targets) || !targets.length) throw fail('unsupported-parameters', `Comfy workflow has no ${key} binding`);
        for (const target of targets) {
            if (!Array.isArray(target) || target.length !== 2 || target.some(p => typeof p !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(p)) || !Object.hasOwn(workflow, target[0]) || !Object.hasOwn(workflow[target[0]].inputs, target[1])) throw fail('invalid-workflow', 'Binding must target an existing node input');
            workflow[target[0]].inputs[target[1]] = value;
        }
    }
    return workflow;
}

export async function generateNativeImage(c, cap, send, input, options = {}) {
    const { signal, prompt } = input;
    const api = cap.imageApi;
    let images, response, jobId;
    const defaultSize = { width: input.width ?? 1024, height: input.height ?? 1024 };
    const native = { prompt, ...values(input, { negativePrompt: 'negative_prompt', seed: 'seed' }) };
    const headers = api === 'bfl-image' ? { authorization: null, 'x-key': c.apiKey ?? '' }
        : api === 'fal-image' ? { authorization: `Key ${c.apiKey ?? ''}` } : undefined;
    if (api === 'comfy-image' || api === 'bfl-image' || api === 'fal-image') {
        let body, submitPath;
        if (api === 'comfy-image') { body = { prompt: comfyWorkflow(c, input) }; submitPath = 'prompt'; }
        if (api === 'bfl-image') {
            const ultra = c.model.endsWith('-ultra');
            if (input.outputFormat === 'webp') throw fail('unsupported-parameters', 'BFL output format must be png or jpeg');
            if ((ultra && ['width','height','steps','scale','promptUpsampling'].some(k => input[k] !== undefined)) || (c.model === 'flux-pro-1.1' && ['steps','scale','aspectRatio'].some(k => input[k] !== undefined))) throw fail('unsupported-parameters', 'Selected BFL model does not implement these controls');
            if (!ultra && input.aspectRatio !== undefined) throw fail('unsupported-parameters', 'This BFL codec requires explicit pixel dimensions for non-ultra models');
            body = { prompt, ...(ultra ? { aspect_ratio: input.aspectRatio ?? '1:1' } : defaultSize), ...values(input, { seed: 'seed', steps: 'steps', scale: 'guidance', promptUpsampling: 'prompt_upsampling', outputFormat: 'output_format' }) };
            submitPath = modelPath(c.model);
        }
        if (api === 'fal-image') {
            body = { ...native, image_size: defaultSize, num_images: input.count ?? 1, ...values(input, { steps: 'num_inference_steps', scale: 'guidance_scale' }) };
            submitPath = modelPath(c.model.includes('/') ? c.model : `fal-ai/${c.model}`);
        }
        const result = await runJob({ c, api, baseUrl: cap.baseUrl, body, input, onJob: options.onJob,
            async submit() {
                const data = await send(submitPath, { body, signal, headers });
                const remoteId = data.prompt_id ?? data.id ?? data.request_id;
                const paths = {};
                // Never send provider credentials to an arbitrary URL returned by a server.
                for (const [key, val] of Object.entries({ poll: data.polling_url ?? data.status_url, result: data.response_url, cancel: data.cancel_url })) if (val) paths[key] = relativeJobUrl(val, cap.baseUrl, api === 'bfl-image');
                return { remoteId, paths, submitPath };
            },
            async poll(job) {
                const id = encodeURIComponent(job.remoteId);
                if (api === 'comfy-image') {
                    const data = await send(`history/${id}`, { method: 'GET', signal });
                    const item = data[job.remoteId]; if (!item) return null;
                    if (item.status?.status_str === 'error') throw fail('provider-job-failed', 'Comfy execution failed');
                    if (!item.status?.completed) return null;
                    const descriptions = Object.values(item.outputs ?? {}).flatMap(o => o.images ?? []);
                    if (!descriptions.length || descriptions.length > 4) throw fail('provider-response-invalid', 'Comfy returned invalid image count');
                    const images = [];
                    for (const d of descriptions) {
                        if (typeof d.filename !== 'string' || !['output', 'temp'].includes(d.type)) throw fail('provider-response-invalid', 'Invalid Comfy output descriptor');
                        const query = new URLSearchParams({ filename: d.filename, subfolder: d.subfolder ?? '', type: d.type });
                        images.push(await binaryImage(await send(`view?${query}`, { method: 'GET', signal, raw: true }), signal));
                    }
                    return { images };
                }
                if (api === 'bfl-image') {
                    const data = await send(job.paths.poll ?? `get_result?id=${id}`, { method: 'GET', signal, headers });
                    if (['Pending', 'Processing'].includes(data.status)) return null;
                    if (data.status !== 'Ready') throw fail('provider-job-failed', 'BFL job failed or was rejected');
                    return { images: imageList([{ url: data.result?.sample }]) };
                }
                const path = job.paths.poll ?? `${job.submitPath}/requests/${id}/status`;
                const data = await send(path, { method: 'GET', signal, headers });
                if (['IN_QUEUE', 'IN_PROGRESS'].includes(data.status)) return null;
                if (data.status !== 'COMPLETED' || data.error) throw fail('provider-job-failed', 'FAL job failed');
                const resultPath = data.response_url ? relativeJobUrl(data.response_url, cap.baseUrl) : job.paths.result ?? `${job.submitPath}/requests/${id}`;
                const result = await send(resultPath, { method: 'GET', signal, headers });
                return { images: imageList(result.images?.map(i => ({ url: i.url }))) };
            },
        });
        images = result.images; jobId = result.jobId;
    } else if (api === 'together-image') {
        response = await send('images/generations', { signal, body: { model: c.model, ...native, ...defaultSize, n: input.count ?? 1, ...values(input, { steps: 'steps' }) } }); images = openaiImages(response.data);
    } else if (api === 'xai-image') {
        response = await send('images/generations', { signal, body: { model: c.model, prompt, n: input.count ?? 1, response_format: 'b64_json', ...values(input, { aspectRatio: 'aspect_ratio', resolution: 'resolution', quality: 'quality' }) } }); images = openaiImages(response.data);
    } else if (api === 'zai-image') {
        response = await send('images/generations', { signal, body: { model: c.model, prompt, size: `${defaultSize.width}x${defaultSize.height}`, ...values(input, { quality: 'quality' }) } }); images = openaiImages(response.data);
    } else if (api === 'extras-image') {
        response = await send('api/image', { signal, body: { ...native, ...defaultSize, ...values(input, { steps: 'steps', scale: 'scale', sampler: 'sampler' }) } }); images = [{ data: response.image, mimeType: 'image/jpeg' }];
    } else if (api === 'sdcpp-image') {
        response = await send('sdapi/v1/txt2img', { signal, body: { model: c.model, ...native, ...defaultSize, batch_size: input.count ?? 1, ...values(input, { steps: 'steps', scale: 'cfg_scale', sampler: 'sampler_name', scheduler: 'scheduler' }) } }); images = response.images?.map(data => ({ data, mimeType: 'image/png' }));
    } else if (api === 'pollinations-image') {
        const params = new URLSearchParams(Object.entries({ model: c.model, ...defaultSize, ...values(input, { seed: 'seed', enhance: 'enhance', negativePrompt: 'negative_prompt' }) }).map(([k,v]) => [k,String(v)]));
        images = [await binaryImage(await send(`image/${encodeURIComponent(prompt)}?${params}`, { signal, method: 'GET', raw: true }), signal)];
    } else if (api === 'huggingface-image') {
        const parameters = { ...values(input, { negativePrompt: 'negative_prompt', width: 'width', height: 'height', steps: 'num_inference_steps', scale: 'guidance_scale', seed: 'seed' }) };
        images = [await binaryImage(await send(modelPath(c.model), { signal, body: { inputs: prompt, parameters }, raw: true }), signal)];
    } else if (api === 'chutes-image') {
        images = [await binaryImage(await send('generate', { signal, body: { model: c.model, ...native, ...defaultSize, ...values(input, { steps: 'num_inference_steps', scale: 'guidance_scale' }) }, raw: true }), signal)];
    } else if (api === 'nanogpt-image') {
        response = await send('generate-image', { signal, headers: { authorization: null, 'x-api-key': c.apiKey ?? '' }, body: { model: c.model, ...native, ...defaultSize, resolution: `${defaultSize.width}x${defaultSize.height}`, nImages: 1, ...values(input, { steps: 'num_steps', scale: 'scale' }) } }); images = openaiImages(response.data);
    } else if (api === 'google-image' || api === 'vertex-image') {
        const headers = api === 'google-image' ? { authorization: null, 'x-goog-api-key': c.apiKey ?? '' } : {};
        const model = modelPath(c.model.replace(/^models\//, ''));
        if (api === 'vertex-image' || /^(imagen-|imagegeneration)/.test(c.model)) {
            if (input.imageSize !== undefined) throw fail('unsupported-parameters', 'Imagen does not implement imageSize in this codec');
            response = await send(`models/${model}:predict`, { signal, headers, body: { instances: [{ prompt }], parameters: { sampleCount: input.count ?? 1, ...values(input, { aspectRatio: 'aspectRatio', negativePrompt: 'negativePrompt', seed: 'seed' }) } } });
            images = response.predictions?.map(i => ({ data: i.bytesBase64Encoded, mimeType: i.mimeType ?? 'image/png' }));
        } else {
            if (input.count !== undefined && input.count !== 1) throw fail('unsupported-parameters', 'Gemini image codec supports one candidate per request');
            response = await send(`models/${model}:generateContent`, { signal, headers, body: { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: values(input, { aspectRatio: 'aspectRatio', imageSize: 'imageSize' }) } } });
            images = response.candidates?.flatMap(c => c.content?.parts ?? []).filter(p => p.inlineData).map(p => ({ data: p.inlineData.data, mimeType: p.inlineData.mimeType }));
        }
    } else if (api === 'openrouter-image') {
        response = await send('chat/completions', { signal, body: { model: c.model, messages: [{ role: 'user', content: prompt }], modalities: ['image', 'text'], image_config: values(input, { aspectRatio: 'aspect_ratio', imageSize: 'image_size' }) } });
        images = response.choices?.flatMap(choice => choice.message?.images ?? []).map(i => inlineImage(i.image_url?.url));
    } else if (api === 'workers-image') {
        const body = { ...native, ...values(input, { width: 'width', height: 'height', steps: 'num_steps', scale: 'guidance' }) };
        let encoded = body;
        if (/flux-2/.test(c.model)) { encoded = new FormData(); for (const [k,v] of Object.entries(body)) encoded.set(k, String(v)); }
        const raw = await send(`accounts/${encodeURIComponent(c.accountId)}/ai/run/${modelPath(c.model)}`, { signal, body: encoded, raw: true });
        if ((raw.headers.get('content-type') ?? '').includes('application/json')) { response = await raw.json(); if (response.success === false) throw fail('provider-job-failed', 'Workers image generation failed'); images = [{ data: response.result?.image ?? response.image, mimeType: 'image/png' }]; }
        else images = [await binaryImage(raw, signal)];
    } else throw fail('unsupported-operation', 'Missing image codec');
    imageList(images); signal?.throwIfAborted();
    await input.onEvent?.({ type: 'image.completed', count: images.length });
    return { images, usage: usage(response?.usage?.input_tokens, response?.usage?.output_tokens), ...(jobId ? { jobId } : {}) };
}

export async function cancelNativeJob(c, cap, send, jobId, { signal, onJob } = {}) {
    const job = decodeJob(jobId, c, cap.imageApi, cap.baseUrl);
    let state = 'unknown';
    if (cap.imageApi === 'fal-image') {
        const path = job.paths.cancel ?? `${job.submitPath}/requests/${encodeURIComponent(job.remoteId)}/cancel`;
        const response = await send(path, { method: 'PUT', signal, raw: true, headers: { authorization: `Key ${c.apiKey ?? ''}` } }); await response.body?.cancel(); state = 'cancel-requested';
    } else if (cap.imageApi === 'comfy-image') {
        const queue = await send('queue', { method: 'GET', signal });
        if (queue.queue_pending?.some(entry => entry[1] === job.remoteId)) { await send('queue', { signal, body: { delete: [job.remoteId] } }); state = 'cancel-requested'; }
        // Never use global /interrupt: it can cancel another user's running job.
    }
    const result = { jobId, remoteId: job.remoteId, state, resubmit: false };
    await onJob?.(result); return result;
}
