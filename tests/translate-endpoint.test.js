import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';

const fetchMock = jest.fn();
const readSecretMock = jest.fn();
const googleTranslateMock = jest.fn();
const bingTranslateMock = jest.fn();
const googleConstructorMock = jest.fn();

jest.unstable_mockModule('node-fetch', () => ({
    default: fetchMock,
}));

jest.unstable_mockModule('bing-translate-api', () => ({
    translate: bingTranslateMock,
}));

jest.unstable_mockModule('google-translate-api-x', () => ({
    Translator: class {
        constructor(options) {
            googleConstructorMock(options);
        }

        translate(text) {
            return googleTranslateMock(text);
        }
    },
}));

jest.unstable_mockModule('../src/endpoints/secrets.js', () => ({
    readSecret: readSecretMock,
    SECRET_KEYS: {
        DEEPL: 'deepl',
        LIBRE: 'libre',
        LIBRE_URL: 'libre_url',
        LINGVA_URL: 'lingva_url',
        ONERING_URL: 'oneringtranslator_url',
        DEEPLX_URL: 'deeplx_url',
    },
}));

jest.unstable_mockModule('../src/util.js', () => ({
    getConfigValue: (_key, fallback) => fallback,
    uuidv4: () => '11111111-2222-3333-4444-555555555555',
}));

let router;

beforeAll(async () => {
    ({ router } = await import('../src/endpoints/translate.js'));
});

const PRIVATE_TEXT = 'My private sentence about the dragon';
const PRIVATE_TRANSLATION = '关于龙的私人句子';

/** Console output of one test, so we can prove the text never reaches the logs. */
let logged;

