import { describe, expect, test } from '@jest/globals';

import {
    buildImageRequestParams,
    DEFAULT_PROMPT_TEMPLATE,
    getImageConfigReadiness,
    getImageGenerationConfig,
    getImageOptionTables,
    isImageKeySaved,
    parseImageSize,
} from '../public/modern/core/image-generation-config.js';
import {
    appendImageVersions,
    buildImageMessage,
    describeImageFailure,
    findMessageIndexByIdentity,
    getImageVersion,
    isImageMessage,
    isLastMessageImage,
    isPromptSourceMessage,
    messageIdentity,
    pickRecentPromptSources,
    setImageVersionIndex,
} from '../public/modern/core/image-message.js';

const meta = { prompt: 'moonlit rooftop', negativePrompt: '', provider: 'openai', model: 'gpt-image-1', params: { width: 1024, height: 1024 }, requestId: 'r1', origin: 'manual' };
const image = path => ({ path, width: 1024, height: 1024, mimeType: 'image/png' });

describe('image generation config', () => {
    test('fills defaults and keeps stored values', () => {
        const config = getImageGenerationConfig({ extension_settings: { imageGeneration: { provider: 'novelai', model: 'nai-diffusion-4-5-full', defaults: { count: 9, size: '832x1216' } } } });
        expect(config.provider).toBe('novelai');
        expect(config.defaults.size).toBe('832x1216');
        expect(config.defaults.count).toBe(1);
        expect(config.promptGen.defaultSelectCount).toBe(3);
        expect(config.promptGen.template).toBe(DEFAULT_PROMPT_TEMPLATE);
    });

    test('unknown provider falls back to the default provider and model', () => {
        const config = getImageGenerationConfig({ extension_settings: { imageGeneration: { provider: 'horde' } } });
        expect(config.provider).toBe('openai');
        expect(config.model).toBe('gpt-image-1');
        expect(getImageGenerationConfig(undefined).provider).toBe('openai');
    });

    test('readiness explains what is missing', () => {
        const base = getImageGenerationConfig({});
        expect(getImageConfigReadiness(base, {}).ok).toBe(false);
        expect(getImageConfigReadiness(base, { api_key_image_generation: [{ id: 'a' }] })).toEqual({ ok: true, reason: '' });
        const local = getImageGenerationConfig({ extension_settings: { imageGeneration: { provider: 'automatic1111', model: '' } } });
        expect(getImageConfigReadiness(local, {}).reason).toContain('模型');
        expect(getImageConfigReadiness({ ...local, model: 'sdxl' }, {}).reason).toContain('地址');
        expect(getImageConfigReadiness({ ...local, baseUrl: 'http://127.0.0.1:7860', model: 'sdxl' }, {}).ok).toBe(true);
        expect(isImageKeySaved({ api_key_image_generation: null })).toBe(false);
    });

    test('request params keep only supported fields and split the size', () => {
        expect(parseImageSize('1024x1536')).toEqual({ width: 1024, height: 1536 });
        expect(parseImageSize('big')).toBeNull();
        const params = buildImageRequestParams({ size: '1024x1536', quality: 'high', style: '', count: '2', negativePrompt: 'bad', seed: null, aspectRatio: '3:4' },
            ['width', 'height', 'count', 'quality', 'style']);
        expect(params).toEqual({ width: 1024, height: 1536, quality: 'high', count: 2 });
        expect(buildImageRequestParams({ aspectRatio: '3:4', count: 1 }, ['aspectRatio', 'count'])).toEqual({ aspectRatio: '3:4', count: 1 });
    });

    test('option tables follow provider and model', () => {
        expect(getImageOptionTables('openai', 'dall-e-3').sizes.map(([value]) => value)).toContain('1792x1024');
        expect(getImageOptionTables('openai', 'gpt-image-1').qualities.map(([value]) => value)).toContain('high');
        expect(getImageOptionTables('novelai').sizes[0][0]).toBe('832x1216');
    });
});

