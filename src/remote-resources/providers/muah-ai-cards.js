import path from 'node:path';

import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchBuffer,
    fetchJson,
    formatRemoteResource,
    stripHtml,
    truncateText,
} from './shared.js';

const BASE_URL = 'https://card.muah.ai';
const POSTS_ENDPOINT = `${BASE_URL}/wp-json/wp/v2/posts`;
const MAX_PAGE = 50;

export const muahAiCardsProvider = {
    id: 'muah-ai-cards',
    name: 'Muah AI Cards',
    description: 'Muah AI 公开 WordPress 角色卡库，匿名搜索帖子并下载 featured media PNG 角色卡。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            return { items: [], total: 0 };
        }

        const limit = clampLimit(params.limit);
        const page = clampPage(params.page);
        const url = new URL(POSTS_ENDPOINT);
        url.searchParams.set('per_page', String(limit));
        url.searchParams.set('page', String(page));
        url.searchParams.set('_embed', '1');
        const query = String(params.query || '').trim();
        if (query) {
            url.searchParams.set('search', query);
        }

        const { response, json } = await fetchJson(url.toString());
        const posts = Array.isArray(json) ? json : [];
        return {
            items: posts.map(convertPost).filter(Boolean).map(item => formatRemoteResource(this, item)),
            total: Number(response.headers.get('x-wp-total')) || posts.length,
        };
    },

    async download(params) {
        const resource = parseResourceId(params.resourceId);
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            throw new Error('Muah AI Cards only supports character downloads.');
        }
        validateDownloadUrl(resource.downloadUrl);

        const { response, buffer } = await fetchBuffer(resource.downloadUrl);
        if (!isPng(buffer)) {
            throw new Error('Muah AI character card is not a PNG file.');
        }

        return {
            buffer,
            fileName: getDownloadFileName(resource.downloadUrl),
            fileType: response.headers.get('content-type') || 'image/png',
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    },
};

function convertPost(post) {
    const media = getFeaturedMedia(post);
    const downloadUrl = media?.source_url || '';
    if (!downloadUrl || !isAllowedPngUrl(downloadUrl)) {
        return null;
    }

    const title = stripHtml(post.title?.rendered || media.title?.rendered || post.slug || 'Muah AI Character');
    const terms = getEmbeddedTerms(post);
    const author = post._embedded?.author?.[0]?.name || 'Muah AI';
    return {
        id: formatResourceId(post, downloadUrl),
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title,
        description: truncateText(stripHtml(post.excerpt?.rendered || media.caption?.rendered || '')),
        author,
        sourceUrl: post.link || BASE_URL,
        downloadUrl,
        thumbnailUrl: downloadUrl,
        tags: ['Muah AI Cards', ...terms],
        updatedAt: post.modified_gmt || post.date_gmt || post.date || '',
        stats: {
            id: Number(post.id) || 0,
        },
        capabilities: { download: true },
        metadata: {
            postId: post.id,
            slug: post.slug || '',
            mediaId: media.id || post.featured_media || '',
        },
    };
}

function getFeaturedMedia(post) {
    const media = post?._embedded?.['wp:featuredmedia'];
    if (!Array.isArray(media) || !media.length) {
        return null;
    }
    return media.find(item => item?.source_url && item.mime_type === 'image/png') || media[0];
}

function getEmbeddedTerms(post) {
    const terms = post?._embedded?.['wp:term'];
    if (!Array.isArray(terms)) {
        return [];
    }
    return terms.flatMap(group => Array.isArray(group) ? group : []).map(term => stripHtml(term.name || '')).filter(Boolean).slice(0, 8);
}

function formatResourceId(post, downloadUrl) {
    return JSON.stringify({
        postId: Number(post.id) || 0,
        sourceUrl: post.link || '',
        downloadUrl,
    });
}

function parseResourceId(value) {
    try {
        const parsed = JSON.parse(String(value || ''));
        return {
            postId: Number(parsed.postId) || 0,
            sourceUrl: String(parsed.sourceUrl || ''),
            downloadUrl: String(parsed.downloadUrl || ''),
        };
    } catch {
        throw new Error('Muah AI Cards resource ID is invalid.');
    }
}

function validateDownloadUrl(value) {
    if (!isAllowedPngUrl(value)) {
        throw new Error('Muah AI Cards download URL is not allowed.');
    }
}

function isAllowedPngUrl(value) {
    try {
        const url = new URL(value);
        return url.origin === BASE_URL && url.pathname.startsWith('/wp-content/uploads/') && path.extname(url.pathname).toLowerCase() === '.png';
    } catch {
        return false;
    }
}

function getDownloadFileName(value) {
    try {
        return decodeURIComponent(path.basename(new URL(value).pathname)) || 'muah-character.png';
    } catch {
        return 'muah-character.png';
    }
}

function clampPage(page) {
    const parsed = Number(page);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 1;
    }
    return Math.min(Math.floor(parsed), MAX_PAGE);
}

function isPng(buffer) {
    return buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
}
