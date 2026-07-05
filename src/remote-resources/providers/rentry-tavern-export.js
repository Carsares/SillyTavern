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

const INDEX_URL = 'https://rentry.org/tavern_export';
const CACHE_MS = 60 * 60 * 1000;
const CATBOX_PNG_PATTERN = /https:\/\/files\.catbox\.moe\/[^\s"'<>]+\.png(?:[?#][^\s"'<>]*)?/giu;

let cache = {
    expiresAt: 0,
    items: [],
};

export const rentryTavernExportProvider = {
    id: 'rentry-tavern-export',
    name: 'Rentry Tavern Export',
    description: '旧 Booru.plus TavernAI 导出镜像，匿名读取 tavern_export 索引和单卡 Rentry 页，下载 Catbox PNG 角色卡。',
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
            throw new Error('Rentry Tavern Export resource type mismatch.');
        }

        const rentryUrl = parseRentryCardUrl(resource.rentryUrl);
        const { text } = await fetchText(rentryUrl.toString(), { timeoutMs: 20000 });
        const pngUrls = extractCatboxPngUrls(text);
        if (!pngUrls.length) {
            throw new Error('Rentry Tavern Export card PNG was not found.');
        }

        for (const pngUrl of pngUrls) {
            const url = parseCatboxPngUrl(pngUrl);
            const { response, buffer } = await fetchBuffer(url.toString(), { timeoutMs: 60000 });
            if (isPng(buffer) && hasCharacterCardText(buffer)) {
                return {
                    buffer,
                    fileName: getDownloadFileName(url),
                    fileType: response.headers.get('content-type') || 'image/png',
                    resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
                };
            }
        }

        throw new Error('Rentry Tavern Export PNG does not contain character card metadata.');
    },
};

async function readResources() {
    if (Date.now() < cache.expiresAt) {
        return cache.items;
    }

    const { text } = await fetchText(INDEX_URL, { timeoutMs: 30000 });
    cache = {
        expiresAt: Date.now() + CACHE_MS,
        items: parseIndex(text),
    };
    return cache.items;
}

function parseIndex(html) {
    const text = extractEntryText(html);
    const resources = [];
    const pattern = /Name:\s*([\s\S]*?)\nAuthor:\s*([\s\S]*?)\nKeywords:\s*'([\s\S]*?)'\nRentry:\s*(https:\/\/rentry\.(?:co|org)\/[^\s]+)/giu;
    for (const match of text.matchAll(pattern)) {
        const title = cleanText(match[1]);
        const author = cleanText(match[2]);
        const tags = match[3].split(',').map(tag => tag.trim()).filter(Boolean);
        const rentryUrl = normalizeRentryUrl(match[4]);
        if (!title || !rentryUrl) {
            continue;
        }

        resources.push({
            id: formatResourceId(rentryUrl),
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
            title,
            description: truncateText(tags.length ? `Keywords: ${tags.join(', ')}` : '', 360),
            author,
            sourceUrl: rentryUrl,
            downloadUrl: rentryUrl,
            thumbnailUrl: '',
            tags: ['Rentry Tavern Export', ...tags].filter(Boolean),
            capabilities: { download: true },
            metadata: {
                rentryUrl,
                keywords: tags,
            },
        });
    }
    return uniqueById(resources);
}

function extractEntryText(html) {
    const entryStart = String(html || '').indexOf('<div class="entry-text"');
    const entry = entryStart >= 0 ? String(html).slice(entryStart) : String(html || '');
    return decode(entry)
        .replace(/<br\s*\/?>/giu, '\n')
        .replace(/<\/p>/giu, '\n')
        .replace(/<[^>]+>/gu, ' ')
        .replace(/\n\s+/gu, '\n')
        .replace(/[ \t]+/gu, ' ')
        .trim();
}

function extractCatboxPngUrls(html) {
    return uniqueValues([...String(html || '').matchAll(CATBOX_PNG_PATTERN)].map(match => match[0]));
}

function parseResourceId(resourceId) {
    try {
        const parsed = JSON.parse(String(resourceId || ''));
        return {
            rentryUrl: String(parsed.rentryUrl || ''),
            resourceType: String(parsed.resourceType || REMOTE_RESOURCE_TYPES.CHARACTER),
        };
    } catch {
        return {
            rentryUrl: String(resourceId || ''),
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    }
}

function formatResourceId(rentryUrl) {
    return JSON.stringify({ rentryUrl, resourceType: REMOTE_RESOURCE_TYPES.CHARACTER });
}

function normalizeRentryUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        if (!['rentry.co', 'rentry.org'].includes(url.hostname)) {
            return '';
        }
        url.hostname = 'rentry.org';
        return url.toString();
    } catch {
        return '';
    }
}

function parseRentryCardUrl(value) {
    try {
        const url = new URL(normalizeRentryUrl(value));
        if (url.hostname === 'rentry.org' && /^\/(?:tavern_card_|test_card)\w+/iu.test(url.pathname)) {
            return url;
        }
    } catch {
        // Continue to the uniform error below.
    }
    throw new Error('Rentry Tavern Export resource ID is invalid.');
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
    throw new Error('Rentry Tavern Export PNG URL is invalid.');
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
    return fileName || 'rentry-tavern-export-card.png';
}

function cleanText(value) {
    return stripHtml(value).replace(/\s+/gu, ' ').trim();
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
