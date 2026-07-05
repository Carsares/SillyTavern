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
    truncateText,
} from './shared.js';

const BASE_URL = 'https://mlpchag.neocities.org';
const CACHE_MS = 10 * 60 * 1000;
const CHARACTER_MANIFESTS = Object.freeze([
    ['mares', '/mares.json', '/cards/', 'Ponydex card'],
    ['chub', '/chub.json', '/chub/', 'Chub archive card'],
]);
const FORKS_MANIFEST = '/forks.json';
const LOREBOOKS_MANIFEST = '/lorebooks.json';

let cache = {
    expiresAt: 0,
    items: [],
};

export const mlpchagPonydexProvider = {
    id: 'mlpchag-ponydex',
    name: 'MLPCHAG Ponydex',
    description: 'MLPCHAG Ponydex 静态角色卡与世界书索引，匿名读取公开 manifest 并下载带角色卡元数据的 PNG 或世界书 JSON。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        if (params.resourceType && ![REMOTE_RESOURCE_TYPES.CHARACTER, REMOTE_RESOURCE_TYPES.WORLDBOOK].includes(params.resourceType)) {
            return { items: [], total: 0 };
        }

        const limit = clampLimit(params.limit);
        const offset = getPageOffset(params.page, limit);
        const resources = await readResources();
        const matched = resources
            .filter(item => !params.resourceType || item.resourceType === params.resourceType)
            .filter(item => matchesQuery(item, params.query));

        return {
            items: matched.slice(offset, offset + limit).map(item => formatRemoteResource(this, item)),
            total: matched.length,
        };
    },

    async download(params) {
        const resource = parseResourceId(params.resourceId);
        if (params.resourceType && params.resourceType !== resource.resourceType) {
            throw new Error('MLPCHAG Ponydex resource type mismatch.');
        }

        const downloadUrl = getDownloadUrl(resource);
        const { response, buffer } = await fetchBuffer(downloadUrl.toString());
        validateDownloadedBuffer(buffer, resource.resourceType);

        return {
            buffer,
            fileName: getDownloadFileName(downloadUrl, resource.resourceType),
            fileType: response.headers.get('content-type') || getDefaultFileType(resource.resourceType),
            resourceType: resource.resourceType,
        };
    },
};

async function readResources() {
    if (Date.now() < cache.expiresAt) {
        return cache.items;
    }

    const [characters, forks, lorebooks] = await Promise.all([
        readCharacterResources(),
        readForkResources(),
        readLorebookResources(),
    ]);
    cache = {
        expiresAt: Date.now() + CACHE_MS,
        items: uniqueById([...characters, ...forks, ...lorebooks]),
    };
    return cache.items;
}

async function readCharacterResources() {
    const manifests = await Promise.all(CHARACTER_MANIFESTS.map(async ([source, manifestPath, downloadPrefix, sourceTag]) => {
        const { json } = await fetchJson(toAbsoluteUrl(manifestPath), { timeoutMs: 15000 });
        return Object.entries(json || {}).map(([filePath, card]) => convertCharacter(source, downloadPrefix, sourceTag, filePath, card));
    }));
    return manifests.flat().filter(Boolean);
}

async function readForkResources() {
    const { json } = await fetchJson(toAbsoluteUrl(FORKS_MANIFEST), { timeoutMs: 15000 });
    return Object.values(json || {})
        .flatMap(group => Object.entries(group || {}))
        .map(([filePath, card]) => convertCharacter('forks', '/cards/', 'Ponydex fork', filePath, card))
        .filter(Boolean);
}

async function readLorebookResources() {
    const { json } = await fetchJson(toAbsoluteUrl(LOREBOOKS_MANIFEST), { timeoutMs: 15000 });
    return Object.entries(json || {})
        .map(([key, lorebook]) => convertLorebook(key, lorebook))
        .filter(Boolean);
}

function convertCharacter(source, downloadPrefix, sourceTag, filePath, card) {
    if (!filePath || !card || typeof card !== 'object') {
        return null;
    }

    const downloadUrl = toAbsoluteUrl(`${downloadPrefix}${encodePath(filePath)}`);
    const thumbnailUrl = source === 'chub' ? downloadUrl : toAbsoluteUrl(`/thumbs/${encodePath(filePath.replace(/\.(png|webp)$/iu, '.webp'))}`);
    const title = String(card.name || path.basename(filePath, path.extname(filePath)) || 'Ponydex Character');
    const id = formatResourceId({
        source,
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        path: filePath,
    });

    return {
        id,
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title,
        description: truncateText(card.description || card.scenario || ''),
        author: String(card.author || getAuthorFromPath(filePath)),
        sourceUrl: `${BASE_URL}/view?card=${encodeURIComponent(filePath)}${source === 'chub' ? '&source=chub' : ''}`,
        downloadUrl,
        thumbnailUrl,
        tags: ['MLPCHAG', 'Ponydex', sourceTag, ...normalizeTags(card.tags)],
        updatedAt: card.dateupdate || card.datecreate || '',
        capabilities: { download: true },
        metadata: {
            source,
            filePath,
            format: card.__format || '',
        },
    };
}

