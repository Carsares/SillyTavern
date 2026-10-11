// Native text-generation media side channels; prompts remain explicitly compiled.
import { fail } from '../core/index.js';
import { encodeMediaPart } from '../chat/media.js';

export function textMedia(messages, capability) {
    const output = {};
    for (const message of messages) for (const part of Array.isArray(message.content) ? message.content : []) {
        if (part.type === 'text') continue;
        if (message.role !== 'user' || !capability.media.includes(part.type)) throw fail('unsupported-media', 'Unsupported text-provider media');
        if (!Number.isSafeInteger(capability.mediaTokenCost?.[part.type]) || capability.mediaTokenCost[part.type] <= 0) throw fail('media-budget-unknown', 'Explicit media cost required');
        // Reuse validation only. These endpoints require inline base64, never a URL.
        const encoded = encodeMediaPart(part, 'google-generate-content', capability);
        if (!encoded.inlineData) throw fail('unsupported-media', 'Text media requires inline base64');
        const key = part.type === 'image' ? 'images' : 'audio';
        (output[key] ??= []).push(encoded.inlineData.data);
    }
    return output;
}
