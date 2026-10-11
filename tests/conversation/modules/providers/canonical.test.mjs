import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_PROVIDERS, getChatCapabilities } from '../../../../src/conversation/capabilities/chat/index.js';
import { TEXT_PROVIDERS, getTextCapabilities } from '../../../../src/conversation/capabilities/text/index.js';
import { AUXILIARY_PROVIDERS, getAuxiliaryCapabilities } from '../../../../src/conversation/capabilities/auxiliary/index.js';
import { getCapabilities } from '../../../../src/conversation/capabilities/core/index.js';
import { createProviderAdapter } from '../../../../src/conversation/providers/chat/index.js';
import { validateConnectionProxy } from '../../../../src/conversation/providers/core/proxy.js';
const connection = { provider: 'openai-compatible', executor: 'native', type: 'chat', model: 'test', baseUrl: 'https://offline.invalid', contextWindow: 32000, maxOutputTokens: 1000, workingBudget: 20000 };

test('removed provider identifiers never resolve in any registry or adapter', () => {
    for (const provider of ['palm', 'makersuite', 'auto', 'novel', 'workersai', 'comfyui', 'fal', 'mistralai', 'openai_compatible', 'custom', 'generic', 'claude']) {
        for (const registry of [CHAT_PROVIDERS, TEXT_PROVIDERS, AUXILIARY_PROVIDERS]) assert.equal(Object.hasOwn(registry, provider), false, provider);
        for (const type of ['chat', 'text', 'image', 'embedding']) assert.throws(() => createProviderAdapter({ ...connection, provider, type }), { code: 'unsupported-provider' });
    }
    for (const [registry, names] of [[CHAT_PROVIDERS, ['anthropic', 'google', 'mistral', 'openai-compatible']], [TEXT_PROVIDERS, ['openai-compatible', 'koboldcpp', 'ollama']], [AUXILIARY_PROVIDERS, ['google', 'mistral', 'automatic1111', 'novelai', 'workers_ai', 'comfy', 'falai']]]) {
        for (const name of names) assert.ok(Object.hasOwn(registry, name), name);
    }
});

test('provider boundaries reject wrapped connections and obsolete control fields', () => {
    assert.throws(() => createProviderAdapter({ ...connection, type: 'auxiliary' }), { code: 'unsupported-provider' });
    for (const value of [{ data: connection }, { ...connection, mediaTokenCost: { image: 100 } }, { ...connection, effort: 'high' }, { ...connection, reasoning: { effort: 'high' } }]) {
        for (const capabilities of [getCapabilities, getChatCapabilities, getTextCapabilities, getAuxiliaryCapabilities]) assert.equal(capabilities(value).supported, false);
        assert.throws(() => createProviderAdapter(value), { code: 'unsupported-provider' });
    }
    assert.throws(() => validateConnectionProxy({ data: { proxy: { url: 'https://proxy.invalid' } } }), { code: 'invalid-proxy' });
    assert.equal(getChatCapabilities({ ...connection, reasoning: 'high', capabilities: { verified: true, mediaTokenCost: { image: 100 } } }).supported, true);
});

test('media input has explicit inline data/MIME/name; native URLs and wire names remain protocol-specific', async () => {
    const { encodeMediaPart } = await import('../../../../src/conversation/providers/chat/media.js');
    const caps = { media: ['image', 'document'] };
    assert.throws(() => encodeMediaPart({ type: 'image', url: 'data:image/png;base64,AAAA' }, 'openai-chat', caps), { code: 'invalid-content' });
    assert.throws(() => encodeMediaPart({ type: 'document', data: 'AAAA', mimeType: 'application/pdf', filename: 'old.pdf' }, 'openai-chat', caps), { code: 'invalid-content' });
    assert.equal(encodeMediaPart({ type: 'document', data: 'AAAA', mimeType: 'application/pdf', name: 'new.pdf' }, 'openai-chat', caps).file.filename, 'new.pdf');
    assert.deepEqual(encodeMediaPart({ type: 'image', url: 'https://images.invalid/a.png' }, 'openai-chat', caps), { type: 'image_url', image_url: { url: 'https://images.invalid/a.png' } });
});
