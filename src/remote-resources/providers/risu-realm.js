import {
    REMOTE_RESOURCE_TYPES,
    clampLimit,
    fetchBuffer,
    fetchText,
    formatRemoteResource,
    getPageOffset,
    stripHtml,
    truncateText,
} from './shared.js';

import fetch from 'node-fetch';

const BASE_URL = 'https://realm.risuai.net';
const DOWNLOAD_PROBE_TIMEOUT_MS = 8000;
// 限制 HEAD 探测并发，避免对单一第三方主机瞬间打出数百并发。
const PROBE_CONCURRENCY = 8;
// 单轮搜索的下载探测总预算；超预算后停止继续探测，把慢主机下的最坏延迟从
// ceil(候选数/并发)*单探测超时 收敛到预算级，避免拖住整轮聚合搜索。
const SEARCH_PROBE_BUDGET_MS = 10000;
const DOWNLOAD_FORMATS = Object.freeze({
    [REMOTE_RESOURCE_TYPES.CHARACTER]: { format: 'json-v3', extension: 'json', contentType: 'application/json' },
    [REMOTE_RESOURCE_TYPES.WORLDBOOK]: { format: 'lorebook-v3', extension: 'json', contentType: 'application/json' },
    [REMOTE_RESOURCE_TYPES.PRESET]: { format: 'preset-risu-v1', extension: 'json', contentType: 'application/json' },
});

export const risuRealmProvider = {
    id: 'risu-realm',
    name: 'RisuRealm',
    description: 'RisuRealm 公开搜索页和下载 API，匿名可用。',
    authMode: 'token',
    supportsSearch: true,
    supportsDownload: true,
    supportsInstall: false,

    async search(params) {
        const limit = clampLimit(params.limit);
        const offset = getPageOffset(params.page, limit);
        const url = new URL(BASE_URL);
        const query = String(params.query || '').trim();
        if (query) {
            url.searchParams.set('q', query);
        }

        const { text } = await fetchText(url.toString());
        const items = parseSearchResults(text)
            .filter(item => !params.resourceType || item.resourceType === params.resourceType);
        const candidates = items.slice(offset, Math.min(items.length, offset + Math.max(limit * 10, limit)));
        // 在总预算内按并发上限分批探测下载可用性，结果顺序与全量并发一致。
        const availableItems = (await probeCandidates(candidates))
            .filter(item => item.capabilities.download)
            .slice(0, limit);

        return {
            items: availableItems.map(item => formatRemoteResource(this, item)),
            total: availableItems.length,
        };
    },

    async download(params) {
        const resourceType = params.resourceType || REMOTE_RESOURCE_TYPES.CHARACTER;
        const format = DOWNLOAD_FORMATS[resourceType];
        if (!format) {
            throw new Error(`RisuRealm does not support downloading ${resourceType}.`);
        }

        const id = String(params.resourceId || '').trim();
        if (!id) {
            throw new Error('RisuRealm resource ID is required.');
        }

        const downloadUrl = `${BASE_URL}/api/v1/download/${format.format}/${encodeURIComponent(id)}?non_commercial=true&cors=true`;
        const { response, buffer } = await fetchBuffer(downloadUrl);
        const fileType = response.headers.get('content-type') || format.contentType;

        return {
            buffer,
            fileName: `${id}.${format.extension}`,
            fileType,
            resourceType,
        };
    },
};

function parseSearchResults(html) {
    const cardPattern = /<a\b[^>]*href="\/(character|module|preset)\/([^"?#/]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const results = [];
    const seen = new Set();
    let match;

    while ((match = cardPattern.exec(html)) !== null) {
        const sourceKind = match[1];
        const id = match[2];
        const body = match[3];
        const key = `${sourceKind}:${id}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);

        const resourceType = sourceKind === 'module' ? REMOTE_RESOURCE_TYPES.WORLDBOOK : sourceKind;
        const title = getFirstMatch(body, /<h2\b[^>]*>([\s\S]*?)<\/h2>/i) || id;
        const authorText = getFirstMatch(body, /<span\b[^>]*>\s*By\s+([\s\S]*?)<\/span>/i);
        const description = getFirstMatch(body, /<p\b[^>]*>([\s\S]*?)<\/p>/i);
        const thumbnailUrl = getFirstMatch(body, /<img\b[^>]*src="([^"]+)"/i);

        results.push({
            id,
            resourceType,
            title: stripHtml(title),
            description: truncateText(stripHtml(description)),
            author: stripHtml(authorText),
            sourceUrl: `${BASE_URL}/${sourceKind}/${id}`,
            thumbnailUrl: thumbnailUrl || '',
            downloadUrl: `${BASE_URL}/api/v1/download/${DOWNLOAD_FORMATS[resourceType]?.format || 'json-v3'}/${id}?non_commercial=true&cors=true`,
            capabilities: { download: Boolean(DOWNLOAD_FORMATS[resourceType]) },
            metadata: { risuKind: sourceKind },
        });
    }

    return results;
}

function getFirstMatch(text, pattern) {
    const match = pattern.exec(text || '');
    return match ? match[1] : '';
}

async function probeDownloadAvailability(item) {
    if (!item.capabilities.download || !item.downloadUrl) {
        return item;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_PROBE_TIMEOUT_MS);
    try {
        const response = await fetch(item.downloadUrl, {
            method: 'HEAD',
            signal: controller.signal,
            headers: {
                'Accept': '*/*',
                'User-Agent': 'SillyTavern Remote Resources',
            },
        });
        return {
            ...item,
            capabilities: { ...item.capabilities, download: response.ok },
        };
    } catch {
        return {
            ...item,
            capabilities: { ...item.capabilities, download: false },
        };
    } finally {
        clearTimeout(timer);
    }
}

// 在 SEARCH_PROBE_BUDGET_MS 总预算内按 PROBE_CONCURRENCY 分批探测下载可用性，结果顺序与全量并发一致。
// 超预算后剩余候选按解析出的可用状态透传（单探测仍有 DOWNLOAD_PROBE_TIMEOUT_MS 兜底），
// 避免慢但可达的主机把探测阶段拖到分钟级。
async function probeCandidates(candidates) {
    const deadline = Date.now() + SEARCH_PROBE_BUDGET_MS;
    const results = [];
    for (let index = 0; index < candidates.length; index += PROBE_CONCURRENCY) {
        if (Date.now() >= deadline) {
            results.push(...candidates.slice(index));
            break;
        }
        const batch = candidates.slice(index, index + PROBE_CONCURRENCY);
        results.push(...await Promise.all(batch.map(probeDownloadAvailability)));
    }
    return results;
}
