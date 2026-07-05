import path from 'node:path';

import extractChunks from 'png-chunks-extract';
import PNGtext from 'png-chunk-text';

import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchBuffer,
    fetchJson,
    fetchText,
    formatRemoteResource,
    getPageOffset,
    stripHtml,
    truncateText,
} from './shared.js';

const BASE_URL = 'https://partyintheanchorhold.neocities.org';
const CONFIG_URL = `${BASE_URL}/config.json`;
const CACHE_MS = 30 * 60 * 1000;
const PAGE_FETCH_CONCURRENCY = 12;
const CATBOX_HOSTS = new Set(['files.catbox.moe', 'litter.catbox.moe']);
const FILE_GARDEN_HOST = 'file.garden';
const CHARHUB_AVATAR_HOST = 'avatars.charhub.io';
const CHARHUB_CARD_PATH_PATTERN = /^\/avatars\/(?!lorebooks\/|edit_character\/)[^/]+\/[^/]+\/chara_card_v[23]\.png$/iu;
const NEOCITIES_CARD_PATH_PATTERN = /\/cards?\/.+\.png$/iu;

let cache = {
    expiresAt: 0,
    items: [],
};

export const anchorholdAicgProvider = {
    id: 'anchorhold-aicg',
    name: 'Anchorhold /AICG Feed',
    description: 'Anchorhold 静态 /aicg/ 发卡聚合索引，匿名读取分页 HTML，只返回可下载 PNG 角色卡直链。',
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
        const matched = resources.filter(item => matchesAnchorholdQuery(item, params.query));

        return {
            items: matched.slice(offset, offset + limit).map(item => formatRemoteResource(this, item)),
            total: matched.length,
        };
    },

    async download(params) {
        const resource = parseResourceId(params.resourceId);
        if (params.resourceType && params.resourceType !== resource.resourceType) {
            throw new Error('Anchorhold resource type mismatch.');
        }

        const url = parseAllowedCardUrl(resource.url);
        if (!url) {
            throw new Error('Anchorhold card URL is not allowed.');
        }

        const { response, buffer } = await fetchBuffer(url.toString());
        if (!isPng(buffer) || !hasCharacterCardText(buffer)) {
            throw new Error('Anchorhold PNG does not contain character card metadata.');
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

    const { json: config } = await fetchJson(CONFIG_URL, { timeoutMs: 12000 });
    const totalPages = Number(config?.total_pages) || 0;
    if (!totalPages) {
        cache = { expiresAt: Date.now() + CACHE_MS, items: [] };
        return cache.items;
    }

    const pages = Array.from({ length: totalPages }, (_, index) => totalPages - index);
    const pageResources = await mapWithLimit(pages, PAGE_FETCH_CONCURRENCY, readFeedPage);
    cache = {
        expiresAt: Date.now() + CACHE_MS,
        items: uniqueById(pageResources.flat()),
    };
    return cache.items;
}

async function readFeedPage(page) {
    try {
        const pageUrl = `${BASE_URL}/feed/page_${page}.html`;
        const { text } = await fetchText(pageUrl, { timeoutMs: 12000 });
        return extractPostResources(text, pageUrl, page);
    } catch {
        return [];
    }
}

function extractPostResources(html, pageUrl, page) {
    const resources = [];
    const pattern = /<div class="post\s+([^"]+)">\s*<div class="post-content">([\s\S]*?)<\/div>\s*<div class="post-image">\s*<img src="([^"]*)"/giu;
    for (const match of String(html || '').matchAll(pattern)) {
        const [, board, content, imageSrc] = match;
        const heading = extractHeading(content);
        const postSourceUrl = heading.sourceUrl || pageUrl;
        const references = extractResourceReferences(content, imageSrc, pageUrl);
        for (const reference of references) {
            const title = getResourceTitle(reference.url, content) || formatTitleFromUrl(reference.url);
            const postText = stripHtml(content);
            resources.push({
                id: formatResourceId(reference.url, postSourceUrl),
                resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
                title,
                description: truncateText(postText, 520),
                author: getAuthor(reference.url),
                sourceUrl: postSourceUrl,
                downloadUrl: reference.url,
                thumbnailUrl: reference.url,
                tags: ['Anchorhold', board, getSourceTag(reference.url)].filter(Boolean),
                updatedAt: heading.date || '',
                capabilities: { download: true },
                metadata: {
                    page,
                    board,
                    post: heading.post || '',
                    fileUrl: reference.url,
                },
            });
        }
    }
    return resources;
}

function extractHeading(content) {
    const heading = /<h2>([\s\S]*?)<\/h2>/iu.exec(content)?.[1] || '';
    const sourceUrl = /<a\b[^>]*href=(["'])(.*?)\1/iu.exec(heading)?.[2] || '';
    const text = stripHtml(heading);
    const post = /\b(\d{6,})\b/u.exec(text)?.[1] || '';
    const date = /\b(20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\b/u.exec(text)?.[1] || '';
    return {
        post,
        date,
        sourceUrl,
    };
}

function extractResourceReferences(content, imageSrc, pageUrl) {
    const urls = [
        ...extractAnchors(content).map(anchor => parseAbsoluteUrl(anchor.href, pageUrl)),
        parseAbsoluteUrl(imageSrc, pageUrl),
    ].filter(Boolean);

    return uniqueValues(urls.map(url => url.toString()))
        .filter(url => parseAllowedCardUrl(url))
        .map(url => ({ url }));
}

function extractAnchors(html) {
    const anchors = [];
    const pattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/giu;
    for (const match of String(html || '').matchAll(pattern)) {
        anchors.push({ href: match[2], label: match[3] });
    }
    return anchors;
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

function parseAllowedCardUrl(value) {
    const url = parseAbsoluteUrl(value, BASE_URL);
    if (!url || path.extname(url.pathname).toLowerCase() !== '.png') {
        return null;
    }
    if (CATBOX_HOSTS.has(url.hostname) || isFileGardenUrl(url) || isCharHubCardUrl(url) || isNeocitiesCardUrl(url)) {
        return url;
    }
    return null;
}

function isCharHubCardUrl(url) {
    return url.protocol === 'https:' && url.hostname === CHARHUB_AVATAR_HOST && CHARHUB_CARD_PATH_PATTERN.test(url.pathname);
}

function isFileGardenUrl(url) {
    return url.protocol === 'https:' && (url.hostname === FILE_GARDEN_HOST || url.hostname.endsWith('.file.garden') || url.hostname.endsWith('.filegarden.com'));
}

function isNeocitiesCardUrl(url) {
    return url.protocol === 'https:' && url.hostname.endsWith('.neocities.org') && url.hostname !== 'partyintheanchorhold.neocities.org' && NEOCITIES_CARD_PATH_PATTERN.test(url.pathname);
}

function getResourceTitle(fileUrl, content) {
    const segments = splitPostSegments(content);
    const normalizedUrl = safeDecode(fileUrl);
    const segmentIndex = segments.findIndex(segment => segment.includes(fileUrl) || safeDecode(segment).includes(normalizedUrl));
    if (segmentIndex < 0) {
        return '';
    }

    for (let distance = 1; distance <= 2; distance += 1) {
        const before = cleanTitleSegment(segments[segmentIndex - distance]);
        if (before) {
            return before;
        }
        const after = cleanTitleSegment(segments[segmentIndex + distance]);
        if (after) {
            return after;
        }
    }
    return '';
}

function splitPostSegments(content) {
    return String(content || '')
        .replace(/<h2>[\s\S]*?<\/h2>/iu, '')
        .split(/<br\s*\/?>/iu)
        .map(segment => stripHtml(segment))
        .map(segment => segment.replace(/\s+/gu, ' ').trim())
        .filter(Boolean);
}

function cleanTitleSegment(segment) {
    const text = String(segment || '')
        .replace(/^>+\s*/u, '')
        .replace(/^&gt;+\s*/iu, '')
        .trim();
    if (!text || /https?:\/\//iu.test(text) || /^>>?\d+/u.test(text) || text.length < 4) {
        return '';
    }
    return truncateText(text, 80);
}

function formatTitleFromUrl(fileUrl) {
    try {
        const url = new URL(fileUrl);
        if (isCharHubCardUrl(url)) {
            const parts = url.pathname.split('/').filter(Boolean);
            return formatTitle(parts[2] || parts[1] || 'Chub card');
        }
        return formatTitle(path.basename(url.pathname, path.extname(url.pathname)));
    } catch {
        return 'Anchorhold card';
    }
}

function formatTitle(value) {
    return safeDecode(value)
        .replace(/-[0-9a-f]{10,}$/iu, '')
        .replace(/[_-]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim() || 'Anchorhold card';
}

function getAuthor(fileUrl) {
    try {
        const url = new URL(fileUrl);
        if (isCharHubCardUrl(url)) {
            return url.pathname.split('/').filter(Boolean)[1] || 'Chub';
        }
        if (url.hostname.endsWith('.neocities.org')) {
            return url.hostname.replace('.neocities.org', '');
        }
        return url.hostname;
    } catch {
        return 'Anchorhold';
    }
}

function getSourceTag(fileUrl) {
    const url = new URL(fileUrl);
    if (CATBOX_HOSTS.has(url.hostname)) {
        return 'Catbox card';
    }
    if (isCharHubCardUrl(url)) {
        return 'Chub CDN card';
    }
    if (isFileGardenUrl(url)) {
        return 'File Garden card';
    }
    if (isNeocitiesCardUrl(url)) {
        return 'Neocities card';
    }
    return 'PNG card';
}

function formatResourceId(fileUrl, sourceUrl) {
    return JSON.stringify({
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        url: fileUrl,
        sourceUrl,
    });
}

function parseResourceId(value) {
    try {
        const parsed = JSON.parse(String(value || ''));
        return {
            resourceType: String(parsed.resourceType || ''),
            url: String(parsed.url || ''),
        };
    } catch {
        throw new Error('Anchorhold resource ID is invalid.');
    }
}

function matchesAnchorholdQuery(item, query) {
    const tokens = String(query || '').toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
    if (!tokens.length) {
        return true;
    }

    const haystack = [
        item.id,
        item.title,
        item.description,
        item.author,
        ...(Array.isArray(item.tags) ? item.tags : []),
    ].join(' ').toLowerCase();
    return tokens.every(token => haystack.includes(token));
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

function getDownloadFileName(url) {
    return safeDecode(path.basename(url.pathname)) || 'anchorhold-character.png';
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

function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))];
}

async function mapWithLimit(items, limit, mapper) {
    const results = [];
    for (let index = 0; index < items.length; index += limit) {
        const batch = items.slice(index, index + limit);
        results.push(...await Promise.all(batch.map(mapper)));
    }
    return results;
}
