import { randomBytes, createHash } from 'node:crypto';
import { fail, serializeTranscript, HISTORY_MODE, HISTORY_INSTRUCTIONS } from './contracts.js';

export function createTranscript(snapshot, plan, mode = HISTORY_MODE) {
    if (![HISTORY_MODE, 'structured-transcript'].includes(mode)) throw fail('unsupported-history-mode', 'Unknown SDK history mode', 422);
    const serialized = JSON.stringify({ ...JSON.parse(serializeTranscript(snapshot, plan)), historyMode: mode });
    const marker = `CONVERSATION_TRANSCRIPT_${randomBytes(24).toString('hex')}`;
    // The gateway owns the frozen full history. A bounded reference prevents
    // SDK-local prompt limits/compaction from rejecting it before our budget check.
    const payload = mode === HISTORY_MODE ? JSON.stringify({ schemaVersion: 1, historyMode: mode,
        transcriptSha256: createHash('sha256').update(serialized).digest('hex') }) : serialized;
    const prompt = `${marker}\n${payload}\nEND_${marker}`;
    return { marker, prompt, messages: structuredClone(plan.messages), sourceRefs: structuredClone(plan.sourceRefs ?? []), mode };
}

function parts(message) {
    if (message.media?.length) throw fail('unsupported-media', 'SDK gateway media conversion is not verified', 422);
    if (typeof message.content === 'string') return [{ type: 'text', text: message.content }];
    if (!Array.isArray(message.content)) throw fail('invalid-context', 'Message content must be text or typed blocks');
    return message.content;
}

function text(part) {
    if (part.type !== 'text' || typeof part.text !== 'string') throw fail('unsupported-content', 'Unsupported message content', 422);
    return part.text;
}

function wireName(name) {
    if (typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,127}$/.test(name)) throw fail('invalid-tool-history', 'Invalid historical tool name');
    return name.startsWith('mcp__domain__') ? name : `mcp__domain__${name}`;
}

/** Explicit provider encoders: no stringification of roles in native mode. */
export function encodeHistory(messages, protocol) {
    const encoded = [], system = [], pending = new Set(), used = new Set();
    let nonSystemSeen = false;
    for (const message of messages) {
        const blocks = parts(message);
        if (message.role === 'system') {
            if (protocol === 'anthropic') {
                if (nonSystemSeen) throw fail('unsupported-deep-system', 'Claude Messages cannot preserve a system message inside history', 422);
                system.push(...blocks.map(p => ({ type: 'text', text: text(p) })));
            } else encoded.push({ type: 'message', role: 'system', content: blocks.map(p => ({ type: 'input_text', text: text(p) })) });
            continue;
        }
        nonSystemSeen = true;
        if (['tool', 'toolResult'].includes(message.role)) {
            const id = message.toolCallId ?? message.tool_call_id;
            if (!pending.delete(id)) throw fail('invalid-tool-history', 'Tool result has no matching historical call');
            const output = blocks.map(text).join('\n');
            encoded.push(protocol === 'anthropic'
                ? { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output, ...(message.isError ? { is_error: true } : {}) }] }
                : { type: 'function_call_output', call_id: id, output });
            continue;
        }
        if (!['user', 'assistant'].includes(message.role)) throw fail('unsupported-role', 'Unknown historical role');
        const anthropic = [];
        for (const block of blocks) {
            if (block.type === 'text') {
                const value = text(block);
                if (protocol === 'anthropic') anthropic.push({ type: 'text', text: value });
                else encoded.push({ type: 'message', role: message.role, content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: value, ...(message.role === 'assistant' ? { annotations: [] } : {}) }] });
            } else if (block.type === 'toolCall' && message.role === 'assistant') {
                if (!block.id || used.has(block.id) || !block.arguments || typeof block.arguments !== 'object' || Array.isArray(block.arguments)) throw fail('invalid-tool-history', 'Malformed historical tool call');
                used.add(block.id); pending.add(block.id);
                if (protocol === 'anthropic') anthropic.push({ type: 'tool_use', id: block.id, name: wireName(block.name), input: structuredClone(block.arguments) });
                else encoded.push({ type: 'function_call', call_id: block.id, name: wireName(block.name), arguments: JSON.stringify(block.arguments) });
            } else if (block.type === 'thinking' && message.role === 'assistant' && protocol === 'anthropic' && typeof block.signature === 'string' && typeof block.thinking === 'string') {
                anthropic.push({ type: 'thinking', thinking: block.thinking, signature: block.signature });
            } else throw fail('unsupported-history-block', 'This provider cannot losslessly encode this history block', 422);
        }
        if (protocol === 'anthropic') encoded.push({ role: message.role, content: anthropic });
    }
    if (pending.size) throw fail('invalid-tool-history', 'Unresolved tool calls in frozen history');
    return { messages: encoded, system };
}

