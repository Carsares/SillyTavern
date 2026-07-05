import path from 'node:path';

import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchBuffer,
    fetchJson,
    formatRemoteResource,
    getPageOffset,
} from './shared.js';

const BASE_URL = 'https://huggingface.co';
const DEFAULT_BRANCH = 'main';

const REPOSITORIES = Object.freeze([
    {
        repoType: 'dataset',
        apiPath: 'datasets',
        slug: 'NewEden/Mango-CharacterCard-Json',
        label: 'Mango CharacterCard JSON',
        resourceType: REMOTE_RESOURCE_TYPES.CHARACTER,
        maxBytes: 300_000,
    },
    {
        repoType: 'model',
        apiPath: 'models',
        slug: 'sphiratrioth666/SillyTavern-Presets-Sphiratrioth',
        label: 'Sphiratrioth Presets',
        resourceType: REMOTE_RESOURCE_TYPES.PRESET,
        maxBytes: 100_000,
    },
    {
        repoType: 'model',
        apiPath: 'models',
        slug: 'Frowningface/Silly_Tavern_Presets_Database',
        label: 'Silly Tavern Presets Database',
        resourceType: REMOTE_RESOURCE_TYPES.PRESET,
        maxBytes: 100_000,
    },
    {
        repoType: 'model',
        apiPath: 'models',
        slug: 'sphiratrioth666/Lorebooks_as_ACTIVE_scenario_and_character_guidance_tool',
        label: 'Active Scenario Lorebooks',
        resourceType: REMOTE_RESOURCE_TYPES.WORLDBOOK,
        maxBytes: 100_000,
    },
    {
        repoType: 'model',
        apiPath: 'models',
        slug: 'sphiratrioth666/GM-5_Game_Mistress_Roleplaying_System',
        label: 'GM-5 World Lorebooks',
        resourceType: REMOTE_RESOURCE_TYPES.WORLDBOOK,
        pathPrefix: '01. WORLD LOREBOOKS/',
        maxBytes: 200_000,
    },
]);

export const huggingFaceSillyTavernProvider = {
    id: 'huggingface-sillytavern',
    name: 'Hugging Face ST Repos',
    description: 'Hugging Face 上已验证的 SillyTavern 公开 JSON 资源仓库，文件级搜索与下载。',
    authMode: 'none',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        const limit = clampLimit(params.limit);
        const offset = getPageOffset(params.page, limit);
        const repositories = REPOSITORIES.filter(repo => !params.resourceType || repo.resourceType === params.resourceType);
        if (!repositories.length) {
            return { items: [], total: 0 };
        }

        const results = await Promise.all(repositories.map(readRepositoryFiles));
        const items = results
            .flatMap(files => files)
            .filter(item => matchesHuggingFaceQuery(item, params.query));

        return {
            items: items.slice(offset, offset + limit).map(item => formatRemoteResource(this, item)),
            total: items.length,
        };
    },

    async download(params) {
        const resourceId = parseResourceId(params.resourceId);
        const repo = findRepository(resourceId.repoType, resourceId.slug);
        if (!repo) {
            throw new Error('Hugging Face resource repo is not allowed.');
        }
        if (params.resourceType && params.resourceType !== repo.resourceType) {
            throw new Error(`Hugging Face resource type mismatch: expected ${repo.resourceType}.`);
        }
        validateJsonPath(resourceId.filePath, repo);

        const url = getResolveUrl(repo, resourceId.filePath);
        const { response, buffer } = await fetchBuffer(url);
        if (repo.maxBytes && buffer.length > repo.maxBytes) {
            throw new Error('Hugging Face resource is too large.');
        }
        validateResourceJson(buffer, repo.resourceType);

        return {
            buffer,
            fileName: decodeURIComponent(path.basename(resourceId.filePath)),
            fileType: response.headers.get('content-type') || 'application/json',
            resourceType: repo.resourceType,
        };
    },
};

async function readRepositoryFiles(repo) {
    const url = `${BASE_URL}/api/${repo.apiPath}/${repo.slug}/tree/${DEFAULT_BRANCH}?recursive=true`;
    const { json } = await fetchJson(url);
    if (!Array.isArray(json)) {
        return [];
    }

    return json
        .filter(item => item?.type === 'file')
        .filter(item => validateJsonFile(item, repo))
        .map(item => convertFile(repo, item));
}

function convertFile(repo, item) {
    const filePath = String(item.path || '');
    const folders = filePath.split('/').slice(0, -1).filter(Boolean);
    const title = titleFromPath(filePath);
    return {
        id: formatResourceId(repo, filePath),
        resourceType: repo.resourceType,
        title,
        description: `${repo.label} / ${filePath}`,
        author: getRepoOwner(repo.slug),
        sourceUrl: getBlobUrl(repo, filePath),
        downloadUrl: getResolveUrl(repo, filePath),
        tags: ['Hugging Face', repo.label, ...folders],
        stats: {
            size: Number(item.size) || 0,
        },
        capabilities: { download: true },
        metadata: {
            repoType: repo.repoType,
            repo: repo.slug,
            filePath,
        },
    };
}

