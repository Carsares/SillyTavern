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

const SITE_URL = 'https://malliebots.neocities.org/';
const DATA_URL = `${SITE_URL}cardsData.json`;
const CACHE_TTL_MS = 10 * 60 * 1000;
const BLOCKED_TAGS = new Set(['NSFW', 'NSFL', 'RAPE', 'SCAT', 'PEE', 'WATERSPORTS', 'CNC', 'INCEST']);

let cache = {
    expiresAt: 0,
    items: [],
};

export const malliebotsProvider = {
    id: 'malliebots',
    name: 'Malliebots',
    description: 'Malliebots public Neocities cardsData.json index, limited to explicit SFW PNG character cards.',
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
            throw new Error('Malliebots only supports character downloads.');
        }

        const cardPath = String(params.resourceId || '').trim();
        const item = (await readResources()).find(resource => resource.id === cardPath);
        if (!item) {
            throw new Error('Malliebots character is not available from the SFW index.');
        }

        const fileUrl = parseCardUrl(cardPath);
        const { response, buffer } = await fetchBufferWithRetry(fileUrl.toString());
        if (!isPng(buffer) || !hasCharacterCardText(buffer)) {
            throw new Error('Malliebots PNG does not contain character card metadata.');
        }

        return {
            buffer,
            fileName: safeDecode(path.basename(fileUrl.pathname)) || 'malliebots-character.png',
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
    const cards = Array.isArray(json) ? json : [];
    cache = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        items: cards.filter(isSfwCard).map(convertCard).filter(Boolean),
    };
    return cache.items;
}

function convertCard(card) {
    const cardPath = String(card.cardPath || '').trim();
    const fileUrl = parseCardUrl(cardPath);
    if (!fileUrl) {
        return null;
    }

    const title = stripHtml(card.name || safeDecode(path.basename(fileUrl.pathname, path.extname(fileUrl.pathname))));
    if (!title) {
        return null;
    }

    const tags = formatTags(card.siteTags);
    return {
        id: cardPath,
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title,
        description: truncateText(stripHtml(card.description || '')),
        author: 'mallie',
        sourceUrl: SITE_URL,
        downloadUrl: fileUrl.toString(),
        thumbnailUrl: fileUrl.toString(),
        tags: ['Malliebots', ...tags],
        stats: {},
        updatedAt: '',
        capabilities: { download: true },
        metadata: {
            malliebotsId: String(card.id || ''),
            version: String(card.version || ''),
            cardPath,
            externalLinks: Array.isArray(card.externalLink) ? card.externalLink : [],
        },
    };
}

function isSfwCard(card) {
    const tags = formatTags(card?.siteTags).map(tag => tag.toUpperCase());
    return Boolean(String(card?.cardPath || '').trim()) && tags.includes('SFW') && !tags.some(tag => BLOCKED_TAGS.has(tag));
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

function formatTags(tags) {
    return [...new Set((Array.isArray(tags) ? tags : []).map(tag => String(tag || '').trim()).filter(Boolean))];
}

function safeDecode(value) {
    try {
        return decodeURIComponent(String(value || ''));
    } catch {
        return String(value || '');
    }
}
