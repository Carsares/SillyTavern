import { test, expect } from '@playwright/test';
import { mockBridgeFrame } from './modern-test-utils.js';

/* global localStorage, document */

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

// 设置中心「模型连接」标签（原 API 页）的改动即保存：每个字段失焦或选择后单独校验、单独保存，再通知生成引擎重载。
// 字段 → 设置路径的映射和校验在 public/modern/actions/api-autosave.js；保存、回滚和引擎同步在 actions/settings-autosave.js。

const emptyPresets = () => ({
    textgenerationwebui_preset_names: [],
    textgenerationwebui_presets: [],
    openai_setting_names: [],
    openai_settings: [],
});

// 保存请求按顺序记下来，页面之后读到的设置跟着保存走，和真实服务端一样
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

async function routeSecretWrites(page) {
    const writes = [];
    await page.route('**/api/secrets/write', route => {
        writes.push(route.request().postDataJSON());
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    return writes;
}

const saveStatus = page => page.locator('[data-settings-save-status]');

// 文本补全各来源：有模型字段的改模型，有密钥映射的写密钥；没有的不显示对应输入框
async function editTextCompletionModelAndKey(page, item, saved, secretWrites) {
    const modelInput = page.locator('[data-textgen-model]');
    const keyInput = page.locator('[data-textgen-api-key]');
    if (Object.keys(item.expectedModelSettings).length) {
        await expect(modelInput).toHaveValue(item.initialModel);
        await modelInput.fill(item.modelValue);
        await modelInput.press('Enter');
        await expect.poll(() => saved.bodies.at(-1)?.textgenerationwebui_settings).toMatchObject(item.expectedModelSettings);
    } else {
        await expect(modelInput).toHaveCount(0);
    }
    if (item.secretValue) {
        await keyInput.fill(item.secretValue);
        await keyInput.press('Enter');
        await expect.poll(() => secretWrites.length).toBe(item.expectedSecretWrites.length);
    } else {
        await expect(keyInput).toHaveCount(0);
    }
}

test.describe('Modern connection settings', () => {
    test('the old API page opens the 模型连接 tab of the settings center', async ({ page }) => {
        const settingsBundle = {
            settings: JSON.stringify({ main_api: 'openai', oai_settings: { chat_completion_source: 'custom', custom_model: 'custom/saved-model', custom_url: 'https://saved.example/v1' } }),
            ...emptyPresets(),
        };
        await mockModernApiShell(page, settingsBundle);

        await page.goto('/modern/?view=api');

        await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'settings');
        await expect(page).toHaveURL(/view=settings/);
        await expect(page.locator('.page-title')).toHaveText('设置中心');
        await expect(page.locator('[data-settings-section="connection"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-api-model]')).toHaveValue('custom/saved-model');
        await expect(saveStatus(page)).toHaveText('改动会自动保存');
        // 侧栏不再有单独的 API 入口，也没有保存按钮
        await expect(page.locator('#navList [data-route="api"]')).toHaveCount(0);
        await expect(page.locator('[data-save-api-connection]')).toHaveCount(0);

        // 其它页面上指向 API 的按钮也打开这里
        await page.locator('#navList [data-route="dashboard"]').click();
        await page.locator('.dashboard-grid [data-route="api"]').first().click();
        await expect(page.locator('#modernApp')).toHaveAttribute('data-current-route', 'settings');
        await expect(page.locator('[data-settings-section="connection"]')).toHaveAttribute('aria-selected', 'true');
    });

    test('keeps an unsupported main API visible and switches the editor as soon as another one is picked', async ({ page }) => {
        // Uses a synthetic unknown main_api to exercise the fallback: all real main_apis are editable in the modern UI
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'legacy-unknown-api',
                textgenerationwebui_settings: {
                    type: 'ooba',
                    server_urls: { ooba: 'http://127.0.0.1:5000' },
                    custom_model: 'ooba/saved-model',
                },
            }),
            ...emptyPresets(),
        };
        await mockModernApiShell(page, settingsBundle);
        const saved = await routeSettingsSave(page, settingsBundle);

        await page.goto('/modern/?view=api');

        await expect(page.locator('[data-api-main]')).toHaveValue('legacy-unknown-api');
        await expect(page.locator('[data-api-main] option:checked')).toHaveText('当前：legacy-unknown-api（暂不支持编辑）');
        await expect(page.locator('text=当前主 API 暂不支持在这里编辑')).toBeVisible();

        await page.locator('[data-api-main]').selectOption('textgenerationwebui');

        await expect.poll(() => saved.bodies.at(-1)?.main_api).toBe('textgenerationwebui');
        await expect(page.locator('[data-textgen-type]')).toHaveValue('ooba');
        await expect(page.locator('[data-textgen-endpoint]')).toHaveValue('http://127.0.0.1:5000');
        await expect(page.locator('[data-textgen-model]')).toHaveValue('ooba/saved-model');
        await expect(saveStatus(page)).toContainText('主 API 已保存');
    });

    test('KoboldAI: the address saves on its own, where the engine reads it, and the test uses the saved value', async ({ page }) => {
        let statusBody = null;
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'kobold',
                api_server: 'http://saved.kobold:5000/api',
                kai_settings: { api_server: 'http://saved.kobold:5000/api', preset_settings: 'gui' },
            }),
            ...emptyPresets(),
        };
        await mockModernApiShell(page, settingsBundle);
        const saved = await routeSettingsSave(page, settingsBundle);
        await page.route('**/api/backends/kobold/status', route => {
            statusBody = route.request().postDataJSON();
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ model: 'koboldcpp/test-model' }) });
        });

        await page.goto('/modern/?view=api');

        const url = page.locator('[data-kobold-api-url]');
        await expect(url).toHaveValue('http://saved.kobold:5000/api');
        await expect(page.locator('[data-textgen-max-context]')).toBeVisible();

        // 不是完整地址：字段旁报错，不保存
        await url.fill('not a url');
        await url.press('Enter');
        await expect(page.locator('[data-api-field-error="koboldUrl"]')).toContainText('完整地址');
        await expect(url).toHaveAttribute('aria-invalid', 'true');
        await expect(saveStatus(page)).toContainText('有字段未保存');
        expect(saved.bodies).toEqual([]);

        await url.fill('http://new.kobold:5001/api');
        await url.blur();
        await expect.poll(() => saved.bodies.length).toBe(1);
        // 引擎先读 kai_settings.api_server，两处都要写
        expect(saved.bodies[0]).toMatchObject({ main_api: 'kobold', api_server: 'http://new.kobold:5001/api', kai_settings: { api_server: 'http://new.kobold:5001/api', preset_settings: 'gui' } });
        await expect(page.locator('[data-api-field-error="koboldUrl"]')).toHaveCount(0);

        await page.locator('[data-test-api]').click();
        await expect.poll(() => statusBody?.api_server).toBe('http://new.kobold:5001/api');
        await expect(page.locator('[data-api-test-status]')).toHaveText('可用');
        await expect(page.locator('[data-api-test-detail]')).toContainText('koboldcpp/test-model');
    });

    test('NovelAI: the model saves where the engine reads it and the key is stored without being shown', async ({ page }) => {
        let statusCalled = false;
        const settingsBundle = {
            settings: JSON.stringify({ main_api: 'novel', model_novel: 'kayra-v1', nai_settings: { model_novel: 'kayra-v1', temperature: 1 } }),
            ...emptyPresets(),
        };
        await mockModernApiShell(page, settingsBundle, {
            api_key_novel: [{ id: 'saved', value: '********nai', label: 'saved', active: true }],
        });
        const saved = await routeSettingsSave(page, settingsBundle);
        const secretWrites = await routeSecretWrites(page);
        await page.route('**/api/novelai/status', route => {
            statusCalled = true;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tier: 2 }) });
        });

        await page.goto('/modern/?view=api');

        await expect(page.locator('[data-novel-model]')).toHaveValue('kayra-v1');
        await expect(page.locator('[data-novel-api-key]')).toHaveAttribute('placeholder', '已保存；粘贴新密钥会替换');

        await page.locator('[data-novel-model]').selectOption('llama-3-erato-v1');
        await expect.poll(() => saved.bodies.at(-1)?.nai_settings?.model_novel).toBe('llama-3-erato-v1');
        expect(saved.bodies.at(-1)).toMatchObject({ main_api: 'novel', model_novel: 'llama-3-erato-v1', nai_settings: { temperature: 1 } });

        await page.locator('[data-novel-api-key]').fill('nai-secret-token');
        await page.locator('[data-novel-api-key]').press('Enter');
        await expect.poll(() => secretWrites.length).toBe(1);
        expect(secretWrites[0]).toMatchObject({ key: 'api_key_novel', value: 'nai-secret-token' });
        await expect(page.locator('[data-novel-api-key]')).toHaveValue('');
        await expect(page.locator('body')).not.toContainText('nai-secret-token');

        // NovelAI 的 Clio / Kayra / Erato 引擎固定只用 8,192：超出时提示
        await page.locator('[data-textgen-max-context]').fill('16384');
        await page.locator('[data-textgen-max-context]').blur();
        await expect(page.locator('[data-textgen-context-hint]')).toContainText('引擎对 NovelAI 最多使用 8,192');

        await page.locator('[data-test-api]').click();
        await expect.poll(() => statusCalled).toBe(true);
        await expect(page.locator('[data-api-test-detail]')).toContainText('Scroll');
    });

    test('AI Horde: the model selection saves on every change and refreshing the list keeps it', async ({ page }) => {
        let userInfoCalled = false;
        const settingsBundle = {
            settings: JSON.stringify({ main_api: 'koboldhorde', horde_settings: { models: ['koboldcpp/model-a'] } }),
            ...emptyPresets(),
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
        const saved = await routeSettingsSave(page, settingsBundle);
        const secretWrites = await routeSecretWrites(page);
        await page.route('**/api/horde/user-info', route => {
            userInfoCalled = true;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ anonymous: false, user: { username: 'tester', kudos: 42 } }) });
        });

        await page.goto('/modern/?view=api');

        await expect(page.locator('[data-horde-model] option[value="koboldcpp/model-b"]')).toHaveCount(1);
        await expect(page.locator('[data-horde-model]')).toHaveValues(['koboldcpp/model-a']);

        await page.locator('[data-horde-model]').selectOption(['koboldcpp/model-a', 'koboldcpp/model-b']);
        await expect.poll(() => saved.bodies.at(-1)?.horde_settings?.models).toEqual(['koboldcpp/model-a', 'koboldcpp/model-b']);

        await page.locator('[data-horde-api-key]').fill('horde-secret');
        await page.locator('[data-horde-api-key]').blur();
        await expect.poll(() => secretWrites[0]).toMatchObject({ key: 'api_key_horde', value: 'horde-secret' });
        await expect(page.locator('body')).not.toContainText('horde-secret');

        await page.locator('[data-test-api]').click();
        await expect.poll(() => userInfoCalled).toBe(true);
        await expect(page.locator('[data-api-test-detail]')).toContainText('tester');

        await page.locator('[data-horde-refresh]').click();
        await expect(page.locator('[data-horde-model]')).toHaveValues(['koboldcpp/model-a', 'koboldcpp/model-b']);
    });

    test('completes an OpenRouter OAuth callback into a saved secret', async ({ page }) => {
        let writtenSecret = null;
        let exchangeBody = null;
        const settingsBundle = {
            settings: JSON.stringify({ main_api: 'openai', oai_settings: { chat_completion_source: 'openrouter' } }),
            ...emptyPresets(),
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

    test('chat completion: every field saves on its own and the test uses the saved values', async ({ page }) => {
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
                    openai_max_context: 8000,
                    openai_max_tokens: 300,
                    top_p_openai: 0.9,
                    freq_pen_openai: 0.1,
                    pres_pen_openai: 0.2,
                },
            }),
            ...emptyPresets(),
            openai_setting_names: ['Chat Preset A', 'Chat Preset B'],
            openai_settings: [
                JSON.stringify({ name: 'Chat Preset A' }),
                JSON.stringify({ name: 'Chat Preset B', temperature: 0.5 }),
            ],
        };
        await mockModernApiShell(page, settingsBundle, {
            api_key_custom: [{ id: 'saved', value: '********tom', label: 'saved', active: true }],
        });
        const saved = await routeSettingsSave(page, settingsBundle);
        const secretWrites = await routeSecretWrites(page);
        await page.route('**/api/backends/chat-completions/generate', route => {
            generateBody = route.request().postDataJSON();
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'OK from custom' } }] }) });
        });

        await page.goto('/modern/?view=api');

        await expect(page.locator('[data-api-source]')).toHaveValue('custom');
        await expect(page.locator('[data-api-model]')).toHaveValue('custom/saved-model');
        await expect(page.locator('[data-api-custom-url]')).toHaveValue('https://saved.example/v1');
        await expect(page.locator('[data-api-reverse-proxy]')).toHaveValue('https://proxy.saved/v1');
        await expect(page.locator('[data-api-field="api-key"] [data-secret-state]')).toHaveText('已保存');
        await expect(page.locator('[data-api-key]')).toHaveAttribute('name', 'chat_completion_api_key');
        await expect(page.locator('[data-api-key]')).toHaveAttribute('autocomplete', 'new-password');
        await expect(page.locator('[data-api-current-connection]')).toContainText('custom/saved-model');

        // 选择预设 = 应用预设：预设里的采样参数一起写入
        await page.locator('[data-api-preset]').selectOption('Chat Preset B');
        await expect.poll(() => saved.bodies.at(-1)?.oai_settings?.preset_settings_openai).toBe('Chat Preset B');
        expect(saved.bodies.at(-1).oai_settings.temp_openai).toBe(0.5);

        const edits = [
            ['[data-api-model]', 'custom/new-model'],
            ['[data-api-custom-url]', 'https://custom.example/v1'],
            ['[data-api-reverse-proxy]', 'https://proxy.example/v1'],
            ['[data-api-temperature]', '0.44'],
            ['[data-api-max-tokens]', '512'],
            ['[data-api-top-p]', '0.88'],
            ['[data-api-frequency-penalty]', '0.12'],
            ['[data-api-presence-penalty]', '0.34'],
        ];
        for (const [selector, value] of edits) {
            const before = saved.bodies.length;
            await page.locator(selector).fill(value);
            await page.locator(selector).press('Enter');
            await expect.poll(() => saved.bodies.length).toBe(before + 1);
        }
        expect(saved.bodies.at(-1).main_api).toBe('openai');
        expect(saved.bodies.at(-1).oai_settings).toMatchObject({
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

        await page.locator('[data-api-key]').fill('sk-chat-secret');
        await page.locator('[data-api-key]').press('Enter');
        await expect.poll(() => secretWrites[0]).toMatchObject({ key: 'api_key_custom', value: 'sk-chat-secret' });
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
        await expect(page.locator('[data-api-test-status]')).toHaveText('可用');
        await expect(page.locator('[data-api-test-detail]')).toContainText('OK from custom');
        const recent = await page.evaluate(() => JSON.parse(localStorage.getItem('st-modern-recent-models') || '{}'));
        expect(recent['openai:custom']).toEqual(['custom/new-model']);
    });

    test('an out-of-range field is marked and left unsaved while the others still save, and blocks the test', async ({ page }) => {
        const generateBodies = [];
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'openai',
                oai_settings: {
                    chat_completion_source: 'custom',
                    custom_model: 'custom/saved-model',
                    custom_url: 'https://saved.example/v1',
                    temp_openai: 0.7,
                    openai_max_context: 200000,
                    openai_max_tokens: 300,
                    top_p_openai: 0.9,
                    freq_pen_openai: 0.1,
                    pres_pen_openai: 0.2,
                },
            }),
            ...emptyPresets(),
        };
        await mockModernApiShell(page, settingsBundle);
        const saved = await routeSettingsSave(page, settingsBundle);
        await page.route('**/api/backends/chat-completions/generate', route => {
            generateBodies.push(route.request().postDataJSON());
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) });
        });

        await page.goto('/modern/?view=api');
        // The inputs expose the same limits as the legacy sliders.
        await expect(page.locator('[data-api-top-p]')).toHaveAttribute('max', '1');
        await expect(page.locator('[data-api-temperature]')).toHaveAttribute('max', '2');
        await expect(page.locator('[data-api-frequency-penalty]')).toHaveAttribute('min', '-2');
        await expect(page.locator('[data-api-max-tokens]')).toHaveAttribute('max', '128000');

        const topP = page.locator('[data-api-top-p]');
        await topP.fill('5');
        await topP.blur();
        const topPError = page.locator('[data-api-field-error="topP"]');
        await expect(topPError).toHaveText('Top P 需在 0 到 1 之间');
        await expect(topP).toHaveAttribute('aria-invalid', 'true');
        await expect(topP).toHaveAttribute('aria-describedby', 'api-field-error-topP');
        await expect(saveStatus(page)).toContainText('有字段未保存');

        await page.locator('[data-api-max-tokens]').fill('12.5');
        await page.locator('[data-api-max-tokens]').blur();
        await expect(page.locator('[data-api-field-error="maxTokens"]')).toHaveText('回复长度 需为 1 到 128,000 之间的整数');
        await page.locator('[data-api-temperature]').fill('');
        await page.locator('[data-api-temperature]').blur();
        await expect(page.locator('[data-api-field-error="temperature"]')).toHaveText('请填写 Temperature');
        expect(saved.bodies).toEqual([]);

        // A valid field next to the broken ones still saves on its own
        await page.locator('[data-api-model]').fill('custom/new-model');
        await page.locator('[data-api-model]').press('Enter');
        await expect.poll(() => saved.bodies.length).toBe(1);
        expect(saved.bodies[0].oai_settings).toMatchObject({ custom_model: 'custom/new-model', top_p_openai: 0.9, temp_openai: 0.7, openai_max_tokens: 300 });

        // The test does not run on values the page shows but did not save
        await page.locator('[data-test-api]').click();
        await expect(page.locator('.toast', { hasText: '连接测试失败' })).toContainText('有字段没有保存');
        expect(generateBodies).toEqual([]);

        // Correcting the fields removes the errors and saves them
        await topP.fill('0.5');
        await topP.blur();
        await page.locator('[data-api-max-tokens]').fill('128000');
        await page.locator('[data-api-max-tokens]').blur();
        await page.locator('[data-api-temperature]').fill('2');
        await page.locator('[data-api-temperature]').blur();
        await expect(page.locator('.field-error')).toHaveCount(0);
        await expect.poll(() => saved.bodies.at(-1)?.oai_settings).toMatchObject({ top_p_openai: 0.5, openai_max_tokens: 128000, temp_openai: 2 });

        await page.locator('[data-test-api]').click();
        await expect.poll(() => generateBodies.length).toBe(1);
    });

    test('treats a reasoning-only chat completion test reply as a working connection', async ({ page }) => {
        const generateBodies = [];
        const generateResponses = [
            // Reasoning model spent the whole test token budget on reasoning (DeepSeek-style payload).
            { choices: [{ message: { role: 'assistant', content: '', reasoning_content: 'The user wants me to reply OK, so' }, finish_reason: 'length' }] },
            // Truly empty reply without any reasoning is still a failure.
            { choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }] },
            // Backend error payloads keep their original message.
            { error: { message: 'Unauthorized' } },
        ];
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'openai',
                oai_settings: { chat_completion_source: 'custom', custom_model: 'deepseek-v4-flash', custom_url: 'https://api.deepseek.com', openai_max_tokens: 300 },
            }),
            ...emptyPresets(),
        };
        await mockModernApiShell(page, settingsBundle, {
            api_key_custom: [{ id: 'saved', value: '********seek', label: 'saved', active: true }],
        });
        await page.route('**/api/backends/chat-completions/generate', route => {
            generateBodies.push(route.request().postDataJSON());
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(generateResponses[generateBodies.length - 1]) });
        });

        await page.goto('/modern/?view=api');
        await expect(page.locator('[data-api-model]')).toHaveValue('deepseek-v4-flash');

        const reasoningOnlyDetail = '连接正常：模型只返回了推理内容（测试请求的 token 上限较低）';
        await page.locator('[data-test-api]').click();
        await expect(page.locator('.toast', { hasText: '连接测试成功' })).toContainText(reasoningOnlyDetail);
        await expect(page.locator('[data-api-test-status]')).toHaveText('可用');
        await expect(page.locator('[data-api-test-detail]')).toHaveText(`deepseek-v4-flash: ${reasoningOnlyDetail}`);
        expect(generateBodies[0]).toMatchObject({ chat_completion_source: 'custom', model: 'deepseek-v4-flash', custom_url: 'https://api.deepseek.com', max_tokens: 20, stream: false });

        await page.locator('[data-test-api]').click();
        await expect(page.locator('.toast', { hasText: '连接测试失败' })).toContainText('模型没有返回可显示内容。');
        await expect(page.locator('[data-api-test-status]')).toHaveText('失败');
        await expect(page.locator('[data-api-test-detail]')).toHaveText('模型没有返回可显示内容。');

        await page.locator('[data-test-api]').click();
        await expect(page.locator('.toast', { hasText: '连接测试失败' }).filter({ hasText: 'Unauthorized' })).toBeVisible();
        await expect(page.locator('[data-api-test-detail]')).toHaveText('Unauthorized');
        expect(generateBodies).toHaveLength(3);
    });

    test('keeps supported chat completion sources outside the short list', async ({ page }) => {
        const settingsBundle = {
            settings: JSON.stringify({ main_api: 'openai', oai_settings: { chat_completion_source: 'aimlapi', aimlapi_model: 'aimlapi/saved-model' } }),
            ...emptyPresets(),
        };
        await mockModernApiShell(page, settingsBundle);
        const saved = await routeSettingsSave(page, settingsBundle);

        await page.goto('/modern/?view=api');

        await expect(page.locator('[data-api-source]')).toHaveValue('aimlapi');
        await expect(page.locator('[data-api-model]')).toHaveValue('aimlapi/saved-model');
        await page.locator('[data-api-model]').fill('aimlapi/new-model');
        await page.locator('[data-api-model]').blur();

        await expect.poll(() => saved.bodies.at(-1)?.oai_settings?.aimlapi_model).toBe('aimlapi/new-model');
        expect(saved.bodies.at(-1).oai_settings.chat_completion_source).toBe('aimlapi');
    });

    test('switching the chat completion source saves it and shows that source\'s fields', async ({ page }) => {
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'openai',
                oai_settings: { chat_completion_source: 'custom', custom_model: 'custom/saved-model', custom_url: 'https://saved.example/v1', siliconflow_model: 'Qwen/Qwen3-8B' },
            }),
            ...emptyPresets(),
        };
        await mockModernApiShell(page, settingsBundle);
        const saved = await routeSettingsSave(page, settingsBundle);

        await page.goto('/modern/?view=api');
        await expect(page.locator('[data-api-field="custom-url"]')).toBeVisible();
        await expect(page.locator('[data-api-field="siliconflow-endpoint"]')).toHaveCount(0);

        await page.locator('[data-api-source]').selectOption('siliconflow');
        await expect.poll(() => saved.bodies.at(-1)?.oai_settings?.chat_completion_source).toBe('siliconflow');
        expect(saved.bodies.at(-1).chat_completion_source).toBe('siliconflow');
        await expect(page.locator('[data-api-model]')).toHaveValue('Qwen/Qwen3-8B');
        await expect(page.locator('[data-api-field="custom-url"]')).toHaveCount(0);
        // SiliconFlow 端点没保存过时按引擎默认的 global 显示，看一眼不会改动它
        await expect(page.locator('[data-api-endpoint]')).toHaveValue('global');
        expect(saved.bodies.at(-1).oai_settings).not.toHaveProperty('siliconflow_endpoint');
    });

    test('text completion: every field saves on its own and the test uses the saved endpoint', async ({ page }) => {
        let statusBody = null;
        const settingsBundle = {
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
            ...emptyPresets(),
            textgenerationwebui_preset_names: ['Text Preset A', 'Text Preset B'],
            textgenerationwebui_presets: [JSON.stringify({ temp: 0.7 }), JSON.stringify({ temp: 0.8 })],
        };
        await mockModernApiShell(page, settingsBundle, {
            api_key_openrouter: [{ id: 'saved', value: '********ret', label: 'saved', active: true }],
        });
        const saved = await routeSettingsSave(page, settingsBundle);
        const secretWrites = await routeSecretWrites(page);
        await page.route('**/api/backends/text-completions/status', route => {
            statusBody = route.request().postDataJSON();
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: 'openrouter/new-model' }) });
        });

        await page.goto('/modern/?view=api');

        await expect(page.locator('[data-textgen-type]')).toHaveValue('openrouter');
        await expect(page.locator('[data-textgen-endpoint]')).toHaveValue('https://openrouter.ai/api');
        await expect(page.locator('[data-textgen-model]')).toHaveValue('openrouter/auto');
        await expect(page.locator('[data-textgen-sampling="min_p"]')).toHaveValue('0.01');
        await expect(page.locator('[data-textgen-field="api-key"] [data-secret-state]')).toHaveText('已保存');
        await expect(page.locator('[data-textgen-api-key]')).toHaveAttribute('name', 'text_completion_api_key');

        const edits = [
            ['[data-textgen-endpoint]', 'https://openrouter.ai/api/v1'],
            ['[data-textgen-model]', 'openrouter/new-model'],
            ['[data-textgen-sampling="temp"]', '0.82'],
            ['[data-textgen-sampling="top_p"]', '0.91'],
            ['[data-textgen-sampling="top_k"]', '64'],
            ['[data-textgen-sampling="min_p"]', '0.04'],
            ['[data-textgen-sampling="rep_pen"]', '1.08'],
            ['[data-textgen-sampling="rep_pen_range"]', '256'],
        ];
        for (const [selector, value] of edits) {
            const before = saved.bodies.length;
            await page.locator(selector).fill(value);
            await page.locator(selector).press('Enter');
            await expect.poll(() => saved.bodies.length).toBe(before + 1);
        }
        await page.locator('[data-textgen-preset]').selectOption('Text Preset B');
        await expect.poll(() => saved.bodies.at(-1)?.textgenerationwebui_settings?.preset).toBe('Text Preset B');
        expect(saved.bodies.at(-1).textgenerationwebui_settings).toMatchObject({
            type: 'openrouter',
            server_urls: { openrouter: 'https://openrouter.ai/api/v1' },
            openrouter_model: 'openrouter/new-model',
            temp: 0.82,
            top_p: 0.91,
            top_k: 64,
            min_p: 0.04,
            rep_pen: 1.08,
            rep_pen_range: 256,
        });

        // 采样参数清空不再悄悄存成 0
        await page.locator('[data-textgen-sampling="top_k"]').fill('');
        await page.locator('[data-textgen-sampling="top_k"]').blur();
        await expect(page.locator('[data-api-field-error="textgenSampling-top_k"]')).toHaveText('请填写 Top K');
        expect(saved.bodies.at(-1).textgenerationwebui_settings.top_k).toBe(64);
        await page.locator('[data-textgen-sampling="top_k"]').fill('64');
        await page.locator('[data-textgen-sampling="top_k"]').blur();
        await expect(page.locator('[data-api-field-error="textgenSampling-top_k"]')).toHaveCount(0);

        await page.locator('[data-textgen-api-key]').fill('sk-secret-textgen');
        await page.locator('[data-textgen-api-key]').blur();
        await expect.poll(() => secretWrites[0]).toMatchObject({ key: 'api_key_openrouter', value: 'sk-secret-textgen' });
        await expect(page.locator('body')).not.toContainText('sk-secret-textgen');

        await page.locator('[data-test-api]').click();
        await expect.poll(() => statusBody).toMatchObject({ api_server: 'https://openrouter.ai/api/v1', api_type: 'openrouter' });
        await expect(page.locator('[data-api-test-detail]')).toContainText('openrouter/new-model');
    });

    test('saves every legacy text completion type with its model and secret mapping', async ({ page }) => {
        const settingsBundle = {
            settings: '',
            ...emptyPresets(),
            textgenerationwebui_preset_names: ['Text Preset A'],
            textgenerationwebui_presets: [JSON.stringify({ temp: 0.7 })],
        };
        await mockModernApiShell(page, settingsBundle);
        const saved = await routeSettingsSave(page, settingsBundle);
        const secretWrites = await routeSecretWrites(page);

        for (const [index, item] of textCompletionCases.entries()) {
            const savedTextgen = {
                type: item.type,
                server_urls: { [item.type]: `http://127.0.0.1:${9100 + index}/saved` },
                preset: 'Text Preset A',
                ...item.modelSettings,
            };
            saved.bodies.length = 0;
            secretWrites.length = 0;
            settingsBundle.settings = JSON.stringify({ main_api: 'textgenerationwebui', textgenerationwebui_settings: savedTextgen });

            await page.goto('/modern/?view=api');
            await expect(page.locator('[data-textgen-type]')).toHaveValue(item.type);

            const typeOptions = await page.locator('[data-textgen-type] option').evaluateAll(options => options.map(option => option.value));
            expect([...typeOptions].sort()).toEqual(textCompletionCases.map(({ type }) => type).sort());
            await expect(page.locator('[data-textgen-endpoint]')).toHaveValue(savedTextgen.server_urls[item.type]);

            const newEndpoint = `http://127.0.0.1:${9200 + index}/${item.type}`;
            await page.locator('[data-textgen-endpoint]').fill(newEndpoint);
            await page.locator('[data-textgen-endpoint]').press('Enter');
            await expect.poll(() => saved.bodies.at(-1)?.textgenerationwebui_settings?.server_urls?.[item.type]).toBe(newEndpoint);

            await editTextCompletionModelAndKey(page, item, saved, secretWrites);
            expect(saved.bodies.at(-1).textgenerationwebui_settings).toMatchObject({ type: item.type, preset: 'Text Preset A', ...item.expectedModelSettings });
            expect(saved.bodies.at(-1).textgenerationwebui_settings).not.toHaveProperty('model');
            expect(secretWrites.map(({ key, value }) => ({ key, value }))).toEqual(item.expectedSecretWrites);
        }
    });

    test('switching the text completion source saves it and shows that source\'s endpoint, model and key', async ({ page }) => {
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'textgenerationwebui',
                textgenerationwebui_settings: {
                    type: 'openrouter',
                    server_urls: { openrouter: 'https://openrouter.ai/api', ollama: 'http://127.0.0.1:11434' },
                    openrouter_model: 'openrouter/auto',
                    ollama_model: 'llama3.1',
                    preset: 'Text Preset A',
                },
            }),
            ...emptyPresets(),
        };
        await mockModernApiShell(page, settingsBundle, {
            api_key_openrouter: [{ id: 'saved', value: '********ret', label: 'saved', active: true }],
        });
        const saved = await routeSettingsSave(page, settingsBundle);

        await page.goto('/modern/?view=api');
        await expect(page.locator('[data-textgen-field="api-key"]')).toBeVisible();

        await page.locator('[data-textgen-type]').selectOption('ollama');
        await expect.poll(() => saved.bodies.at(-1)?.textgenerationwebui_settings?.type).toBe('ollama');
        await expect(page.locator('[data-textgen-endpoint]')).toHaveValue('http://127.0.0.1:11434');
        await expect(page.locator('[data-textgen-model]')).toHaveValue('llama3.1');
        await expect(page.locator('[data-textgen-field="api-key"]')).toHaveCount(0);

        await page.locator('[data-textgen-endpoint]').fill('http://127.0.0.1:11435');
        await page.locator('[data-textgen-endpoint]').blur();
        await page.locator('[data-textgen-model]').fill('llama3.2');
        await page.locator('[data-textgen-model]').blur();
        await expect.poll(() => saved.bodies.at(-1)?.textgenerationwebui_settings?.ollama_model).toBe('llama3.2');
        expect(saved.bodies.at(-1).textgenerationwebui_settings).toMatchObject({
            type: 'ollama',
            server_urls: { openrouter: 'https://openrouter.ai/api', ollama: 'http://127.0.0.1:11435' },
            openrouter_model: 'openrouter/auto',
        });
    });
});

