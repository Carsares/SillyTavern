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

async function deleteNewSecrets(page, key, beforeIds) {
    const secretState = await safeApiFetch(page, '/api/secrets/read');
    for (const secret of secretState?.[key] || []) {
        if (!beforeIds.has(secret.id)) {
            await safeApiFetch(page, '/api/secrets/delete', { key, id: secret.id });
        }
    }
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
        }
    });
});
