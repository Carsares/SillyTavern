import { test, expect } from '@playwright/test';
import { mockBridgeFrame } from './modern-test-utils.js';

function createTextCompletionCase(type, modelField, secretKey) {
    const initialModel = modelField ? `${type}/saved-model` : '';
    const modelValue = modelField ? `${type}/modern-model` : 'model-field-should-not-be-saved';
    const modelSettings = modelField ? { [modelField]: initialModel } : {};
    const expectedModelSettings = modelField ? { [modelField]: modelValue } : {};
    const secretValue = secretKey ? `sk-${type}` : '';
    const expectedSecretWrites = secretKey ? [{ key: secretKey, value: secretValue }] : [];

    return {
        type,
        initialModel,
        modelValue,
        modelSettings,
        expectedModelSettings,
        secretValue,
        expectedSecretWrites,
    };
}

const textCompletionCases = [
    createTextCompletionCase('ooba', 'custom_model', 'api_key_ooba'),
    createTextCompletionCase('mancer', 'mancer_model', 'api_key_mancer'),
    createTextCompletionCase('vllm', 'vllm_model', 'api_key_vllm'),
    createTextCompletionCase('aphrodite', 'aphrodite_model', 'api_key_aphrodite'),
    createTextCompletionCase('tabby', 'tabby_model', 'api_key_tabby'),
    createTextCompletionCase('koboldcpp', '', 'api_key_koboldcpp'),
    createTextCompletionCase('togetherai', 'togetherai_model', 'api_key_togetherai'),
    createTextCompletionCase('llamacpp', 'llamacpp_model', 'api_key_llamacpp'),
    createTextCompletionCase('ollama', 'ollama_model', ''),
    createTextCompletionCase('infermaticai', 'infermaticai_model', 'api_key_infermaticai'),
    createTextCompletionCase('dreamgen', 'dreamgen_model', 'api_key_dreamgen'),
    createTextCompletionCase('openrouter', 'openrouter_model', 'api_key_openrouter'),
    createTextCompletionCase('featherless', 'featherless_model', 'api_key_featherless'),
    createTextCompletionCase('huggingface', '', 'api_key_huggingface'),
    createTextCompletionCase('generic', 'generic_model', 'api_key_generic'),
];

function setInputValue(input, value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

// Every API save now asks the hidden generation engine to reload its settings, so the engine frame is always stubbed:
// the real engine would boot a whole legacy page in the middle of a page that only mocks the settings endpoints.
// Returns the live list of bridge requests the page posted to the stub.
async function mockModernApiShell(page, settingsBundle, secretState = {}, bridgeOptions = {}) {
    const bridgeCalls = await mockBridgeFrame(page, bridgeOptions);
    await page.route('**/csrf-token', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'modern-api-test' }),
    }));

    await page.route('**/api/users/me', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ handle: 'modern-test' }),
    }));

    await page.route('**/api/settings/get', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(settingsBundle),
    }));

    await page.route('**/api/characters/all', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
    }));

    await page.route('**/api/groups/all', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
    }));

    await page.route('**/api/worldinfo/list', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
    }));

    await page.route('**/api/backgrounds/all', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
    }));

    await page.route('**/api/backgrounds/folders', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ folders: [], imageFolderMap: {} }),
    }));

    await page.route('**/api/assets/get', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
    }));

    await page.route('**/api/extensions/discover', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
    }));

    await page.route('**/api/secrets/settings', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ allowKeysExposure: false }),
    }));

    await page.route('**/api/secrets/read', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(secretState),
    }));

    await page.route('**/api/stats/get', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
    }));
    return bridgeCalls;
}

