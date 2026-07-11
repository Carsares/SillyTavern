/* global window, location */
import { test, expect } from '@playwright/test';

// The modern UI reuses the legacy generation engine through a hidden /index.html?modernBridge=1 iframe.
// This smoke protects that headless entrypoint: the legacy app must boot cleanly in bridge mode and
// answer a bridge RPC, so future headless hardening can't silently break the modern generation path.
test.describe('Modern legacy bridge headless entry', () => {
    test('boots the legacy engine headlessly and answers a bridge status call', async ({ page }) => {
        test.setTimeout(90_000);

        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        await page.goto('/index.html?modernBridge=1', { waitUntil: 'load' });

        const status = await page.evaluate(() => new Promise((resolve, reject) => {
            const source = 'sillytavern-modern-bridge';
            const id = 'headless-smoke';
            const timer = setTimeout(() => reject(new Error('bridge status timeout')), 60000);
            window.addEventListener('message', function onMessage(event) {
                // The reply carries result/error and (unlike the request) has no action field
                if (event.data && event.data.source === source && event.data.id === id && !('action' in event.data)) {
                    window.removeEventListener('message', onMessage);
                    clearTimeout(timer);
                    resolve({ error: event.data.error, result: event.data.result });
                }
            });
            window.postMessage({ source, id, action: 'status', payload: {} }, location.origin);
        }));

        expect(status.error).toBeFalsy();
        expect(status.result).toBeTruthy();
        expect(errors).toEqual([]);
    });
});