// 上下文长度：不再要求先勾选「解锁上限」。超过按模型的上限只提示，保存时自动替引擎打开解锁标记；
// 长度和连接字段分开保存，端点没填也能改长度。
test.describe('Modern connection lengths', () => {
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
        ...emptyPresets(),
        openai_setting_names: ['Chat Preset A'],
        openai_settings: [JSON.stringify({ name: 'Chat Preset A', openai_max_context: 4095 })],
    });

    test('a context above the model limit saves with the engine unlock flag and only warns', async ({ page }) => {
        const order = [];
        const settingsBundle = chatBundle({ chat_completion_source: 'openai', openai_model: 'gpt-4o' });
        const bridgeCalls = await mockModernApiShell(page, settingsBundle, {}, {
            replies: { reloadSettings: () => { order.push('engine reloaded'); } },
        });
        const saved = await routeSettingsSave(page, settingsBundle, order);

        await page.goto('/modern/?view=api');

        const contextInput = page.locator('[data-api-max-context]');
        const hint = page.locator('[data-api-context-hint]');
        await expect(contextInput).toHaveValue('4095');
        await expect(contextInput).toHaveAttribute('max', '2000000');
        await expect(hint).toHaveText('当前模型已知上限 128,000；提示词预算 3,795（上下文 − 回复长度）');
        await expect(page.locator('[data-api-max-context-unlocked]')).toHaveCount(0);

        // 输入时说明就跟着变，失焦才保存
        await contextInput.fill('200000');
        await expect(hint).toContainText('超过当前模型已知上限 128,000，请求可能被服务拒绝');
        await expect(hint).toHaveClass(/is-warning/);
        expect(saved.bodies).toEqual([]);
        await contextInput.blur();

        await expect.poll(() => saved.bodies.at(-1)?.oai_settings).toMatchObject({ openai_max_context: 200000, max_context_unlocked: true, openai_max_tokens: 300 });
        await expect.poll(() => order).toEqual(['settings saved', 'engine reloaded']);
        expect(bridgeCalls.filter(call => call.action === 'reloadSettings')).toHaveLength(1);
        await expect(saveStatus(page)).toContainText('上下文长度已保存');
        await expect(page.locator('.field-error')).toHaveCount(0);

        // 「填入模型上限」写回 128,000，解锁标记随之关掉
        await page.locator('[data-api-context-fill]').click();
        await expect.poll(() => saved.bodies.at(-1)?.oai_settings).toMatchObject({ openai_max_context: 128000, max_context_unlocked: false });
        await expect(contextInput).toHaveValue('128000');
        await expect(page.locator('[data-api-context-fill]')).toBeHidden();

        // 换成上限更小的模型时，解锁标记跟着模型重新判断，保存的上下文才不会被引擎钳回去
        await page.locator('[data-api-model]').fill('gpt-4');
        await page.locator('[data-api-model]').blur();
        await expect.poll(() => saved.bodies.at(-1)?.oai_settings).toMatchObject({ openai_model: 'gpt-4', max_context_unlocked: true });
        await expect(hint).toContainText('超过当前模型已知上限 8,191');
    });

    test('sources without a fixed limit explain why and offer no fill button', async ({ page }) => {
        const settingsBundle = chatBundle({ openrouter_model: 'openai/gpt-4.1' });
        await mockModernApiShell(page, settingsBundle);
        await routeSettingsSave(page, settingsBundle);

        await page.goto('/modern/?view=api');

        const hint = page.locator('[data-api-context-hint]');
        await expect(hint).toContainText('该来源不限制上下文长度');
        await expect(page.locator('[data-api-context-fill]')).toBeHidden();

        await page.locator('[data-api-source]').selectOption('openrouter');
        await expect(hint).toContainText('参考上限 128,000，实际以该来源的模型列表为准');
        await expect(page.locator('[data-api-context-fill]')).toBeHidden();
    });

    test('a reply as long as the context is saved but flagged', async ({ page }) => {
        const settingsBundle = chatBundle();
        await mockModernApiShell(page, settingsBundle);
        const saved = await routeSettingsSave(page, settingsBundle);

        await page.goto('/modern/?view=api');
        await page.locator('[data-api-max-tokens]').fill('5000');
        await page.locator('[data-api-max-tokens]').blur();

        await expect.poll(() => saved.bodies.at(-1)?.oai_settings?.openai_max_tokens).toBe(5000);
        await expect(page.locator('[data-api-context-hint]')).toContainText('回复长度不小于上下文长度，没有空间放提示词');
        await expect(page.locator('[data-api-context-hint]')).toHaveClass(/is-warning/);
    });

    test('text completion lengths save even while the endpoint is still empty', async ({ page }) => {
        const order = [];
        const settingsBundle = {
            settings: JSON.stringify({
                main_api: 'textgenerationwebui',
                max_context: 8192,
                amount_gen: 350,
                power_user: { max_context_unlocked: false, keep_me: 'untouched' },
                textgenerationwebui_settings: { type: 'ooba', server_urls: {} },
            }),
            ...emptyPresets(),
        };
        const bridgeCalls = await mockModernApiShell(page, settingsBundle, {}, {
            replies: { reloadSettings: () => { order.push('engine reloaded'); } },
        });
        const saved = await routeSettingsSave(page, settingsBundle, order);

        await page.goto('/modern/?view=api');

        const contextInput = page.locator('[data-textgen-max-context]');
        const responseInput = page.locator('[data-textgen-amount-gen]');
        const hint = page.locator('[data-textgen-context-hint]');
        await expect(page.locator('[data-textgen-endpoint]')).toHaveValue('');
        await expect(contextInput).toHaveValue('8192');
        await expect(contextInput).toHaveAttribute('max', '524288');
        await expect(responseInput).toHaveValue('350');
        await expect(hint).toHaveText('提示词预算 7,842（上下文 − 回复长度）');
        await expect(page.locator('[data-textgen-max-context-unlocked]')).toHaveCount(0);

        await contextInput.fill('32768');
        await contextInput.blur();
        await expect.poll(() => saved.bodies.length).toBe(1);
        expect(saved.bodies[0]).toMatchObject({
            main_api: 'textgenerationwebui',
            max_context: 32768,
            amount_gen: 350,
            power_user: { max_context_unlocked: true, keep_me: 'untouched' },
        });
        await expect.poll(() => order).toEqual(['settings saved', 'engine reloaded']);
        expect(bridgeCalls.map(call => call.action)).toContain('reloadSettings');

        await responseInput.fill('4096');
        await responseInput.blur();
        await expect.poll(() => saved.bodies.at(-1)?.amount_gen).toBe(4096);
        await expect(hint).toHaveText('提示词预算 28,672（上下文 − 回复长度）');

        // 降回旧版未解锁的范围时解锁标记跟着关掉
        await contextInput.fill('4096');
        await contextInput.blur();
        await responseInput.fill('350');
        await responseInput.blur();
        await expect.poll(() => saved.bodies.at(-1)).toMatchObject({ max_context: 4096, amount_gen: 350, power_user: { max_context_unlocked: false } });

        // 端点填错只报它自己的错，不影响别的字段
        await page.locator('[data-textgen-endpoint]').fill('127.0.0.1:5000');
        await page.locator('[data-textgen-endpoint]').blur();
        await expect(page.locator('[data-api-field-error="textgenEndpoint"]')).toContainText('完整地址');

        // 范围外的值不保存
        const before = saved.bodies.length;
        await contextInput.fill('600000');
        await contextInput.blur();
        await expect(page.locator('[data-api-field-error="textMaxContext"]')).toHaveText('上下文长度 需为 512 到 524,288 之间的整数');
        expect(saved.bodies).toHaveLength(before);
    });

    test('saving the current configuration as a preset keeps the context length and unlock flag', async ({ page }) => {
        const settingsBundle = chatBundle({ preset_settings_openai: 'Chat Preset A', openai_max_context: 32000, max_context_unlocked: true, siliconflow_model: 'ignored' });
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

// 保存、引擎同步和失败处理：每次改动都先落盘，再通知引擎重载；失败时回滚并说明。
test.describe('Modern connection autosave', () => {
    const chatBundle = () => ({
        settings: JSON.stringify({
            main_api: 'openai',
            oai_settings: { chat_completion_source: 'custom', custom_model: 'custom/saved-model', custom_url: 'https://saved.example/v1', temp_openai: 0.7, openai_max_tokens: 300 },
        }),
        ...emptyPresets(),
    });
    const editCases = [
        {
            name: 'chat completion',
            bundle: chatBundle,
            edit: async page => {
                await page.locator('[data-api-model]').fill('custom/new-model');
                await page.locator('[data-api-model]').blur();
            },
            expectSaved: saved => expect(saved.oai_settings.custom_model).toBe('custom/new-model'),
        },
        {
            name: 'text completion',
            bundle: () => ({
                settings: JSON.stringify({ main_api: 'textgenerationwebui', textgenerationwebui_settings: { type: 'openrouter', server_urls: { openrouter: 'https://openrouter.ai/api' }, openrouter_model: 'openrouter/auto' } }),
                ...emptyPresets(),
            }),
            edit: async page => {
                await page.locator('[data-textgen-model]').fill('openrouter/new-model');
                await page.locator('[data-textgen-model]').blur();
            },
            expectSaved: saved => expect(saved.textgenerationwebui_settings.openrouter_model).toBe('openrouter/new-model'),
        },
        {
            name: 'KoboldAI',
            bundle: () => ({ settings: JSON.stringify({ main_api: 'kobold', api_server: 'http://saved.kobold:5000/api' }), ...emptyPresets() }),
            edit: async page => {
                await page.locator('[data-kobold-api-url]').fill('http://new.kobold:5001/api');
                await page.locator('[data-kobold-api-url]').blur();
            },
            expectSaved: saved => expect(saved.api_server).toBe('http://new.kobold:5001/api'),
        },
        {
            name: 'NovelAI',
            bundle: () => ({ settings: JSON.stringify({ main_api: 'novel', model_novel: 'kayra-v1' }), ...emptyPresets() }),
            edit: page => page.locator('[data-novel-model]').selectOption('llama-3-erato-v1'),
            expectSaved: saved => expect(saved.model_novel).toBe('llama-3-erato-v1'),
        },
        {
            name: 'AI Horde',
            bundle: () => ({ settings: JSON.stringify({ main_api: 'koboldhorde', horde_settings: { models: ['koboldcpp/model-a'] } }), ...emptyPresets() }),
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

    for (const editCase of editCases) {
        test(`${editCase.name}: a change is saved first and then the engine reloads`, async ({ page }) => {
            const settingsBundle = editCase.bundle();
            const sequence = [];
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
            const saved = await routeSettingsSave(page, settingsBundle, sequence);
            await editCase.routes?.(page);

            await page.goto('/modern/?view=api');
            await editCase.edit(page);

            // The engine is asked only after the settings are on disk
            await expect.poll(() => sequence).toEqual(['settings saved', 'engine reload started']);
            editCase.expectSaved(saved.bodies.at(-1));
            await expect(saveStatus(page)).toContainText('已保存');

            releaseReload();
            await expect.poll(() => sequence).toEqual(['settings saved', 'engine reload started', 'engine reload finished']);
            expect(bridgeCalls.filter(call => call.action === 'reloadSettings')).toHaveLength(1);
        });
    }

    test('a failed engine reload keeps the save and the status says the engine is out of sync', async ({ page }) => {
        const settingsBundle = chatBundle();
        await mockModernApiShell(page, settingsBundle, {}, {
            replies: { reloadSettings: () => { throw new Error('engine unavailable'); } },
        });
        const saved = await routeSettingsSave(page, settingsBundle);

        await page.goto('/modern/?view=api');
        await page.locator('[data-api-model]').fill('custom/new-model');
        await page.locator('[data-api-model]').blur();

        await expect(saveStatus(page)).toContainText('已保存，但生成引擎未同步');
        await expect(saveStatus(page)).toHaveAttribute('title', /engine unavailable/);
        expect(saved.bodies.at(-1).oai_settings.custom_model).toBe('custom/new-model');
    });

    test('a failed save is rolled back, reported and the field shows the saved value again', async ({ page }) => {
        const settingsBundle = chatBundle();
        const bridgeCalls = await mockModernApiShell(page, settingsBundle);
        await page.route('**/api/settings/save', route => route.fulfill({ status: 500, contentType: 'text/plain', body: 'disk full' }));

        await page.goto('/modern/?view=api');
        await page.locator('[data-api-temperature]').fill('1.3');
        await page.locator('[data-api-temperature]').blur();

        await expect(page.locator('.toast', { hasText: 'Temperature 保存失败' })).toBeVisible();
        await expect(saveStatus(page)).toContainText('Temperature 保存失败');
        await expect(page.locator('[data-api-temperature]')).toHaveValue('0.7');
        expect(bridgeCalls.filter(call => call.action === 'reloadSettings')).toHaveLength(0);
    });

    test('typing that has not been saved yet survives a full page redraw', async ({ page }) => {
        const settingsBundle = chatBundle();
        await mockModernApiShell(page, settingsBundle);
        const saved = await routeSettingsSave(page, settingsBundle);

        await page.goto('/modern/?view=api');
        const temperature = page.locator('[data-api-temperature]');
        await temperature.fill('0.85');
        await expect(temperature).toBeFocused();

        // 刷新数据会整页重绘（后台轮询也一样）；正在输入的值和焦点都要留下。
        // Chromium 在移除正在编辑的输入框时会触发 change，这一项随之保存，同样不会丢
        const inputBefore = await temperature.elementHandle();
        await page.evaluate(() => /** @type {HTMLButtonElement} */ (document.querySelector('button[title="刷新数据"]')).click());
        await expect.poll(() => inputBefore.evaluate(node => node.isConnected)).toBe(false);
        await expect(temperature).toHaveValue('0.85');
        await expect(temperature).toBeFocused();

        await temperature.blur();
        await expect.poll(() => saved.bodies.at(-1)?.oai_settings?.temp_openai).toBe(0.85);
        expect(saved.bodies.filter(body => body.oai_settings.temp_openai === 0.85)).toHaveLength(1);
    });

    test('leaving a field unchanged does not write the settings again', async ({ page }) => {
        const settingsBundle = chatBundle();
        await mockModernApiShell(page, settingsBundle);
        const saved = await routeSettingsSave(page, settingsBundle);

        await page.goto('/modern/?view=api');
        await page.locator('[data-api-model]').fill('custom/new-model');
        await page.locator('[data-api-model]').press('Enter');
        await expect.poll(() => saved.bodies.length).toBe(1);
        // 回车已经保存，随后失焦不再写一次
        await page.locator('[data-api-model]').blur();
        await page.locator('[data-api-temperature]').fill('0.7');
        await page.locator('[data-api-temperature]').blur();
        await expect(saveStatus(page)).toContainText('模型已保存');
        expect(saved.bodies).toHaveLength(1);
    });
});

// 连接档案（B1）：设置中心「模型连接」的「连接档案」区读写旧版连接管理扩展保存的真实档案（extension_settings.connectionManager）。
// 映射、精确匹配和跳过原因由 tests/modern-connection-profiles.test.js 覆盖；聊天输入框旁的切换见 tests/modern-chat-connection.e2e.js。
test.describe('Modern API connection profiles', () => {
    const claudeProfile = {
        id: 'p-claude',
        mode: 'cc',
        name: 'Claude 日常',
        api: 'claude',
        preset: 'Chat Preset B',
        model: 'claude-sonnet-4',
        'secret-id': 'claude-2',
        exclude: [],
    };
    const oobaProfile = {
        id: 'p-ooba',
        mode: 'tc',
        name: '本地 Ooba',
        api: 'ooba',
        'api-url': 'http://127.0.0.1:5001',
        model: 'local-model',
        sysprompt: 'Roleplay',
        exclude: [],
    };

    function profilesBundle({ profiles = [claudeProfile, oobaProfile], selectedProfile = null } = {}) {
        return {
            settings: JSON.stringify({
                main_api: 'openai',
                chat_completion_source: 'custom',
                oai_settings: {
                    chat_completion_source: 'custom',
                    custom_model: 'custom/saved-model',
                    custom_url: 'https://saved.example/v1',
                    claude_model: 'claude-old',
                    preset_settings_openai: 'Chat Preset A',
                    temp_openai: 0.7,
                    openai_max_tokens: 300,
                    top_p_openai: 0.9,
                    freq_pen_openai: 0.1,
                    pres_pen_openai: 0.2,
                },
                textgenerationwebui_settings: { type: 'ooba', server_urls: { ooba: 'http://127.0.0.1:5000' }, custom_model: 'local-model' },
                extension_settings: { connectionManager: { profiles: structuredClone(profiles), selectedProfile } },
            }),
            textgenerationwebui_preset_names: [],
            textgenerationwebui_presets: [],
            openai_setting_names: ['Chat Preset A', 'Chat Preset B'],
            openai_settings: [JSON.stringify({ temperature: 1 }), JSON.stringify({ temperature: 0.5, openai_max_tokens: 600 })],
        };
    }

    const secrets = () => ({
        api_key_custom: [{ id: 'custom-1', label: 'main', value: '****', active: true }],
        api_key_claude: [
            { id: 'claude-1', label: 'first', value: '****', active: true },
            { id: 'claude-2', label: 'backup', value: '****', active: false },
        ],
    });

    // 页面刷新读到的设置和密钥状态跟着保存、切换走，和真实服务端一样
    async function mockProfileWorkspace(page, { profiles, selectedProfile, bridgeOptions } = {}) {
        const settingsBundle = profilesBundle({ profiles, selectedProfile });
        const secretState = secrets();
        const bridgeCalls = await mockModernApiShell(page, settingsBundle, secretState, bridgeOptions);
        const saves = [];
        const rotations = [];
        await page.route('**/api/settings/save', route => {
            const body = route.request().postDataJSON();
            saves.push(body);
            settingsBundle.settings = JSON.stringify(body);
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
        });
        await page.route('**/api/secrets/rotate', route => {
            const { key, id } = route.request().postDataJSON();
            rotations.push({ key, id });
            if (secretState[key]?.some(item => item.id === id)) {
                secretState[key] = secretState[key].map(item => ({ ...item, active: item.id === id }));
            }
            return route.fulfill({ status: 204 });
        });
        return { bridgeCalls, saves, rotations, settingsBundle };
    }

    const section = page => page.locator('[data-connection-profiles]');
    const card = (page, id) => page.locator(`[data-connection-profile-card="${id}"]`);

    test('shows an empty state that offers to create the first profile from the current connection', async ({ page }) => {
        const { saves, bridgeCalls } = await mockProfileWorkspace(page, { profiles: [] });
        await page.goto('/modern/?view=api');

        await expect(section(page).locator('.panel-title')).toHaveText('连接档案');
        await expect(section(page)).toContainText('还没有连接档案');
        await expect(section(page)).toContainText('精确匹配');
        // 由当前设置整理出的来源概览和诊断卡已去掉，只留真正保存的档案
        await expect(page.locator('.api-profile-card')).toHaveCount(0);
        await expect(page.locator('.api-diagnostic-card')).toHaveCount(0);

        await section(page).locator('[data-api-connection-profile-create-open]').click();
        const nameInput = section(page).locator('[data-api-connection-create-name]');
        await expect(nameInput).toBeFocused();
        await expect(nameInput).toHaveValue('custom custom/saved-model - Chat Preset A');
        await nameInput.fill('我的自定义连接');
        await nameInput.press('Enter');

        await expect(section(page).locator('.connection-profile-card')).toHaveCount(1);
        await expect(section(page).locator('.connection-profile-card')).toContainText('我的自定义连接');
        const manager = saves.at(-1).extension_settings.connectionManager;
        expect(manager.profiles).toHaveLength(1);
        expect(manager.profiles[0]).toMatchObject({
            name: '我的自定义连接',
            mode: 'cc',
            api: 'custom',
            preset: 'Chat Preset A',
            model: 'custom/saved-model',
            'api-url': 'https://saved.example/v1',
            'secret-id': 'custom-1',
            exclude: [],
        });
        expect(manager.selectedProfile).toBe(manager.profiles[0].id);
        await expect(card(page, manager.profiles[0].id)).toContainText('当前');
        await expect(card(page, manager.profiles[0].id)).toContainText('custom/saved-model');
        await expect(page.locator('.toast', { hasText: '已创建连接档案' })).toBeVisible();
        // 创建后附带同步引擎，页面其余部分不受影响
        await expect.poll(() => bridgeCalls.filter(call => call.action === 'reloadSettings').length).toBe(1);
    });

    test('validates the name inline and keeps the connection edit that was saved on the way', async ({ page }) => {
        const { saves } = await mockProfileWorkspace(page);
        await page.goto('/modern/?view=api');

        await page.locator('[data-api-model]').fill('custom/unsaved-edit');
        await section(page).locator('[data-api-connection-profile-create-open]').click();
        // 只替换档案区，上面的表单没有被重绘；离开模型框时这一项已经保存
        await expect(page.locator('[data-api-model]')).toHaveValue('custom/unsaved-edit');
        await expect.poll(() => saves.length).toBe(1);
        expect(saves[0].oai_settings.custom_model).toBe('custom/unsaved-edit');

        page.on('dialog', dialog => {
            throw new Error(`unexpected dialog: ${dialog.message()}`);
        });
        const nameInput = section(page).locator('[data-api-connection-create-name]');
        await nameInput.fill('Claude 日常');
        await section(page).locator('[data-connection-profile-create-form] button[type="submit"]').click();
        await expect(section(page).locator('[data-api-connection-error]')).toContainText('已经有名为“Claude 日常”的档案');
        await expect(nameInput).toHaveAttribute('aria-invalid', 'true');
        await expect(nameInput).toBeFocused();
        await nameInput.fill('');
        await nameInput.press('Enter');
        await expect(section(page).locator('[data-api-connection-error]')).toContainText('请填写档案名称');
        expect(saves).toHaveLength(1);

        await section(page).locator('[data-api-connection-create-cancel]').click();
        await expect(section(page).locator('[data-api-connection-create-name]')).toHaveCount(0);
        await expect(page.locator('[data-api-model]')).toHaveValue('custom/unsaved-edit');
    });

    test('lists the saved profiles and applies one: settings, secret, engine reload and a per-item result', async ({ page }) => {
        const { saves, rotations, bridgeCalls } = await mockProfileWorkspace(page, { selectedProfile: 'p-ooba' });
        await page.goto('/modern/?view=api');

        await expect(card(page, 'p-claude')).toContainText('Claude 日常');
        await expect(card(page, 'p-claude')).toContainText('聊天补全');
        await expect(card(page, 'p-claude')).toContainText('claude-sonnet-4');
        await expect(card(page, 'p-claude')).toContainText('Chat Preset B');
        await expect(card(page, 'p-claude')).not.toContainText('当前');
        await expect(card(page, 'p-ooba')).toContainText('文本补全');
        await expect(card(page, 'p-ooba')).toContainText('http://127.0.0.1:5001');
        await expect(card(page, 'p-ooba')).toContainText('当前');

        await card(page, 'p-claude').locator('[data-api-connection-profile-apply]').click();
        const result = section(page).locator('[data-connection-result]');
        await expect(result).toContainText('档案“Claude 日常”');
        await expect(result).toContainText('已应用 4 项');
        await expect(result.locator('.is-applied', { hasText: '模型' })).toContainText('claude-sonnet-4');
        await expect(card(page, 'p-claude')).toContainText('当前');
        await expect(card(page, 'p-ooba')).not.toContainText('当前');

        const body = saves.at(-1);
        expect(body.main_api).toBe('openai');
        expect(body.chat_completion_source).toBe('claude');
        expect(body.oai_settings).toMatchObject({
            chat_completion_source: 'claude',
            claude_model: 'claude-sonnet-4',
            preset_settings_openai: 'Chat Preset B',
            temp_openai: 0.5,
            openai_max_tokens: 600,
            custom_model: 'custom/saved-model',
        });
        expect(body.extension_settings.connectionManager.selectedProfile).toBe('p-claude');
        expect(rotations).toEqual([{ key: 'api_key_claude', id: 'claude-2' }]);
        await expect.poll(() => bridgeCalls.filter(call => call.action === 'reloadSettings').length).toBe(1);

        // 页面上的编辑器跟着换成新的来源和模型
        await expect(page.locator('[data-api-source]')).toHaveValue('claude');
        await expect(page.locator('[data-api-model]')).toHaveValue('claude-sonnet-4');
        await expect(page.locator('.toast', { hasText: '已切换到“Claude 日常”' })).toBeVisible();
    });

    test('applying a text completion profile switches the main API and lists what cannot be applied', async ({ page }) => {
        const { saves } = await mockProfileWorkspace(page);
        await page.goto('/modern/?view=api');

        await card(page, 'p-ooba').locator('[data-api-connection-profile-apply]').click();
        const result = section(page).locator('[data-connection-result]');
        await expect(result).toContainText('已应用 3 项，跳过 1 项');
        await expect(result.locator('.is-skipped')).toContainText('系统提示词');
        await expect(result.locator('.is-skipped')).toContainText('暂不支持');

        expect(saves.at(-1).main_api).toBe('textgenerationwebui');
        expect(saves.at(-1).textgenerationwebui_settings).toMatchObject({ type: 'ooba', custom_model: 'local-model', server_urls: { ooba: 'http://127.0.0.1:5001' } });
        await expect(page.locator('[data-textgen-type]')).toHaveValue('ooba');
        await expect(page.locator('[data-textgen-endpoint]')).toHaveValue('http://127.0.0.1:5001');
    });

    test('deleting asks for a confirmation inside the card, and cancel keeps the profile', async ({ page }) => {
        const { saves, bridgeCalls } = await mockProfileWorkspace(page, { selectedProfile: 'p-claude' });
        await page.goto('/modern/?view=api');
        page.on('dialog', dialog => {
            throw new Error(`unexpected dialog: ${dialog.message()}`);
        });

        await card(page, 'p-claude').locator('[data-api-connection-profile-delete]').click();
        await expect(card(page, 'p-claude')).toContainText('确定删除“Claude 日常”');
        await expect(card(page, 'p-claude').locator('[data-api-connection-profile-delete-confirm]')).toBeFocused();
        expect(saves).toHaveLength(0);

        await card(page, 'p-claude').locator('[data-api-connection-profile-delete-cancel]').click();
        await expect(card(page, 'p-claude')).not.toContainText('确定删除');
        await expect(card(page, 'p-claude').locator('[data-api-connection-profile-delete]')).toBeFocused();
        expect(saves).toHaveLength(0);

        await card(page, 'p-claude').locator('[data-api-connection-profile-delete]').click();
        await card(page, 'p-claude').locator('[data-api-connection-profile-delete-confirm]').click();
        await expect(card(page, 'p-claude')).toHaveCount(0);
        await expect(card(page, 'p-ooba')).toBeVisible();

        const manager = saves.at(-1).extension_settings.connectionManager;
        expect(manager.profiles.map(profile => profile.id)).toEqual(['p-ooba']);
        expect(manager.selectedProfile).toBeNull();
        // 删档案不动当前连接设置
        expect(saves.at(-1).oai_settings.custom_model).toBe('custom/saved-model');
        await expect(page.locator('.toast', { hasText: '已删除连接档案' })).toBeVisible();
        await expect.poll(() => bridgeCalls.filter(call => call.action === 'reloadSettings').length).toBe(1);
    });

    test('a failed engine sync is reported next to the applied profile', async ({ page }) => {
        const { saves } = await mockProfileWorkspace(page, {
            bridgeOptions: { replies: { reloadSettings: () => { throw new Error('engine unavailable'); } } },
        });
        await page.goto('/modern/?view=api');

        await card(page, 'p-claude').locator('[data-api-connection-profile-apply]').click();
        await expect(section(page).locator('[data-connection-result]')).toContainText('生成引擎未能同步：engine unavailable');
        expect(saves.at(-1).oai_settings.claude_model).toBe('claude-sonnet-4');
    });

    test('saving the model records it in the recent-model list used by the chat switcher', async ({ page }) => {
        await mockProfileWorkspace(page);
        await page.goto('/modern/?view=api');

        await page.locator('[data-api-model]').fill('custom/new-model');
        await page.locator('[data-api-model]').blur();
        await expect(page.locator('[data-settings-save-status]')).toContainText('模型已保存');

        const recent = await page.evaluate(() => JSON.parse(localStorage.getItem('st-modern-recent-models') || '{}'));
        expect(recent['openai:custom']).toEqual(['custom/new-model']);
    });
});
