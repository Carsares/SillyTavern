import path from 'node:path';

import { decode } from 'html-entities';
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

const BASE_URL = 'https://rentry.org';
const CACHE_MS = 30 * 60 * 1000;
const SOURCES = Object.freeze([
    { slug: 'aicgweeklytheme', label: '/aicg/ Weekly Themes' },
    { slug: 'botmakersecretsanta3', label: '/AICG/ Secret Santa 2025' },
    { slug: 'secretvalentines2026public', label: '/aicg/ Secret Valentine 2026 Public' },
    { slug: 'secretvalentines2026private', label: '/aicg/ Secret Valentine 2026 Private' },
    { slug: 'aicgwhiteday2026', label: '/aicg/ White Day 2026' },
]);
const RESOURCE_HEADER_PATTERN = /^(?:card|links?|link\(s\)|bots)$/iu;
const CATBOX_PNG_PATTERN = /https:\/\/files\.catbox\.moe\/[^\s"'<>]+\.png(?:[?#][^\s"'<>]*)?/giu;

let cache = {
    expiresAt: 0,
    items: [],
};

export const aicgRentryEventsProvider = {
    id: 'aicg-rentry-events',
    name: 'AICG Rentry Events',
    description: 'AICG 活动 Rentry 表格索引，匿名读取固定活动页中的 Catbox PNG 角色卡候选，下载时校验 chara/ccv3 元数据。',
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
        const resource = parseResourceId(params.resourceId);
        if (params.resourceType && params.resourceType !== resource.resourceType) {
            throw new Error('AICG Rentry resource type mismatch.');
        }

        const url = parseCatboxPngUrl(resource.url);
        const { response, buffer } = await fetchBuffer(url.toString(), { timeoutMs: 60000 });
        if (!isPng(buffer) || !hasCharacterCardText(buffer)) {
            throw new Error('AICG Rentry PNG does not contain character card metadata.');
        }

        return {
            buffer,
            fileName: getDownloadFileName(url),
            fileType: response.headers.get('content-type') || 'image/png',
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    },
};

async function readResources() {
    if (Date.now() < cache.expiresAt) {
        return cache.items;
    }

    const pages = await Promise.all(SOURCES.map(readSourcePage));
    cache = {
        expiresAt: Date.now() + CACHE_MS,
        items: uniqueById(pages.flat()),
    };
    return cache.items;
}

async function readSourcePage(source) {
    const pageUrl = `${BASE_URL}/${source.slug}`;
    try {
        const { text } = await fetchText(pageUrl, { timeoutMs: 20000 });
        return extractTableResources(text, source, pageUrl);
    } catch {
        return [];
    }
}

function extractTableResources(html, source, pageUrl) {
    const rows = [...String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].map(match => match[1]);
    const resources = [];
    let headers = [];

    for (const row of rows) {
        const headerCells = extractCells(row, 'th').map(cell => stripHtml(cell));
        if (headerCells.length) {
            headers = headerCells;
            continue;
        }

        const cells = extractCells(row, 'td');
        if (!cells.length || !headers.length) {
            continue;
        }

        for (const candidate of extractRowCandidates(row, headers, cells, source, pageUrl)) {
            resources.push(candidate);
        }
    }

    return resources;
}

function extractRowCandidates(row, headers, cells, source, pageUrl) {
    const resources = [];
    const resourceCells = cells.filter((_, index) => RESOURCE_HEADER_PATTERN.test(headers[index] || ''));
    const urls = uniqueValues(resourceCells.flatMap(cell => extractCatboxPngUrls(cell)));

    for (const url of urls) {
        const title = getResourceTitle(row, url, headers, cells);
        const author = getColumnValue(headers, cells, 'From') || getColumnValue(headers, cells, 'Botmaker');
        const description = truncateText(getDescription(headers, cells), 520);
        resources.push({
            id: formatResourceId(url, source.slug),
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
            title,
            description,
            author,
            sourceUrl: pageUrl,
            downloadUrl: url,
            thumbnailUrl: url,
            tags: ['AICG', 'Rentry', source.label].filter(Boolean),
            capabilities: { download: true },
            metadata: {
                page: source.slug,
                pageTitle: source.label,
                fileUrl: url,
            },
        });
    }

    return resources;
}

function extractCells(row, tagName) {
    const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'giu');
    return [...String(row || '').matchAll(pattern)].map(match => match[1]);
}

