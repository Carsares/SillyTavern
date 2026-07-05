import path from 'node:path';

import extractChunks from 'png-chunks-extract';
import PNGtext from 'png-chunk-text';

import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchBuffer,
    fetchText,
    formatRemoteResource,
    getPageOffset,
    matchesQuery,
    stripHtml,
} from './shared.js';

const CACHE_TTL_MS = 10 * 60 * 1000;
const CHARHUB_AVATAR_HOST = 'avatars.charhub.io';
const CHARHUB_CARD_PATH_PATTERN = /^\/avatars\/.+\/chara_card_v[23]\.png$/iu;

const SOURCES = Object.freeze([
    {
        id: 'kylaci',
        name: '@kylaci Homepage',
        author: 'kylaci',
        pageUrl: 'https://kylaci.neocities.org/',
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        tag: 'Chub CDN card',
    },
    {
        id: 'leafcanfly-presets',
        name: 'Celia\'s Corner Presets',
        author: 'leafcanfly',
        pageUrl: 'https://leafcanfly.neocities.org/presets',
        resourceType: REMOTE_RESOURCE_TYPES.PRESET,
        tag: 'JSON preset',
    },
    {
        id: 'graystone-lorebook',
        name: 'Graystone Universe Lorebook',
        author: 'graystone',
        pageUrl: 'https://graystone.neocities.org/lorebook/',
        resourceType: REMOTE_RESOURCE_TYPES.WORLDBOOK,
        tag: 'JSON worldbook',
        jsonPathPattern: /^\/lorebook\/.+\.json$/iu,
    },
    {
        id: 'akiri-settings',
        name: 'Akiri ST Settings',
        author: 'Akiri',
        pageUrl: 'https://akiri11.neocities.org/',
        resourceType: REMOTE_RESOURCE_TYPES.PRESET,
        tag: 'JSON preset',
        jsonPathPattern: /^\/ST_Settings\/.+\.json$/iu,
    },
]);

let cache = {
    expiresAt: 0,
    items: [],
};

export const neocitiesCreatorsProvider = {
    id: 'neocities-creators',
    name: 'Neocities Creator Sources',
    description: '固定 Neocities 创作者页资源源，匿名抓取已验证直链角色卡和预设文件。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        if (params.resourceType && ![REMOTE_RESOURCE_TYPES.CHARACTER, REMOTE_RESOURCE_TYPES.WORLDBOOK, REMOTE_RESOURCE_TYPES.PRESET].includes(params.resourceType)) {
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
        const source = getSource(resource.sourceId);
        if (!source || (params.resourceType && params.resourceType !== resource.resourceType)) {
            throw new Error('Neocities creator resource type mismatch.');
        }

        const fileUrl = parseAbsoluteUrl(resource.fileUrl, source.pageUrl);
        if (!fileUrl || !isAllowedSourceFile(source, fileUrl)) {
            throw new Error('Neocities creator resource URL is not allowed.');
        }

        await verifySourcePageLink(source, fileUrl);
        const { response, buffer } = await fetchBuffer(fileUrl.toString());
        validateDownloadedBuffer(buffer, resource.resourceType);

        return {
            buffer,
            fileName: getDownloadFileName(fileUrl, resource.resourceType),
            fileType: response.headers.get('content-type') || getDefaultFileType(resource.resourceType),
            resourceType: resource.resourceType,
        };
    },
};

async function readResources() {
    if (Date.now() < cache.expiresAt) {
        return cache.items;
    }

    const pages = await Promise.all(SOURCES.map(readSourcePage));
    cache = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        items: uniqueById(pages.flat()),
    };
    return cache.items;
}

async function readSourcePage(source) {
    try {
        const { text } = await fetchText(source.pageUrl, { timeoutMs: 12000 });
        return extractResourceReferences(text)
            .map(reference => ({ reference, fileUrl: parseAbsoluteUrl(reference.href, source.pageUrl) }))
            .filter(item => item.fileUrl && isAllowedSourceFile(source, item.fileUrl))
            .map(item => convertReferenceToResource(source, item.reference, item.fileUrl))
            .filter(Boolean);
    } catch {
        return [];
    }
}

function convertReferenceToResource(source, reference, fileUrl) {
    const title = getResourceTitle(source, reference, fileUrl);
    const resourceId = JSON.stringify({
        sourceId: source.id,
        fileUrl: fileUrl.toString(),
        resourceType: source.resourceType,
    });

    return {
        id: resourceId,
        resourceType: source.resourceType,
        title,
        description: `${source.name} / ${safeDecode(fileUrl.pathname.replace(/^\//u, ''))}`,
        author: source.author,
        sourceUrl: source.pageUrl,
        downloadUrl: fileUrl.toString(),
        thumbnailUrl: source.resourceType === REMOTE_RESOURCE_TYPES.CHARACTER ? fileUrl.toString() : '',
        tags: ['Neocities', source.author, source.tag],
        capabilities: { download: true },
        metadata: {
            sourceId: source.id,
            pageUrl: source.pageUrl,
            fileUrl: fileUrl.toString(),
        },
    };
}

