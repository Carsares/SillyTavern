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
    truncateText,
} from './shared.js';

const PAGE_URL = 'https://blobfish23.neocities.org/';
const CACHE_MS = 30 * 60 * 1000;
const CATBOX_HOST = 'files.catbox.moe';

let cache = {
    expiresAt: 0,
    items: [],
};

export const blobfish23NeocitiesProvider = {
    id: 'blobfish23-neocities',
    name: 'Blobfish23 Neocities',
    description: 'Blobfish23 的 Neocities 角色卡和世界书索引，匿名读取首页中的 Chub 来源和 Catbox PNG/JSON 直链。',
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
            throw new Error('Blobfish23 resource type mismatch.');
        }

        const fileUrl = parseCatboxResourceUrl(resource.fileUrl, resource.resourceType);
        await verifySourcePageLink(fileUrl);
        const { response, buffer } = await fetchBuffer(fileUrl.toString(), { timeoutMs: 120000 });
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

    const { text } = await fetchText(PAGE_URL, { timeoutMs: 30000 });
    cache = {
        expiresAt: Date.now() + CACHE_MS,
        items: uniqueById(extractArticles(text).map(convertArticle).filter(Boolean)),
    };
    return cache.items;
}

function extractArticles(html) {
    return [...String(html || '').matchAll(/<article\b[^>]*class=(["'])[^"']*\bbot-card\b[^"']*\1[^>]*>([\s\S]*?)<\/article>/giu)].map(match => match[2]);
}

function convertArticle(article) {
    const title = stripHtml(/<h3\b[^>]*>([\s\S]*?)<\/h3>/iu.exec(article)?.[1] || '');
    const fileUrl = getCatboxDownloadUrl(article);
    if (!title || !fileUrl) {
        return null;
    }

    const resourceType = getResourceType(fileUrl);
    if (!resourceType) {
        return null;
    }

    const chubUrl = getChubUrl(article);
    const thumbnailUrl = getThumbnailUrl(article, resourceType);
    const description = getDescription(article);
    return {
        id: formatResourceId(fileUrl, resourceType),
        resourceType,
        title,
        description,
        author: 'Blobfish23',
        sourceUrl: chubUrl || PAGE_URL,
        downloadUrl: fileUrl,
        thumbnailUrl,
        tags: ['Blobfish23', 'Neocities', 'Catbox', resourceType === REMOTE_RESOURCE_TYPES.WORLDBOOK ? 'Worldbook' : 'Character'],
        capabilities: { download: true },
        metadata: {
            pageUrl: PAGE_URL,
            fileUrl,
            chubUrl,
        },
    };
}

function getCatboxDownloadUrl(article) {
    const links = extractLinks(article)
        .map(link => parseAbsoluteUrl(link.href))
        .filter(Boolean)
        .map(url => url.toString());
    return links.find(url => isCatboxResourceUrl(url, REMOTE_RESOURCE_TYPES.CHARACTER) || isCatboxResourceUrl(url, REMOTE_RESOURCE_TYPES.WORLDBOOK)) || '';
}

function getChubUrl(article) {
    const link = extractLinks(article)
        .map(item => parseAbsoluteUrl(item.href))
        .find(url => url && url.hostname === 'chub.ai');
    return link?.toString() || '';
}

function getThumbnailUrl(article, resourceType) {
    const src = getAttribute(/<img\b([^>]*)>/iu.exec(article)?.[1] || '', 'src');
    const url = parseAbsoluteUrl(src);
    if (!url) {
        return '';
    }
    if (resourceType === REMOTE_RESOURCE_TYPES.CHARACTER && isCatboxResourceUrl(url.toString(), REMOTE_RESOURCE_TYPES.CHARACTER)) {
        return url.toString();
    }
    return url.hostname === CATBOX_HOST && path.extname(url.pathname).toLowerCase() === '.png' ? url.toString() : '';
}

function getDescription(article) {
    const paragraphs = [...String(article || '').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)]
        .map(match => stripHtml(match[1]))
        .filter(Boolean);
    return truncateText(paragraphs.join(' '), 520);
}

function extractLinks(html) {
    const links = [];
    const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu;
    for (const match of String(html || '').matchAll(pattern)) {
        const href = getAttribute(match[1], 'href');
        if (href) {
            links.push({ href, label: match[2] });
        }
    }
    return links;
}

function getAttribute(attrs, name) {
    const pattern = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'iu');
    return pattern.exec(String(attrs || ''))?.[2] || '';
}

