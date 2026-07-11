import { test, expect } from '@playwright/test';

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

async function mockModernApiShell(page, settingsBundle, secretState = {}) {
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
