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
    stripHtml,
} from './shared.js';

const INDEX_URL = 'https://chatbots.neocities.org/';
const CACHE_MS = 10 * 60 * 1000;
const MAX_MEMBER_PAGES = 60;
const MAX_MEMBER_SUBPAGES = 4;
const MEMBER_FETCH_CONCURRENCY = 8;
const NEOCITIES_HOST_SUFFIX = '.neocities.org';
const CATBOX_FILE_HOST = 'files.catbox.moe';
const CATBOX_CARD_PATH_PATTERN = /^\/[a-z0-9]+\.png$/iu;
const JSON_PRESET_PATH_PATTERN = /\/(prompts?|presets?|novelrp|settings?)\//iu;
const CARD_PATH_PATTERN = /\/(cards?|characters?|bots?)\//iu;
const MEMBER_SUBPAGE_PATH_PATTERN = /\/[^?#]*(?:cards?|characters?|bots?|mybots)[^/?#]*(?:$|[?#])/iu;

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
        await verifyExternalResourceLink(resource);

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
        const resources = extractDownloadLinks(text, url, siteTitle);
        const subpageUrls = extractMemberSubpageUrls(text, url).slice(0, MAX_MEMBER_SUBPAGES);
        const subpageResults = await Promise.all(subpageUrls.map(subpageUrl => readMemberSubpage(subpageUrl, siteTitle)));
        return [...resources, ...subpageResults.flat()];
    } catch {
        return [];
    }
}

async function readMemberSubpage(url, siteTitle) {
    try {
        const { text } = await fetchText(url, { timeoutMs: 12000 });
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
    return extractResourceReferences(html)
        .map(reference => ({ reference, url: parseAbsoluteUrl(reference.href, pageUrl) }))
        .filter(({ url }) => url && isAllowedFileUrl(url, page))
        .filter(({ url }) => isSupportedFilePath(url))
        .map(({ reference, url }) => convertLinkToResource(reference, url, page, siteTitle))
        .filter(Boolean);
}

function extractMemberSubpageUrls(html, pageUrl) {
    const page = new URL(pageUrl);
    return uniqueValues(extractAnchors(html)
        .map(anchor => parseAbsoluteUrl(anchor.href, pageUrl))
        .filter(url => url && url.origin === page.origin)
        .filter(url => isHtmlLikePath(url.pathname) && MEMBER_SUBPAGE_PATH_PATTERN.test(url.pathname))
        .map(url => {
            url.hash = '';
            return url.toString();
        })
        .filter(url => url !== page.toString()));
}

function convertLinkToResource(reference, fileUrl, pageUrl, siteTitle) {
    const resourceType = getResourceTypeFromPath(fileUrl);
    if (!resourceType) {
        return null;
    }

    const title = formatTitle(stripHtml(reference.label) || path.basename(fileUrl.pathname, path.extname(fileUrl.pathname)));
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
        tags: ['Chatbots Webring', author, isCatboxFileUrl(fileUrl) ? 'Catbox card' : resourceType === REMOTE_RESOURCE_TYPES.CHARACTER ? 'PNG card' : 'JSON preset'],
        capabilities: { download: true },
        metadata: {
            pageUrl: pageUrl.toString(),
            fileUrl: fileUrl.toString(),
        },
    };
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
    for (const match of html.matchAll(pattern)) {
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
    for (const match of html.matchAll(pattern)) {
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

function isMemberHost(url) {
    return url.hostname.endsWith(NEOCITIES_HOST_SUFFIX) && url.hostname !== new URL(INDEX_URL).hostname;
}

function isAllowedFileUrl(fileUrl, pageUrl) {
    return fileUrl.origin === pageUrl.origin || isCatboxFileUrl(fileUrl);
}

function isHtmlLikePath(pathname) {
    const ext = path.extname(pathname).toLowerCase();
    return !ext || ext === '.html' || ext === '.htm';
}

function isSupportedFilePath(fileUrl) {
    const ext = path.extname(fileUrl.pathname).toLowerCase();
    if (ext === '.png') {
        return CARD_PATH_PATTERN.test(fileUrl.pathname) || isCatboxFileUrl(fileUrl);
    }
    if (ext === '.json') {
        return CARD_PATH_PATTERN.test(fileUrl.pathname) || JSON_PRESET_PATH_PATTERN.test(fileUrl.pathname);
    }
    return false;
}

function getResourceTypeFromPath(fileUrl) {
    const ext = path.extname(fileUrl.pathname).toLowerCase();
    if (ext === '.png' && (CARD_PATH_PATTERN.test(fileUrl.pathname) || isCatboxFileUrl(fileUrl))) {
        return REMOTE_RESOURCE_TYPES.CHARACTER;
    }
    if (ext === '.json' && CARD_PATH_PATTERN.test(fileUrl.pathname)) {
        return REMOTE_RESOURCE_TYPES.CHARACTER;
    }
    if (ext === '.json' && JSON_PRESET_PATH_PATTERN.test(fileUrl.pathname)) {
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
    if (!pageUrl || !fileUrl || !isMemberHost(pageUrl) || !isAllowedFileUrl(fileUrl, pageUrl) || !isSupportedFilePath(fileUrl)) {
        throw new Error('Chatbots Webring resource URL is not allowed.');
    }
    if (![REMOTE_RESOURCE_TYPES.CHARACTER, REMOTE_RESOURCE_TYPES.PRESET].includes(resource.resourceType)) {
        throw new Error('Chatbots Webring resource type is invalid.');
    }
}

async function verifyExternalResourceLink(resource) {
    const pageUrl = parseAbsoluteUrl(resource.pageUrl, INDEX_URL);
    const fileUrl = parseAbsoluteUrl(resource.fileUrl, INDEX_URL);
    if (!pageUrl || !fileUrl || !isCatboxFileUrl(fileUrl)) {
        return;
    }

    const { text } = await fetchText(pageUrl.toString(), { timeoutMs: 12000 });
    const linked = extractResourceReferences(text)
        .map(reference => parseAbsoluteUrl(reference.href, pageUrl.toString()))
        .some(url => url?.toString() === fileUrl.toString());
    if (!linked) {
        throw new Error('Chatbots Webring external resource is not linked from the member page.');
    }
}

function validateDownloadedBuffer(buffer, resourceType, fileUrl) {
    const parsedUrl = new URL(fileUrl);
    const ext = path.extname(parsedUrl.pathname).toLowerCase();
    if (ext === '.png') {
        const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
        if (!isPng || resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            throw new Error('Chatbots Webring character card is not a PNG file.');
        }
        if (isCatboxFileUrl(parsedUrl) && !hasCharacterCardText(buffer)) {
            throw new Error('Chatbots Webring Catbox PNG does not contain character card metadata.');
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

function isCatboxFileUrl(url) {
    return url.protocol === 'https:' && url.hostname === CATBOX_FILE_HOST && CATBOX_CARD_PATH_PATTERN.test(url.pathname);
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
