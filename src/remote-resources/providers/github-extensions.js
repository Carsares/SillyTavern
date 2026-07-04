import { SECRET_KEYS, readSecret } from '../../endpoints/secrets.js';
import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchJson,
    formatRemoteResource,
} from './shared.js';

const SEARCH_URL = 'https://api.github.com/search/repositories';

export const githubExtensionsProvider = {
    id: 'github-extensions',
    name: 'GitHub 扩展搜索',
    description: '通过 GitHub topic:sillytavern-extension 搜索第三方扩展；可选 token 用于提升限流额度。',
    authMode: 'token',
    supportsSearch: true,
    supportsDownload: false,
    supportsInstall: true,

    async search(params, context) {
        const limit = clampLimit(params.limit, 24, 30);
        const page = Math.max(Number(params.page) || 1, 1);
        const query = String(params.query || '').trim();
        const searchQuery = query ? `${query} topic:sillytavern-extension` : 'topic:sillytavern-extension';
        const url = new URL(SEARCH_URL);
        url.searchParams.set('q', searchQuery);
        url.searchParams.set('per_page', String(limit));
        url.searchParams.set('page', String(page));

        const token = readSecret(context.directories, SECRET_KEYS.REMOTE_RESOURCES_GITHUB);
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const { json } = await fetchJson(url.toString(), { headers });
        const items = Array.isArray(json.items) ? json.items : [];

        return {
            items: items.map(item => formatRemoteResource(this, convertRepository(item))),
            total: Number(json.total_count) || items.length,
        };
    },
};

function convertRepository(item) {
    return {
        id: String(item.id || item.full_name),
        resourceType: REMOTE_RESOURCE_TYPES.EXTENSION,
        title: item.full_name || item.name,
        description: item.description || '',
        author: item.owner?.login || '',
        sourceUrl: item.html_url || '',
        installUrl: item.clone_url || item.html_url || '',
        updatedAt: item.updated_at || '',
        tags: Array.isArray(item.topics) ? item.topics : [],
        stats: {
            stars: Number(item.stargazers_count) || 0,
            forks: Number(item.forks_count) || 0,
        },
        capabilities: { install: Boolean(item.clone_url || item.html_url) },
        metadata: {
            defaultBranch: item.default_branch || '',
            license: item.license?.spdx_id || '',
        },
    };
}
