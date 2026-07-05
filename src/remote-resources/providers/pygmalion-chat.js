import fetch from 'node-fetch';

import {
    REMOTE_RESOURCE_TYPES,
    USER_AGENT,
    clampLimit,
    formatRemoteResource,
    stripHtml,
    truncateText,
} from './shared.js';

const SITE_URL = 'https://pygmalion.chat';
const API_URL = 'https://server.pygmalion.chat';
const PUBLIC_CHARACTER_SERVICE = `${API_URL}/galatea.v1.PublicCharacterService`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const pygmalionChatProvider = {
    id: 'pygmalion-chat',
    name: 'Pygmalion Chat',
    description: 'Pygmalion.chat 公开 Connect JSON 角色卡接口，匿名搜索公开 Cards 并转换为 SillyTavern JSON。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            return { items: [], total: 0 };
        }

        const limit = clampLimit(params.limit, 24, 50);
        const page = Math.max(Number(params.page) || 1, 1) - 1;
        const json = await connectJson('CharacterSearch', {
            query: String(params.query || '').trim(),
            page,
            pageSize: limit,
            orderBy: 'downloads',
            orderDescending: true,
            includeSensitive: false,
        });
        const characters = Array.isArray(json.characters) ? json.characters : [];

        return {
            items: characters.map(item => formatRemoteResource(this, convertSearchItem(item))),
            total: Number(json.totalItems) || characters.length,
        };
    },

    async download(params) {
        const resource = parseResourceId(params.resourceId);
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            throw new Error('Pygmalion Chat only supports character downloads.');
        }

        const json = await connectJson('Character', {
            characterMetaId: resource.id,
            characterVersionId: resource.versionId || '',
        });
        if (!json?.character?.id || !json.character.displayName) {
            throw new Error('Pygmalion Chat character payload is invalid.');
        }

        const card = convertToCharacterCard(json.character);
        return {
            buffer: Buffer.from(JSON.stringify(card, null, 2), 'utf8'),
            fileName: `${safeFileName(card.data.name || resource.id)}.json`,
            fileType: 'application/json',
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    },
};

async function connectJson(method, payload) {
    const response = await fetch(`${PUBLIC_CHARACTER_SERVICE}/${method}`, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Origin': SITE_URL,
            'Referer': `${SITE_URL}/explore`,
            'User-Agent': USER_AGENT,
        },
        body: JSON.stringify(payload),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`Pygmalion Chat ${method} failed: ${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 200)}` : ''}`);
    }
    return JSON.parse(text);
}

function convertSearchItem(item) {
    const id = String(item?.id || '').trim();
    const versionId = String(item?.versionId || '').trim();
    return {
        id: formatResourceId(id, versionId),
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title: item.displayName || id,
        description: truncateText(stripHtml(item.description || '')),
        author: item.owner?.displayName || item.owner?.username || '',
        sourceUrl: `${SITE_URL}/character/${encodeURIComponent(id)}`,
        downloadUrl: `${PUBLIC_CHARACTER_SERVICE}/Character`,
        thumbnailUrl: item.avatarUrl || '',
        tags: [
            item.isSensitive ? 'sensitive' : '',
            ...formatTags(item.tags),
        ].filter(Boolean),
        stats: {
            stars: Number(item.stars) || 0,
            views: Number(item.views) || 0,
            downloads: Number(item.downloads) || 0,
            chats: Number(item.chatCount) || 0,
            tokens: Number(item.personalityTokenCount) || 0,
        },
        updatedAt: formatUnixTime(item.updatedAt || item.createdAt),
        capabilities: { download: Boolean(id) },
        metadata: {
            id,
            versionId,
            ownerId: item.owner?.id || '',
            source: item.source || '',
            avatarUrl: item.avatarUrl || '',
        },
    };
}

function convertToCharacterCard(character) {
    const personality = character.personality && typeof character.personality === 'object' ? character.personality : {};
    const tags = formatTags(character.tags);
    const id = String(character.id || '').trim();
    const creator = personality.creator || character.owner?.username || character.owner?.displayName || 'Pygmalion Chat';

    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: personality.name || character.displayName || 'Pygmalion Character',
            description: personality.persona || character.description || '',
            personality: character.description || '',
            scenario: personality.scenario || '',
            first_mes: personality.greeting || '',
            mes_example: personality.mesExample || '',
            creator_notes: personality.characterNotes || character.description || '',
            alternate_greetings: Array.isArray(personality.alternateGreetings) ? personality.alternateGreetings.filter(Boolean) : [],
            tags,
            creator,
            character_version: character.versionLabel || character.versionId || '1',
            extensions: {
                pygmalion_chat: {
                    id,
                    versionId: character.versionId || '',
                    versionLabel: character.versionLabel || '',
                    sourceUrl: id ? `${SITE_URL}/character/${encodeURIComponent(id)}` : '',
                    avatarUrl: character.avatarUrl || '',
                    chatBackgroundUrl: character.chatBackgroundUrl || '',
                    source: character.source || '',
                    ownerId: character.ownerId || '',
                    ownerName: character.owner?.displayName || character.owner?.username || '',
                    stats: {
                        stars: Number(character.stars) || 0,
                        views: Number(character.views) || 0,
                        downloads: Number(character.downloads) || 0,
                        chats: Number(character.chatCount) || 0,
                        tokens: Number(character.personalityTokenCount) || 0,
                    },
                    createdAt: formatUnixTime(character.createdAt),
                    updatedAt: formatUnixTime(character.updatedAt),
                },
            },
        },
    };
}

function parseResourceId(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        throw new Error('Pygmalion Chat character ID is required.');
    }

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return {
                id: parseCharacterId(parsed.id || parsed.characterMetaId || parsed.characterId),
                versionId: String(parsed.versionId || parsed.characterVersionId || ''),
            };
        }
    } catch {
        // Plain UUIDs and URLs are accepted below.
    }

    return { id: parseCharacterId(raw), versionId: '' };
}

function parseCharacterId(value) {
    const raw = String(value || '').trim();
    try {
        const url = new URL(raw);
        if (url.origin === SITE_URL) {
            const match = /^\/character\/([^/?#]+)/iu.exec(url.pathname);
            if (match) {
                return parseCharacterId(match[1]);
            }
        }
    } catch {
        // Continue with plain UUID validation.
    }

    if (!UUID_PATTERN.test(raw)) {
        throw new Error('Pygmalion Chat character ID is invalid.');
    }
    return raw.toLowerCase();
}

function formatResourceId(id, versionId) {
    return JSON.stringify({ id, versionId });
}

function formatTags(tags) {
    return Array.isArray(tags) ? tags.map(tag => String(tag || '').trim()).filter(Boolean) : [];
}

function formatUnixTime(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return '';
    }
    return new Date(timestamp * 1000).toISOString();
}

function safeFileName(value) {
    return String(value || 'pygmalion-character').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 120) || 'pygmalion-character';
}
