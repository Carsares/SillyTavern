/* eslint-disable playwright/no-skipped-test, playwright/no-conditional-in-test */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoModern } from './modern-test-utils.js';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8000';
const userDataRoot = path.resolve('data/default-user');
const assetsDir = path.join(userDataRoot, 'assets');
const localExtensionsDir = path.join(userDataRoot, 'extensions');
const globalExtensionsDir = path.resolve('public/scripts/extensions/third-party');

const externalEnabled = process.env.MODERN_EXTERNAL_E2E === '1';
const externalAssetUrl = process.env.MODERN_EXTERNAL_ASSET_URL || 'https://raw.githubusercontent.com/SillyTavern/Extension-TopInfoBar/main/manifest.json';
const externalAssetNeedle = process.env.MODERN_EXTERNAL_ASSET_EXPECT || '"display_name"';
const externalExtensionUrl = process.env.MODERN_EXTERNAL_EXTENSION_URL || 'https://github.com/SillyTavern/Extension-TopInfoBar.git';
const externalExtensionBranch = process.env.MODERN_EXTERNAL_EXTENSION_BRANCH || 'main';
const externalExtensionName = process.env.MODERN_EXTERNAL_EXTENSION_NAME || getExtensionNameFromUrl(externalExtensionUrl);
const openRouterApiKey = process.env.MODERN_EXTERNAL_OPENROUTER_API_KEY || '';
const openRouterModel = process.env.MODERN_EXTERNAL_OPENROUTER_MODEL || '';

function apiUrl(routePath) {
    return new URL(routePath, baseURL).toString();
}

