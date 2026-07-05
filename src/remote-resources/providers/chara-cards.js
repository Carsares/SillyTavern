import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchJson,
    formatRemoteResource,
    getPageOffset,
    stripHtml,
    truncateText,
} from './shared.js';

const SITE_URL = 'https://chara.cards';
const API_URL = 'https://edge-api.chara.cards/api';
const ASSET_URL = 'https://agnai-assets.sgp1.cdn.digitaloceanspaces.com';
const SORT_OPTIONS = new Set(['updatedAt', 'createdAt', 'name', 'views', 'downloads']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const charaCardsProvider = {
    id: 'chara-cards',
    name: 'Chara Cards',
    description: 'Chara.cards 公开 Agnai 角色卡 API，匿名搜索公开角色并转换为 SillyTavern JSON。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            return { items: [], total: 0 };
        }

        const limit = clampLimit(params.limit, 24, 60);
        const offset = getPageOffset(params.page, limit);
        const url = new URL('/api/bot/search', API_URL);
        url.searchParams.set('text', String(params.query || '').trim());
        url.searchParams.set('sort', getSort(params.sort));
        url.searchParams.set('tags', '');

        const { json } = await fetchJson(url.toString(), { headers: { 'Origin': SITE_URL, 'Referer': `${SITE_URL}/` } });
        const results = Array.isArray(json.results) ? json.results : [];
        return {
            items: results.slice(offset, offset + limit).map(item => formatRemoteResource(this, convertSearchItem(item))),
            total: results.length,
        };
    },

    async download(params) {
        const id = parseCharacterId(params.resourceId);
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            throw new Error('Chara Cards only supports character downloads.');
        }

        const { json } = await fetchJson(`${API_URL}/bot/${encodeURIComponent(id)}/public`, { headers: { 'Origin': SITE_URL, 'Referer': `${SITE_URL}/bot/${encodeURIComponent(id)}` } });
        if (!json?._id || !json.name) {
            throw new Error('Chara Cards character payload is invalid.');
        }

        const card = convertToCharacterCard(json);
        return {
            buffer: Buffer.from(JSON.stringify(card, null, 2), 'utf8'),
            fileName: `${safeFileName(card.data.name || id)}.json`,
            fileType: 'application/json',
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    },
};

function convertSearchItem(item) {
    const id = String(item?._id || '').trim();
    return {
        id,
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title: item.name || id,
        description: truncateText(stripHtml(item.description || item.byline || item.personality || '')),
        author: item.creator || '',
        sourceUrl: `${SITE_URL}/bot/${encodeURIComponent(id)}`,
        downloadUrl: `${API_URL}/bot/${encodeURIComponent(id)}/public`,
        thumbnailUrl: resolveAssetUrl(item.avatar),
        tags: [
            item.nsfw ? 'NSFW' : '',
            ...formatTags(item.tags),
        ].filter(Boolean),
        stats: {
            downloads: Number(item.metadata?.downloads) || 0,
            views: Number(item.metadata?.views) || 0,
            favorites: Number(item.metadata?.favorites) || 0,
            messages: Number(item.metadata?.messages) || 0,
        },
        updatedAt: item.updatedAt || item.createdAt || '',
        capabilities: { download: Boolean(id) },
        metadata: {
            publicId: id,
            userId: item.userId || '',
            avatar: item.avatar || '',
        },
    };
}

function convertToCharacterCard(character) {
    const id = String(character._id || '').trim();
    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: character.name || 'Chara Cards Character',
            description: character.description || character.byline || '',
            personality: character.personality || '',
            scenario: character.scenario || '',
            first_mes: character.greeting || '',
            mes_example: character.sampleChat || '',
            creator_notes: character.description || character.byline || '',
            system_prompt: character.systemPrompt || '',
            post_history_instructions: character.jailbreak || '',
            alternate_greetings: Array.isArray(character.altGreetings) ? character.altGreetings.filter(Boolean) : [],
            tags: [
                character.nsfw ? 'NSFW' : '',
                ...formatTags(character.tags),
            ].filter(Boolean),
            creator: character.creator || 'Chara Cards',
            character_version: String(character.version || '1'),
            extensions: {
                chara_cards: {
                    id,
                    userId: character.userId || '',
                    avatar: character.avatar || '',
                    sourceUrl: id ? `${SITE_URL}/bot/${encodeURIComponent(id)}` : '',
                    createdAt: character.createdAt || '',
                    updatedAt: character.updatedAt || '',
                },
            },
        },
    };
}

function parseCharacterId(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        throw new Error('Chara Cards character ID is required.');
    }

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return parseCharacterId(parsed.id || parsed.publicId || parsed._id);
        }
    } catch {
        // Plain IDs and URLs are the common paths.
    }

    try {
        const url = new URL(raw);
        if (url.origin === SITE_URL) {
            const match = /^\/bot\/([^/?#]+)/iu.exec(url.pathname);
            if (match) {
                return parseCharacterId(match[1]);
            }
        }
    } catch {
        // Continue with plain ID validation.
    }

    if (!UUID_PATTERN.test(raw)) {
        throw new Error('Chara Cards character ID is invalid.');
    }
    return raw.toLowerCase();
}

function resolveAssetUrl(value) {
    const asset = String(value || '').trim();
    if (!asset) {
        return '';
    }
    if (/^(https?:|data:)/iu.test(asset)) {
        return asset;
    }
    return `${ASSET_URL}${asset.startsWith('/') ? asset : `/${asset}`}`;
}

function getSort(value) {
    const sort = String(value || 'updatedAt').trim();
    return SORT_OPTIONS.has(sort) ? sort : 'updatedAt';
}

function formatTags(tags) {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags.map(tag => stripHtml(typeof tag === 'string' ? tag : tag?.name || tag?.label || '')).filter(Boolean).slice(0, 8);
}

function safeFileName(value) {
    return String(value || 'chara-cards-character').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 120) || 'chara-cards-character';
}
