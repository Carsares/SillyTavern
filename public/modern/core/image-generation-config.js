/**
 * 图片生成（会话内生图）的配置与选项表：供应商列表、各供应商的尺寸 / 质量 / 风格候选、设置读取与请求参数组装。
 * 纯函数，不碰 DOM 和 localStorage，设置中心「图片模型」（components/settings-image-model.js）和聊天输入框的图片模式
 * （components/chat-image-composer.js）共用。后端契约见 docs/image-generation/BACKEND-DESIGN.md。
 *
 * 非密钥配置存在 settings.json 的 extension_settings.imageGeneration；密钥存在 secrets 的 api_key_image_generation，
 * secretId 留空时后端读当前激活的那条。不要用 extension_settings.sd：隐藏引擎里的旧版生图扩展会读它并自动出图。
 */

export const IMAGE_GENERATION_SETTINGS_KEY = 'imageGeneration';
export const IMAGE_GENERATION_SECRET_KEY = 'api_key_image_generation';
export const IMAGE_GENERATION_API = '/api/image-generation';

/** 第一期开放的供应商，id 与后端白名单一致（src/endpoints/image-generation.js 的 PROVIDERS）。 */
export const IMAGE_PROVIDERS = Object.freeze([
    { id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', requiresBaseUrl: false, requiresKey: true, models: ['gpt-image-1', 'dall-e-3'], baseUrlHint: '留空使用官方地址；用代理或自建网关时再填。' },
    { id: 'openai-compatible', label: 'OpenAI 兼容', defaultBaseUrl: '', requiresBaseUrl: true, requiresKey: true, models: [], baseUrlHint: '必须填写，服务需严格实现 OpenAI 的 /images/generations 接口。' },
    { id: 'google', label: 'Google Gemini / Imagen', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', requiresBaseUrl: false, requiresKey: true, models: ['gemini-2.5-flash-image', 'imagen-4.0-generate-001'], baseUrlHint: '留空使用官方地址。' },
    { id: 'openrouter', label: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', requiresBaseUrl: false, requiresKey: true, models: ['google/gemini-2.5-flash-image'], baseUrlHint: '留空使用官方地址。' },
    { id: 'novelai', label: 'NovelAI', defaultBaseUrl: 'https://image.novelai.net', requiresBaseUrl: false, requiresKey: true, models: ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated'], baseUrlHint: '留空使用官方地址。' },
    { id: 'automatic1111', label: '本地 SD WebUI', defaultBaseUrl: '', requiresBaseUrl: true, requiresKey: false, models: [], baseUrlHint: '必须填写，例如 http://127.0.0.1:7860；模型填 WebUI 里的模型名（checkpoint）。' },
].map(provider => Object.freeze(provider)));

export const DEFAULT_PROMPT_TEMPLATE = `You write prompts for an image generation model.
Based on the conversation excerpt and character appearance below, describe ONE single frame:
setting, time and lighting, characters present (appearance, outfit), pose and action, camera angle, mood and art style.
Output one English paragraph under 120 words. No dialogue, no explanations.`;

/** 「从消息生成」的勾选上限。 */
export const PROMPT_SOURCE_LIMITS = Object.freeze({ maxMessages: 20, maxCharacters: 6000 });

export const DEFAULT_IMAGE_GENERATION_CONFIG = Object.freeze({
    provider: 'openai',
    baseUrl: '',
    model: 'gpt-image-1',
    secretId: '',
    defaults: Object.freeze({ size: '1024x1024', aspectRatio: '1:1', quality: '', style: '', count: 1, negativePrompt: '', seed: null, steps: 28 }),
    promptGen: Object.freeze({ template: DEFAULT_PROMPT_TEMPLATE, defaultSelectCount: 3, includeAppearance: true }),
});

const SIZE_OPTIONS = Object.freeze({
    openai: [['1024x1024', '方图 1024×1024'], ['1024x1536', '竖图 1024×1536'], ['1536x1024', '横图 1536×1024']],
    'openai-compatible': [['1024x1024', '方图 1024×1024'], ['768x1024', '竖图 768×1024'], ['1024x768', '横图 1024×768']],
    novelai: [['832x1216', '竖图 832×1216'], ['1216x832', '横图 1216×832'], ['1024x1024', '方图 1024×1024']],
    automatic1111: [['512x768', '竖图 512×768'], ['768x512', '横图 768×512'], ['768x768', '方图 768×768'], ['1024x1024', '方图 1024×1024']],
});
const DALLE3_SIZES = [['1024x1024', '方图 1024×1024'], ['1024x1792', '竖图 1024×1792'], ['1792x1024', '横图 1792×1024']];
const ASPECT_OPTIONS = [['1:1', '1:1 方图'], ['3:4', '3:4 竖图'], ['4:3', '4:3 横图'], ['9:16', '9:16 竖屏'], ['16:9', '16:9 宽屏']];
const GPT_IMAGE_QUALITIES = [['', '默认'], ['auto', '自动'], ['low', '低'], ['medium', '中'], ['high', '高']];
const DALLE_QUALITIES = [['', '默认'], ['standard', '标准'], ['hd', '高清']];
const STYLE_OPTIONS = [['', '不指定'], ['vivid', '鲜艳'], ['natural', '自然']];

/**
 * @param {string} id 供应商 id。
 * @returns {typeof IMAGE_PROVIDERS[number] | null}
 */
export function getImageProvider(id) {
    return IMAGE_PROVIDERS.find(provider => provider.id === id) || null;
}

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * 读出图片生成配置并补齐默认值；不修改传入的 settings。
 * @param {any} settings settings.json 全文（state.settings）。
 * @returns {{ provider: string, baseUrl: string, model: string, secretId: string, defaults: Record<string, any>, promptGen: { template: string, defaultSelectCount: number, includeAppearance: boolean } }}
 */
export function getImageGenerationConfig(settings) {
    const raw = settings?.extension_settings?.[IMAGE_GENERATION_SETTINGS_KEY];
    const stored = isPlainObject(raw) ? raw : {};
    const defaults = { ...DEFAULT_IMAGE_GENERATION_CONFIG.defaults, ...(isPlainObject(stored.defaults) ? stored.defaults : {}) };
    const promptGen = { ...DEFAULT_IMAGE_GENERATION_CONFIG.promptGen, ...(isPlainObject(stored.promptGen) ? stored.promptGen : {}) };
    const count = Number(defaults.count);
    defaults.count = Number.isSafeInteger(count) && count >= 1 && count <= 4 ? count : 1;
    const selectCount = Number(promptGen.defaultSelectCount);
    promptGen.defaultSelectCount = Number.isSafeInteger(selectCount) && selectCount >= 1 && selectCount <= PROMPT_SOURCE_LIMITS.maxMessages ? selectCount : 3;
    promptGen.includeAppearance = promptGen.includeAppearance !== false;
    promptGen.template = typeof promptGen.template === 'string' && promptGen.template.trim() ? promptGen.template : DEFAULT_PROMPT_TEMPLATE;
    const provider = getImageProvider(stored.provider) ? stored.provider : DEFAULT_IMAGE_GENERATION_CONFIG.provider;
    return {
        provider,
        baseUrl: typeof stored.baseUrl === 'string' ? stored.baseUrl.trim() : '',
        model: typeof stored.model === 'string' ? stored.model.trim() : (provider === DEFAULT_IMAGE_GENERATION_CONFIG.provider ? DEFAULT_IMAGE_GENERATION_CONFIG.model : ''),
        secretId: typeof stored.secretId === 'string' ? stored.secretId : '',
        defaults,
        promptGen,
    };
}

/**
 * @param {Record<string, any>} secretState state.secretState（/api/secrets/read 的结果）。
 * @returns {boolean} 图片密钥是否已保存。
 */
export function isImageKeySaved(secretState) {
    const entries = secretState?.[IMAGE_GENERATION_SECRET_KEY];
    return Array.isArray(entries) ? entries.length > 0 : Boolean(entries);
}

/**
 * 配置是否齐全到可以发起生成（不发请求；供应商是否真的支持由 /capabilities 判断）。
 * @param {ReturnType<typeof getImageGenerationConfig>} config 图片配置。
 * @param {Record<string, any>} secretState state.secretState。
 * @returns {{ ok: boolean, reason: string }}
 */
export function getImageConfigReadiness(config, secretState) {
    const provider = getImageProvider(config?.provider);
    if (!provider) {
        return { ok: false, reason: '还没有选择图片供应商。' };
    }
    // 后端对所有供应商都要求模型（/capabilities 报 Explicit model required，/generate 报 model is required）
    if (!config.model) {
        return { ok: false, reason: '还没有填写图片模型。' };
    }
    if (provider.requiresBaseUrl && !config.baseUrl) {
        return { ok: false, reason: `${provider.label} 需要填写地址。` };
    }
    if (provider.requiresKey && !isImageKeySaved(secretState)) {
        return { ok: false, reason: '还没有保存图片模型的 API Key。' };
    }
    return { ok: true, reason: '' };
}

/**
 * 当前供应商 / 模型下各参数的候选值。返回值只是候选，最终能用哪些参数以 /capabilities 的 parameters 为准。
 * @param {string} providerId 供应商 id。
 * @param {string} model 模型名。
 * @returns {{ sizes: string[][], aspects: string[][], qualities: string[][], styles: string[][] }}
 */
export function getImageOptionTables(providerId, model = '') {
    const dalle = /^dall-e/i.test(model);
    return {
        sizes: providerId === 'openai' && /^dall-e-3/i.test(model) ? DALLE3_SIZES : (SIZE_OPTIONS[providerId] || SIZE_OPTIONS['openai-compatible']),
        aspects: ASPECT_OPTIONS,
        qualities: providerId === 'openai' ? (dalle ? DALLE_QUALITIES : GPT_IMAGE_QUALITIES) : DALLE_QUALITIES,
        styles: STYLE_OPTIONS,
    };
}

/**
 * @param {string} size 形如 "1024x1536"。
 * @returns {{ width: number, height: number } | null}
 */
export function parseImageSize(size) {
    const match = /^(\d{2,4})x(\d{2,4})$/.exec(String(size || '').trim());
    if (!match) {
        return null;
    }
    return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * 把界面上的参数（size、aspectRatio、quality、style、count、negativePrompt、seed、steps）转成 /generate 的请求字段，
 * 只保留供应商 parameters 里有的字段；空字符串和 null 视为不设置。
 * @param {Record<string, any>} values 界面参数（通常是配置默认值叠加本次修改）。
 * @param {string[]} parameters /capabilities 返回的 parameters。
 * @returns {Record<string, any>}
 */
export function buildImageRequestParams(values, parameters) {
    const allowed = new Set(Array.isArray(parameters) ? parameters : []);
    /** @type {Record<string, any>} */
    const result = {};
    const size = parseImageSize(values?.size);
    if (size && allowed.has('width') && allowed.has('height')) {
        result.width = size.width;
        result.height = size.height;
    }
    if (allowed.has('aspectRatio') && values?.aspectRatio) {
        result.aspectRatio = String(values.aspectRatio);
    }
    for (const key of ['quality', 'style', 'negativePrompt']) {
        if (allowed.has(key) && typeof values?.[key] === 'string' && values[key].trim()) {
            result[key] = values[key].trim();
        }
    }
    for (const key of ['count', 'seed', 'steps']) {
        const value = values?.[key];
        if (!allowed.has(key) || value === null || value === undefined || value === '') {
            continue;
        }
        const number = Number(value);
        if (Number.isSafeInteger(number) && number >= 0) {
            result[key] = number;
        }
    }
    return result;
}

/**
 * 图片参数在界面上的中文名（参数标签、不支持提示用）。
 */
export const IMAGE_PARAMETER_LABELS = Object.freeze({
    size: '尺寸',
    width: '尺寸',
    height: '尺寸',
    aspectRatio: '比例',
    quality: '质量',
    style: '风格',
    count: '数量',
    negativePrompt: '反向提示词',
    seed: '种子',
    steps: '步数',
    imageSize: '分辨率',
    outputFormat: '输出格式',
});
