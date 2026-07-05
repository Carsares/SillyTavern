import path from 'node:path';

import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchBuffer,
    fetchText,
    formatRemoteResource,
    getPageOffset,
    stripHtml,
} from './shared.js';

const INDEX_URL = 'https://chatbots.neocities.org/';
const CACHE_MS = 10 * 60 * 1000;
const MAX_MEMBER_PAGES = 60;
const MEMBER_FETCH_CONCURRENCY = 8;
const NEOCITIES_HOST_SUFFIX = '.neocities.org';
const JSON_PRESET_PATH_PATTERN = /\/(prompts?|presets?|novelrp|settings?)\//iu;
const CARD_PATH_PATTERN = /\/(cards?|characters?|bots?)\//iu;

let cachedResources = null;
let cachedAt = 0;

export const chatbotsWebringProvider = {
    id: 'chatbots-webring',
    name: 'Chatbots Webring',
    description: 'Chatbots Webring 静态创作者站点索引，匿名抓取同源角色卡 PNG 与预设 JSON。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        const limit = clampLimit(params.limit);
        const offset = getPageOffset(params.page, limit);
        const resources = await readWebringResources();
        const items = resources
            .filter(item => !params.resourceType || item.resourceType === params.resourceType)
            .filter(item => matchesWebringQuery(item, params.query));

        return {
            items: items.slice(offset, offset + limit).map(item => formatRemoteResource(this, item)),
            total: items.length,
        };
    },

    async download(params) {
        const resource = parseResourceId(params.resourceId);
        if (params.resourceType && params.resourceType !== resource.resourceType) {
            throw new Error(`Chatbots Webring resource type mismatch: expected ${resource.resourceType}.`);
        }
        validateResourceUrls(resource);

        const { response, buffer } = await fetchBuffer(resource.fileUrl);
        validateDownloadedBuffer(buffer, resource.resourceType, resource.fileUrl);

        return {
            buffer,
            fileName: getDownloadFileName(resource.fileUrl, resource.resourceType),
            fileType: response.headers.get('content-type') || getDefaultFileType(resource.resourceType),
            resourceType: resource.resourceType,
        };
    },
};

async function readWebringResources() {
    if (cachedResources && Date.now() - cachedAt < CACHE_MS) {
        return cachedResources;
    }

    const { text } = await fetchText(INDEX_URL, { timeoutMs: 12000 });
    const memberUrls = extractMemberUrls(text);
    const pageResults = await mapWithLimit(memberUrls.slice(0, MAX_MEMBER_PAGES), MEMBER_FETCH_CONCURRENCY, readMemberPage);
    cachedResources = uniqueById(pageResults.flat());
    cachedAt = Date.now();
    return cachedResources;
}

async function readMemberPage(url) {
    try {
        const { text } = await fetchText(url, { timeoutMs: 12000 });
        const siteTitle = stripHtml(text.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1] || getSiteAuthor(url));
        return extractDownloadLinks(text, url, siteTitle);
    } catch {
        return [];
    }
}

function extractMemberUrls(html) {
    return uniqueValues(extractAnchors(html)
        .map(anchor => parseAbsoluteUrl(anchor.href, INDEX_URL))
        .filter(url => url && isMemberHost(url))
        .map(url => {
            url.hash = '';
            return url.toString();
        }));
}

function extractDownloadLinks(html, pageUrl, siteTitle) {
    const page = new URL(pageUrl);
    return extractAnchors(html)
        .map(anchor => ({ anchor, url: parseAbsoluteUrl(anchor.href, pageUrl) }))
        .filter(({ url }) => url && url.origin === page.origin)
        .filter(({ url }) => isSupportedFilePath(url.pathname))
        .map(({ anchor, url }) => convertLinkToResource(anchor, url, page, siteTitle))
        .filter(Boolean);
}

function convertLinkToResource(anchor, fileUrl, pageUrl, siteTitle) {
    const resourceType = getResourceTypeFromPath(fileUrl.pathname);
    if (!resourceType) {
        return null;
    }

    const title = formatTitle(stripHtml(anchor.label) || path.basename(fileUrl.pathname, path.extname(fileUrl.pathname)));
    const author = getSiteAuthor(pageUrl.toString());
    return {
        id: formatResourceId(pageUrl.toString(), fileUrl.toString(), resourceType),
        resourceType,
        title,
        description: `${siteTitle || author} / ${safeDecode(fileUrl.pathname.replace(/^\//u, ''))}`,
        author,
        sourceUrl: pageUrl.toString(),
        downloadUrl: fileUrl.toString(),
        thumbnailUrl: resourceType === REMOTE_RESOURCE_TYPES.CHARACTER ? fileUrl.toString() : '',
        tags: ['Chatbots Webring', author, resourceType === REMOTE_RESOURCE_TYPES.CHARACTER ? 'PNG card' : 'JSON preset'],
        capabilities: { download: true },
        metadata: {
            pageUrl: pageUrl.toString(),
            fileUrl: fileUrl.toString(),
        },
    };
}