function convertLorebook(key, lorebook) {
    if (!lorebook?.download || !String(lorebook.download).toLowerCase().endsWith('.json')) {
        return null;
    }

    const downloadUrl = new URL(lorebook.download, BASE_URL);
    const id = formatResourceId({
        source: 'lorebooks',
        resourceType: REMOTE_RESOURCE_TYPES.WORLDBOOK,
        path: downloadUrl.pathname,
    });

    return {
        id,
        resourceType: REMOTE_RESOURCE_TYPES.WORLDBOOK,
        title: String(lorebook.name || path.basename(downloadUrl.pathname, '.json') || key),
        description: String(lorebook.description || ''),
        author: String(lorebook.author || getAuthorFromPath(key)),
        sourceUrl: `${BASE_URL}/lorebooks`,
        downloadUrl: downloadUrl.toString(),
        thumbnailUrl: lorebook.image ? toAbsoluteUrl(lorebook.image) : '',
        tags: ['MLPCHAG', 'Ponydex', 'JSON worldbook'],
        capabilities: { download: true },
        metadata: {
            source: 'lorebooks',
            key,
            filePath: downloadUrl.pathname,
        },
    };
}

function formatResourceId(resource) {
    return JSON.stringify(resource);
}

function parseResourceId(value) {
    try {
        const parsed = JSON.parse(String(value || ''));
        return {
            source: String(parsed.source || ''),
            resourceType: String(parsed.resourceType || ''),
            path: String(parsed.path || ''),
        };
    } catch {
        throw new Error('MLPCHAG Ponydex resource ID is invalid.');
    }
}

function getDownloadUrl(resource) {
    if (resource.resourceType === REMOTE_RESOURCE_TYPES.CHARACTER) {
        const manifest = CHARACTER_MANIFESTS.find(([source]) => source === resource.source);
        const downloadPrefix = manifest?.[2] || (resource.source === 'forks' ? '/cards/' : '');
        if (!downloadPrefix || !resource.path || path.extname(resource.path).toLowerCase() !== '.png') {
            throw new Error('MLPCHAG Ponydex character resource path is invalid.');
        }
        return new URL(`${downloadPrefix}${encodePath(resource.path)}`, BASE_URL);
    }

    if (resource.resourceType === REMOTE_RESOURCE_TYPES.WORLDBOOK) {
        const url = new URL(resource.path, BASE_URL);
        if (url.origin !== BASE_URL || !url.pathname.startsWith('/lorebook/') || path.extname(url.pathname).toLowerCase() !== '.json') {
            throw new Error('MLPCHAG Ponydex worldbook resource path is invalid.');
        }
        return url;
    }

    throw new Error('MLPCHAG Ponydex resource type is invalid.');
}

function validateDownloadedBuffer(buffer, resourceType) {
    if (resourceType === REMOTE_RESOURCE_TYPES.CHARACTER) {
        if (!isPng(buffer) || !hasCharacterCardText(buffer)) {
            throw new Error('MLPCHAG Ponydex PNG does not contain character card metadata.');
        }
        return;
    }

    const json = parseJsonBuffer(buffer);
    if (resourceType !== REMOTE_RESOURCE_TYPES.WORLDBOOK || !isWorldbookJson(json)) {
        throw new Error('MLPCHAG Ponydex JSON does not contain SillyTavern worldbook entries.');
    }
}

function parseJsonBuffer(buffer) {
    try {
        const json = JSON.parse(buffer.toString('utf8'));
        if (!json || typeof json !== 'object' || Array.isArray(json)) {
            throw new Error('root is not an object');
        }
        return json;
    } catch (error) {
        throw new Error(`MLPCHAG Ponydex JSON is invalid: ${error.message}`);
    }
}

function isWorldbookJson(json) {
    const entries = json?.entries;
    const values = Array.isArray(entries) ? entries : entries && typeof entries === 'object' ? Object.values(entries) : [];
    return values.some(entry => entry && typeof entry === 'object' && Array.isArray(entry.key) && entry.key.length && typeof entry.content === 'string' && entry.content.trim());
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

function getDownloadFileName(downloadUrl, resourceType) {
    const fallback = resourceType === REMOTE_RESOURCE_TYPES.CHARACTER ? 'ponydex-character.png' : 'ponydex-worldbook.json';
    return safeDecode(path.basename(downloadUrl.pathname)) || fallback;
}

function getDefaultFileType(resourceType) {
    return resourceType === REMOTE_RESOURCE_TYPES.CHARACTER ? 'image/png' : 'application/json';
}

function normalizeTags(tags) {
    return Array.isArray(tags) ? tags.map(tag => String(tag || '').trim()).filter(Boolean).slice(0, 8) : [];
}

function getAuthorFromPath(filePath) {
    return String(filePath || '').split('/').filter(Boolean)[0] || 'MLPCHAG';
}

function encodePath(filePath) {
    return String(filePath || '').split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function toAbsoluteUrl(value) {
    return new URL(value, BASE_URL).toString();
}

function safeDecode(value) {
    try {
        return decodeURIComponent(String(value || ''));
    } catch {
        return String(value || '');
    }
}

function uniqueById(items) {
    const seen = new Set();
    return items.filter(item => {
        if (seen.has(item.id)) {
            return false;
        }
        seen.add(item.id);
        return true;
    });
}
