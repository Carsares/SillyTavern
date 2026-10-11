import { isAbsolute } from 'node:path';
import { localEmbeddings } from './local-embedding.js';
import { fail } from '../core/index.js';
import { usage } from '../chat/http.js';
import { fields, integer, vectors, modelPath } from './common.js';

const tasks = { search_document: 'RETRIEVAL_DOCUMENT', search_query: 'RETRIEVAL_QUERY', classification: 'CLASSIFICATION', clustering: 'CLUSTERING' };
export async function embedTexts(c, capability, send, texts, input = {}, dependencies = {}) {
    fields(input, ['signal', ...capability.operationParameters.embed], 'Embedding');
    const { signal, dimensions, inputType = 'search_document' } = input;
    signal?.throwIfAborted();
    if (!Array.isArray(texts) || !texts.length || texts.length > 2048 || texts.some(text => typeof text !== 'string')) throw fail('invalid-input', 'embed requires 1..2048 strings');
    if (dimensions !== undefined) integer(dimensions, 'dimensions', 1, 65536);
    if (!tasks[inputType]) throw fail('invalid-input', 'Invalid embedding inputType');
    let response, embeddings, tokens = usage();
    const api = capability.embedApi;
    if (api === 'openai-auxiliary') {
        response = await send('embeddings', { signal, body: { model: c.provider === 'chutes' ? null : c.model, input: texts, encoding_format: 'float', ...(dimensions ? { dimensions } : {}) } });
        const data = response.data;
        if (!Array.isArray(data) || data.length !== texts.length || new Set(data.map(i => i.index)).size !== texts.length || data.some(i => !Number.isInteger(i.index) || i.index < 0 || i.index >= texts.length)) throw fail('provider-response-invalid', 'Invalid embedding indices');
        embeddings = [...data].sort((a,b) => a.index-b.index).map(i => i.embedding); tokens = usage(response.usage?.prompt_tokens, 0);
    } else if (api === 'cohere-embed') {
        response = await send('embed', { signal, body: { model: c.model, texts, input_type: inputType, embedding_types: ['float'], ...(dimensions ? { output_dimension: dimensions } : {}) } });
        embeddings = response.embeddings?.float; tokens = usage(response.meta?.billed_units?.input_tokens, 0);
    } else if (api === 'google-embed') {
        const model = `models/${modelPath(c.model.replace(/^models\//, ''))}`;
        response = await send(`${model}:batchEmbedContents`, { signal, headers: { authorization: null, 'x-goog-api-key': c.apiKey ?? '' }, body: { requests: texts.map(text => ({ model, taskType: tasks[inputType], content: { parts: [{ text }] }, ...(dimensions ? { outputDimensionality: dimensions } : {}) })) } });
        embeddings = response.embeddings?.map(i => i.values);
    } else if (api === 'vertex-embed') {
        // baseUrl is the explicit .../projects/P/locations/L/publishers/google endpoint.
        // Gemini embedding prediction accepts only one instance per request.
        embeddings = []; const counts = [];
        for (const content of texts) {
            response = await send(`models/${modelPath(c.model)}:predict`, { signal, body: { instances: [{ content, task_type: tasks[inputType] }], parameters: { autoTruncate: false, ...(dimensions ? { outputDimensionality: dimensions } : {}) } } });
            if (response.predictions?.length !== 1 || response.predictions[0].embeddings?.statistics?.truncated) throw fail('provider-response-invalid', 'Invalid or truncated Vertex embedding prediction');
            embeddings.push(response.predictions[0].embeddings?.values); counts.push(response.predictions[0].embeddings?.statistics?.token_count);
        }
        if (counts.every(Number.isFinite)) tokens = usage(counts.reduce((a,b) => a+b, 0), 0);
    } else if (api === 'ollama-embed') {
        response = await send('api/embed', { signal, body: { model: c.model, input: texts, truncate: false, ...(dimensions ? { dimensions } : {}) } });
        embeddings = response.embeddings; tokens = usage(response.prompt_eval_count, 0);
    } else if (api === 'nomic-embed') {
        response = await send('embedding/text', { signal, body: { model: c.model, texts, task_type: inputType, ...(dimensions ? { dimensionality: dimensions } : {}) } });
        embeddings = response.embeddings; tokens = usage(response.usage?.total_tokens, 0);
    } else if (api === 'extras-embed') {
        response = await send('api/embeddings/compute', { signal, body: { text: texts } }); embeddings = response.embedding;
    } else if (api === 'workers-embed') {
        response = await send(`accounts/${encodeURIComponent(c.accountId)}/ai/run/${modelPath(c.model)}`, { signal, body: { text: texts } }); embeddings = response.result?.data;
    } else if (api === 'transformers-embed') {
        if (!dependencies.pipelineFactory && (typeof c.localModelPath !== 'string' || !isAbsolute(c.localModelPath))) throw fail('invalid-connection', 'Explicit absolute localModelPath required; remote model downloads are disabled');
        if (!dependencies.pipelineFactory) {
            embeddings = await localEmbeddings(c, texts, signal, dependencies.localWorkerFactory);
        } else {
        const factory = dependencies.pipelineFactory;
        const pipeline = await factory('feature-extraction', c.localModelPath ?? c.model, { local_files_only: true });
        try {
            signal?.throwIfAborted();
            const tensor = await pipeline(texts, { pooling: 'mean', normalize: true });
            signal?.throwIfAborted(); embeddings = tensor.tolist();
        } finally { await pipeline.dispose?.(); }
        }
    } else throw fail('unsupported-operation', 'Embedding codec unavailable');
    vectors(embeddings, texts.length);
    if (dimensions && embeddings[0].length !== dimensions) throw fail('provider-response-invalid', 'Provider returned a different embedding dimension');
    signal?.throwIfAborted();
    return { embeddings, model: c.model, usage: tokens };
}
