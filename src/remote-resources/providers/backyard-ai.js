import fetch from 'node-fetch';

import {
    REMOTE_RESOURCE_TYPES,
    USER_AGENT,
    clampLimit,
    formatRemoteResource,
    stripHtml,
    truncateText,
} from './shared.js';

const SITE_URL = 'https://backyard.ai';
const TRPC_URL = `${SITE_URL}/api/trpc`;
const RESOURCE_ID_PATTERN = /^[a-z0-9]{20,32}$/iu;

export const backyardAiProvider = {
    id: 'backyard-ai',
    name: 'Backyard AI',
    description: 'Backyard AI Community Hub 公开 tRPC 接口，匿名搜索角色并转换为 SillyTavern JSON。',
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
        const result = await searchCharacters(params, offset + limit);
        return {
            items: result.items.slice(offset, offset + limit).map(item => formatRemoteResource(this, item)),
            total: result.total,
        };
    },

    async download(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            throw new Error('Backyard AI only supports character downloads.');
        }

        const id = parseResourceId(params.resourceId);
        const character = await readCharacter(id);
        if (!isDownloadableCharacter(character)) {
            throw new Error('Backyard AI character definition is not publicly downloadable.');
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

async function searchCharacters(params, minimumCount) {
    const query = String(params.query || '').trim();
    if (query && query.length < 3) {
        return { items: [], total: 0 };
    }

    const procedure = query ? 'hub.browse.getHubGroupConfigsBySearch' : 'hub.browse.getHubGroupConfigsBySortType';
    const baseInput = query
        ? { query, sortBy: getSearchSort(params.sort) }
        : { sortBy: getBrowseSort(params.sort) };
    const groups = [];
    let cursor = undefined;
    let nextCursor = undefined;

    do {
        const page = await readTrpc(procedure, cursor === undefined ? baseInput : { ...baseInput, cursor });
        const pageGroups = Array.isArray(page?.hubGroupConfigs) ? page.hubGroupConfigs : [];
        groups.push(...pageGroups);
        nextCursor = Number.isFinite(Number(page?.nextCursor)) ? Number(page.nextCursor) : undefined;
        if (!pageGroups.length) {
            break;
        }
        cursor = nextCursor;
    } while (groups.length < minimumCount && nextCursor !== undefined && nextCursor > 0);

    const items = groups.flatMap(convertGroupToSearchItems).filter(Boolean);
    return { items, total: Math.max(items.length, groups.length) };
}

async function readCharacter(id) {
    const character = await readTrpc('hub.browse.getHubCharacterConfigById', {
        hubCharacterConfigId: id,
        includeStandaloneGroupConfig: true,
    });
    if (!character?.id || !character.name) {
        throw new Error('Backyard AI character payload is invalid.');
    }
    return character;
}

async function readTrpc(procedure, input) {
    const url = new URL(`${TRPC_URL}/${procedure}`);
    url.searchParams.set('batch', '1');
    url.searchParams.set('input', JSON.stringify({ 0: { json: input } }));

    const response = await fetch(url.toString(), {
        headers: {
            Accept: 'application/json',
            Referer: `${SITE_URL}/hub`,
            'User-Agent': USER_AGENT,
        },
        // 加 20s 超时，避免第三方站点不响应时挂住聚合搜索。
        signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`Backyard AI request failed: ${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 200)}` : ''}`);
    }

    const payload = JSON.parse(text);
    const item = Array.isArray(payload) ? payload[0] : payload;
    if (item?.error) {
        throw new Error(`Backyard AI request failed: ${item.error.message || item.error.code || 'unknown error'}`);
    }
    return item?.result?.data?.json;
}

function convertGroupToSearchItems(group) {
    if (!group || group.isNSFW || group.banned) {
        return [];
    }

    const characters = Array.isArray(group.CharacterConfigs) ? group.CharacterConfigs : [];
    return characters
        .filter(character => character?.id && !character.isNSFW && !character.banned)
        .map(character => convertCharacterToSearchItem(character, group));
}

function convertCharacterToSearchItem(character, group) {
    const id = String(character.id || '').trim();
    const name = character.displayName || character.name || group.name || id;
    const author = character.Author?.username || group.Author?.username || '';
    const tags = [...formatTags(character.Tags), ...formatTags(group.Tags)].filter((tag, index, all) => all.indexOf(tag) === index);

    return {
        id,
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title: name,
        description: truncateText(stripHtml(character.tagline || group.tagline || character.persona || '')),
        author,
        sourceUrl: `${SITE_URL}/hub/character/${encodeURIComponent(id)}`,
        downloadUrl: `${TRPC_URL}/hub.browse.getHubCharacterConfigById`,
        thumbnailUrl: getImageUrl(character.Images) || getImageUrl(group.Images),
        tags,
        stats: {
            downloads: Number(character.downloadCount ?? group.downloadCount) || 0,
            messages: Number(character.messageCount ?? group.messageCount) || 0,
            tokens: Number(character.tokenCount ?? group.tokenCount) || 0,
        },
        updatedAt: character.updatedAt || group.updatedAt || '',
        capabilities: { download: true },
        metadata: {
            groupId: group.id || '',
            groupName: group.name || '',
            versionId: character.versionId || '',
            imageCount: Array.isArray(character.Images) ? character.Images.length : 0,
        },
    };
}

function convertToCharacterCard(character) {
    const group = character.standaloneGroupConfig || {};
    const chat = group.PrimaryChat || {};
    const nameById = getCharacterNameMap(group.CharacterConfigs || [character]);
    const displayName = character.displayName || character.name || 'Backyard AI Character';
    const greetings = formatMessages(chat.HubGreetingMessages, nameById, displayName);
    const examples = formatMessages(chat.HubExampleMessages, nameById, displayName);

    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: displayName,
            description: replaceBackyardMacros(character.persona, nameById, displayName),
            personality: '',
            scenario: replaceBackyardMacros(chat.context, nameById, displayName),
            first_mes: greetings[0] || '',
            mes_example: formatExampleMessages(examples),
            creator_notes: replaceBackyardMacros(character.creatorNotes || group.creatorNotes || character.tagline || group.tagline || '', nameById, displayName),
            system_prompt: getSystemPrompt(chat.modelInstructions, nameById, displayName),
            post_history_instructions: '',
            alternate_greetings: greetings.slice(1),
            character_book: convertCharacterBook(character.LorebookItems, nameById, displayName),
            tags: [
                character.isNSFW || group.isNSFW ? 'NSFW' : '',
                ...formatTags(character.Tags),
                ...formatTags(group.Tags),
            ].filter((tag, index, all) => tag && all.indexOf(tag) === index),
            creator: character.Author?.username || group.Author?.username || 'Backyard AI',
            character_version: String(character.versionId || ''),
            extensions: {
                backyard_ai: {
                    id: character.id || '',
                    groupId: group.id || '',
                    sourceUrl: character.id ? `${SITE_URL}/hub/character/${encodeURIComponent(character.id)}` : '',
                    authorId: character.Author?.id || group.Author?.id || '',
                    images: formatImages(character.Images),
                    createdAt: character.createdAt || group.createdAt || '',
                    updatedAt: character.updatedAt || group.updatedAt || '',
                    downloadCount: Number(character.downloadCount ?? group.downloadCount) || 0,
                    messageCount: Number(character.messageCount ?? group.messageCount) || 0,
                    tokenCount: Number(character.tokenCount ?? group.tokenCount) || 0,
                },
            },
        },
    };
}

function convertCharacterBook(items, nameById, fallbackName) {
    if (!Array.isArray(items) || items.length === 0) {
        return undefined;
    }

    return {
        entries: items.map((item, index) => ({
            keys: String(item?.key || '').split(',').map(key => replaceBackyardMacros(key.trim(), nameById, fallbackName)).filter(Boolean),
            content: replaceBackyardMacros(item?.value || '', nameById, fallbackName),
            extensions: { backyard_ai: { id: item?.id || '', order: item?.order || '' } },
            enabled: true,
            insertion_order: index,
        })).filter(entry => entry.keys.length || entry.content),
        extensions: {},
    };
}

function formatMessages(messages, nameById, fallbackName) {
    if (!Array.isArray(messages)) {
        return [];
    }
    return messages.map(message => replaceBackyardMacros(message?.text || '', nameById, fallbackName)).filter(Boolean);
}

function formatExampleMessages(messages) {
    if (!messages.length) {
        return '';
    }
    return messages.map(message => `<START>\n${message}`).join('\n').trimEnd();
}

function getSystemPrompt(modelInstructions, nameById, fallbackName) {
    if (!modelInstructions || typeof modelInstructions !== 'object') {
        return '';
    }
    return replaceBackyardMacros(modelInstructions.customText || '', nameById, fallbackName);
}

function replaceBackyardMacros(value, nameById, fallbackName) {
    return String(value || '')
        .replace(/#\{user\}:/giu, '{{user}}:')
        .replace(/#\{character\}:/giu, '{{char}}:')
        .replace(/\{character\}(?!\})/giu, '{{char}}')
        .replace(/\{user\}(?!\})/giu, '{{user}}')
        .replace(/\{_cfg&:([^:}]+):cfg&_\}/giu, (match, id) => nameById.get(String(id)) || fallbackName || '{{char}}');
}

function getCharacterNameMap(characters) {
    const map = new Map();
    if (!Array.isArray(characters)) {
        return map;
    }
    for (const character of characters) {
        if (character?.id) {
            map.set(String(character.id), character.displayName || character.name || String(character.id));
        }
    }
    return map;
}

function isDownloadableCharacter(character) {
    return character && character.banned !== true && character.isNSFW !== true && (character.persona || character.standaloneGroupConfig?.PrimaryChat?.HubGreetingMessages?.length);
}

function parseResourceId(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        throw new Error('Backyard AI character ID is required.');
    }

    try {
        const url = new URL(raw);
        if (url.origin === SITE_URL) {
            const match = /^\/hub\/(?:character|party)\/([^/?#]+)/iu.exec(url.pathname);
            if (match) {
                return parseResourceId(match[1]);
            }
        }
    } catch {
        // Plain IDs are the common path.
    }

    if (!RESOURCE_ID_PATTERN.test(raw)) {
        throw new Error('Backyard AI character ID is invalid.');
    }
    return raw.toLowerCase();
}

function getSearchSort(value) {
    if (value === 'popular' || value === 'popularity') {
        return { type: 'Popularity', direction: 'desc' };
    }
    if (value === 'newest' || value === 'recent') {
        return { type: 'Newest', direction: 'desc' };
    }
    if (value === 'trending') {
        return { type: 'Trending', direction: 'desc' };
    }
    return { type: 'Relevance', direction: 'desc' };
}

function getBrowseSort(value) {
    if (value === 'newest' || value === 'recent') {
        return { type: 'Newest', direction: 'desc' };
    }
    if (value === 'updated') {
        return { type: 'Updated', direction: 'desc' };
    }
    return { type: 'Trending', direction: 'desc' };
}

function getPageOffset(page, limit) {
    const parsed = Number(page);
    const safePage = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
    return (safePage - 1) * limit;
}

function formatTags(tags) {
    if (!Array.isArray(tags)) {
        return [];
    }
    return tags.map(tag => stripHtml(typeof tag === 'string' ? tag : tag?.name || tag?.label || '')).filter(Boolean).slice(0, 12);
}

function getImageUrl(images) {
    return formatImages(images)[0]?.url || '';
}

function formatImages(images) {
    if (!Array.isArray(images)) {
        return [];
    }
    return images
        .filter(image => image?.imageUrl)
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
        .map(image => ({
            id: image.id || '',
            url: image.imageUrl,
            label: image.label || '',
            aspectRatio: image.aspectRatio || '',
        }));
}

function safeFileName(value) {
    return String(value || 'backyard-ai-character').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 120) || 'backyard-ai-character';
}
