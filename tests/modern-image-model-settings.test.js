import { describe, expect, jest, test } from '@jest/globals';

import {
    IMAGE_MODEL_TEST_CHARACTER,
    IMAGE_MODEL_TEST_PROMPT,
    buildImageModelTestRequest,
    createImageModelSettingsActions,
    describeImageCapabilityReason,
    describeImageModelError,
    describeImageModelParameters,
    ensureImageModelUiState,
    getImageModelParameterStates,
    resolveImageModelField,
    summarizeImageModelCheck,
} from '../public/modern/actions/image-model-settings.js';
import { createSettingsAutosave } from '../public/modern/actions/settings-autosave.js';
import { createSettingsImageModelComponents, renderSettingsConnectionViewSwitch } from '../public/modern/components/settings-image-model.js';
import { getImageGenerationConfig } from '../public/modern/core/image-generation-config.js';
import { getCapabilityCacheKey } from '../public/modern/core/image-generation-capabilities.js';

const OPENAI_PARAMETERS = ['width', 'height', 'count', 'quality', 'style', 'outputFormat'];
const OPENAI_CAPABILITY = {
    supported: true,
    provider: 'openai',
    parameters: OPENAI_PARAMETERS,
    limits: { countMax: 4, maxDimension: 4096, dimensionMultiple: null },
    requiresBaseUrl: false,
    requiresKey: true,
    keySaved: true,
};

const settingsWith = imageGeneration => ({ extension_settings: { imageGeneration } });
const pathOf = (...path) => ['extension_settings', 'imageGeneration', ...path];

function httpError(status, body) {
    const error = /** @type {Error & { status?: number, body?: string }} */ (new Error(`failed: ${status}`));
    error.status = status;
    error.body = typeof body === 'string' ? body : JSON.stringify(body);
    return error;
}

const flushTimers = () => new Promise(resolve => setTimeout(resolve, 0));