test.describe('Modern API page', () => {
    test('keeps unsupported main API visible before switching to a modern editor', async ({ page }) => {
        // Uses a synthetic unknown main_api to exercise the fallback: all real main_apis are now editable in the modern UI
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'legacy-unknown-api',
                preset_settings: 'Legacy Preset',
                textgenerationwebui_settings: {
                    type: 'ooba',
                    server_urls: {
                        ooba: 'http://127.0.0.1:5000',
                    },
                    custom_model: 'ooba/saved-model',
                },
            }),
            textgenerationwebui_preset_names: [],
            textgenerationwebui_presets: [],
            openai_setting_names: [],
            openai_settings: [],
        };

        await mockModernApiShell(page, settingsBundle);

        await page.goto('/modern/?view=api');

        await expect(page.locator('.form-section-title', { hasText: '连接' })).toBeVisible();
        await expect(page.locator('[data-api-main]')).toHaveValue('legacy-unknown-api');
        await expect(page.locator('[data-api-main] option:checked')).toHaveText('当前：legacy-unknown-api（暂不支持编辑）');
        await expect(page.locator('text=当前主 API 暂不支持在现代页编辑。')).toBeVisible();

        await page.locator('[data-api-main]').selectOption('textgenerationwebui');

        await expect(page.locator('[data-textgen-type]')).toHaveValue('ooba');
        await expect(page.locator('[data-textgen-endpoint]')).toHaveValue('http://127.0.0.1:5000');
        await expect(page.locator('[data-textgen-model]')).toHaveValue('ooba/saved-model');
    });

    test('edits and tests the KoboldAI Classic connection in the modern editor', async ({ page }) => {
        let savedSettings = null;
        let statusBody = null;
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'kobold',
                api_server: 'http://saved.kobold:5000/api',
            }),
            textgenerationwebui_preset_names: [],
            textgenerationwebui_presets: [],
            openai_setting_names: [],
            openai_settings: [],
        };

        await mockModernApiShell(page, settingsBundle);

        await page.route('**/api/settings/save', route => {
            savedSettings = route.request().postDataJSON();
            settingsBundle.settings = JSON.stringify(savedSettings);
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        });

        await page.route('**/api/backends/kobold/status', route => {
            statusBody = route.request().postDataJSON();
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ model: 'koboldcpp/test-model' }) });
        });

        await page.goto('/modern/?view=api');

        await expect(page.locator('[data-api-main]')).toHaveValue('kobold');
        await expect(page.locator('[data-kobold-api-url]')).toHaveValue('http://saved.kobold:5000/api');
        await expect(page.locator('[data-save-api-connection]')).toHaveAttribute('type', 'submit');

        await page.locator('[data-kobold-api-url]').fill('http://new.kobold:5001/api');
        await page.locator('[data-save-api-connection]').click();

        await expect.poll(() => savedSettings?.api_server).toBe('http://new.kobold:5001/api');
        expect(savedSettings.main_api).toBe('kobold');

        await page.locator('[data-test-api]').click();

        await expect.poll(() => statusBody?.api_server).toBe('http://new.kobold:5001/api');
        await expect(page.locator('.api-history-panel')).toContainText('koboldcpp/test-model');
    });

    test('edits and tests the NovelAI connection without exposing secrets', async ({ page }) => {
        let savedSettings = null;
        let writtenSecret = null;
        let statusCalled = false;
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'novel',
                model_novel: 'kayra-v1',
            }),
            textgenerationwebui_preset_names: [],
            textgenerationwebui_presets: [],
            openai_setting_names: [],
            openai_settings: [],
        };

        await mockModernApiShell(page, settingsBundle, {
            api_key_novel: [{ id: 'saved', value: '********nai', label: 'saved', active: true }],
        });

        await page.route('**/api/secrets/write', route => {
            writtenSecret = route.request().postDataJSON();
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        });

        await page.route('**/api/settings/save', route => {
            savedSettings = route.request().postDataJSON();
            settingsBundle.settings = JSON.stringify(savedSettings);
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        });

        await page.route('**/api/novelai/status', route => {
            statusCalled = true;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tier: 2 }) });
        });

        await page.goto('/modern/?view=api');

        await expect(page.locator('[data-api-main]')).toHaveValue('novel');
        await expect(page.locator('[data-novel-model]')).toHaveValue('kayra-v1');
        await expect(page.locator('[data-novel-secret-status]')).toHaveText('密钥已保存');

        await page.locator('[data-novel-model]').selectOption('llama-3-erato-v1');
        await page.locator('[data-novel-api-key]').fill('nai-secret-token');
        await page.locator('[data-save-api-connection]').click();

        await expect.poll(() => savedSettings?.model_novel).toBe('llama-3-erato-v1');
        expect(savedSettings.main_api).toBe('novel');
        expect(writtenSecret).toMatchObject({ key: 'api_key_novel', value: 'nai-secret-token' });
        await expect(page.locator('body')).not.toContainText('nai-secret-token');

        await page.locator('[data-test-api]').click();

        await expect.poll(() => statusCalled).toBe(true);
        await expect(page.locator('.api-history-panel')).toContainText('Scroll');
    });

    test('edits and tests the AI Horde connection with a live model list', async ({ page }) => {
        let savedSettings = null;
        let writtenSecret = null;
        let userInfoCalled = false;
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'koboldhorde',
                horde_settings: { models: ['koboldcpp/model-a'] },
            }),
            textgenerationwebui_preset_names: [],
            textgenerationwebui_presets: [],
            openai_setting_names: [],
            openai_settings: [],
        };

        await mockModernApiShell(page, settingsBundle);

        await page.route('**/api/horde/text-models', route => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
                { name: 'koboldcpp/model-a', count: 3, performance: 12.4 },
                { name: 'koboldcpp/model-b', count: 1, performance: 5.1 },
            ]),
        }));

        await page.route('**/api/secrets/write', route => {
            writtenSecret = route.request().postDataJSON();
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        });

        await page.route('**/api/settings/save', route => {
            savedSettings = route.request().postDataJSON();
            settingsBundle.settings = JSON.stringify(savedSettings);
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        });

        await page.route('**/api/horde/user-info', route => {
            userInfoCalled = true;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ anonymous: false, user: { username: 'tester', kudos: 42 } }) });
        });

        await page.goto('/modern/?view=api');

        await expect(page.locator('[data-api-main]')).toHaveValue('koboldhorde');
        await expect(page.locator('[data-horde-model] option[value="koboldcpp/model-b"]')).toHaveCount(1);
        await expect(page.locator('[data-horde-model]')).toHaveValues(['koboldcpp/model-a']);

        await page.locator('[data-horde-model]').selectOption(['koboldcpp/model-a', 'koboldcpp/model-b']);
        await page.locator('[data-horde-api-key]').fill('horde-secret');
        await page.locator('[data-save-api-connection]').click();

        await expect.poll(() => savedSettings?.horde_settings?.models).toEqual(['koboldcpp/model-a', 'koboldcpp/model-b']);
        expect(savedSettings.main_api).toBe('koboldhorde');
        expect(writtenSecret).toMatchObject({ key: 'api_key_horde', value: 'horde-secret' });
        await expect(page.locator('body')).not.toContainText('horde-secret');

        await page.locator('[data-test-api]').click();

        await expect.poll(() => userInfoCalled).toBe(true);
        await expect(page.locator('.api-history-panel')).toContainText('tester');

        // Refreshing the model list keeps the current selection instead of resetting it
        await page.locator('[data-horde-refresh]').click();
        await expect(page.locator('[data-horde-model]')).toHaveValues(['koboldcpp/model-a', 'koboldcpp/model-b']);
    });

    test('completes an OpenRouter OAuth callback into a saved secret', async ({ page }) => {
        let writtenSecret = null;
        let exchangeBody = null;
        const settingsBundle = {
            settings: JSON.stringify({ main_api: 'openai', oai_settings: { chat_completion_source: 'openrouter' } }),
            textgenerationwebui_preset_names: [],
            textgenerationwebui_presets: [],
            openai_setting_names: [],
            openai_settings: [],
        };

        await mockModernApiShell(page, settingsBundle);
        await page.addInitScript('window.localStorage.setItem("st-modern-openrouter-code-verifier", "test-verifier-123")');
        await page.route('https://openrouter.ai/api/v1/auth/keys', route => {
            exchangeBody = route.request().postDataJSON();
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: 'sk-or-test-key' }) });
        });
        await page.route('**/api/secrets/write', route => {
            writtenSecret = route.request().postDataJSON();
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        });

        await page.goto('/modern/?oauthSource=openrouter&oauthQuery=code%3Dtestcode');

        await expect.poll(() => exchangeBody).toMatchObject({ code: 'testcode', code_verifier: 'test-verifier-123' });
        await expect.poll(() => writtenSecret).toMatchObject({ key: 'api_key_openrouter', value: 'sk-or-test-key' });
        await expect(page.locator('.toast', { hasText: 'OpenRouter 授权成功' })).toBeVisible();
        await expect.poll(() => new URL(page.url()).searchParams.get('oauthSource')).toBe(null);
        await expect(page.locator('body')).not.toContainText('sk-or-test-key');
    });

    test('edits and tests chat completion connection without exposing secrets', async ({ page }) => {
        let savedSettings = null;
        let writtenSecret = null;
        let generateBody = null;
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'openai',
                oai_settings: {
                    chat_completion_source: 'custom',
                    custom_model: 'custom/saved-model',
                    custom_url: 'https://saved.example/v1',
                    reverse_proxy: 'https://proxy.saved/v1',
                    preset_settings_openai: 'Chat Preset A',
                    temp_openai: 0.7,
                    openai_max_tokens: 300,
                    top_p_openai: 0.9,
                    freq_pen_openai: 0.1,
                    pres_pen_openai: 0.2,
                },
            }),
            textgenerationwebui_preset_names: [],
            textgenerationwebui_presets: [],
            openai_setting_names: ['Chat Preset A', 'Chat Preset B'],
            openai_settings: [
                JSON.stringify({ name: 'Chat Preset A' }),
                JSON.stringify({ name: 'Chat Preset B' }),
            ],
        };

        await mockModernApiShell(page, settingsBundle, {
            api_key_custom: [{ id: 'saved', value: '********tom', label: 'saved', active: true }],
        });

        await page.route('**/api/secrets/write', route => {
            writtenSecret = route.request().postDataJSON();
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true }),
            });
        });

        await page.route('**/api/settings/save', route => {
            savedSettings = route.request().postDataJSON();
            settingsBundle.settings = JSON.stringify(savedSettings);
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true }),
            });
        });

        await page.route('**/api/backends/chat-completions/generate', route => {
            generateBody = route.request().postDataJSON();
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ choices: [{ message: { content: 'OK from custom' } }] }),
            });
        });

        await page.goto('/modern/?view=api');

        await expect(page.locator('[data-api-main]')).toHaveValue('openai');
        await expect(page.locator('[data-api-source]')).toHaveValue('custom');
        await expect(page.locator('[data-api-model]')).toHaveValue('custom/saved-model');
        await expect(page.locator('[data-api-custom-url]')).toHaveValue('https://saved.example/v1');
        await expect(page.locator('[data-api-reverse-proxy]')).toHaveValue('https://proxy.saved/v1');
        await expect(page.locator('[data-api-secret-status]')).toHaveText('密钥已保存');
        await expect(page.locator('body')).not.toContainText('sk-chat-secret');
        await expect(page.locator('form[data-api-connection-form] [data-api-key]')).toHaveCount(1);
        await expect(page.locator('[data-api-key]')).toHaveAttribute('name', 'chat_completion_api_key');
        await expect(page.locator('[data-api-key]')).toHaveAttribute('autocomplete', 'new-password');
        await expect(page.locator('[data-save-api-connection]')).toHaveAttribute('type', 'submit');

        await page.locator('[data-api-model]').fill('custom/new-model');
        await page.locator('[data-api-custom-url]').fill('https://custom.example/v1');
        await page.locator('[data-api-reverse-proxy]').fill('https://proxy.example/v1');
        await page.locator('[data-api-preset]').selectOption('Chat Preset B');
        await page.locator('[data-api-temperature]').fill('0.44');
        await page.locator('[data-api-max-tokens]').fill('512');
        await page.locator('[data-api-top-p]').fill('0.88');
        await page.locator('[data-api-frequency-penalty]').fill('0.12');
        await page.locator('[data-api-presence-penalty]').fill('0.34');
        await page.locator('[data-api-key]').fill('sk-chat-secret');
        await page.locator('[data-api-key]').press('Enter');

        await expect.poll(() => savedSettings?.oai_settings?.custom_model).toBe('custom/new-model');
        expect(savedSettings.main_api).toBe('openai');
        expect(savedSettings.chat_completion_source).toBe('custom');
        expect(savedSettings.oai_settings).toMatchObject({
            chat_completion_source: 'custom',
            custom_model: 'custom/new-model',
            custom_url: 'https://custom.example/v1',
            reverse_proxy: 'https://proxy.example/v1',
            preset_settings_openai: 'Chat Preset B',
            temp_openai: 0.44,
            openai_max_tokens: 512,
            top_p_openai: 0.88,
            freq_pen_openai: 0.12,
            pres_pen_openai: 0.34,
        });
        expect(writtenSecret).toMatchObject({
            key: 'api_key_custom',
            value: 'sk-chat-secret',
        });
        await expect(page.locator('body')).not.toContainText('sk-chat-secret');

        await page.locator('[data-test-api]').click();

        await expect.poll(() => generateBody).toMatchObject({
            chat_completion_source: 'custom',
            model: 'custom/new-model',
            custom_url: 'https://custom.example/v1',
            reverse_proxy: 'https://proxy.example/v1',
            temperature: 0.44,
            max_tokens: 20,
            top_p: 0.88,
            frequency_penalty: 0.12,
            presence_penalty: 0.34,
            stream: false,
        });
        await expect(page.locator('.api-history-panel')).toContainText('custom/new-model');
        await expect(page.locator('.api-history-panel')).toContainText('OK from custom');
    });

    test('blocks saving chat completion parameters outside the legacy ranges and marks the fields', async ({ page }) => {
        const savedBodies = [];
        const generateBodies = [];
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'openai',
                oai_settings: {
                    chat_completion_source: 'custom',
                    custom_model: 'custom/saved-model',
                    custom_url: 'https://saved.example/v1',
                    temp_openai: 0.7,
                    // Max Tokens 128000 (the last save below) has to stay under the context length
                    openai_max_context: 200000,
                    openai_max_tokens: 300,
                    top_p_openai: 0.9,
                    freq_pen_openai: 0.1,
                    pres_pen_openai: 0.2,
                },
            }),
            textgenerationwebui_preset_names: [],
            textgenerationwebui_presets: [],
            openai_setting_names: [],
            openai_settings: [],
        };

        await mockModernApiShell(page, settingsBundle);
        await page.route('**/api/settings/save', route => {
            savedBodies.push(route.request().postDataJSON());
            settingsBundle.settings = JSON.stringify(savedBodies.at(-1));
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        });
        await page.route('**/api/backends/chat-completions/generate', route => {
            generateBodies.push(route.request().postDataJSON());
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) });
        });

        await page.goto('/modern/?view=api');
        await expect(page.locator('[data-api-top-p]')).toHaveValue('0.9');
        // The inputs expose the same limits as the legacy sliders.
        await expect(page.locator('[data-api-top-p]')).toHaveAttribute('max', '1');
        await expect(page.locator('[data-api-temperature]')).toHaveAttribute('max', '2');
        await expect(page.locator('[data-api-frequency-penalty]')).toHaveAttribute('min', '-2');
        await expect(page.locator('[data-api-max-tokens]')).toHaveAttribute('max', '128000');

        await page.locator('[data-api-model]').fill('custom/new-model');
        await page.locator('[data-api-top-p]').fill('5');
        await page.locator('[data-api-temperature]').fill('2.5');
        await page.locator('[data-api-presence-penalty]').fill('-3');
        await page.locator('[data-api-max-tokens]').fill('12.5');
        await page.locator('[data-save-api-connection]').click();

        const topPError = page.locator('[data-api-field-error="topP"]');
        await expect(topPError).toHaveText('Top P 需在 0 到 1 之间');
        await expect(page.locator('[data-api-top-p]')).toHaveAttribute('aria-invalid', 'true');
        await expect(page.locator('[data-api-top-p]')).toHaveAttribute('aria-describedby', 'api-field-error-topP');
        await expect(page.locator('[data-api-field-error="temperature"]')).toHaveText('Temperature 需在 0 到 2 之间');
        await expect(page.locator('[data-api-field-error="presencePenalty"]')).toHaveText('Presence Penalty 需在 -2 到 2 之间');
        await expect(page.locator('[data-api-field-error="maxTokens"]')).toHaveText('Max Tokens 需为 1 到 128000 之间的整数');
        await expect(page.locator('[data-api-field-error="frequencyPenalty"]')).toHaveCount(0);
        await expect(page.locator('.toast', { hasText: '连接配置未保存' })).toContainText('Temperature 需在 0 到 2 之间');
        await expect(page.locator('.toast', { hasText: '连接配置已保存' })).toHaveCount(0);
        // The user's edits stay in the form so they can be corrected.
        await expect(page.locator('[data-api-model]')).toHaveValue('custom/new-model');
        await expect(page.locator('[data-api-top-p]')).toHaveValue('5');
        await expect(page.locator('[data-api-temperature]')).toBeFocused();

        // Enter in a field takes the same validated path instead of the browser's native bubble.
        await page.locator('[data-api-model]').press('Enter');
        await expect(topPError).toHaveText('Top P 需在 0 到 1 之间');

        // Testing the connection does not send out-of-range parameters either.
        await page.locator('[data-test-api]').click();
        await expect(page.locator('.toast', { hasText: '连接测试未执行' })).toBeVisible();
        expect(generateBodies).toEqual([]);
        expect(savedBodies).toEqual([]);

        // Correcting a marked field hides its error as soon as it changes, without shifting the layout.
        const saveButton = page.locator('[data-save-api-connection]');
        const saveButtonTop = (await saveButton.boundingBox()).y;
        await page.locator('[data-api-top-p]').fill('0.5');
        await page.locator('[data-api-top-p]').blur();
        await expect(topPError).toBeHidden();
        await expect(page.locator('[data-api-top-p]')).not.toHaveAttribute('aria-invalid', 'true');
        expect((await saveButton.boundingBox()).y).toBe(saveButtonTop);
        await page.locator('[data-api-temperature]').fill('');
        await page.locator('[data-api-temperature]').blur();
        await expect(page.locator('[data-api-field-error="temperature"]')).toHaveText('请填写 Temperature');

        await page.locator('[data-api-temperature]').fill('2');
        await page.locator('[data-api-presence-penalty]').fill('-2');
        await page.locator('[data-api-max-tokens]').fill('128000');
        // The last field still has focus: its change fires on mousedown, and the click must still land on the button.
        await saveButton.click();

        await expect.poll(() => savedBodies.length).toBe(1);
        expect(savedBodies[0].oai_settings).toMatchObject({
            custom_model: 'custom/new-model',
            temp_openai: 2,
            openai_max_tokens: 128000,
            top_p_openai: 0.5,
            freq_pen_openai: 0.1,
            pres_pen_openai: -2,
        });
        await expect(page.locator('.toast', { hasText: '连接配置已保存' })).toBeVisible();
        await expect(page.locator('.field-error')).toHaveCount(0);
    });

    test('treats a reasoning-only chat completion test reply as a working connection', async ({ page }) => {
        const generateBodies = [];
        const generateResponses = [
            // Reasoning model spent the whole test token budget on reasoning (DeepSeek-style payload).
            {
                choices: [{
                    message: { role: 'assistant', content: '', reasoning_content: 'The user wants me to reply OK, so' },
                    finish_reason: 'length',
                }],
            },
            // Truly empty reply without any reasoning is still a failure.
            {
                choices: [{
                    message: { role: 'assistant', content: '' },
                    finish_reason: 'stop',
                }],
            },
            // Backend error payloads keep their original message.
            {
                error: { message: 'Unauthorized' },
            },
        ];
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'openai',
                oai_settings: {
                    chat_completion_source: 'custom',
                    custom_model: 'deepseek-v4-flash',
                    custom_url: 'https://api.deepseek.com',
                    openai_max_tokens: 300,
                },
            }),
            textgenerationwebui_preset_names: [],
            textgenerationwebui_presets: [],
            openai_setting_names: [],
            openai_settings: [],
        };

        await mockModernApiShell(page, settingsBundle, {
            api_key_custom: [{ id: 'saved', value: '********seek', label: 'saved', active: true }],
        });

        await page.route('**/api/backends/chat-completions/generate', route => {
            generateBodies.push(route.request().postDataJSON());
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(generateResponses[generateBodies.length - 1]),
            });
        });

        await page.goto('/modern/?view=api');
        await expect(page.locator('[data-api-source]')).toHaveValue('custom');
        await expect(page.locator('[data-api-model]')).toHaveValue('deepseek-v4-flash');

        const historyRows = page.locator('.api-history-panel .resource-row');
        const reasoningOnlyDetail = '连接正常：模型只返回了推理内容（测试请求的 token 上限较低）';

        await page.locator('[data-test-api]').click();
        await expect(page.locator('.toast', { hasText: '连接测试成功' })).toContainText(reasoningOnlyDetail);
        await expect(historyRows).toHaveCount(1);
        await expect(historyRows.nth(0)).toContainText(`deepseek-v4-flash: ${reasoningOnlyDetail}`);
        await expect(historyRows.nth(0).locator('.success')).toHaveText('可用');
        expect(generateBodies[0]).toMatchObject({
            chat_completion_source: 'custom',
            model: 'deepseek-v4-flash',
            custom_url: 'https://api.deepseek.com',
            max_tokens: 20,
            stream: false,
        });

        await page.locator('[data-test-api]').click();
        await expect(page.locator('.toast', { hasText: '连接测试失败' })).toContainText('模型没有返回可显示内容。');
        await expect(historyRows).toHaveCount(2);
        await expect(historyRows.nth(0)).toContainText('模型没有返回可显示内容。');
        await expect(historyRows.nth(0).locator('.danger')).toHaveText('失败');

        await page.locator('[data-test-api]').click();
        await expect(page.locator('.toast', { hasText: '连接测试失败' }).filter({ hasText: 'Unauthorized' })).toBeVisible();
        await expect(historyRows).toHaveCount(3);
        await expect(historyRows.nth(0)).toContainText('Unauthorized');
        await expect(historyRows.nth(0).locator('.danger')).toHaveText('失败');
        expect(generateBodies).toHaveLength(3);
    });

    test('keeps supported chat completion sources outside the short list', async ({ page }) => {
        let savedSettings = null;
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'openai',
                oai_settings: {
                    chat_completion_source: 'aimlapi',
                    aimlapi_model: 'aimlapi/saved-model',
                },
            }),
            textgenerationwebui_preset_names: [],
            textgenerationwebui_presets: [],
            openai_setting_names: [],
            openai_settings: [],
        };

        await mockModernApiShell(page, settingsBundle);
        await page.route('**/api/settings/save', route => {
            savedSettings = route.request().postDataJSON();
            settingsBundle.settings = JSON.stringify(savedSettings);
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true }),
            });
        });

        await page.goto('/modern/?view=api');

        await expect(page.locator('[data-api-source]')).toHaveValue('aimlapi');
        await expect(page.locator('[data-api-model]')).toHaveValue('aimlapi/saved-model');
        await page.locator('[data-api-model]').fill('aimlapi/new-model');
        await page.locator('[data-save-api-connection]').click();

        await expect.poll(() => savedSettings?.oai_settings?.aimlapi_model).toBe('aimlapi/new-model');
        expect(savedSettings.chat_completion_source).toBe('aimlapi');
        expect(savedSettings.oai_settings.chat_completion_source).toBe('aimlapi');
    });

    test('edits and tests text completion connection without exposing secrets', async ({ page }) => {
        let savedSettings = null;
        let writtenSecret = null;
        let statusBody = null;
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'textgenerationwebui',
                textgenerationwebui_settings: {
                    type: 'openrouter',
                    server_urls: {
                        openrouter: 'https://openrouter.ai/api',
                    },
                    openrouter_model: 'openrouter/auto',
                    preset: 'Text Preset A',
                    temp: 0.7,
                    top_p: 0.5,
                    top_k: 40,
                    min_p: 0.01,
                    rep_pen: 1.2,
                    rep_pen_range: 0,
                },
            }),
            textgenerationwebui_preset_names: ['Text Preset A', 'Text Preset B'],
            textgenerationwebui_presets: [
                JSON.stringify({ temp: 0.7 }),
                JSON.stringify({ temp: 0.8 }),
            ],
            openai_setting_names: [],
            openai_settings: [],
        };

        await mockModernApiShell(page, settingsBundle, {
            api_key_openrouter: [{ id: 'saved', value: '********ret', label: 'saved', active: true }],
        });

        await page.route('**/api/secrets/write', route => {
            writtenSecret = route.request().postDataJSON();
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true }),
            });
        });

        await page.route('**/api/settings/save', route => {
            savedSettings = route.request().postDataJSON();
            settingsBundle.settings = JSON.stringify(savedSettings);
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true }),
            });
        });

        await page.route('**/api/backends/text-completions/status', route => {
            statusBody = route.request().postDataJSON();
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ result: 'openrouter/new-model', data: [{ id: 'openrouter/new-model' }] }),
            });
        });

        await page.goto('/modern/?view=api');

        await expect(page.locator('[data-textgen-type]')).toHaveValue('openrouter');
        await expect(page.locator('[data-textgen-endpoint]')).toHaveValue('https://openrouter.ai/api');
        await expect(page.locator('[data-textgen-model]')).toHaveValue('openrouter/auto');
        await expect(page.locator('[data-textgen-sampling="temp"]')).toHaveValue('0.7');
        await expect(page.locator('[data-textgen-sampling="top_p"]')).toHaveValue('0.5');
        await expect(page.locator('[data-textgen-sampling="top_k"]')).toHaveValue('40');
        await expect(page.locator('[data-textgen-sampling="min_p"]')).toHaveValue('0.01');
        await expect(page.locator('[data-textgen-sampling="rep_pen"]')).toHaveValue('1.2');
        await expect(page.locator('[data-textgen-sampling="rep_pen_range"]')).toHaveValue('0');
        await expect(page.locator('[data-textgen-secret-status]')).toHaveText('密钥已保存');
        await expect(page.locator('body')).not.toContainText('sk-secret');
        await expect(page.locator('form[data-api-connection-form] [data-textgen-api-key]')).toHaveCount(1);
        await expect(page.locator('[data-textgen-api-key]')).toHaveAttribute('name', 'text_completion_api_key');
        await expect(page.locator('[data-textgen-api-key]')).toHaveAttribute('autocomplete', 'new-password');
        await expect(page.locator('[data-save-api-connection]')).toHaveAttribute('type', 'submit');

        await page.locator('[data-textgen-endpoint]').fill('https://openrouter.ai/api/v1');
        await page.locator('[data-textgen-model]').fill('openrouter/new-model');
        await page.locator('[data-textgen-preset]').selectOption('Text Preset B');
        await page.locator('[data-textgen-sampling="temp"]').fill('0.82');
        await page.locator('[data-textgen-sampling="top_p"]').fill('0.91');
        await page.locator('[data-textgen-sampling="top_k"]').fill('64');
        await page.locator('[data-textgen-sampling="min_p"]').fill('0.04');
        await page.locator('[data-textgen-sampling="rep_pen"]').fill('1.08');
        await page.locator('[data-textgen-sampling="rep_pen_range"]').fill('256');
        await page.locator('[data-textgen-api-key]').fill('sk-secret-textgen');
        await page.locator('[data-save-api-connection]').click();

        await expect.poll(() => savedSettings?.textgenerationwebui_settings?.openrouter_model).toBe('openrouter/new-model');
        expect(savedSettings.main_api).toBe('textgenerationwebui');
        expect(savedSettings.textgenerationwebui_settings.type).toBe('openrouter');
        expect(savedSettings.textgenerationwebui_settings.server_urls.openrouter).toBe('https://openrouter.ai/api/v1');
        expect(savedSettings.textgenerationwebui_settings.preset).toBe('Text Preset B');
        expect(savedSettings.textgenerationwebui_settings).toMatchObject({
            temp: 0.82,
            top_p: 0.91,
            top_k: 64,
            min_p: 0.04,
            rep_pen: 1.08,
            rep_pen_range: 256,
        });
        expect(writtenSecret).toMatchObject({
            key: 'api_key_openrouter',
            value: 'sk-secret-textgen',
        });
        await expect(page.locator('body')).not.toContainText('sk-secret-textgen');

        await page.locator('[data-test-api]').click();

        await expect.poll(() => statusBody).toMatchObject({
            api_server: 'https://openrouter.ai/api/v1',
            api_type: 'openrouter',
        });
        await expect(page.locator('.api-history-panel')).toContainText('openrouter/new-model');
    });

    test('saves every legacy text completion type with its model and secret mapping', async ({ page }) => {
        let savedSettings = null;
        const writtenSecrets = [];
        const settingsBundle = {
            settings: '',
            textgenerationwebui_preset_names: ['Text Preset A'],
            textgenerationwebui_presets: [
                JSON.stringify({ temp: 0.7 }),
            ],
            openai_setting_names: [],
            openai_settings: [],
        };

        await mockModernApiShell(page, settingsBundle);

        await page.route('**/api/secrets/write', route => {
            writtenSecrets.push(route.request().postDataJSON());
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true }),
            });
        });

        await page.route('**/api/settings/save', route => {
            savedSettings = route.request().postDataJSON();
            settingsBundle.settings = JSON.stringify(savedSettings);
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true }),
            });
        });

        for (const [index, item] of textCompletionCases.entries()) {
            const savedTextgen = {
                type: item.type,
                server_urls: {
                    [item.type]: `http://127.0.0.1:${9100 + index}/saved`,
                },
                preset: 'Text Preset A',
                ...item.modelSettings,
            };

            savedSettings = null;
            writtenSecrets.length = 0;
            settingsBundle.settings = JSON.stringify({
                main_api: 'textgenerationwebui',
                textgenerationwebui_settings: savedTextgen,
            });

            await page.goto('/modern/?view=api');
            await expect(page.locator('[data-textgen-type]')).toBeVisible();

            const typeOptions = await page.locator('[data-textgen-type] option').evaluateAll(options => options.map(option => option.value));
            expect([...typeOptions].sort()).toEqual(textCompletionCases.map(({ type }) => type).sort());
            await expect(page.locator('[data-textgen-type]')).toHaveValue(item.type);
            await expect(page.locator('[data-textgen-endpoint]')).toHaveValue(savedTextgen.server_urls[item.type]);
            await expect(page.locator('[data-textgen-model]')).toHaveValue(item.initialModel);

            const newEndpoint = `http://127.0.0.1:${9200 + index}/${item.type}`;
            await page.locator('[data-textgen-endpoint]').fill(newEndpoint);
            await page.locator('[data-textgen-preset]').selectOption('Text Preset A');
            await page.locator('[data-textgen-model]').fill(item.modelValue);
            await page.locator('[data-textgen-api-key]').evaluate(setInputValue, item.secretValue);
            await page.locator('[data-save-api-connection]').click();

            await expect.poll(() => savedSettings?.textgenerationwebui_settings?.type).toBe(item.type);
            expect(savedSettings.main_api).toBe('textgenerationwebui');
            expect(savedSettings.textgenerationwebui_settings).toMatchObject({
                type: item.type,
                preset: 'Text Preset A',
                server_urls: {
                    [item.type]: newEndpoint,
                },
                ...item.expectedModelSettings,
            });
            expect(savedSettings.textgenerationwebui_settings).not.toHaveProperty('model');
            expect(writtenSecrets.map(({ key, value }) => ({ key, value }))).toEqual(item.expectedSecretWrites);
        }
    });

    test('refreshes text completion fields when switching source in the modern editor', async ({ page }) => {
        let savedSettings = null;
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'textgenerationwebui',
                textgenerationwebui_settings: {
                    type: 'openrouter',
                    server_urls: {
                        openrouter: 'https://openrouter.ai/api',
                        ollama: 'http://127.0.0.1:11434',
                    },
                    openrouter_model: 'openrouter/auto',
                    ollama_model: 'llama3.1',
                    preset: 'Text Preset A',
                },
            }),
            textgenerationwebui_preset_names: ['Text Preset A'],
            textgenerationwebui_presets: [JSON.stringify({ temp: 0.7 })],
            openai_setting_names: [],
            openai_settings: [],
        };

        await mockModernApiShell(page, settingsBundle, {
            api_key_openrouter: [{ id: 'saved', value: '********ret', label: 'saved', active: true }],
        });

        await page.route('**/api/settings/save', route => {
            savedSettings = route.request().postDataJSON();
            settingsBundle.settings = JSON.stringify(savedSettings);
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ok: true }),
            });
        });

        await page.goto('/modern/?view=api');

        await expect(page.locator('[data-textgen-type]')).toHaveValue('openrouter');
        await expect(page.locator('[data-textgen-endpoint]')).toHaveValue('https://openrouter.ai/api');
        await expect(page.locator('[data-textgen-model]')).toHaveValue('openrouter/auto');
        await expect(page.locator('[data-textgen-secret-status]')).toHaveText('密钥已保存');

        await page.locator('[data-textgen-type]').selectOption('ollama');

        await expect(page.locator('[data-textgen-endpoint]')).toHaveValue('http://127.0.0.1:11434');
        await expect(page.locator('[data-textgen-model]')).toHaveValue('llama3.1');
        await expect(page.locator('[data-textgen-secret-status]')).toHaveText('无密钥字段');
        await expect(page.locator('[data-textgen-field="api-key"]')).toBeHidden();

        await page.locator('[data-textgen-endpoint]').fill('http://127.0.0.1:11435');
        await page.locator('[data-textgen-model]').fill('llama3.2');
        await page.locator('[data-save-api-connection]').click();

        await expect.poll(() => savedSettings?.textgenerationwebui_settings?.type).toBe('ollama');
        expect(savedSettings.textgenerationwebui_settings).toMatchObject({
            type: 'ollama',
            ollama_model: 'llama3.2',
            server_urls: {
                openrouter: 'https://openrouter.ai/api',
                ollama: 'http://127.0.0.1:11435',
            },
        });
        expect(savedSettings.textgenerationwebui_settings.openrouter_model).toBe('openrouter/auto');
    });
});

