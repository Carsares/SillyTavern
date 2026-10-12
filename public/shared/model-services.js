// 模型服务登记表和场景模型的纯函数部分，浏览器（public/modern）和服务端（src/endpoints/model-services.js）共用。
// 没有网络、DOM 或文件依赖。
//
// 存储：settings.json 的 extension_settings.modelServices
//   services[]  { id, name, provider, baseUrl, secretKey, secretId, defaultModel }
//               provider 用聊天补全来源 id；密钥存在该来源原有的密钥名（secretKey）下，secretId 指向其中一条。
//   scenes.chat         { serviceId }  对话场景用哪个服务；选中时由现代页把来源、地址、模型写进 oai_settings 并把密钥切为当前。
//   scenes.translation  { serviceId, model, maxOutputTokens }  serviceId 为空表示跟随对话场景。

/**
 * 可以登记为模型服务的来源：聊天补全来源里，服务端适配器（src/conversation/capabilities/chat）能直接调用的那些。
 * requiresBaseUrl：没有固定地址，必须填写。modelField：对话场景把模型写进 oai_settings 的哪个字段。
 * @type {Readonly<Record<string, Readonly<{ label: string, secretKey: string, modelField: string, requiresBaseUrl: boolean }>>>}
 */
export const MODEL_SERVICE_PROVIDERS = Object.freeze({
    custom: Object.freeze({ label: 'OpenAI 兼容（自定义地址）', secretKey: 'api_key_custom', modelField: 'custom_model', requiresBaseUrl: true }),
    deepseek: Object.freeze({ label: 'DeepSeek', secretKey: 'api_key_deepseek', modelField: 'deepseek_model', requiresBaseUrl: false }),
    openai: Object.freeze({ label: 'OpenAI', secretKey: 'api_key_openai', modelField: 'openai_model', requiresBaseUrl: false }),
    openrouter: Object.freeze({ label: 'OpenRouter', secretKey: 'api_key_openrouter', modelField: 'openrouter_model', requiresBaseUrl: false }),
    siliconflow: Object.freeze({ label: 'SiliconFlow', secretKey: 'api_key_siliconflow', modelField: 'siliconflow_model', requiresBaseUrl: false }),
    claude: Object.freeze({ label: 'Claude', secretKey: 'api_key_claude', modelField: 'claude_model', requiresBaseUrl: false }),
    makersuite: Object.freeze({ label: 'Google AI Studio', secretKey: 'api_key_makersuite', modelField: 'google_model', requiresBaseUrl: false }),
    mistralai: Object.freeze({ label: 'MistralAI', secretKey: 'api_key_mistralai', modelField: 'mistralai_model', requiresBaseUrl: false }),
    groq: Object.freeze({ label: 'Groq', secretKey: 'api_key_groq', modelField: 'groq_model', requiresBaseUrl: false }),
    xai: Object.freeze({ label: 'xAI', secretKey: 'api_key_xai', modelField: 'xai_model', requiresBaseUrl: false }),
    moonshot: Object.freeze({ label: 'Moonshot', secretKey: 'api_key_moonshot', modelField: 'moonshot_model', requiresBaseUrl: false }),
    zai: Object.freeze({ label: 'Z.AI', secretKey: 'api_key_zai', modelField: 'zai_model', requiresBaseUrl: false }),
    perplexity: Object.freeze({ label: 'Perplexity', secretKey: 'api_key_perplexity', modelField: 'perplexity_model', requiresBaseUrl: false }),
    cohere: Object.freeze({ label: 'Cohere', secretKey: 'api_key_cohere', modelField: 'cohere_model', requiresBaseUrl: false }),
    ai21: Object.freeze({ label: 'AI21', secretKey: 'api_key_ai21', modelField: 'ai21_model', requiresBaseUrl: false }),
    fireworks: Object.freeze({ label: 'Fireworks', secretKey: 'api_key_fireworks', modelField: 'fireworks_model', requiresBaseUrl: false }),
    pollinations: Object.freeze({ label: 'Pollinations', secretKey: 'api_key_pollinations', modelField: 'pollinations_model', requiresBaseUrl: false }),
});

/** 场景 id。对话场景之外的场景都可以「跟随对话场景」。 */
export const MODEL_SCENES = Object.freeze(['chat', 'translation']);

