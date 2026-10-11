import fetch from 'node-fetch';
import express from 'express';
import { translate as bingTranslate } from 'bing-translate-api';
import urlJoin from 'url-join';
import { Translator } from 'google-translate-api-x';

import { readSecret, SECRET_KEYS } from './secrets.js';
import { getConfigValue, uuidv4 } from '../util.js';

const DEEPLX_URL_DEFAULT = 'http://127.0.0.1:1188/translate';
const ONERING_URL_DEFAULT = 'http://127.0.0.1:4990/translate';
const LINGVA_DEFAULT = 'https://lingva.ml/api/v1';

const LOG_PREFIX = '[translate]';
const MAX_LOG_LENGTH = 300;
const MAX_ERROR_DETAIL_LENGTH = 160;

export const router = express.Router();

// Success responses are the bare translation (text/plain). Failures keep their HTTP status (400 for a bad request or a
// missing key/URL, 500 for anything the provider did) and carry a short JSON body `{ error, message }`, so the client can
// tell a missing key from an unreachable provider. The body never contains the text that was sent for translation.

/**
 * @param {unknown} value Any value
 * @param {number} [length] Maximum length
 * @returns {string} A single line no longer than `length`
 */
function truncate(value, length = MAX_LOG_LENGTH) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > length ? `${text.slice(0, length)}...` : text;
}

/**
 * Describes an exception without risking the translated text: network failures reduce to their error code (ECONNREFUSED...),
 * everything else to the first line of the message with URLs removed (node-fetch puts the whole request URL, which for
 * Lingva contains the text, into its messages). Library errors can also carry the request options in `cause`, so the
 * error object itself must never be logged.
 * @param {any} error Caught exception
 * @returns {string} Short description
 */
function describeFailure(error) {
    const code = error?.code ?? error?.cause?.code ?? error?.errno;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(code)) {
        return code;
    }

    const firstLine = String(error?.message ?? '').split('\n')[0].replace(/https?:\/\/\S+/g, '<url>');
    return truncate(firstLine, MAX_ERROR_DETAIL_LENGTH) || 'unknown error';
}

/**
 * @param {import('express').Response} response Response
 * @param {number} status HTTP status
 * @param {string} error Machine readable code
 * @param {string} message Short English description
 * @param {string} [detail] Extra detail such as the network error code
 */
function sendError(response, status, error, message, detail = '') {
    return response.status(status).json({ error, message, ...(detail ? { detail } : {}) });
}

/**
 * @param {import('express').Response} response Response
 * @param {string} provider Provider name
 * @param {string} inputText The text that was sent
 * @param {unknown} translated The provider's answer
 */
function sendTranslation(response, provider, inputText, translated) {
    if (typeof translated !== 'string') {
        console.warn(`${LOG_PREFIX} ${provider} returned an unexpected response.`);
        return sendError(response, 500, 'invalid_response', `${provider} returned an unexpected response.`);
    }

    // Lengths only: the text itself can be long and private.
    console.debug(`${LOG_PREFIX} ${provider}: ${inputText.length} -> ${translated.length} characters`);
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return response.send(translated);
}

/**
 * @param {import('express').Response} response Response
 * @param {string} provider Provider name
 * @param {import('node-fetch').Response} result Failed upstream response
 */
async function sendUpstreamError(response, provider, result) {
    const upstreamBody = await result.text().catch(() => '');
    console.warn(`${LOG_PREFIX} ${provider} responded ${result.status} ${result.statusText}: ${truncate(upstreamBody)}`);
    const status = truncate(`${result.status} ${result.statusText}`, MAX_ERROR_DETAIL_LENGTH);
    return sendError(response, 500, 'provider_error', `${provider} responded ${status}.`, String(result.status));
}

/**
 * @param {import('express').Response} response Response
 * @param {string} provider Provider name
 * @param {any} error Caught exception
 */
function sendException(response, provider, error) {
    const detail = describeFailure(error);
    console.error(`${LOG_PREFIX} ${provider} failed: ${detail}`);
    return sendError(response, 500, 'provider_failed', `${provider} request failed: ${detail}`, detail);
}

function sendInvalidRequest(response) {
    return sendError(response, 400, 'invalid_request', 'Both the text and the target language are required.');
}

let lingvaDefaultWarned = false;

