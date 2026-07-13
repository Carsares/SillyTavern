import { test, expect } from '@playwright/test';

/* global document, window */

async function setSoloChat(page, extra = {}) {
    await page.evaluate(async messageExtra => {
        const script = await import('./script.js');
        const { resetSelectedGroup } = await import('./scripts/group-chats.js');
        resetSelectedGroup();
        script.characters.splice(0, script.characters.length, {
            name: 'Branch Test',
            avatar: 'branch-test.png',
            chat: 'main-chat',
            data: { name: 'Branch Test' },
        });
        script.setCharacterId(0);
        script.chat.splice(0, script.chat.length, {
            name: 'Branch Test',
            mes: 'Branch from this message',
            is_system: false,
            is_user: false,
            extra: messageExtra,
        });
    }, extra);
}

test.describe('Branch and checkpoint persistence', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/index.html?modernBridge=1');
        await page.waitForFunction('document.readyState === "complete"');
        await page.route('**/api/characters/chats', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    });

    test('does not publish a branch when its child chat fails to save', async ({ page }) => {
        let saveRequests = 0;
        await page.route('**/api/chats/save', route => {
            saveRequests++;
            return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        });
        await setSoloChat(page);

        const state = await page.evaluate(async () => {
            const { chat } = await import('./script.js');
            const { createBranch } = await import('./scripts/bookmarks.js');
            const result = await createBranch(0);
            return { result: result ?? null, branches: chat[0].extra?.branches ?? null };
        });

        expect(state).toEqual({ result: null, branches: null });
        expect(saveRequests).toBe(1);
    });

    test('restores the branch list when the parent chat fails to save', async ({ page }) => {
        let saveRequests = 0;
        await page.route('**/api/chats/save', route => {
            saveRequests++;
            return saveRequests === 1
                ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"integrity":"child"}' })
                : route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        });
        await setSoloChat(page, { branches: ['existing-branch'] });

        const state = await page.evaluate(async () => {
            const { chat } = await import('./script.js');
            const { createBranch } = await import('./scripts/bookmarks.js');
            const result = await createBranch(0);
            return { result: result ?? null, branches: [...chat[0].extra.branches] };
        });

        expect(state).toEqual({ result: null, branches: ['existing-branch'] });
        expect(saveRequests).toBe(2);
    });

    test('restores a checkpoint link when the parent chat fails to save', async ({ page }) => {
        let saveRequests = 0;
        await page.route('**/api/chats/save', route => {
            saveRequests++;
            return saveRequests === 1
                ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"integrity":"child"}' })
                : route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        });
        await setSoloChat(page, { bookmark_link: 'existing-checkpoint' });

        const state = await page.evaluate(async () => {
            const { chat } = await import('./script.js');
            const { createNewBookmark } = await import('./scripts/bookmarks.js');
            const message = document.createElement('div');
            message.className = 'mes';
            message.setAttribute('mesid', '0');
            message.setAttribute('bookmark_link', 'existing-checkpoint');
            message.innerHTML = '<button class="mes_bookmark" data-tooltip="Open checkpoint"></button>';
            document.body.appendChild(message);
            window.testBookmarkSuccesses = 0;
            window.toastr.success = () => window.testBookmarkSuccesses++;

            const result = await createNewBookmark(0, { forceName: 'new-checkpoint' });
            return {
                result: result ?? null,
                bookmarkLink: chat[0].extra.bookmark_link,
                displayedLink: message.getAttribute('bookmark_link'),
                successCount: window.testBookmarkSuccesses,
            };
        });

        expect(state).toEqual({ result: null, bookmarkLink: 'existing-checkpoint', displayedLink: 'existing-checkpoint', successCount: 0 });
        expect(saveRequests).toBe(2);
    });

    test('saves a group child chat before publishing its group reference', async ({ page }) => {
        const requestOrder = [];
        await page.route('**/api/chats/group/save', route => {
            requestOrder.push('chat');
            return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        });
        await page.route('**/api/groups/edit', route => {
            requestOrder.push('group');
            return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        });

        const state = await page.evaluate(async () => {
            const { groups, saveGroupBookmarkChat } = await import('./scripts/group-chats.js');
            groups.splice(0, groups.length, { id: 'group-test', name: 'Group Test', chat_id: 'main-chat', chats: ['main-chat'] });
            const saved = await saveGroupBookmarkChat('group-test', 'new-branch', {}, 0, [{ name: 'Test', mes: 'Message', extra: {} }]);
            return { saved, chats: [...groups[0].chats] };
        });

        expect(requestOrder).toEqual(['chat', 'group']);
        expect(state).toEqual({ saved: false, chats: ['main-chat'] });
    });
});