describe('image messages', () => {
    test('a built message is a hidden image message with versions', () => {
        const message = buildImageMessage({ name: '莉亚', sendDate: '2026-10-12T00:00:00.000Z', images: [image('/user/images/a/1.png'), image('/user/images/a/2.png')], meta });
        expect(message.is_system).toBe(true);
        expect(message.mes).toBe('');
        expect(message.extra.inline_image).toBe(false);
        expect(message.extra.media).toHaveLength(2);
        expect(message.extra.media[0]).toMatchObject({ url: '/user/images/a/1.png', type: 'image', title: 'moonlit rooftop', source: 'generated' });
        expect(isImageMessage(message)).toBe(true);
        expect(getImageVersion(message)).toMatchObject({ index: 0, count: 2 });
    });

    test('appending versions switches to the first new image without mutating', () => {
        const message = buildImageMessage({ name: 'x', sendDate: 'd', images: [image('/a.png')], meta });
        const next = appendImageVersions(message, [image('/b.png')], { ...meta, requestId: 'r2' });
        expect(message.extra.media).toHaveLength(1);
        expect(next.extra.media).toHaveLength(2);
        expect(getImageVersion(next).item.url).toBe('/b.png');
        expect(getImageVersion(setImageVersionIndex(next, 9)).index).toBe(1);
        expect(getImageVersion(setImageVersionIndex(next, -3)).index).toBe(0);
    });

    test('ordinary and visible media messages are not image messages', () => {
        expect(isImageMessage({ is_system: false, extra: { media: [{ url: '/a.png', source: 'generated' }] } })).toBe(false);
        expect(isImageMessage({ is_system: true, extra: { media: [{ url: '/a.png', source: 'upload' }] } })).toBe(false);
        expect(isImageMessage({ is_system: true, mes: 'note' })).toBe(false);
        expect(isPromptSourceMessage({ mes: 'hello', is_system: false })).toBe(true);
        expect(isPromptSourceMessage({ mes: '', is_system: false })).toBe(false);
    });

    test('identity finds the message after earlier messages are loaded', () => {
        const messages = [{ send_date: '1', name: 'a', mes: 'x' }, { send_date: '2', name: 'b', is_user: true, mes: 'y' }];
        const identity = messageIdentity(messages[1]);
        expect(findMessageIndexByIdentity([{ send_date: '0', name: 'z' }, ...messages], identity)).toBe(2);
        expect(findMessageIndexByIdentity(messages, 'missing')).toBe(-1);
        expect(isLastMessageImage(messages)).toBe(false);
        expect(isLastMessageImage([...messages, buildImageMessage({ name: 'a', sendDate: '3', images: [image('/c.png')], meta })])).toBe(true);
    });

    test('default selection takes the most recent text messages only', () => {
        const messages = [{ send_date: '1', name: 'a', mes: 'one' }, { send_date: '2', name: 'b', is_user: true, mes: 'two' },
            buildImageMessage({ name: 'a', sendDate: '3', images: [image('/c.png')], meta }), { send_date: '4', name: 'a', mes: 'four' }];
        expect([...pickRecentPromptSources(messages, 2)]).toEqual([messageIdentity(messages[1]), messageIdentity(messages[3])]);
        expect(pickRecentPromptSources(messages, 0).size).toBe(0);
    });

    test('failures keep the backend outcome or mark the result uncertain', () => {
        const error = Object.assign(new Error('x'), { status: 502, body: JSON.stringify({ error: 'provider-http-error', message: 'HTTP 400', detail: 'blocked', outcome: 'unknown' }) });
        expect(describeImageFailure(error)).toMatchObject({ code: 'provider-http-error', detail: 'blocked', outcome: 'unknown', uncertain: false, status: 502 });
        expect(describeImageFailure(Object.assign(new Error('x'), { status: 409, body: '{"error":"image-generation-busy","message":"busy","outcome":"not-charged"}' })).outcome).toBe('not-charged');
        expect(describeImageFailure(Object.assign(new Error('t'), { name: 'AbortError' }))).toMatchObject({ code: 'client-timeout', uncertain: true });
        expect(describeImageFailure(new TypeError('fetch failed'))).toMatchObject({ code: 'network-error', uncertain: true, outcome: 'unknown' });
    });
});
