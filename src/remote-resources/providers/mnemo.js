import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchBuffer,
    fetchJson,
    formatRemoteResource,
    getFilenameFromUrl,
    getPageOffset,
    stripHtml,
    truncateText,
} from './shared.js';

const WEB_BASE_URL = 'https://mnemo.studio';
const SUPABASE_URL = 'https://oarxvkarmlaqzrkhcdle.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ovF8S11Sv01RTNfMPAXKyw_9u046eO1';
const CHARACTER_SELECT = [
    'id',
    'uploader_id',
    'name',
    'display_name',
    'tagline',
    'description',
    'greeting',
    'personality',
    'scenario',
    'creator_notes',
    'character_book',
    'image_url',
    'file_url',
    'file_type',
    'token_count',
    'download_count',
    'fork_count',
    'is_nsfw',
    'is_nsfl',
    'pov',
    'spec_version',
    'created_at',
    'updated_at',
    'profiles!characters_uploader_id_profiles_fkey(username,display_name)',
].join(',');

export const mnemoProvider = {
    id: 'mnemo',
    name: 'Mnemo',
    description: 'Mnemo 公开 Supabase 索引，匿名搜索 SFW SillyTavern 角色卡并下载原始 PNG/JSON。',
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
        const id = String(params.resourceId || '').trim();
        if (!id) {
            throw new Error('Mnemo character ID is required.');
        }

        const character = await readCharacter(id);
        if (isBlockedRating(character)) {
            throw new Error('Mnemo NSFW/NSFL cards are not available from this provider.');
        }

        if (character.file_url) {
            const { response, buffer } = await fetchBuffer(character.file_url);
            return {
                buffer,
                fileName: getFilenameFromUrl(character.file_url, `${safeFileName(character.name || id)}.${getFileExtension(character.file_type)}`),
                fileType: response.headers.get('content-type') || getFileType(character.file_type),
                resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
            };
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
    const limit = clampLimit(params.limit, 24, 50);
    const offset = getPageOffset(params.page, limit);
    const url = new URL('/rest/v1/characters', SUPABASE_URL);
    url.searchParams.set('select', CHARACTER_SELECT);
    url.searchParams.set('is_nsfw', 'eq.false');
    url.searchParams.set('is_nsfl', 'eq.false');
    url.searchParams.set('order', 'download_count.desc.nullslast');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    const query = String(params.query || '').trim();
    if (query) {
        const pattern = `*${query.replace(/[(),]/g, ' ')}*`;
        url.searchParams.set('or', `(name.ilike.${pattern},display_name.ilike.${pattern},tagline.ilike.${pattern},description.ilike.${pattern})`);
    }

    const { json } = await fetchSupabaseJson(url.toString());
    const items = Array.isArray(json) ? json.filter(item => !isBlockedRating(item)) : [];
    return {
        items: items.map(convertCharacterSearchItem),
        total: items.length,
    };
}

async function readCharacter(id) {
    const url = new URL('/rest/v1/characters', SUPABASE_URL);
    url.searchParams.set('select', CHARACTER_SELECT);
    url.searchParams.set('id', `eq.${id}`);
    url.searchParams.set('limit', '1');
    const { json } = await fetchSupabaseJson(url.toString());
    const character = Array.isArray(json) ? json[0] : null;
    if (!character) {
        throw new Error(`Mnemo character not found: ${id}`);
    }
    return character;
}

async function fetchSupabaseJson(url) {
    return fetchJson(url, {
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
        },
    });
}

function convertCharacterSearchItem(item) {
    const id = String(item.id || '').trim();
    const title = item.display_name || item.name || id;
    return {
        id,
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title,
        description: truncateText(stripHtml(item.tagline || item.description || item.greeting || '')),
        author: getCreatorName(item.profiles),
        sourceUrl: `${WEB_BASE_URL}/character/${encodeURIComponent(id)}`,
        downloadUrl: item.file_url || `${SUPABASE_URL}/rest/v1/characters?id=eq.${encodeURIComponent(id)}`,
        thumbnailUrl: item.image_url || '',
        tags: normalizeTags(item.pov ? `pov:${item.pov}` : '', item.spec_version ? `spec:${item.spec_version}` : ''),
        stats: {
            downloads: Number(item.download_count) || 0,
            tokens: Number(item.token_count) || 0,
            forks: Number(item.fork_count) || 0,
        },
        updatedAt: item.updated_at || item.created_at || '',
        capabilities: { download: Boolean(id) },
        metadata: {
            id,
            uploaderId: item.uploader_id || '',
            fileType: item.file_type || '',
            hasCharacterBook: Boolean(item.character_book),
        },
    };
}

function convertToCharacterCard(item) {
    const creator = getCreatorName(item.profiles) || 'Mnemo';
    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: item.name || item.display_name || 'Mnemo Character',
            description: item.description || '',
            personality: item.personality || '',
            scenario: item.scenario || '',
            first_mes: item.greeting || '',
            mes_example: '',
            creator_notes: item.creator_notes || item.tagline || '',
            system_prompt: '',
            post_history_instructions: '',
            alternate_greetings: [],
            tags: normalizeTags(item.pov ? `pov:${item.pov}` : ''),
            creator,
            character_version: item.updated_at || item.created_at || '1',
            extensions: {
                mnemo: {
                    id: item.id || '',
                    sourceUrl: item.id ? `${WEB_BASE_URL}/character/${encodeURIComponent(item.id)}` : '',
                    imageUrl: item.image_url || '',
                    fileUrl: item.file_url || '',
                    uploaderId: item.uploader_id || '',
                    downloads: Number(item.download_count) || 0,
                    createdAt: item.created_at || '',
                    updatedAt: item.updated_at || '',
                },
            },
            character_book: item.character_book || undefined,
        },
    };
}

function getCreatorName(profile) {
    return profile?.display_name || profile?.username || '';
}

function isBlockedRating(item) {
    return item?.is_nsfw === true || item?.is_nsfl === true;
}

function normalizeTags(...groups) {
    return groups.flatMap(group => Array.isArray(group) ? group : [group]).map(tag => String(tag || '').trim()).filter(Boolean);
}

function safeFileName(value) {
    return String(value || 'mnemo-character').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 120) || 'mnemo-character';
}

function getFileExtension(fileType) {
    const type = String(fileType || '').toLowerCase();
    return type.includes('json') ? 'json' : 'png';
}

function getFileType(fileType) {
    const type = String(fileType || '').toLowerCase();
    return type.includes('json') ? 'application/json' : 'image/png';
}