function getResourceTitle(source, reference, fileUrl) {
    const label = stripHtml(reference.label);
    if (source.resourceType === REMOTE_RESOURCE_TYPES.CHARACTER) {
        const parts = fileUrl.pathname.split('/').filter(Boolean);
        return formatTitle(parts.at(-2) || label || path.basename(fileUrl.pathname, path.extname(fileUrl.pathname)));
    }
    return formatTitle(path.basename(fileUrl.pathname, path.extname(fileUrl.pathname)) || label);
}

function isAllowedSourceFile(source, fileUrl) {
    if (source.resourceType === REMOTE_RESOURCE_TYPES.CHARACTER) {
        return isCharHubCardUrl(fileUrl);
    }
    if (source.resourceType === REMOTE_RESOURCE_TYPES.PRESET) {
        return fileUrl.origin === new URL(source.pageUrl).origin && path.extname(fileUrl.pathname).toLowerCase() === '.json' && (!source.jsonPathPattern || source.jsonPathPattern.test(fileUrl.pathname));
    }
    if (source.resourceType === REMOTE_RESOURCE_TYPES.WORLDBOOK) {
        return fileUrl.origin === new URL(source.pageUrl).origin && path.extname(fileUrl.pathname).toLowerCase() === '.json' && (!source.jsonPathPattern || source.jsonPathPattern.test(fileUrl.pathname));
    }
    return false;
}

async function verifySourcePageLink(source, fileUrl) {
    const { text } = await fetchText(source.pageUrl, { timeoutMs: 12000 });
    const linked = extractResourceReferences(text)
        .map(reference => parseAbsoluteUrl(reference.href, source.pageUrl))
        .some(url => url?.toString() === fileUrl.toString());
    if (!linked) {
        throw new Error('Neocities creator resource is not linked from the source page.');
    }
}

function validateDownloadedBuffer(buffer, resourceType) {
    if (resourceType === REMOTE_RESOURCE_TYPES.CHARACTER) {
        if (!isPng(buffer)) {
            throw new Error('Neocities creator character resource is not a PNG file.');
        }
        if (!hasCharacterCardText(buffer)) {
            throw new Error('Neocities creator PNG does not contain character card metadata.');
        }
        return;
    }

    const json = parseJsonBuffer(buffer);
    if (resourceType === REMOTE_RESOURCE_TYPES.WORLDBOOK && !isWorldbookJson(json)) {
        throw new Error('Neocities creator JSON does not contain SillyTavern worldbook entries.');
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
        throw new Error(`Neocities creator JSON is invalid: ${error.message}`);
    }
}

function isWorldbookJson(json) {
    const entries = json?.entries;
    const values = Array.isArray(entries) ? entries : entries && typeof entries === 'object' ? Object.values(entries) : [];
    return values.some(entry => entry && typeof entry === 'object' && Array.isArray(entry.key) && entry.key.length && typeof entry.content === 'string' && entry.content.trim());
}

function parseResourceId(value) {
    try {
        const parsed = JSON.parse(String(value || ''));
        return {
            sourceId: String(parsed.sourceId || ''),
            fileUrl: String(parsed.fileUrl || ''),
            resourceType: String(parsed.resourceType || ''),
        };
    } catch {
        throw new Error('Neocities creator resource ID is invalid.');
    }
}

function getSource(sourceId) {
    return SOURCES.find(source => source.id === sourceId);
}

function extractResourceReferences(html) {
    return [
        ...extractAnchors(html),
        ...extractImages(html),
    ];
}

function extractAnchors(html) {
    const anchors = [];
    const pattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/giu;
    for (const match of String(html || '').matchAll(pattern)) {
        anchors.push({
            href: match[2],
            label: match[3],
        });
    }
    return anchors;
}

function extractImages(html) {
    const images = [];
    const pattern = /<img\b([^>]*)>/giu;
    for (const match of String(html || '').matchAll(pattern)) {
        const src = getAttribute(match[1], 'src');
        if (!src) {
            continue;
        }
        images.push({
            href: src,
            label: getAttribute(match[1], 'alt') || '',
        });
    }
    return images;
}

function getAttribute(attrs, name) {
    const pattern = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'iu');
    return pattern.exec(attrs)?.[2] || '';
}

function parseAbsoluteUrl(value, baseUrl) {
    try {
        const url = new URL(String(value || ''), baseUrl);
        if (!['http:', 'https:'].includes(url.protocol)) {
            return null;
        }
        return url;
    } catch {
        return null;
    }
}

function isCharHubCardUrl(url) {
    return url.protocol === 'https:' && url.hostname === CHARHUB_AVATAR_HOST && CHARHUB_CARD_PATH_PATTERN.test(url.pathname);
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

function getDownloadFileName(fileUrl, resourceType) {
    const fallback = resourceType === REMOTE_RESOURCE_TYPES.CHARACTER ? 'neocities-character.png' : resourceType === REMOTE_RESOURCE_TYPES.WORLDBOOK ? 'neocities-worldbook.json' : 'neocities-preset.json';
    return safeDecode(path.basename(fileUrl.pathname)) || fallback;
}

function getDefaultFileType(resourceType) {
    return resourceType === REMOTE_RESOURCE_TYPES.CHARACTER ? 'image/png' : 'application/json';
}

function formatTitle(value) {
    return safeDecode(value).replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ').replace(/\.(png|json)$/iu, '').trim() || 'Untitled';
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