router.post('/libre', async (request, response) => {
    try {
        const key = readSecret(request.user.directories, SECRET_KEYS.LIBRE);
        const url = readSecret(request.user.directories, SECRET_KEYS.LIBRE_URL);

        if (!url) {
            console.warn(`${LOG_PREFIX} LibreTranslate URL is not configured.`);
            return sendError(response, 400, 'url_not_configured', 'LibreTranslate URL is not configured.');
        }

        if (request.body.lang === 'zh-CN') {
            request.body.lang = 'zh';
        }

        if (request.body.lang === 'zh-TW') {
            request.body.lang = 'zt';
        }

        if (request.body.lang === 'pt-BR' || request.body.lang === 'pt-PT') {
            request.body.lang = 'pt';
        }

        const text = request.body.text;
        const lang = request.body.lang;

        if (!text || !lang) {
            return sendInvalidRequest(response);
        }

        const result = await fetch(url, {
            method: 'POST',
            body: JSON.stringify({
                q: text,
                source: 'auto',
                target: lang,
                format: 'text',
                api_key: key,
            }),
            headers: { 'Content-Type': 'application/json' },
        });

        if (!result.ok) {
            return sendUpstreamError(response, 'LibreTranslate', result);
        }

        /** @type {any} */
        const json = await result.json();
        return sendTranslation(response, 'LibreTranslate', String(text), json.translatedText);
    } catch (error) {
        return sendException(response, 'LibreTranslate', error);
    }
});

router.post('/google', async (request, response) => {
    try {
        if (request.body.lang === 'pt-BR') {
            request.body.lang = 'pt';
        }

        const text = String(request.body.text ?? '');
        const lang = String(request.body.lang ?? '');

        if (!text || !lang) {
            return sendInvalidRequest(response);
        }

        const translator = new Translator({ to: lang, requestFunction: fetch });
        const translatedText = await translator.translate(text).then(result => result.text);

        return sendTranslation(response, 'Google', text, translatedText);
    } catch (error) {
        return sendException(response, 'Google', error);
    }
});

