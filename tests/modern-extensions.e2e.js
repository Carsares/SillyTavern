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

function extensionKey(extensionName, global) {
    return `${global ? 'global' : 'local'}:${extensionName}`;
}

function createExtensionFixture() {
    const fixture = createModernResourceFixture({
        me: { name: 'Modern Admin', handle: 'modern-admin', admin: true },
        extensions: [
            { name: 'assets', type: 'system' },
            { name: 'third-party/local-ext', type: 'local' },
            { name: 'third-party/global-ext', type: 'global' },
        ],
    });

    fixture.extensionVersions = {
        'local:local-ext': {
            currentBranchName: 'main',
            currentCommitHash: 'abc1234567890',
            remoteUrl: 'https://github.com/example/local-ext.git',
            isUpToDate: false,
        },
        'global:global-ext': {
            currentBranchName: 'stable',
            currentCommitHash: 'def4567890123',
            remoteUrl: 'https://github.com/example/global-ext.git',
            isUpToDate: true,
        },
    };
    fixture.extensionBranches = {
        'local:local-ext': [{ name: 'main' }, { name: 'next' }],
        'global:global-ext': [{ name: 'stable' }],
    };
    fixture.requests.extensionWorkflows = {
        installs: [],
        versions: [],
        branches: [],
        switches: [],
        updates: [],
        moves: [],
        deletes: [],
    };

    return fixture;
}

