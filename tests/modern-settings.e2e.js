/* global globalThis */
import { test, expect } from '@playwright/test';
import { createModernResourceFixture, gotoModern, mockModernWorkspace } from './modern-test-utils.js';

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function fulfillJson(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

function createSettingsFixture() {
    const fixture = createModernResourceFixture({
        settings: {
            request_compression: {
                enabled: false,
                minPayloadSize: 128,
                maxPayloadSize: 1024,
            },
        },
        settingsBundle: {
            enable_extensions: true,
            enable_accounts: true,
            enable_extensions_auto_update: false,
            request_compression: {
                enabled: false,
                minPayloadSize: 128,
                maxPayloadSize: 1024,
            },
        },
        extensions: [
            { name: 'assets', type: 'system' },
            { name: 'third-party/local-ext', type: 'local' },
        ],
        secrets: { allowKeysExposure: false },
        secretState: {
            api_key_openai: [{ id: 'saved', value: '********', active: true }],
        },
    });

    fixture.snapshots = [
        { name: 'settings-older.json', date: 1710000000000, size: 256 },
    ];
    fixture.snapshotText = {
        'settings-older.json': JSON.stringify({
            request_compression: {
                enabled: true,
                minPayloadSize: 2048,
                maxPayloadSize: 8192,
            },
            restored: true,
        }, null, 2),
    };
    fixture.requests.settingsSnapshots = {
        lists: [],
        creates: [],
        previews: [],
        restores: [],
    };

    return fixture;
}

async function mockModernSettingsWorkspace(page) {
    const fixture = createSettingsFixture();
    const requests = fixture.requests.settingsSnapshots;
    await mockModernWorkspace(page, fixture);

    await page.route('**/api/settings/get-snapshots', route => {
        requests.lists.push({ at: Date.now() });
        return fulfillJson(route, fixture.snapshots);
    });

    await page.route('**/api/settings/make-snapshot', route => {
        requests.creates.push({ at: Date.now() });
        const snapshot = { name: 'settings-created.json', date: 1720000000000, size: 512 };
        fixture.snapshots.push(snapshot);
        fixture.snapshotText[snapshot.name] = JSON.stringify(fixture.settings, null, 2);
        return fulfillJson(route, { ok: true });
    });

    await page.route('**/api/settings/load-snapshot', route => {
        const payload = route.request().postDataJSON();
        requests.previews.push(clone(payload));
        return fulfillJson(route, fixture.snapshotText[payload.name] || '{}');
    });

    await page.route('**/api/settings/restore-snapshot', route => {
        const payload = route.request().postDataJSON();
        requests.restores.push(clone(payload));
        fixture.settings = JSON.parse(fixture.snapshotText[payload.name] || '{}');
        return fulfillJson(route, { ok: true });
    });

    return fixture;
}

async function rememberSettingsSection(page, section) {
    await page.addInitScript(value => {
        globalThis.localStorage.setItem('st-modern-settings-section', value);
    }, section);
}

function readonlyCompressionValue(page, key) {
    return page.locator('[data-request-compression-readonly] .kv-row', { hasText: key }).locator('.kv-value');
}

test.describe('Modern settings page', () => {
    test('opens the data tab for the old snapshots tab id and loads the snapshots there', async ({ page }) => {
        const fixture = await mockModernSettingsWorkspace(page);
        const requests = fixture.requests.settingsSnapshots;

        await rememberSettingsSection(page, 'snapshots');
        await gotoModern(page, 'settings', '设置中心');

        await expect(page.locator('[data-settings-section="data"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-settings-panel="data"] [data-settings-snapshots]')).toBeVisible();
        await expect.poll(() => requests.lists.length).toBe(1);
        await expect(page.locator('[data-settings-snapshot-count]')).toHaveText('显示 1 / 1 · 共 256 B');
        await expect(page.locator('.backup-row', { hasText: 'settings-older.json' })).toBeVisible();
        await expect(page.locator('.backup-list')).not.toContainText('暂无设置快照');
    });

    test('creates, previews, and restores settings snapshots', async ({ page }) => {
        const fixture = await mockModernSettingsWorkspace(page);
        const requests = fixture.requests.settingsSnapshots;

        await rememberSettingsSection(page, 'data');
        await gotoModern(page, 'settings', '设置中心');
        // Opening the data tab reads the snapshot list once; the refresh button reads it again
        await expect.poll(() => requests.lists.length).toBe(1);
        await expect(page.locator('.backup-row', { hasText: 'settings-older.json' })).toBeVisible();

        await page.locator('[data-load-settings-snapshots]').click();

        await expect.poll(() => requests.lists.length).toBe(2);
        await expect(page.locator('.backup-row', { hasText: 'settings-older.json' })).toBeVisible();

        await page.locator('[data-create-settings-snapshot]').click();

        await expect.poll(() => requests.creates.length).toBe(1);
        await expect.poll(() => requests.lists.length).toBe(3);
        await expect(page.locator('.backup-row', { hasText: 'settings-created.json' })).toBeVisible();

        await page.locator('[data-preview-settings-snapshot="settings-older.json"]').click();

        await expect.poll(() => requests.previews.length).toBe(1);
        expect(requests.previews[0]).toEqual({ name: 'settings-older.json' });
        await expect(page.locator('.backup-preview textarea')).toContainText('"restored": true');
        await expect(page.locator('.backup-preview textarea')).toContainText('"minPayloadSize": 2048');

        await page.locator('[data-restore-settings-snapshot="settings-older.json"]').click();
        await expect(page.locator('.backup-row', { hasText: 'settings-older.json' }).locator('[data-confirm-settings-restore]')).toBeVisible();
        await page.locator('[data-cancel-settings-restore]').click();
        expect(requests.restores).toHaveLength(0);

        await page.locator('[data-restore-settings-snapshot="settings-older.json"]').click();
        await page.locator('[data-confirm-settings-restore]').click();

        await expect.poll(() => requests.restores.length).toBe(1);
        expect(requests.restores[0]).toEqual({ name: 'settings-older.json' });

        // Request compression is read-only config.yaml data: restoring settings.json does not change what it shows
        await page.locator('[data-settings-section="system"]').click();
        await expect(page.locator('[data-settings-section="system"]')).toHaveAttribute('aria-selected', 'true');
        await expect(readonlyCompressionValue(page, '启用')).toHaveText('否');
        await expect(readonlyCompressionValue(page, '最小载荷')).toHaveText('128 B');
        await expect(readonlyCompressionValue(page, '最大载荷')).toHaveText('1.0 KB');
        await expect(page.locator('[data-request-compression-readonly] input')).toHaveCount(0);
    });

    test('reads the snapshot list only when the data tab opens, and keeps the page head to the save status', async ({ page }) => {
        const fixture = await mockModernSettingsWorkspace(page);
        const requests = fixture.requests.settingsSnapshots;
        await rememberSettingsSection(page, 'preferences');

        await gotoModern(page, 'settings', '设置中心');

        await expect(page.locator('[data-settings-section="preferences"]')).toHaveAttribute('aria-selected', 'true');
        // The page head holds only the autosave status: no metric cards and no snapshot buttons
        await expect(page.locator('.page-head [data-settings-save-status]')).toHaveText('改动会自动保存');
        await expect(page.locator('.metric-card')).toHaveCount(0);
        await expect(page.locator('.page-head [data-create-settings-snapshot]')).toHaveCount(0);
        await expect(page.locator('.page-head [data-load-settings-snapshots]')).toHaveCount(0);
        expect(requests.lists).toHaveLength(0);

        await page.locator('[data-settings-section="data"]').click();

        await expect(page.locator('[data-settings-section="data"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-settings-snapshot-count]')).toHaveText('显示 1 / 1 · 共 256 B');
        await expect(page.locator('[data-settings-snapshots] [data-create-settings-snapshot]')).toBeVisible();
        expect(requests.lists).toHaveLength(1);
        expect(await page.evaluate(() => globalThis.localStorage.getItem('st-modern-settings-section'))).toBe('data');

        // Leaving and reopening the tab shows the loaded list again without another read
        await page.locator('[data-settings-section="system"]').click();
        await expect(page.locator('[data-settings-snapshots]')).toHaveCount(0);
        await page.locator('[data-settings-section="data"]').click();
        await expect(page.locator('.backup-row', { hasText: 'settings-older.json' })).toBeVisible();
        expect(requests.lists).toHaveLength(1);
    });

    test('reports a failed snapshot list read once instead of a reading placeholder', async ({ page }) => {
        const fixture = await mockModernSettingsWorkspace(page);
        const requests = fixture.requests.settingsSnapshots;
        await page.route('**/api/settings/get-snapshots', route => {
            requests.lists.push({ at: Date.now() });
            return fulfillJson(route, { error: 'snapshot directory unreadable' }, 500);
        });
        await rememberSettingsSection(page, 'data');

        await gotoModern(page, 'settings', '设置中心');

        await expect.poll(() => requests.lists.length).toBe(1);
        await expect(page.locator('.toast', { hasText: '设置快照读取失败' })).toBeVisible();

        // Re-rendering the route does not retry the failed automatic read
        await page.locator('[data-settings-section="system"]').click();
        await expect(page.locator('[data-settings-section="system"]')).toHaveAttribute('aria-selected', 'true');
        await page.locator('[data-settings-section="data"]').click();
        await expect(page.locator('[data-settings-snapshots]')).toBeVisible();
        expect(requests.lists).toHaveLength(1);

        // After the failure the snapshot section must not keep saying that it is still reading
        await expect(page.locator('[data-settings-snapshot-count]')).not.toHaveText('读取中');
        await expect(page.locator('.backup-list')).not.toContainText('正在准备读取设置快照');
    });

    test('keeps the preferences tab to browser-local preferences that save on change, and shows request compression read-only on the system tab', async ({ page }) => {
        await mockModernSettingsWorkspace(page);
        await page.addInitScript(() => {
            globalThis.localStorage.setItem('st-modern-settings-section', 'preferences');
            globalThis.localStorage.setItem('st-modern-theme', 'light');
        });

        await gotoModern(page, 'settings', '设置中心');

        const preferences = page.locator('[data-settings-panel="preferences"]');
        await expect(preferences.locator('.panel-title', { hasText: '界面' })).toBeVisible();
        await expect(preferences.locator('[data-modern-theme]')).toHaveValue('light');
        await expect(preferences.locator('.resource-card')).toHaveCount(0);
        await expect(page.locator('[data-request-compression-readonly]')).toHaveCount(0);
        await expect(page.locator('[data-save-modern-preferences]')).toHaveCount(0);

        // A preference saves as soon as it changes; the page head reports it
        await preferences.locator('[data-modern-theme]').selectOption('dark');
        await expect(page.locator('[data-settings-save-status]')).toContainText('主题已保存');
        expect(await page.evaluate(() => globalThis.localStorage.getItem('st-modern-theme'))).toBe('dark');

        await page.locator('[data-settings-section="system"]').click();

        const compression = page.locator('[data-request-compression-readonly]');
        await expect(page.locator('.resource-card .card-title', { hasText: '请求压缩' })).toHaveCount(1);
        await expect(compression.locator('.card-title .badge')).toHaveText('只读');
        await expect(compression).toContainText('config.yaml');
        await expect(readonlyCompressionValue(page, '启用')).toHaveText('否');
        await expect(readonlyCompressionValue(page, '最小载荷')).toHaveText('128 B');
        await expect(readonlyCompressionValue(page, '最大载荷')).toHaveText('1.0 KB');
        await expect(compression).not.toContainText('Byte');
        await expect(compression.locator('input')).toHaveCount(0);
    });

    test('filters settings snapshots by local query', async ({ page }) => {
        const fixture = await mockModernSettingsWorkspace(page);
        fixture.snapshots.push({ name: 'settings-recent.json', date: 1720000000000, size: 1024 });
        await rememberSettingsSection(page, 'data');

        await gotoModern(page, 'settings', '设置中心');

        const count = page.locator('[data-settings-snapshot-count]');
        await expect(page.locator('.backup-row')).toHaveCount(2);
        await expect(count).toHaveText('显示 2 / 2 · 共 1.3 KB');

        // A late re-render can replace the input between Playwright selecting it and typing into it (it also happens on the
        // unmodified baseline, about once in 200 runs under load), which drops the text; typing again is the user's recovery too
        await expect(async () => {
            await page.locator('[data-settings-snapshot-search]').fill('older');
            await expect(page.locator('.backup-row')).toHaveCount(1, { timeout: 1500 });
        }).toPass({ timeout: 15_000 });
        await expect(page.locator('.backup-row', { hasText: 'settings-older.json' })).toBeVisible();
        await expect(page.locator('.backup-row', { hasText: 'settings-recent.json' })).toHaveCount(0);
        await expect(count).toHaveText('显示 1 / 2 · 共 1.3 KB');

        await page.locator('[data-settings-snapshot-search]').fill('missing');

        await expect(page.locator('.backup-row')).toHaveCount(0);
        await expect(page.locator('.backup-list')).toContainText('没有匹配的设置快照');
    });
});
