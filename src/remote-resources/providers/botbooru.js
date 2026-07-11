import { SECRET_KEYS, readSecret } from '../../endpoints/secrets.js';
import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchBuffer,
    fetchJson,
    formatRemoteResource,
    getPageOffset,
    stripHtml,
    truncateText,
} from './shared.js';

const BASE_URL = 'https://botbooru.com';
const IMAGE_PREVIEW_SIZE = 640;

export const botbooruProvider = {
    id: 'botbooru',
    name: 'Botbooru',
    description: 'Botbooru 公开角色和世界书接口，匿名搜索 SFW 资源；已配置的 token 会随请求发送，但当前强制 SFW 使其无额外可见效果。',
    authMode: 'token',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,
    supportsUrlImport: true,

    async search(params, context) {
        const token = readBotbooruToken(context);
        const searches = [];
        if (!params.resourceType || params.resourceType === REMOTE_RESOURCE_TYPES.CHARACTER) {
            searches.push(searchCharacters(params, token));
        }
        if (!params.resourceType || params.resourceType === REMOTE_RESOURCE_TYPES.WORLDBOOK) {
            searches.push(searchLorebooks(params, token));
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

    async download(params, context) {
        const token = readBotbooruToken(context);
        const parsed = parseResourceId(params.resourceId, params.resourceType);
        const resourceType = params.resourceType || parsed.resourceType || REMOTE_RESOURCE_TYPES.CHARACTER;
        if (resourceType === REMOTE_RESOURCE_TYPES.CHARACTER) {
            return downloadCharacter(parsed.id, token);
        }
        if (resourceType === REMOTE_RESOURCE_TYPES.WORLDBOOK) {
            return downloadLorebook(parsed.id, token);
        }
        throw new Error(`Botbooru does not support downloading ${resourceType}.`);
    },
};

async function searchCharacters(params, token) {
    const limit = clampLimit(params.limit, 24, 50);
    const offset = getPageOffset(params.page, limit);
    const query = String(params.query || '').trim();
    const url = new URL('/posts/', BASE_URL);
    url.searchParams.set('sort', 'latest');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('sfw_only', 'true');
    if (query) {
        url.searchParams.set('q', query);
    }

    const { json } = await botbooruJson(url.toString(), token);
    const posts = Array.isArray(json.posts) ? json.posts : [];
    return {
        items: posts.map(convertCharacterSearchItem).filter(Boolean),
        total: Number(json.total) || posts.length,
    };
}

async function searchLorebooks(params, token) {
    const limit = clampLimit(params.limit, 24, 50);
    const offset = getPageOffset(params.page, limit);
    const query = String(params.query || '').trim();
    const url = new URL('/api/lorebooks', BASE_URL);
    url.searchParams.set('sort', 'latest');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('sfw_only', 'true');
    if (query) {
        url.searchParams.set('q', query);
    }

    const { json } = await botbooruJson(url.toString(), token);
    const lorebooks = Array.isArray(json.items) ? json.items : [];
    return {
        items: lorebooks.map(convertLorebookSearchItem).filter(Boolean),
        total: Number(json.total) || lorebooks.length,
    };
}

async function downloadCharacter(id, token) {
    const detail = await readCharacterDetail(id, token);
    const { response, buffer } = await fetchBuffer(`${BASE_URL}/download/png/${encodeURIComponent(id)}`, {
        headers: botbooruHeaders(token),
    });
    validatePng(buffer);

    return {
        buffer,
        fileName: `${safeFileName(detail.meta_name || detail.character_name || id)}.png`,
        fileType: response.headers.get('content-type') || 'image/png',
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
    };
}

async function downloadLorebook(id, token) {
    const detail = await readLorebookDetail(id, token);
    const { response, buffer } = await fetchBuffer(`${BASE_URL}/api/lorebooks/${encodeURIComponent(id)}/download.json`, {
        headers: botbooruHeaders(token),
    });
    validateJson(buffer, 'Botbooru lorebook payload is invalid.');

    return {
        buffer,
        fileName: `${safeFileName(detail.title || id)}.json`,
        fileType: response.headers.get('content-type') || 'application/json',
        resourceType: REMOTE_RESOURCE_TYPES.WORLDBOOK,
    };
}

async function readCharacterDetail(id, token) {
    const { json } = await botbooruJson(`${BASE_URL}/post/${encodeURIComponent(id)}`, token);
    if (!json?.id) {
        throw new Error('Botbooru character payload is invalid.');
    }
    return json;
}

async function readLorebookDetail(id, token) {
    const { json } = await botbooruJson(`${BASE_URL}/api/lorebooks/${encodeURIComponent(id)}`, token);
    if (!json?.number && !json?.id) {
        throw new Error('Botbooru lorebook payload is invalid.');
    }
    return json;
}

async function botbooruJson(url, token) {
    return fetchJson(url, {
        headers: botbooruHeaders(token),
    });
}

function botbooruHeaders(token) {
    const trimmed = String(token || '').trim();
    return trimmed ? { Authorization: `Bearer ${trimmed}` } : {};
}

function readBotbooruToken(context) {
    return readSecret(context?.directories, SECRET_KEYS.REMOTE_RESOURCES_BOTBOORU_TOKEN);
}

function convertCharacterSearchItem(post) {
    const id = getNumberId(post?.id);
    if (!id) {
        return null;
    }

    const title = post.meta_name || post.character_name || id;
    return {
        id: formatResourceId(REMOTE_RESOURCE_TYPES.CHARACTER, id),
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title,
        description: truncateText(stripHtml(post.tagline || post.description || '')),
        author: post.creator || post.uploader_name || post.uploader_username || '',
        sourceUrl: `${BASE_URL}/character/${encodeURIComponent(id)}`,
        downloadUrl: `${BASE_URL}/download/png/${encodeURIComponent(id)}`,
        thumbnailUrl: formatImageUrl(post.filename, true),
        tags: formatTags(post.tags, post.rating || post.content_rating),
        stats: {
            views: Number(post.views) || 0,
            downloads: Number(post.downloads) || 0,
            favorites: Number(post.favorite_count || post.favorites) || 0,
            tokens: Number(post.token_count || post.token_estimate) || 0,
        },
        updatedAt: post.updated_at || post.created_at || '',
        capabilities: { download: true, importUrl: true },
        metadata: {
            botbooruId: id,
            rating: post.rating || post.content_rating || '',
            filename: post.filename || '',
            uploaderId: post.uploader_id || '',
        },
    };
}

function convertLorebookSearchItem(lorebook) {
    const id = getNumberId(lorebook?.number || lorebook?.id);
    if (!id) {
        return null;
    }

    return {
        id: formatResourceId(REMOTE_RESOURCE_TYPES.WORLDBOOK, id),
        resourceType: REMOTE_RESOURCE_TYPES.WORLDBOOK,
        title: lorebook.title || id,
        description: truncateText(stripHtml(lorebook.tagline || lorebook.description || lorebook.first_entry_snippet || '')),
        author: lorebook.uploader_username || '',
        sourceUrl: `${BASE_URL}/lorebook/${encodeURIComponent(id)}`,
        downloadUrl: `${BASE_URL}/api/lorebooks/${encodeURIComponent(id)}/download.json`,
        thumbnailUrl: formatImageUrl(lorebook.cover_image_filename, false),
        tags: [
            lorebook.content_rating || '',
            ...formatArray(lorebook.top_keys).slice(0, 8),
        ].filter(Boolean),
        stats: {
            entries: Number(lorebook.entry_count) || 0,
            tokens: Number(lorebook.token_estimate) || 0,
            views: Number(lorebook.views) || 0,
            downloads: Number(lorebook.downloads) || 0,
        },
        updatedAt: lorebook.updated_at || lorebook.created_at || '',
        capabilities: { download: true, importUrl: true },
        metadata: {
            botbooruNumber: id,
            botbooruPostId: lorebook.id || '',
            rating: lorebook.content_rating || '',
            slug: lorebook.slug || '',
            tocTotal: Number(lorebook.toc_total) || 0,
        },
    };
}

function parseResourceId(value, resourceType) {
    const raw = String(value || '').trim();
    if (!raw) {
        throw new Error('Botbooru resource ID is required.');
    }

    try {
        const url = new URL(raw);
        if (url.origin === BASE_URL) {
            const character = /^\/(?:character|post)\/(\d+)/iu.exec(url.pathname);
            if (character) {
                return { resourceType: REMOTE_RESOURCE_TYPES.CHARACTER, id: character[1] };
            }
            const lorebook = /^\/(?:lorebook|api\/lorebooks)\/(\d+)/iu.exec(url.pathname);
            if (lorebook) {
                return { resourceType: REMOTE_RESOURCE_TYPES.WORLDBOOK, id: lorebook[1] };
            }
        }
    } catch {
        // Continue with prefixed or plain IDs.
    }

    const prefixed = /^([a-z]+):(\d+)$/iu.exec(raw);
    if (prefixed) {
        return {
            resourceType: prefixed[1] === 'worldbook' ? REMOTE_RESOURCE_TYPES.WORLDBOOK : REMOTE_RESOURCE_TYPES.CHARACTER,
            id: prefixed[2],
        };
    }

    const id = getNumberId(raw);
    if (!id) {
        throw new Error('Botbooru resource ID is invalid.');
    }
    return { resourceType, id };
}

function formatResourceId(resourceType, id) {
    return `${resourceType}:${id}`;
}

function getNumberId(value) {
    const id = String(value || '').trim();
    return /^\d+$/u.test(id) ? id : '';
}

function formatImageUrl(filename, preview) {
    const name = String(filename || '').trim();
    if (!name) {
        return '';
    }
    return preview
        ? `${BASE_URL}/images/preview/${IMAGE_PREVIEW_SIZE}/${encodeURIComponent(name)}`
        : `${BASE_URL}/images/${encodeURIComponent(name)}`;
}

function formatTags(tags, rating) {
    return [
        rating,
        ...formatArray(tags).map(tag => typeof tag === 'string' ? tag : tag?.name || tag?.label || ''),
    ].map(tag => stripHtml(tag)).filter(Boolean).slice(0, 12);
}

function formatArray(value) {
    return Array.isArray(value) ? value : [];
}

function validatePng(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') {
        throw new Error('Botbooru character PNG payload is invalid.');
    }
}

function validateJson(buffer, message) {
    try {
        JSON.parse(buffer.toString('utf8'));
    } catch {
        throw new Error(message);
    }
}

function safeFileName(value) {
    return String(value || 'botbooru').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 120) || 'botbooru';
}