describe('resolveImageModelField', () => {
    test('writes under extension_settings.imageGeneration and reports the label', () => {
        const result = resolveImageModelField('quality', 'high', {});
        expect(result).toEqual({ field: 'quality', label: '默认质量', reloadsCapabilities: false, changes: [[pathOf('defaults', 'quality'), 'high']] });
        expect(resolveImageModelField('unknown', 'x', {})).toBeNull();
    });

    test('a provider change replaces a provider-specific model but keeps a model the user typed', () => {
        expect(resolveImageModelField('provider', 'novelai', settingsWith({ provider: 'openai', model: 'gpt-image-1' })).changes).toEqual([
            [pathOf('provider'), 'novelai'],
            [pathOf('model'), 'nai-diffusion-4-5-full'],
        ]);
        expect(resolveImageModelField('provider', 'automatic1111', settingsWith({ provider: 'openai', model: 'dall-e-3' })).changes).toEqual([
            [pathOf('provider'), 'automatic1111'],
            [pathOf('model'), ''],
        ]);
        expect(resolveImageModelField('provider', 'openai-compatible', settingsWith({ provider: 'openai', model: 'my-flux' })).changes).toEqual([
            [pathOf('provider'), 'openai-compatible'],
        ]);
        expect(resolveImageModelField('provider', 'provider', {}).reloadsCapabilities).toBe(true);
        expect(resolveImageModelField('provider', 'horde', {}).error).toBe('请选择图片供应商。');
    });

    test('the address is optional with a default, required otherwise, and must be a plain http(s) URL', () => {
        expect(resolveImageModelField('baseUrl', '  ', settingsWith({ provider: 'openai' })).changes).toEqual([[pathOf('baseUrl'), '']]);
        expect(resolveImageModelField('baseUrl', '', settingsWith({ provider: 'openai-compatible', model: 'x' })).error).toContain('必须填写地址');
        expect(resolveImageModelField('baseUrl', 'ftp://example.com', {}).error).toContain('http://');
        expect(resolveImageModelField('baseUrl', 'not a url', {}).error).toContain('完整地址');
        expect(resolveImageModelField('baseUrl', 'https://user:pass@example.com/v1', {}).error).toContain('账号或密码');
        expect(resolveImageModelField('baseUrl', 'https://example.com/v1?key=1', {}).error).toContain('查询参数');
        expect(resolveImageModelField('baseUrl', ' http://127.0.0.1:7860 ', settingsWith({ provider: 'automatic1111' })).changes)
            .toEqual([[pathOf('baseUrl'), 'http://127.0.0.1:7860']]);
    });

    test('the model is required except for a local SD WebUI', () => {
        expect(resolveImageModelField('model', ' ', settingsWith({ provider: 'openai' })).error).toBe('请填写图片模型。');
        expect(resolveImageModelField('model', '', settingsWith({ provider: 'automatic1111' })).changes).toEqual([[pathOf('model'), '']]);
        expect(resolveImageModelField('model', ' dall-e-3 ', {}).changes).toEqual([[pathOf('model'), 'dall-e-3']]);
    });

    test('size and aspect ratio follow their formats and the capability limits', () => {
        expect(resolveImageModelField('size', '1024x1536', {}).changes).toEqual([[pathOf('defaults', 'size'), '1024x1536']]);
        expect(resolveImageModelField('size', '', {}).changes).toEqual([[pathOf('defaults', 'size'), '']]);
        expect(resolveImageModelField('size', 'big', {}).error).toContain('宽x高');
        expect(resolveImageModelField('size', '5000x1000', {}, { limits: { maxDimension: 4096 } }).error).toContain('4096');
        expect(resolveImageModelField('size', '1000x1000', {}, { limits: { dimensionMultiple: 64 } }).error).toContain('64 的倍数');
        expect(resolveImageModelField('size', '832x1216', {}, { limits: { dimensionMultiple: 64 } }).error).toBeUndefined();
        expect(resolveImageModelField('aspectRatio', '16:9', {}).changes).toEqual([[pathOf('defaults', 'aspectRatio'), '16:9']]);
        expect(resolveImageModelField('aspectRatio', '0:9', {}).error).toContain('宽:高');
    });

    test('numbers: count within the model limit, seed and steps empty means not set', () => {
        expect(resolveImageModelField('count', '3', {}).changes).toEqual([[pathOf('defaults', 'count'), 3]]);
        expect(resolveImageModelField('count', '5', {}).error).toContain('1 到 4');
        expect(resolveImageModelField('count', '2', {}, { limits: { countMax: 1 } }).error).toBe('当前模型一次只能生成 1 张。');
        expect(resolveImageModelField('seed', '', {}).changes).toEqual([[pathOf('defaults', 'seed'), null]]);
        expect(resolveImageModelField('seed', '42', {}).changes).toEqual([[pathOf('defaults', 'seed'), 42]]);
        expect(resolveImageModelField('seed', '-1', {}).error).toContain('种子');
        expect(resolveImageModelField('seed', '1.5', {}).error).toContain('种子');
        expect(resolveImageModelField('steps', '', {}).changes).toEqual([[pathOf('defaults', 'steps'), null]]);
        expect(resolveImageModelField('steps', '0', {}).error).toContain('1 到 150');
        expect(resolveImageModelField('steps', '30', {}).changes).toEqual([[pathOf('defaults', 'steps'), 30]]);
    });

    test('prompt generation settings', () => {
        expect(resolveImageModelField('promptSelectCount', '5', {}).changes).toEqual([[pathOf('promptGen', 'defaultSelectCount'), 5]]);
        expect(resolveImageModelField('promptSelectCount', '21', {}).error).toContain('1 到 20');
        expect(resolveImageModelField('promptAppearance', false, {}).changes).toEqual([[pathOf('promptGen', 'includeAppearance'), false]]);
        expect(resolveImageModelField('promptAppearance', true, {}).changes).toEqual([[pathOf('promptGen', 'includeAppearance'), true]]);
        expect(resolveImageModelField('promptTemplate', '  Draw it.  ', {}).changes).toEqual([[pathOf('promptGen', 'template'), 'Draw it.']]);
        expect(resolveImageModelField('negativePrompt', 'x'.repeat(2001), {}).error).toContain('2000');
        expect(resolveImageModelField('quality', 'high; drop', {}).error).toContain('选项');
    });
});

