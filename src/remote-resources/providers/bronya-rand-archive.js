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

const BASE_URL = 'https://bronya-rand.github.io/reimagined-couscous';
const INDEX_URL = `${BASE_URL}/world-lore-books`;
const WORLD_INFO_PREFIX = '/reimagined-couscous/world-info/';

export const bronyaRandArchiveProvider = {
    id: 'bronya-rand-archive',
    name: 'Bronya Rand Archive',
    description: 'Bronya Rand 静态世界书归档，匿名读取 GitHub Pages 索引并直连下载 JSON。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.WORLDBOOK) {
            return { items: [], total: 0 };
        }

        const limit = clampLimit(params.limit);
        const offset = getPageOffset(params.page, limit);
        const { text } = await fetchText(INDEX_URL);
        const items = parseWorldbookIndex(text).filter(item => matchesQuery(item, params.query));
        return {
            items: items.slice(offset, offset + limit).map(item => formatRemoteResource(this, item)),
            total: items.length,
        };
    },

    async download(params) {
        const id = String(params.resourceId || '').trim();
        if (!id) {
            throw new Error('Bronya Rand resource ID is required.');
        }

        const url = toWorldbookUrl(id);
        const { response, buffer } = await fetchBuffer(url.toString());
        validateWorldbookJson(buffer);

        return {
            buffer,
            fileName: decodeURIComponent(path.basename(url.pathname)),
            fileType: response.headers.get('content-type') || 'application/json',
            resourceType: REMOTE_RESOURCE_TYPES.WORLDBOOK,
        };
    },
};

function parseWorldbookIndex(html) {
    const pattern = /<(h[1-4])\b[^>]*>([\s\S]*?)<\/\1>|<a\b[^>]*href="([^"]+\.json)"[^>]*>([\s\S]*?)<\/a>/gi;
    const items = [];
    const seen = new Set();
    let section = '';
    let category = '';
    let match;

    while ((match = pattern.exec(html)) !== null) {
        if (match[1]) {
            const heading = stripHtml(match[2]);
            if (match[1] === 'h3') {
                section = heading;
                category = '';
            } else if (match[1] === 'h4') {
                category = heading;
            }
            continue;
        }

        const url = toWorldbookUrl(match[3]);
        const relativePath = getRelativeWorldbookPath(url);
        if (seen.has(relativePath)) {
            continue;
        }
        seen.add(relativePath);

        const linkText = stripHtml(match[4]);
        items.push(convertWorldbook(url, relativePath, linkText, section, category));
    }

    return items;
}

function convertWorldbook(url, relativePath, linkText, section, category) {
    const title = linkText || titleFromPath(relativePath);
    const tags = [
        section,
        category,
        ...relativePath.split('/').slice(1, -1).map(segment => decodeURIComponent(segment)),
    ].filter(Boolean);

    return {
        id: relativePath,
        resourceType: REMOTE_RESOURCE_TYPES.WORLDBOOK,
        title,
        description: [section, category].filter(Boolean).join(' / '),
        author: 'Bronya Rand',
        sourceUrl: INDEX_URL,
        downloadUrl: url.toString(),
        tags,
        capabilities: { download: true },
        metadata: {
            archivePath: relativePath,
            section,
            category,
        },
    };
}

function matchesQuery(item, query) {
    const normalized = String(query || '').trim().toLowerCase();
    if (!normalized) {
        return true;
    }

    return [
        item.id,
        item.title,
        item.description,
        item.author,
        ...(Array.isArray(item.tags) ? item.tags : []),
    ].filter(Boolean).join(' ').toLowerCase().includes(normalized);
}

function titleFromPath(relativePath) {
    return decodeURIComponent(path.basename(relativePath, '.json')).replace(/[-_]+/g, ' ').trim() || relativePath;
}

function toWorldbookUrl(value) {
    const trimmed = String(value || '').trim();
    const url = trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? new URL(trimmed)
        : new URL(trimmed.replace(/^\/+/, ''), `${BASE_URL}/`);
    const relativePath = getRelativeWorldbookPath(url);
    return new URL(relativePath, `${BASE_URL}/`);
}

function getRelativeWorldbookPath(url) {
    if (url.origin !== new URL(BASE_URL).origin || !url.pathname.startsWith(WORLD_INFO_PREFIX) || !url.pathname.endsWith('.json')) {
        throw new Error('Bronya Rand worldbook URL is outside the allowed archive path.');
    }

    return decodeURIComponent(url.pathname.slice('/reimagined-couscous/'.length));
}

function validateWorldbookJson(buffer) {
    try {
        const json = JSON.parse(buffer.toString('utf8'));
        if (!json?.entries || typeof json.entries !== 'object') {
            throw new Error('missing entries');
        }
    } catch (error) {
        throw new Error(`Bronya Rand worldbook JSON is invalid: ${error.message}`);
    }
}
