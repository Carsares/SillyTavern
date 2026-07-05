import path from 'node:path';

import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchBuffer,
    fetchText,
    formatRemoteResource,
    getPageOffset,
    matchesQuery,
    stripHtml,
    truncateText,
} from './shared.js';

const BASE_URL = 'https://www.sillytavernai.chat';
const HOME_URL = `${BASE_URL}/`;
const CARD_CONFIG_ID = 'characterCardsConfig';
const CARD_PATH_PREFIX = '/silly_tavern_character_cards/';
const CACHE_TTL_MS = 10 * 60 * 1000;

let cardCache = {
    expiresAt: 0,
    items: [],
};

export const sillyTavernAiChatProvider = {
    id: 'sillytavernai-chat',
    name: '手机酒馆AI 精选角色卡',
    description: '手机酒馆AI 首页公开精选 SillyTavern PNG 角色卡，匿名解析静态配置并过滤有效角色卡元数据。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            return { items: [], total: 0 };
        }

        const limit = clampLimit(params.limit);
        const offset = getPageOffset(params.page, limit);
        const items = await readCards();
        const matched = items.filter(item => matchesQuery(item, params.query));

        return {
            items: matched.slice(offset, offset + limit).map(item => formatRemoteResource(this, item)),
            total: matched.length,
        };
    },

    async download(params) {
        if (params.resourceType && params.resourceType !== REMOTE_RESOURCE_TYPES.CHARACTER) {
            throw new Error('手机酒馆AI精选源只支持角色卡下载。');
        }

        const imageUrl = resolveCardImageUrl(params.resourceId);
        const { response, buffer } = await fetchBuffer(imageUrl);
        validatePngCharacterCard(buffer);

        return {
            buffer,
            fileName: getDownloadFileName(imageUrl),
            fileType: response.headers.get('content-type') || 'image/png',
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        };
    },
};

async function readCards() {
    if (Date.now() < cardCache.expiresAt) {
        return cardCache.items;
    }

    const { text } = await fetchText(HOME_URL);
    const config = parseCharacterCardsConfig(text);
    const cards = Array.isArray(config.cards) ? config.cards : [];
    const validCards = [];

    for (const card of cards) {
        const item = convertCard(card);
        if (!item) {
            continue;
        }
        if (await isDownloadableCharacterCard(item.downloadUrl)) {
            validCards.push(item);
        }
    }

    cardCache = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        items: validCards,
    };

    return validCards;
}

function parseCharacterCardsConfig(html) {
    const pattern = new RegExp(`<script[^>]+id=["']${CARD_CONFIG_ID}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i');
    const match = String(html || '').match(pattern);
    if (!match?.[1]) {
        throw new Error('手机酒馆AI首页未暴露角色卡配置。');
    }

    try {
        return JSON.parse(match[1].trim());
    } catch (error) {
        throw new Error(`手机酒馆AI角色卡配置解析失败: ${error.message}`);
    }
}

function convertCard(card) {
    const imageUrl = resolveCardImageUrl(card?.image);
    if (!imageUrl || path.extname(new URL(imageUrl).pathname).toLowerCase() !== '.png') {
        return null;
    }

    const title = stripHtml(card.name || card.alt || path.basename(new URL(imageUrl).pathname));
    const tags = Array.isArray(card.tags) ? card.tags.map(tag => stripHtml(tag)).filter(Boolean) : [];
    return {
        id: new URL(imageUrl).pathname,
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        title,
        description: truncateText(stripHtml(card.desc || card.alt || '')),
        author: '手机酒馆AI',
        sourceUrl: `${HOME_URL}#character-cards`,
        downloadUrl: imageUrl,
        thumbnailUrl: imageUrl,
        tags: ['手机酒馆AI', ...tags],
        capabilities: { download: true },
        metadata: {
            imagePath: new URL(imageUrl).pathname,
        },
    };
}

function resolveCardImageUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    try {
        const url = new URL(raw, HOME_URL);
        if (url.origin !== BASE_URL || !url.pathname.startsWith(CARD_PATH_PREFIX)) {
            return '';
        }
        return url.toString();
    } catch {
        return '';
    }
}

async function isDownloadableCharacterCard(imageUrl) {
    try {
        const { buffer } = await fetchBuffer(imageUrl);
        validatePngCharacterCard(buffer);
        return true;
    } catch {
        return false;
    }
}

function validatePngCharacterCard(buffer) {
    if (!isPng(buffer)) {
        throw new Error('手机酒馆AI资源不是 PNG 角色卡。');
    }
    if (!hasCharacterTextChunk(buffer)) {
        throw new Error('手机酒馆AI PNG 未包含 SillyTavern 角色卡元数据。');
    }
}

function hasCharacterTextChunk(buffer) {
    let offset = 8;
    while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd + 4 > buffer.length) {
            return false;
        }
        if ((type === 'tEXt' || type === 'iTXt') && isCharacterChunk(buffer.subarray(dataStart, dataEnd))) {
            return true;
        }
        offset = dataEnd + 4;
    }
    return false;
}

function isCharacterChunk(chunk) {
    const separator = chunk.indexOf(0);
    const keyword = chunk.subarray(0, separator > 0 ? separator : chunk.length).toString('latin1');
    return keyword === 'chara' || keyword === 'ccv3';
}

function isPng(buffer) {
    return buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
}

function getDownloadFileName(value) {
    try {
        return decodeURIComponent(path.basename(new URL(value).pathname)) || 'sillytavernai-character.png';
    } catch {
        return 'sillytavernai-character.png';
    }
}