describe('image model helpers', () => {
    test('backend failures read as one sentence with the billing outcome', () => {
        const http = describeImageModelError(httpError(502, { error: 'provider-http-error', message: 'Provider returned HTTP 400', detail: 'content policy', outcome: 'unknown' }));
        expect(http).toMatchObject({ code: 'provider-http-error', outcome: 'unknown', outcomeLabel: '可能已计费', uncertain: false });
        expect(http.text).toBe('供应商返回了错误：content policy');
        expect(describeImageModelError(httpError(400, { error: 'unsupported-provider', message: 'x', outcome: 'not-charged' })).outcomeLabel).toBe('未计费');
        expect(describeImageModelError(httpError(404, 'Not Found')).text).toContain('/api/image-generation');
        const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
        expect(describeImageModelError(abort)).toMatchObject({ uncertain: true, code: 'client-timeout' });
    });

    test('capability reasons are translated', () => {
        expect(describeImageCapabilityReason('Explicit model required')).toBe('需要填写模型。');
        expect(describeImageCapabilityReason('Something new')).toBe('Something new');
        expect(describeImageCapabilityReason('')).toBe('后端没有说明原因。');
    });

    test('parameter states follow the capability list and stay open while unknown', () => {
        expect(getImageModelParameterStates(OPENAI_PARAMETERS)).toEqual({
            size: true, aspectRatio: false, quality: true, count: true, style: true, negativePrompt: false, seed: false, steps: false,
        });
        expect(getImageModelParameterStates(['aspectRatio', 'imageSize', 'count'])).toMatchObject({ size: false, aspectRatio: true, count: true });
        expect(Object.values(getImageModelParameterStates(null)).every(value => value === null)).toBe(true);
        expect(describeImageModelParameters(OPENAI_PARAMETERS)).toEqual(['尺寸', '数量', '质量', '风格', '输出格式']);
    });

    test('the check summary explains unsupported setups and a missing key', () => {
        expect(summarizeImageModelCheck(OPENAI_CAPABILITY, 'OpenAI')).toMatchObject({ ok: true, level: 'ok' });
        expect(summarizeImageModelCheck(OPENAI_CAPABILITY, 'OpenAI').text).toContain('不计费');
        expect(summarizeImageModelCheck({ ...OPENAI_CAPABILITY, keySaved: false }, 'OpenAI').text).toContain('API Key');
        expect(summarizeImageModelCheck({ supported: false, reason: 'Explicit baseUrl required' }, 'OpenAI 兼容').text).toContain('需要填写地址');
    });

    test('the test request asks for exactly one image with the saved defaults the provider supports', () => {
        const config = getImageGenerationConfig(settingsWith({ provider: 'openai', model: 'gpt-image-1', defaults: { size: '1024x1536', quality: 'high', count: 4, seed: 7 } }));
        expect(buildImageModelTestRequest(config, OPENAI_PARAMETERS, 'id-1')).toEqual({
            requestId: 'id-1',
            provider: 'openai',
            model: 'gpt-image-1',
            baseUrl: '',
            characterName: IMAGE_MODEL_TEST_CHARACTER,
            prompt: IMAGE_MODEL_TEST_PROMPT,
            width: 1024,
            height: 1536,
            quality: 'high',
            count: 1,
        });
    });
});

function createFixture({ settings = settingsWith({ provider: 'openai', model: 'gpt-image-1' }), secretState = {}, failSave = false, routes = {} } = {}) {
    const state = { settings, secretState, imageModelSettings: {}, errors: [] };
    const calls = [];
    const toasts = [];
    const apiFetch = jest.fn(async (path, options = {}) => {
        calls.push({ path, body: options.body ? structuredClone(options.body) : undefined, method: options.method || 'POST' });
        if (routes[path]) {
            return routes[path](options);
        }
        if (path === '/api/settings/save') {
            if (failSave) {
                throw new Error('disk full');
            }
            return {};
        }
        if (path === '/api/image-generation/capabilities') {
            return { ...OPENAI_CAPABILITY, provider: options.body.provider };
        }
        if (path === '/api/secrets/write') {
            return { id: 'new-key' };
        }
        if (path === '/api/secrets/read') {
            return {};
        }
        if (path === '/api/secrets/delete') {
            return null;
        }
        throw new Error(`unexpected ${path}`);
    });
    const reloadSettings = jest.fn(async () => ({ ok: true }));
    const showToast = (title, message) => toasts.push({ title, message });
    const settingsAutosave = createSettingsAutosave({ state, apiFetch, showToast, reloadSettings });
    const render = jest.fn();
    const actions = createImageModelSettingsActions({
        state,
        apiFetch,
        apiFetchResponse: jest.fn(),
        loadData: jest.fn(),
        render,
        renderInspector: jest.fn(),
        showToast,
        callLegacyBridge: jest.fn(),
        subscribeProgress: jest.fn(),
        bridgeReload: {},
        actionRegistry: { apiConnectionActions: { settingsAutosave } },
    });
    const paths = () => calls.map(call => call.path);
    return { state, calls, paths, toasts, apiFetch, reloadSettings, settingsAutosave, render, actions };
}

