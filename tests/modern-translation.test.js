/* global globalThis, localStorage */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { createCharacterTranslationActions } from '../public/modern/actions/character-translation.js';
import { createChatMessageActions } from '../public/modern/actions/chat-messages.js';
import { createChatTranslationActions } from '../public/modern/actions/chat-translation.js';
import { createTranslationClient, TranslateError } from '../public/modern/actions/translation-client.js';
import {
    TRANSLATE_PROVIDERS,
    applyMessageTranslation,
    buildCharacterTranslationJobs,
    canTranslateMessage,
    clearMessageTranslation,
    createSourceSignature,
    describePlaceholderIssues,
    describeTranslateFailure,
    getLanguageLabel,
    getMessageTranslationView,
    getOneRingLanguages,
    getTranslateProvider,
    isChineseLanguage,
    isTranslationStale,
    normalizeLanguageCode,
    protectPlaceholders,
    replaceCharacterFieldValue,
    resolveTranslateSettings,
    restorePlaceholders,
    splitAroundImageLinks,
    splitIntoChunks,
    translateText,
} from '../public/modern/core/translation.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------------------------------------------------
// 翻译服务清单
// ---------------------------------------------------------------------------------------------------------------------

describe('translate providers', () => {
    test('lists the eight providers of the legacy extension with its chunk limits', () => {
        expect(TRANSLATE_PROVIDERS.map(provider => provider.id).sort()).toEqual(['bing', 'deepl', 'deeplx', 'google', 'libre', 'lingva', 'oneringtranslator', 'yandex']);
        expect(Object.fromEntries(TRANSLATE_PROVIDERS.map(provider => [provider.id, provider.chunkLimit]))).toMatchObject({
            google: 5000,
            lingva: 5000,
            deeplx: 1500,
            bing: 1000,
        });
        // OneRing: the setting value is oneringtranslator (legacy), the route is /api/translate/onering
        expect(getTranslateProvider('oneringtranslator')).toMatchObject({ route: 'onering', urlSecret: 'oneringtranslator_url' });
        expect(getTranslateProvider('nope')).toBeUndefined();
    });

    test('every key and URL secret name exists in the backend secret list, and every route in translate.js', () => {
        const secretsSource = fs.readFileSync(path.join(repoRoot, 'src/endpoints/secrets.js'), 'utf8');
        const translateSource = fs.readFileSync(path.join(repoRoot, 'src/endpoints/translate.js'), 'utf8');
        for (const provider of TRANSLATE_PROVIDERS) {
            for (const secret of [provider.keySecret, provider.urlSecret].filter(Boolean)) {
                expect(secretsSource).toContain(`: '${secret}',`);
            }
            expect(translateSource).toContain(`router.post('/${provider.route}'`);
        }
    });

    test('says which providers need a key or a URL and where the text goes', () => {
        expect(getTranslateProvider('google')).toMatchObject({ keyRequired: false, urlRequired: false, scope: 'public' });
        expect(getTranslateProvider('deepl')).toMatchObject({ keyRequired: true, keySecret: 'deepl' });
        expect(getTranslateProvider('libre')).toMatchObject({ urlRequired: true, urlSecret: 'libre_url', keyRequired: false });
        expect(getTranslateProvider('lingva')).toMatchObject({ urlRequired: false, defaultUrl: 'https://lingva.ml/api/v1' });
        expect(getTranslateProvider('deeplx')).toMatchObject({ scope: 'self-hosted', defaultUrl: 'http://127.0.0.1:1188/translate' });
    });
});

describe('translate settings', () => {
    test('uses google and Simplified Chinese when nothing was configured', () => {
        expect(resolveTranslateSettings({})).toMatchObject({ provider: 'google', target_language: 'zh-CN', internal_language: 'en', auto_mode: 'none', deepl_endpoint: 'free', configured: false });
        expect(resolveTranslateSettings(undefined).provider).toBe('google');
    });

    test('keeps what the legacy extension stored, including its English default target', () => {
        const settings = { extension_settings: { translate: { target_language: 'en', internal_language: 'en', provider: 'deepl', auto_mode: 'both', deepl_endpoint: 'pro' } } };
        expect(resolveTranslateSettings(settings)).toMatchObject({ provider: 'deepl', target_language: 'en', auto_mode: 'both', deepl_endpoint: 'pro', configured: true });
    });

    test('replaces unknown values by defaults', () => {
        const settings = { extension_settings: { translate: { provider: 'nope', target_language: 'xx', auto_mode: 'weird', deepl_endpoint: 'x' } } };
        expect(resolveTranslateSettings(settings)).toMatchObject({ provider: 'google', target_language: 'en', auto_mode: 'none', deepl_endpoint: 'free' });
    });
});

