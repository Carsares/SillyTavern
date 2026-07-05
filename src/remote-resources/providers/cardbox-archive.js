import path from 'node:path';

import { decode } from 'html-entities';

import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchBuffer,
    fetchText,
    formatRemoteResource,
    stripHtml,
    truncateText,
} from './shared.js';

const BASE_URL = 'https://archive.cardbox.moe';
const RESULT_PAGE_SIZE = 20;
const MAX_FETCH_PAGES = 3;

export const cardboxArchiveProvider = {
    id: 'cardbox-archive',
    name: 'Cardbox Archive',
    description: 'Cardbox Archive 服务端搜索页，匿名聚合 Chub、Botbooru、Character Tavern、Wyvern、Risu Realm 等角色卡并下载标准 JSON。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            return { items: [], total: 0 };
        }

        const limit = clampLimit(params.limit);
        const page = getSafePage(params.page);
        const pages = await readSearchPages(params.query, page, limit);
        const items = uniqueById(pages.flatMap(({ text, url }) => parseSearchResults(text, url)));

        return {
            items: items.slice(0, limit).map(item => formatRemoteResource(this, item)),
            total: estimateTotal(items.length, pages.at(-1)?.hasNext, page),
        };
    },

    async download(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            throw new Error('Cardbox Archive only supports character downloads.');
        }

        const cardUrl = parseCardboxCardUrl(params.resourceId);
        const { text } = await fetchText(cardUrl.toString());
        const downloadUrl = extractJsonDownloadUrl(text, cardUrl);
        if (!downloadUrl) {
            throw new Error('Cardbox Archive JSON download link was not found.');
        }

        const { response, buffer } = await fetchBuffer(downloadUrl.toString(), {
            headers: { Referer: cardUrl.toString() },
        });
        validateCharacterJson(buffer);

        return {
            buffer,
            fileName: getDownloadFileName(response.headers.get('content-disposition'), downloadUrl),
            fileType: response.headers.get('content-type') || 'application/json',
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    },
};

async function readSearchPages(query, page, limit) {
    const pagesToRead = Math.min(MAX_FETCH_PAGES, Math.max(1, Math.ceil(limit / RESULT_PAGE_SIZE)));
    const pageNumbers = Array.from({ length: pagesToRead }, (_, index) => page + index);
    const pages = [];

    for (const pageNumber of pageNumbers) {
        const url = buildSearchUrl(query, pageNumber);
        const { text } = await fetchText(url.toString(), { timeoutMs: 30000 });
        pages.push({ text, url, hasNext: hasNextPage(text) });
        if (!hasNextPage(text)) {
            break;
        }
    }

    return pages;
}

function buildSearchUrl(query, page) {
    const url = new URL('/', BASE_URL);
    const trimmedQuery = String(query || '').trim();
    if (trimmedQuery) {
        url.searchParams.set('q', trimmedQuery);
    }
    if (page > 1) {
        url.searchParams.set('page', String(page));
    }
    return url;
}

function parseSearchResults(html, pageUrl) {
    return String(html || '')
        .split('<div class="search-result-card">')
        .slice(1)
        .map(chunk => parseSearchResult(chunk, pageUrl))
        .filter(Boolean);
}

