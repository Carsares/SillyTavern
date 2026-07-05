import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchJson,
    formatRemoteResource,
    stripHtml,
    truncateText,
} from './shared.js';

const BASE_URL = 'https://app.wyvern.chat';
const API_BASE_URL = `${BASE_URL}/api`;

export const wyvernChatProvider = {
    id: 'wyvern-chat',
    name: 'WyvernChat',
    description: 'WyvernChat 公开角色和世界书 API，匿名搜索并转换为 SillyTavern JSON。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        const searches = [];
        if (!params.resourceType || params.resourceType === REMOTE_RESOURCE_TYPES.CHARACTER) {
            searches.push(searchCharacters(params));
        }
        if (!params.resourceType || params.resourceType === REMOTE_RESOURCE_TYPES.WORLDBOOK) {
            searches.push(searchLorebooks(params));
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

    async download(params) {
        const resource = parseResourceId(params.resourceId);
        const resourceType = params.resourceType || resource.resourceType || REMOTE_RESOURCE_TYPES.CHARACTER;
        if (resourceType === REMOTE_RESOURCE_TYPES.CHARACTER) {
            return downloadCharacter(resource.id);
        }
        if (resourceType === REMOTE_RESOURCE_TYPES.WORLDBOOK) {
            return downloadLorebook(resource.id);
        }
        throw new Error(`WyvernChat does not support downloading ${resourceType}.`);
    },
};

async function searchCharacters(params) {
    const limit = clampLimit(params.limit, 24, 50);
    const page = Math.max(Number(params.page) || 1, 1);
    const url = new URL('/api/characters/public', BASE_URL);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('order', 'DESC');
    url.searchParams.set('sort', 'votes');
    const query = String(params.query || '').trim();
    if (query) {
        url.searchParams.set('query', query);
    }

    const { json } = await fetchJson(url.toString());
    const characters = Array.isArray(json.characters) ? json.characters : [];
    return {
        items: characters.map(convertCharacterSearchItem),
        total: Number(json.maxCount || json.total) || characters.length,
    };
}

async function searchLorebooks(params) {
    const limit = clampLimit(params.limit, 24, 50);
    const page = Math.max(Number(params.page) || 1, 1);
    const url = new URL('/api/lorebooks/public', BASE_URL);
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('order', 'DESC');
    url.searchParams.set('sort', 'likes');
    url.searchParams.set('is_nsfw', 'false');
    const query = String(params.query || '').trim();
    if (query) {
        url.searchParams.set('query', query);
    }

    const { json } = await fetchJson(url.toString());
    const lorebooks = Array.isArray(json.lorebooks) ? json.lorebooks : [];
    return {
        items: lorebooks.map(convertLorebookSearchItem),
        total: Number(json.maxCount) || lorebooks.length,
    };
}

async function downloadCharacter(id) {
    const { json: character } = await fetchJson(`${API_BASE_URL}/characters/${encodeURIComponent(id)}`);
    validatePublicResource(character, 'character');
    const lorebooks = await readCharacterLorebooks(id);
    const card = convertToCharacterCard(character, lorebooks);
    return {
        buffer: Buffer.from(JSON.stringify(card, null, 2), 'utf8'),
        fileName: `${safeFileName(card.data.name || id)}.json`,
        fileType: 'application/json',
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
    };
}

async function downloadLorebook(id) {
    const { json: lorebook } = await fetchJson(`${API_BASE_URL}/lorebooks/${encodeURIComponent(id)}`);
    validatePublicResource(lorebook, 'lorebook');
    const worldInfo = convertToWorldInfo(lorebook);
    return {
        buffer: Buffer.from(JSON.stringify(worldInfo, null, 2), 'utf8'),
        fileName: `${safeFileName(worldInfo.name || id)}.json`,
        fileType: 'application/json',
        resourceType: REMOTE_RESOURCE_TYPES.WORLDBOOK,
    };
}

async function readCharacterLorebooks(characterId) {
    try {
        const { json } = await fetchJson(`${API_BASE_URL}/lorebooks/character/${encodeURIComponent(characterId)}`);
        return Array.isArray(json) ? json.filter(item => item?.visibility === 'public' && item?.status === 'approved') : [];
    } catch {
        return [];
    }
}

function convertCharacterSearchItem(item) {
    const id = getResourceId(item);
    const creator = getCreatorName(item.creator);
    return {
        id: formatResourceId(id, REMOTE_RESOURCE_TYPES.CHARACTER),
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title: item.name || id,
        description: truncateText(stripHtml(item.tagline || item.creator_notes || item.description || '')),
        author: creator,
        sourceUrl: `${BASE_URL}/characters/${encodeURIComponent(id)}`,
        downloadUrl: `${API_BASE_URL}/characters/${encodeURIComponent(id)}`,
        thumbnailUrl: item.avatar || '',
        tags: normalizeTags(item.tags, item.rating === 'none' ? '' : item.rating),
        stats: formatStats(item.statistics_record || item.entity_statistics || item.stats),
        updatedAt: item.updated_at || item.created_at || '',
        capabilities: { download: Boolean(id) },
        metadata: {
            id,
            creatorId: item.creator?.uid || item.creator?.id || item.creator?._id || '',
            tokenCount: Number(item.token_count) || 0,
            hasLorebooks: Array.isArray(item.lorebooks) && item.lorebooks.length > 0,
        },
    };
}

function convertLorebookSearchItem(item) {
    const id = getResourceId(item);
    const creator = getCreatorName(item.creator);
    const entries = getWorldEntries(item).length;
    return {
        id: formatResourceId(id, REMOTE_RESOURCE_TYPES.WORLDBOOK),
        resourceType: REMOTE_RESOURCE_TYPES.WORLDBOOK,
        title: item.name || id,
        description: truncateText(stripHtml(item.description || '')),
        author: creator,
        sourceUrl: `${BASE_URL}/lorebooks/${encodeURIComponent(id)}`,
        downloadUrl: `${API_BASE_URL}/lorebooks/${encodeURIComponent(id)}`,
        thumbnailUrl: item.photoURL || '',
        tags: normalizeTags(item.tags, item.rating === 'none' ? '' : item.rating),
        stats: {
            ...formatStats(item.statistics_record || item.entity_statistics || item.stats),
            entries,
        },
        updatedAt: item.updated_at || item.created_at || '',
        capabilities: { download: Boolean(id) },
        metadata: {
            id,
            creatorId: item.creator?.uid || item.creator?.id || item.creator?._id || '',
            entries,
            scanDepth: Number(item.scan_depth) || 0,
            tokenBudget: Number(item.token_budget) || 0,
        },
    };
}

function convertToCharacterCard(character, lorebooks) {
    const id = getResourceId(character);
    const creator = getCreatorName(character.creator) || 'WyvernChat';
    const characterBook = convertCharacterBook(character, lorebooks);
    const data = {
        name: character.chat_name || character.name || 'WyvernChat Character',
        description: character.description || '',
        personality: character.personality || '',
        scenario: character.scenario || '',
        first_mes: character.first_mes || '',
        mes_example: character.mes_example || '',
        creator_notes: character.creator_notes || character.tagline || '',
        system_prompt: character.pre_history_instructions || '',
        post_history_instructions: character.post_history_instructions || '',
        alternate_greetings: formatArray(character.alternate_greetings),
        tags: normalizeTags(character.tags, character.rating === 'none' ? '' : character.rating),
        creator,
        character_version: character.updated_at || character.created_at || '1',
        extensions: {
            depth_prompt: {
                prompt: character.character_note || '',
                depth: 4,
            },
            visual_description: character.visual_description || '',
            wyvern_chat: {
                id,
                sourceUrl: id ? `${BASE_URL}/characters/${encodeURIComponent(id)}` : '',
                avatar: character.avatar || '',
                backgroundUrl: character.backgroundURL || '',
                creatorId: character.creator?.uid || character.creator?.id || character.creator?._id || '',
                stats: formatStats(character.statistics_record || character.entity_statistics || character.stats),
                createdAt: character.created_at || '',
                updatedAt: character.updated_at || '',
            },
        },
    };

    if (characterBook) {
        data.character_book = characterBook;
    }

    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data,
    };
}