function removeThirdPartyPrefix(extensionName) {
    return String(extensionName || '').replace(/^third-party\//u, '');
}

function addExtension(fixture, name, type) {
    const folderName = removeThirdPartyPrefix(name);
    fixture.extensions.push({ name: `third-party/${folderName}`, type });
    fixture.extensionVersions[extensionKey(folderName, type === 'global')] = {
        currentBranchName: 'main',
        currentCommitHash: '000000000000',
        remoteUrl: `https://github.com/example/${folderName}.git`,
        isUpToDate: true,
    };
    fixture.extensionBranches[extensionKey(folderName, type === 'global')] = [{ name: 'main' }];
}

async function mockModernExtensionsWorkspace(page) {
    const fixture = createExtensionFixture();
    const requests = fixture.requests.extensionWorkflows;
    await mockModernWorkspace(page, fixture);

    await page.route('**/api/extensions/install', route => {
        const payload = route.request().postDataJSON();
        requests.installs.push(clone(payload));
        const folderName = removeThirdPartyPrefix(payload.url.split('/').pop()?.replace(/\.git$/u, '') || `extension-${requests.installs.length}`);
        addExtension(fixture, folderName, payload.global ? 'global' : 'local');
        fixture.extensionVersions[extensionKey(folderName, payload.global)].currentBranchName = payload.branch || 'main';
        return fulfillJson(route, { display_name: folderName, folderName });
    });

    await page.route('**/api/extensions/version', route => {
        const payload = route.request().postDataJSON();
        requests.versions.push(clone(payload));
        return fulfillJson(route, fixture.extensionVersions[extensionKey(payload.extensionName, payload.global)] || {});
    });

    await page.route('**/api/extensions/branches', route => {
        const payload = route.request().postDataJSON();
        requests.branches.push(clone(payload));
        return fulfillJson(route, fixture.extensionBranches[extensionKey(payload.extensionName, payload.global)] || []);
    });

    await page.route('**/api/extensions/switch', route => {
        const payload = route.request().postDataJSON();
        requests.switches.push(clone(payload));
        const key = extensionKey(payload.extensionName, payload.global);
        fixture.extensionVersions[key] = {
            ...(fixture.extensionVersions[key] || {}),
            currentBranchName: payload.branch,
        };
        return fulfillJson(route, { ok: true });
    });

    await page.route('**/api/extensions/update', route => {
        const payload = route.request().postDataJSON();
        requests.updates.push(clone(payload));
        const key = extensionKey(payload.extensionName, payload.global);
        fixture.extensionVersions[key] = {
            ...(fixture.extensionVersions[key] || {}),
            currentCommitHash: 'feed123456789',
            isUpToDate: true,
        };
        return fulfillJson(route, { isUpToDate: false, shortCommitHash: 'feed123' });
    });

    await page.route('**/api/extensions/move', route => {
        const payload = route.request().postDataJSON();
        requests.moves.push(clone(payload));
        fixture.extensions = fixture.extensions.map(extension => (
            removeThirdPartyPrefix(extension.name) === payload.extensionName && extension.type === payload.source
                ? { ...extension, type: payload.destination }
                : extension
        ));

        const sourceKey = extensionKey(payload.extensionName, payload.source === 'global');
        const destinationKey = extensionKey(payload.extensionName, payload.destination === 'global');
        fixture.extensionVersions[destinationKey] = fixture.extensionVersions[sourceKey] || {};
        fixture.extensionBranches[destinationKey] = fixture.extensionBranches[sourceKey] || [];
        delete fixture.extensionVersions[sourceKey];
        delete fixture.extensionBranches[sourceKey];
        return fulfillJson(route, { ok: true });
    });

    await page.route('**/api/extensions/delete', route => {
        const payload = route.request().postDataJSON();
        requests.deletes.push(clone(payload));
        fixture.extensions = fixture.extensions.filter(extension => !(
            removeThirdPartyPrefix(extension.name) === payload.extensionName
            && extension.type === (payload.global ? 'global' : 'local')
        ));
        delete fixture.extensionVersions[extensionKey(payload.extensionName, payload.global)];
        delete fixture.extensionBranches[extensionKey(payload.extensionName, payload.global)];
        return fulfillJson(route, { ok: true });
    });

    return fixture;
}

test.describe('Modern extensions page', () => {
    test('installs an extension through the modern install panel', async ({ page }) => {
        const fixture = await mockModernExtensionsWorkspace(page);
        const requests = fixture.requests.extensionWorkflows;

        await gotoModern(page, 'extensions', '扩展');

        await page.locator('[data-toggle-extension-install]').click();
        await page.locator('[data-extension-install-url]').fill('https://github.com/example/new-ext.git');
        await page.locator('[data-extension-install-branch]').fill('develop');
        await page.locator('[data-extension-install-global]').check();
        await page.locator('[data-install-extension]').click();

        await expect.poll(() => requests.installs.length).toBe(1);
        expect(requests.installs[0]).toEqual({
            url: 'https://github.com/example/new-ext.git',
            branch: 'develop',
            global: true,
        });
        await expect(page.locator('.extension-card', { hasText: 'new-ext' })).toBeVisible();
        await expect(page.locator('.extension-card', { hasText: 'new-ext' })).toContainText('global');
    });

    test('reads details, loads branches, and switches extension branch', async ({ page }) => {
        const fixture = await mockModernExtensionsWorkspace(page);
        const requests = fixture.requests.extensionWorkflows;

        await gotoModern(page, 'extensions', '扩展');

        await page.locator('[data-extension-details="local-ext"][data-extension-type="local"]').click();

        await expect.poll(() => requests.versions.length).toBe(1);
        expect(requests.versions[0]).toEqual({ extensionName: 'local-ext', global: false });
        await expect(page.locator('.extension-detail-panel')).toContainText('main');
        await expect(page.locator('.extension-detail-panel')).toContainText('abc123456789');

        await page.locator('[data-load-extension-branches="local-ext"][data-extension-type="local"]').click();

        await expect.poll(() => requests.branches.length).toBe(1);
        expect(requests.branches[0]).toEqual({ extensionName: 'local-ext', global: false });
        await expect(page.locator('[data-extension-branch]')).toHaveValue('main');

        await page.locator('[data-extension-branch]').selectOption('next');
        await page.locator('[data-switch-extension-branch]').click();

        await expect.poll(() => requests.switches.length).toBe(1);
        expect(requests.switches[0]).toEqual({
            extensionName: 'local-ext',
            branch: 'next',
            global: false,
        });
        await expect(page.locator('.extension-detail-panel')).toContainText('next');
    });

    test('updates, moves, and deletes a manageable extension', async ({ page }) => {
        const fixture = await mockModernExtensionsWorkspace(page);
        const requests = fixture.requests.extensionWorkflows;

        await gotoModern(page, 'extensions', '扩展');

        await expect(page.locator('.extension-card', { hasText: 'assets' })).toContainText('受保护');
        await expect(page.locator('.extension-card', { hasText: 'assets' }).locator('[data-extension-action]')).toHaveCount(0);

        await page.locator('[data-extension-action="update"][data-extension-name="local-ext"][data-extension-type="local"]').click();
        await page.locator('[data-confirm-extension-operation]').click();

        await expect.poll(() => requests.updates.length).toBe(1);
        expect(requests.updates[0]).toEqual({ extensionName: 'local-ext', global: false });
        await expect(page.locator('.extension-card', { hasText: 'local-ext' })).toBeVisible();

        await page.locator('[data-extension-action="move"][data-extension-name="local-ext"][data-extension-type="local"]').click();
        await page.locator('[data-confirm-extension-operation]').click();

        await expect.poll(() => requests.moves.length).toBe(1);
        expect(requests.moves[0]).toEqual({
            extensionName: 'local-ext',
            source: 'local',
            destination: 'global',
        });
        await expect(page.locator('.extension-card', { hasText: 'local-ext' })).toContainText('global');
        await expect(page.locator('[data-extension-action="move"][data-extension-name="local-ext"][data-extension-type="global"]')).toContainText('移到本地');

        await page.locator('[data-extension-action="delete"][data-extension-name="local-ext"][data-extension-type="global"]').click();
        await page.locator('[data-confirm-extension-operation]').click();

        await expect.poll(() => requests.deletes.length).toBe(1);
        expect(requests.deletes[0]).toEqual({ extensionName: 'local-ext', global: true });
        await expect(page.locator('.extension-card', { hasText: 'local-ext' })).toHaveCount(0);
    });
});