// 上下文长度（openai_max_context）此前在现代页任何地方都不能改，实际一直是旧版默认的 4095。
// 范围按来源、模型和「解锁上限」变化，对齐旧版 onModelChange；提示词预算 = 上下文 − Max Tokens。
test.describe('Modern API context length', () => {
    const chatBundle = (oaiSettings = {}) => ({
        settings: JSON.stringify({
            main_api: 'openai',
            oai_settings: {
                chat_completion_source: 'custom',
                custom_model: 'custom/saved-model',
                custom_url: 'https://saved.example/v1',
                openai_max_context: 4095,
                openai_max_tokens: 300,
                ...oaiSettings,
            },
        }),
        textgenerationwebui_preset_names: [],
        textgenerationwebui_presets: [],
        openai_setting_names: ['Chat Preset A'],
        openai_settings: [JSON.stringify({ name: 'Chat Preset A', openai_max_context: 4095 })],
    });

    async function routeSettingsSave(page, settingsBundle, order = []) {
        const saved = { bodies: [] };
        await page.route('**/api/settings/save', route => {
            const body = route.request().postDataJSON();
            saved.bodies.push(body);
            settingsBundle.settings = JSON.stringify(body);
            order.push('settings saved');
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        });
        return saved;
    }

    test('saves a larger context length and the unlock flag, then reloads the engine settings', async ({ page }) => {
        const order = [];
        const settingsBundle = chatBundle();
        const bridgeCalls = await mockModernApiShell(page, settingsBundle, {}, {
            replies: { reloadSettings: () => { order.push('engine reloaded'); } },
        });
        const saved = await routeSettingsSave(page, settingsBundle, order);

        await page.goto('/modern/?view=api');

        const contextInput = page.locator('[data-api-max-context]');
        const hint = page.locator('[data-api-context-hint]');
        // Without the field the budget was fixed at 4095 - 300 = 3795 tokens
        await expect(contextInput).toHaveValue('4095');
        await expect(contextInput).toHaveAttribute('min', '512');
        await expect(contextInput).toHaveAttribute('max', '2000000');
        await expect(hint).toContainText('上限 2,000,000');
        await expect(hint).toContainText('提示词预算 = 上下文 − Max Tokens（当前 3,795）');
        await expect(page.locator('[data-api-max-context-unlocked]')).not.toBeChecked();

        await contextInput.fill('32000');
        await page.locator('[data-save-api-connection]').click();

        await expect.poll(() => saved.bodies.at(-1)?.oai_settings?.openai_max_context).toBe(32000);
        expect(saved.bodies.at(-1).oai_settings).toMatchObject({ max_context_unlocked: false, openai_max_tokens: 300 });
        // The engine is told to reload after the file is written, not before
        await expect.poll(() => order).toEqual(['settings saved', 'engine reloaded']);
        expect(bridgeCalls.map(call => call.action)).toContain('reloadSettings');
        await expect(page.locator('.toast', { hasText: '连接配置已保存' })).toBeVisible();
        await expect(contextInput).toHaveValue('32000');
        await expect(hint).toContainText('（当前 31,700）');
    });

    test('the allowed range follows the source, the model and the unlock checkbox', async ({ page }) => {
        const settingsBundle = chatBundle({
            chat_completion_source: 'openai',
            openai_model: 'gpt-4o',
            deepseek_model: 'deepseek-chat',
            openrouter_model: 'openai/gpt-4.1',
        });
        await mockModernApiShell(page, settingsBundle);

        await page.goto('/modern/?view=api');

        const contextInput = page.locator('[data-api-max-context]');
        const hint = page.locator('[data-api-context-hint]');
        await expect(contextInput).toHaveAttribute('max', '128000');
        await expect(hint).toContainText('上限 128,000；提示词预算 = 上下文 − Max Tokens');

        // Typing another model refreshes the limit when the field loses focus
        await page.locator('[data-api-model]').fill('gpt-4');
        await page.locator('[data-api-model]').blur();
        await expect(contextInput).toHaveAttribute('max', '8191');
        await expect(hint).toContainText('上限 8,191');

        await page.locator('[data-api-max-context-unlocked]').check();
        await expect(contextInput).toHaveAttribute('max', '2000000');
        await expect(hint).toContainText('已解锁，上限 2,000,000');
        await page.locator('[data-api-max-context-unlocked]').uncheck();
        await expect(contextInput).toHaveAttribute('max', '8191');

        // A model suggestion fills the model without a change event, the limit still follows
        await page.locator('[data-api-model-suggestion="gpt-4.1"]').click();
        await expect(page.locator('[data-api-model]')).toHaveValue('gpt-4.1');
        await expect(contextInput).toHaveAttribute('max', '1000000');

        await page.locator('[data-api-source]').selectOption('deepseek');
        await expect(page.locator('[data-api-model]')).toHaveValue('deepseek-chat');
        await expect(contextInput).toHaveAttribute('max', '1000000');
        await page.locator('[data-api-max-context-unlocked]').check();
        await expect(contextInput).toHaveAttribute('max', '2000000');
        await page.locator('[data-api-max-context-unlocked]').uncheck();

        // The remote model list decides here: the page can only offer the legacy fallback as a reference
        await page.locator('[data-api-source]').selectOption('openrouter');
        await expect(hint).toContainText('参考上限 128,000');
        await expect(hint).toContainText('旧版可能按实际模型再收紧');
        await expect(contextInput).toHaveAttribute('max', '2000000');

        await page.locator('[data-api-source]').selectOption('custom');
        await expect(hint).toContainText('上限 2,000,000（该来源固定，不受“解锁上限”影响）');
        await expect(contextInput).toHaveAttribute('max', '2000000');
    });

    test('blocks saving and testing when the context length is out of range or Max Tokens is not below it', async ({ page }) => {
        const settingsBundle = chatBundle({ chat_completion_source: 'openai', openai_model: 'gpt-4' });
        const generateBodies = [];
        await mockModernApiShell(page, settingsBundle);
        const saved = await routeSettingsSave(page, settingsBundle);
        await page.route('**/api/backends/chat-completions/generate', route => {
            generateBodies.push(route.request().postDataJSON());
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) });
        });

        await page.goto('/modern/?view=api');

        const contextInput = page.locator('[data-api-max-context]');
        const contextError = page.locator('[data-api-field-error="maxContext"]');
        const maxTokensError = page.locator('[data-api-field-error="maxTokens"]');

        // gpt-4 only has an 8k window in the legacy limits
        await contextInput.fill('100000');
        await page.locator('[data-save-api-connection]').click();
        await expect(contextError).toHaveText('上下文长度 需为 512 到 8,191 之间的整数（模型确实支持更长上下文时，可勾选“解锁上限”放宽到 2,000,000）');
        await expect(contextInput).toHaveAttribute('aria-invalid', 'true');
        await expect(contextInput).toHaveAttribute('aria-describedby', 'api-field-error-maxContext');
        await expect(page.locator('.toast', { hasText: '连接配置未保存' })).toContainText('上下文长度 需为 512 到 8,191');
        await expect(contextInput).toBeFocused();

        // The same check guards the connection test, which must not send out-of-range settings either
        await page.locator('[data-test-api]').click();
        await expect(page.locator('.toast', { hasText: '连接测试未执行' })).toBeVisible();
        expect(generateBodies).toEqual([]);
        expect(saved.bodies).toEqual([]);

        // Lowering the field clears its error; Max Tokens that fills the whole context is the next problem
        await contextInput.fill('5000');
        await page.locator('[data-api-max-tokens]').fill('6000');
        await page.locator('[data-save-api-connection]').click();
        await expect(maxTokensError).toHaveText('Max Tokens 需小于上下文长度（5,000），否则没有空间放提示词');
        await expect(page.locator('[data-api-max-tokens]')).toHaveAttribute('aria-invalid', 'true');
        await expect(contextError).toBeHidden();
        expect(saved.bodies).toEqual([]);

        // Raising the context length answers the Max Tokens error without touching that field
        await contextInput.fill('8000');
        await contextInput.blur();
        await expect(maxTokensError).toBeHidden();
        await expect(page.locator('[data-api-max-tokens]')).not.toHaveAttribute('aria-invalid', 'true');

        await page.locator('[data-save-api-connection]').click();
        await expect.poll(() => saved.bodies.length).toBe(1);
        expect(saved.bodies[0].oai_settings).toMatchObject({ openai_max_context: 8000, openai_max_tokens: 6000, openai_model: 'gpt-4' });
        // The toast comes after the page re-rendered with the saved values, so later edits are not overwritten
        await expect(page.locator('.toast', { hasText: '连接配置已保存' })).toBeVisible();
        await expect(page.locator('.field-error:visible')).toHaveCount(0);

        // Unlocking lifts the model limit
        await contextInput.fill('100000');
        await page.locator('[data-api-max-context-unlocked]').check();
        await page.locator('[data-save-api-connection]').click();
        await expect.poll(() => saved.bodies.length).toBe(2);
        expect(saved.bodies[1].oai_settings).toMatchObject({ openai_max_context: 100000, max_context_unlocked: true });
    });

    test('edits the text completion context length, response length and unlock flag', async ({ page }) => {
        const order = [];
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'textgenerationwebui',
                max_context: 8192,
                amount_gen: 350,
                power_user: { max_context_unlocked: false, keep_me: 'untouched' },
                textgenerationwebui_settings: {
                    type: 'ooba',
                    server_urls: { ooba: 'http://127.0.0.1:5000' },
                    custom_model: 'ooba/saved-model',
                },
            }),
            textgenerationwebui_preset_names: [],
            textgenerationwebui_presets: [],
            openai_setting_names: [],
            openai_settings: [],
        };
        const bridgeCalls = await mockModernApiShell(page, settingsBundle, {}, {
            replies: { reloadSettings: () => { order.push('engine reloaded'); } },
        });
        const saved = await routeSettingsSave(page, settingsBundle, order);

        await page.goto('/modern/?view=api');

        const contextInput = page.locator('[data-textgen-max-context]');
        const responseInput = page.locator('[data-textgen-amount-gen]');
        const hint = page.locator('[data-textgen-context-hint]');
        const unlocked = page.locator('[data-textgen-max-context-unlocked]');
        await expect(contextInput).toHaveValue('8192');
        await expect(responseInput).toHaveValue('350');
        await expect(unlocked).not.toBeChecked();
        await expect(hint).toContainText('上下文 512 到 8,192，回复 16 到 2,048');
        await expect(hint).toContainText('提示词预算 = 上下文 − 回复长度（当前 7,842）');

        // Locked: 16384 is beyond the legacy slider, so nothing is written
        await contextInput.fill('16384');
        await responseInput.fill('99999');
        await page.locator('[data-save-api-connection]').click();
        await expect(page.locator('[data-api-field-error="textMaxContext"]')).toHaveText('上下文长度 需为 512 到 8,192 之间的整数（模型确实支持更长时，可勾选“解锁上限”放宽）');
        await expect(page.locator('[data-api-field-error="textAmountGen"]')).toContainText('回复长度 需为 16 到 2,048 之间的整数');
        await expect(page.locator('.toast', { hasText: '文本补全连接未保存' })).toBeVisible();
        expect(saved.bodies).toEqual([]);

        // Unlocking widens both ranges and re-judges the visible errors
        await unlocked.check();
        await expect(hint).toContainText('已解锁');
        await expect(page.locator('[data-api-field-error="textMaxContext"]')).toBeHidden();
        await expect(page.locator('[data-api-field-error="textAmountGen"]')).toContainText('16 到 65,536');

        // The reply cannot fill the whole context
        await responseInput.fill('20000');
        await page.locator('[data-save-api-connection]').click();
        await expect(page.locator('[data-api-field-error="textAmountGen"]')).toHaveText('回复长度 需小于上下文长度（16,384），否则没有空间放提示词');
        expect(saved.bodies).toEqual([]);

        await responseInput.fill('4096');
        await page.locator('[data-save-api-connection]').click();

        await expect.poll(() => saved.bodies.length).toBe(1);
        expect(saved.bodies[0]).toMatchObject({
            main_api: 'textgenerationwebui',
            max_context: 16384,
            amount_gen: 4096,
            power_user: { max_context_unlocked: true, keep_me: 'untouched' },
        });
        await expect.poll(() => order).toEqual(['settings saved', 'engine reloaded']);
        expect(bridgeCalls.map(call => call.action)).toContain('reloadSettings');
        await expect(contextInput).toHaveValue('16384');
        await expect(unlocked).toBeChecked();
    });

    test('saving the current configuration as a preset keeps the context length and unlock flag', async ({ page }) => {
        const settingsBundle = chatBundle({
            preset_settings_openai: 'Chat Preset A',
            openai_max_context: 32000,
            max_context_unlocked: true,
            siliconflow_model: 'ignored',
        });
        let presetSave = null;
        await mockModernApiShell(page, settingsBundle);
        await routeSettingsSave(page, settingsBundle);
        await page.route('**/api/presets/save', route => {
            presetSave = route.request().postDataJSON();
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: presetSave.name }) });
        });

        await page.goto('/modern/?view=presets');
        await page.locator('[data-select-preset="Chat Preset A"][data-preset-api="openai"]').click();
        await page.locator('[data-save-openai-preset]').click();

        // The stored preset still says 4095, which is what applying it would write back over the setting
        await expect.poll(() => presetSave?.preset?.openai_max_context).toBe(32000);
        expect(presetSave).toMatchObject({ apiId: 'openai', name: 'Chat Preset A', overwrite: true });
        expect(presetSave.preset).toMatchObject({ openai_max_context: 32000, max_context_unlocked: true, openai_max_tokens: 300 });
    });
});