function getResourceType(fileUrl) {
    if (isCatboxResourceUrl(fileUrl, REMOTE_RESOURCE_TYPES.CHARACTER)) {
        return REMOTE_RESOURCE_TYPES.CHARACTER;
    }
    if (isCatboxResourceUrl(fileUrl, REMOTE_RESOURCE_TYPES.WORLDBOOK)) {
        return REMOTE_RESOURCE_TYPES.WORLDBOOK;
    }
    return '';
}

function parseAbsoluteUrl(value) {
    try {
        const url = new URL(String(value || ''), PAGE_URL);
        if (!['http:', 'https:'].includes(url.protocol)) {
            return null;
        }
        return url;
    } catch {
        return null;
    }
}

function parseResourceId(value) {
    try {
        const parsed = JSON.parse(String(value || ''));
        return {
            fileUrl: String(parsed.fileUrl || ''),
            resourceType: String(parsed.resourceType || ''),
        };
    } catch {
        throw new Error('Blobfish23 resource ID is invalid.');
    }
}

function formatResourceId(fileUrl, resourceType) {
    return JSON.stringify({ fileUrl, resourceType });
}

function parseCatboxResourceUrl(value, resourceType) {
    try {
        const url = new URL(String(value || '').trim());
        if (isCatboxResourceUrl(url.toString(), resourceType)) {
            return url;
        }
    } catch {
        // Continue to the uniform error below.
    }
    throw new Error('Blobfish23 resource URL is invalid.');
}

function isCatboxResourceUrl(value, resourceType) {
    try {
        const url = new URL(String(value || ''));
        const extension = path.extname(url.pathname).toLowerCase();
        if (url.protocol !== 'https:' || url.hostname !== CATBOX_HOST) {
            return false;
        }
        if (resourceType === REMOTE_RESOURCE_TYPES.CHARACTER) {
            return extension === '.png';
        }
        if (resourceType === REMOTE_RESOURCE_TYPES.WORLDBOOK) {
            return extension === '.json';
        }
    } catch {
        return false;
    }
    return false;
}

async function verifySourcePageLink(fileUrl) {
    const { text } = await fetchText(PAGE_URL, { timeoutMs: 30000 });
    const linked = extractLinks(text)
        .map(link => parseAbsoluteUrl(link.href))
        .some(url => url?.toString() === fileUrl.toString());
    if (!linked) {
        throw new Error('Blobfish23 resource is not linked from the source page.');
    }
}

function validateDownloadedBuffer(buffer, resourceType) {
    if (resourceType === REMOTE_RESOURCE_TYPES.CHARACTER) {
        if (!isPng(buffer) || !hasCharacterCardText(buffer)) {
            throw new Error('Blobfish23 PNG does not contain character card metadata.');
        }
        return;
    }

    const json = parseJsonBuffer(buffer);
    if (resourceType === REMOTE_RESOURCE_TYPES.WORLDBOOK && !isWorldbookJson(json)) {
        throw new Error('Blobfish23 JSON does not contain SillyTavern worldbook entries.');
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
        throw new Error(`Blobfish23 JSON is invalid: ${error.message}`);
    }
}

function isWorldbookJson(json) {
    const entries = json?.entries;
    const values = Array.isArray(entries) ? entries : entries && typeof entries === 'object' ? Object.values(entries) : [];
    return values.some(entry => entry && typeof entry === 'object' && Array.isArray(entry.key) && entry.key.length && typeof entry.content === 'string' && entry.content.trim());
}

function isPng(buffer) {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function hasCharacterCardText(buffer) {
    try {
        return extractChunks(new Uint8Array(buffer))
            .filter(chunk => chunk.name === 'tEXt')
            .map(chunk => PNGtext.decode(chunk.data))
            .some(chunk => ['chara', 'ccv3'].includes(String(chunk.keyword || '').toLowerCase()) && chunk.text);
    } catch {
        return false;
    }
}

function getDownloadFileName(fileUrl, resourceType) {
    const fallback = resourceType === REMOTE_RESOURCE_TYPES.WORLDBOOK ? 'blobfish23-worldbook.json' : 'blobfish23-character.png';
    return path.basename(fileUrl.pathname) || fallback;
}

function getDefaultFileType(resourceType) {
    return resourceType === REMOTE_RESOURCE_TYPES.WORLDBOOK ? 'application/json' : 'image/png';
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
