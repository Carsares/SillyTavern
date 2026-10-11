import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchJson,
    formatRemoteResource,
} from './shared.js';

const SEARCH_URL = 'https://gitlab.com/api/v4/projects';

export const gitLabExtensionsProvider = {
    id: 'gitlab-extensions',
    name: 'GitLab 扩展搜索',
    description: '通过 GitLab 公开 Projects API 搜索 SillyTavern 扩展，匿名可用。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: false,
    supportsInstall: true,

    async search(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.EXTENSION) {
            return { items: [], total: 0 };
        }

        const limit = clampLimit(params.limit, 24, 50);
        const page = Math.max(Number(params.page) || 1, 1);
        const query = String(params.query || '').trim();
        const url = new URL(SEARCH_URL);
        url.searchParams.set('search', query ? `${query} sillytavern extension` : 'sillytavern extension');
        url.searchParams.set('simple', 'true');
        url.searchParams.set('per_page', String(limit));
        url.searchParams.set('page', String(page));
        url.searchParams.set('order_by', 'last_activity_at');
        url.searchParams.set('sort', 'desc');

        const { response, json } = await fetchJson(url.toString());
        const items = Array.isArray(json) ? json : [];

        return {
            items: items.map(item => formatRemoteResource(this, convertProject(item))),
            total: Number(response.headers.get('x-total')) || items.length,
        };
    },
};

function convertProject(item) {
    const cloneUrl = item.http_url_to_repo || item.web_url || '';
    return {
        id: String(item.id || item.path_with_namespace || ''),
        resourceType: REMOTE_RESOURCE_TYPES.EXTENSION,
        title: item.path_with_namespace || item.name_with_namespace || item.name,
        description: item.description || '',
        author: item.namespace?.full_path || item.namespace?.name || '',
        sourceUrl: item.web_url || '',
        installUrl: cloneUrl,
        updatedAt: item.last_activity_at || item.updated_at || '',
        tags: ['gitlab'],
        stats: {
            stars: Number(item.star_count) || 0,
            forks: Number(item.forks_count) || 0,
        },
        capabilities: { install: Boolean(cloneUrl) },
        metadata: {
            defaultBranch: item.default_branch || '',
            visibility: item.visibility || '',
        },
    };
}
