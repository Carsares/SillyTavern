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

test.describe('Modern settings page', () => {
    test('loads settings snapshots when the snapshots section is opened directly', async ({ page }) => {
        const fixture = await mockModernSettingsWorkspace(page);
        const requests = fixture.requests.settingsSnapshots;

        await page.addInitScript(() => {
            globalThis.localStorage.setItem('st-modern-settings-section', 'snapshots');
        });
        await gotoModern(page, 'settings', '设置中心');

        await expect.poll(() => requests.lists.length).toBe(1);
        await expect(page.locator('.metric-card', { hasText: '设置快照' })).toContainText('1');
        await expect(page.locator('.backup-row', { hasText: 'settings-older.json' })).toBeVisible();
        await expect(page.locator('.backup-list')).not.toContainText('暂无设置快照');
    });

    test('creates, previews, and restores settings snapshots', async ({ page }) => {
        const fixture = await mockModernSettingsWorkspace(page);
        const requests = fixture.requests.settingsSnapshots;

        await gotoModern(page, 'settings', '设置中心');
        // The metrics row reads the snapshot count on route entry; the button reads the list again
        await expect.poll(() => requests.lists.length).toBe(1);

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

        await page.locator('[data-settings-section="preferences"]').click();
        await expect(page.locator('[data-request-compression-enabled]')).not.toBeChecked();
        await expect(page.locator('[data-request-compression-enabled]')).toBeDisabled();
        await expect(page.locator('[data-request-compression-min]')).toHaveValue('128');
        await expect(page.locator('[data-request-compression-min]')).toBeDisabled();
        await expect(page.locator('[data-request-compression-max]')).toHaveValue('1024');
        await expect(page.locator('[data-request-compression-max]')).toBeDisabled();
    });

    test('shows the snapshot count on route entry without opening the snapshots section', async ({ page }) => {
        const fixture = await mockModernSettingsWorkspace(page);
        const requests = fixture.requests.settingsSnapshots;
        await page.addInitScript(() => {
            globalThis.localStorage.setItem('st-modern-settings-section', 'preferences');
        });

        await gotoModern(page, 'settings', '设置中心');

        const metric = page.locator('.metric-card', { hasText: '设置快照' });
        await expect(metric).toContainText('1');
        await expect(metric).toContainText('本地备份');
        await expect(metric).not.toContainText('—');
        await expect(metric).not.toContainText('尚未读取');
        expect(requests.lists).toHaveLength(1);
        await expect(page.locator('[data-settings-section="preferences"]')).toHaveAttribute('aria-selected', 'true');
    });

    test('reports a failed snapshot count read once instead of an em dash', async ({ page }) => {
        const fixture = await mockModernSettingsWorkspace(page);
        const requests = fixture.requests.settingsSnapshots;
        await page.route('**/api/settings/get-snapshots', route => {
            requests.lists.push({ at: Date.now() });
            return fulfillJson(route, { error: 'snapshot directory unreadable' }, 500);
        });

        await gotoModern(page, 'settings', '设置中心');

        const metric = page.locator('.metric-card', { hasText: '设置快照' });
        await expect(metric).toContainText('未读取');
        await expect(metric).toContainText('读取失败');
        await expect(metric).not.toContainText('—');

        // Re-rendering the route does not retry the failed automatic read
        await page.locator('[data-settings-section="status"]').click();
        await expect(page.locator('[data-settings-section="status"]')).toHaveAttribute('aria-selected', 'true');
        expect(requests.lists).toHaveLength(1);
    });

    test('keeps summaries off the preferences tab and shows request compression as read-only config', async ({ page }) => {
        await mockModernSettingsWorkspace(page);
        await page.addInitScript(() => {
            globalThis.localStorage.setItem('st-modern-settings-section', 'preferences');
            globalThis.localStorage.setItem('st-modern-theme', 'light');
        });

        await gotoModern(page, 'settings', '设置中心');

        await expect(page.locator('.form-section-title', { hasText: '现代界面偏好' })).toBeVisible();
        await expect(page.locator('.resource-card .card-title', { hasText: '现代界面' })).toHaveCount(0);
        await expect(page.locator('.resource-card .card-title', { hasText: '请求压缩' })).toHaveCount(0);

        const compression = page.locator('[data-request-compression-readonly]');
        await expect(compression.locator('.form-section-title')).toContainText('只读');
        await expect(compression).toContainText('config.yaml');
        await expect(compression).toContainText('最小载荷（字节）');
        await expect(compression).not.toContainText('Byte');
        await expect(compression.locator('[data-request-compression-min]')).toBeDisabled();
        await expect(compression.locator('[data-request-compression-max]')).toBeDisabled();
        await expect(compression.locator('[data-request-compression-enabled]')).toBeDisabled();

        await page.locator('[data-settings-section="status"]').click();

        const modernCard = page.locator('.resource-card', { has: page.locator('.card-title', { hasText: '现代界面' }) });
        await expect(modernCard).toHaveCount(1);
        await expect(modernCard).toContainText('浅色');
        await expect(page.locator('.resource-card .card-title', { hasText: '请求压缩' })).toHaveCount(1);
    });

    test('filters settings snapshots by local query', async ({ page }) => {
        const fixture = await mockModernSettingsWorkspace(page);
        fixture.snapshots.push({ name: 'settings-recent.json', date: 1720000000000, size: 1024 });

        await gotoModern(page, 'settings', '设置中心');
        await page.locator('[data-load-settings-snapshots]').click();

        await expect(page.locator('.backup-row')).toHaveCount(2);
        await expect(page.locator('.list-toolbar .badge')).toHaveText('显示 2 / 2');

        await page.locator('[data-settings-snapshot-search]').fill('older');

        await expect(page.locator('.backup-row')).toHaveCount(1);
        await expect(page.locator('.backup-row', { hasText: 'settings-older.json' })).toBeVisible();
        await expect(page.locator('.backup-row', { hasText: 'settings-recent.json' })).toHaveCount(0);
        await expect(page.locator('.list-toolbar .badge')).toHaveText('显示 1 / 2');

        await page.locator('[data-settings-snapshot-search]').fill('missing');

        await expect(page.locator('.backup-row')).toHaveCount(0);
        await expect(page.locator('.backup-list')).toContainText('没有匹配的设置快照');
    });
});