beforeEach(() => {
    fetchMock.mockReset();
    readSecretMock.mockReset();
    googleTranslateMock.mockReset();
    bingTranslateMock.mockReset();
    googleConstructorMock.mockReset();
    logged = [];
    for (const method of ['debug', 'info', 'log', 'warn', 'error']) {
        jest.spyOn(console, method).mockImplementation((...args) => {
            logged.push(args.map(arg => (arg instanceof Error ? `${arg.message} ${JSON.stringify(arg.cause ?? '')}` : typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
        });
    }
});

afterEach(() => {
    jest.restoreAllMocks();
});

function getHandler(routePath) {
    const route = router.stack.find(layer => layer.route?.path === routePath)?.route;
    if (!route) {
        throw new Error(`Route not found: ${routePath}`);
    }
    return route.stack[route.stack.length - 1].handle;
}

function createRequest(body, secrets = {}) {
    readSecretMock.mockImplementation((_directories, key) => secrets[key] ?? '');
    return { body: { ...body }, user: { directories: {} } };
}

function createResponse() {
    const response = { statusCode: 200, headers: {}, body: undefined, jsonBody: undefined };
    response.status = jest.fn(code => {
        response.statusCode = code;
        return response;
    });
    response.json = jest.fn(value => {
        response.jsonBody = value;
        return response;
    });
    response.send = jest.fn(value => {
        response.body = value;
        return response;
    });
    response.setHeader = jest.fn((name, value) => {
        response.headers[name] = value;
    });
    return response;
}

function okFetch(json) {
    return { ok: true, status: 200, statusText: 'OK', json: async () => json, text: async () => JSON.stringify(json) };
}

function failedFetch(status, statusText, text = '') {
    return { ok: false, status, statusText, json: async () => ({}), text: async () => text };
}

/** Everything the endpoint wrote to the console during the test. */
function loggedOutput() {
    return logged.join('\n');
}

describe('success responses', () => {
    test('google answers with a bare text/plain body, keeps a numeric translation a string and logs only lengths', async () => {
        googleTranslateMock.mockResolvedValue({ text: '42' });
        const request = createRequest({ text: 'forty-two', lang: 'pt-BR' });
        const response = createResponse();
        await getHandler('/google')(request, response);

        expect(response.headers['Content-Type']).toBe('text/plain; charset=utf-8');
        expect(response.body).toBe('42');
        expect(response.status).not.toHaveBeenCalled();
        expect(googleConstructorMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'pt' }));
        expect(logged.some(line => line.includes('Google') && line.includes('9 -> 2 characters'))).toBe(true);
    });

    const textRoutes = [
        ['/libre', { libre_url: 'http://libre.test/translate' }, okFetch({ translatedText: PRIVATE_TRANSLATION })],
        ['/deepl', { deepl: 'key' }, okFetch({ translations: [{ text: PRIVATE_TRANSLATION }] })],
        ['/lingva', {}, okFetch({ translation: PRIVATE_TRANSLATION })],
        ['/onering', {}, okFetch({ result: PRIVATE_TRANSLATION })],
        ['/deeplx', {}, okFetch({ data: PRIVATE_TRANSLATION })],
    ];
    for (const [routePath, secrets, upstream] of textRoutes) {
        test(`${routePath} returns the translation as text/plain and never logs the text`, async () => {
            fetchMock.mockResolvedValue(upstream);
            const request = createRequest({ text: PRIVATE_TEXT, lang: 'ja', from_lang: 'en', to_lang: 'ja' }, secrets);
            const response = createResponse();
            await getHandler(routePath)(request, response);

            expect(response.body).toBe(PRIVATE_TRANSLATION);
            expect(response.headers['Content-Type']).toBe('text/plain; charset=utf-8');
            expect(response.status).not.toHaveBeenCalled();
            expect(loggedOutput()).not.toContain(PRIVATE_TEXT);
            expect(loggedOutput()).not.toContain(PRIVATE_TRANSLATION);
        });
    }

    test('bing and yandex return text and map the Chinese codes', async () => {
        bingTranslateMock.mockResolvedValue({ translation: PRIVATE_TRANSLATION });
        const bingResponse = createResponse();
        await getHandler('/bing')(createRequest({ text: PRIVATE_TEXT, lang: 'zh-CN' }), bingResponse);
        expect(bingTranslateMock).toHaveBeenCalledWith(PRIVATE_TEXT, null, 'zh-Hans');
        expect(bingResponse.body).toBe(PRIVATE_TRANSLATION);

        fetchMock.mockResolvedValue(okFetch({ text: ['Part one. ', 'Part two.'] }));
        const yandexRequest = createRequest({ chunks: ['a', 'b'], lang: 'zh-CN' });
        const yandexResponse = createResponse();
        await getHandler('/yandex')(yandexRequest, yandexResponse);
        // joined without a comma between the chunks
        expect(yandexResponse.body).toBe('Part one. Part two.');
        expect(fetchMock.mock.calls[0][1].body.get('lang')).toBe('zh');
        expect(loggedOutput()).not.toContain(PRIVATE_TEXT);
        expect(loggedOutput()).not.toContain(PRIVATE_TRANSLATION);
    });

    test('maps the language codes like the legacy routes and picks the DeepL endpoint', async () => {
        fetchMock.mockResolvedValue(okFetch({ translations: [{ text: 'x' }] }));
        await getHandler('/deepl')(createRequest({ text: 'a', lang: 'zh-TW', endpoint: 'pro' }, { deepl: 'key' }), createResponse());
        expect(fetchMock.mock.calls[0][0]).toBe('https://api.deepl.com/v2/translate');
        expect(fetchMock.mock.calls[0][1].body.get('target_lang')).toBe('ZH');

        fetchMock.mockClear();
        fetchMock.mockResolvedValue(okFetch({ data: 'x' }));
        await getHandler('/deeplx')(createRequest({ text: 'a', lang: 'zh-CN' }), createResponse());
        expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:1188/translate');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ target_lang: 'ZH', source_lang: 'auto' });

        fetchMock.mockClear();
        fetchMock.mockResolvedValue(okFetch({ translatedText: 'x' }));
        await getHandler('/libre')(createRequest({ text: 'a', lang: 'zh-TW' }, { libre_url: 'http://libre.test/t', libre: 'k' }), createResponse());
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ target: 'zt', api_key: 'k' });

        fetchMock.mockClear();
        fetchMock.mockResolvedValue(okFetch({ translation: 'x' }));
        await getHandler('/lingva')(createRequest({ text: 'a b', lang: 'pt-BR' }), createResponse());
        expect(fetchMock.mock.calls[0][0]).toBe('https://lingva.ml/api/v1/auto/pt/a%20b');
    });
});

