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

const LIST_URL = 'https://rentry.org/charcardrentrylist';
const INDEX_URL = 'https://aicg.neocities.org/bots';
const CACHE_MS = 30 * 60 * 1000;
const CATBOX_PNG_PATTERN = /^https:\/\/files\.catbox\.moe\/[^?#]+\.png(?:[?#].*)?$/iu;

let cache = {
    expiresAt: 0,
    items: [],
};

export const aicgRentryDirectoryProvider = {
    id: 'aicg-rentry-directory',
    name: 'AICG Rentry Directory',
    description: 'AICG bots 索引指向的 Character Cards Rentry List，匿名解析 Botmaker 表格中的 Catbox PNG 角色卡。',
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
            throw new Error('AICG Rentry Directory resource type mismatch.');
        }

        const url = parseCatboxPngUrl(resource.url);
        const { response, buffer } = await fetchBuffer(url.toString(), { timeoutMs: 60000 });
        if (!isPng(buffer) || !hasCharacterCardText(buffer)) {
            throw new Error('AICG Rentry Directory PNG does not contain character card metadata.');
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

    const { text } = await fetchText(LIST_URL, { timeoutMs: 30000 });
    cache = {
        expiresAt: Date.now() + CACHE_MS,
        items: parseDirectory(text),
    };
    return cache.items;
}

function parseDirectory(html) {
    const resources = [];
    const rows = [...String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].map(match => match[1]);
    let headers = [];

    for (const row of rows) {
        const headerCells = extractCells(row, 'th').map(cell => stripHtml(cell));
        if (headerCells.length) {
            headers = headerCells;
            continue;
        }

        const cells = extractCells(row, 'td');
        if (cells.length < 3 || headers.length < 3) {
            continue;
        }

        resources.push(...extractRowResources(headers, cells));
    }

    return uniqueById(resources);
}

function extractRowResources(headers, cells) {
    const botmaker = stripHtml(cells[0]);
    const botmakerUrl = getFirstLink(cells[0]) || LIST_URL;
    const category = stripHtml(cells[1]);
    const resources = [];

    for (let index = 2; index < cells.length; index++) {
        const section = headers[index] || '';
        for (const link of extractCatboxLinks(cells[index])) {
            const title = stripHtml(link.label) || formatTitleFromUrl(link.url);
            resources.push({
                id: formatResourceId(link.url),
                resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
                title,
                description: truncateText([category ? `Category: ${category}` : '', botmaker ? `Botmaker: ${botmaker}` : '', section ? `Section: ${section}` : ''].filter(Boolean).join(' · '), 360),
                author: botmaker,
                sourceUrl: botmakerUrl,
                downloadUrl: link.url,
                thumbnailUrl: link.url,
                tags: ['AICG', 'Rentry Directory', category, section].filter(Boolean),
                capabilities: { download: true },
                metadata: {
                    directoryUrl: LIST_URL,
                    indexUrl: INDEX_URL,
                    fileUrl: link.url,
                    category,
                    section,
                },
            });
        }
    }

    return resources;
}

function extractCells(row, tagName) {
    const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'giu');
    return [...String(row || '').matchAll(pattern)].map(match => match[1]);
}

function getFirstLink(html) {
    const href = /<a\b[^>]*href=(["'])(.*?)\1/iu.exec(String(html || ''))?.[2] || '';
    try {
        return new URL(decode(href), LIST_URL).toString();
    } catch {
        return '';
    }
}

function extractCatboxLinks(html) {
    const links = [];
    const pattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/giu;
    for (const match of String(html || '').matchAll(pattern)) {
        const url = normalizeCatboxUrl(match[2]);
        if (!url) {
            continue;
        }
        links.push({ url, label: match[3] });
    }
    return links;
}

function normalizeCatboxUrl(value) {
    try {
        const url = new URL(decode(String(value || '').trim()));
        url.hash = '';
        if (url.protocol === 'http:' && url.hostname === 'files.catbox.moe') {
            url.protocol = 'https:';
        }
        if (CATBOX_PNG_PATTERN.test(url.toString())) {
            return url.toString();
        }
    } catch {
        return '';
    }
    return '';
}

function parseResourceId(resourceId) {
    try {
        const parsed = JSON.parse(String(resourceId || ''));
        return {
            url: String(parsed.url || ''),
            resourceType: String(parsed.resourceType || REMOTE_RESOURCE_TYPES.CHARACTER),
        };
    } catch {
        return {
            url: String(resourceId || ''),
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    }
}

function formatResourceId(url) {
    return JSON.stringify({ url, resourceType: REMOTE_RESOURCE_TYPES.CHARACTER });
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
    throw new Error('AICG Rentry Directory PNG URL is invalid.');
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
    return fileName || 'aicg-rentry-directory-card.png';
}

function formatTitleFromUrl(url) {
    try {
        return path.basename(new URL(url).pathname, '.png') || 'AICG Rentry card';
    } catch {
        return 'AICG Rentry card';
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