/** The marker must survive every SDK iteration. Hidden compaction is rejected. */
export function expandTranscript(body, protocol, transcript) {
    if (!transcript) throw fail('missing-transcript', 'A frozen transcript is required');
    const field = protocol === 'anthropic' ? 'messages' : 'input';
    const input = body[field];
    if (!Array.isArray(input)) throw fail('missing-transcript-marker', 'SDK request lacks full marked history', 422);
    const positions = [];
    input.forEach((message, index) => {
        const values = typeof message.content === 'string' ? [message.content] : (message.content ?? []).map(p => p.text).filter(v => typeof v === 'string');
        if (values.some(v => v.includes(transcript.marker))) positions.push({ index, message, values });
    });
    if (positions.length !== 1) throw fail('missing-transcript-marker', 'SDK compacted, duplicated or rewrote the marked history', 422);
    const { index, message, values } = positions[0];
    // Claude prepends separate environment/date reminder blocks to the user
    // message even with verbatimPrompts. The original fragment must remain exact.
    const original = values.filter(value => value.includes(transcript.marker));
    const content = Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }];
    const markerIndex = content.findIndex(part => part.text === transcript.prompt);
    if (message.role !== 'user' || original.length !== 1 || original[0] !== transcript.prompt || markerIndex !== content.length - 1 ||
        content.slice(0, markerIndex).some(part => protocol !== 'anthropic' || part.type !== 'text' || !/^<system-reminder>[\s\S]*<\/system-reminder>\s*$/.test(part.text))) {
        throw fail('rewritten-transcript-marker', 'SDK modified the original transcript segment', 422);
    }
    const suffix = input.slice(index + 1);
    // Non-Claude model IDs cause SDK 0.3.289 to append its environment as a
    // system message. Accept only the exact trusted runtime-generated block,
    // once, immediately after the marker; never forward it to the provider.
    const first = suffix[0];
    if (protocol === 'anthropic' && transcript.sdkEnvironmentText &&
        first?.role === 'system' && Object.keys(first).every(key => ['role', 'content'].includes(key)) &&
        Array.isArray(first.content) && first.content.length === 1 &&
        first.content[0].type === 'text' && first.content[0].text === transcript.sdkEnvironmentText &&
        Object.keys(first.content[0]).every(key => ['type', 'text', 'cache_control'].includes(key)) &&
        (first.content[0].cache_control === undefined ||
            JSON.stringify(first.content[0].cache_control) === '{"type":"ephemeral"}')) suffix.shift();
    const after = suffix;
    // Only genuine current-turn assistant/tool continuations may follow the marker.
    // Refuse hidden injected user reminders instead of silently treating them as history.
    for (const item of after) {
        const valid = protocol === 'anthropic'
            ? item.role === 'assistant' || (item.role === 'user' && Array.isArray(item.content) && item.content.every(p => p.type === 'tool_result'))
            : item.type === 'function_call' || item.type === 'function_call_output' || item.type === 'reasoning' || item.role === 'assistant';
        if (!valid) throw fail('unexpected-sdk-context', 'SDK appended non-domain context after the transcript', 422);
    }
    const request = structuredClone(body);
    if (transcript.mode === 'structured-transcript') {
        request[field] = [{ role: 'user', content: [{ type: protocol === 'anthropic' ? 'text' : 'input_text', text: transcript.prompt }] }, ...structuredClone(after)];
        if (protocol === 'anthropic') request.system = HISTORY_INSTRUCTIONS;
        else request.instructions = HISTORY_INSTRUCTIONS;
    } else {
        if (transcript.mode !== HISTORY_MODE) throw fail('unsupported-history-mode', 'Unknown SDK history mode', 422);
        const encoded = encodeHistory(transcript.messages, protocol);
        request[field] = [...encoded.messages, ...structuredClone(after)];
        if (protocol === 'anthropic') request.system = encoded.system;
        else request.instructions = '';
    }
    return request;
}