function extractAnchors(html) {
    const anchors = [];
    const pattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/giu;
    for (const match of html.matchAll(pattern)) {
        anchors.push({
            href: match[2],
            label: match[3],
        });
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

function isMemberHost(url) {
    return url.hostname.endsWith(NEOCITIES_HOST_SUFFIX) && url.hostname !== new URL(INDEX_URL).hostname;
}

function isSupportedFilePath(pathname) {
    const ext = path.extname(pathname).toLowerCase();
    if (ext === '.png') {
        return CARD_PATH_PATTERN.test(pathname);
    }
    if (ext === '.json') {
        return CARD_PATH_PATTERN.test(pathname) || JSON_PRESET_PATH_PATTERN.test(pathname);
    }
    return false;
}

function getResourceTypeFromPath(pathname) {
    const ext = path.extname(pathname).toLowerCase();
    if (ext === '.png' && CARD_PATH_PATTERN.test(pathname)) {
        return REMOTE_RESOURCE_TYPES.CHARACTER;
    }
    if (ext === '.json' && CARD_PATH_PATTERN.test(pathname)) {
        return REMOTE_RESOURCE_TYPES.CHARACTER;
    }
    if (ext === '.json' && JSON_PRESET_PATH_PATTERN.test(pathname)) {
        return REMOTE_RESOURCE_TYPES.PRESET;
    }
    return '';
}

function formatResourceId(pageUrl, fileUrl, resourceType) {
    return JSON.stringify({ pageUrl, fileUrl, resourceType });
}

function parseResourceId(value) {
    try {
        const parsed = JSON.parse(String(value || ''));
        return {
            pageUrl: String(parsed.pageUrl || ''),
            fileUrl: String(parsed.fileUrl || ''),
            resourceType: String(parsed.resourceType || ''),
        };
    } catch {
        throw new Error('Chatbots Webring resource ID is invalid.');
    }
}

function validateResourceUrls(resource) {
    const pageUrl = parseAbsoluteUrl(resource.pageUrl, INDEX_URL);
    const fileUrl = parseAbsoluteUrl(resource.fileUrl, INDEX_URL);
    if (!pageUrl || !fileUrl || !isMemberHost(pageUrl) || fileUrl.origin !== pageUrl.origin || !isSupportedFilePath(fileUrl.pathname)) {
        throw new Error('Chatbots Webring resource URL is not allowed.');
    }
    if (![REMOTE_RESOURCE_TYPES.CHARACTER, REMOTE_RESOURCE_TYPES.PRESET].includes(resource.resourceType)) {
        throw new Error('Chatbots Webring resource type is invalid.');
    }
}

function validateDownloadedBuffer(buffer, resourceType, fileUrl) {
    const ext = path.extname(new URL(fileUrl).pathname).toLowerCase();
    if (ext === '.png') {
        const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
        if (!isPng || resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            throw new Error('Chatbots Webring character card is not a PNG file.');
        }
        return;
    }

    try {
        const json = JSON.parse(buffer.toString('utf8'));
        if (!json || typeof json !== 'object' || Array.isArray(json)) {
            throw new Error('root is not an object');
        }
    } catch (error) {
        throw new Error(`Chatbots Webring JSON is invalid: ${error.message}`);
    }
}

function getDownloadFileName(fileUrl, resourceType) {
    const parsed = new URL(fileUrl);
    const fallback = resourceType === REMOTE_RESOURCE_TYPES.CHARACTER ? 'webring-character.png' : 'webring-preset.json';
    return safeDecode(path.basename(parsed.pathname)) || fallback;
}

function getDefaultFileType(resourceType) {
    return resourceType === REMOTE_RESOURCE_TYPES.CHARACTER ? 'image/png' : 'application/json';
}

function matchesWebringQuery(item, query) {
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

function getSiteAuthor(url) {
    try {
        return new URL(url).hostname.replace(NEOCITIES_HOST_SUFFIX, '');
    } catch {
        return 'neocities';
    }
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
