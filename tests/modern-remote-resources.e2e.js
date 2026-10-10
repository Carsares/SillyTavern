import { test, expect } from '@playwright/test';
import { createRemoteResourceActions, describeRemoteSearchError, summarizeRemoteError } from '../public/modern/actions/remote-resources.js';
import { gotoModern, mockModernWorkspace } from './modern-test-utils.js';

function fulfillJson(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

function createDeferred() {
    let resolve;
    const promise = new Promise(done => {
        resolve = done;
    });
    return { promise, resolve };
}

function flush() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function createProvider(id, name, overrides = {}) {
    return {
        id,
        name,
        description: `${name} fixture`,
        authMode: 'none',
        supportsSearch: true,
        supportsDownload: true,
        supportsInstall: false,
        supportsUrlImport: false,
        enabled: true,
        credentials: [],
        ...overrides,
    };
}

function createItems(providerId, providerName, count, prefix = '') {
    return Array.from({ length: count }, (_, index) => {
        const number = String(index + 1).padStart(2, '0');
        return {
            id: `${prefix}${providerId}-${number}`,
            providerId,
            providerName,
            resourceType: 'character',
            title: `${prefix}${providerName} #${number}`,
            description: '',
            author: '',
            tags: [],
            stats: {},
            thumbnailUrl: '',
            sourceUrl: `https://example.invalid/${providerId}/${number}`,
            capabilities: { download: true },
            metadata: {},
        };
    });
}

// Mocks every remote-resources endpoint so the page never reaches a real resource site.
async function mockRemoteResourcesWorkspace(page, { providers, onSearch }) {
    await mockModernWorkspace(page);
    const searchRequests = [];
    const settledSearches = [];
    await page.route('**/api/remote-resources/providers', route => fulfillJson(route, providers));
    await page.route('**/api/remote-resources/records', route => fulfillJson(route, []));
    await page.route('**/api/remote-resources/search', async route => {
        const body = route.request().postDataJSON();
        searchRequests.push(body);
        const response = await onSearch(body);
        try {
            await fulfillJson(route, response);
        } catch {
            // The page may already have aborted this request (cancel or a newer search).
        }
        settledSearches.push(body);
    });
    return { searchRequests, settledSearches };
}

async function openRemoteResources(page, providerCount) {
    await gotoModern(page, 'remoteResources', '远程资源');
    await expect(page.locator('[data-remote-provider]')).toHaveCount(providerCount);
}

function searchResultMetric(page) {
    return page.locator('.metric-card', { hasText: '搜索结果' }).locator('.metric-value');
}

test.describe('Modern remote resources search actions', () => {
    test('fans out one request per enabled provider with at most six in flight and merges in provider order', async () => {
        const providers = Array.from({ length: 8 }, (_, index) => ({ id: `p${index + 1}`, name: `Provider ${index + 1}`, supportsSearch: true, enabled: true }));
        providers.push({ id: 'off', name: 'Disabled Provider', supportsSearch: true, enabled: false });
        const state = {
            remoteResources: {
                loaded: true,
                searching: false,
                searched: false,
                query: ' Raiden ',
                resourceType: 'character',
                selectedProviders: providers.map(provider => provider.id),
                providers,
                results: [],
                total: 0,
                errors: [],
                records: [],
            },
        };
        const requested = [];
        const pending = new Map();
        const toasts = [];
        let inFlight = 0;
        let maxInFlight = 0;
        const actions = createRemoteResourceActions({
            state,
            apiFetch: (url, options) => {
                expect(url).toBe('/api/remote-resources/search');
                requested.push(options.body);
                inFlight += 1;
                maxInFlight = Math.max(maxInFlight, inFlight);
                return new Promise((resolve, reject) => {
                    pending.set(options.body.providers[0], {
                        resolve: value => {
                            inFlight -= 1;
                            resolve(value);
                        },
                        reject: error => {
                            inFlight -= 1;
                            reject(error);
                        },
                    });
                });
            },
            render: () => {},
            showToast: (...args) => toasts.push(args),
        });
        const statuses = () => state.remoteResources.searchProgress.providers.map(provider => provider.status);

        const search = actions.searchRemoteResources();

        expect(requested.map(body => body.providers)).toEqual([['p1'], ['p2'], ['p3'], ['p4'], ['p5'], ['p6']]);
        expect(requested[0]).toEqual({ query: 'Raiden', resourceType: 'character', providers: ['p1'], page: 1, limit: 48 });
        expect(state.remoteResources.searching).toBe(true);
        expect(statuses()).toEqual(['running', 'running', 'running', 'running', 'running', 'running', 'queued', 'queued']);

        pending.get('p2').resolve({ items: [{ id: 'p2-a' }], total: 7, errors: [] });
        await flush();
        expect(state.remoteResources.results).toEqual([{ id: 'p2-a' }]);
        expect(requested.map(body => body.providers[0])).toContain('p7');
        expect(statuses().slice(0, 7)).toEqual(['running', 'done', 'running', 'running', 'running', 'running', 'running']);

        // A provider earlier in the list that answers later is still merged ahead of later providers.
        pending.get('p1').resolve({ items: [{ id: 'p1-a' }, { id: 'p1-b' }], total: 0, errors: [] });
        await flush();
        expect(state.remoteResources.results.map(item => item.id)).toEqual(['p1-a', 'p1-b', 'p2-a']);
        expect(state.remoteResources.total).toBe(9);

        pending.get('p3').resolve({ items: [], total: 0, errors: ['P3 upstream failed'] });
        pending.get('p4').reject(new Error('network down'));
        for (const id of ['p5', 'p6', 'p7']) {
            pending.get(id).resolve({ items: [], total: 0, errors: [] });
        }
        await flush();
        pending.get('p8').resolve({ items: [{ id: 'p8-a' }], total: 1, errors: [] });
        await search;

        expect(maxInFlight).toBe(6);
        expect(requested).toHaveLength(8);
        expect(requested.some(body => body.providers.includes('off'))).toBe(false);
        expect(state.remoteResources.searching).toBe(false);
        expect(state.remoteResources.results.map(item => item.id)).toEqual(['p1-a', 'p1-b', 'p2-a', 'p8-a']);
        expect(state.remoteResources.total).toBe(10);
        expect(state.remoteResources.errors).toEqual([
            { providerId: 'p3', providerName: 'Provider 3', summary: 'P3 upstream failed', detail: 'P3 upstream failed' },
            { providerId: 'p4', providerName: 'Provider 4', summary: '网络连接失败', detail: 'network down' },
        ]);
        expect(statuses()).toEqual(['done', 'done', 'failed', 'failed', 'done', 'done', 'done', 'done']);
        expect(toasts).toEqual([['部分资源站读取失败', 'Provider 3：P3 upstream failed；Provider 4：网络连接失败']]);
    });

    test('cancelling keeps received results, aborts pending requests, and a new search aborts the previous one', async () => {
        const providers = ['a', 'b', 'c'].map(id => ({ id, name: `Site ${id.toUpperCase()}`, supportsSearch: true }));
        const state = {
            remoteResources: {
                loaded: true,
                searching: false,
                searched: false,
                query: 'first',
                resourceType: '',
                selectedProviders: [],
                providers,
                results: [],
                total: 0,
                errors: [],
                records: [],
            },
        };
        const calls = [];
        const toasts = [];
        const actions = createRemoteResourceActions({
            state,
            apiFetch: (_url, options) => new Promise((resolve, reject) => {
                calls.push({ query: options.body.query, providerId: options.body.providers[0], signal: options.signal, resolve, reject });
            }),
            render: () => {},
            showToast: (...args) => toasts.push(args),
        });
        const callFor = (query, providerId) => calls.find(call => call.query === query && call.providerId === providerId);

        const firstSearch = actions.searchRemoteResources();
        expect(calls.map(call => call.providerId)).toEqual(['a', 'b', 'c']);
        callFor('first', 'a').resolve({ items: [{ id: 'a-1' }], total: 1, errors: [] });
        await flush();

        actions.cancelRemoteSearch();

        expect(callFor('first', 'b').signal.aborted).toBe(true);
        expect(callFor('first', 'c').signal.aborted).toBe(true);
        expect(state.remoteResources.searching).toBe(false);
        expect(state.remoteResources.results).toEqual([{ id: 'a-1' }]);
        expect(state.remoteResources.searchProgress.cancelled).toBe(true);
        expect(state.remoteResources.searchProgress.providers.map(provider => provider.status)).toEqual(['done', 'cancelled', 'cancelled']);
        expect(toasts).toEqual([['已取消搜索', '已保留 1 条结果']]);

        // Late answers from the cancelled search must not leak into the kept results.
        callFor('first', 'b').resolve({ items: [{ id: 'b-late' }], total: 1, errors: [] });
        callFor('first', 'c').reject(new Error('aborted'));
        await firstSearch;
        expect(state.remoteResources.results).toEqual([{ id: 'a-1' }]);
        expect(state.remoteResources.errors).toEqual([]);
        expect(toasts).toHaveLength(1);

        state.remoteResources.query = 'second';
        const secondSearch = actions.searchRemoteResources();
        expect(state.remoteResources.results).toEqual([]);
        state.remoteResources.query = 'third';
        const thirdSearch = actions.searchRemoteResources();
        expect(['a', 'b', 'c'].every(id => callFor('second', id).signal.aborted)).toBe(true);
        expect(['a', 'b', 'c'].some(id => callFor('third', id).signal.aborted)).toBe(false);

        for (const id of ['a', 'b', 'c']) {
            callFor('second', id).resolve({ items: [{ id: `second-${id}` }], total: 1, errors: [] });
            callFor('third', id).resolve({ items: [{ id: `third-${id}` }], total: 1, errors: [] });
        }
        await Promise.all([secondSearch, thirdSearch]);
        expect(state.remoteResources.results.map(item => item.id)).toEqual(['third-a', 'third-b', 'third-c']);
        expect(state.remoteResources.searching).toBe(false);
    });

    test('reports a whole-search failure when every provider request fails', async () => {
        const state = {
            remoteResources: {
                loaded: true,
                searching: false,
                searched: false,
                query: 'x',
                resourceType: '',
                selectedProviders: ['a', 'b'],
                providers: [{ id: 'a', name: 'Site A', supportsSearch: true }, { id: 'b', name: 'Site B', supportsSearch: true }],
                results: [],
                total: 0,
                errors: [],
                records: [],
            },
        };
        const actions = createRemoteResourceActions({
            state,
            apiFetch: async () => {
                throw new Error('当前会话没有访问权限，请先登录。');
            },
            render: () => {},
            showToast: () => {},
        });

        await expect(actions.searchRemoteResources()).rejects.toThrow('当前会话没有访问权限，请先登录。');
        expect(state.remoteResources.searching).toBe(false);
        expect(state.remoteResources.errors.map(error => `${error.providerName}：${error.summary}`)).toEqual([
            'Site A：当前会话没有访问权限，请先登录。',
            'Site B：当前会话没有访问权限，请先登录。',
        ]);
    });

    test('turns provider failures into short per-site messages without upstream HTML', async () => {
        const htmlPage = '<!doctype html> <html lang="en"> <head> <meta charset="utf-8" /> <title>404</title> <script>window.__DATA__ = "<b>";</script> </head> <body><h1>Page   not found</h1></body></html>';
        expect(summarizeRemoteError(`Remote request failed: 404 Not Found - ${htmlPage}`)).toEqual({
            summary: '404 未找到',
            detail: 'Remote request failed: 404 Not Found - 404 Page not found',
        });
        expect(summarizeRemoteError('Remote request failed: 403 Forbidden - Just a moment...').summary).toBe('403 被拒绝');
        expect(summarizeRemoteError('Remote request rate limited (429), retry after 30s').summary).toBe('429 请求过于频繁');
        expect(summarizeRemoteError('Remote request failed: 522').summary).toBe('522 服务器错误');
        expect(summarizeRemoteError('Remote request timed out after 20s').summary).toBe('请求超时');
        expect(summarizeRemoteError('request to https://example.invalid/a failed, reason: read ECONNRESET').summary).toBe('网络连接失败');
        const long = summarizeRemoteError(`Unexpected provider reply ${'x'.repeat(400)}`);
        expect(long.summary.length).toBeLessThanOrEqual(120);
        expect(long.summary.endsWith('…')).toBe(true);
        // The backend prefixes `errors` strings with the site name; it is not repeated in the UI text.
        expect(describeRemoteSearchError({ id: 'wyvern', name: 'WyvernChat' }, 'WyvernChat: Remote request failed: 403 Forbidden')).toEqual({
            providerId: 'wyvern',
            providerName: 'WyvernChat',
            summary: '403 被拒绝',
            detail: 'Remote request failed: 403 Forbidden',
        });

        const providers = ['a', 'b', 'c'].map(id => ({ id, name: `Site ${id.toUpperCase()}`, supportsSearch: true }));
        const state = {
            remoteResources: {
                loaded: true,
                searching: false,
                searched: false,
                query: '',
                resourceType: '',
                selectedProviders: [],
                providers,
                results: [],
                total: 0,
                errors: [],
                records: [],
            },
        };
        const toasts = [];
        const actions = createRemoteResourceActions({
            state,
            apiFetch: async (_url, options) => {
                const [providerId] = options.body.providers;
                if (providerId === 'a') {
                    // Current backend: structured providerErrors next to the name-prefixed strings.
                    return {
                        items: [],
                        total: 0,
                        errors: ['Site A: Remote request failed: 404 Not Found'],
                        providerErrors: [{ providerId: 'a', providerName: 'Site A', message: 'Remote request failed: 404 Not Found' }],
                    };
                }
                if (providerId === 'b') {
                    // Older backend: a raw error string that still embeds an HTML page.
                    return { items: [], total: 0, errors: [`Remote request failed: 502 Bad Gateway - ${htmlPage}`] };
                }
                return { items: [], total: 0, errors: ['Remote request timed out after 20s'] };
            },
            render: () => {},
            showToast: (...args) => toasts.push(args),
        });

        await actions.searchRemoteResources();

        expect(state.remoteResources.errors.map(error => `${error.providerName}：${error.summary}`)).toEqual([
            'Site A：404 未找到',
            'Site B：502 网关错误',
            'Site C：请求超时',
        ]);
        expect(state.remoteResources.errors.every(error => !/[<>]/.test(error.detail))).toBe(true);
        expect(toasts).toEqual([['部分资源站读取失败', 'Site A：404 未找到；Site B：502 网关错误 等 3 个资源站']]);
    });
});

test.describe('Modern remote resources page', () => {
    test('shows each site\'s results as soon as it responds, with per-site progress', async ({ page }) => {
        const slow = createDeferred();
        const providers = [
            createProvider('slow-site', 'Slow Site'),
            createProvider('fast-site', 'Fast Site'),
            createProvider('broken-site', 'Broken Site'),
        ];
        const { searchRequests } = await mockRemoteResourcesWorkspace(page, {
            providers,
            onSearch: async body => {
                const [providerId] = body.providers;
                if (providerId === 'slow-site') {
                    await slow.promise;
                    return { items: createItems('slow-site', 'Slow Site', 2), total: 2, errors: [] };
                }
                if (providerId === 'fast-site') {
                    return { items: createItems('fast-site', 'Fast Site', 3), total: 3, errors: [] };
                }
                return { items: [], total: 0, errors: ['Broken Site search failed: 502'] };
            },
        });
        await openRemoteResources(page, 3);

        await page.locator('[data-remote-resource-query]').fill('Raiden');
        await page.locator('[data-search-remote-resources]').click();

        const summary = page.locator('[data-remote-search-progress-summary]');
        await expect(summary).toHaveText('已完成 2 / 3 个资源站 · 已找到 3 条');
        await expect(page.locator('.remote-resource-card')).toHaveCount(3);
        await expect(page.locator('[data-remote-search-pending]')).toHaveText('等待响应（1）：Slow Site');
        await expect(page.locator('[data-remote-search-failed]')).toHaveText('失败（1）：Broken Site');
        const brokenError = page.locator('[data-remote-search-error="broken-site"]');
        await expect(brokenError).toHaveText('Broken Site：502 网关错误');
        await expect(brokenError).toHaveAttribute('title', 'Broken Site search failed: 502');
        await expect(page.locator('[data-cancel-remote-search]')).toBeVisible();
        await expect(page.locator('[data-search-remote-resources]')).toBeEnabled();
        await expect(searchResultMetric(page)).toHaveText('3');
        expect(searchRequests.map(body => body.providers).sort()).toEqual([['broken-site'], ['fast-site'], ['slow-site']]);
        expect(searchRequests.every(body => body.query === 'Raiden' && body.resourceType === '' && body.limit === 48)).toBe(true);

        slow.resolve();

        await expect(summary).toHaveText('已完成 3 / 3 个资源站 · 共找到 5 条');
        // Final order follows the provider list, so the slow first site lands ahead of the fast one.
        await expect(page.locator('.remote-resource-card h2')).toHaveText([
            'Slow Site #01',
            'Slow Site #02',
            'Fast Site #01',
            'Fast Site #02',
            'Fast Site #03',
        ]);
        await expect(page.locator('[data-cancel-remote-search]')).toHaveCount(0);
        await expect(page.locator('[data-remote-search-pending]')).toHaveCount(0);
        await expect(page.locator('[data-remote-search-failed]')).toHaveText('失败（1）：Broken Site');
        await expect(searchResultMetric(page)).toHaveText('5');
    });

    test('cancels a running search, keeps the partial results, and can search again', async ({ page }) => {
        const slow = createDeferred();
        const providers = [createProvider('fast-site', 'Fast Site'), createProvider('slow-site', 'Slow Site'), createProvider('other-site', 'Other Site')];
        const { settledSearches } = await mockRemoteResourcesWorkspace(page, {
            providers,
            onSearch: async body => {
                const [providerId] = body.providers;
                if (providerId === 'slow-site') {
                    await slow.promise;
                    return { items: createItems('slow-site', 'Slow Site', 2), total: 2, errors: [] };
                }
                if (providerId === 'fast-site') {
                    return { items: createItems('fast-site', 'Fast Site', 3), total: 3, errors: [] };
                }
                return { items: createItems('other-site', 'Other Site', 1), total: 1, errors: [] };
            },
        });
        await openRemoteResources(page, 3);

        await page.locator('[data-remote-resource-query]').fill('Raiden');
        await page.locator('[data-search-remote-resources]').click();
        const summary = page.locator('[data-remote-search-progress-summary]');
        await expect(summary).toHaveText('已完成 2 / 3 个资源站 · 已找到 4 条');

        await page.locator('[data-cancel-remote-search]').click();

        await expect(summary).toHaveText('已取消搜索 · 已完成 2 / 3 个资源站 · 保留 4 条');
        await expect(page.locator('[data-remote-search-cancelled]')).toHaveText('未完成（1）：Slow Site');
        await expect(page.locator('[data-cancel-remote-search]')).toHaveCount(0);
        await expect(page.locator('[data-search-remote-resources]')).toBeEnabled();
        await expect(page.locator('.remote-resource-card')).toHaveCount(4);
        await expect(searchResultMetric(page)).toHaveText('4');

        // Let the aborted request finish server-side; its items must never appear.
        slow.resolve();
        await expect.poll(() => settledSearches.length).toBe(3);
        await expect(page.locator('.remote-resource-card', { hasText: 'Slow Site' })).toHaveCount(0);
        await expect(summary).toHaveText('已取消搜索 · 已完成 2 / 3 个资源站 · 保留 4 条');

        await page.locator('[data-search-remote-resources]').click();
        await expect(summary).toHaveText('已完成 3 / 3 个资源站 · 共找到 6 条');
        await expect(page.locator('.remote-resource-card')).toHaveCount(6);
    });

    test('a new search discards results from the previous in-flight search', async ({ page }) => {
        const firstSlow = createDeferred();
        const providers = [createProvider('fast-site', 'Fast Site'), createProvider('slow-site', 'Slow Site')];
        const { settledSearches } = await mockRemoteResourcesWorkspace(page, {
            providers,
            onSearch: async body => {
                const [providerId] = body.providers;
                const name = providerId === 'fast-site' ? 'Fast Site' : 'Slow Site';
                if (body.query === 'first' && providerId === 'slow-site') {
                    await firstSlow.promise;
                }
                return { items: createItems(providerId, name, 2, `${body.query} `), total: 2, errors: [] };
            },
        });
        await openRemoteResources(page, 2);

        const queryInput = page.locator('[data-remote-resource-query]');
        await queryInput.fill('first');
        await page.locator('[data-search-remote-resources]').click();
        const summary = page.locator('[data-remote-search-progress-summary]');
        await expect(summary).toHaveText('已完成 1 / 2 个资源站 · 已找到 2 条');

        await queryInput.fill('second');
        await queryInput.press('Enter');
        await expect(summary).toHaveText('已完成 2 / 2 个资源站 · 共找到 4 条');

        firstSlow.resolve();
        await expect.poll(() => settledSearches.length).toBe(4);
        await expect(page.locator('.remote-resource-card', { hasText: 'first' })).toHaveCount(0);
        await expect(page.locator('.remote-resource-card h2')).toHaveText([
            'second Fast Site #01',
            'second Fast Site #02',
            'second Slow Site #01',
            'second Slow Site #02',
        ]);
    });

    test('lists failed sites with short messages, keeps card chips and buttons at natural height, and replaces broken thumbnails once', async ({ page }) => {
        const slow = createDeferred();
        // Cards arrive only after the failing sites answered, so no re-render races the broken thumbnail's error event.
        const releaseCards = createDeferred();
        const brokenThumb = 'https://thumbs.example.invalid/broken/avatar.webp';
        const workingThumb = 'https://thumbs.example.invalid/ok/avatar.png';
        const brokenThumbRequests = [];
        // 1x1 PNG so the working thumbnail really loads.
        const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
        await page.route('https://thumbs.example.invalid/**', route => {
            if (route.request().url() === brokenThumb) {
                brokenThumbRequests.push(route.request().url());
                return route.abort('connectionreset');
            }
            return route.fulfill({ status: 200, contentType: 'image/png', body: pixel });
        });
        const [tallCard, bareCard] = createItems('fast-site', 'Fast Site', 2);
        Object.assign(tallCard, {
            description: '这是一段很长的简介，用来把同一行里的卡片撑高。'.repeat(12),
            tags: ['Game Characters', 'Wholesome', 'Fantasy'],
            thumbnailUrl: brokenThumb,
        });
        Object.assign(bareCard, { thumbnailUrl: workingThumb });
        const htmlPage = '<!doctype html> <html lang="en"> <head> <meta charset="utf-8" /> <title>404</title> </head> <body>Not found</body></html>';
        const providers = [
            createProvider('fast-site', 'Fast Site'),
            createProvider('character-tavern', 'Character Tavern'),
            createProvider('wyvern-chat', 'WyvernChat'),
            createProvider('slow-site', 'Slow Site'),
        ];
        await mockRemoteResourcesWorkspace(page, {
            providers,
            onSearch: async body => {
                const [providerId] = body.providers;
                if (providerId === 'fast-site') {
                    await releaseCards.promise;
                    return { items: [tallCard, bareCard], total: 2, errors: [] };
                }
                if (providerId === 'character-tavern') {
                    return { items: [], total: 0, errors: [`Character Tavern: Remote request failed: 404 Not Found - ${htmlPage}`] };
                }
                if (providerId === 'wyvern-chat') {
                    return {
                        items: [],
                        total: 0,
                        errors: ['WyvernChat: Remote request failed: 403 Forbidden - Just a moment...'],
                        providerErrors: [{ providerId, providerName: 'WyvernChat', message: 'Remote request failed: 403 Forbidden - Just a moment...' }],
                    };
                }
                await slow.promise;
                return { items: createItems('slow-site', 'Slow Site', 1), total: 1, errors: [] };
            },
        });
        await openRemoteResources(page, 4);

        await page.locator('[data-search-remote-resources]').click();
        await expect(page.locator('[data-remote-search-progress-summary]')).toHaveText('已完成 2 / 4 个资源站 · 已找到 0 条');
        releaseCards.resolve();
        await expect(page.locator('[data-remote-search-progress-summary]')).toHaveText('已完成 3 / 4 个资源站 · 已找到 2 条');

        // One short line per failed site, named like the progress list; the cleaned full error stays in the title.
        await expect(page.locator('[data-remote-search-failed]')).toHaveText('失败（2）：Character Tavern、WyvernChat');
        await expect(page.locator('[data-remote-search-error]')).toHaveText(['Character Tavern：404 未找到', 'WyvernChat：403 被拒绝']);
        await expect(page.locator('[data-remote-search-error="character-tavern"]')).toHaveAttribute('title', 'Remote request failed: 404 Not Found - 404 Not found');
        await expect(page.locator('[data-remote-search-errors]')).not.toContainText('<');
        await expect(page.locator('.toast', { hasText: '部分资源站读取失败' })).toHaveCount(0);

        const cards = page.locator('.remote-resource-card');
        await expect(cards).toHaveCount(2);
        const [tallBox, bareBox] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
        // Both cards share a grid row, so the bare card is stretched to the tall card's height.
        expect(Math.abs(tallBox.y - bareBox.y)).toBeLessThan(1);
        expect(Math.abs(tallBox.height - bareBox.height)).toBeLessThan(1);
        for (const tag of await cards.nth(0).locator('.tag-row .tag').all()) {
            expect((await tag.boundingBox()).height).toBeLessThanOrEqual(32);
        }
        const bareActions = cards.nth(1).locator('.row-actions > *');
        await expect(bareActions).toHaveCount(3);
        for (const action of await bareActions.all()) {
            expect((await action.boundingBox()).height).toBeLessThanOrEqual(44);
        }
        // Actions sit at the bottom of the stretched card.
        const lastAction = await bareActions.last().boundingBox();
        expect(bareBox.y + bareBox.height - (lastAction.y + lastAction.height)).toBeLessThan(24);

        // The broken thumbnail becomes a placeholder; the working one stays an image.
        await expect(cards.nth(0).locator('[data-remote-thumb-failed]')).toHaveAttribute('title', '缩略图加载失败');
        await expect(cards.nth(0).locator('img')).toHaveCount(0);
        await expect(cards.nth(1).locator('img[data-remote-thumb]')).toHaveCount(1);
        expect(brokenThumbRequests).toHaveLength(1);

        // The next site's results re-render the page; the failed thumbnail is not requested again.
        slow.resolve();
        await expect(page.locator('[data-remote-search-progress-summary]')).toHaveText('已完成 4 / 4 个资源站 · 共找到 3 条');
        await expect(cards).toHaveCount(3);
        await expect(cards.nth(0).locator('[data-remote-thumb-failed]')).toHaveCount(1);
        await expect(page.locator('.toast', { hasText: '部分资源站读取失败' })).toContainText('Character Tavern：404 未找到；WyvernChat：403 被拒绝');
        expect(brokenThumbRequests).toHaveLength(1);
    });

    test('paginates search results instead of rendering every card at once', async ({ page }) => {
        const providers = [createProvider('big-site', 'Big Site'), createProvider('small-site', 'Small Site')];
        await mockRemoteResourcesWorkspace(page, {
            providers,
            onSearch: async body => {
                const [providerId] = body.providers;
                return providerId === 'big-site'
                    ? { items: createItems('big-site', 'Big Site', 30), total: 120, errors: [] }
                    : { items: createItems('small-site', 'Small Site', 2), total: 2, errors: [] };
            },
        });
        await openRemoteResources(page, 2);

        await page.locator('[data-search-remote-resources]').click();
        await expect(page.locator('[data-remote-search-progress-summary]')).toHaveText('已完成 2 / 2 个资源站 · 共找到 32 条');

        const cards = page.locator('.remote-resource-card');
        const topPager = page.locator('[data-remote-result-pager="top"]');
        const bottomPager = page.locator('[data-remote-result-pager="bottom"]');
        await expect(cards).toHaveCount(24);
        await expect(topPager.locator('[data-remote-result-page-badge]')).toHaveText('1 / 2');
        await expect(topPager).toContainText('第 1–24 条，共 32 条');
        await expect(searchResultMetric(page)).toHaveText('32');
        await expect(page.locator('.metric-card', { hasText: '搜索结果' }).locator('.metric-delta')).toHaveText('122 条匹配');
        await expect(cards.first().locator('[data-import-remote-resource]')).toHaveAttribute('data-import-remote-resource', '0');
        await expect(topPager.getByRole('button', { name: '上一页' })).toBeDisabled();

        await bottomPager.getByRole('button', { name: '下一页' }).click();

        await expect(cards).toHaveCount(8);
        await expect(topPager.locator('[data-remote-result-page-badge]')).toHaveText('2 / 2');
        await expect(topPager).toContainText('第 25–32 条，共 32 条');
        // Card actions keep pointing at the absolute index in the full result list.
        await expect(cards.first().locator('h2')).toHaveText('Big Site #25');
        await expect(cards.first().locator('[data-import-remote-resource]')).toHaveAttribute('data-import-remote-resource', '24');
        await expect(cards.last().locator('h2')).toHaveText('Small Site #02');
        await expect(topPager.getByRole('button', { name: '下一页' })).toBeDisabled();
        await expect(searchResultMetric(page)).toHaveText('32');

        // A fresh search starts again from the first page.
        await page.locator('[data-search-remote-resources]').click();
        await expect(topPager.locator('[data-remote-result-page-badge]')).toHaveText('1 / 2');
        await expect(cards).toHaveCount(24);
    });
});
