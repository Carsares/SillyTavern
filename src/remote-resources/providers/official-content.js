import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchBuffer,
    fetchJson,
    formatRemoteResource,
    getFilenameFromUrl,
    getPageOffset,
    matchesQuery,
} from './shared.js';

const INDEX_URL = 'https://raw.githubusercontent.com/SillyTavern/SillyTavern-Content/main/index.json';

const ASSET_TYPES = new Set(['ambient', 'bgm', 'blip']);

export const officialContentProvider = {
    id: 'official-content',
    name: 'SillyTavern 官方内容',
    description: '官方内容索引，匿名可用，包含扩展、角色和内置资产。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: true,

    async search(params) {
        const limit = clampLimit(params.limit);
        const offset = getPageOffset(params.page, limit);
        const items = await readIndex();
        const normalized = items
            .map(item => convertIndexItem(item))
            .filter(Boolean)
            .filter(item => !params.resourceType || item.resourceType === params.resourceType)
            .filter(item => matchesQuery(item, params.query));

        return {
            items: normalized.slice(offset, offset + limit).map(item => formatRemoteResource(this, item)),
            total: normalized.length,
        };
    },

    async download(params) {
        const items = await readIndex();
        const item = items.find(entry => String(entry.id) === String(params.resourceId));
        const converted = item ? convertIndexItem(item) : null;

        if (!converted?.downloadUrl) {
            throw new Error('Official content item is not downloadable.');
        }

        const { response, buffer } = await fetchBuffer(converted.downloadUrl);
        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        const fileName = converted.metadata.filename || getFilenameFromUrl(converted.downloadUrl, `${converted.id}.bin`);

        return {
            buffer,
            fileName,
            fileType: contentType,
            resourceType: converted.resourceType,
        };
    },
};

async function readIndex() {
    const { json } = await fetchJson(INDEX_URL);
    return Array.isArray(json) ? json : [];
}

function convertIndexItem(item) {
    if (!item || typeof item !== 'object') {
        return null;
    }

    if (item.type === 'extension') {
        return {
            id: item.id,
            resourceType: REMOTE_RESOURCE_TYPES.EXTENSION,
            title: item.name || item.id,
            description: item.description || '',
            sourceUrl: item.url || '',
            installUrl: item.url || '',
            capabilities: { install: Boolean(item.url) },
            metadata: { officialType: item.type },
        };
    }

    if (item.type === 'character') {
        return {
            id: item.id,
            resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
            title: item.name || item.id,
            description: item.description || '',
            sourceUrl: item.url || '',
            downloadUrl: item.url || '',
            capabilities: { download: Boolean(item.url) },
            metadata: { filename: item.id, officialType: item.type },
        };
    }

    if (ASSET_TYPES.has(item.type)) {
        return {
            id: item.id,
            resourceType: REMOTE_RESOURCE_TYPES.ASSET,
            title: item.name || item.id,
            description: item.description || '',
            sourceUrl: item.url || '',
            downloadUrl: item.url || '',
            capabilities: { download: Boolean(item.url) },
            metadata: { assetCategory: item.type, filename: item.id, officialType: item.type },
        };
    }

    return null;
}
