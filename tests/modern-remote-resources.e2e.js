import { test, expect } from '@playwright/test';
import { createRemoteResourceActions } from '../public/modern/actions/remote-resources.js';
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
        expect(state.remoteResources.errors).toEqual(['P3 upstream failed', 'Provider 4: network down']);
        expect(statuses()).toEqual(['done', 'done', 'failed', 'failed', 'done', 'done', 'done', 'done']);
        expect(toasts).toEqual([['部分资源站读取失败', 'P3 upstream failed']]);
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
        expect(state.remoteResources.errors).toEqual(['Site A: 当前会话没有访问权限，请先登录。', 'Site B: 当前会话没有访问权限，请先登录。']);
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
        await expect(page.locator('.remote-resource-warning')).toContainText('Broken Site search failed: 502');
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
