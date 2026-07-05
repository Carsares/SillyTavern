import path from 'node:path';

import extractChunks from 'png-chunks-extract';
import PNGtext from 'png-chunk-text';

import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchBuffer,
    fetchJson,
    formatRemoteResource,
    truncateText,
} from './shared.js';

const BASE_URL = 'https://chararc.bernkastel.pictures';
const SOURCE_FILTERS = 'source:generic sourceSpecific:catbox type:character';

export const characterArchiveCatboxProvider = {
    id: 'character-archive-catbox',
    name: 'Character Archive Catbox',
    description: 'Character Card Archive 的 generic/catbox 子集，匿名调用公开搜索 API，并从详情 metadata.source_url 下载原始 Catbox PNG 角色卡。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            return { items: [], total: 0 };
        }

        const limit = clampLimit(params.limit, 20, 20);
        const page = getSafePage(params.page);
        const { json } = await fetchJson(buildSearchUrl(params.query, page, limit).toString(), { timeoutMs: 30000 });
        const items = (Array.isArray(json?.result) ? json.result : [])
            .map(convertSearchResult)
            .filter(Boolean);

        return {
            items: items.map(item => formatRemoteResource(this, item)),
            total: estimateTotal(items.length, json?.totalPages, page, limit),
        };
    },

    async download(params) {
        const resource = parseResourceId(params.resourceId);
        if (params.resourceType && params.resourceType !== resource.resourceType) {
            throw new Error('Character Archive Catbox resource type mismatch.');
        }

        const node = await readCharacterNode(resource.archiveId);
        const sourceUrl = parseCatboxPngUrl(node?.metadata?.source_url);
        const { response, buffer } = await fetchBuffer(sourceUrl.toString(), { timeoutMs: 60000 });
        if (!isPng(buffer) || !hasCharacterCardText(buffer)) {
            throw new Error('Character Archive Catbox PNG does not contain character card metadata.');
        }

        return {
            buffer,
            fileName: getDownloadFileName(sourceUrl),
            fileType: response.headers.get('content-type') || 'image/png',
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    },
};

function buildSearchUrl(query, page, limit) {
    const url = new URL('/api/archive/v3/search/query', BASE_URL);
    const searchQuery = [String(query || '').trim(), SOURCE_FILTERS].filter(Boolean).join(' ');
    url.searchParams.set('query', searchQuery);
    url.searchParams.set('page', String(page));
    url.searchParams.set('count', String(limit));
    return url;
}

function convertSearchResult(item) {
    if (item?.source !== 'generic' || item?.sourceSpecific !== 'catbox' || item?.type !== 'character') {
        return null;
    }

    const archiveId = String(item.id || '').trim();
    if (!isArchiveId(archiveId)) {
        return null;
    }

    const title = String(item.name || archiveId).trim();
    const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean) : [];
    return {
        id: formatResourceId(archiveId),
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title,
        description: truncateText([item.tagline ? String(item.tagline) : '', tags.length ? `Tags: ${tags.join(', ')}` : ''].filter(Boolean).join(' · '), 360),
        author: String(item.author || ''),
        sourceUrl: buildSourceUrl(title, archiveId),
        downloadUrl: buildNodeUrl(archiveId).toString(),
        thumbnailUrl: buildImageUrl(archiveId).toString(),
        tags: ['Character Archive', 'Catbox', ...tags],
        updatedAt: item.updated || item.created || '',
        capabilities: { download: true },
        metadata: {
            archiveId,
            source: 'generic',
            sourceSpecific: 'catbox',
        },
    };
}

async function readCharacterNode(archiveId) {
    if (!isArchiveId(archiveId)) {
        throw new Error('Character Archive Catbox resource ID is invalid.');
    }

    const { json } = await fetchJson(buildNodeUrl(archiveId).toString(), { timeoutMs: 30000 });
    if (json?.source !== 'generic' || json?.sourceSpecific !== 'catbox' || json?.type !== 'character') {
        throw new Error('Character Archive Catbox node is not a generic Catbox character.');
    }
    return json;
}

function buildNodeUrl(archiveId) {
    return new URL(`/api/archive/v1/generic/node/character/${encodeURIComponent(archiveId)}?ratings=true&node=true`, BASE_URL);
}

function buildImageUrl(archiveId) {
    const url = new URL(`/api/archive/v1/generic/image/character/${encodeURIComponent(archiveId)}`, BASE_URL);
    url.searchParams.set('max', '200');
    url.searchParams.set('thumbnail', 'true');
    url.searchParams.set('square', 'true');
    url.searchParams.set('format', 'jpeg');
    url.searchParams.set('optimize', 'true');
    return url;
}

function buildSourceUrl(title, archiveId) {
    const name = encodeURIComponent(title || 'character');
    return `${BASE_URL}/generic/${name}+${encodeURIComponent(archiveId)}`;
}

function parseResourceId(resourceId) {
    try {
        const parsed = JSON.parse(String(resourceId || ''));
        return {
            archiveId: String(parsed.archiveId || ''),
            resourceType: String(parsed.resourceType || REMOTE_RESOURCE_TYPES.CHARACTER),
        };
    } catch {
        return {
            archiveId: String(resourceId || ''),
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    }
}

function formatResourceId(archiveId) {
    return JSON.stringify({ archiveId, resourceType: REMOTE_RESOURCE_TYPES.CHARACTER });
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
    throw new Error('Character Archive Catbox source PNG URL is invalid.');
}

function isArchiveId(value) {
    return /^[a-f0-9]{32}$/iu.test(String(value || ''));
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
    return fileName || 'character-archive-catbox-card.png';
}

function getSafePage(page) {
    const parsed = Number(page);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function estimateTotal(itemCount, totalPages, page, limit) {
    const pages = Number(totalPages);
    if (Number.isFinite(pages) && pages > 0) {
        return Math.max(itemCount, (Math.floor(pages) - 1) * limit + itemCount);
    }
    return (page - 1) * limit + itemCount;
}
