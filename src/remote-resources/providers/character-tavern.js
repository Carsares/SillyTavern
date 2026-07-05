import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchJson,
    formatRemoteResource,
    stripHtml,
    truncateText,
} from './shared.js';

const BASE_URL = 'https://character-tavern.com';

export const characterTavernProvider = {
    id: 'character-tavern',
    name: 'Character Tavern',
    description: 'Character Tavern 公开角色搜索 API，匿名可用；下载时转换为 SillyTavern 角色 JSON。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            return { items: [], total: 0 };
        }

        const limit = clampLimit(params.limit, 24, 30);
        const page = Math.max(Number(params.page) || 1, 1);
        const url = new URL('/api/search/cards', BASE_URL);
        url.searchParams.set('limit', String(limit));
        url.searchParams.set('page', String(page));
        url.searchParams.set('sort', 'most_popular');
        const query = String(params.query || '').trim();
        if (query) {
            url.searchParams.set('query', query);
        }

        const { json } = await fetchJson(url.toString());
        const items = Array.isArray(json.hits) ? json.hits : [];

        return {
            items: items.map(item => formatRemoteResource(this, convertCharacterTavernCard(item))),
            total: Number(json.totalHits) || items.length,
        };
    },

    async download(params) {
        const id = String(params.resourceId || '').trim();
        if (!id) {
            throw new Error('Character Tavern resource ID is required.');
        }

        const { json } = await fetchJson(`${BASE_URL}/api/character/${encodePath(id)}`);
        const card = json.card;
        if (!card?.name) {
            throw new Error('Character Tavern card payload is invalid.');
        }

        const character = convertToCharacterCard(card);
        const buffer = Buffer.from(JSON.stringify(character, null, 2), 'utf8');
        const fileName = `${safeFileName(card.name || id)}.json`;

        return {
            buffer,
            fileName,
            fileType: 'application/json',
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    },
};

function convertCharacterTavernCard(item) {
    const path = String(item.path || item.id || '').trim();
    const tags = Array.isArray(item.tags) ? item.tags : [];

    return {
        id: path || item.id,
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title: item.name || item.inChatName || path,
        description: truncateText(item.tagline || stripHtml(item.pageDescription || '')),
        author: item.author || getAuthorFromPath(path),
        sourceUrl: `${BASE_URL}/character/${path}`,
        downloadUrl: `${BASE_URL}/api/character/${encodePath(path)}`,
        tags: [
            ...tags.map(tag => typeof tag === 'string' ? tag : tag?.name).filter(Boolean),
            item.isNSFW ? 'NSFW' : '',
            item.hasLorebook ? 'has-lorebook' : '',
            item.isOC ? 'oc' : '',
        ].filter(Boolean),
        stats: {
            downloads: Number(item.downloads) || 0,
            messages: Number(item.messages) || 0,
            likes: Number(item.likes) || 0,
            dislikes: Number(item.dislikes) || 0,
            tokens: Number(item.totalTokens) || 0,
        },
        updatedAt: item.lastUpdateAt || item.createdAt || '',
        capabilities: { download: Boolean(path) },
        metadata: {
            cardId: item.id || '',
            path,
            hasLorebook: Boolean(item.hasLorebook),
        },
    };
}

function convertToCharacterCard(card) {
    const path = String(card.path || '').trim();
    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: card.inChatName || card.name,
            description: card.definition_character_description || '',
            personality: card.definition_personality || '',
            scenario: card.definition_scenario || '',
            first_mes: card.definition_first_message || '',
            mes_example: card.definition_example_messages || '',
            creator_notes: card.description || card.tagline || '',
            system_prompt: card.definition_system_prompt || '',
            post_history_instructions: card.definition_post_history_prompt || '',
            alternate_greetings: [],
            tags: [
                card.isNSFW ? 'NSFW' : '',
                card.isOC ? 'OC' : '',
                card.hasExpressionPack ? 'expression-pack' : '',
            ].filter(Boolean),
            creator: getAuthorFromPath(path) || 'Character Tavern',
            character_version: String(card.versionId || '1'),
            extensions: {
                character_tavern: {
                    id: card.id || '',
                    path,
                    origin: card.origin || 'Character Tavern',
                    sourceUrl: path ? `${BASE_URL}/character/${path}` : '',
                },
            },
        },
    };
}

function encodePath(value) {
    return String(value || '').split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function getAuthorFromPath(value) {
    return String(value || '').split('/').filter(Boolean)[0] || '';
}

function safeFileName(value) {
    return String(value || 'character').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 120) || 'character';
}
