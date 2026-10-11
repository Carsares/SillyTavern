// All TEXT_PROVIDERS use native text endpoints. No tools/model loop; live platforms unverified.
import { getTextCapabilities } from '../../capabilities/text/index.js';
import { fail } from '../core/index.js';
import { createTransport, requireCapability, parameters, outputLimit, emitResult, textResult, pollHorde } from '../chat/http.js';
import { novelParameters } from './novel-tokenizer.js';
import { textUsage } from './usage.js';
import { textMedia } from './media.js';
import { decodeTextStream } from './stream.js';

export function createTextAdapter(connection, options = {}) {
    const c = structuredClone(connection);
    const capability = getTextCapabilities(c, options);
    requireCapability(capability);
    const send = createTransport(c, capability, options);
    const sampling = parameters(c, capability);
    return { capabilities: capability,
        async generate({ prompt, messages = [], tools = [], signal, maxOutputTokens, onEvent, jobId = options.jobId, onJob = options.onJob, stream = c.stream !== false && capability.streaming } = {}) {
            if (tools.length || messages.some(message => message.role === 'tool' || message.toolCalls?.length)) throw fail('unsupported-tools', 'Text completion does not support tools');
            if (typeof prompt !== 'string') throw fail('invalid-prompt', 'Text generation requires an explicitly compiled prompt');
            const media = textMedia(messages, capability);
            const max = outputLimit(c, maxOutputTokens);
            if (stream && !capability.streaming) throw fail('unsupported-stream', 'This text protocol is not streaming');
            let body, result;
            const api = capability.api;
            const streamed = async (path, body, format = api) => decodeTextStream(format, await send(path, { body, signal, raw: true }), { signal, onEvent });
            if (api === 'openai-text') {
                if (stream) return streamed(capability.path, { model: c.model, prompt, ...sampling, max_tokens: max, stream: true });
                body = { model: c.model, prompt, ...sampling, max_tokens: max, stream: false };
                const response = await send(capability.path, { body, signal });
                result = textResult(response.choices?.[0]?.text, textUsage(api, response), response.choices?.[0]?.finish_reason ?? 'stop');
            } else if (api === 'kobold' || api === 'horde-text') {
                const params = { ...media, max_length: max, max_context_length: c.contextWindow };
                for (const [key, value] of Object.entries(sampling)) params[{ repetition_penalty: 'rep_pen', stop: 'stop_sequence' }[key] ?? key] = key === 'stop' && typeof value === 'string' ? [value] : value;
                if (stream) return streamed('api/extra/generate/stream', { prompt, ...params }, 'koboldcpp-stream');
                if (api === 'horde-text') {
                    const response = await pollHorde(send, c, { prompt, models: [c.model], params: { ...params, n: 1 } }, { signal, jobId, onJob });
                    result = { ...textResult(response.generations?.[0]?.text), jobId: response.jobId };
                } else {
                    const response = await send(capability.path, { body: { prompt, ...params }, signal });
                    result = textResult(response.results?.[0]?.text);
                }
            } else if (api === 'novelai') {
                const novel = await novelParameters(sampling, c.model, options.tokenize, signal);
                if (stream) return streamed('ai/generate-stream', { input: prompt, model: c.model, parameters: { ...novel, max_length: max, use_string: true, return_full_text: false } });
                const response = await send(capability.path, { signal, body: { input: prompt, model: c.model,
                    parameters: { ...novel, max_length: max, use_string: true, return_full_text: false } } });
                result = textResult(response.output);
            } else if (api === 'ollama-generate') {
                const settings = { num_predict: max, num_ctx: c.contextWindow };
                for (const [key, value] of Object.entries(sampling)) settings[key === 'repetition_penalty' ? 'repeat_penalty' : key] = value;
                if (stream) return streamed(capability.path, { model: c.model, prompt, ...media, raw: true, stream: true, options: settings });
                const response = await send(capability.path, { signal, body: { model: c.model, prompt, ...media, raw: true, stream: false, options: settings } });
                result = textResult(response.response, textUsage(api, response), response.done_reason ?? 'stop');
            } else if (api === 'llamacpp') {
                const settings = { ...sampling };
                if (settings.repetition_penalty !== undefined) { settings.repeat_penalty = settings.repetition_penalty; delete settings.repetition_penalty; }
                if (stream) return streamed(capability.path, { prompt, ...settings, n_predict: max, stream: true });
                const response = await send(capability.path, { signal, body: { prompt, ...settings, n_predict: max, stream: false } });
                result = textResult(response.content, textUsage(api, response), response.stopped_limit ? 'length' : 'stop');
            } else if (api === 'huggingface-tgi') {
                if (stream) return streamed('generate_stream', { inputs: prompt, parameters: { ...sampling, max_new_tokens: max, return_full_text: false, details: true } });
                const response = await send(capability.path, { signal, body: { inputs: prompt, parameters: { ...sampling, max_new_tokens: max, return_full_text: false, details: true } } });
                result = textResult(response.generated_text, textUsage(api, response), response.details?.finish_reason ?? 'stop');
            } else throw fail('unsupported-provider', 'No text codec for API');
            return emitResult(result, onEvent, signal);
        },
    };
}