function convertCharacterBook(character, lorebooks) {
    const books = Array.isArray(lorebooks) && lorebooks.length ? lorebooks : Array.isArray(character.lorebooks) ? character.lorebooks : [];
    const entries = books.flatMap(book => getWorldEntries(book).map(convertToCharacterBookEntry));
    if (!entries.length) {
        return null;
    }

    return {
        name: `${character.name || 'WyvernChat'} Lorebook`,
        description: 'Imported from WyvernChat character lorebooks.',
        scan_depth: Math.max(...books.map(book => Number(book.scan_depth) || 0), 2),
        token_budget: Math.max(...books.map(book => Number(book.token_budget) || 0), 0),
        recursive_scanning: books.some(book => Boolean(book.recursive_scanning)),
        extensions: {
            wyvern_chat: {
                lorebookIds: books.map(getResourceId).filter(Boolean),
            },
        },
        entries,
    };
}

function convertToCharacterBookEntry(entry) {
    return {
        keys: formatArray(entry.keys),
        content: String(entry.content || ''),
        extensions: entry.extensions && typeof entry.extensions === 'object' ? entry.extensions : {},
        enabled: entry.enabled !== false,
        insertion_order: Number(entry.insertion_order) || 100,
        case_sensitive: Boolean(entry.case_sensitive),
        name: entry.name || '',
        priority: Number(entry.priority) || 0,
        id: Number(entry.entry_id) || undefined,
        comment: entry.comment || '',
        selective: formatArray(entry.secondary_keys).length > 0,
        secondary_keys: formatArray(entry.secondary_keys),
        constant: Boolean(entry.constant),
        position: entry.position === 'after_char' ? 'after_char' : 'before_char',
    };
}

