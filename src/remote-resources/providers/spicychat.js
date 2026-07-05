import { randomUUID } from 'node:crypto';

import fetch from 'node-fetch';

import {
    REMOTE_RESOURCE_TYPES,
    USER_AGENT,
    clampLimit,
    fetchJson,
    formatRemoteResource,
    stripHtml,
    truncateText,
} from './shared.js';

const SITE_URL = 'https://spicychat.ai';
const API_URL = 'https://prod.nd-api.com';
const ASSET_URL = 'https://cdn.nd-api.com';
const TYPESENSE_URL = 'https://etmzpxgvnid370fyp.a1.typesense.net';
const APPLICATION_ID = 'spicychat';
const COUNTRY = 'SG';
const CHARACTER_QUERY_BY = 'name,title,tags,creator_username,character_id,type';
const CHARACTER_INCLUDE_FIELDS = [
    'name',
    'title',
    'tags',
    'creator_username',
    'character_id',
    'avatar_is_nsfw',
    'avatar_url',
    'visibility',
    'definition_visible',
    'num_messages',
    'token_count',
    'rating_score',
    'lora_status',
    'creator_user_id',
    'is_nsfw',
    'type',
    'sub_characters_count',
    'group_size_category',
    'has_lorebooks',
    'voice_id',
    'group_addable',
].join(',');
const CHARACTER_FILTER = 'application_ids:spicychat && tags:![Step-Family,NSFW,Oral,Vore,Flatulence,Masochistic,Watersport,CNC,Impregnation,Lactation,Anal] && is_nsfw:false && definition_visible:true';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const spicyChatProvider = {
    id: 'spicychat',
    name: 'SpicyChat',
    description: 'SpicyChat 公开 Typesense 角色索引，匿名搜索 SFW 且定义公开的角色并转换为 SillyTavern JSON。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            return { items: [], total: 0 };
        }

        const result = await searchCharacters(params);
        return {
            items: result.items.map(item => formatRemoteResource(this, item)),
            total: result.total,
        };
    },

    async download(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            throw new Error('SpicyChat only supports character downloads.');
        }

        const id = parseCharacterId(params.resourceId);
        const character = await readCharacter(id);
        if (!isDownloadableCharacter(character)) {
            throw new Error('SpicyChat character definition is not publicly downloadable.');
        }

        const card = convertToCharacterCard(character);
        return {
            buffer: Buffer.from(JSON.stringify(card, null, 2), 'utf8'),
            fileName: `${safeFileName(card.data.name || id)}.json`,
            fileType: 'application/json',
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    },
};

async function searchCharacters(params) {
    const limit = clampLimit(params.limit, 24, 48);
    const page = Math.max(Number(params.page) || 1, 1);
    const config = await readApplicationConfig();
    const json = await postTypesenseSearch(config.typesenseConfig.apiKeyAllPublicCharacters, {
        searches: [{
            query_by: CHARACTER_QUERY_BY,
            include_fields: CHARACTER_INCLUDE_FIELDS,
            highlight_fields: 'none',
            enable_highlight_v1: false,
            search_cutoff_ms: 10000,
            sort_by: getSort(params.sort),
            highlight_full_fields: CHARACTER_QUERY_BY,
            collection: config.typesenseConfig.collectionNamePublicCharacter,
            q: String(params.query || '').trim() || '*',
            facet_by: 'definition_size_category,group_size_category,tags,translated_languages',
            filter_by: CHARACTER_FILTER,
            max_facet_values: 100,
            page,
            per_page: limit,
        }],
    });

    const result = json.results?.[0] || {};
    const hits = Array.isArray(result.hits) ? result.hits : [];
    return {
        items: hits.map(hit => convertSearchHit(hit.document)).filter(Boolean),
        total: Number(result.found) || hits.length,
    };
}

async function readApplicationConfig() {
    const { json } = await fetchJson(`${API_URL}/v2/applications/${APPLICATION_ID}`, {
        headers: getApiHeaders(),
    });

    if (!json?.typesenseConfig?.apiKeyAllPublicCharacters || !json.typesenseConfig.collectionNamePublicCharacter) {
        throw new Error('SpicyChat application config does not expose public character search.');
    }
    return json;
}