function validateJsonPath(filePath, repo, throwOnError = true) {
    const value = String(filePath || '').trim();
    const valid = value.endsWith('.json') && !value.startsWith('/') && !value.includes('..') && value.split('/').every(Boolean) && matchesRepoPathPrefix(value, repo);
    if (valid) {
        return true;
    }
    if (throwOnError) {
        throw new Error('Hugging Face resource path is invalid.');
    }
    return false;
}

function matchesRepoPathPrefix(filePath, repo) {
    const prefix = String(repo.pathPrefix || '').trim();
    return !prefix || filePath.startsWith(prefix);
}

function validateJsonFile(item, repo) {
    const size = Number(item?.size) || 0;
    return validateJsonPath(item?.path, repo, false) && (!repo.maxBytes || size <= repo.maxBytes);
}

function validateResourceJson(buffer, resourceType) {
    let json;
    try {
        json = JSON.parse(buffer.toString('utf8'));
    } catch (error) {
        throw new Error(`Hugging Face JSON is invalid: ${error.message}`);
    }

    if (resourceType === REMOTE_RESOURCE_TYPES.CHARACTER && !isCharacterJson(json)) {
        throw new Error('Hugging Face character JSON is not a SillyTavern character card.');
    }
    if (resourceType === REMOTE_RESOURCE_TYPES.WORLDBOOK && !isWorldbookJson(json)) {
        throw new Error('Hugging Face worldbook JSON is not a SillyTavern worldbook.');
    }
    if (resourceType === REMOTE_RESOURCE_TYPES.PRESET && (!json || typeof json !== 'object' || Array.isArray(json))) {
        throw new Error('Hugging Face preset JSON is invalid.');
    }
}

function matchesHuggingFaceQuery(item, query) {
    const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
    if (!tokens.length) {
        return true;
    }

    const haystack = normalizeSearchText([
        item.id,
        item.title,
        item.description,
        item.author,
        ...(Array.isArray(item.tags) ? item.tags : []),
    ].filter(Boolean).join(' '));
    return tokens.every(token => haystack.includes(token));
}

function normalizeSearchText(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isCharacterJson(json) {
    if (!json || typeof json !== 'object') {
        return false;
    }
    if (json.spec === 'chara_card_v2' && json.data?.name) {
        return true;
    }
    return Boolean(json.name && json.description && (json.first_mes || json.data?.first_mes));
}

function isWorldbookJson(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        return false;
    }

    if (Array.isArray(json.entries)) {
        return json.entries.some(isWorldbookEntry);
    }
    if (json.entries && typeof json.entries === 'object') {
        return Object.values(json.entries).some(isWorldbookEntry);
    }
    return false;
}

function isWorldbookEntry(entry) {
    return Boolean(entry && typeof entry === 'object' && (Array.isArray(entry.key) || typeof entry.key === 'string') && typeof entry.content === 'string');
}

function formatResourceId(repo, filePath) {
    return JSON.stringify({
        repoType: repo.repoType,
        slug: repo.slug,
        filePath,
    });
}

function parseResourceId(value) {
    try {
        const parsed = JSON.parse(String(value || ''));
        return {
            repoType: String(parsed.repoType || ''),
            slug: String(parsed.slug || ''),
            filePath: String(parsed.filePath || ''),
        };
    } catch {
        throw new Error('Hugging Face resource ID is invalid.');
    }
}

function findRepository(repoType, slug) {
    return REPOSITORIES.find(repo => repo.repoType === repoType && repo.slug === slug) || null;
}

function getRepoOwner(slug) {
    return slug.split('/')[0] || 'Hugging Face';
}

function getBlobUrl(repo, filePath) {
    return `${getRepoBaseUrl(repo)}/blob/${DEFAULT_BRANCH}/${encodePath(filePath)}`;
}

function getResolveUrl(repo, filePath) {
    return `${getRepoBaseUrl(repo)}/resolve/${DEFAULT_BRANCH}/${encodePath(filePath)}`;
}

function getRepoBaseUrl(repo) {
    return repo.repoType === 'dataset' ? `${BASE_URL}/datasets/${repo.slug}` : `${BASE_URL}/${repo.slug}`;
}

function encodePath(filePath) {
    return String(filePath || '').split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function titleFromPath(filePath) {
    return decodeURIComponent(path.basename(filePath, '.json')).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || filePath;
}
