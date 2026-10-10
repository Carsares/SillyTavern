/* global localStorage */
import { test, expect } from '@playwright/test';
import { createModernResourceFixture, gotoModern, mockModernWorkspace } from './modern-test-utils.js';

function fulfillJson(route, body, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

// The backend answers these writes with 204 No Content, like the real server does
function fulfillNoContent(route) {
    return route.fulfill({ status: 204, body: '' });
}

// Chromium reports a fetch whose empty 204 body is never read as net::ERR_ABORTED, even though the request
// completed. Record how each request to the given paths ended ('finished' or the network error) so a test can
// wait for every one of them to settle and see a successful write reported as aborted, or sent twice.
function trackRequestOutcomes(page, pathPattern) {
    const outcomes = [];
    const describeRequest = request => `${request.method()} ${new URL(request.url()).pathname}`;
    const matches = request => pathPattern.test(new URL(request.url()).pathname);
    page.on('requestfinished', request => {
        if (matches(request)) {
            outcomes.push(`${describeRequest(request)} finished`);
        }
    });
    page.on('requestfailed', request => {
        if (matches(request)) {
            outcomes.push(`${describeRequest(request)} ${request.failure()?.errorText || 'failed'}`);
        }
    });
    return outcomes;
}

// Stand-in for the hidden legacy iframe: answers every bridge call with { ok: true } and records the action
async function mockBridgeFrame(page) {
    const actions = [];
    await page.route(/.*\?modernBridge=1$/u, route => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html>
            <html>
                <body>
                    <script>
                        window.addEventListener('message', async event => {
                            const message = event.data || {};
                            if (message.source !== 'sillytavern-modern-bridge' || !message.action) return;
                            await fetch('/modern-core-plumbing-bridge', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ action: message.action }),
                            });
                            parent.postMessage({ source: 'sillytavern-modern-bridge', id: message.id, result: { ok: true } }, event.origin);
                        });
                    </script>
                </body>
            </html>`,
    }));
    await page.route('**/modern-core-plumbing-bridge', route => {
        actions.push(route.request().postDataJSON()?.action);
        return fulfillJson(route, { ok: true });
    });
    return actions;
}

function readStorage(page, key) {
    return page.evaluate(storageKey => localStorage.getItem(storageKey), key);
}

test.describe('Modern API client and bridge plumbing', () => {
    test('sends each 204 settings snapshot write once and does not report it as aborted', async ({ page }) => {
        const fixture = createModernResourceFixture();
        const snapshots = [{ name: 'settings-older.json', date: 1710000000000, size: 256 }];
        const creates = [];
        const restores = [];
        const outcomes = trackRequestOutcomes(page, /^\/api\/settings\/(make|restore)-snapshot$/u);
        await mockModernWorkspace(page, fixture);
        const bridgeActions = await mockBridgeFrame(page);
        await page.route('**/api/settings/get-snapshots', route => fulfillJson(route, snapshots));
        await page.route('**/api/settings/make-snapshot', route => {
            creates.push(route.request().method());
            snapshots.push({ name: 'settings-created.json', date: 1720000000000, size: 512 });
            return fulfillNoContent(route);
        });
        await page.route('**/api/settings/restore-snapshot', route => {
            restores.push(route.request().postDataJSON());
            return fulfillNoContent(route);
        });
        await page.addInitScript(() => localStorage.setItem('st-modern-settings-section', 'snapshots'));

        await gotoModern(page, 'settings', '设置中心');
        await expect(page.locator('.backup-row', { hasText: 'settings-older.json' })).toBeVisible();

        await page.locator('[data-create-settings-snapshot]').click();
        await expect(page.locator('.toast', { hasText: '设置快照已创建' })).toBeVisible();
        await expect(page.locator('.backup-row', { hasText: 'settings-created.json' })).toBeVisible();

        await page.locator('[data-restore-settings-snapshot="settings-older.json"]').click();
        await page.locator('[data-confirm-settings-restore]').click();
        await expect(page.locator('.toast', { hasText: '设置已恢复' })).toBeVisible();
        // The bridge reload is the last step of the restore, after its response has been handled
        await expect.poll(() => bridgeActions).toContain('reloadSettings');

        expect(creates).toEqual(['POST']);
        expect(restores).toEqual([{ name: 'settings-older.json' }]);
        await expect.poll(() => outcomes).toEqual([
            'POST /api/settings/make-snapshot finished',
            'POST /api/settings/restore-snapshot finished',
        ]);
    });

    // The import-record delete (actions/remote-resources.js) gets the same 204 reply; checked on the client itself so
    // the test does not depend on how the records tab asks for confirmation
    test('reads an empty 204 DELETE reply as null without leaving the request aborted', async ({ page }) => {
        const deletes = [];
        const outcomes = trackRequestOutcomes(page, /^\/api\/remote-resources\/records\//u);
        await mockModernWorkspace(page);
        await page.route(/\/api\/remote-resources\/records\/[^/?]+$/u, route => {
            deletes.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
            return fulfillNoContent(route);
        });

        await gotoModern(page, 'dashboard', '工作台');
        const result = await page.evaluate(async () => {
            const { createApiClient } = await import('/modern/core/api-client.js');
            return createApiClient().apiFetch('/api/remote-resources/records/record-1', { method: 'DELETE' });
        });

        expect(result).toBeNull();
        expect(deletes).toEqual(['DELETE /api/remote-resources/records/record-1']);
        await expect.poll(() => outcomes).toEqual(['DELETE /api/remote-resources/records/record-1 finished']);
    });

    test('the legacy engine ping reads its 204 reply instead of leaving it aborted', async ({ page }) => {
        test.setTimeout(90_000);

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });
        // Generate() pings the server before every generation; the ping needs the CSRF token the engine fetches at boot
        await expect.poll(() => page.evaluate(async () => {
            const { getRequestHeaders } = await import('/script.js');
            return Boolean(getRequestHeaders()['X-CSRF-Token']);
        }), { timeout: 60_000 }).toBe(true);

        const outcomes = trackRequestOutcomes(page, /^\/api\/ping$/u);
        const pinged = await page.evaluate(async () => {
            const { pingServer } = await import('/script.js');
            return pingServer();
        });

        expect(pinged).toBe(true);
        await expect.poll(() => outcomes).toEqual(['POST /api/ping finished']);
    });
});

test.describe('Modern settings and the context drawer', () => {
    test('saving the drawer preference clears the last drawer state without closing or opening the drawer', async ({ page }) => {
        await mockModernWorkspace(page, createModernResourceFixture());
        await page.route('**/api/settings/get-snapshots', route => fulfillJson(route, []));
        // The user closed the drawer last time although the saved preference opens it
        await page.addInitScript(() => {
            if (!localStorage.getItem('st-modern-core-plumbing-seeded')) {
                localStorage.setItem('st-modern-core-plumbing-seeded', 'true');
                localStorage.setItem('st-modern-inspector-open', 'true');
                localStorage.setItem('st-modern-inspector-state', 'closed');
            }
        });

        await gotoModern(page, 'settings', '设置中心');
        const inspector = page.locator('#inspector');
        await expect(inspector).not.toHaveClass(/open/);
        await expect(page.locator('[data-modern-inspector-open]')).toBeChecked();

        await page.locator('[data-save-modern-preferences]').click();
        await expect(page.locator('.toast', { hasText: '界面偏好已保存' })).toContainText('浅色 / 角色');
        expect(await readStorage(page, 'st-modern-inspector-state')).toBeNull();
        expect(await readStorage(page, 'st-modern-inspector-open')).toBe('true');
        await expect(inspector).not.toHaveClass(/open/);

        // Only the saving click is exempt: the next click outside the open drawer still closes it
        await page.locator('.topbar [data-toggle-inspector]').click();
        await expect(inspector).toHaveClass(/open/);
        await page.locator('.page-title').click();
        await expect(inspector).not.toHaveClass(/open/);
        expect(await readStorage(page, 'st-modern-inspector-state')).toBe('closed');

        // Saving with the drawer open keeps it open and lets the preference decide the next load
        await page.locator('.topbar [data-toggle-inspector]').click();
        await expect(inspector).toHaveClass(/open/);
        await page.locator('[data-save-modern-preferences]').click();
        await expect(inspector).toHaveClass(/open/);
        expect(await readStorage(page, 'st-modern-inspector-state')).toBeNull();
        await page.reload();
        await expect(page.locator('.page-title')).toHaveText('设置中心');
        await expect(inspector).toHaveClass(/open/);
    });
});