describe('language codes', () => {
    test('normalizes the code case and rejects unknown ones', () => {
        expect(normalizeLanguageCode('zh-cn')).toBe('zh-CN');
        expect(normalizeLanguageCode(' PT-br ')).toBe('pt-BR');
        expect(normalizeLanguageCode('JA')).toBe('ja');
        expect(normalizeLanguageCode('klingon', 'en')).toBe('en');
        expect(normalizeLanguageCode('')).toBe('');
    });

    test('labels the language in Chinese and keeps the English name', () => {
        expect(getLanguageLabel('zh-CN')).toBe('简体中文（Chinese (Simplified)）');
        expect(getLanguageLabel('zh-TW')).toBe('繁体中文（Chinese (Traditional)）');
        expect(getLanguageLabel('en')).toContain('English');
        expect(getLanguageLabel('not-a-code')).toBe('not-a-code');
        expect(isChineseLanguage('zh-CN')).toBe(true);
        expect(isChineseLanguage('zh')).toBe(true);
        expect(isChineseLanguage('en')).toBe(false);
    });

    test('OneRing source language follows the legacy rule', () => {
        const settings = { internal_language: 'en', target_language: 'zh-CN' };
        expect(getOneRingLanguages('zh-CN', settings)).toEqual({ from_lang: 'en', to_lang: 'zh-CN' });
        expect(getOneRingLanguages('en', settings)).toEqual({ from_lang: 'zh-CN', to_lang: 'en' });
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 图片链接和分块
// ---------------------------------------------------------------------------------------------------------------------

describe('image links', () => {
    const text = 'Look ![a cat](https://x.test/cat.png) and ![](img/dog.jpg?x=1) done';

    test('splits around image links and the parts add up to the original', () => {
        const parts = splitAroundImageLinks(text);
        expect(parts.map(part => part.type)).toEqual(['text', 'image', 'text', 'image', 'text']);
        expect(parts.filter(part => part.type === 'image').map(part => part.value)).toEqual(['![a cat](https://x.test/cat.png)', '![](img/dog.jpg?x=1)']);
        expect(parts.map(part => part.value).join('')).toBe(text);
    });

    test('matches the legacy split exactly', () => {
        const legacyChunks = text.split(/!\[.*?]\([^)]*\)/);
        const legacyLinks = [...text.matchAll(/!\[.*?]\([^)]*\)/g)].map(match => match[0]);
        const parts = splitAroundImageLinks(text);
        expect(parts.filter(part => part.type === 'text').map(part => part.value)).toEqual(legacyChunks.filter(Boolean));
        expect(parts.filter(part => part.type === 'image').map(part => part.value)).toEqual(legacyLinks);
    });

    test('handles text without links, empty text and link-only text', () => {
        expect(splitAroundImageLinks('plain')).toEqual([{ type: 'text', value: 'plain' }]);
        expect(splitAroundImageLinks('')).toEqual([]);
        expect(splitAroundImageLinks('![a](b)')).toEqual([{ type: 'image', value: '![a](b)' }]);
    });
});

describe('chunking', () => {
    test('returns one chunk at or below the limit and cuts just above it', () => {
        expect(splitIntoChunks('a'.repeat(1000), 1000)).toEqual(['a'.repeat(1000)]);
        expect(splitIntoChunks('', 1000)).toEqual(['']);
        const chunks = splitIntoChunks(`${'a'.repeat(600)} ${'b'.repeat(401)}`, 1000);
        expect(chunks).toHaveLength(2);
        expect(chunks.every(chunk => chunk.length <= 1000)).toBe(true);
    });

    test('never exceeds the limit, loses nothing and prefers paragraph breaks', () => {
        const paragraph = 'Sentence one is here. Sentence two follows it. ';
        const text = Array.from({ length: 40 }, (_, index) => `${paragraph.repeat(3)}#${index}`).join('\n\n');
        for (const limit of [1000, 1500, 5000]) {
            const chunks = splitIntoChunks(text, limit);
            expect(chunks.join('')).toBe(text);
            expect(chunks.every(chunk => chunk.length <= limit)).toBe(true);
            // a cut falls on a paragraph break, so every chunk but the last ends with the blank line
            expect(chunks.slice(0, -1).every(chunk => chunk.endsWith('\n\n'))).toBe(true);
        }
        expect(splitIntoChunks(text, 5000).length).toBeGreaterThan(1);
    });

    test('falls back to lines, sentences, spaces and finally a hard cut', () => {
        const noSpaces = 'x'.repeat(2500);
        const hard = splitIntoChunks(noSpaces, 1000);
        expect(hard.map(chunk => chunk.length)).toEqual([1000, 1000, 500]);
        expect(hard.join('')).toBe(noSpaces);

        const cjk = '这是一句话。'.repeat(300);
        const sentences = splitIntoChunks(cjk, 100);
        expect(sentences.join('')).toBe(cjk);
        expect(sentences.every(chunk => chunk.length <= 100 && chunk.endsWith('。'))).toBe(true);
    });

    test('keeps surrogate pairs together on a hard cut', () => {
        const emoji = '😀'.repeat(20);
        const chunks = splitIntoChunks(emoji, 5);
        expect(chunks.join('')).toBe(emoji);
        expect(chunks.every(chunk => [...chunk].every(char => char === '😀'))).toBe(true);
    });

    test('does not cut through a placeholder on a hard cut', () => {
        const text = `${'x'.repeat(8)}[[12]]${'y'.repeat(8)}`;
        const chunks = splitIntoChunks(text, 10, { keepTogether: /\[\[\d+\]\]/g });
        expect(chunks.join('')).toBe(text);
        expect(chunks.some(chunk => chunk.includes('[[12]]'))).toBe(true);
    });

    test('does not chunk when the limit is not positive', () => {
        expect(splitIntoChunks('a'.repeat(50), 0)).toEqual(['a'.repeat(50)]);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 占位符
// ---------------------------------------------------------------------------------------------------------------------

describe('placeholder protection', () => {
    const card = '<START>\n{{user}}: Hi {{char}}!\n<b>bold</b> ![pic](https://x.test/a.png)\n```js\nconst a = 1;\n```';

    test('replaces macros, tags, image links and code blocks by numbered placeholders and restores them', () => {
        const protection = protectPlaceholders(card);
        expect(protection.tokens.map(token => token.kind)).toEqual(['tag', 'macro', 'macro', 'tag', 'tag', 'image', 'code']);
        expect(protection.text).not.toMatch(/\{\{|<START>|<b>|https:\/\/|const a/);
        expect(protection.text).toContain('[[1]]');
        const restored = restorePlaceholders(protection.text, protection);
        expect(restored).toMatchObject({ ok: true, text: card, missing: [], duplicated: [], unexpected: [] });
    });

    test('lets the translator reorder placeholders and add spaces or full-width brackets', () => {
        const protection = protectPlaceholders('{{char}} meets {{user}}');
        const restored = restorePlaceholders('【【2】】 遇见 [[ 1 ]]', protection);
        expect(restored.ok).toBe(true);
        expect(restored.text).toBe('{{user}} 遇见 {{char}}');
    });

    test('reports missing, duplicated and unexpected placeholders', () => {
        const protection = protectPlaceholders('{{char}} and {{user}} and <START>');
        const missing = restorePlaceholders('[[1]] 和 [[3]]', protection);
        expect(missing.ok).toBe(false);
        expect(missing.missing.map(token => token.original)).toEqual(['{{user}}']);

        const duplicated = restorePlaceholders('[[1]] [[1]] [[2]] [[3]]', protection);
        expect(duplicated.ok).toBe(false);
        expect(duplicated.duplicated.map(token => token.original)).toEqual(['{{char}}']);

        const unexpected = restorePlaceholders('[[1]] [[2]] [[3]] [[9]]', protection);
        expect(unexpected.ok).toBe(false);
        expect(unexpected.unexpected).toEqual(['[[9]]']);

        expect(describePlaceholderIssues(missing)).toContain('缺少 1 处');
        expect(describePlaceholderIssues(missing)).toContain('{{user}}');
        expect(describePlaceholderIssues(duplicated)).toContain('重复');
        expect(describePlaceholderIssues(restorePlaceholders('[[1]] [[2]] [[3]]', protection))).toBe('');
    });

    test('switches the placeholder style when the text already contains the first one', () => {
        const text = 'see [[1]] and {{char}}';
        const protection = protectPlaceholders(text);
        expect(protection.text).toBe('see [[1]] and ((1))');
        expect(restorePlaceholders('see [[1]] and ((1))', protection).text).toBe(text);
        expect(() => protectPlaceholders('[[1]] ((1)) ⟦1⟧ {{char}}')).toThrow('占位符');
    });

    test('returns the text untouched when there is nothing to protect or protection is off', () => {
        expect(protectPlaceholders('plain text')).toMatchObject({ text: 'plain text', tokens: [] });
        expect(protectPlaceholders('{{char}}', { macros: false, tags: false, images: false, code: false })).toMatchObject({ text: '{{char}}', tokens: [] });
        expect(protectPlaceholders('{{char}} <b>x</b>', { tags: false }).tokens.map(token => token.original)).toEqual(['{{char}}']);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 翻译流程
// ---------------------------------------------------------------------------------------------------------------------

describe('translateText', () => {
    /** Pretends to translate: marks every chunk and records what it received. */
    function createFakeTranslator(transform = chunk => `译(${chunk})`) {
        const received = [];
        return {
            received,
            translateChunk: async chunk => {
                received.push(chunk);
                return transform(chunk);
            },
        };
    }

    test('does not send image links to the provider and puts them back (split mode)', async () => {
        const fake = createFakeTranslator();
        const text = 'Hello ![cat](https://x.test/cat.png) world';
        const result = await translateText(text, { translateChunk: fake.translateChunk, imageMode: 'split' });
        expect(result.ok).toBe(true);
        expect(result.text).toBe('译(Hello) ![cat](https://x.test/cat.png) 译(world)');
        expect(fake.received.join('')).not.toContain('x.test');
    });

    test('protects macros and tags and restores them', async () => {
        const fake = createFakeTranslator(chunk => chunk.replace('hello', '你好'));
        const result = await translateText('{{char}} says hello to {{user}} <START>', { translateChunk: fake.translateChunk });
        expect(result.ok).toBe(true);
        expect(result.text).toBe('{{char}} says 你好 to {{user}} <START>');
        expect(fake.received.join('')).not.toMatch(/\{\{|<START>/);
    });

    test('uses placeholders for image links in placeholder mode and sends one request', async () => {
        const fake = createFakeTranslator();
        const result = await translateText('A ![x](u.png) B', { translateChunk: fake.translateChunk, imageMode: 'placeholder' });
        expect(result.ok).toBe(true);
        expect(fake.received).toEqual(['A [[1]] B']);
        expect(result.text).toBe('译(A ![x](u.png) B)');
    });

    test('flags a translation that lost a placeholder', async () => {
        const fake = createFakeTranslator(chunk => chunk.replace(/\[\[\d+\]\]/g, ''));
        const result = await translateText('Hi {{char}}, welcome to <b>town</b>.', { translateChunk: fake.translateChunk });
        expect(result.ok).toBe(false);
        expect(result.issues.missing.map(token => token.original)).toEqual(['{{char}}', '<b>', '</b>']);
    });

    test('splits long text by the provider limit and keeps paragraph breaks between chunks', async () => {
        const paragraph = 'word '.repeat(60).trim();
        const text = Array.from({ length: 10 }, () => paragraph).join('\n\n');
        const fake = createFakeTranslator(chunk => chunk.toUpperCase());
        const result = await translateText(text, { translateChunk: fake.translateChunk, chunkLimit: 1000 });
        expect(fake.received.length).toBeGreaterThan(1);
        expect(fake.received.every(chunk => chunk.length <= 1000)).toBe(true);
        // the translator never sees the whitespace at the edge of a chunk, yet the blank lines are back in the result
        expect(fake.received.every(chunk => chunk === chunk.trim())).toBe(true);
        expect(result.text).toBe(text.toUpperCase());
        expect(result.requests).toBe(fake.received.length);
    });

    test('does not send text without any letters or digits, but sends numbers', async () => {
        const fake = createFakeTranslator();
        expect(await translateText('{{char}} ...', { translateChunk: fake.translateChunk })).toMatchObject({ text: '{{char}} ...', ok: true, requests: 0 });
        expect(fake.received).toEqual([]);
        expect((await translateText('42', { translateChunk: fake.translateChunk })).text).toBe('译(42)');
        expect(fake.received).toEqual(['42']);
        expect(await translateText('   ', { translateChunk: fake.translateChunk })).toMatchObject({ text: '   ', ok: true, requests: 0 });
    });

    test('stops when the signal is aborted', async () => {
        const controller = new AbortController();
        const fake = createFakeTranslator();
        controller.abort();
        await expect(translateText('hello', { translateChunk: fake.translateChunk, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(fake.received).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 请求客户端：纯文本响应、请求体、缺密钥
// ---------------------------------------------------------------------------------------------------------------------

function createClientHarness({ settings = {}, secretState = {}, reply = body => `译:${body.text ?? body.chunks?.join('')}` } = {}) {
    const calls = [];
    const state = { settings: { extension_settings: { translate: { provider: 'google', target_language: 'zh-CN', ...settings } } }, secretState };
    // A Response that only offers text(): reading it as JSON would throw, like a bare "42" body would corrupt a number
    const apiFetchResponse = jest.fn(async (url, options) => {
        calls.push({ url, body: options.body });
        const text = await reply(options.body);
        if (text instanceof Error) {
            throw text;
        }
        return { text: async () => text };
    });
    return { client: createTranslationClient({ state, apiFetchResponse }), calls, state, apiFetchResponse };
}

describe('translation client', () => {
    test('reads the answer as text, so a numeric translation stays "42"', async () => {
        const { client } = createClientHarness({ reply: () => '42' });
        const result = await client.translate('forty-two');
        expect(result.text).toBe('42');
        expect(typeof result.text).toBe('string');
        // the same body through the JSON-parsing apiFetch would have become a number
        expect(typeof JSON.parse('42')).toBe('number');
    });

    test('rejects an empty answer', async () => {
        const { client } = createClientHarness({ reply: () => '  ' });
        await expect(client.translate('hello')).rejects.toThrow('返回了空内容');
    });

    test('sends the body each provider route expects', async () => {
        const cases = [
            ['google', {}, { text: 'hi', lang: 'zh-CN' }],
            ['bing', {}, { text: 'hi', lang: 'zh-CN' }],
            ['deeplx', {}, { text: 'hi', lang: 'zh-CN' }],
            ['yandex', {}, { chunks: ['hi'], lang: 'zh-CN' }],
            ['deepl', { deepl_endpoint: 'pro' }, { text: 'hi', lang: 'zh-CN', endpoint: 'pro' }],
            ['oneringtranslator', { internal_language: 'en' }, { text: 'hi', from_lang: 'en', to_lang: 'zh-CN' }],
        ];
        for (const [provider, extra, expected] of cases) {
            const { client, calls } = createClientHarness({ settings: { provider, ...extra }, secretState: { deepl: [{ id: '1', active: true }] } });
            await client.translate('hi');
            expect(calls[0].url).toBe(`/api/translate/${getTranslateProvider(provider).route}`);
            expect(calls[0].body).toEqual(expected);
        }
    });

    test('says what is missing before sending anything', async () => {
        const deepl = createClientHarness({ settings: { provider: 'deepl' } });
        expect(deepl.client.checkProviderReady()).toMatchObject({ ready: false });
        await expect(deepl.client.translate('hi')).rejects.toThrow('API Key');
        expect(deepl.apiFetchResponse).not.toHaveBeenCalled();

        const libre = createClientHarness({ settings: { provider: 'libre' } });
        await expect(libre.client.translate('hi')).rejects.toThrow('服务地址');
        const libreReady = createClientHarness({ settings: { provider: 'libre' }, secretState: { libre_url: [{ id: '1', active: true, value: 'http://x' }] } });
        expect(libreReady.client.checkProviderReady().ready).toBe(true);
        // google, lingva (public default instance) and the local OneRing / DeepLX defaults need nothing
        for (const provider of ['google', 'bing', 'yandex', 'lingva', 'oneringtranslator', 'deeplx']) {
            expect(createClientHarness({ settings: { provider } }).client.checkProviderReady().ready).toBe(true);
        }
    });

    test('turns backend failures into a diagnosable message', async () => {
        const failure = (status, body) => Object.assign(new Error(`/api/translate/google failed: ${status}`), { status, body: JSON.stringify(body) });
        const { client } = createClientHarness({ reply: () => failure(500, { error: 'provider_error', message: 'Google responded 429 Too Many Requests.', detail: '429' }) });
        const error = await client.translate('hi').catch(thrown => thrown);
        expect(error).toBeInstanceOf(TranslateError);
        expect(error.message).toContain('Google 翻译');
        expect(error.message).toContain('HTTP 429');
        expect(error.message).toContain('设置 → 聊天工具 → 翻译');
    });

    test('reports the privacy notice and remembers the acknowledgement only through the stored list', () => {
        const { client } = createClientHarness({});
        const notice = client.getPrivacyNotice();
        expect(notice).toMatchObject({ providerId: 'google', acknowledged: false });
        expect(notice.text).toContain('第三方翻译服务');
    });
});

describe('describeTranslateFailure', () => {
    const body = payload => ({ status: 500, body: JSON.stringify(payload) });

    test('maps the backend error codes', () => {
        expect(describeTranslateFailure({ status: 400, body: JSON.stringify({ error: 'url_not_configured' }) }, 'libre')).toContain('LibreTranslate 还没有配置服务地址');
        expect(describeTranslateFailure({ status: 400, body: JSON.stringify({ error: 'key_not_configured' }) }, 'deepl')).toContain('DeepL 还没有填写 API Key');
        expect(describeTranslateFailure(body({ error: 'provider_failed', message: 'x', detail: 'ECONNREFUSED' }), 'deeplx')).toContain('ECONNREFUSED');
        expect(describeTranslateFailure(body({ error: 'invalid_response', message: 'x' }), 'bing')).toContain('无法识别');
        expect(describeTranslateFailure(body({ error: 'provider_error', message: 'DeepL responded 456 Quota Exceeded.', detail: '456' }), 'deepl')).toContain('HTTP 456');
    });

    test('falls back to the status and to network errors', () => {
        expect(describeTranslateFailure({ status: 404 }, 'google')).toContain('后端没有翻译接口');
        expect(describeTranslateFailure({ status: 502, body: '<html>Bad Gateway</html>' }, 'google')).toContain('HTTP 502');
        expect(describeTranslateFailure(new TypeError('Failed to fetch'), 'google')).toContain('Failed to fetch');
        expect(describeTranslateFailure({ code: 'empty_response' }, 'google')).toContain('空内容');
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 聊天消息里的译文
// ---------------------------------------------------------------------------------------------------------------------

describe('message translation fields', () => {
    const reply = () => ({
        name: 'Alice',
        is_user: false,
        mes: 'Hello there.',
        send_date: 1,
        swipe_id: 1,
        swipes: ['Other.', 'Hello there.'],
        swipe_info: [{ extra: { api: 'x' } }, { extra: { api: 'x', reasoning: 'thinking' } }],
        extra: { reasoning: 'thinking' },
    });

    test('signature changes with the text and detects a stale translation', () => {
        expect(createSourceSignature('abc')).toBe(createSourceSignature('abc'));
        expect(createSourceSignature('abc')).not.toBe(createSourceSignature('abd'));
        expect(createSourceSignature('abc')).toMatch(/^3:[0-9a-f]{8}$/);
        expect(isTranslationStale(createSourceSignature('abc'), 'abc')).toBe(false);
        expect(isTranslationStale(createSourceSignature('abc'), 'abcd')).toBe(true);
        // a translation from the legacy extension has no signature: it cannot be judged
        expect(isTranslationStale(undefined, 'anything')).toBe(false);
    });

    test('stores the translation next to the original, never in mes, and mirrors it into the current swipe', () => {
        const message = reply();
        applyMessageTranslation(message, { text: '你好。', reasoningText: '思考', lang: 'zh-CN' });
        expect(message.mes).toBe('Hello there.');
        expect(message.extra).toMatchObject({
            display_text: '你好。',
            display_text_src: createSourceSignature('Hello there.'),
            display_text_lang: 'zh-CN',
            reasoning_display_text: '思考',
            reasoning_display_text_src: createSourceSignature('thinking'),
        });
        expect(message.swipe_info[1].extra).toMatchObject({ display_text: '你好。', reasoning_display_text: '思考', api: 'x' });
        expect(message.swipe_info[0].extra).not.toHaveProperty('display_text');
    });

    test('clears the translation from the message and the swipe', () => {
        const message = reply();
        applyMessageTranslation(message, { text: '你好。', reasoningText: '思考', lang: 'zh-CN' });
        expect(clearMessageTranslation(message)).toBe(true);
        expect(message.extra).toEqual({ reasoning: 'thinking' });
        expect(message.swipe_info[1].extra).toEqual({ api: 'x', reasoning: 'thinking' });
        expect(clearMessageTranslation(message)).toBe(false);

        applyMessageTranslation(message, { text: '你好。', reasoningText: '思考', lang: 'zh-CN' });
        clearMessageTranslation(message, { reasoning: false });
        expect(message.extra).toMatchObject({ reasoning_display_text: '思考' });
        expect(message.extra).not.toHaveProperty('display_text');
    });

    test('shows the translation, flips with the toggle, and falls back to the original once the text changed', () => {
        const message = reply();
        applyMessageTranslation(message, { text: '你好。', reasoningText: '思考', lang: 'zh-CN' });

        expect(getMessageTranslationView(message)).toMatchObject({ controls: true, hasTranslation: true, stale: false, showing: 'translation', text: '你好。', reasoning: '思考', lang: 'zh-CN' });
        expect(getMessageTranslationView(message, true)).toMatchObject({ showing: 'original', text: 'Hello there.', reasoning: 'thinking' });
        expect(getMessageTranslationView(message, false).showing).toBe('translation');

        // the engine continued the reply: the translation no longer matches
        message.mes = 'Hello there. More.';
        expect(getMessageTranslationView(message)).toMatchObject({ stale: true, showing: 'original', text: 'Hello there. More.' });
        expect(getMessageTranslationView(message, false)).toMatchObject({ stale: true, showing: 'translation', text: '你好。' });
    });

    test('leaves user and system messages and untranslated replies as they were', () => {
        // legacy "translate inputs": the user's own words sit in display_text, mes holds the internal-language text
        const user = { name: 'Me', is_user: true, mes: 'hello', extra: { display_text: '你好' } };
        expect(getMessageTranslationView(user)).toMatchObject({ controls: false, text: '你好' });
        expect(canTranslateMessage(user)).toBe(false);
        expect(canTranslateMessage({ is_system: true })).toBe(false);
        expect(canTranslateMessage(reply())).toBe(true);
        expect(getMessageTranslationView(reply())).toMatchObject({ controls: false, hasTranslation: false, text: 'Hello there.', reasoning: 'thinking' });
        // a translation made by the legacy extension has no signature and is never marked stale
        const legacy = { ...reply(), extra: { display_text: '旧译文' } };
        expect(getMessageTranslationView(legacy)).toMatchObject({ controls: true, stale: false, text: '旧译文' });
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 编辑：编辑框是原文，保存不覆盖译文对应的原文
// ---------------------------------------------------------------------------------------------------------------------

describe('editing a translated message', () => {
    function createEditHarness(message) {
        const state = {
            engine: { generating: false },
            selected: { chat: 'chat-1' },
            chatEditing: { key: '', index: -1, text: '' },
            chatMessageDeleteConfirm: { key: '', index: -1 },
            chatTranslation: {},
        };
        const messages = [message];
        const saved = [];
        const toasts = [];
        const actions = createChatMessageActions({
            state,
            render: () => {},
            showToast: (title, detail) => toasts.push({ title, detail }),
            getSelectedChatEntity: () => ({ avatar: 'alice.png', name: 'Alice' }),
            getChatContextKey: () => 'ctx',
            getSelectedChatMessages: () => messages,
            getCurrentDraftKey: () => 'draft',
            getChatCacheKey: (context, chat) => `${context}:${chat}`,
            isGroupChatMode: () => false,
            updateModernChat: async (entity, chatId, mutate) => {
                const copy = structuredClone(messages);
                const result = await mutate(copy);
                saved.push(copy);
                return result;
            },
            refreshSelectedChatList: async () => {},
            reloadChat: async () => ({ ok: true }),
        });
        return { actions, state, saved, toasts };
    }

    const translated = () => {
        const message = { name: 'Alice', is_user: false, mes: 'Original reply.', send_date: 5, swipe_id: 0, swipes: ['Original reply.'], swipe_info: [{ extra: {} }], extra: {} };
        applyMessageTranslation(message, { text: '原来的回复。', reasoningText: '', lang: 'zh-CN' });
        return message;
    };

    test('the edit box starts from the original, not from the translation', () => {
        const { actions, state } = createEditHarness(translated());
        actions.beginModernMessageEdit(0);
        expect(state.chatEditing).toMatchObject({ index: 0, text: 'Original reply.' });
    });

    test('saving an edited original removes the stale translation and never writes the translation into mes', async () => {
        const { actions, state, saved, toasts } = createEditHarness(translated());
        actions.beginModernMessageEdit(0);
        state.chatEditing.text = 'Edited reply.';
        await actions.saveModernMessageEdit();

        const [message] = saved[0];
        expect(message.mes).toBe('Edited reply.');
        expect(message.swipes).toEqual(['Edited reply.']);
        expect(message.extra).not.toHaveProperty('display_text');
        expect(message.extra).not.toHaveProperty('display_text_src');
        expect(message.swipe_info[0].extra).not.toHaveProperty('display_text');
        expect(toasts.at(-1).detail).toContain('译文');
    });

    test('saving without changing the text keeps the translation and the original as they are', async () => {
        const original = translated();
        const { actions, state, saved } = createEditHarness(original);
        actions.beginModernMessageEdit(0);
        state.chatEditing.text = 'Original reply.  ';
        await actions.saveModernMessageEdit();

        expect(saved[0][0]).toEqual(original);
        expect(saved[0][0].extra.display_text).toBe('原来的回复。');
        expect(getMessageTranslationView(saved[0][0]).stale).toBe(false);
    });

    test('a message without any translation is saved exactly as before', async () => {
        const plain = { name: 'Me', is_user: true, mes: 'hello', send_date: 7 };
        const { actions, state, saved } = createEditHarness(plain);
        actions.beginModernMessageEdit(0);
        state.chatEditing.text = 'edited hello';
        await actions.saveModernMessageEdit();
        expect(saved[0]).toEqual([{ name: 'Me', is_user: true, mes: 'edited hello', send_date: 7 }]);
    });

    test('copies what is on screen', async () => {
        const message = translated();
        const { actions, state } = createEditHarness(message);
        const writeText = jest.fn(async () => {});
        Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText } } });
        await actions.copyModernMessage(0);
        expect(writeText).toHaveBeenLastCalledWith('原来的回复。');
        state.chatTranslation.viewOriginal = { 'draft:0': true };
        await actions.copyModernMessage(0);
        expect(writeText).toHaveBeenLastCalledWith('Original reply.');
        delete globalThis.navigator;
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 动作：消息翻译
// ---------------------------------------------------------------------------------------------------------------------

function installLocalStorage() {
    const store = new Map();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: key => store.get(key) ?? null,
            setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key),
        },
    });
    return store;
}

describe('chat translation actions', () => {
    beforeEach(() => {
        installLocalStorage();
    });

    afterEach(() => {
        delete globalThis.localStorage;
    });

    function createHarness({ translate = text => `译:${text}`, settings = {}, messages, groupMode = false } = {}) {
        const chat = messages || [
            { name: 'Alice', is_user: false, mes: 'Hello {{user}}.', send_date: 1, extra: { reasoning: 'Let me think.' } },
            { name: 'Me', is_user: true, mes: 'hi', send_date: 2 },
        ];
        const state = {
            settings: { extension_settings: { translate: { provider: 'google', target_language: 'zh-CN', ...settings } } },
            secretState: {},
            engine: { generating: false },
            selected: { chat: 'chat-1' },
            chatTranslation: {},
            errors: [],
        };
        const saves = [];
        const calls = [];
        const toasts = [];
        const apiFetchResponse = jest.fn(async (url, options) => {
            calls.push({ url, body: options.body });
            const answer = await translate(options.body.text);
            if (answer instanceof Error) {
                throw answer;
            }
            return { text: async () => answer };
        });
        const actionRegistry = {
            getSelectedChatEntity: () => ({ avatar: 'alice.png', name: 'Alice' }),
            isGroupChatMode: () => groupMode,
            getChatContextKey: () => 'ctx',
            chatContextActions: {
                getSelectedChatMessages: () => chat,
                getCurrentDraftKey: () => 'draft',
                updateModernChatAndSync: jest.fn(async (entity, chatId, mutate) => {
                    const copy = structuredClone(chat);
                    const result = await mutate(copy);
                    saves.push(copy);
                    chat.splice(0, chat.length, ...copy);
                    return { result, engineSync: Promise.resolve({ ok: true }) };
                }),
            },
        };
        const order = [];
        const apiFetch = jest.fn(async (url, options) => {
            order.push(url);
            return { ok: true, options };
        });
        const bridgeReload = { reloadSettings: jest.fn(async () => { order.push('reloadSettings'); return { ok: true }; }) };
        const loadData = jest.fn(async () => { order.push('loadData'); });
        const showToast = (title, detail) => toasts.push({ title, detail });
        const actions = createChatTranslationActions({ state, apiFetch, apiFetchResponse, loadData, render: () => {}, showToast, bridgeReload, actionRegistry });
        return { actions, state, chat, saves, calls, toasts, apiFetch, order, bridgeReload, loadData, updateModernChatAndSync: actionRegistry.chatContextActions.updateModernChatAndSync };
    }

    test('asks to confirm the privacy notice first, then translates and stores display_text without touching mes', async () => {
        const { actions, state, chat, saves, calls } = createHarness();
        await actions.translateModernMessage(0);
        expect(state.chatTranslation.confirm).toBe('draft:0');
        expect(calls).toHaveLength(0);
        expect(saves).toHaveLength(0);

        await actions.translateModernMessage(0, { confirmed: true });
        expect(state.chatTranslation.confirm).toBe('');
        expect(chat[0].mes).toBe('Hello {{user}}.');
        expect(chat[0].extra).toMatchObject({
            display_text: '译:Hello {{user}}.',
            display_text_src: createSourceSignature('Hello {{user}}.'),
            display_text_lang: 'zh-CN',
            reasoning_display_text: '译:Let me think.',
        });
        // the macro never reached the provider
        expect(calls.map(call => call.body.text)).toEqual(['Hello [[1]].', 'Let me think.']);
        expect(saves).toHaveLength(1);
        expect(JSON.parse(localStorage.getItem('st-modern-translate-privacy-ack'))).toEqual(['google']);

        // acknowledged once: the next translation goes straight through
        await actions.translateModernMessage(0);
        expect(state.chatTranslation.confirm).toBe('');
        expect(saves).toHaveLength(2);
    });

    test('writes through the group chat file when a group is selected', async () => {
        const single = createHarness();
        await single.actions.translateModernMessage(0, { confirmed: true });
        expect(single.updateModernChatAndSync).toHaveBeenCalledWith(expect.anything(), 'chat-1', expect.any(Function), { groupMode: false });

        const group = createHarness({ groupMode: true });
        await group.actions.translateModernMessage(0, { confirmed: true });
        expect(group.updateModernChatAndSync).toHaveBeenCalledWith(expect.anything(), 'chat-1', expect.any(Function), { groupMode: true });
        await group.actions.clearModernMessageTranslation(0);
        expect(group.updateModernChatAndSync).toHaveBeenLastCalledWith(expect.anything(), 'chat-1', expect.any(Function), { groupMode: true });
    });

    test('toggling the view does not save, clearing removes the fields', async () => {
        const { actions, state, chat, saves } = createHarness();
        await actions.translateModernMessage(0, { confirmed: true });
        saves.length = 0;

        actions.toggleModernMessageTranslationView(0);
        expect(state.chatTranslation.viewOriginal['draft:0']).toBe(true);
        actions.toggleModernMessageTranslationView(0);
        expect(state.chatTranslation.viewOriginal['draft:0']).toBe(false);
        expect(saves).toHaveLength(0);

        await actions.clearModernMessageTranslation(0);
        expect(saves).toHaveLength(1);
        expect(chat[0].extra).toEqual({ reasoning: 'Let me think.' });
        expect(chat[0].mes).toBe('Hello {{user}}.');
    });

    test('refuses while generating and for user messages, and leaves the file alone', async () => {
        const { actions, state, saves } = createHarness();
        await expect(actions.translateModernMessage(1)).rejects.toThrow('只能翻译角色的回复');
        state.engine.generating = true;
        await expect(actions.translateModernMessage(0)).rejects.toThrow('生成中');
        await expect(actions.clearModernMessageTranslation(0)).rejects.toThrow('生成中');
        expect(saves).toHaveLength(0);
    });

    test('keeps a failure on the message and saves nothing', async () => {
        const failure = Object.assign(new Error('/api/translate/google failed: 500'), { status: 500, body: JSON.stringify({ error: 'provider_error', message: 'Google responded 429.', detail: '429' }) });
        const { actions, state, saves, toasts } = createHarness({ translate: () => failure });
        await actions.translateModernMessage(0, { confirmed: true });
        expect(state.chatTranslation.errors['draft:0']).toContain('HTTP 429');
        // the explanation sits under the message; no toast covers it
        expect(toasts.some(toast => toast.title === '翻译失败')).toBe(false);
        expect(state.chatTranslation.busy['draft:0']).toBeUndefined();
        expect(saves).toHaveLength(0);
    });

    test('does not save a translation that lost a macro', async () => {
        const { actions, state, saves } = createHarness({ translate: text => text.replace(/\[\[\d+\]\]/g, '') });
        await actions.translateModernMessage(0, { confirmed: true });
        expect(state.chatTranslation.errors['draft:0']).toContain('译文不完整');
        expect(saves).toHaveLength(0);
    });

    test('does not save when the original changed during the translation', async () => {
        let chat;
        const harness = createHarness({
            translate: text => {
                chat[0].mes = 'Hello again.';
                return `译:${text}`;
            },
        });
        chat = harness.chat;
        await harness.actions.translateModernMessage(0, { confirmed: true });
        expect(harness.state.chatTranslation.errors['draft:0']).toContain('原文在翻译期间变了');
        expect(harness.saves).toHaveLength(0);
    });

    test('explains a missing key without sending a request', async () => {
        const { actions, state, calls } = createHarness({ settings: { provider: 'deepl' } });
        await actions.translateModernMessage(0, { confirmed: true });
        expect(state.chatTranslation.errors['draft:0']).toContain('API Key');
        expect(calls).toHaveLength(0);
    });

    test('saves the settings: secrets, the translate block, then reloadSettings before refreshing', async () => {
        const { actions, state, apiFetch, order, bridgeReload } = createHarness({ settings: { internal_language: 'ja', auto_mode: 'responses' } });
        state.settings.other = 'kept';
        await actions.saveTranslateSettings({
            provider: 'deepl',
            target_language: 'ja',
            deepl_endpoint: 'pro',
            secrets: { deepl: '  key-123  ', libre_url: 'http://libre.example/translate' },
            clear: ['lingva_url'],
        });

        const writes = apiFetch.mock.calls.filter(([url]) => url === '/api/secrets/write').map(([, options]) => options.body);
        expect(writes).toEqual([
            { key: 'deepl', value: 'key-123', label: 'translate modern' },
            { key: 'libre_url', value: 'http://libre.example/translate', label: 'translate modern' },
        ]);
        expect(apiFetch.mock.calls.filter(([url]) => url === '/api/secrets/delete').map(([, options]) => options.body)).toEqual([{ key: 'lingva_url' }]);
        const saved = apiFetch.mock.calls.find(([url]) => url === '/api/settings/save')[1].body;
        expect(saved.other).toBe('kept');
        expect(saved.extension_settings.translate).toEqual({ provider: 'deepl', target_language: 'ja', deepl_endpoint: 'pro', internal_language: 'ja', auto_mode: 'responses' });
        expect(bridgeReload.reloadSettings).toHaveBeenCalledTimes(1);
        expect(order.indexOf('/api/settings/save')).toBeLessThan(order.indexOf('reloadSettings'));
        expect(order.indexOf('reloadSettings')).toBeLessThan(order.indexOf('loadData'));
    });

    test('rejects an invalid provider, language or URL before writing anything', async () => {
        const { actions, apiFetch } = createHarness();
        await expect(actions.saveTranslateSettings({ provider: 'nope', target_language: 'ja', deepl_endpoint: 'free' })).rejects.toThrow('翻译服务');
        await expect(actions.saveTranslateSettings({ provider: 'google', target_language: 'klingon', deepl_endpoint: 'free' })).rejects.toThrow('目标语言');
        await expect(actions.saveTranslateSettings({ provider: 'libre', target_language: 'ja', deepl_endpoint: 'free', secrets: { libre_url: 'javascript:alert(1)' } })).rejects.toThrow('http://');
        expect(apiFetch).not.toHaveBeenCalled();
    });

    test('turns the legacy auto mode off and leaves everything else', async () => {
        const { actions, state, apiFetch, bridgeReload } = createHarness({ settings: { auto_mode: 'both', provider: 'bing' } });
        await actions.disableTranslateAutoMode();
        const saved = apiFetch.mock.calls.find(([url]) => url === '/api/settings/save')[1].body;
        expect(saved.extension_settings.translate).toMatchObject({ auto_mode: 'none', provider: 'bing', target_language: 'zh-CN' });
        expect(state.settings.extension_settings.translate.auto_mode).toBe('none');
        expect(bridgeReload.reloadSettings).toHaveBeenCalledTimes(1);
    });

    test('tests the provider with a short sentence', async () => {
        const { actions, state, calls } = createHarness();
        await actions.testTranslateProvider({ refresh: () => {} });
        expect(calls[0].body).toEqual({ text: 'Hello, world!', lang: 'zh-CN' });
        expect(state.chatTranslation.settingsTest).toMatchObject({ running: false, result: '译:Hello, world!', error: '' });
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// 角色卡翻译
// ---------------------------------------------------------------------------------------------------------------------

describe('character fields', () => {
    const form = {
        name: 'Alice',
        description: '{{char}} is a wizard.',
        personality: '',
        scenario: '  ',
        first_mes: 'Hello {{user}}!',
        mes_example: '<START>\n{{user}}: hi\n{{char}}: hello',
        creator_notes: 'Notes',
        system_prompt: '',
        post_history_instructions: 'Stay in character.',
        alternate_greetings: 'Greeting one.\n---\nGreeting two {{user}}.',
    };

    test('lists the fields to translate in order, skipping empty ones and splitting alternate greetings', () => {
        const jobs = buildCharacterTranslationJobs(form);
        expect(jobs.map(job => job.id)).toEqual(['description', 'first_mes', 'mes_example', 'creator_notes', 'post_history_instructions', 'alternate_greetings:0', 'alternate_greetings:1']);
        expect(jobs.at(-1)).toMatchObject({ field: 'alternate_greetings', index: 1, text: 'Greeting two {{user}}.' });
        // the name, tags, depth prompt and other settings are not translated
        expect(jobs.some(job => ['name', 'creator', 'tags'].includes(job.field))).toBe(false);
    });

    test('writes a translated greeting back into its slot', () => {
        const job = { field: 'alternate_greetings', index: 1 };
        expect(replaceCharacterFieldValue(form, job, '问候二')).toBe('Greeting one.\n---\n问候二');
        expect(replaceCharacterFieldValue(form, { field: 'description' }, '译文')).toBe('译文');
    });
});

describe('character translation actions', () => {
    beforeEach(() => {
        installLocalStorage();
        localStorage.setItem('st-modern-translate-privacy-ack', JSON.stringify(['google']));
    });

    afterEach(() => {
        delete globalThis.localStorage;
    });

    function createHarness({ translate = text => `译:${text}`, form: formOverride } = {}) {
        const baselineForm = {
            name: 'Alice',
            description: '{{char}} is a wizard.',
            personality: '',
            scenario: '',
            first_mes: 'Hello {{user}}!',
            mes_example: '<START>\n{{user}}: hi\n{{char}}: hello',
            creator_notes: 'Notes',
            system_prompt: '',
            post_history_instructions: 'Stay in character.',
            alternate_greetings: 'Greeting one.\n---\nGreeting two {{user}}.',
            ...formOverride,
        };
        const state = {
            settings: { extension_settings: { translate: { provider: 'google', target_language: 'zh-CN' } } },
            secretState: {},
            selected: { character: 'alice.png', chat: '' },
            characterEditing: { avatar: 'alice.png', form: { ...baselineForm }, errors: {}, baseline: { ...baselineForm } },
            characterEditDrafts: {},
            characterTranslation: {},
        };
        const calls = [];
        const apiFetchResponse = jest.fn(async (url, options) => {
            calls.push({ url, text: options.body.text });
            const answer = await translate(options.body.text, calls.length);
            if (answer instanceof Error) {
                throw answer;
            }
            return { text: async () => answer };
        });
        const apiFetch = jest.fn(async url => (url === '/api/characters/duplicate' ? { path: 'alice-copy.png' } : { ok: true }));
        const toasts = [];
        const beginCharacterEdit = jest.fn(async avatar => {
            state.characterEditing = { avatar, form: { ...baselineForm, name: 'Alice' }, errors: {}, baseline: { ...baselineForm } };
        });
        const actions = createCharacterTranslationActions({
            state,
            apiFetch,
            apiFetchResponse,
            loadData: jest.fn(async () => {}),
            render: () => {},
            showToast: (title, detail) => toasts.push({ title, detail }),
            actionRegistry: { characterActions: { beginCharacterEdit } },
        });
        return { actions, state, calls, apiFetch, toasts, beginCharacterEdit, baselineForm };
    }

    test('fills only the unsaved draft, field by field, and never calls merge-attributes', async () => {
        const { actions, state, apiFetch, baselineForm } = createHarness();
        await actions.translateCharacterDraft();

        const { form, baseline } = state.characterEditing;
        expect(form.description).toBe('译:{{char}} is a wizard.');
        expect(form.first_mes).toBe('译:Hello {{user}}!');
        expect(form.mes_example).toBe('译:<START>\n{{user}}: hi\n{{char}}: hello');
        expect(form.alternate_greetings).toBe('译:Greeting one.\n---\n译:Greeting two {{user}}.');
        // empty fields and the name stay as they were, and the baseline is the saved card
        expect(form.personality).toBe('');
        expect(form.name).toBe('Alice');
        expect(baseline).toEqual(baselineForm);
        expect(apiFetch).not.toHaveBeenCalled();
        expect(state.characterTranslation.items.every(item => item.status === 'done')).toBe(true);
        expect(state.characterTranslation.summary).toContain('已翻译 7 个字段');
    });

    test('keeps macros out of the requests and flags a field whose placeholders do not match, leaving it unchanged', async () => {
        const { actions, state, calls } = createHarness({
            translate: text => (text.startsWith('[[1]]: hi') || text.includes('is a wizard') ? text.replace(/\[\[\d+\]\]/g, '') : `译:${text}`),
        });
        await actions.translateCharacterDraft();

        expect(calls.every(call => !/\{\{|<START>/.test(call.text))).toBe(true);
        const statuses = Object.fromEntries(state.characterTranslation.items.map(item => [item.id, item.status]));
        expect(statuses.description).toBe('mismatch');
        expect(state.characterEditing.form.description).toBe('{{char}} is a wizard.');
        expect(state.characterTranslation.items.find(item => item.id === 'description').message).toContain('已保持原文');
        expect(statuses.first_mes).toBe('done');
        expect(state.characterTranslation.summary).toContain('占位内容对不上');
    });

    test('does not overwrite a field the user edited during the translation', async () => {
        let harness;
        harness = createHarness({
            translate: text => {
                if (text.includes('Notes')) {
                    harness.state.characterEditing.form.creator_notes = 'My own notes';
                }
                return `译:${text}`;
            },
        });
        await harness.actions.translateCharacterDraft();
        expect(harness.state.characterEditing.form.creator_notes).toBe('My own notes');
        expect(harness.state.characterTranslation.items.find(item => item.id === 'creator_notes').status).toBe('conflict');
    });

    test('stops at the first failing field and marks the rest as not translated', async () => {
        const failure = Object.assign(new Error('x'), { status: 500, body: JSON.stringify({ error: 'provider_failed', message: 'x', detail: 'ECONNREFUSED' }) });
        const { actions, state, calls, toasts } = createHarness({ translate: (text, index) => (index === 2 ? failure : `译:${text}`) });
        await actions.translateCharacterDraft();

        const statuses = state.characterTranslation.items.map(item => item.status);
        expect(statuses[0]).toBe('done');
        expect(statuses[1]).toBe('error');
        expect(statuses.slice(2).every(status => status === 'skipped')).toBe(true);
        expect(calls).toHaveLength(2);
        expect(toasts.at(-1).detail).toContain('ECONNREFUSED');
    });

    test('restores one field to the saved text', async () => {
        const { actions, state } = createHarness();
        await actions.translateCharacterDraft();
        actions.restoreTranslatedCharacterField('alternate_greetings:1');
        expect(state.characterEditing.form.alternate_greetings).toBe('译:Greeting one.\n---\nGreeting two {{user}}.');
        actions.restoreTranslatedCharacterField('description');
        expect(state.characterEditing.form.description).toBe('{{char}} is a wizard.');
        expect(state.characterTranslation.items.find(item => item.id === 'description').status).toBe('restored');
    });

    test('asks for the privacy confirmation before the first request', async () => {
        const { actions, state, calls } = createHarness();
        localStorage.setItem('st-modern-translate-privacy-ack', '[]');
        await actions.translateCharacterDraft();
        expect(state.characterTranslation.confirm).toBe('draft');
        expect(calls).toHaveLength(0);
        await actions.translateCharacterDraft({ confirmed: true });
        expect(calls.length).toBeGreaterThan(0);
    });

    test('stops translating when the editor is closed', async () => {
        let harness;
        harness = createHarness({
            translate: text => {
                harness.state.characterEditing = { avatar: '', form: {}, errors: {}, baseline: {} };
                return `译:${text}`;
            },
        });
        await harness.actions.translateCharacterDraft();
        expect(harness.state.characterTranslation.items.filter(item => item.status === 'done')).toHaveLength(0);
        expect(harness.state.characterTranslation.items.slice(1).every(item => item.status === 'skipped')).toBe(true);
    });

    test('copy and translate duplicates first, opens the copy and translates its draft', async () => {
        const { actions, state, apiFetch, beginCharacterEdit } = createHarness();
        await actions.translateCharacterCopy();

        expect(apiFetch).toHaveBeenCalledWith('/api/characters/duplicate', { body: { avatar_url: 'alice.png' } });
        expect(beginCharacterEdit).toHaveBeenCalledWith('alice-copy.png');
        expect(state.selected.character).toBe('alice-copy.png');
        expect(state.characterEditing.avatar).toBe('alice-copy.png');
        expect(state.characterEditing.form.description).toBe('译:{{char}} is a wizard.');
        expect(apiFetch).not.toHaveBeenCalledWith('/api/characters/merge-attributes', expect.anything());
    });

    test('does not create a copy when the provider needs a key or the privacy notice is unconfirmed', async () => {
        const noKey = createHarness();
        noKey.state.settings.extension_settings.translate.provider = 'deepl';
        await expect(noKey.actions.translateCharacterCopy()).rejects.toThrow('API Key');
        expect(noKey.apiFetch).not.toHaveBeenCalled();

        const unconfirmed = createHarness();
        localStorage.setItem('st-modern-translate-privacy-ack', '[]');
        await unconfirmed.actions.translateCharacterCopy();
        expect(unconfirmed.state.characterTranslation.confirm).toBe('copy');
        expect(unconfirmed.apiFetch).not.toHaveBeenCalled();
    });
});
