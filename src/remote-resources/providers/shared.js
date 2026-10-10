import path from 'node:path';

import fetch from 'node-fetch';
import { decode } from 'html-entities';

export const USER_AGENT = 'SillyTavern Remote Resources';

export const REMOTE_RESOURCE_TYPES = Object.freeze({
    CHARACTER: 'character',
    WORLDBOOK: 'worldbook',
    EXTENSION: 'extension',
    ASSET: 'asset',
    PRESET: 'preset',
});

export function formatRemoteResource(provider, item) {
    return {
        providerId: provider.id,
        providerName: provider.name,
        resourceType: item.resourceType,
        id: String(item.id || item.sourceUrl || ''),
        title: item.title || item.id || 'Untitled',
        description: item.description || '',
        author: item.author || '',
        sourceUrl: item.sourceUrl || '',
        thumbnailUrl: item.thumbnailUrl || '',
        downloadUrl: item.downloadUrl || '',
        installUrl: item.installUrl || '',
        tags: Array.isArray(item.tags) ? item.tags : [],
        stats: item.stats && typeof item.stats === 'object' ? item.stats : {},
        updatedAt: item.updatedAt || '',
        metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {},
        capabilities: {
            download: Boolean(item.downloadUrl || item.capabilities?.download),
            install: Boolean(item.installUrl || item.capabilities?.install),
            importUrl: Boolean(item.capabilities?.importUrl),
        },
    };
}

export function normalizeQuery(query) {
    return String(query || '').trim().toLowerCase();
}

export function matchesQuery(item, query) {
    const normalized = normalizeQuery(query);
    if (!normalized) {
        return true;
    }

    const haystack = [
        item.id,
        item.title,
        item.description,
        item.author,
        ...(Array.isArray(item.tags) ? item.tags : []),
    ].filter(Boolean).join(' ').toLowerCase();

    return haystack.includes(normalized);
}

export function clampLimit(limit, fallback = 24, max = 60) {
    const parsed = Number(limit);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.min(Math.floor(parsed), max);
}

export function getPageOffset(page, limit) {
    const parsed = Number(page);
    const safePage = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
    return (safePage - 1) * limit;
}

export function stripHtml(html) {
    return decode(String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

// Upper bound for the response-body excerpt appended to an HTTP error message.
const ERROR_BODY_MAX_LENGTH = 120;

/**
 * Turns arbitrary error text into one readable line: drops script/style blocks, comments and tags
 * (including a tag cut off by an earlier slice), decodes entities and collapses whitespace.
 * @param {unknown} value Error text, possibly containing HTML
 * @param {number} [maxLength] Maximum length of the returned text
 * @returns {string} Plain single-line text
 */
export function sanitizeErrorText(value, maxLength = 300) {
    const text = String(value ?? '')
        .replace(/<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
        .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/<[^>]*$/, ' ');
    return truncateText(decode(text).replace(/\s+/g, ' ').trim(), maxLength);
}

/**
 * Summarizes a failed response body for an error message. HTML pages (error pages, Cloudflare challenges)
 * contribute only their <title>; other bodies are reduced to a short plain-text excerpt.
 * @param {string} text Response body
 * @param {string|null} [contentType] Response Content-Type header
 * @returns {string} Short excerpt, or an empty string when the body has nothing readable
 */
export function summarizeErrorBody(text, contentType = '') {
    const body = String(text || '');
    if (!body.trim()) {
        return '';
    }
    const isHtmlPage = /\bhtml\b/i.test(String(contentType || '')) || /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(body);
    if (isHtmlPage) {
        const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
        return sanitizeErrorText(title, ERROR_BODY_MAX_LENGTH);
    }
    return sanitizeErrorText(body, ERROR_BODY_MAX_LENGTH);
}

/**
 * Builds the error message for a non-OK HTTP response, keeping the status code and a short body excerpt.
 * @param {string} prefix Message prefix, e.g. 'Remote request failed'
 * @param {{ status: number, statusText?: string, headers?: { get(name: string): string|null } }} response Failed response
 * @param {string} [text] Response body
 * @returns {string} Error message
 */
export function formatHttpErrorMessage(prefix, response, text = '') {
    const status = `${response.status} ${response.statusText || ''}`.trim();
    const excerpt = summarizeErrorBody(text, response.headers?.get?.('content-type'));
    return `${prefix}: ${status}${excerpt ? ` - ${excerpt}` : ''}`;
}

export function truncateText(value, maxLength = 520) {
    const text = String(value || '').trim();
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength).trimEnd()}...`;
}

export function getFilenameFromUrl(url, fallback) {
    try {
        const parsed = new URL(url);
        const name = path.basename(parsed.pathname);
        return name || fallback;
    } catch {
        return fallback;
    }
}

export async function fetchText(url, options = {}) {
    const response = await fetchWithTimeout(url, {
        headers: {
            'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
            'User-Agent': USER_AGENT,
            ...options.headers,
        },
        timeoutMs: options.timeoutMs,
    });

    return {
        response,
        text: await response.text(),
    };
}

export async function fetchJson(url, options = {}) {
    const response = await fetchWithTimeout(url, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': USER_AGENT,
            ...options.headers,
        },
        timeoutMs: options.timeoutMs,
    });

    return {
        response,
        json: await response.json(),
    };
}

export async function fetchBuffer(url, options = {}) {
    const response = await fetchWithTimeout(url, {
        headers: {
            'Accept': '*/*',
            'User-Agent': USER_AGENT,
            ...options.headers,
        },
        timeoutMs: options.timeoutMs,
    });

    return {
        response,
        buffer: Buffer.from(await response.arrayBuffer()),
    };
}

async function fetchWithTimeout(url, options = {}) {
    const timeoutMs = Number(options.timeoutMs) || 20000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });

        if (!response.ok) {
            // Distinguish rate limiting (429) from generic failures so the frontend can tell "throttled" apart from "site down"
            if (response.status === 429) {
                const retryAfter = response.headers.get('retry-after');
                throw new Error(`Remote request rate limited (429)${retryAfter ? `, retry after ${retryAfter}s` : ''}`);
            }
            const text = await response.text().catch(() => '');
            throw new Error(formatHttpErrorMessage('Remote request failed', response, text));
        }

        return response;
    } catch (error) {
        // The abort here only comes from our own timer; report it as a timeout instead of a bare "aborted".
        if (controller.signal.aborted && error?.name === 'AbortError') {
            throw new Error(`Remote request timed out after ${Math.round(timeoutMs / 1000)}s`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}