/** 翻译场景的默认回复上限和适配器要求的上下文窗口。 */
export const DEFAULT_TRANSLATION_MAX_OUTPUT_TOKENS = 4096;
export const DEFAULT_SCENE_CONTEXT_WINDOW = 128000;
const MAX_TRANSLATION_OUTPUT_TOKENS = 65536;

const MAX_NAME_LENGTH = 80;
const MAX_FIELD_LENGTH = 2048;

/**
 * @typedef {object} ModelService
 * @property {string} id 服务 id
 * @property {string} name 显示名
 * @property {string} provider 来源 id（MODEL_SERVICE_PROVIDERS 的键）
 * @property {string} baseUrl 地址，没有固定地址的来源才需要
 * @property {string} secretKey 密钥名
 * @property {string} secretId 密钥条目 id，空表示还没有保存密钥
 * @property {string} defaultModel 默认模型
 *
 * @typedef {object} ModelServiceRegistry
 * @property {ModelService[]} services 服务列表
 * @property {{ chat: { serviceId: string }, translation: { serviceId: string, model: string, maxOutputTokens: number } }} scenes 场景
 */

/**
 * @param {unknown} value 值
 * @param {number} [limit] 长度上限
 * @returns {string} 去掉首尾空白的字符串，不是字符串时为空
 */