function uniqueName(label) {
    return `ModernExternal-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getExtensionNameFromUrl(url) {
    try {
        return path.basename(new URL(url).pathname, '.git');
    } catch {
        return '';
    }
}

function trackApiRequests(page) {
    const requests = [];
    page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname === '/csrf-token' || url.pathname.startsWith('/api/')) {
            requests.push({
                method: request.method(),
                path: url.pathname,
                body: request.postData() || '',
            });
        }
    });

    return {
        count(routePath, method = 'POST') {
            return requests.filter(request => request.path === routePath && request.method === method).length;
        },
        lastJson(routePath, method = 'POST') {
            const request = requests.filter(item => item.path === routePath && item.method === method).at(-1);
            if (!request?.body) {
                return null;
            }
            try {
                return JSON.parse(request.body);
            } catch {
                return null;
            }
        },
    };
}

async function expectFrontendRequest(tracker, routePath, method = 'POST') {
    await expect.poll(() => tracker.count(routePath, method), { message: `${method} ${routePath}` }).toBeGreaterThan(0);
}

async function getCsrfToken(page) {
    const response = await page.request.get(apiUrl('/csrf-token'));
    if (!response.ok()) {
        throw new Error(`/csrf-token failed: ${response.status()}`);
    }
    const data = await response.json();
    return data.token;
}

async function apiFetch(page, routePath, body = undefined, method = 'POST') {
    const token = await getCsrfToken(page);
    const response = await page.request.fetch(apiUrl(routePath), {
        method,
        headers: {
            'X-CSRF-Token': token,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        data: body,
    });
    const text = await response.text();
    if (!response.ok()) {
        throw new Error(`${method} ${routePath} failed: ${response.status()} ${text}`);
    }
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function safeApiFetch(page, routePath, body = undefined, method = 'POST') {
    try {
        return await apiFetch(page, routePath, body, method);
    } catch {
        return null;
    }
}

async function getSettings(page) {
    const bundle = await apiFetch(page, '/api/settings/get');
    return JSON.parse(bundle.settings || '{}');
}

async function restoreSettings(page, settings) {
    if (settings) {
        await safeApiFetch(page, '/api/settings/save', settings);
    }
}

async function getSecretState(page) {
    return apiFetch(page, '/api/secrets/read');
}

function getSecretIds(secretState, key) {
    return new Set((secretState?.[key] || []).map(secret => secret.id).filter(Boolean));
}

function getActiveSecretId(secretState, key) {
    return (secretState?.[key] || []).find(secret => secret.active)?.id || '';
}

async function deleteNewSecrets(page, key, beforeIds) {
    const secretState = await safeApiFetch(page, '/api/secrets/read');
    for (const secret of secretState?.[key] || []) {
        if (!beforeIds.has(secret.id)) {
            await safeApiFetch(page, '/api/secrets/delete', { key, id: secret.id });
        }
    }
}

async function deleteCharacterByAvatar(page, avatar) {
    if (avatar) {
        await safeApiFetch(page, '/api/characters/delete', { avatar_url: avatar, delete_chats: true });
    }
}

async function deleteWorldbookByName(page, name) {
    if (name) {
        await safeApiFetch(page, '/api/worldinfo/delete', { name });
    }
}

async function cleanupNewRemoteRecords(page, beforeIds, providerId) {
    const records = await safeApiFetch(page, '/api/remote-resources/records', undefined, 'GET');
    for (const record of records || []) {
        if (record.providerId !== providerId || beforeIds.has(record.id)) {
            continue;
        }
        if (record.localType === 'character') {
            await deleteCharacterByAvatar(page, record.localId);
        } else if (record.localType === 'worldbook') {
            await deleteWorldbookByName(page, record.localId);
        }
        await safeApiFetch(page, `/api/remote-resources/records/${record.id}`, undefined, 'DELETE');
    }
}

async function searchOnlyRemoteProvider(page, tracker, providerId, resourceType, query) {
    await gotoModern(page, 'remoteResources', '远程资源');
    await expect(page.locator(`[data-remote-provider="${providerId}"]`)).toBeVisible({ timeout: 30_000 });

    const providers = page.locator('[data-remote-provider]');
    const providerCount = await providers.count();
    for (let index = 0; index < providerCount; index++) {
        const checkbox = providers.nth(index);
        const currentProviderId = await checkbox.getAttribute('data-remote-provider');
        const shouldCheck = currentProviderId === providerId;
        if (shouldCheck && !(await checkbox.isChecked())) {
            await checkbox.check();
        } else if (!shouldCheck && await checkbox.isChecked()) {
            await checkbox.uncheck();
        }
    }

    const searchCountBefore = tracker.count('/api/remote-resources/search');
    await page.locator('[data-remote-resource-type]').selectOption(resourceType);
    await page.locator('[data-remote-resource-query]').fill(query);
    await page.locator('[data-search-remote-resources]').click();
    await expect.poll(() => tracker.count('/api/remote-resources/search'), { timeout: 120_000 }).toBeGreaterThan(searchCountBefore);
}

test.describe('Modern external dependency integration', () => {
    test.describe.configure({ mode: 'serial' });
    test.skip(!externalEnabled, 'Set MODERN_EXTERNAL_E2E=1 to run tests that call external networks and vendors.');

    test('downloads a whitelisted public URL asset from the modern UI through the real backend', async ({ page }) => {
        const tracker = trackApiRequests(page);
        const category = 'bgm';
        const filename = `${uniqueName('Asset')}.txt`;
        const assetPath = path.join(assetsDir, category, filename);

        try {
            await gotoModern(page, 'assets', '素材库');
            await page.locator('[data-toggle-asset-download]').click();
            await page.locator('[data-asset-download-url]').fill(externalAssetUrl);
            await page.locator('[data-asset-download-filename]').fill(filename);
            await page.locator('[data-asset-download-category]').selectOption(category);
            await page.locator('[data-download-asset]').click();

            await expectFrontendRequest(tracker, '/api/assets/download');
            await expect.poll(() => fs.existsSync(assetPath), { timeout: 120_000 }).toBe(true);
            expect(fs.readFileSync(assetPath, 'utf8')).toContain(externalAssetNeedle);

            await page.locator('[data-asset-tab="files"]').click();
            await expect(page.locator(`[data-asset-row="${category}:assets/${category}/${filename}"]`)).toBeVisible();
        } finally {
            await safeApiFetch(page, '/api/assets/delete', { category, filename });
            fs.rmSync(assetPath, { force: true });
        }
    });

    test('imports a Cardbox Archive character from the modern UI through the real backend', async ({ page }) => {
        test.setTimeout(180_000);

        const tracker = trackApiRequests(page);
        const recordsBefore = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
        const recordIdsBefore = new Set((recordsBefore || []).map(record => record.id).filter(Boolean));

        try {
            await gotoModern(page, 'remoteResources', '远程资源');
            await expect(page.locator('[data-remote-provider="cardbox-archive"]')).toBeVisible({ timeout: 30_000 });

            const providers = page.locator('[data-remote-provider]');
            const providerCount = await providers.count();
            for (let index = 0; index < providerCount; index++) {
                const checkbox = providers.nth(index);
                const providerId = await checkbox.getAttribute('data-remote-provider');
                const shouldCheck = providerId === 'cardbox-archive';
                if (shouldCheck && !(await checkbox.isChecked())) {
                    await checkbox.check();
                } else if (!shouldCheck && await checkbox.isChecked()) {
                    await checkbox.uncheck();
                }
            }

            await page.locator('[data-remote-resource-type]').selectOption('character');
            await page.locator('[data-remote-resource-query]').fill('cat');
            await page.locator('[data-search-remote-resources]').click();

            await expectFrontendRequest(tracker, '/api/remote-resources/search');
            const card = page.locator('.remote-resource-card', { hasText: 'Cardbox Archive' }).first();
            await expect(card).toBeVisible({ timeout: 120_000 });
            await expect(card).toContainText('角色卡');

            const downloadCountBefore = tracker.count('/api/remote-resources/download');
            const importCountBefore = tracker.count('/api/characters/import');
            const recordsCountBefore = tracker.count('/api/remote-resources/records');
            await card.locator('[data-import-remote-resource]').click();

            await expect.poll(() => tracker.count('/api/remote-resources/download'), { timeout: 120_000 }).toBeGreaterThan(downloadCountBefore);
            await expect.poll(() => tracker.count('/api/characters/import'), { timeout: 120_000 }).toBeGreaterThan(importCountBefore);
            await expect.poll(() => tracker.count('/api/remote-resources/records'), { timeout: 120_000 }).toBeGreaterThan(recordsCountBefore);
            await expect(page.locator('.toast', { hasText: '角色已导入' })).toBeVisible({ timeout: 120_000 });

            await expect.poll(async () => {
                const records = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
                return (records || []).some(record => record.providerId === 'cardbox-archive' && !recordIdsBefore.has(record.id) && record.action === 'import');
            }, { timeout: 120_000 }).toBe(true);
        } finally {
            await cleanupNewRemoteRecords(page, recordIdsBefore, 'cardbox-archive');
        }
    });

    test('imports an AICG Rentry Events character from the modern UI through the real backend', async ({ page }) => {
        test.setTimeout(180_000);

        const tracker = trackApiRequests(page);
        const recordsBefore = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
        const recordIdsBefore = new Set((recordsBefore || []).map(record => record.id).filter(Boolean));

        try {
            await gotoModern(page, 'remoteResources', '远程资源');
            await expect(page.locator('[data-remote-provider="aicg-rentry-events"]')).toBeVisible({ timeout: 30_000 });

            const providers = page.locator('[data-remote-provider]');
            const providerCount = await providers.count();
            for (let index = 0; index < providerCount; index++) {
                const checkbox = providers.nth(index);
                const providerId = await checkbox.getAttribute('data-remote-provider');
                const shouldCheck = providerId === 'aicg-rentry-events';
                if (shouldCheck && !(await checkbox.isChecked())) {
                    await checkbox.check();
                } else if (!shouldCheck && await checkbox.isChecked()) {
                    await checkbox.uncheck();
                }
            }

            await page.locator('[data-remote-resource-type]').selectOption('character');
            await page.locator('[data-remote-resource-query]').fill('Celeste');
            await page.locator('[data-search-remote-resources]').click();

            await expectFrontendRequest(tracker, '/api/remote-resources/search');
            const card = page.locator('.remote-resource-card', { hasText: 'AICG Rentry Events' }).first();
            await expect(card).toBeVisible({ timeout: 120_000 });
            await expect(card).toContainText('Celeste');

            const downloadCountBefore = tracker.count('/api/remote-resources/download');
            const importCountBefore = tracker.count('/api/characters/import');
            const recordsCountBefore = tracker.count('/api/remote-resources/records');
            await card.locator('[data-import-remote-resource]').click();

            await expect.poll(() => tracker.count('/api/remote-resources/download'), { timeout: 120_000 }).toBeGreaterThan(downloadCountBefore);
            await expect.poll(() => tracker.count('/api/characters/import'), { timeout: 120_000 }).toBeGreaterThan(importCountBefore);
            await expect.poll(() => tracker.count('/api/remote-resources/records'), { timeout: 120_000 }).toBeGreaterThan(recordsCountBefore);
            await expect(page.locator('.toast', { hasText: '角色已导入' })).toBeVisible({ timeout: 120_000 });

            await expect.poll(async () => {
                const records = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
                return (records || []).some(record => record.providerId === 'aicg-rentry-events' && !recordIdsBefore.has(record.id) && record.action === 'import');
            }, { timeout: 120_000 }).toBe(true);
        } finally {
            await cleanupNewRemoteRecords(page, recordIdsBefore, 'aicg-rentry-events');
        }
    });

    test('imports a Rentry Tavern Export character from the modern UI through the real backend', async ({ page }) => {
        test.setTimeout(180_000);

        const tracker = trackApiRequests(page);
        const recordsBefore = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
        const recordIdsBefore = new Set((recordsBefore || []).map(record => record.id).filter(Boolean));

        try {
            await gotoModern(page, 'remoteResources', '远程资源');
            await expect(page.locator('[data-remote-provider="rentry-tavern-export"]')).toBeVisible({ timeout: 30_000 });

            const providers = page.locator('[data-remote-provider]');
            const providerCount = await providers.count();
            for (let index = 0; index < providerCount; index++) {
                const checkbox = providers.nth(index);
                const providerId = await checkbox.getAttribute('data-remote-provider');
                const shouldCheck = providerId === 'rentry-tavern-export';
                if (shouldCheck && !(await checkbox.isChecked())) {
                    await checkbox.check();
                } else if (!shouldCheck && await checkbox.isChecked()) {
                    await checkbox.uncheck();
                }
            }

            await page.locator('[data-remote-resource-type]').selectOption('character');
            await page.locator('[data-remote-resource-query]').fill('Loopi');
            await page.locator('[data-search-remote-resources]').click();

            await expectFrontendRequest(tracker, '/api/remote-resources/search');
            const card = page.locator('.remote-resource-card', { hasText: 'Rentry Tavern Export' }).first();
            await expect(card).toBeVisible({ timeout: 120_000 });
            await expect(card).toContainText('Loopi');

            const downloadCountBefore = tracker.count('/api/remote-resources/download');
            const importCountBefore = tracker.count('/api/characters/import');
            const recordsCountBefore = tracker.count('/api/remote-resources/records');
            await card.locator('[data-import-remote-resource]').click();

            await expect.poll(() => tracker.count('/api/remote-resources/download'), { timeout: 120_000 }).toBeGreaterThan(downloadCountBefore);
            await expect.poll(() => tracker.count('/api/characters/import'), { timeout: 120_000 }).toBeGreaterThan(importCountBefore);
            await expect.poll(() => tracker.count('/api/remote-resources/records'), { timeout: 120_000 }).toBeGreaterThan(recordsCountBefore);
            await expect(page.locator('.toast', { hasText: '角色已导入' })).toBeVisible({ timeout: 120_000 });

            await expect.poll(async () => {
                const records = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
                return (records || []).some(record => record.providerId === 'rentry-tavern-export' && !recordIdsBefore.has(record.id) && record.action === 'import');
            }, { timeout: 120_000 }).toBe(true);
        } finally {
            await cleanupNewRemoteRecords(page, recordIdsBefore, 'rentry-tavern-export');
        }
    });

    test('imports an AICG Rentry Directory character from the modern UI through the real backend', async ({ page }) => {
        test.setTimeout(180_000);

        const tracker = trackApiRequests(page);
        const recordsBefore = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
        const recordIdsBefore = new Set((recordsBefore || []).map(record => record.id).filter(Boolean));

        try {
            await gotoModern(page, 'remoteResources', '远程资源');
            await expect(page.locator('[data-remote-provider="aicg-rentry-directory"]')).toBeVisible({ timeout: 30_000 });

            const providers = page.locator('[data-remote-provider]');
            const providerCount = await providers.count();
            for (let index = 0; index < providerCount; index++) {
                const checkbox = providers.nth(index);
                const providerId = await checkbox.getAttribute('data-remote-provider');
                const shouldCheck = providerId === 'aicg-rentry-directory';
                if (shouldCheck && !(await checkbox.isChecked())) {
                    await checkbox.check();
                } else if (!shouldCheck && await checkbox.isChecked()) {
                    await checkbox.uncheck();
                }
            }

            await page.locator('[data-remote-resource-type]').selectOption('character');
            await page.locator('[data-remote-resource-query]').fill('Drasna');
            await page.locator('[data-search-remote-resources]').click();

            await expectFrontendRequest(tracker, '/api/remote-resources/search');
            const card = page.locator('.remote-resource-card', { hasText: 'AICG Rentry Directory' }).first();
            await expect(card).toBeVisible({ timeout: 120_000 });
            await expect(card).toContainText('Drasna');

            const downloadCountBefore = tracker.count('/api/remote-resources/download');
            const importCountBefore = tracker.count('/api/characters/import');
            const recordsCountBefore = tracker.count('/api/remote-resources/records');
            await card.locator('[data-import-remote-resource]').click();

            await expect.poll(() => tracker.count('/api/remote-resources/download'), { timeout: 120_000 }).toBeGreaterThan(downloadCountBefore);
            await expect.poll(() => tracker.count('/api/characters/import'), { timeout: 120_000 }).toBeGreaterThan(importCountBefore);
            await expect.poll(() => tracker.count('/api/remote-resources/records'), { timeout: 120_000 }).toBeGreaterThan(recordsCountBefore);
            await expect(page.locator('.toast', { hasText: '角色已导入' })).toBeVisible({ timeout: 120_000 });

            await expect.poll(async () => {
                const records = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
                return (records || []).some(record => record.providerId === 'aicg-rentry-directory' && !recordIdsBefore.has(record.id) && record.action === 'import');
            }, { timeout: 120_000 }).toBe(true);
        } finally {
            await cleanupNewRemoteRecords(page, recordIdsBefore, 'aicg-rentry-directory');
        }
    });

    test('imports a Character Archive Catbox character from the modern UI through the real backend', async ({ page }) => {
        test.setTimeout(180_000);

        const tracker = trackApiRequests(page);
        const recordsBefore = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
        const recordIdsBefore = new Set((recordsBefore || []).map(record => record.id).filter(Boolean));
        const screenshotDir = path.resolve('tests/test-results/remote-resources-providers');

        try {
            await gotoModern(page, 'remoteResources', '远程资源');
            await expect(page.locator('[data-remote-provider="character-archive-catbox"]')).toBeVisible({ timeout: 30_000 });

            const providers = page.locator('[data-remote-provider]');
            const providerCount = await providers.count();
            for (let index = 0; index < providerCount; index++) {
                const checkbox = providers.nth(index);
                const providerId = await checkbox.getAttribute('data-remote-provider');
                const shouldCheck = providerId === 'character-archive-catbox';
                if (shouldCheck && !(await checkbox.isChecked())) {
                    await checkbox.check();
                } else if (!shouldCheck && await checkbox.isChecked()) {
                    await checkbox.uncheck();
                }
            }

            await page.locator('[data-remote-resource-type]').selectOption('character');
            await page.locator('[data-remote-resource-query]').fill('Drasna');
            await page.locator('[data-search-remote-resources]').click();

            await expectFrontendRequest(tracker, '/api/remote-resources/search');
            const card = page.locator('.remote-resource-card', { hasText: 'Character Archive Catbox' }).first();
            await expect(card).toBeVisible({ timeout: 120_000 });
            await expect(card).toContainText('Drasna');

            fs.mkdirSync(screenshotDir, { recursive: true });
            await page.screenshot({ path: path.join(screenshotDir, 'character-archive-catbox-character-drasna.png'), fullPage: true });

            const downloadCountBefore = tracker.count('/api/remote-resources/download');
            const importCountBefore = tracker.count('/api/characters/import');
            const recordsCountBefore = tracker.count('/api/remote-resources/records');
            await card.locator('[data-import-remote-resource]').click();

            await expect.poll(() => tracker.count('/api/remote-resources/download'), { timeout: 120_000 }).toBeGreaterThan(downloadCountBefore);
            await expect.poll(() => tracker.count('/api/characters/import'), { timeout: 120_000 }).toBeGreaterThan(importCountBefore);
            await expect.poll(() => tracker.count('/api/remote-resources/records'), { timeout: 120_000 }).toBeGreaterThan(recordsCountBefore);
            await expect(page.locator('.toast', { hasText: '角色已导入' })).toBeVisible({ timeout: 120_000 });

            await page.screenshot({ path: path.join(screenshotDir, 'character-archive-catbox-character-drasna-imported.png'), fullPage: true });

            await expect.poll(async () => {
                const records = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
                return (records || []).some(record => record.providerId === 'character-archive-catbox' && !recordIdsBefore.has(record.id) && record.action === 'import');
            }, { timeout: 120_000 }).toBe(true);
        } finally {
            await cleanupNewRemoteRecords(page, recordIdsBefore, 'character-archive-catbox');
        }
    });

    test('imports a Blobfish23 Neocities character from the modern UI through the real backend', async ({ page }) => {
        test.setTimeout(180_000);

        const tracker = trackApiRequests(page);
        const recordsBefore = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
        const recordIdsBefore = new Set((recordsBefore || []).map(record => record.id).filter(Boolean));
        const screenshotDir = path.resolve('tests/test-results/remote-resources-providers');

        try {
            await gotoModern(page, 'remoteResources', '远程资源');
            await expect(page.locator('[data-remote-provider="blobfish23-neocities"]')).toBeVisible({ timeout: 30_000 });

            const providers = page.locator('[data-remote-provider]');
            const providerCount = await providers.count();
            for (let index = 0; index < providerCount; index++) {
                const checkbox = providers.nth(index);
                const providerId = await checkbox.getAttribute('data-remote-provider');
                const shouldCheck = providerId === 'blobfish23-neocities';
                if (shouldCheck && !(await checkbox.isChecked())) {
                    await checkbox.check();
                } else if (!shouldCheck && await checkbox.isChecked()) {
                    await checkbox.uncheck();
                }
            }

            await page.locator('[data-remote-resource-type]').selectOption('character');
            await page.locator('[data-remote-resource-query]').fill('Alyona');
            await page.locator('[data-search-remote-resources]').click();

            await expectFrontendRequest(tracker, '/api/remote-resources/search');
            const card = page.locator('.remote-resource-card', { hasText: 'Blobfish23 Neocities' }).first();
            await expect(card).toBeVisible({ timeout: 120_000 });
            await expect(card).toContainText('Alyona');

            fs.mkdirSync(screenshotDir, { recursive: true });
            await page.screenshot({ path: path.join(screenshotDir, 'blobfish23-neocities-character-alyona.png'), fullPage: true });

            const downloadCountBefore = tracker.count('/api/remote-resources/download');
            const importCountBefore = tracker.count('/api/characters/import');
            const recordsCountBefore = tracker.count('/api/remote-resources/records');
            await card.locator('[data-import-remote-resource]').click();

            await expect.poll(() => tracker.count('/api/remote-resources/download'), { timeout: 120_000 }).toBeGreaterThan(downloadCountBefore);
            await expect.poll(() => tracker.count('/api/characters/import'), { timeout: 120_000 }).toBeGreaterThan(importCountBefore);
            await expect.poll(() => tracker.count('/api/remote-resources/records'), { timeout: 120_000 }).toBeGreaterThan(recordsCountBefore);
            await expect(page.locator('.toast', { hasText: '角色已导入' })).toBeVisible({ timeout: 120_000 });

            await page.screenshot({ path: path.join(screenshotDir, 'blobfish23-neocities-character-alyona-imported.png'), fullPage: true });

            await expect.poll(async () => {
                const records = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
                return (records || []).some(record => record.providerId === 'blobfish23-neocities' && !recordIdsBefore.has(record.id) && record.action === 'import' && record.localType === 'character');
            }, { timeout: 120_000 }).toBe(true);
        } finally {
            await cleanupNewRemoteRecords(page, recordIdsBefore, 'blobfish23-neocities');
        }
    });

    test('imports a Blobfish23 Neocities worldbook from the modern UI through the real backend', async ({ page }) => {
        test.setTimeout(180_000);

        const tracker = trackApiRequests(page);
        const recordsBefore = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
        const recordIdsBefore = new Set((recordsBefore || []).map(record => record.id).filter(Boolean));
        const screenshotDir = path.resolve('tests/test-results/remote-resources-providers');

        try {
            await gotoModern(page, 'remoteResources', '远程资源');
            await expect(page.locator('[data-remote-provider="blobfish23-neocities"]')).toBeVisible({ timeout: 30_000 });

            const providers = page.locator('[data-remote-provider]');
            const providerCount = await providers.count();
            for (let index = 0; index < providerCount; index++) {
                const checkbox = providers.nth(index);
                const providerId = await checkbox.getAttribute('data-remote-provider');
                const shouldCheck = providerId === 'blobfish23-neocities';
                if (shouldCheck && !(await checkbox.isChecked())) {
                    await checkbox.check();
                } else if (!shouldCheck && await checkbox.isChecked()) {
                    await checkbox.uncheck();
                }
            }

            await page.locator('[data-remote-resource-type]').selectOption('worldbook');
            await page.locator('[data-remote-resource-query]').fill('Tarkov');
            await page.locator('[data-search-remote-resources]').click();

            await expectFrontendRequest(tracker, '/api/remote-resources/search');
            const card = page.locator('.remote-resource-card', { hasText: 'Blobfish23 Neocities' }).first();
            await expect(card).toBeVisible({ timeout: 120_000 });
            await expect(card).toContainText('Escape from Tarkov');

            fs.mkdirSync(screenshotDir, { recursive: true });
            await page.screenshot({ path: path.join(screenshotDir, 'blobfish23-neocities-worldbook-tarkov.png'), fullPage: true });

            const downloadCountBefore = tracker.count('/api/remote-resources/download');
            const importCountBefore = tracker.count('/api/worldinfo/import');
            const recordsCountBefore = tracker.count('/api/remote-resources/records');
            await card.locator('[data-import-remote-resource]').click();

            await expect.poll(() => tracker.count('/api/remote-resources/download'), { timeout: 120_000 }).toBeGreaterThan(downloadCountBefore);
            await expect.poll(() => tracker.count('/api/worldinfo/import'), { timeout: 120_000 }).toBeGreaterThan(importCountBefore);
            await expect.poll(() => tracker.count('/api/remote-resources/records'), { timeout: 120_000 }).toBeGreaterThan(recordsCountBefore);
            await expect(page.locator('.toast', { hasText: '世界书已导入' })).toBeVisible({ timeout: 120_000 });

            await page.screenshot({ path: path.join(screenshotDir, 'blobfish23-neocities-worldbook-tarkov-imported.png'), fullPage: true });

            await expect.poll(async () => {
                const records = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
                return (records || []).some(record => record.providerId === 'blobfish23-neocities' && !recordIdsBefore.has(record.id) && record.action === 'import' && record.localType === 'worldbook');
            }, { timeout: 120_000 }).toBe(true);
        } finally {
            await cleanupNewRemoteRecords(page, recordIdsBefore, 'blobfish23-neocities');
        }
    });

    test('downloads an Akiri Neocities preset from the modern UI through the real backend', async ({ page }) => {
        test.setTimeout(180_000);

        const tracker = trackApiRequests(page);
        const recordsBefore = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
        const recordIdsBefore = new Set((recordsBefore || []).map(record => record.id).filter(Boolean));
        const screenshotDir = path.resolve('tests/test-results/remote-resources-providers');

        try {
            await gotoModern(page, 'remoteResources', '远程资源');
            await expect(page.locator('[data-remote-provider="neocities-creators"]')).toBeVisible({ timeout: 30_000 });

            const providers = page.locator('[data-remote-provider]');
            const providerCount = await providers.count();
            for (let index = 0; index < providerCount; index++) {
                const checkbox = providers.nth(index);
                const providerId = await checkbox.getAttribute('data-remote-provider');
                const shouldCheck = providerId === 'neocities-creators';
                if (shouldCheck && !(await checkbox.isChecked())) {
                    await checkbox.check();
                } else if (!shouldCheck && await checkbox.isChecked()) {
                    await checkbox.uncheck();
                }
            }

            await page.locator('[data-remote-resource-type]').selectOption('preset');
            await page.locator('[data-remote-resource-query]').fill('Erato');
            await page.locator('[data-search-remote-resources]').click();

            await expectFrontendRequest(tracker, '/api/remote-resources/search');
            const card = page.locator('.remote-resource-card', { hasText: 'Akiri' }).first();
            await expect(card).toBeVisible({ timeout: 120_000 });
            await expect(card).toContainText('kunaris emerald preset for erato');
            await expect(card).toContainText('预设');
            await expect(card.locator('[data-download-remote-resource]')).toHaveCount(0);

            fs.mkdirSync(screenshotDir, { recursive: true });
            await page.screenshot({ path: path.join(screenshotDir, 'neocities-creators-akiri-erato.png'), fullPage: true });

            const downloadCountBefore = tracker.count('/api/remote-resources/download');
            const recordsCountBefore = tracker.count('/api/remote-resources/records');
            await card.locator('[data-import-remote-resource]').click();

            await expect.poll(() => tracker.count('/api/remote-resources/download'), { timeout: 120_000 }).toBeGreaterThan(downloadCountBefore);
            await expect.poll(() => tracker.count('/api/remote-resources/records'), { timeout: 120_000 }).toBeGreaterThan(recordsCountBefore);
            await expect(page.locator('.toast', { hasText: '下载已开始' })).toBeVisible({ timeout: 120_000 });

            await page.screenshot({ path: path.join(screenshotDir, 'neocities-creators-akiri-erato-downloaded.png'), fullPage: true });

            await expect.poll(async () => {
                const records = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
                return (records || []).some(record => (
                    record.providerId === 'neocities-creators'
                    && !recordIdsBefore.has(record.id)
                    && record.action === 'download'
                    && record.resourceType === 'preset'
                    && record.localId === 'kunaris_emerald_preset_for_erato.json'
                ));
            }, { timeout: 120_000 }).toBe(true);
        } finally {
            await cleanupNewRemoteRecords(page, recordIdsBefore, 'neocities-creators');
        }
    });

    test('imports a Luminarium Neocities character from the modern UI through the real backend', async ({ page }) => {
        test.setTimeout(180_000);

        const tracker = trackApiRequests(page);
        const recordsBefore = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
        const recordIdsBefore = new Set((recordsBefore || []).map(record => record.id).filter(Boolean));
        const screenshotDir = path.resolve('tests/test-results/remote-resources-providers');

        try {
            await searchOnlyRemoteProvider(page, tracker, 'neocities-creators', 'character', 'Rania');

            const card = page.locator('.remote-resource-card', { hasText: 'Rania' }).first();
            await expect(card).toBeVisible({ timeout: 120_000 });
            await expect(card).toContainText('The Luminarium Cards');
            await expect(card).toContainText('角色卡');

            fs.mkdirSync(screenshotDir, { recursive: true });
            await page.screenshot({ path: path.join(screenshotDir, 'neocities-creators-luminarium-character-rania.png'), fullPage: true });

            const downloadCountBefore = tracker.count('/api/remote-resources/download');
            const importCountBefore = tracker.count('/api/characters/import');
            const recordsCountBefore = tracker.count('/api/remote-resources/records');
            await card.locator('[data-import-remote-resource]').click();

            await expect.poll(() => tracker.count('/api/remote-resources/download'), { timeout: 120_000 }).toBeGreaterThan(downloadCountBefore);
            await expect.poll(() => tracker.count('/api/characters/import'), { timeout: 120_000 }).toBeGreaterThan(importCountBefore);
            await expect.poll(() => tracker.count('/api/remote-resources/records'), { timeout: 120_000 }).toBeGreaterThan(recordsCountBefore);
            await expect(page.locator('.toast', { hasText: '角色已导入' })).toBeVisible({ timeout: 120_000 });

            await page.screenshot({ path: path.join(screenshotDir, 'neocities-creators-luminarium-character-rania-imported.png'), fullPage: true });

            await expect.poll(async () => {
                const records = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
                return (records || []).some(record => record.providerId === 'neocities-creators' && !recordIdsBefore.has(record.id) && record.action === 'import' && record.localType === 'character');
            }, { timeout: 120_000 }).toBe(true);
        } finally {
            await cleanupNewRemoteRecords(page, recordIdsBefore, 'neocities-creators');
        }
    });

    test('imports a Luminarium Neocities worldbook from the modern UI through the real backend', async ({ page }) => {
        test.setTimeout(180_000);

        const tracker = trackApiRequests(page);
        const recordsBefore = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
        const recordIdsBefore = new Set((recordsBefore || []).map(record => record.id).filter(Boolean));
        const screenshotDir = path.resolve('tests/test-results/remote-resources-providers');

        try {
            await searchOnlyRemoteProvider(page, tracker, 'neocities-creators', 'worldbook', 'Comet');

            const card = page.locator('.remote-resource-card', { hasText: 'CometTL' }).first();
            await expect(card).toBeVisible({ timeout: 120_000 });
            await expect(card).toContainText('The Luminarium Lorebooks');
            await expect(card).toContainText('世界书');

            fs.mkdirSync(screenshotDir, { recursive: true });
            await page.screenshot({ path: path.join(screenshotDir, 'neocities-creators-luminarium-worldbook-comet.png'), fullPage: true });

            const downloadCountBefore = tracker.count('/api/remote-resources/download');
            const importCountBefore = tracker.count('/api/worldinfo/import');
            const recordsCountBefore = tracker.count('/api/remote-resources/records');
            await card.locator('[data-import-remote-resource]').click();

            await expect.poll(() => tracker.count('/api/remote-resources/download'), { timeout: 120_000 }).toBeGreaterThan(downloadCountBefore);
            await expect.poll(() => tracker.count('/api/worldinfo/import'), { timeout: 120_000 }).toBeGreaterThan(importCountBefore);
            await expect.poll(() => tracker.count('/api/remote-resources/records'), { timeout: 120_000 }).toBeGreaterThan(recordsCountBefore);
            await expect(page.locator('.toast', { hasText: '世界书已导入' })).toBeVisible({ timeout: 120_000 });

            await page.screenshot({ path: path.join(screenshotDir, 'neocities-creators-luminarium-worldbook-comet-imported.png'), fullPage: true });

            await expect.poll(async () => {
                const records = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
                return (records || []).some(record => record.providerId === 'neocities-creators' && !recordIdsBefore.has(record.id) && record.action === 'import' && record.localType === 'worldbook');
            }, { timeout: 120_000 }).toBe(true);
        } finally {
            await cleanupNewRemoteRecords(page, recordIdsBefore, 'neocities-creators');
        }
    });

    test('downloads the Kintsugi Neocities preset from the modern UI through the real backend', async ({ page }) => {
        test.setTimeout(180_000);

        const tracker = trackApiRequests(page);
        const recordsBefore = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
        const recordIdsBefore = new Set((recordsBefore || []).map(record => record.id).filter(Boolean));
        const screenshotDir = path.resolve('tests/test-results/remote-resources-providers');

        try {
            await searchOnlyRemoteProvider(page, tracker, 'neocities-creators', 'preset', 'Kintsugi');

            const card = page.locator('.remote-resource-card', { hasText: 'kintsugi v4 5' }).first();
            await expect(card).toBeVisible({ timeout: 120_000 });
            await expect(card).toContainText('The Kintsugi Preset');
            await expect(card).toContainText('预设');
            await expect(card.locator('[data-download-remote-resource]')).toHaveCount(0);

            fs.mkdirSync(screenshotDir, { recursive: true });
            await page.screenshot({ path: path.join(screenshotDir, 'neocities-creators-kintsugi-preset.png'), fullPage: true });

            const downloadCountBefore = tracker.count('/api/remote-resources/download');
            const recordsCountBefore = tracker.count('/api/remote-resources/records');
            await card.locator('[data-import-remote-resource]').click();

            await expect.poll(() => tracker.count('/api/remote-resources/download'), { timeout: 120_000 }).toBeGreaterThan(downloadCountBefore);
            await expect.poll(() => tracker.count('/api/remote-resources/records'), { timeout: 120_000 }).toBeGreaterThan(recordsCountBefore);
            await expect(page.locator('.toast', { hasText: '下载已开始' })).toBeVisible({ timeout: 120_000 });

            await page.screenshot({ path: path.join(screenshotDir, 'neocities-creators-kintsugi-preset-downloaded.png'), fullPage: true });

            await expect.poll(async () => {
                const records = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
                return (records || []).some(record => (
                    record.providerId === 'neocities-creators'
                    && !recordIdsBefore.has(record.id)
                    && record.action === 'download'
                    && record.resourceType === 'preset'
                    && record.localId === 'kintsugi-v4-5.json'
                ));
            }, { timeout: 120_000 }).toBe(true);
        } finally {
            await cleanupNewRemoteRecords(page, recordIdsBefore, 'neocities-creators');
        }
    });

    test('downloads a Momoura Neocities preset from the modern UI through the real backend', async ({ page }) => {
        test.setTimeout(180_000);

        const tracker = trackApiRequests(page);
        const recordsBefore = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
        const recordIdsBefore = new Set((recordsBefore || []).map(record => record.id).filter(Boolean));
        const screenshotDir = path.resolve('tests/test-results/remote-resources-providers');

        try {
            await searchOnlyRemoteProvider(page, tracker, 'neocities-creators', 'preset', 'neoVORPUS');

            const card = page.locator('.remote-resource-card', { hasText: 'neoVORPUS' }).first();
            await expect(card).toBeVisible({ timeout: 120_000 });
            await expect(card).toContainText('Momoura Presets');
            await expect(card).toContainText('预设');
            await expect(card.locator('[data-download-remote-resource]')).toHaveCount(0);

            fs.mkdirSync(screenshotDir, { recursive: true });
            await page.screenshot({ path: path.join(screenshotDir, 'neocities-creators-momoura-preset-neovor.png'), fullPage: true });

            const downloadCountBefore = tracker.count('/api/remote-resources/download');
            const recordsCountBefore = tracker.count('/api/remote-resources/records');
            await card.locator('[data-import-remote-resource]').click();

            await expect.poll(() => tracker.count('/api/remote-resources/download'), { timeout: 120_000 }).toBeGreaterThan(downloadCountBefore);
            await expect.poll(() => tracker.count('/api/remote-resources/records'), { timeout: 120_000 }).toBeGreaterThan(recordsCountBefore);
            await expect(page.locator('.toast', { hasText: '下载已开始' })).toBeVisible({ timeout: 120_000 });

            await page.screenshot({ path: path.join(screenshotDir, 'neocities-creators-momoura-preset-neovor-downloaded.png'), fullPage: true });

            await expect.poll(async () => {
                const records = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
                return (records || []).some(record => (
                    record.providerId === 'neocities-creators'
                    && !recordIdsBefore.has(record.id)
                    && record.action === 'download'
                    && record.resourceType === 'preset'
                    && record.localId === 'neoVORPUS.json'
                ));
            }, { timeout: 120_000 }).toBe(true);
        } finally {
            await cleanupNewRemoteRecords(page, recordIdsBefore, 'neocities-creators');
        }
    });

    test('imports a Momoura Neocities worldbook from the modern UI through the real backend', async ({ page }) => {
        test.setTimeout(180_000);

        const tracker = trackApiRequests(page);
        const recordsBefore = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
        const recordIdsBefore = new Set((recordsBefore || []).map(record => record.id).filter(Boolean));
        const screenshotDir = path.resolve('tests/test-results/remote-resources-providers');

        try {
            await searchOnlyRemoteProvider(page, tracker, 'neocities-creators', 'worldbook', 'Japari');

            const card = page.locator('.remote-resource-card', { hasText: 'japari library' }).first();
            await expect(card).toBeVisible({ timeout: 120_000 });
            await expect(card).toContainText('Momoura Lorebooks');
            await expect(card).toContainText('世界书');

            fs.mkdirSync(screenshotDir, { recursive: true });
            await page.screenshot({ path: path.join(screenshotDir, 'neocities-creators-momoura-worldbook-japari.png'), fullPage: true });

            const downloadCountBefore = tracker.count('/api/remote-resources/download');
            const importCountBefore = tracker.count('/api/worldinfo/import');
            const recordsCountBefore = tracker.count('/api/remote-resources/records');
            await card.locator('[data-import-remote-resource]').click();

            await expect.poll(() => tracker.count('/api/remote-resources/download'), { timeout: 120_000 }).toBeGreaterThan(downloadCountBefore);
            await expect.poll(() => tracker.count('/api/worldinfo/import'), { timeout: 120_000 }).toBeGreaterThan(importCountBefore);
            await expect.poll(() => tracker.count('/api/remote-resources/records'), { timeout: 120_000 }).toBeGreaterThan(recordsCountBefore);
            await expect(page.locator('.toast', { hasText: '世界书已导入' })).toBeVisible({ timeout: 120_000 });

            await page.screenshot({ path: path.join(screenshotDir, 'neocities-creators-momoura-worldbook-japari-imported.png'), fullPage: true });

            await expect.poll(async () => {
                const records = await apiFetch(page, '/api/remote-resources/records', undefined, 'GET');
                return (records || []).some(record => record.providerId === 'neocities-creators' && !recordIdsBefore.has(record.id) && record.action === 'import' && record.localType === 'worldbook');
            }, { timeout: 120_000 }).toBe(true);
        } finally {
            await cleanupNewRemoteRecords(page, recordIdsBefore, 'neocities-creators');
        }
    });

    test('installs, updates, and deletes a public git extension from the modern UI through the real backend', async ({ page }) => {
        test.skip(!externalExtensionName, 'MODERN_EXTERNAL_EXTENSION_URL must resolve to a repository folder name.');

        const localExtensionPath = path.join(localExtensionsDir, externalExtensionName);
        const globalExtensionPath = path.join(globalExtensionsDir, externalExtensionName);
        test.skip(
            fs.existsSync(localExtensionPath) || fs.existsSync(globalExtensionPath),
            `External extension path already exists: ${externalExtensionName}`,
        );

        const tracker = trackApiRequests(page);
        let installed = false;

        try {
            await gotoModern(page, 'extensions', '扩展');
            await page.locator('[data-toggle-extension-install]').click();
            await page.locator('[data-extension-install-url]').fill(externalExtensionUrl);
            await page.locator('[data-extension-install-branch]').fill(externalExtensionBranch);
            await page.locator('[data-install-extension]').click();

            await expectFrontendRequest(tracker, '/api/extensions/install');
            await expect.poll(() => fs.existsSync(path.join(localExtensionPath, 'manifest.json')), { timeout: 180_000 }).toBe(true);
            installed = true;

            await page.locator('[data-extension-view="local"]').click();
            const card = page.locator(`[data-extension-card="local:${externalExtensionName}"]`);
            await expect(card).toContainText(`third-party/${externalExtensionName}`, { timeout: 30_000 });

            await page.locator(`[data-extension-details="${externalExtensionName}"][data-extension-type="local"]`).click();
            await expectFrontendRequest(tracker, '/api/extensions/version');
            await expect(card.locator('.extension-detail-panel')).toContainText('github.com', { timeout: 120_000 });

            const updateCountBefore = tracker.count('/api/extensions/update');
            await page.locator(`[data-extension-action="update"][data-extension-name="${externalExtensionName}"][data-extension-type="local"]`).click();
            await page.locator('[data-confirm-extension-operation]').click();
            await expect.poll(() => tracker.count('/api/extensions/update'), { timeout: 180_000 }).toBeGreaterThan(updateCountBefore);
            await expect(page.locator('.toast', { hasText: /扩展已(是最新|更新)/u })).toBeVisible({ timeout: 180_000 });
            await expect(page.locator('[data-confirm-extension-operation]')).toHaveCount(0, { timeout: 180_000 });
            await expect(card).toBeVisible();

            const deleteCountBefore = tracker.count('/api/extensions/delete');
            await page.locator(`[data-extension-action="delete"][data-extension-name="${externalExtensionName}"][data-extension-type="local"]`).click();
            await page.locator('[data-confirm-extension-operation]').click();
            await expect.poll(() => tracker.count('/api/extensions/delete')).toBeGreaterThan(deleteCountBefore);
            await expect(page.locator(`[data-extension-card="local:${externalExtensionName}"]`)).toHaveCount(0);
            await expect.poll(() => fs.existsSync(localExtensionPath)).toBe(false);
            installed = false;
        } finally {
            if (installed || fs.existsSync(localExtensionPath)) {
                await safeApiFetch(page, '/api/extensions/delete', { extensionName: externalExtensionName, global: false });
                fs.rmSync(localExtensionPath, { recursive: true, force: true });
            }
        }
    });

    test('tests a real OpenRouter chat completion provider from the modern UI through the real backend', async ({ page }) => {
        test.skip(!openRouterApiKey || !openRouterModel, 'Set MODERN_EXTERNAL_OPENROUTER_API_KEY and MODERN_EXTERNAL_OPENROUTER_MODEL to run the real provider smoke test.');

        const tracker = trackApiRequests(page);
        const settingsBefore = await getSettings(page);
        const secretStateBefore = await getSecretState(page);
        const openRouterSecretIdsBefore = getSecretIds(secretStateBefore, 'api_key_openrouter');
        const openRouterActiveSecretIdBefore = getActiveSecretId(secretStateBefore, 'api_key_openrouter');

        try {
            await gotoModern(page, 'api', 'API 连接管理');
            await page.locator('[data-api-main]').selectOption('openai');
            await page.locator('[data-api-source]').selectOption('openrouter');
            await page.locator('[data-api-model]').fill(openRouterModel);
            await page.locator('[data-api-temperature]').fill('0');
            await page.locator('[data-api-max-tokens]').fill('8');
            await page.locator('[data-api-key]').fill(openRouterApiKey);
            await page.locator('[data-save-api-connection]').click();

            await expectFrontendRequest(tracker, '/api/secrets/write');
            await expectFrontendRequest(tracker, '/api/settings/save');
            await expect(page.locator('[data-api-secret-status]')).toContainText('密钥已保存');

            await page.locator('[data-test-api]').click();
            await expectFrontendRequest(tracker, '/api/backends/chat-completions/generate');
            await expect(page.locator('.api-history-panel')).toContainText(openRouterModel, { timeout: 180_000 });
            await expect(page.locator('.api-history-panel')).toContainText('可用', { timeout: 180_000 });
            expect(tracker.lastJson('/api/backends/chat-completions/generate')).toMatchObject({
                chat_completion_source: 'openrouter',
                model: openRouterModel,
                max_tokens: 8,
                stream: false,
            });
        } finally {
            await restoreSettings(page, settingsBefore);
            await deleteNewSecrets(page, 'api_key_openrouter', openRouterSecretIdsBefore);
            if (openRouterActiveSecretIdBefore) {
                await safeApiFetch(page, '/api/secrets/rotate', { key: 'api_key_openrouter', id: openRouterActiveSecretIdBefore });
            }
        }
    });
});
