import { test, expect } from '@playwright/test';

/* global document */

test.describe('Swipe lifecycle', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('**/api/horde/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
        await page.route('**/api/horde/text-models', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
        await page.route('**/api/chats/save', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"integrity":"saved"}' }));
        await page.goto('/index.html?modernBridge=1');
        await page.waitForFunction('document.readyState === "complete"');
    });

    test('finishes an existing-candidate swipe when Horde generation is unavailable', async ({ page }) => {
        const state = await page.evaluate(async () => {
            const script = await import('./script.js');
            const { kai_settings } = await import('./scripts/kai-settings.js');
            const { power_user } = await import('./scripts/power-user.js');
            const { SWIPE_DIRECTION, SWIPE_SOURCE } = await import('./scripts/constants.js');

            script.characters.splice(0, script.characters.length, {
                name: 'Swipe Test',
                avatar: 'swipe-test.png',
                chat: 'swipe-chat',
                data: { name: 'Swipe Test' },
            });
            script.setCharacterId(0);
            const message = {
                name: 'Swipe Test',
                mes: 'first response',
                is_user: false,
                is_system: false,
                send_date: 'now',
                extra: {},
                swipe_id: 0,
                swipes: ['first response', 'second response'],
                swipe_info: [
                    { send_date: 'now', extra: {} },
                    { send_date: 'later', extra: {} },
                ],
            };
            script.chat.splice(0, script.chat.length, message);
            power_user.message_token_count_enabled = false;

            const messageElement = document.querySelector('#message_template .mes').cloneNode(true);
            messageElement.setAttribute('mesid', '0');
            messageElement.querySelector('.mes_text').textContent = message.mes;
            document.getElementById('chat').replaceChildren(messageElement);

            kai_settings.preset_settings = 'gui';
            script.changeMainAPI('koboldhorde');
            await script.swipe(null, SWIPE_DIRECTION.RIGHT, {
                source: SWIPE_SOURCE.SLASH_COMMAND,
                forceMesId: 0,
                forceSwipeId: 1,
                forceDuration: 0,
            });

            return {
                swipeId: script.chat[0].swipe_id,
                message: script.chat[0].mes,
                swipeState: script.swipeState,
                bodySwiping: document.body.dataset.swiping ?? null,
            };
        });

        expect(state).toEqual({ swipeId: 1, message: 'second response', swipeState: 'none', bodySwiping: null });
    });
});
