import { test, expect } from '@playwright/test';

/* global document */

test.describe('Chat search', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/index.html?modernBridge=1');
        await page.waitForFunction('document.readyState === "complete" && document.getElementById("select_chat_search")');
    });

    test('keeps the latest legacy chat search and cancels the previous view debounce', async ({ page }) => {
        const requests = [];
        const pendingSearches = new Map();
        await page.route('**/api/chats/search', async route => {
            const query = JSON.parse(route.request().postData() || '{}').query || '';
            requests.push(query);
            if (!query) {
                await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
                return;
            }
            const body = await new Promise(resolve => pendingSearches.set(query, resolve));
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        });

        await page.evaluate(async () => {
            const script = await import('./script.js');
            script.characters.splice(0, script.characters.length, {
                avatar: 'search-race.png',
                name: 'Search Race',
                chat: 'current-chat',
                data: { name: 'Search Race' },
            });
            script.setCharacterId(0);
            await script.displayPastChats();
        });

        await page.evaluate(() => {
            const input = document.getElementById('select_chat_search');
            input.value = 'first';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await expect.poll(() => requests).toContain('first');
        await page.evaluate(() => {
            const input = document.getElementById('select_chat_search');
            input.value = 'second';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await expect.poll(() => requests).toContain('second');

        pendingSearches.get('second')([{ file_name: 'second.jsonl', file_size: '1 KB', message_count: 1, preview_message: 'second result', last_mes: Date.now() }]);
        await expect(page.locator('#select_chat_div .select_chat_block_filename')).toHaveText('second.jsonl');
        pendingSearches.get('first')([{ file_name: 'first.jsonl', file_size: '1 KB', message_count: 1, preview_message: 'first result', last_mes: Date.now() - 1_000 }]);
        await expect(page.locator('#select_chat_div .select_chat_block_filename')).toHaveText('second.jsonl');

        await page.evaluate(() => {
            const input = document.getElementById('select_chat_search');
            input.value = 'old-view';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.evaluate(async () => {
            const { displayPastChats } = await import('./script.js');
            await displayPastChats();
        });
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 400)));
        expect(requests).not.toContain('old-view');
    });
});
