import { test, expect } from '@playwright/test';
import { createModernResourceFixture, gotoModern, mockModernWorkspace } from './modern-test-utils.js';

function fulfillJson(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

function createNavFixture() {
    const fixture = createModernResourceFixture({
        backgrounds: {
            images: [
                { filename: 'forest.png', isAnimated: false },
                { filename: 'city.webp', isAnimated: true },
                { filename: 'beach.jpg', isAnimated: false },
            ],
        },
        assets: {
            bgm: ['assets/bgm/theme.mp3'],
        },
        extensions: [
            { name: 'assets', type: 'system' },
        ],
    });
    fixture.remoteResourceRecords = [
        { id: 'record-1', providerId: 'chub', remoteId: 'one', localType: 'character' },
        { id: 'record-2', providerId: 'chub', remoteId: 'two', localType: 'worldbook' },
    ];
    return fixture;
}

function navButton(page, routeId) {
    return page.locator(`.nav-button[data-route="${routeId}"]`);
}

test.describe('Modern navigation badges', () => {
    test('shows a pending marker until the counts are read, then labelled counts', async ({ page }) => {
        const fixture = createNavFixture();
        await mockModernWorkspace(page, fixture);
        let releaseCharacters;
        const charactersGate = new Promise(resolve => {
            releaseCharacters = resolve;
        });
        await page.route('**/api/characters/all', async route => {
            await charactersGate;
            return fulfillJson(route, fixture.characters);
        });

        await page.goto('/modern/?view=dashboard');

        await expect(navButton(page, 'characters').locator('.nav-count')).toHaveText('…');
        await expect(navButton(page, 'remoteResources').locator('.nav-count')).toHaveText('…');
        await expect(page.locator('.nav-count', { hasText: /^0$/ })).toHaveCount(0);

        releaseCharacters();
        await expect(page.locator('#modernApp')).toHaveAttribute('data-loaded', 'true');

        await expect(navButton(page, 'characters').locator('.nav-count')).toHaveText('2');
        await expect(navButton(page, 'characters').locator('.nav-count')).toHaveAttribute('title', '2 张角色卡');
        await expect(navButton(page, 'groups').locator('.nav-count')).toHaveAttribute('title', '2 个群组');
        // Backgrounds and asset files are both managed on the assets route
        await expect(navButton(page, 'assets').locator('.nav-count')).toHaveText('4');
        await expect(navButton(page, 'assets').locator('.nav-count')).toHaveAttribute('title', '3 张背景 · 1 个资产文件');
        // Import records are read with the startup data, before the remote resources route is visited
        await expect(navButton(page, 'remoteResources').locator('.nav-count')).toHaveText('2');
        await expect(navButton(page, 'remoteResources').locator('.nav-count')).toHaveAttribute('title', '2 条导入记录');
        await expect(navButton(page, 'extensions').locator('.nav-count')).toHaveAttribute('title', '1 个扩展');
        // The chat entry only flags unread messages; it no longer repeats the character count
        await expect(navButton(page, 'chat').locator('.nav-count')).toHaveCount(0);
        await expect(navButton(page, 'chat').locator('.nav-unread-badge')).toHaveCount(0);
        await expect(page.locator('.nav-count[data-nav-count-pending]')).toHaveCount(0);
    });

    test('leaves out a count whose data failed to load instead of showing 0', async ({ page }) => {
        const fixture = createNavFixture();
        await mockModernWorkspace(page, fixture);
        await page.route('**/api/remote-resources/records', route => fulfillJson(route, { error: 'records unreadable' }, 500));
        await page.route('**/api/extensions/discover', route => fulfillJson(route, { error: 'extensions unreadable' }, 500));
        await page.route('**/api/settings/get-snapshots', route => fulfillJson(route, []));

        await gotoModern(page, 'settings', '设置中心');

        await expect(navButton(page, 'characters').locator('.nav-count')).toHaveText('2');
        await expect(navButton(page, 'remoteResources').locator('.nav-count')).toHaveCount(0);
        await expect(navButton(page, 'extensions').locator('.nav-count')).toHaveCount(0);
        // A badge-only read failure is not reported as a workspace data error; the extensions failure is
        // (the settings center lists read errors on its 系统信息 tab)
        await page.locator('.settings-tabs [data-settings-section="system"]').click();
        const readErrors = page.locator('.settings-tab-body .section-panel', { hasText: '读取错误' }).locator('.resource-row');
        await expect(readErrors).toHaveCount(1);
        await expect(readErrors.locator('.row-title')).toHaveText('extensions');
    });

    test('updates the remote resources count once the route loads its records', async ({ page }) => {
        const fixture = createNavFixture();
        await mockModernWorkspace(page, fixture);
        await page.route('**/api/remote-resources/providers', route => fulfillJson(route, []));
        let recordReads = 0;
        await page.route('**/api/remote-resources/records', route => {
            recordReads += 1;
            // The startup read fails; the route's own read succeeds
            return recordReads === 1
                ? fulfillJson(route, { error: 'records unreadable' }, 500)
                : fulfillJson(route, fixture.remoteResourceRecords);
        });

        await gotoModern(page, 'dashboard', '工作台');
        await expect(navButton(page, 'remoteResources').locator('.nav-count')).toHaveCount(0);

        await navButton(page, 'remoteResources').click();

        await expect(navButton(page, 'remoteResources').locator('.nav-count')).toHaveText('2');
    });
});