function text(value, limit = MAX_FIELD_LENGTH) {
    return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

/**
 * @param {unknown} value 地址
 * @returns {boolean} 是否为不带账号、查询和锚点的 http(s) 地址
 */
export function isServiceBaseUrl(value) {
    try {
        const url = new URL(String(value));
        return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash;
    } catch {
        return false;
    }
}

/**
 * 整理一条服务记录；来源不认识的记录返回 null。
 * @param {unknown} value 原始记录
 * @returns {ModelService | null} 记录
 */
export function normalizeModelService(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const record = /** @type {Record<string, unknown>} */ (value);
    const provider = text(record.provider, 64);
    const profile = MODEL_SERVICE_PROVIDERS[provider];
    const id = text(record.id, 128);
    if (!profile || !id) {
        return null;
    }
    return {
        id,
        name: text(record.name, MAX_NAME_LENGTH) || profile.label,
        provider,
        baseUrl: text(record.baseUrl),
        secretKey: profile.secretKey,
        secretId: text(record.secretId, 128),
        defaultModel: text(record.defaultModel, 512),
    };
}

/**
 * 读出登记表，缺的部分补默认值。
 * @param {Record<string, any> | null | undefined} settings settings.json 内容
 * @returns {ModelServiceRegistry} 登记表
 */
export function readModelServices(settings) {
    const raw = settings?.extension_settings?.modelServices;
    const services = (Array.isArray(raw?.services) ? raw.services : []).map(normalizeModelService).filter(Boolean);
    const translation = raw?.scenes?.translation ?? {};
    const maxOutputTokens = Number(translation.maxOutputTokens);
    return {
        services: /** @type {ModelService[]} */ (services),
        scenes: {
            chat: { serviceId: text(raw?.scenes?.chat?.serviceId, 128) },
            translation: {
                serviceId: text(translation.serviceId, 128),
                model: text(translation.model, 512),
                maxOutputTokens: Number.isSafeInteger(maxOutputTokens) && maxOutputTokens > 0 && maxOutputTokens <= MAX_TRANSLATION_OUTPUT_TOKENS
                    ? maxOutputTokens
                    : DEFAULT_TRANSLATION_MAX_OUTPUT_TOKENS,
            },
        },
    };
}

/** 服务记录问题代码对应的说明。 */
const SERVICE_PROBLEM_TEXT = Object.freeze({
    'unsupported-provider': '不支持的服务类型',
    'base-url-missing': '还没有填写服务地址',
    'base-url-invalid': '服务地址需是以 http:// 或 https:// 开头的完整地址',
    'secret-missing': '还没有保存 API Key',
});

/**
 * 服务记录里还缺什么；没有问题时为空字符串。
 * @param {ModelService} service 服务
 * @returns {'' | 'unsupported-provider' | 'base-url-missing' | 'base-url-invalid' | 'secret-missing'} 问题代码
 */
export function getServiceProblem(service) {
    const profile = MODEL_SERVICE_PROVIDERS[service?.provider];
    if (!profile) {
        return 'unsupported-provider';
    }
    if (profile.requiresBaseUrl && !service.baseUrl) {
        return 'base-url-missing';
    }
    if (service.baseUrl && !isServiceBaseUrl(service.baseUrl)) {
        return 'base-url-invalid';
    }
    if (!service.secretId) {
        return 'secret-missing';
    }
    return '';
}

/**
 * @param {ModelService} service 服务
 * @returns {string} 问题说明，没有问题时为空字符串
 */
export function describeServiceProblem(service) {
    return SERVICE_PROBLEM_TEXT[getServiceProblem(service)] || '';
}

/**
 * 当前对话连接对应的「隐含服务」：还没有登记服务、或对话场景没有选服务时，用 oai_settings 和该来源当前启用的密钥。
 * 主 API 不是聊天补全、或来源不能作为模型服务时返回 null。
 * @param {Record<string, any> | null | undefined} settings settings.json 内容
 * @returns {{ service: ModelService, model: string } | null} 服务和对话正在用的模型
 */
export function readChatConnectionService(settings) {
    if ((settings?.main_api || 'openai') !== 'openai') {
        return null;
    }
    const oai = settings?.oai_settings ?? {};
    const provider = text(oai.chat_completion_source || settings?.chat_completion_source, 64);
    const profile = MODEL_SERVICE_PROVIDERS[provider];
    if (!profile) {
        return null;
    }
    return {
        service: {
            id: '',
            name: profile.label,
            provider,
            baseUrl: provider === 'custom' ? text(oai.custom_url) : '',
            secretKey: profile.secretKey,
            secretId: '',
            defaultModel: '',
        },
        model: text(oai[profile.modelField], 512),
    };
}

/**
 * @typedef {object} SceneTarget
 * @property {ModelService} service 服务
 * @property {string} model 模型
 * @property {boolean} implicit 服务来自当前对话连接（未登记）：密钥用该来源当前启用的那条
 * @property {boolean} followsChat 由「跟随对话场景」得到
 * @property {number} maxOutputTokens 回复上限
 */

/**
 * 解析一个场景实际用的服务和模型。找不到时抛出带 code 的错误：scene-not-configured、service-not-found、model-missing。
 * @param {Record<string, any> | null | undefined} settings settings.json 内容
 * @param {string} scene 场景 id
 * @returns {SceneTarget} 目标
 */
export function resolveSceneTarget(settings, scene) {
    if (!MODEL_SCENES.includes(scene)) {
        throw sceneError('scene-not-configured', 'Unknown scene.');
    }
    const registry = readModelServices(settings);
    const findService = id => registry.services.find(service => service.id === id) || null;
    const maxOutputTokens = scene === 'translation' ? registry.scenes.translation.maxOutputTokens : DEFAULT_TRANSLATION_MAX_OUTPUT_TOKENS;

    if (scene === 'translation' && registry.scenes.translation.serviceId) {
        const service = findService(registry.scenes.translation.serviceId);
        if (!service) {
            throw sceneError('service-not-found', 'The model service of this scene no longer exists.');
        }
        const model = registry.scenes.translation.model || service.defaultModel;
        if (!model) {
            throw sceneError('model-missing', 'No model is selected for this scene.');
        }
        return { service, model, implicit: false, followsChat: false, maxOutputTokens };
    }

    // 对话场景，或跟随对话场景：模型以 oai_settings 里对话正在用的为准
    const chat = readChatConnectionService(settings);
    if (!chat) {
        throw sceneError('scene-not-configured', 'The chat scene does not use a model service.');
    }
    const chosen = registry.scenes.chat.serviceId ? findService(registry.scenes.chat.serviceId) : null;
    const service = chosen && chosen.provider === chat.service.provider ? chosen : chat.service;
    const model = chat.model || service.defaultModel;
    if (!model) {
        throw sceneError('model-missing', 'No model is selected for the chat scene.');
    }
    return { service, model, implicit: service === chat.service, followsChat: scene !== 'chat', maxOutputTokens };
}

/**
 * @param {string} code 错误码
 * @param {string} message 英文说明
 * @returns {Error & { code: string }} 错误
 */
function sceneError(code, message) {
    const error = /** @type {Error & { code: string }} */ (new Error(message));
    error.code = code;
    return error;
}
