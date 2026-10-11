// Native text SSE/NDJSON codecs. Horde/classic Kobold remain bounded JSON operations.
import { textUsage } from './usage.js';
import { readSSE } from '../chat/stream.js';
import { fail } from '../core/index.js';
import { textResult, usage } from '../chat/http.js';

async function* readLines(response, signal) {
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
        while (true) {
            signal?.throwIfAborted(); const chunk = await reader.read(); signal?.throwIfAborted();
            buffer += decoder.decode(chunk.value, { stream: !chunk.done });
            if (buffer.length > 8 * 1024 * 1024) throw fail('provider-response-invalid', 'Oversized text stream frame');
            if (chunk.done && buffer) buffer += '\n';
            let index;
            while ((index = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1); if (line) yield { data: line }; }
            if (chunk.done) break;
        }
    } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function decodeTextStream(api, response, { signal, onEvent } = {}) {
    let content = '', tokens = usage(), complete = false, finishReason = 'stop', received = false;
    const frames = api === 'ollama-generate' ? readLines(response, signal) : readSSE(response, signal);
    for await (const frame of frames) {
        if (frame.data === '[DONE]') { if (!received || api !== 'openai-text') throw fail('provider-response-invalid', 'Unexpected text stream terminator'); complete = true; break; }
        let item; try { item = JSON.parse(frame.data); } catch { throw fail('provider-response-invalid', 'Invalid text stream JSON'); }
        if (item.error) throw fail('provider-stream-error', 'Text provider returned an error');
        let text = '';
        if (api === 'openai-text') {
            text = item.choices?.[0]?.text ?? '';
            if (item.choices?.[0]?.finish_reason) { finishReason = item.choices[0].finish_reason; complete = true; }
            if (item.usage) tokens = textUsage(api, item);
        } else if (api === 'ollama-generate') {
            text = item.response ?? ''; if (item.done) { complete = true; finishReason = item.done_reason ?? 'stop'; tokens = textUsage(api, item); }
        } else if (api === 'llamacpp') {
            text = item.content ?? ''; if (item.stop) { complete = true; finishReason = item.stopped_limit ? 'length' : 'stop'; tokens = textUsage(api, item); }
        } else if (api === 'huggingface-tgi') {
            text = item.token?.special ? '' : item.token?.text ?? '';
            if (item.generated_text !== undefined) { complete = true; tokens = textUsage(api, item); finishReason = item.details?.finish_reason ?? 'stop'; }
        } else {
            text = item.token ?? '';
            if (item.final || item.done || frame.event === 'done') complete = true;
        }
        if (typeof text !== 'string') throw fail('provider-response-invalid', 'Text stream token must be a string');
        received = true;
        content += text;
        if (text) await onEvent?.({ type: 'text.delta', text });
    }
    // KoboldCpp/NovelAI token SSE protocols terminate by clean HTTP EOF, not a mandatory sentinel.
    if (!complete && !(['koboldcpp-stream', 'novelai'].includes(api) && received)) throw fail('provider-stream-truncated', 'Text stream ended before terminal event');
    await onEvent?.({ type: 'usage', usage: tokens });
    return textResult(content, tokens, finishReason);
}