function convertToWorldInfo(lorebook) {
    const entries = {};
    getWorldEntries(lorebook).forEach((entry, index) => {
        const uid = index;
        entries[String(uid)] = convertToWorldEntry(entry, uid);
    });

    return {
        name: lorebook.name || 'WyvernChat Lorebook',
        description: lorebook.description || '',
        entries,
        extensions: {
            ...(lorebook.extensions && typeof lorebook.extensions === 'object' ? lorebook.extensions : {}),
            wyvern_chat: {
                id: getResourceId(lorebook),
                sourceUrl: `${BASE_URL}/lorebooks/${encodeURIComponent(getResourceId(lorebook))}`,
                creatorId: lorebook.creator?.uid || lorebook.creator?.id || lorebook.creator?._id || '',
                scanDepth: Number(lorebook.scan_depth) || 0,
                tokenBudget: Number(lorebook.token_budget) || 0,
                recursiveScanning: Boolean(lorebook.recursive_scanning),
                createdAt: lorebook.created_at || '',
                updatedAt: lorebook.updated_at || '',
            },
        },
    };
}

function convertToWorldEntry(entry, uid) {
    const extensions = entry.extensions && typeof entry.extensions === 'object' ? entry.extensions : {};
    return {
        uid,
        key: formatArray(entry.keys),
        keysecondary: formatArray(entry.secondary_keys),
        comment: entry.comment || entry.name || '',
        content: String(entry.content || ''),
        constant: Boolean(entry.constant),
        vectorized: Boolean(extensions.vectorized),
        selective: formatArray(entry.secondary_keys).length > 0,
        selectiveLogic: formatKeyLogic(entry.key_logic),
        addMemo: Boolean(extensions.addMemo || extensions.add_memo),
        order: Number(entry.insertion_order) || 100,
        position: formatWorldPosition(entry.position),
        disable: entry.enabled === false,
        ignoreBudget: Boolean(extensions.ignoreBudget || extensions.ignore_budget),
        excludeRecursion: Boolean(extensions.excludeRecursion || extensions.exclude_recursion),
        preventRecursion: Boolean(extensions.preventRecursion || extensions.prevent_recursion),
        probability: clampProbability(entry.activation_chance ?? extensions.probability),
        useProbability: extensions.useProbability !== false && extensions.use_probability !== false,
        depth: Number(extensions.depth) || 4,
        role: extensions.role == null ? 0 : Number(extensions.role) || 0,
        scanDepth: extensions.scan_depth == null ? null : Number(extensions.scan_depth),
        caseSensitive: Boolean(entry.case_sensitive),
        matchWholeWords: Boolean(entry.whole_words_only),
        useGroupScoring: extensions.use_group_scoring == null ? null : Boolean(extensions.use_group_scoring),
    };
}

