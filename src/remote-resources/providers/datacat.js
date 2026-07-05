import { randomBytes } from 'node:crypto';

import fetch from 'node-fetch';

import {
    REMOTE_RESOURCE_TYPES,
    USER_AGENT,
    clampLimit,
    formatRemoteResource,
    getPageOffset,
    stripHtml,
    truncateText,
} from './shared.js';

const SITE_URL = 'https://datacat.run';
const API_URL = `${SITE_URL}/api`;
const SESSION_TTL_MS = 30 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SOURCE_SEGMENTS = Object.freeze({
    janitor_core: 'janitor',
    jannyai: 'jannyai',
    direct_upload: 'vault',
});
const SEGMENT_SOURCES = Object.freeze(Object.fromEntries(Object.entries(SOURCE_SEGMENTS).map(([key, value]) => [value, key])));

let datacatSession = null;

export const datacatProvider = {
    id: 'datacat',
    name: 'DataCat',
    description: 'DataCat 匿名 session API，搜索 JanitorAI/JannyAI 聚合角色并下载 SillyTavern JSON。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            return { items: [], total: 0 };
        }

        const limit = clampLimit(params.limit, 24, 50);
        const offset = getPageOffset(params.page, limit);
        const query = String(params.query || '').trim();
        const searchParams = new URLSearchParams({
            limit: String(limit),
            offset: String(offset),
            summary: '1',
            skipCount: '1',
        });
        if (query) {
            searchParams.set('search', query);
        }

        const json = await datacatApi(`/characters/recent-public?${searchParams.toString()}`);
        const characters = Array.isArray(json?.characters) ? json.characters : [];
        return {
            items: characters.map(character => formatRemoteResource(this, convertSearchItem(character))).filter(Boolean),
            total: Number(json?.totalCount) || offset + characters.length + (json?.hasMore ? limit : 0),
        };
    },

    async download(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            throw new Error('DataCat only supports character downloads.');
        }

        const parsed = parseResourceId(params.resourceId);
        const query = new URLSearchParams({ t: String(Date.now()) });
        if (parsed.sourceKind) {
            query.set('sourceKind', parsed.sourceKind);
        }

        const card = await datacatApi(`/characters/${encodeURIComponent(parsed.id)}/download?${query.toString()}`);
        if (!card?.spec || !card?.data?.name) {
            throw new Error('DataCat character payload is invalid.');
        }

        return {
            buffer: Buffer.from(JSON.stringify(card, null, 2), 'utf8'),
            fileName: `${safeFileName(card.data.name || parsed.id)}.json`,
            fileType: 'application/json',
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    },
};

async function datacatApi(pathName, options = {}) {
    const session = await getDatacatSession();
    const response = await fetch(`${API_URL}${pathName}`, {
        method: options.method || 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
            'X-Session-Token': session.sessionToken,
            'X-Device-Token': session.deviceToken,
            ...options.headers,
        },
        body: options.body,
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if ((response.status === 401 || response.status === 403) && options.retry !== false) {
        datacatSession = null;
        return await datacatApi(pathName, { ...options, retry: false });
    }
    if (!response.ok || json?.success === false) {
        throw new Error(`DataCat request failed: ${response.status} ${response.statusText}${json?.error || json?.message ? ` - ${json.error || json.message}` : ''}`);
    }
    return json;
}

async function getDatacatSession() {
    if (datacatSession && Date.now() - datacatSession.createdAt < SESSION_TTL_MS) {
        return datacatSession;
    }

    const deviceToken = `anon_${randomBytes(16).toString('hex')}_${Date.now().toString(36)}`;
    const response = await fetch(`${API_URL}/liberator/identify`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({ deviceToken }),
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok || !json?.success || !json.sessionToken) {
        throw new Error(`DataCat session initialization failed: ${response.status} ${response.statusText}${json?.error || json?.message ? ` - ${json.error || json.message}` : ''}`);
    }

    datacatSession = {
        deviceToken,
        sessionToken: String(json.sessionToken),
        createdAt: Date.now(),
    };
    return datacatSession;
}

function convertSearchItem(character) {
    const id = String(character?.characterId || character?.character_id || '').trim();
    if (!id) {
        return null;
    }

    const sourceKind = String(character.primaryContentSourceKind || character.primary_content_source_kind || 'janitor_core').trim() || 'janitor_core';
    const sourceSegment = SOURCE_SEGMENTS[sourceKind] || sourceKind;
    const title = character.name || character.chatName || id;
    const tags = [
        character.isNsfw || character.is_nsfw ? 'NSFW' : '',
        ...formatTags(character.tags),
    ].filter(Boolean);

    return {
        id: `${sourceKind}:${id}`,
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title,
        description: truncateText(stripHtml(character.description || character.rawDescription || '')),
        author: character.creatorName || character.creator_name || '',
        sourceUrl: `${SITE_URL}/characters/recent/${encodeURIComponent(sourceSegment)}/${encodeURIComponent(id)}`,
        downloadUrl: `${API_URL}/characters/${encodeURIComponent(id)}/download`,
        thumbnailUrl: getAvatarUrl(character),
        tags,
        stats: {
            chats: Number(character.stats?.chat) || 0,
            messages: Number(character.stats?.message) || 0,
            tokens: Number(character.totalTokens || character.total_tokens || character.tokenCounts?.total_tokens || character.token_counts?.total_tokens) || 0,
        },
        updatedAt: character.extractedAt || character.extracted_at || character.createdAt || character.created_at || '',
        capabilities: { download: true },
        metadata: {
            characterId: id,
            sourceKind,
            creatorId: character.creatorId || character.creator_id || '',
            contentHash: character.contentHash || character.content_hash || '',
            nsfw: Boolean(character.isNsfw || character.is_nsfw),
        },
    };
}

function parseResourceId(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        throw new Error('DataCat character ID is required.');
    }

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return parseResourceId(parsed.id || parsed.characterId || parsed.character_id || parsed.sourceUrl);
        }
    } catch {
        // Plain IDs and URLs are the common paths.
    }

    try {
        const url = new URL(raw);
        if (url.origin === SITE_URL) {
            const match = /^\/characters\/recent\/([^/?#]+)\/([^/?#]+)/iu.exec(url.pathname);
            if (match) {
                return {
                    sourceKind: SEGMENT_SOURCES[decodeURIComponent(match[1])] || decodeURIComponent(match[1]),
                    id: parseUuid(decodeURIComponent(match[2])),
                };
            }
        }
    } catch {
        // Continue with plain ID parsing.
    }

    const [maybeSourceKind, maybeId] = raw.includes(':') ? raw.split(':', 2) : ['', raw];
    return {
        sourceKind: maybeSourceKind || 'janitor_core',
        id: parseUuid(maybeId),
    };
}

function parseUuid(value) {
    const id = String(value || '').trim();
    if (!UUID_PATTERN.test(id)) {
        throw new Error('DataCat character ID is invalid.');
    }
    return id.toLowerCase();
}

function getAvatarUrl(character) {
    return character.avatarDisplayUrl
        || character.avatar_display_url
        || character.avatarVariantUrls?.card
        || character.avatar_variant_urls?.card
        || character.avatar
        || '';
}

function formatTags(tags) {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags.map(tag => stripHtml(typeof tag === 'string' ? tag : tag?.name || tag?.label || tag?.slug || '')).filter(Boolean).slice(0, 12);
}

function safeFileName(value) {
    return String(value || 'datacat-character').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 120) || 'datacat-character';
}