router.post('/yandex', async (request, response) => {
    try {
        if (request.body.lang === 'pt-PT') {
            request.body.lang = 'pt';
        }

        if (request.body.lang === 'zh-CN' || request.body.lang === 'zh-TW') {
            request.body.lang = 'zh';
        }

        const chunks = request.body.chunks;
        const lang = request.body.lang;

        if (!Array.isArray(chunks) || !chunks.length || !lang) {
            return sendInvalidRequest(response);
        }

        // reconstruct original text to measure it
        let inputText = '';

        const params = new URLSearchParams();
        for (const chunk of chunks) {
            params.append('text', chunk);
            inputText += chunk;
        }
        params.append('lang', lang);
        const ucid = uuidv4().replaceAll('-', '');

        const result = await fetch(`https://translate.yandex.net/api/v1/tr.json/translate?ucid=${ucid}&srv=android&format=text`, {
            method: 'POST',
            body: params,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        if (!result.ok) {
            return sendUpstreamError(response, 'Yandex', result);
        }

        /** @type {any} */
        const json = await result.json();
        // The chunks were cut from one text (they only differ in where they end), so they are joined back without a
        // separator; Array#join() with no argument would put a comma between them.
        const translated = Array.isArray(json.text) ? json.text.join('') : json.text;
        return sendTranslation(response, 'Yandex', inputText, translated);
    } catch (error) {
        return sendException(response, 'Yandex', error);
    }
});

router.post('/lingva', async (request, response) => {
    try {
        const secretUrl = readSecret(request.user.directories, SECRET_KEYS.LINGVA_URL);
        const baseUrl = secretUrl || LINGVA_DEFAULT;

        if (!secretUrl && baseUrl === LINGVA_DEFAULT && !lingvaDefaultWarned) {
            lingvaDefaultWarned = true;
            console.warn(`${LOG_PREFIX} Lingva URL is using default value.`, LINGVA_DEFAULT);
        }

        if (request.body.lang === 'zh-CN' || request.body.lang === 'zh-TW') {
            request.body.lang = 'zh';
        }

        if (request.body.lang === 'pt-BR' || request.body.lang === 'pt-PT') {
            request.body.lang = 'pt';
        }

        const text = request.body.text;
        const lang = request.body.lang;

        if (!text || !lang) {
            return sendInvalidRequest(response);
        }

        const url = urlJoin(baseUrl, 'auto', lang, encodeURIComponent(text));
        const result = await fetch(url);

        if (!result.ok) {
            return sendUpstreamError(response, 'Lingva', result);
        }

        /** @type {any} */
        const data = await result.json();
        return sendTranslation(response, 'Lingva', String(text), data.translation);
    } catch (error) {
        return sendException(response, 'Lingva', error);
    }
});

router.post('/deepl', async (request, response) => {
    try {
        const key = readSecret(request.user.directories, SECRET_KEYS.DEEPL);

        if (!key) {
            console.warn(`${LOG_PREFIX} DeepL key is not configured.`);
            return sendError(response, 400, 'key_not_configured', 'DeepL key is not configured.');
        }

        if (request.body.lang === 'zh-CN' || request.body.lang === 'zh-TW') {
            request.body.lang = 'ZH';
        }

        const text = request.body.text;
        const lang = request.body.lang;
        const formality = getConfigValue('deepl.formality', 'default');

        if (!text || !lang) {
            return sendInvalidRequest(response);
        }

        const params = new URLSearchParams();
        params.append('text', text);
        params.append('target_lang', lang);

        if (['de', 'fr', 'it', 'es', 'nl', 'ja', 'ru', 'pt-BR', 'pt-PT'].includes(lang)) {
            params.append('formality', formality);
        }

        const endpoint = request.body.endpoint === 'pro'
            ? 'https://api.deepl.com/v2/translate'
            : 'https://api-free.deepl.com/v2/translate';

        const result = await fetch(endpoint, {
            method: 'POST',
            body: params,
            headers: {
                'Accept': 'application/json',
                'Authorization': `DeepL-Auth-Key ${key}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        if (!result.ok) {
            return sendUpstreamError(response, 'DeepL', result);
        }

        /** @type {any} */
        const json = await result.json();
        return sendTranslation(response, 'DeepL', String(text), json.translations?.[0]?.text);
    } catch (error) {
        return sendException(response, 'DeepL', error);
    }
});

router.post('/onering', async (request, response) => {
    try {
        const secretUrl = readSecret(request.user.directories, SECRET_KEYS.ONERING_URL);
        const url = secretUrl || ONERING_URL_DEFAULT;

        if (!url) {
            console.warn(`${LOG_PREFIX} OneRing URL is not configured.`);
            return sendError(response, 400, 'url_not_configured', 'OneRing URL is not configured.');
        }

        if (!secretUrl && url === ONERING_URL_DEFAULT) {
            console.info(`${LOG_PREFIX} OneRing URL is using default value.`, ONERING_URL_DEFAULT);
        }

        if (request.body.lang === 'pt-BR' || request.body.lang === 'pt-PT') {
            request.body.lang = 'pt';
        }

        const text = request.body.text;
        const from_lang = request.body.from_lang;
        const to_lang = request.body.to_lang;

        if (!text || !from_lang || !to_lang) {
            return sendInvalidRequest(response);
        }

        const params = new URLSearchParams();
        params.append('text', text);
        params.append('from_lang', from_lang);
        params.append('to_lang', to_lang);

        const fetchUrl = new URL(url);
        fetchUrl.search = params.toString();

        const result = await fetch(fetchUrl, {
            method: 'GET',
        });

        if (!result.ok) {
            return sendUpstreamError(response, 'OneRing', result);
        }

        /** @type {any} */
        const data = await result.json();
        return sendTranslation(response, 'OneRing', String(text), data.result);
    } catch (error) {
        return sendException(response, 'OneRing', error);
    }
});

router.post('/deeplx', async (request, response) => {
    try {
        const secretUrl = readSecret(request.user.directories, SECRET_KEYS.DEEPLX_URL);
        const url = secretUrl || DEEPLX_URL_DEFAULT;

        if (!url) {
            console.warn(`${LOG_PREFIX} DeepLX URL is not configured.`);
            return sendError(response, 400, 'url_not_configured', 'DeepLX URL is not configured.');
        }

        if (!secretUrl && url === DEEPLX_URL_DEFAULT) {
            console.info(`${LOG_PREFIX} DeepLX URL is using default value.`, DEEPLX_URL_DEFAULT);
        }

        const text = request.body.text;
        let lang = request.body.lang;
        if (request.body.lang === 'zh-CN' || request.body.lang === 'zh-TW') {
            lang = 'ZH';
        }

        if (!text || !lang) {
            return sendInvalidRequest(response);
        }

        const result = await fetch(url, {
            method: 'POST',
            body: JSON.stringify({
                text: text,
                source_lang: 'auto',
                target_lang: lang,
            }),
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
        });

        if (!result.ok) {
            return sendUpstreamError(response, 'DeepLX', result);
        }

        /** @type {any} */
        const json = await result.json();
        return sendTranslation(response, 'DeepLX', String(text), json.data);
    } catch (error) {
        return sendException(response, 'DeepLX', error);
    }
});

router.post('/bing', async (request, response) => {
    try {
        const text = request.body.text;
        let lang = request.body.lang;

        if (request.body.lang === 'zh-CN') {
            lang = 'zh-Hans';
        }

        if (request.body.lang === 'zh-TW') {
            lang = 'zh-Hant';
        }

        if (request.body.lang === 'pt-BR') {
            lang = 'pt';
        }

        if (!text || !lang) {
            return sendInvalidRequest(response);
        }

        const result = await bingTranslate(text, null, lang);
        return sendTranslation(response, 'Bing', String(text), result?.translation);
    } catch (error) {
        return sendException(response, 'Bing', error);
    }
});
