import fetch from 'node-fetch';
import { decode } from 'html-entities';

import {
    REMOTE_RESOURCE_TYPES,
    USER_AGENT,
    clampLimit,
    formatRemoteResource,
    getPageOffset,
    stripHtml,
    truncateText,
} from './shared.js';

const BASE_URL = 'https://jannyai.com';
const IMAGE_BASE_URL = 'https://image.jannyai.com';
const SEARCH_URL = 'https://search.jannyai.com/indexes/janny-characters/search';
const SEARCH_KEY = '88a6463b66e04fb07ba87ee3db06af337f492ce511d93df6e2d2968cb2ff2b30';
const SEARCH_FILTER = 'totalToken <= 4101 AND totalToken >= 29';
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export const jannyAiProvider = {
    id: 'jannyai',
    name: 'JannyAI',
    description: 'JannyAI 公开 Meilisearch 角色索引，详情页匿名读取并转换为 SillyTavern 角色 JSON。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            return { items: [], total: 0 };
        }

        const limit = clampLimit(params.limit, 24, 40);
        const offset = getPageOffset(params.page, limit);
        const query = String(params.query || '').trim();
        const payload = {
            q: query,
            limit,
            offset,
            filter: SEARCH_FILTER,
            attributesToRetrieve: ['name', 'description', 'id', 'avatar', 'tagIds', 'isNsfw', 'permanentToken', 'totalToken', 'isLowQuality', 'createdAt', 'createdAtStamp'],
            attributesToCrop: ['description:50'],
            attributesToHighlight: ['name', 'description'],
        };
        if (!query) {
            payload.sort = ['createdAtStamp:desc'];
        }

        const json = await postSearch(payload);
        const hits = Array.isArray(json.hits) ? json.hits : [];
        return {
            items: hits.map(item => formatRemoteResource(this, convertSearchHit(item))),
            total: Number(json.estimatedTotalHits) || hits.length,
        };
    },

    async download(params) {
        const id = getCharacterId(params.resourceId);
        const response = await fetch(`${BASE_URL}/characters/${encodeURIComponent(id)}`, {
            headers: {
                'Accept': 'text/html,*/*;q=0.8',
                'User-Agent': USER_AGENT,
            },
        });
        if (!response.ok) {
            throw new Error(`JannyAI character detail request failed: ${response.status} ${response.statusText}`);
        }

        const html = await response.text();
        const character = extractCharacter(html);
        const card = convertToCharacterCard(character);
        const buffer = Buffer.from(JSON.stringify(card, null, 2), 'utf8');

        return {
            buffer,
            fileName: `${safeFileName(card.data.name || id)}.json`,
            fileType: 'application/json',
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    },
};

async function postSearch(payload) {
    const response = await fetch(SEARCH_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${SEARCH_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': USER_AGENT,
        },
        body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`JannyAI search failed: ${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 200)}` : ''}`);
    }
    return JSON.parse(text);
}

function convertSearchHit(item) {
    const id = String(item.id || '').trim();
    return {
        id,
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title: item.name || id,
        description: truncateText(stripHtml(item.description || '')),
        author: '',
        sourceUrl: `${BASE_URL}/characters/${encodeURIComponent(id)}`,
        downloadUrl: `${BASE_URL}/characters/${encodeURIComponent(id)}`,
        thumbnailUrl: item.avatar ? `${IMAGE_BASE_URL}/bot-avatars/${encodeURIComponent(item.avatar)}` : '',
        tags: [
            item.isNsfw ? 'NSFW' : '',
            item.isLowQuality ? 'low-quality' : '',
        ].filter(Boolean),
        stats: {
            tokens: Number(item.totalToken) || 0,
            permanentTokens: Number(item.permanentToken) || 0,
        },
        updatedAt: item.createdAt || '',
        capabilities: { download: Boolean(id) },
        metadata: {
            jannyKind: 'character',
            createdAtStamp: Number(item.createdAtStamp) || 0,
            tagIds: Array.isArray(item.tagIds) ? item.tagIds : [],
        },
    };
}

function extractCharacter(html) {
    const match = /<astro-island\b(?=[^>]*component-export="CharacterButtons")[^>]*\sprops="([^"]*)"/i.exec(html);
    if (!match) {
        throw new Error('JannyAI character detail payload was not found.');
    }

    const props = unwrapAstroValue(JSON.parse(decode(match[1])));
    if (!props?.character?.id) {
        throw new Error('JannyAI character detail payload is invalid.');
    }
    return props.character;
}

function unwrapAstroValue(value) {
    if (Array.isArray(value)) {
        if (Number.isInteger(value[0])) {
            if (value[0] === 1) {
                return Array.isArray(value[1]) ? value[1].map(unwrapAstroValue) : [];
            }
            return unwrapAstroValue(value[1]);
        }
        return value.map(unwrapAstroValue);
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, unwrapAstroValue(nested)]));
    }

    return value;
}

function convertToCharacterCard(character) {
    const creatorNotes = stripHtml(character.description || '');
    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: character.name || 'JannyAI Character',
            description: character.personality || '',
            personality: creatorNotes,
            scenario: character.scenario || '',
            first_mes: character.firstMessage || '',
            mes_example: character.exampleDialogs || '',
            creator_notes: creatorNotes,
            alternate_greetings: [],
            tags: [
                character.isNsfw ? 'NSFW' : '',
                character.isLowQuality ? 'low-quality' : '',
            ].filter(Boolean),
            creator: character.creatorName || 'JannyAI',
            character_version: '1',
            extensions: {
                jannyai: {
                    id: character.id || '',
                    creatorId: character.creatorId || '',
                    avatar: character.avatar || '',
                    tagIds: Array.isArray(character.tagIds) ? character.tagIds : [],
                    sourceUrl: character.id ? `${BASE_URL}/characters/${encodeURIComponent(character.id)}` : '',
                },
            },
        },
    };
}

function getCharacterId(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        throw new Error('JannyAI character ID is required.');
    }

    try {
        const url = new URL(raw);
        const match = /^\/characters\/([^/?#]+)/i.exec(url.pathname);
        if (url.origin === BASE_URL && match) {
            return getCharacterId(match[1]);
        }
    } catch {
        // The common path is a plain UUID from the search result.
    }

    const match = UUID_PATTERN.exec(raw);
    if (!match) {
        throw new Error('JannyAI character ID is invalid.');
    }
    return match[0].toLowerCase();
}

function safeFileName(value) {
    return String(value || 'jannyai-character').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 120) || 'jannyai-character';
}
