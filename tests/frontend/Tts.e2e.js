import { test, expect } from '@playwright/test';

/* global document, window */

test.describe('TTS settings', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('**/api/settings/save', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
        await page.goto('/index.html?modernBridge=1');
        await page.waitForFunction(() => {
            const provider = document.getElementById('tts_provider');
            return document.readyState === 'complete' && provider && Array.from(provider.options).some(option => option.value === 'System');
        });
    });

    test('initializes the voice map when TTS is enabled after provider loading', async ({ page }) => {
        await page.evaluate(() => {
            const enabled = document.getElementById('tts_enabled');
            if (enabled.checked) {
                enabled.click();
            }

            const provider = document.getElementById('tts_provider');
            provider.value = 'System';
            provider.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await expect(page.locator('#system_tts_rate')).toBeAttached();
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
        await page.evaluate(() => document.getElementById('tts_voicemap_block').replaceChildren());
        await expect(page.locator('#tts_voicemap_block .tts_voicemap_block_char')).toHaveCount(0);

        await page.evaluate(() => document.getElementById('tts_enabled').click());

        await expect(page.locator('#tts_enabled')).toBeChecked();
        await expect(page.locator('#tts_voicemap_block .tts_voicemap_block_char')).not.toHaveCount(0);
        await expect(page.locator('#tts_status')).toContainText('TTS Provider Loaded');
    });

    test('renders a character name in the voice map as text, not HTML', async ({ page }) => {
        const hostileName = '<img src=x onerror="window.testTtsXssFired = true">';
        await page.evaluate(async (hostileName) => {
            const { characters } = await import('./script.js');
            const { extension_settings } = await import('./scripts/extensions.js');
            const { registerTtsProvider } = await import('./scripts/extensions/tts/index.js');

            window.testTtsXssFired = false;
            characters.push({ name: hostileName, avatar: 'xss.png' });

            class ReadyTtsProvider {
                settings = {};
                get settingsHtml() { return '<div id="xss_tts_provider"></div>'; }
                async loadSettings(settings) { this.settings = settings; }
                async checkReady() {}
                async fetchTtsVoiceObjects() { return [{ name: 'Voice', voice_id: 'v', preview_url: false, lang: 'en-US' }]; }
                async getVoice(voiceId) { return { voice_id: voiceId }; }
                async generateTts() { return ''; }
            }

            const providerName = 'XSS Test';
            extension_settings.tts[providerName] = { voiceMap: {} };
            registerTtsProvider(providerName, ReadyTtsProvider);

            const enabled = document.getElementById('tts_enabled');
            if (!enabled.checked) {
                enabled.click();
            }
            const provider = document.getElementById('tts_provider');
            provider.value = providerName;
            provider.dispatchEvent(new Event('change', { bubbles: true }));
        }, hostileName);
        await expect(page.locator('#xss_tts_provider')).toBeAttached();

        // Rebuild the voice map over every character until the injected one is rendered
        // (initVoiceMap coalesces with any in-flight restricted rebuild, so retry until it takes)
        await expect.poll(async () => page.evaluate(async () => {
            const { initVoiceMap } = await import('./scripts/extensions/tts/index.js');
            const enabled = document.getElementById('tts_enabled');
            if (!enabled.checked) {
                enabled.click();
            }
            await initVoiceMap(true);
            return document.querySelectorAll('#tts_voicemap_block .tts_voicemap_block_char').length;
        })).toBeGreaterThan(1);

        const result = await page.evaluate((hostileName) => {
            const block = document.getElementById('tts_voicemap_block');
            const spans = Array.from(block.querySelectorAll('.tts_voicemap_block_char > span'));
            return {
                xssFired: window.testTtsXssFired,
                injectedImgCount: block.querySelectorAll('img').length,
                hostileRenderedAsText: spans.some(span => span.textContent === hostileName),
            };
        }, hostileName);

        expect(result.xssFired).toBe(false);
        expect(result.injectedImgCount).toBe(0);
        expect(result.hostileRenderedAsText).toBe(true);
    });

    test('discards provider results from playback that was reset', async ({ page }) => {
        await page.evaluate(async () => {
            const { chat, eventSource, event_types } = await import('./script.js');
            const { extension_settings } = await import('./scripts/extensions.js');
            const { registerTtsProvider } = await import('./scripts/extensions/tts/index.js');

            window.testTtsRequests = [];
            window.testTtsAudioEvents = [];
            eventSource.on(event_types.TTS_AUDIO_READY, event => window.testTtsAudioEvents.push(event.text));

            class DeferredTtsProvider {
                settings = {};

                get settingsHtml() {
                    return '<div id="deferred_tts_provider"></div>';
                }

                async loadSettings(settings) {
                    this.settings = settings;
                }

                async checkReady() {}

                async fetchTtsVoiceObjects() {
                    return [{ name: 'Test Voice', voice_id: 'test-voice', preview_url: false, lang: 'en-US' }];
                }

                async getVoice(voiceId) {
                    return { voice_id: voiceId };
                }

                async generateTts(text) {
                    return new Promise(resolve => window.testTtsRequests.push({ text, resolve }));
                }
            }

            const providerName = 'Deferred Test';
            extension_settings.tts[providerName] = { voiceMap: { '[Default Voice]': 'test-voice' } };
            extension_settings.tts.narrate_by_paragraphs = false;
            extension_settings.tts.multi_voice_enabled = false;
            registerTtsProvider(providerName, DeferredTtsProvider);

            const enabled = document.getElementById('tts_enabled');
            if (enabled.checked) {
                enabled.click();
            }
            const provider = document.getElementById('tts_provider');
            provider.value = providerName;
            provider.dispatchEvent(new Event('change', { bubbles: true }));

            chat.splice(0, chat.length, { name: '[Default Voice]', mes: 'stale text', is_system: false, is_user: false, extra: {} });
        });
        await expect(page.locator('#deferred_tts_provider')).toBeAttached();
        await page.evaluate(() => document.getElementById('tts_enabled').click());
        await expect(page.locator('#tts_voicemap_block .tts_voicemap_block_char')).not.toHaveCount(0);

        await page.evaluate(() => window.playFullConversation());
        await expect.poll(() => page.evaluate(() => window.testTtsRequests.length)).toBe(1);

        await page.evaluate(async () => {
            const { chat } = await import('./script.js');
            chat[0].mes = 'current text';
            window.playFullConversation();
        });
        await expect.poll(() => page.evaluate(() => window.testTtsRequests.length)).toBe(2);

        await page.evaluate(() => window.testTtsRequests[0].resolve('data:audio/mpeg;base64,SUQz'));
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
        expect(await page.evaluate(() => window.testTtsAudioEvents)).toEqual([]);

        await page.evaluate(() => window.testTtsRequests[1].resolve('data:audio/mpeg;base64,SUQz'));
        await expect.poll(() => page.evaluate(() => window.testTtsAudioEvents)).toEqual(['current text']);
    });
});