describe('image model settings actions', () => {
    test('exports uniquely prefixed action names', () => {
        const { actions } = createFixture();
        expect(Object.keys(actions).sort()).toEqual([
            'cancelImageModelTest',
            'checkImageModelConfig',
            'clearImageModelSecret',
            'ensureImageModelCapabilities',
            'refreshImageModelCapabilities',
            'runImageModelTest',
            'saveImageModelField',
            'saveImageModelSecret',
            'setSettingsConnectionView',
        ]);
    });

    test('a default parameter saves on its own without asking the engine to reload', async () => {
        const fixture = createFixture();
        const result = await fixture.actions.saveImageModelField('quality', 'high');
        await fixture.settingsAutosave.flush();

        expect(result).toEqual({ ok: true, handled: true, unchanged: false });
        expect(fixture.state.settings.extension_settings.imageGeneration.defaults).toEqual({ quality: 'high' });
        expect(fixture.paths()).toEqual(['/api/settings/save']);
        expect(fixture.reloadSettings).not.toHaveBeenCalled();
        expect(fixture.settingsAutosave.getStatus()).toMatchObject({ phase: 'saved', message: '默认质量已保存' });
    });

    test('a provider change saves provider and model together, then reads the new capabilities', async () => {
        const fixture = createFixture();
        await fixture.actions.saveImageModelField('provider', 'novelai');

        expect(fixture.state.settings.extension_settings.imageGeneration).toMatchObject({ provider: 'novelai', model: 'nai-diffusion-4-5-full' });
        expect(fixture.paths()).toEqual(['/api/settings/save', '/api/image-generation/capabilities']);
        expect(fixture.calls[1].body).toEqual({ provider: 'novelai', model: 'nai-diffusion-4-5-full' });
        const key = getCapabilityCacheKey({ provider: 'novelai', model: 'nai-diffusion-4-5-full', baseUrl: '' });
        expect(fixture.state.imageModelSettings.capabilities.get(key)).toMatchObject({ provider: 'novelai' });
        expect(ensureImageModelUiState(fixture.state).capabilityStatus).toEqual({ key, loading: false, error: '' });
        expect(fixture.render).toHaveBeenCalled();
    });

    test('an invalid value is not saved and marks the status', async () => {
        const fixture = createFixture();
        const result = await fixture.actions.saveImageModelField('seed', '-3');

        expect(result).toMatchObject({ ok: false, handled: true, invalid: true });
        expect(fixture.apiFetch).not.toHaveBeenCalled();
        expect(fixture.settingsAutosave.getStatus()).toMatchObject({ phase: 'error', message: '有字段未保存' });
    });

    test('a failed save restores the stored value and reports it', async () => {
        const fixture = createFixture({ failSave: true });
        const result = await fixture.actions.saveImageModelField('model', 'dall-e-3');

        expect(result).toEqual({ ok: false, handled: true, error: 'disk full' });
        expect(fixture.state.settings.extension_settings.imageGeneration.model).toBe('gpt-image-1');
        expect(fixture.toasts).toEqual([{ title: '图片模型保存失败', message: 'disk full' }]);
        expect(fixture.paths()).toEqual(['/api/settings/save']);
    });

    test('an unknown field is left to other handlers', async () => {
        const fixture = createFixture();
        expect(await fixture.actions.saveImageModelField('nope', 'x')).toEqual({ ok: false, handled: false });
    });

    test('the key is written to its own secret and the capabilities are read again', async () => {
        const fixture = createFixture();
        expect(await fixture.actions.saveImageModelSecret('   ')).toEqual({ ok: true, unchanged: true });
        const result = await fixture.actions.saveImageModelSecret(' sk-image ');

        // commitSecret may or may not return the new entry id; the image config keeps secretId empty either way
        expect(result).toMatchObject({ ok: true });
        expect(fixture.calls[0]).toEqual({ path: '/api/secrets/write', body: { key: 'api_key_image_generation', value: 'sk-image', label: 'image-generation modern' }, method: 'POST' });
        expect(fixture.paths()).toEqual(['/api/secrets/write', '/api/secrets/read', '/api/image-generation/capabilities']);
        expect(fixture.settingsAutosave.getStatus()).toMatchObject({ message: '图片模型 API Key 已保存' });
    });

    test('clearing removes every saved image key entry', async () => {
        const fixture = createFixture({
            secretState: { api_key_image_generation: [{ id: 'a', value: '****1', active: true }, { id: 'b', value: '****2', active: false }] },
        });
        const result = await fixture.actions.clearImageModelSecret();

        expect(result).toEqual({ ok: true });
        expect(fixture.calls.filter(call => call.path === '/api/secrets/delete').map(call => call.body)).toEqual([
            { key: 'api_key_image_generation', id: 'a' },
            { key: 'api_key_image_generation', id: 'b' },
        ]);
        expect(fixture.state.secretState).toEqual({});
        expect(fixture.toasts[0].title).toBe('图片模型 API Key 已清除');
    });

    test('checking forces a capabilities read and keeps the result', async () => {
        const fixture = createFixture({ secretState: { api_key_image_generation: [{ id: 'a', active: true }] } });
        const key = getCapabilityCacheKey({ provider: 'openai', model: 'gpt-image-1', baseUrl: '' });
        ensureImageModelUiState(fixture.state).capabilities.set(key, { supported: false, reason: 'stale' });
        const check = await fixture.actions.checkImageModelConfig();

        expect(fixture.paths()).toEqual(['/api/image-generation/capabilities']);
        expect(check).toMatchObject({ running: false, ok: true, level: 'ok' });
        expect(check.text).toContain('OpenAI 支持当前配置');
        expect(fixture.state.imageModelSettings.check).toBe(check);
    });

    test('a capabilities failure is shown as text and not retried automatically', async () => {
        const fixture = createFixture({
            routes: { '/api/image-generation/capabilities': () => { throw httpError(400, { error: 'unsupported-provider', message: 'x', outcome: 'not-charged' }); } },
        });
        fixture.actions.ensureImageModelCapabilities();
        await flushTimers();
        await flushTimers();
        fixture.actions.ensureImageModelCapabilities();
        await flushTimers();

        expect(fixture.paths()).toEqual(['/api/image-generation/capabilities']);
        expect(ensureImageModelUiState(fixture.state).capabilityStatus).toMatchObject({ loading: false, error: '后端不支持这个图片供应商。' });
        const check = await fixture.actions.checkImageModelConfig();
        expect(check).toMatchObject({ ok: false, level: 'error', text: '检查失败：后端不支持这个图片供应商。' });
    });

    test('the test generation needs two calls and then posts one image request', async () => {
        const fixture = createFixture({
            settings: settingsWith({ provider: 'openai', model: 'gpt-image-1', defaults: { size: '1024x1536', count: 3 } }),
            secretState: { api_key_image_generation: [{ id: 'a', active: true }] },
            routes: {
                '/api/image-generation/generate': () => ({
                    requestId: 'r', status: 'completed', elapsedMs: 12000,
                    images: [{ path: '/user/images/图片模型测试/图片模型测试_2026-10-12@10h00m00s_1.png', width: 1024, height: 1536 }],
                }),
            },
        });

        expect(await fixture.actions.runImageModelTest()).toBeNull();
        expect(fixture.state.imageModelSettings.test.confirming).toBe(true);
        expect(fixture.apiFetch).not.toHaveBeenCalled();

        const result = await fixture.actions.runImageModelTest();
        const generate = fixture.calls.find(call => call.path === '/api/image-generation/generate');
        expect(generate.body).toMatchObject({
            provider: 'openai', model: 'gpt-image-1', baseUrl: '', characterName: '图片模型测试',
            prompt: 'A small red apple on a white table, studio lighting', width: 1024, height: 1536, count: 1,
        });
        expect(generate.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
        expect(result).toMatchObject({ ok: true, imageCount: 1, elapsedMs: 12000, text: '生成成功，用时 12.0 秒。' });
        expect(result.image.path).toBe('/user/images/图片模型测试/图片模型测试_2026-10-12@10h00m00s_1.png');
        expect(fixture.state.imageModelSettings.test).toMatchObject({ confirming: false, running: false, result });
    });

    test('cancelling the confirmation sends nothing', async () => {
        const fixture = createFixture({ secretState: { api_key_image_generation: [{ id: 'a', active: true }] } });
        await fixture.actions.runImageModelTest();
        fixture.actions.cancelImageModelTest();
        expect(fixture.state.imageModelSettings.test.confirming).toBe(false);
        expect(fixture.apiFetch).not.toHaveBeenCalled();
    });

    test('a test without a saved key is refused before any request', async () => {
        const fixture = createFixture();
        await fixture.actions.runImageModelTest();
        const result = await fixture.actions.runImageModelTest();
        expect(result).toMatchObject({ ok: false, outcome: 'not-charged', text: '还没有保存图片模型的 API Key。' });
        expect(fixture.apiFetch).not.toHaveBeenCalled();
    });

    test('a provider error keeps its billing outcome', async () => {
        const fixture = createFixture({
            secretState: { api_key_image_generation: [{ id: 'a', active: true }] },
            routes: { '/api/image-generation/generate': () => { throw httpError(502, { error: 'provider-http-error', message: 'm', detail: 'quota exceeded', outcome: 'unknown' }); } },
        });
        await fixture.actions.runImageModelTest();
        const result = await fixture.actions.runImageModelTest();
        expect(result).toMatchObject({ ok: false, outcome: 'unknown', outcomeLabel: '可能已计费', text: '供应商返回了错误：quota exceeded' });
        expect(fixture.paths().filter(path => path.startsWith('/api/image-generation/requests/'))).toEqual([]);
    });

    test('a lost connection looks the result up instead of submitting again', async () => {
        const fixture = createFixture({
            secretState: { api_key_image_generation: [{ id: 'a', active: true }] },
            routes: {
                '/api/image-generation/generate': () => { throw new TypeError('Failed to fetch'); },
            },
        });
        fixture.apiFetch.mockImplementation(async (path, options = {}) => {
            fixture.calls.push({ path, body: options.body, method: options.method || 'POST' });
            if (path === '/api/image-generation/generate') {
                throw new TypeError('Failed to fetch');
            }
            if (path.startsWith('/api/image-generation/requests/')) {
                return { status: 'completed', images: [{ path: '/user/images/x/x_1.png' }] };
            }
            return { ...OPENAI_CAPABILITY };
        });
        await fixture.actions.runImageModelTest();
        const result = await fixture.actions.runImageModelTest();

        const lookups = fixture.calls.filter(call => call.path.startsWith('/api/image-generation/requests/'));
        expect(lookups).toHaveLength(1);
        expect(lookups[0].method).toBe('GET');
        expect(fixture.calls.filter(call => call.path === '/api/image-generation/generate')).toHaveLength(1);
        expect(result).toMatchObject({ ok: true, image: { path: '/user/images/x/x_1.png' } });
    });

    test('the connection view switch is remembered in state', () => {
        const fixture = createFixture();
        expect(fixture.actions.setSettingsConnectionView('image')).toBe('image');
        expect(fixture.state.settingsConnectionView).toBe('image');
        expect(fixture.actions.setSettingsConnectionView('bogus')).toBe('text');
    });
});

describe('settings image model component', () => {
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[char]);

    function renderWith({ settings = settingsWith({ provider: 'openai', model: 'gpt-image-1' }), secretState = {}, capability = OPENAI_CAPABILITY } = {}) {
        const state = { settings: { main_api: 'openai', ...settings }, secretState, imageModelSettings: {} };
        const config = getImageGenerationConfig(state.settings);
        const ui = ensureImageModelUiState(state);
        if (capability) {
            ui.capabilities.set(getCapabilityCacheKey(config), capability);
        }
        const ensureImageModelCapabilities = jest.fn();
        const { renderImageModelSettings } = createSettingsImageModelComponents({
            state,
            escapeHtml,
            getProviderInfo: () => ({ api: 'openai', chatSource: 'openai', model: 'gpt-4o' }),
            getNumberSetting: (_settings, _key, fallback) => fallback,
            ensureImageModelCapabilities,
        });
        return { html: renderImageModelSettings(), ensureImageModelCapabilities, state };
    }

    test('renders its own form container with stable field attributes and no save button', () => {
        const { html, ensureImageModelCapabilities } = renderWith();
        expect(ensureImageModelCapabilities).toHaveBeenCalledTimes(1);
        expect(html).toContain('data-image-model-form');
        expect(html).not.toContain('data-api-connection-form');
        for (const field of ['provider', 'baseUrl', 'model', 'size', 'quality', 'count', 'style', 'seed', 'steps', 'negativePrompt', 'promptTemplate', 'promptSelectCount', 'promptAppearance']) {
            expect(html).toContain(`data-image-model-field="${field}"`);
        }
        expect(html).toContain('data-image-model-key');
        expect(html).toContain('data-image-model-check');
        expect(html).toContain('data-image-model-test');
        expect(html).toContain('data-image-model-suggestion="dall-e-3"');
        expect(html).toContain('跟随当前文本连接');
        expect(html).not.toMatch(/<\/i>\s*保存图片模型\s*<\/button>/);
        expect(html).not.toMatch(/data-[a-z-]*save[a-z-]*/);
    });

    test('fields the provider does not support are disabled with the reason', () => {
        const { html } = renderWith();
        expect(html).toMatch(/data-image-model-field="seed"[^>]*disabled/);
        expect(html).toMatch(/data-image-model-field="negativePrompt"[^>]*disabled/);
        expect(html).not.toMatch(/data-image-model-field="quality"[^>]*disabled/);
        expect(html).toContain('data-image-model-unsupported="seed"');
        expect(html).toContain('当前供应商不支持');
        // OpenAI 用尺寸，不显示比例
        expect(html).not.toContain('data-image-model-field="aspectRatio"');
    });

    test('a Gemini model shows the aspect ratio instead of the size and caps the count at one', () => {
        const { html } = renderWith({
            settings: settingsWith({ provider: 'google', model: 'gemini-2.5-flash-image' }),
            capability: { supported: true, parameters: ['aspectRatio', 'imageSize', 'count'], limits: { countMax: 1 }, requiresKey: true, keySaved: false },
        });
        expect(html).toContain('data-image-model-field="aspectRatio"');
        expect(html).not.toContain('data-image-model-field="size"');
        expect(html).not.toMatch(/<option value="2"[^>]*>2 张/);
    });

    test('a saved key shows its masked value and a clear button; the test button needs a ready config', () => {
        const saved = renderWith({ secretState: { api_key_image_generation: [{ id: 'a', value: 'sk-****abcd', active: true }] } }).html;
        expect(saved).toContain('已保存（sk-****abcd）');
        expect(saved).toContain('data-image-model-clear-key');
        expect(saved).toMatch(/<button class="primary-button" type="button" data-image-model-test\s+title=/);

        const missing = renderWith().html;
        expect(missing).not.toContain('data-image-model-clear-key');
        expect(missing).toMatch(/data-image-model-test disabled/);
        expect(missing).toContain('还没有保存图片模型的 API Key。');
    });

    test('the confirmation state and the last test image are rendered', () => {
        const fixture = renderWith({ secretState: { api_key_image_generation: [{ id: 'a', value: 'x', active: true }] } });
        const ui = ensureImageModelUiState(fixture.state);
        ui.test.confirming = true;
        ui.test.result = { ok: true, at: Date.now(), requestId: 'r', text: '生成成功。', image: { path: '/user/images/图片模型测试/a b.png', width: 1024, height: 1024 }, imageCount: 1 };
        const { renderImageModelSettings } = createSettingsImageModelComponents({
            state: fixture.state,
            escapeHtml,
            getProviderInfo: () => ({}),
            getNumberSetting: (_settings, _key, fallback) => fallback,
        });
        const html = renderImageModelSettings();
        expect(html).toContain('确认试生成（会按次计费）');
        expect(html).toContain('data-image-model-test-cancel');
        expect(html).toContain(`src="${encodeURI('/user/images/图片模型测试/a b.png')}"`);
    });

    test('the view switch marks the active side', () => {
        const html = renderSettingsConnectionViewSwitch('image', escapeHtml);
        expect(html).toMatch(/class="active"[^>]*data-settings-connection-view="image" aria-selected="true"/);
        expect(html).toMatch(/data-settings-connection-view="text" aria-selected="false"/);
    });
});
