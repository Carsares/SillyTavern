import { test, expect } from '@playwright/test';
import { mockBridgeFrame } from './modern-test-utils.js';

/* global localStorage */

// 设置中心「模型连接」→「图片模型」（docs/image-generation/FRONTEND-DESIGN.md 第 3 节）：
// 「文本模型 / 图片模型」切换、字段改动即保存到 extension_settings.imageGeneration、密钥、检查配置、两步确认的试生成。
// 后端的 /api/image-generation/* 和密钥接口都用 page.route 模拟，不会真的调用图片供应商。

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

const CAPABILITY_PARAMETERS = {
    openai: ['width', 'height', 'count', 'quality', 'style', 'outputFormat'],
    novelai: ['negativePrompt', 'width', 'height', 'count', 'seed', 'steps', 'scale', 'sampler', 'noiseSchedule', 'characters', 'useCoordinates'],
    google: ['aspectRatio', 'imageSize', 'count'],
};

const emptyPresets = () => ({
    textgenerationwebui_preset_names: [],
    textgenerationwebui_presets: [],
    openai_setting_names: [],
    openai_settings: [],
});

function json(route, body, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * 页面启动需要的接口，以及设置保存、密钥、图片生成接口。返回记录下来的请求和可变的服务端状态。
 * @param {import('@playwright/test').Page} page 页面
 * @param {{ settings?: Record<string, any>, secrets?: Record<string, any> }} [options] 初始设置和密钥状态
 */
async function mockImageModelShell(page, { settings = {}, secrets = {} } = {}) {
    // 设置保存后引擎会被要求重载；图片字段用 syncEngine: false，不应出现重载
    const bridgeCalls = await mockBridgeFrame(page);
    const server = {
        settingsBundle: {
            settings: JSON.stringify({
                main_api: 'openai',
                oai_settings: { chat_completion_source: 'openai', openai_model: 'gpt-4o' },
                ...settings,
            }),
            ...emptyPresets(),
        },
        secrets: { ...secrets },
        saves: [],
        secretWrites: [],
        secretDeletes: [],
        capabilityRequests: [],
        generateRequests: [],
        generateReply: null,
    };

    await page.route('**/csrf-token', route => json(route, { token: 'modern-image-model-test' }));
    await page.route('**/api/users/me', route => json(route, { handle: 'modern-test' }));
    await page.route('**/api/settings/get', route => json(route, server.settingsBundle));
    for (const path of ['characters/all', 'groups/all', 'worldinfo/list', 'backgrounds/all', 'extensions/discover']) {
        await page.route(`**/api/${path}`, route => json(route, []));
    }
    await page.route('**/api/backgrounds/folders', route => json(route, { folders: [], imageFolderMap: {} }));
    await page.route('**/api/assets/get', route => json(route, {}));
    await page.route('**/api/stats/get', route => json(route, {}));
    await page.route('**/api/secrets/settings', route => json(route, { allowKeysExposure: false }));
    await page.route('**/api/secrets/read', route => json(route, server.secrets));
    await page.route('**/api/secrets/write', route => {
        const body = route.request().postDataJSON();
        server.secretWrites.push(body);
        server.secrets[body.key] = [{ id: 'image-key-1', value: 'sk-i****cret', label: body.label, active: true }];
        return json(route, { id: 'image-key-1' });
    });
    await page.route('**/api/secrets/delete', route => {
        const body = route.request().postDataJSON();
        server.secretDeletes.push(body);
        server.secrets[body.key] = null;
        return route.fulfill({ status: 204, body: '' });
    });
    await page.route('**/api/settings/save', route => {
        const body = route.request().postDataJSON();
        server.saves.push(body);
        server.settingsBundle.settings = JSON.stringify(body);
        return json(route, { ok: true });
    });
    await page.route('**/api/image-generation/capabilities', route => {
        const body = route.request().postDataJSON();
        server.capabilityRequests.push(body);
        const parameters = CAPABILITY_PARAMETERS[body.provider] || CAPABILITY_PARAMETERS.openai;
        return json(route, {
            supported: Boolean(body.model),
            ...(body.model ? {} : { reason: 'Explicit model required' }),
            provider: body.provider,
            parameters,
            limits: { countMax: body.provider === 'google' ? 1 : 4, maxDimension: 4096, dimensionMultiple: body.provider === 'novelai' ? 64 : null },
            requiresBaseUrl: false,
            requiresKey: true,
            keySaved: Array.isArray(server.secrets.api_key_image_generation) && server.secrets.api_key_image_generation.length > 0,
        });
    });
    await page.route('**/api/image-generation/generate', route => {
        const body = route.request().postDataJSON();
        server.generateRequests.push(body);
        if (server.generateReply) {
            return server.generateReply(route, body);
        }
        return json(route, {
            requestId: body.requestId,
            status: 'completed',
            images: [{ path: '/user/images/图片模型测试/图片模型测试_2026-10-12@10h00m00s_1.png', mimeType: 'image/png', bytes: PNG_1X1.length, width: 1024, height: 1024 }],
            provider: body.provider,
            model: body.model,
            elapsedMs: 2400,
            incomplete: 0,
        });
    });
    await page.route('**/user/images/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }));
    return { server, bridgeCalls };
}

const imageForm = page => page.locator('[data-image-model-form]');
const field = (page, name) => page.locator(`[data-image-model-field="${name}"]`);
const saveStatus = page => page.locator('[data-settings-save-status]');
const lastImageSettings = server => server.saves.at(-1)?.extension_settings?.imageGeneration;

// 直接以「图片模型」视图打开：文本一侧不渲染，它自己的启动动作（例如登记模型服务时的设置保存）不会混进这里的断言
async function openImageModel(page) {
    await page.addInitScript(() => localStorage.setItem('st-modern-settings-connection-view', 'image'));
    await page.goto('/modern/?view=settings');
    await expect(page.locator('[data-settings-section="connection"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-settings-connection-view="image"]')).toHaveAttribute('aria-selected', 'true');
    await expect(imageForm(page)).toBeVisible();
}

test.describe('Modern settings: image model', () => {
    test('the 文本模型 / 图片模型 switch is remembered and keeps the image form out of the text form', async ({ page }) => {
        await mockImageModelShell(page);
        await page.goto('/modern/?view=settings');

        await expect(page.locator('[data-settings-connection-view="text"]')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('[data-test-api]')).toBeVisible();
        await expect(imageForm(page)).toHaveCount(0);

        await page.locator('[data-settings-connection-view="image"]').click();
        await expect(page.locator('[data-settings-connection-view="image"]')).toHaveAttribute('aria-selected', 'true');
        await expect(imageForm(page)).toBeVisible();
        await expect(page.locator('[data-api-connection-form]')).toHaveCount(0);
        await expect(page.locator('[data-preserve-inputs] [data-image-model-form]')).toHaveCount(1);
        // 改完即存：没有保存按钮
        await expect(imageForm(page).getByRole('button', { name: /保存/ })).toHaveCount(0);
        expect(await page.evaluate(() => localStorage.getItem('st-modern-settings-connection-view'))).toBe('image');

        await page.reload();
        await expect(imageForm(page)).toBeVisible();

        await page.locator('[data-settings-connection-view="text"]').click();
        await expect(imageForm(page)).toHaveCount(0);
        await expect(page.locator('[data-test-api]')).toBeVisible();
    });

    test('each field saves on change under extension_settings.imageGeneration without an engine reload', async ({ page }) => {
        const { server, bridgeCalls } = await mockImageModelShell(page);
        await openImageModel(page);

        await expect(field(page, 'provider')).toHaveValue('openai');
        await expect(field(page, 'model')).toHaveValue('gpt-image-1');
        await expect.poll(() => server.capabilityRequests.length).toBeGreaterThan(0);
        // OpenAI 不支持种子和反向提示词：置灰并写明原因
        await expect(field(page, 'seed')).toBeDisabled();
        await expect(field(page, 'negativePrompt')).toBeDisabled();
        await expect(page.locator('[data-image-model-unsupported="seed"]')).toHaveText('当前供应商不支持');
        await expect(field(page, 'quality')).toBeEnabled();

        await field(page, 'quality').selectOption('high');
        await expect.poll(() => lastImageSettings(server)?.defaults?.quality).toBe('high');
        await expect(saveStatus(page)).toContainText('默认质量已保存');

        // 常用模型按钮：点击填入并保存
        await page.locator('[data-image-model-suggestion="dall-e-3"]').click();
        await expect.poll(() => lastImageSettings(server)?.model).toBe('dall-e-3');
        await expect(field(page, 'model')).toHaveValue('dall-e-3');

        // 换供应商：供应商和模型一起保存，再按新组合读可用参数
        await field(page, 'provider').selectOption('novelai');
        await expect.poll(() => lastImageSettings(server)).toMatchObject({ provider: 'novelai', model: 'nai-diffusion-4-5-full' });
        await expect.poll(() => server.capabilityRequests.at(-1)).toEqual({ provider: 'novelai', model: 'nai-diffusion-4-5-full' });
        await expect(field(page, 'seed')).toBeEnabled();
        await expect(field(page, 'quality')).toBeDisabled();

        await field(page, 'seed').fill('1234');
        await field(page, 'seed').press('Enter');
        await expect.poll(() => lastImageSettings(server)?.defaults?.seed).toBe(1234);

        await field(page, 'promptSelectCount').selectOption('5');
        await expect.poll(() => lastImageSettings(server)?.promptGen?.defaultSelectCount).toBe(5);
        await field(page, 'promptAppearance').uncheck();
        await expect.poll(() => lastImageSettings(server)?.promptGen?.includeAppearance).toBe(false);

        expect(bridgeCalls.filter(call => /reload/i.test(call.action))).toEqual([]);
    });

    test('an invalid image field is not saved and does not block the text connection test', async ({ page }) => {
        const { server } = await mockImageModelShell(page);
        await openImageModel(page);
        await expect.poll(() => server.capabilityRequests.length).toBeGreaterThan(0);
        const savesBefore = server.saves.length;

        await field(page, 'baseUrl').fill('not a url');
        await field(page, 'baseUrl').press('Enter');
        await expect(page.locator('[data-image-model-field-error="baseUrl"]')).toContainText('完整地址');
        await expect(field(page, 'baseUrl')).toHaveAttribute('aria-invalid', 'true');
        await expect(saveStatus(page)).toContainText('有字段未保存');
        expect(server.saves.length).toBe(savesBefore);

        // 图片字段的报错留在图片表单里：文本连接的表单没有报错，「测试连接」照常可用（前端设计 F7）
        await page.locator('[data-settings-connection-view="text"]').click();
        await expect(page.locator('[data-api-connection-form] [data-api-field-error]')).toHaveCount(0);
        await expect(page.locator('[data-test-api]')).toBeEnabled();
    });

    test('the key is saved without being shown and can be cleared', async ({ page }) => {
        const { server } = await mockImageModelShell(page);
        await openImageModel(page);

        const keyInput = page.locator('[data-image-model-key]');
        await expect(page.locator('[data-image-model-secret-state]')).toHaveText('未保存');
        await keyInput.fill('sk-image-secret');
        await keyInput.press('Enter');

        await expect.poll(() => server.secretWrites).toEqual([{ key: 'api_key_image_generation', value: 'sk-image-secret', label: 'image-generation modern' }]);
        await expect(page.locator('[data-image-model-secret-state]')).toHaveText('已保存（sk-i****cret）');
        await expect(keyInput).toHaveValue('');
        await expect(page.locator('body')).not.toContainText('sk-image-secret');
        await expect(page.locator('[data-image-model-readiness]')).toHaveText('已配置');

        await page.locator('[data-image-model-clear-key]').click();
        await expect.poll(() => server.secretDeletes).toEqual([{ key: 'api_key_image_generation', id: 'image-key-1' }]);
        await expect(page.locator('[data-image-model-secret-state]')).toHaveText('未保存');
        await expect(page.locator('[data-image-model-test]')).toBeDisabled();
    });

    test('检查配置 reads the capabilities again and shows the result in the diagnostics card', async ({ page }) => {
        const { server } = await mockImageModelShell(page, {
            secrets: { api_key_image_generation: [{ id: 'saved', value: 'sk-****ved', label: 'saved', active: true }] },
        });
        await openImageModel(page);
        await expect.poll(() => server.capabilityRequests.length).toBe(1);

        await page.locator('[data-image-model-check]').click();
        await expect.poll(() => server.capabilityRequests.length).toBe(2);
        await expect(page.locator('[data-image-model-diag="check"]')).toHaveAttribute('data-image-model-diag-kind', 'ok');
        await expect(page.locator('[data-image-model-diag="check"]')).toContainText('不计费');
        await expect(page.locator('[data-image-model-diag="parameters"]')).toContainText('尺寸、数量、质量、风格');
        expect(server.generateRequests).toEqual([]);
    });

    test('试生成一张 needs a confirming second click, sends one image request and shows the result', async ({ page }) => {
        const { server } = await mockImageModelShell(page, {
            settings: { extension_settings: { imageGeneration: { provider: 'openai', model: 'gpt-image-1', defaults: { size: '1024x1536', count: 3 } } } },
            secrets: { api_key_image_generation: [{ id: 'saved', value: 'sk-****ved', label: 'saved', active: true }] },
        });
        await openImageModel(page);

        const testButton = page.locator('[data-image-model-test]');
        await testButton.click();
        await expect(testButton).toHaveText(/确认试生成（会按次计费）/);
        expect(server.generateRequests).toEqual([]);

        // 取消后回到初始状态
        await page.locator('[data-image-model-test-cancel]').click();
        await expect(testButton).toHaveText(/试生成一张/);

        await testButton.click();
        await testButton.click();
        await expect.poll(() => server.generateRequests.length).toBe(1);
        const body = server.generateRequests[0];
        expect(body).toMatchObject({
            provider: 'openai',
            model: 'gpt-image-1',
            characterName: '图片模型测试',
            prompt: 'A small red apple on a white table, studio lighting',
            width: 1024,
            height: 1536,
            count: 1,
        });
        expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);

        await expect(page.locator('[data-image-model-diag="test"]')).toHaveAttribute('data-image-model-diag-kind', 'ok');
        await expect(page.locator('[data-image-model-test-image] img')).toBeVisible();
        await expect(page.locator('[data-image-model-test-image] figcaption')).toContainText('/user/images/图片模型测试/');
    });

    test('a failed test generation shows the reason and whether it may have been billed', async ({ page }) => {
        const { server } = await mockImageModelShell(page, {
            secrets: { api_key_image_generation: [{ id: 'saved', value: 'sk-****ved', label: 'saved', active: true }] },
        });
        server.generateReply = route => json(route, { error: 'provider-http-error', message: 'Provider returned HTTP 400', detail: 'content policy violation', outcome: 'unknown' }, 502);
        await openImageModel(page);

        await page.locator('[data-image-model-test]').click();
        await page.locator('[data-image-model-test]').click();
        await expect(page.locator('[data-image-model-diag="test"]')).toHaveAttribute('data-image-model-diag-kind', 'error');
        await expect(page.locator('[data-image-model-diag="test"]')).toContainText('content policy violation');
        await expect(page.locator('[data-image-model-diag="test"]')).toContainText('可能已计费');
        await expect(page.locator('[data-image-model-test-image]')).toHaveCount(0);
    });
});