function getWorldEntries(lorebook) {
    return [
        ...(Array.isArray(lorebook?.entries) ? lorebook.entries : []),
        ...(Array.isArray(lorebook?.lexicon) ? lorebook.lexicon : []),
    ].filter(entry => entry && typeof entry === 'object');
}

function validatePublicResource(resource, label) {
    if (!resource || typeof resource !== 'object' || !getResourceId(resource)) {
        throw new Error(`WyvernChat ${label} payload is invalid.`);
    }
    if (resource.visibility !== 'public' || resource.status !== 'approved') {
        throw new Error(`WyvernChat ${label} is not public.`);
    }
}

function parseResourceId(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        throw new Error('WyvernChat resource ID is required.');
    }

    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return {
                id: String(parsed.id || '').trim(),
                resourceType: String(parsed.resourceType || ''),
            };
        }
    } catch {
        // Plain IDs and URLs are accepted below.
    }

    try {
        const url = new URL(raw);
        if (url.origin === BASE_URL) {
            const match = /^\/(characters|lorebooks)\/([^/?#]+)/iu.exec(url.pathname);
            if (match) {
                return {
                    id: decodeURIComponent(match[2]),
                    resourceType: match[1] === 'lorebooks' ? REMOTE_RESOURCE_TYPES.WORLDBOOK : REMOTE_RESOURCE_TYPES.CHARACTER,
                };
            }
        }
    } catch {
        // Continue with plain ID parsing.
    }

    return { id: raw, resourceType: '' };
}

function formatResourceId(id, resourceType) {
    return JSON.stringify({ id, resourceType });
}

function getResourceId(item) {
    return String(item?.id || item?._id || '').trim();
}

function getCreatorName(creator) {
    return creator?.displayName || creator?.vanityUrl || creator?.uid || creator?.id || '';
}

function formatStats(stats) {
    return {
        views: Number(stats?.views) || 0,
        likes: Number(stats?.likes) || 0,
        comments: Number(stats?.comments) || 0,
        messages: Number(stats?.messages) || 0,
        chats: Number(stats?.chats) || 0,
    };
}

function normalizeTags(tags, extraTag) {
    return [
        ...(Array.isArray(tags) ? tags : []),
        extraTag,
    ].map(tag => String(tag || '').trim()).filter(Boolean);
}

function formatArray(value) {
    return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
}

function formatWorldPosition(value) {
    if (value === 'after_char') {
        return 1;
    }
    if (value === 'at_depth') {
        return 4;
    }
    return 0;
}

function formatKeyLogic(value) {
    if (value === 'AND_ALL') {
        return 3;
    }
    if (value === 'NOT_ANY') {
        return 2;
    }
    if (value === 'NOT_ALL') {
        return 1;
    }
    return 0;
}

function clampProbability(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return 100;
    }
    return Math.max(0, Math.min(100, number));
}

function safeFileName(value) {
    return String(value || 'wyvern-chat').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 120) || 'wyvern-chat';
}
