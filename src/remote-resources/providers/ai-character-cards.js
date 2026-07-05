import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchBuffer,
    fetchJson,
    formatRemoteResource,
    stripHtml,
    truncateText,
} from './shared.js';

const API_BASE_URL = 'https://api.aicharactercards.com/api';
const FILE_BASE_URL = 'https://api.aicharactercards.com';
const WEB_BASE_URL = 'https://aicharactercards.com';

export const aiCharacterCardsProvider = {
    id: 'ai-character-cards',
    name: 'AICharacterCards',
    description: 'AICharacterCards 公开角色卡 API，匿名搜索并下载原始 PNG 角色卡。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            return { items: [], total: 0 };
        }

        const limit = clampLimit(params.limit);
        const page = Math.max(Number(params.page) || 1, 1);
        const url = new URL('/api/cards', API_BASE_URL);
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('page', String(page));
        const query = String(params.query || '').trim();
        if (query) {
            url.searchParams.set('search', query);
        } else {
            url.searchParams.set('orderBy', 'downloadCount');
        }

        const { json } = await fetchJson(url.toString());
        const items = Array.isArray(json.data) ? json.data : [];

        return {
            items: items.map(item => formatRemoteResource(this, convertAiCharacterCard(item))),
            total: Number(json.pagination?.total) || items.length,
        };
    },

    async download(params) {
        const id = String(params.resourceId || '').trim();
        if (!id) {
            throw new Error('AICharacterCards resource ID is required.');
        }

        const { json } = await fetchJson(`${API_BASE_URL}/cards/${encodeURIComponent(id)}/versions`);
        const versions = Array.isArray(json.data) ? json.data : [];
        const version = versions.find(item => item.isCurrent) || versions[0];
        if (!version?.fileUrl) {
            throw new Error('AICharacterCards card does not expose a downloadable PNG version.');
        }

        const downloadUrl = toFileUrl(version.fileUrl);
        const { response, buffer } = await fetchBuffer(downloadUrl);

        return {
            buffer,
            fileName: version.fileName || `${id}.png`,
            fileType: response.headers.get('content-type') || 'image/png',
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    },
};

function convertAiCharacterCard(item) {
    const tags = Array.isArray(item.tags) ? item.tags.map(tag => tag?.name || tag).filter(Boolean) : [];
    return {
        id: String(item.id || ''),
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title: item.title || `Card ${item.id}`,
        description: truncateText(stripHtml(item.excerpt || item.description || '')),
        author: item.author || '',
        sourceUrl: `${WEB_BASE_URL}/cards/${encodeURIComponent(item.id)}`,
        downloadUrl: `${API_BASE_URL}/cards/${encodeURIComponent(item.id)}/versions`,
        thumbnailUrl: toFileUrl(item.imageUrl || ''),
        tags: [
            ...tags,
            item.isNsfw ? 'NSFW' : '',
            item.language ? `lang:${item.language}` : '',
        ].filter(Boolean),
        stats: {
            downloads: Number(item.downloadCount) || 0,
            rating: Number(item.ratingAvg) || 0,
            ratingCount: Number(item.ratingCount) || 0,
            aiScore: Number(item.aiScore) || 0,
        },
        updatedAt: item.updatedAt || item.createdAt || '',
        capabilities: { download: Boolean(item.id) },
        metadata: {
            userId: item.userId || '',
            language: item.language || '',
            isAnimated: Boolean(item.isAnimated),
        },
    };
}

function toFileUrl(value) {
    const url = String(value || '').trim();
    if (!url) {
        return '';
    }
    if (/^https?:\/\//i.test(url)) {
        return url;
    }
    return `${FILE_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}