function parseSearchResult(chunk, pageUrl) {
    const nameLink = /<a\b(?=[^>]*class="result-name")[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/iu.exec(chunk);
    if (!nameLink) {
        return null;
    }

    const cardUrl = parseCardboxCardUrl(decode(nameLink[2]), pageUrl);
    const resultId = stripHtml(/<span\b[^>]*class="result-id"[^>]*>([\s\S]*?)<\/span>/iu.exec(chunk)?.[1] || '') || getCardPath(cardUrl);
    const title = stripHtml(nameLink[3]) || resultId;
    const author = stripHtml(/<span\b[^>]*class="result-author"[^>]*>by\s*<a\b[^>]*>([\s\S]*?)<\/a>/iu.exec(chunk)?.[1] || '');
    const source = stripHtml(/<span\b[^>]*class="badge badge-source[^"]*"[^>]*>([\s\S]*?)<\/span>/iu.exec(chunk)?.[1] || '');
    const updatedAt = stripHtml(/<span\b[^>]*class="result-date"[^>]*>([\s\S]*?)<\/span>/iu.exec(chunk)?.[1] || '');
    const thumbnailUrl = extractThumbnailUrl(chunk, pageUrl);
    const tags = extractTags(chunk);

    return {
        id: cardUrl.pathname + cardUrl.search,
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title,
        description: truncateText([source ? `Source: ${source}` : '', tags.length ? `Tags: ${tags.join(', ')}` : ''].filter(Boolean).join(' · '), 360),
        author,
        sourceUrl: cardUrl.toString(),
        downloadUrl: cardUrl.toString(),
        thumbnailUrl,
        tags: [source, ...tags].filter(Boolean),
        updatedAt,
        capabilities: { download: true },
        metadata: {
            cardboxId: resultId,
            source,
        },
    };
}

function extractThumbnailUrl(chunk, pageUrl) {
    const src = /<img\b[^>]*src=(["'])(.*?)\1/iu.exec(chunk)?.[2] || '';
    if (!src) {
        return '';
    }
    try {
        const url = new URL(decode(src), pageUrl);
        return url.toString();
    } catch {
        return '';
    }
}

function extractTags(chunk) {
    return [...chunk.matchAll(/<span\b[^>]*class="tag(?! tag-more)[^"]*"[^>]*>([\s\S]*?)<\/span>/giu)]
        .map(match => stripHtml(match[1]))
        .filter(Boolean);
}

function hasNextPage(html) {
    return /<a\b[^>]*href="[^"]*[?&]page=\d+[^"]*"[^>]*>\s*Next\s*&raquo;\s*<\/a>/iu.test(String(html || ''));
}

function estimateTotal(itemCount, hasNext, page) {
    const offset = (page - 1) * RESULT_PAGE_SIZE;
    return offset + itemCount + (hasNext ? 1 : 0);
}

function extractJsonDownloadUrl(html, cardUrl) {
    const href = /href=(["'])(\/download\/[^"']+\/json\?[^"']+)\1/iu.exec(String(html || ''))?.[2];
    if (!href) {
        return null;
    }
    return parseCardboxDownloadUrl(decode(href), cardUrl);
}

function parseCardboxCardUrl(value, baseUrl = BASE_URL) {
    const url = parseCardboxUrl(value, baseUrl);
    if (!url.pathname.startsWith('/card/')) {
        throw new Error('Cardbox Archive resource ID is invalid.');
    }
    if (!url.searchParams.get('t')) {
        throw new Error('Cardbox Archive signed card token is missing; search again before downloading.');
    }
    return url;
}

function parseCardboxDownloadUrl(value, baseUrl = BASE_URL) {
    const url = parseCardboxUrl(value, baseUrl);
    if (!/^\/download\/.+\/json$/u.test(url.pathname)) {
        throw new Error('Cardbox Archive download URL is invalid.');
    }
    if (!url.searchParams.get('t')) {
        throw new Error('Cardbox Archive signed download token is missing.');
    }
    return url;
}

function parseCardboxUrl(value, baseUrl) {
    try {
        const url = new URL(String(value || '').trim(), baseUrl);
        if (url.origin !== BASE_URL) {
            throw new Error('origin mismatch');
        }
        return url;
    } catch {
        throw new Error('Cardbox Archive URL is invalid.');
    }
}

function getCardPath(cardUrl) {
    return decodeURIComponent(cardUrl.pathname.replace(/^\/card\//u, ''));
}

function getDownloadFileName(disposition, downloadUrl) {
    const filename = parseDispositionFilename(disposition);
    if (filename) {
        return filename;
    }
    const baseName = path.basename(downloadUrl.pathname.replace(/\/json$/u, '')) || 'cardbox-character';
    return `${decodeURIComponent(baseName)}.json`;
}

function parseDispositionFilename(disposition) {
    const value = String(disposition || '');
    const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(value)?.[1];
    if (encoded) {
        try {
            return decodeURIComponent(encoded);
        } catch {
            return encoded;
        }
    }

    return /filename="?([^";]+)"?/iu.exec(value)?.[1] || '';
}

function validateCharacterJson(buffer) {
    try {
        const json = JSON.parse(buffer.toString('utf8'));
        if (json?.spec !== 'chara_card_v2' || !json.data || typeof json.data !== 'object') {
            throw new Error('missing chara_card_v2 data');
        }
    } catch (error) {
        throw new Error(`Cardbox Archive character JSON is invalid: ${error.message}`);
    }
}

function getSafePage(page) {
    const parsed = Number(page);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function uniqueById(items) {
    const seen = new Set();
    return items.filter(item => {
        const key = item.id;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}