async function postTypesenseSearch(apiKey, payload) {
    const url = new URL('/multi_search', TYPESENSE_URL);
    url.searchParams.set('use_cache', 'true');
    url.searchParams.set('x-typesense-api-key', apiKey);
    const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'text/plain',
            'User-Agent': USER_AGENT,
        },
        body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`SpicyChat search failed: ${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 200)}` : ''}`);
    }

    const json = JSON.parse(text);
    const first = json.results?.[0];
    if (first?.error) {
        throw new Error(`SpicyChat search failed: ${first.error}`);
    }
    return json;
}

async function readCharacter(id) {
    const { json } = await fetchJson(`${API_URL}/v2/characters/${encodeURIComponent(id)}`, {
        headers: {
            ...getApiHeaders(),
            Origin: SITE_URL,
            Referer: `${SITE_URL}/chatbot/${encodeURIComponent(id)}`,
        },
    });
    if (!json?.id || !json.name) {
        throw new Error('SpicyChat character payload is invalid.');
    }
    return json;
}

function getApiHeaders() {
    return {
        'x-app-id': APPLICATION_ID,
        'x-country': COUNTRY,
        'x-guest-userid': randomUUID(),
    };
}

function convertSearchHit(item) {
    const id = String(item?.character_id || '').trim();
    if (!id || item.is_nsfw || item.definition_visible !== true) {
        return null;
    }

    return {
        id,
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title: item.name || id,
        description: truncateText(stripHtml(item.title || '')),
        author: item.creator_username || '',
        sourceUrl: `${SITE_URL}/chatbot/${encodeURIComponent(id)}`,
        downloadUrl: `${API_URL}/v2/characters/${encodeURIComponent(id)}`,
        thumbnailUrl: resolveAvatarUrl(item.avatar_url),
        tags: [
            ...formatTags(item.tags),
            item.type ? `type:${item.type}` : '',
            item.has_lorebooks ? 'has-lorebooks' : '',
        ].filter(Boolean),
        stats: {
            messages: Number(item.num_messages) || 0,
            tokens: Number(item.token_count) || 0,
            rating: Number(item.rating_score) || 0,
        },
        updatedAt: '',
        capabilities: { download: true },
        metadata: {
            creatorUserId: item.creator_user_id || '',
            definitionVisible: Boolean(item.definition_visible),
            groupSizeCategory: item.group_size_category || '',
            avatarUrl: item.avatar_url || '',
        },
    };
}

function convertToCharacterCard(character) {
    const id = String(character.id || '').trim();
    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: character.name || 'SpicyChat Character',
            description: character.persona || '',
            personality: '',
            scenario: character.scenario || '',
            first_mes: character.greeting || '',
            mes_example: character.dialogue || '',
            creator_notes: character.title || '',
            system_prompt: '',
            post_history_instructions: '',
            alternate_greetings: [],
            tags: formatTags(character.tags),
            creator: character.creator_username || 'SpicyChat',
            character_version: '1',
            extensions: {
                spicychat: {
                    id,
                    type: character.type || '',
                    creatorUserId: character.creator_user_id || '',
                    sourceUrl: id ? `${SITE_URL}/chatbot/${encodeURIComponent(id)}` : '',
                    avatarUrl: resolveAvatarUrl(character.avatar_url, false),
                    messages: Number(character.num_messages) || 0,
                    rating: Number(character.rating_score) || 0,
                    tokenCount: Number(character.token_count) || 0,
                    language: character.language || '',
                },
            },
        },
    };
}

function isDownloadableCharacter(character) {
    return character && character.visibility === 'public' && character.is_nsfw !== true && character.definition_visible === true && (character.persona || character.greeting);
}

function parseCharacterId(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        throw new Error('SpicyChat character ID is required.');
    }

    try {
        const url = new URL(raw);
        if (url.origin === SITE_URL) {
            const match = /^\/(?:chatbot|chat)\/([^/?#]+)/iu.exec(url.pathname);
            if (match) {
                return parseCharacterId(match[1]);
            }
        }
    } catch {
        // Plain UUIDs are the common path.
    }

    if (!UUID_PATTERN.test(raw)) {
        throw new Error('SpicyChat character ID is invalid.');
    }
    return raw.toLowerCase();
}

function resolveAvatarUrl(value, thumbnail = true) {
    const avatar = String(value || '').trim();
    if (!avatar) {
        return '';
    }

    const url = /^https?:\/\//iu.test(avatar) ? avatar : `${ASSET_URL}/${avatar.replace(/^\/+/u, '')}`;
    if (!thumbnail || url.includes('?')) {
        return url;
    }
    return `${url}?class=avatar256x256`;
}

function getSort(value) {
    if (value === 'popular' || value === 'messages') {
        return '_text_match(buckets: 3):desc,num_messages:desc';
    }
    if (value === 'rating') {
        return '_text_match(buckets: 3):desc,rating_score:desc';
    }
    return '_text_match(buckets: 3):desc,num_messages_24h:desc';
}

function formatTags(tags) {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags.map(tag => stripHtml(typeof tag === 'string' ? tag : tag?.name || tag?.label || '')).filter(Boolean).slice(0, 12);
}

function safeFileName(value) {
    return String(value || 'spicychat-character').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 120) || 'spicychat-character';
}
