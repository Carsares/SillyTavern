import path from 'node:path';

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

const BASE_URL = 'https://charactercard.com';
const CARD_BASE_URL = 'https://card.charactercard.com';
const CATALOG_PATH = '/download';
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CATALOG_PAGES = 50;
const PAGE_FETCH_CONCURRENCY = 4;

let catalogCache = {
    expiresAt: 0,
    items: [],
    promise: null,
};

export const characterCardComProvider = {
    id: 'character-card-com',
    name: 'CharacterCard.com',
    description: 'CharacterCard.com 公开 Download 分页角色卡，匿名解析 Next/RSC 列表并下载原始 SillyTavern PNG 角色卡。',
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
        const items = await readCatalog();
        const matched = items.filter(item => matchesQuery(item, params.query));

        return {
            items: matched.slice(offset, offset + limit).map(item => formatRemoteResource(this, item)),
            total: matched.length,
        };
    },

    async download(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            throw new Error('CharacterCard.com only supports character downloads.');
        }

        const resource = await resolveResource(params.resourceId);
        const { response, buffer } = await fetchBuffer(resource.cardUrl);
        validatePngCharacterCard(buffer);

        return {
            buffer,
            fileName: `${safeFileName(resource.name || getDownloadBaseName(resource.cardUrl))}.png`,
            fileType: response.headers.get('content-type') || 'image/png',
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    },
};

async function readCatalog() {
    if (Date.now() < catalogCache.expiresAt) {
        return catalogCache.items;
    }
    if (catalogCache.promise) {
        return catalogCache.promise;
    }

    catalogCache.promise = loadCatalog()
        .then(items => {
            catalogCache = {
                expiresAt: Date.now() + CACHE_TTL_MS,
                items,
                promise: null,
            };
            return items;
        })
        .catch(error => {
            catalogCache.promise = null;
            throw error;
        });

    return catalogCache.promise;
}

async function loadCatalog() {
    const firstPage = await readCatalogPage(1);
    const totalPages = Math.max(1, Math.min(Number(firstPage.totalPages) || 1, MAX_CATALOG_PAGES));
    const pageNumbers = [];
    for (let page = 2; page <= totalPages; page += 1) {
        pageNumbers.push(page);
    }

    const pages = [firstPage, ...await mapWithConcurrency(pageNumbers, PAGE_FETCH_CONCURRENCY, readCatalogPage)];
    const seen = new Set();
    const items = [];
    for (const page of pages) {
        for (const character of page.characters) {
            const item = convertCharacter(character);
            if (!item || seen.has(item.metadata.characterId)) {
                continue;
            }
            seen.add(item.metadata.characterId);
            items.push(item);
        }
    }
    return items;
}

async function readCatalogPage(page) {
    const { text } = await fetchText(buildCatalogPageUrl(page));
    const rsc = decodeRscPayload(text);
    return {
        characters: parseInitialCharacters(rsc),
        totalPages: parseNumberProp(rsc, 'totalPages'),
    };
}

function buildCatalogPageUrl(page) {
    const pageNumber = Math.max(Number(page) || 1, 1);
    return `${BASE_URL}${pageNumber === 1 ? CATALOG_PATH : `${CATALOG_PATH}/${pageNumber}`}`;
}

function decodeRscPayload(html) {
    const pattern = /self\.__next_f\.push\((.*?)\)<\/script>/gs;
    let payload = '';
    for (const match of String(html || '').matchAll(pattern)) {
        const chunk = JSON.parse(match[1]);
        if (typeof chunk[1] === 'string') {
            payload += chunk[1];
        }
    }
    if (!payload) {
        throw new Error('CharacterCard.com page did not expose Next/RSC payload.');
    }
    return payload;
}

function parseInitialCharacters(rsc) {
    const marker = '"initialCharacters":';
    const markerIndex = rsc.indexOf(marker);
    if (markerIndex < 0) {
        throw new Error('CharacterCard.com page did not expose initial characters.');
    }

    const arrayStart = rsc.indexOf('[', markerIndex + marker.length);
    if (arrayStart < 0) {
        throw new Error('CharacterCard.com initial characters payload is invalid.');
    }

    const characters = JSON.parse(sliceJsonArray(rsc, arrayStart));
    return Array.isArray(characters) ? characters : [];
}

function sliceJsonArray(text, start) {
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escape) {
                escape = false;
            } else if (char === '\\') {
                escape = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '[') {
            depth += 1;
            continue;
        }
        if (char === ']') {
            depth -= 1;
            if (depth === 0) {
                return text.slice(start, index + 1);
            }
        }
    }

    throw new Error('CharacterCard.com initial characters payload is incomplete.');
}

function parseNumberProp(text, name) {
    const match = new RegExp(`"${name}":(\\d+)`).exec(text);
    return match ? Number(match[1]) : 0;
}

