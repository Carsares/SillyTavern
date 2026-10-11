import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchBuffer,
    fetchJson,
    formatRemoteResource,
    stripHtml,
    truncateText,
} from './shared.js';

const BASE_URL = 'https://lorebary.sophiamccarty.com';

export const loreBaryProvider = {
    id: 'lorebary',
    name: 'LoreBary',
    description: 'LoreBary 公开世界书与插件库 API，匿名搜索并下载 JSON。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        const searches = [];
        if (!params.resourceType || params.resourceType === REMOTE_RESOURCE_TYPES.WORLDBOOK) {
            searches.push(searchLorebooks(params));
        }
        if (!params.resourceType || params.resourceType === REMOTE_RESOURCE_TYPES.PRESET) {
            searches.push(searchPlugins(params));
        }
        if (!searches.length) {
            return { items: [], total: 0 };
        }

        const results = await Promise.all(searches);
        return {
            items: results.flatMap(result => result.items).map(item => formatRemoteResource(this, item)),
            total: results.reduce((total, result) => total + result.total, 0),
        };
    },

    async download(params) {
        const id = String(params.resourceId || '').trim();
        if (!id) {
            throw new Error('LoreBary resource ID is required.');
        }

        const resourceType = params.resourceType || REMOTE_RESOURCE_TYPES.WORLDBOOK;
        const isPlugin = resourceType === REMOTE_RESOURCE_TYPES.PRESET;
        const url = `${BASE_URL}/api/${isPlugin ? 'plugin' : 'lorebook'}/download/${encodeURIComponent(id)}`;
        const { response, buffer } = await fetchBuffer(url);
        const fileName = getDownloadedFileName(buffer, id, isPlugin ? 'plugin' : 'lorebook');

        return {
            buffer,
            fileName,
            fileType: response.headers.get('content-type') || 'application/json',
            resourceType,
        };
    },
};

async function searchLorebooks(params) {
    const limit = clampLimit(params.limit);
    const page = Math.max(Number(params.page) || 1, 1);
    const url = new URL('/api/lorebook/public', BASE_URL);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('sortBy', 'popular');
    url.searchParams.set('sortOrder', 'desc');
    url.searchParams.set('includeEntries', 'false');
    url.searchParams.set('downloadableOnly', 'true');
    const query = String(params.query || '').trim();
    if (query) {
        url.searchParams.set('search', query);
    }

    const { json } = await fetchJson(url.toString());
    const items = Array.isArray(json.lorebooks) ? json.lorebooks : [];
    return {
        items: items.map(convertLorebook),
        total: Number(json.totalCount) || items.length,
    };
}

async function searchPlugins(params) {
    const limit = clampLimit(params.limit);
    const page = Math.max(Number(params.page) || 1, 1);
    const query = String(params.query || '').trim();
    const url = query ? new URL('/api/plugin/semantic-search', BASE_URL) : new URL('/api/plugin', BASE_URL);
    if (query) {
        url.searchParams.set('q', query);
        url.searchParams.set('limit', String(limit * 4));
    } else {
        url.searchParams.set('page', String(page));
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('sortBy', 'popular');
        url.searchParams.set('sortOrder', 'desc');
        url.searchParams.set('downloadableOnly', 'true');
    }

    const { json } = await fetchJson(url.toString());
    const data = json.data && typeof json.data === 'object' ? json.data : json;
    const items = (Array.isArray(data.plugins) ? data.plugins : [])
        .filter(item => item.downloadable !== false)
        .slice(0, limit);
    return {
        items: items.map(convertPlugin),
        total: Number(data.totalCount) || items.length,
    };
}

function convertLorebook(item) {
    const id = String(item.code || '').trim();
    return {
        id,
        resourceType: REMOTE_RESOURCE_TYPES.WORLDBOOK,
        title: item.title || id,
        description: truncateText(stripHtml(item.description || '')),
        author: item.author || '',
        sourceUrl: `${BASE_URL}/lorebook-library?view=${encodeURIComponent(id)}`,
        downloadUrl: `${BASE_URL}/api/lorebook/download/${encodeURIComponent(id)}`,
        thumbnailUrl: item.hasCoverImage ? `${BASE_URL}/api/lorebook/cover/${encodeURIComponent(id)}` : '',
        tags: normalizeTags(item.tags, item.category),
        stats: {
            downloads: Number(item.downloads) || 0,
            views: Number(item.views) || 0,
            rating: Number(item.rating) || 0,
            ratingCount: Number(item.ratingCount) || 0,
            tokens: Number(item.tokenStats?.totalTokens || item.totalTokens) || 0,
            entries: Number(item.entryCount) || 0,
        },
        updatedAt: item.updatedDate || item.createdDate || '',
        capabilities: { download: Boolean(item.allowDownloads ?? true) },
        metadata: {
            loreBaryKind: 'lorebook',
            category: item.category || '',
            hasContentWarning: Boolean(item.hasContentWarning),
        },
    };
}

function convertPlugin(item) {
    const id = String(item.code || '').trim();
    return {
        id,
        resourceType: REMOTE_RESOURCE_TYPES.PRESET,
        title: item.name || id,
        description: truncateText(stripHtml(item.description || '')),
        author: item.author || '',
        sourceUrl: `${BASE_URL}/plugin-library?view=${encodeURIComponent(id)}`,
        downloadUrl: `${BASE_URL}/api/plugin/download/${encodeURIComponent(id)}`,
        thumbnailUrl: item.hasCoverImage ? `${BASE_URL}/api/plugin/cover/${encodeURIComponent(id)}` : '',
        tags: normalizeTags(item.tags, item.category || item.tag),
        stats: {
            downloads: Number(item.downloads) || 0,
            views: Number(item.views) || 0,
            rating: Number(item.rating) || 0,
            ratingCount: Number(item.ratingCount) || 0,
            forks: Number(item.forkCount) || 0,
        },
        updatedAt: item.updatedDate || item.createdDate || '',
        capabilities: { download: Boolean(item.downloadable ?? true) },
        metadata: {
            loreBaryKind: 'plugin',
            category: item.category || '',
            pluginTag: item.tag || '',
            hasContentWarning: Boolean(item.hasContentWarning),
        },
    };
}

function normalizeTags(tags, category) {
    return [
        category,
        ...(Array.isArray(tags) ? tags : []),
    ].map(tag => String(tag || '').trim()).filter(Boolean);
}

function getDownloadedFileName(buffer, id, kind) {
    try {
        const json = JSON.parse(buffer.toString('utf8'));
        return `${safeFileName(json.name || json.title || id)}_${kind}.json`;
    } catch {
        return `${safeFileName(id)}_${kind}.json`;
    }
}

function safeFileName(value) {
    return String(value || 'lorebary').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 120) || 'lorebary';
}
