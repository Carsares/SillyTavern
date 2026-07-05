import path from 'node:path';

import extractChunks from 'png-chunks-extract';
import PNGtext from 'png-chunk-text';

import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchBuffer,
    fetchJson,
    formatRemoteResource,
    getPageOffset,
    matchesQuery,
    stripHtml,
    truncateText,
} from './shared.js';

const SITE_URL = 'https://snombler.neocities.org/';
const PAGE_URL = `${SITE_URL}cards`;
const DATA_URL = `${SITE_URL}cards.json`;
const CACHE_TTL_MS = 10 * 60 * 1000;
const BLOCKED_TEXT_PATTERN = /\b(?:nsfw|nsfl|rape|incest|loli|shota|underage|sex|strip|fetish|breeding|cum|whore|prostitute|slut)\b/iu;

let cache = {
    expiresAt: 0,
    items: [],
};

export const snomblerNeocitiesProvider = {
    id: 'snombler-neocities',
    name: 'Snombler Neocities',
    description: 'Snombler public Neocities cards.json index, limited to PNG character cards without explicit high-risk terms.',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            return { items: [], total: 0 };
        }

        const limit = clampLimit(params.limit);
        const offset = getPageOffset(params.page, limit);
        const resources = await readResources();
        const matched = resources.filter(item => matchesQuery(item, params.query));

        return {
            items: matched.slice(offset, offset + limit).map(item => formatRemoteResource(this, item)),
            total: matched.length,
        };
    },

    async download(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            throw new Error('Snombler only supports character downloads.');
        }

        const id = String(params.resourceId || '').trim();
        const item = (await readResources()).find(resource => resource.id === id);
        if (!item) {
            throw new Error('Snombler character is not available from the filtered index.');
        }

        const fileUrl = parseCardUrl(item.metadata.cardPath);
        const { response, buffer } = await fetchBufferWithRetry(fileUrl.toString());
        if (!isPng(buffer) || !hasCharacterCardText(buffer)) {
            throw new Error('Snombler PNG does not contain character card metadata.');
        }

        return {
            buffer,
            fileName: safeDecode(path.basename(fileUrl.pathname)) || 'snombler-character.png',
            fileType: response.headers.get('content-type') || 'image/png',
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    },
};

async function readResources() {
    if (Date.now() < cache.expiresAt) {
        return cache.items;
    }

    const { json } = await fetchJsonWithRetry(DATA_URL);
    const cards = Array.isArray(json?.cards) ? json.cards : [];
    cache = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        items: cards.filter(isAllowedCard).map(convertCard).filter(Boolean),
    };
    return cache.items;
}

function convertCard(card) {
    const id = String(card.id || '').trim();
    const fileUrl = parseCardUrl(card.image);
    const title = stripHtml(card.name || id);
    if (!id || !fileUrl || !title) {
        return null;
    }

    const description = truncateText(stripHtml(card.description || ''));
    const setName = stripHtml(card.set || '');
    return {
        id,
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title,
        description,
        author: 'snombler',
        sourceUrl: `${PAGE_URL}#${encodeURIComponent(id)}`,
        downloadUrl: fileUrl.toString(),
        thumbnailUrl: fileUrl.toString(),
        tags: ['Snombler', setName, card.created ? `created:${card.created}` : '', card.updated ? `updated:${card.updated}` : ''].filter(Boolean),
        stats: {},
        updatedAt: card.updated || card.created || '',
        capabilities: { download: true },
        metadata: {
            cardPath: String(card.image || '').trim(),
            set: setName,
            scenarios: Array.isArray(card.scenarios) ? card.scenarios : [],
        },
    };
}

function isAllowedCard(card) {
    if (!String(card?.id || '').trim() || !parseCardUrl(card?.image)) {
        return false;
    }

    return !BLOCKED_TEXT_PATTERN.test([
        card.name,
        card.set,
        card.description,
        ...(Array.isArray(card.scenarios) ? card.scenarios : []),
    ].filter(Boolean).join(' '));
}

function parseCardUrl(cardPath) {
    try {
        const url = new URL(String(cardPath || '').trim(), SITE_URL);
        if (url.protocol === 'https:' && url.origin === new URL(SITE_URL).origin && url.pathname.startsWith('/cards/') && path.extname(url.pathname).toLowerCase() === '.png') {
            return url;
        }
    } catch {
        // Continue to the uniform failure below.
    }
    return null;
}

async function fetchJsonWithRetry(url) {
    return fetchWithRetry(() => fetchJson(url, { timeoutMs: 20000 }));
}

async function fetchBufferWithRetry(url) {
    return fetchWithRetry(() => fetchBuffer(url, { timeoutMs: 20000 }));
}

async function fetchWithRetry(fetchResource) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            return await fetchResource();
        } catch (error) {
            lastError = error;
            if (attempt < 3) {
                await delay(350 * attempt);
            }
        }
    }
    throw lastError;
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isPng(buffer) {
    return buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
}

function hasCharacterCardText(buffer) {
    try {
        const textChunks = extractChunks(new Uint8Array(buffer))
            .filter(chunk => chunk.name === 'tEXt')
            .map(chunk => PNGtext.decode(chunk.data));
        return textChunks.some(chunk => ['chara', 'ccv3'].includes(String(chunk.keyword || '').toLowerCase()) && chunk.text);
    } catch {
        return false;
    }
}

function safeDecode(value) {
    try {
        return decodeURIComponent(String(value || ''));
    } catch {
        return String(value || '');
    }
}