function convertCharacter(character) {
    const id = String(character?.id || '').trim();
    const cardUrl = resolveCardUrl(character?.avatar_image_url);
    if (!id || !cardUrl) {
        return null;
    }

    const title = stripHtml(character.name || id);
    const tags = formatTags(character.tags);
    const resourceId = JSON.stringify({ id, cardUrl, name: title });

    return {
        id: resourceId,
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title,
        description: truncateText(stripHtml(character.tagline || character.seo_description || character.greeting || '')),
        author: stripHtml(character.userName || ''),
        sourceUrl: `${BASE_URL}/chat/${encodeURIComponent(id)}`,
        downloadUrl: cardUrl,
        thumbnailUrl: resolveThumbnailUrl(character.avatar_image_url),
        tags: ['CharacterCard.com', ...tags],
        stats: {
            interactions: Number(character.interactionCount) || 0,
        },
        updatedAt: formatDate(character.createdAt),
        capabilities: { download: true },
        metadata: {
            characterId: id,
            cardUrl,
            avatarUrl: resolveThumbnailUrl(character.avatar_image_url),
        },
    };
}

function resolveCardUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        if (url.origin !== CARD_BASE_URL || !url.pathname.startsWith('/cover/')) {
            return '';
        }

        const cardPath = url.pathname.replace(/^\/cover\//u, '/card/').replace(/\.[^/.]+$/u, '.png');
        return `${CARD_BASE_URL}${cardPath}`;
    } catch {
        return '';
    }
}

function resolveThumbnailUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        if (url.origin !== CARD_BASE_URL || !url.pathname.startsWith('/cover/')) {
            return '';
        }
        return url.toString();
    } catch {
        return '';
    }
}

async function resolveResource(resourceId) {
    const parsed = parseResourceId(resourceId);
    if (parsed.cardUrl) {
        return parsed;
    }

    const items = await readCatalog();
    const item = items.find(candidate => candidate.metadata.characterId === parsed.id);
    if (!item) {
        throw new Error('CharacterCard.com character was not found in the public catalog.');
    }

    return {
        id: item.metadata.characterId,
        cardUrl: item.metadata.cardUrl,
        name: item.title,
    };
}

function parseResourceId(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        throw new Error('CharacterCard.com resource ID is required.');
    }

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return {
                id: String(parsed.id || '').trim(),
                cardUrl: validateCardDownloadUrl(parsed.cardUrl),
                name: stripHtml(parsed.name || ''),
            };
        }
    } catch {
        // Plain CharacterCard IDs and card URLs are accepted below.
    }

    const cardUrl = validateCardDownloadUrl(raw);
    if (cardUrl) {
        return { id: '', cardUrl, name: getDownloadBaseName(cardUrl) };
    }

    return { id: raw, cardUrl: '', name: '' };
}

function validateCardDownloadUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        if (url.origin !== CARD_BASE_URL || !url.pathname.startsWith('/card/') || path.extname(url.pathname).toLowerCase() !== '.png') {
            return '';
        }
        return url.toString();
    } catch {
        return '';
    }
}

function validatePngCharacterCard(buffer) {
    if (!isPng(buffer)) {
        throw new Error('CharacterCard.com resource is not a PNG character card.');
    }
    if (!hasCharacterTextChunk(buffer)) {
        throw new Error('CharacterCard.com PNG does not contain SillyTavern character metadata.');
    }
}

function hasCharacterTextChunk(buffer) {
    let offset = 8;
    while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd + 4 > buffer.length) {
            return false;
        }
        if ((type === 'tEXt' || type === 'iTXt') && isCharacterChunk(buffer.subarray(dataStart, dataEnd))) {
            return true;
        }
        offset = dataEnd + 4;
    }
    return false;
}

function isCharacterChunk(chunk) {
    const separator = chunk.indexOf(0);
    const keyword = chunk.subarray(0, separator > 0 ? separator : chunk.length).toString('latin1');
    return keyword === 'chara' || keyword === 'ccv3';
}

function isPng(buffer) {
    return buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
}

function formatTags(tags) {
    return Array.isArray(tags) ? tags.map(tag => stripHtml(tag)).filter(Boolean) : [];
}

function formatDate(value) {
    const raw = String(value || '').replace(/^\$D/u, '');
    if (!raw) {
        return '';
    }

    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function getDownloadBaseName(value) {
    try {
        const name = decodeURIComponent(path.basename(new URL(value).pathname, '.png'));
        return name || 'charactercard-character';
    } catch {
        return 'charactercard-character';
    }
}

function safeFileName(value) {
    return String(value || 'charactercard-character').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 120) || 'charactercard-character';
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await mapper(items[index]);
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}