// Saving a connection used to leave the hidden generation engine on its boot-time settings, and the engine only learned
// about a preset or connection change through unrelated reloads. Each of the five editors must now wait for the engine to
// reload before it refreshes the page state and reports the save.
test.describe('Modern API engine sync', () => {
    const chatCompletionBundle = () => ({
        settings: JSON.stringify({
            main_api: 'openai',
            oai_settings: {
                chat_completion_source: 'custom',
                custom_model: 'custom/saved-model',
                custom_url: 'https://saved.example/v1',
                preset_settings_openai: 'Chat Preset A',
                temp_openai: 0.7,
                openai_max_tokens: 300,
                top_p_openai: 0.9,
                freq_pen_openai: 0.1,
                pres_pen_openai: 0.2,
            },
        }),
        textgenerationwebui_preset_names: [],
        textgenerationwebui_presets: [],
        openai_setting_names: ['Chat Preset A'],
        openai_settings: [JSON.stringify({ name: 'Chat Preset A' })],
    });
    const emptyPresets = {
        textgenerationwebui_preset_names: [],
        textgenerationwebui_presets: [],
        openai_setting_names: [],
        openai_settings: [],
    };
    const saveCases = [
        {
            name: 'chat completion',
            bundle: chatCompletionBundle,
            toast: '连接配置已保存',
            edit: page => page.locator('[data-api-model]').fill('custom/new-model'),
            expectSaved: saved => expect(saved.oai_settings.custom_model).toBe('custom/new-model'),
        },
        {
            name: 'text completion',
            bundle: () => ({
                settings: JSON.stringify({
                    main_api: 'textgenerationwebui',
                    textgenerationwebui_settings: {
                        type: 'openrouter',
                        server_urls: { openrouter: 'https://openrouter.ai/api' },
                        openrouter_model: 'openrouter/auto',
                        preset: 'Text Preset A',
                        temp: 0.7,
                        top_p: 0.5,
                        top_k: 40,
                        min_p: 0.01,
                        rep_pen: 1.2,
                        rep_pen_range: 0,
                    },
                }),
                ...emptyPresets,
                textgenerationwebui_preset_names: ['Text Preset A'],
                textgenerationwebui_presets: [JSON.stringify({ temp: 0.7 })],
            }),
            toast: '文本补全连接已保存',
            edit: page => page.locator('[data-textgen-model]').fill('openrouter/new-model'),
            expectSaved: saved => expect(saved.textgenerationwebui_settings.openrouter_model).toBe('openrouter/new-model'),
        },
        {
            name: 'KoboldAI',
            bundle: () => ({ settings: JSON.stringify({ main_api: 'kobold', api_server: 'http://saved.kobold:5000/api' }), ...emptyPresets }),
            toast: 'KoboldAI 连接已保存',
            edit: page => page.locator('[data-kobold-api-url]').fill('http://new.kobold:5001/api'),
            expectSaved: saved => expect(saved.api_server).toBe('http://new.kobold:5001/api'),
        },
        {
            name: 'NovelAI',
            bundle: () => ({ settings: JSON.stringify({ main_api: 'novel', model_novel: 'kayra-v1' }), ...emptyPresets }),
            toast: 'NovelAI 连接已保存',
            edit: page => page.locator('[data-novel-model]').selectOption('llama-3-erato-v1'),
            expectSaved: saved => expect(saved.model_novel).toBe('llama-3-erato-v1'),
        },
        {
            name: 'AI Horde',
            bundle: () => ({ settings: JSON.stringify({ main_api: 'koboldhorde', horde_settings: { models: ['koboldcpp/model-a'] } }), ...emptyPresets }),
            toast: 'AI Horde 连接已保存',
            routes: page => page.route('**/api/horde/text-models', route => route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([{ name: 'koboldcpp/model-a', count: 3, performance: 12.4 }, { name: 'koboldcpp/model-b', count: 1, performance: 5.1 }]),
            })),
            edit: async page => {
                await expect(page.locator('[data-horde-model] option[value="koboldcpp/model-b"]')).toHaveCount(1);
                await page.locator('[data-horde-model]').selectOption(['koboldcpp/model-a', 'koboldcpp/model-b']);
            },
            expectSaved: saved => expect(saved.horde_settings.models).toEqual(['koboldcpp/model-a', 'koboldcpp/model-b']),
        },
    ];

    async function routeSettingsSave(page, settingsBundle, sequence) {
        const saved = { settings: null };
        await page.route('**/api/settings/save', route => {
            saved.settings = route.request().postDataJSON();
            settingsBundle.settings = JSON.stringify(saved.settings);
            sequence.push('settings saved');
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        });
        return saved;
    }

    for (const saveCase of saveCases) {
        test(`${saveCase.name}: the save waits for the engine reload before refreshing and reporting`, async ({ page }) => {
            const settingsBundle = saveCase.bundle();
            const sequence = [];
            let settingsReads = 0;
            let releaseReload = () => {};
            const reloadGate = new Promise(resolve => {
                releaseReload = resolve;
            });
            const bridgeCalls = await mockModernApiShell(page, settingsBundle, {}, {
                replies: {
                    reloadSettings: async () => {
                        sequence.push('engine reload started');
                        await reloadGate;
                        sequence.push('engine reload finished');
                    },
                },
            });
            await page.route('**/api/settings/get', route => {
                settingsReads++;
                return route.fallback();
            });
            const saved = await routeSettingsSave(page, settingsBundle, sequence);
            await saveCase.routes?.(page);

            await page.goto('/modern/?view=api');
            await expect(page.locator('[data-save-api-connection]')).toBeVisible();
            await saveCase.edit(page);
            await page.locator('[data-save-api-connection]').click();

            // The engine is asked only after the settings are on disk
            await expect.poll(() => sequence).toEqual(['settings saved', 'engine reload started']);
            saveCase.expectSaved(saved.settings);
            const readsWhileWaiting = settingsReads;
            // Intentional wait: the assertion is that neither the toast nor the page refresh happens while the engine is still reloading
            // eslint-disable-next-line playwright/no-wait-for-timeout
            await page.waitForTimeout(700);
            expect(await page.locator('.toast', { hasText: saveCase.toast }).count()).toBe(0);
            expect(settingsReads).toBe(readsWhileWaiting);

            releaseReload();
            await expect(page.locator('.toast', { hasText: saveCase.toast })).toBeVisible();
            expect(sequence).toEqual(['settings saved', 'engine reload started', 'engine reload finished']);
            expect(settingsReads).toBeGreaterThan(readsWhileWaiting);
            expect(bridgeCalls.filter(call => call.action === 'reloadSettings')).toHaveLength(1);
        });
    }

    test('a failed engine reload still saves and the toast says the engine is out of sync', async ({ page }) => {
        const settingsBundle = chatCompletionBundle();
        const sequence = [];
        await mockModernApiShell(page, settingsBundle, {}, {
            replies: {
                reloadSettings: () => {
                    throw new Error('engine unavailable');
                },
            },
        });
        const saved = await routeSettingsSave(page, settingsBundle, sequence);

        await page.goto('/modern/?view=api');
        await page.locator('[data-api-model]').fill('custom/new-model');
        await page.locator('[data-save-api-connection]').click();

        const toast = page.locator('.toast', { hasText: '连接配置已保存' });
        await expect(toast).toBeVisible();
        await expect(toast).toContainText('生成引擎未能同步：engine unavailable');
        expect(saved.settings.oai_settings.custom_model).toBe('custom/new-model');
    });
});