function extractCatboxPngUrls(html) {
    return [...String(html || '').matchAll(CATBOX_PNG_PATTERN)].map(match => match[0]);
}

function getResourceTitle(row, url, headers, cells) {
    return getImageTitle(row, url)
        || getColumnValue(headers, cells, 'Name')
        || getColumnTitle(headers, cells, 'Card')
        || getLinkCellTitle(cells, url)
        || formatTitleFromUrl(url);
}

function getImageTitle(row, url) {
    for (const match of String(row || '').matchAll(/<img\b[^>]*src=(["'])(.*?)\1[^>]*>/giu)) {
        if (decode(match[2]) !== url) {
            continue;
        }

        const tag = match[0];
        return decode(/\btitle=(["'])(.*?)\1/iu.exec(tag)?.[2] || /\balt=(["'])(.*?)\1/iu.exec(tag)?.[2] || '').trim();
    }
    return '';
}

function getColumnValue(headers, cells, name) {
    const index = headers.findIndex(header => header.toLowerCase() === name.toLowerCase());
    if (index < 0 || !cells[index]) {
        return '';
    }
    return stripHtml(cells[index]);
}

function getColumnTitle(headers, cells, name) {
    const value = getColumnValue(headers, cells, name);
    return cleanResourceTitle(value);
}

function getLinkCellTitle(cells, url) {
    const cell = cells.find(item => item.includes(url));
    return cleanResourceTitle(stripHtml(cell || ''));
}

function cleanResourceTitle(value) {
    const text = String(value || '')
        .replace(/\b(?:CHUB|Chub|CAT|Catbox|Cardview|IMG|Links?)\b/gu, ' ')
        .replace(/\([^)]*\)/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    if (!text) {
        return '';
    }

    return text.split(/[,;|]/u).map(part => part.trim()).filter(Boolean).at(-1) || text;
}

function getDescription(headers, cells) {
    const preferred = getColumnValue(headers, cells, 'Desc') || getColumnValue(headers, cells, 'Description') || getColumnValue(headers, cells, 'Request') || getColumnValue(headers, cells, 'Request (summarized)');
    return preferred || stripHtml(cells.join(' '));
}

function formatTitleFromUrl(url) {
    try {
        return path.basename(new URL(url).pathname, '.png').replace(/[-_]+/gu, ' ').trim() || 'AICG event card';
    } catch {
        return 'AICG event card';
    }
}

function parseResourceId(resourceId) {
    try {
        const parsed = JSON.parse(String(resourceId || ''));
        return {
            url: String(parsed.url || ''),
            page: String(parsed.page || ''),
            resourceType: String(parsed.resourceType || REMOTE_RESOURCE_TYPES.CHARACTER),
        };
    } catch {
        return {
            url: String(resourceId || ''),
            page: '',
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    }
}

function formatResourceId(url, page) {
    return JSON.stringify({ url, page, resourceType: REMOTE_RESOURCE_TYPES.CHARACTER });
}

function parseCatboxPngUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        if (url.protocol === 'https:' && url.hostname === 'files.catbox.moe' && path.extname(url.pathname).toLowerCase() === '.png') {
            return url;
        }
    } catch {
        // Continue to the uniform error below.
    }
    throw new Error('AICG Rentry resource ID is invalid.');
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

function getDownloadFileName(url) {
    const fileName = path.basename(url.pathname);
    return fileName || 'aicg-rentry-card.png';
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

function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))];
}