describe('failure responses', () => {
    test('a missing text or language is a 400 with a short JSON body', async () => {
        for (const routePath of ['/google', '/libre', '/deepl', '/lingva', '/deeplx', '/bing']) {
            const response = createResponse();
            await getHandler(routePath)(createRequest({ text: '', lang: 'ja' }, { libre_url: 'http://libre.test', deepl: 'k' }), response);
            expect(response.status).toHaveBeenCalledWith(400);
            expect(response.jsonBody).toMatchObject({ error: 'invalid_request' });
        }
        const onering = createResponse();
        await getHandler('/onering')(createRequest({ text: 'a', to_lang: 'ja' }), onering);
        expect(onering.status).toHaveBeenCalledWith(400);
        const yandex = createResponse();
        await getHandler('/yandex')(createRequest({ chunks: [], lang: 'ja' }), yandex);
        expect(yandex.status).toHaveBeenCalledWith(400);
    });

    test('a missing LibreTranslate URL or DeepL key says so', async () => {
        const libre = createResponse();
        await getHandler('/libre')(createRequest({ text: 'a', lang: 'ja' }), libre);
        expect(libre.status).toHaveBeenCalledWith(400);
        expect(libre.jsonBody).toMatchObject({ error: 'url_not_configured' });
        expect(fetchMock).not.toHaveBeenCalled();

        const deepl = createResponse();
        await getHandler('/deepl')(createRequest({ text: 'a', lang: 'ja' }), deepl);
        expect(deepl.status).toHaveBeenCalledWith(400);
        expect(deepl.jsonBody).toMatchObject({ error: 'key_not_configured' });
    });

    test('a failing provider is a 500 with the upstream status and no text anywhere', async () => {
        fetchMock.mockResolvedValue(failedFetch(456, 'Quota Exceeded', JSON.stringify({ message: 'Quota exceeded' })));
        const response = createResponse();
        await getHandler('/deepl')(createRequest({ text: PRIVATE_TEXT, lang: 'ja' }, { deepl: 'key' }), response);

        expect(response.status).toHaveBeenCalledWith(500);
        expect(response.jsonBody).toMatchObject({ error: 'provider_error', detail: '456' });
        expect(response.jsonBody.message).toContain('456 Quota Exceeded');
        expect(JSON.stringify(response.jsonBody)).not.toContain(PRIVATE_TEXT);
        expect(loggedOutput()).not.toContain(PRIVATE_TEXT);
        expect(loggedOutput()).not.toContain(PRIVATE_TRANSLATION);
    });

    test('Lingva used to answer 200 with an empty body when the instance failed; it is a 500 now', async () => {
        fetchMock.mockResolvedValue(failedFetch(429, 'Too Many Requests'));
        const response = createResponse();
        await getHandler('/lingva')(createRequest({ text: PRIVATE_TEXT, lang: 'ja' }), response);
        expect(response.status).toHaveBeenCalledWith(500);
        expect(response.jsonBody).toMatchObject({ error: 'provider_error', detail: '429' });
    });

    test('a network error reduces to its code: the request URL and the options hold the text', async () => {
        const url = `https://lingva.ml/api/v1/auto/ja/${encodeURIComponent(PRIVATE_TEXT)}`;
        fetchMock.mockRejectedValue(Object.assign(new Error(`request to ${url} failed, reason: connect ECONNREFUSED 127.0.0.1:443`), { code: 'ECONNREFUSED' }));
        const response = createResponse();
        await getHandler('/lingva')(createRequest({ text: PRIVATE_TEXT, lang: 'ja' }), response);

        expect(response.status).toHaveBeenCalledWith(500);
        expect(response.jsonBody).toMatchObject({ error: 'provider_failed', detail: 'ECONNREFUSED' });
        expect(JSON.stringify(response.jsonBody)).not.toContain('dragon');
        expect(logged.join('\n')).not.toContain('dragon');
        expect(logged.join('\n')).not.toContain(encodeURIComponent('dragon'));
    });

    test('a library error that carries the request options in its cause does not leak them', async () => {
        googleTranslateMock.mockRejectedValue(new Error('Too Many Requests', { cause: { options: { text: PRIVATE_TEXT }, url: 'https://translate.google.test' } }));
        const response = createResponse();
        await getHandler('/google')(createRequest({ text: PRIVATE_TEXT, lang: 'ja' }), response);

        expect(response.status).toHaveBeenCalledWith(500);
        expect(response.jsonBody).toMatchObject({ error: 'provider_failed', detail: 'Too Many Requests' });
        expect(loggedOutput()).not.toContain(PRIVATE_TEXT);
        expect(loggedOutput()).not.toContain(PRIVATE_TRANSLATION);
        expect(logged.join('\n')).not.toContain('dragon');
    });

    test('an error message with a URL in it is stripped of the URL', async () => {
        bingTranslateMock.mockRejectedValue(new Error('Failed to fetch https://www.bing.com/ttranslatev3?text=dragon now'));
        const response = createResponse();
        await getHandler('/bing')(createRequest({ text: PRIVATE_TEXT, lang: 'ja' }), response);
        expect(response.jsonBody.detail).toBe('Failed to fetch <url> now');
    });

    test('a provider answer that is not a string is reported instead of sent', async () => {
        fetchMock.mockResolvedValue(okFetch({ translations: [] }));
        const response = createResponse();
        await getHandler('/deepl')(createRequest({ text: 'a', lang: 'ja' }, { deepl: 'key' }), response);
        expect(response.status).toHaveBeenCalledWith(500);
        expect(response.jsonBody).toMatchObject({ error: 'invalid_response' });
        expect(response.send).not.toHaveBeenCalled();
    });
});
