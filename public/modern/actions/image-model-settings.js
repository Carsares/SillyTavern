/**
 * 设置中心「模型连接」→「图片模型」（WP1）：字段保存、密钥、检查配置、试生成。
 * 方案见 docs/image-generation/FRONTEND-DESIGN.md 第 3 节；界面在 components/settings-image-model.js，事件在 routes/image-model-events.js。
 *
 * - 每个字段改动即保存到 settings.json 的 extension_settings.imageGeneration（settingsAutosave.commit，syncEngine: false：
 *   旧引擎不读这个键，不必重载）。校验和取值在纯函数 resolveImageModelField 里，不碰 DOM。
 * - 密钥写进 secrets 的 api_key_image_generation，secretId 留空（后端读当前激活的那条，新写入的会自动成为激活条目）。
 * - 供应商、模型、地址改了之后重新读 /capabilities（不计费），结果按 provider|model|baseUrl 缓存在 state.imageModelSettings.capabilities。
 * - 「检查配置」强制重读 /capabilities；「试生成一张」点两次才发出 /generate（按次计费），结果留在 state.imageModelSettings。
 */
import {
    IMAGE_GENERATION_API,
    IMAGE_GENERATION_SECRET_KEY,
    IMAGE_GENERATION_SETTINGS_KEY,
    IMAGE_PARAMETER_LABELS,
    PROMPT_SOURCE_LIMITS,
    buildImageRequestParams,
    getImageConfigReadiness,
    getImageGenerationConfig,
    getImageProvider,
    parseImageSize,
} from '../core/image-generation-config.js';
import {
    ensureImageModelSettingsState,
    getCachedImageCapabilities,
    getCapabilityCacheKey,
    loadImageCapabilities,
} from '../core/image-generation-capabilities.js';
import { describeImageFailure } from '../core/image-message.js';

export const SETTINGS_CONNECTION_VIEW_STORAGE_KEY = 'st-modern-settings-connection-view';
/** 「试生成一张」用的固定提示词和存放子目录（characterName）。 */
export const IMAGE_MODEL_TEST_PROMPT = 'A small red apple on a white table, studio lighting';
export const IMAGE_MODEL_TEST_CHARACTER = '图片模型测试';

// 前端等待比后端的 5 分钟供应商超时多 1 分钟（前端设计 F6）
const TEST_TIMEOUT_MS = 6 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;
// 与后端 src/endpoints/image-generation.js 的字段上限一致
const MAX_FIELD_LENGTH = 2048;
const MAX_COUNT = 4;
const MAX_SEED = 4294967295;
const MAX_STEPS = 150;
const MAX_NEGATIVE_LENGTH = 2000;
const MAX_TEMPLATE_LENGTH = 4000;

/**
 * 界面字段 → extension_settings.imageGeneration 下的路径。capabilities 为真的字段改了之后要重读 /capabilities。
 * @type {Readonly<Record<string, Readonly<{ path: string[], label: string, capabilities?: boolean }>>>}
 */
export const IMAGE_MODEL_FIELDS = Object.freeze({
    provider: Object.freeze({ path: ['provider'], label: '图片供应商', capabilities: true }),
    baseUrl: Object.freeze({ path: ['baseUrl'], label: '图片模型地址', capabilities: true }),
    model: Object.freeze({ path: ['model'], label: '图片模型', capabilities: true }),
    size: Object.freeze({ path: ['defaults', 'size'], label: '默认尺寸' }),
    aspectRatio: Object.freeze({ path: ['defaults', 'aspectRatio'], label: '默认比例' }),
    quality: Object.freeze({ path: ['defaults', 'quality'], label: '默认质量' }),
    count: Object.freeze({ path: ['defaults', 'count'], label: '默认数量' }),
    style: Object.freeze({ path: ['defaults', 'style'], label: '默认风格' }),
    negativePrompt: Object.freeze({ path: ['defaults', 'negativePrompt'], label: '默认反向提示词' }),
    seed: Object.freeze({ path: ['defaults', 'seed'], label: '默认种子' }),
    steps: Object.freeze({ path: ['defaults', 'steps'], label: '默认步数' }),
    promptTemplate: Object.freeze({ path: ['promptGen', 'template'], label: '提示词模板' }),
    promptSelectCount: Object.freeze({ path: ['promptGen', 'defaultSelectCount'], label: '默认勾选条数' }),
    promptAppearance: Object.freeze({ path: ['promptGen', 'includeAppearance'], label: '附带角色外貌' }),
});

const OUTCOME_LABELS = Object.freeze({ 'not-charged': '未计费', unknown: '可能已计费', charged: '已计费' });

const CAPABILITY_REASONS = Object.freeze({
    'Explicit baseUrl required': '需要填写地址。',
    'Invalid baseUrl': '地址格式不对：需要以 http:// 或 https:// 开头，不能带账号密码、? 查询参数或 # 片段。',
    'Explicit model required': '需要填写模型。',
    'Unknown provider': '后端不认识这个供应商。',
    'Unsupported parameter': '有后端不支持的参数。',
});

/** @type {Readonly<Record<string, (failure: ReturnType<typeof describeImageFailure>) => string>>} */
const FAILURE_TEXTS = Object.freeze({
    'unsupported-provider': () => '后端不支持这个图片供应商。',
    'invalid-request': failure => `请求没有通过后端校验：${failure.message}`,
    'secret-missing': () => '还没有保存图片模型的 API Key。',
    'image-generation-busy': () => '已有一张图片在生成，等它结束后再试。',
    'provider-http-error': failure => (failure.detail ? `供应商返回了错误：${failure.detail}` : '供应商返回了错误。'),
    'provider-response-invalid': () => '供应商返回的内容无法识别，或图片超出大小限制。',
    'provider-network-error': () => '连不上供应商，检查网络、代理和地址。',
    'provider-timeout': () => '供应商超过 5 分钟没有返回。',
    'image-download-failed': () => '供应商已经出图，但下载图片失败。',
    'save-failed': () => '供应商已经出图，但保存到本地失败。',
    cancelled: () => '生成已取消。',
    'request-not-found': () => '后端查不到这次请求，可能已过期或服务重启过。',
    'internal-error': () => '服务端出错，请求没有发给供应商。',
});

/**
 * @param {string[]} path IMAGE_MODEL_FIELDS 里的相对路径
 * @returns {string[]} settings.json 里的完整路径
 */
function toSettingsPath(path) {
    return ['extension_settings', IMAGE_GENERATION_SETTINGS_KEY, ...path];
}

/**
 * @param {unknown} value 原始值
 * @returns {string} 去掉首尾空白的文字；null / undefined 为空字符串
 */
function toText(value) {
    return value === null || value === undefined ? '' : String(value).trim();
}

/**
 * @param {string} text 文字
 * @returns {number | null} 安全整数，不是时为 null
 */
function toInteger(text) {
    if (!/^-?\d+$/.test(text)) {
        return null;
    }
    const number = Number(text);
    return Number.isSafeInteger(number) ? number : null;
}

/**
 * @param {string} text 地址
 * @returns {string} 问题说明，没有问题时为空字符串
 */
function checkBaseUrl(text) {
    if (text.length > MAX_FIELD_LENGTH) {
        return `地址不能超过 ${MAX_FIELD_LENGTH} 个字符。`;
    }
    let url;
    try {
        url = new URL(text);
    } catch {
        return '地址需是以 http:// 或 https:// 开头的完整地址。';
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return '地址需是以 http:// 或 https:// 开头的完整地址。';
    }
    if (url.username || url.password) {
        return '地址里不能带账号或密码。';
    }
    if (url.search || url.hash) {
        return '地址里不能带 ? 查询参数或 # 片段。';
    }
    return '';
}

/**
 * 换供应商时模型怎么办：当前模型是旧供应商的常用模型（或为空）、新供应商又不认它时，换成新供应商的第一个常用模型；
 * 用户自己填的模型保留。
 * @param {ReturnType<typeof getImageGenerationConfig>} config 当前配置
 * @param {NonNullable<ReturnType<typeof getImageProvider>>} next 新供应商
 * @returns {string} 新模型
 */
function pickModelForProvider(config, next) {
    const current = config.model;
    if (next.id === config.provider || next.models.includes(current)) {
        return current;
    }
    const previous = getImageProvider(config.provider);
    const wasSuggestion = !current || (previous?.models || []).includes(current);
    return wasSuggestion ? (next.models[0] || '') : current;
}

/**
 * @typedef {object} ImageModelFieldResolution
 * @property {string} field 字段名
 * @property {string} label 保存提示里的名称
 * @property {boolean} reloadsCapabilities 保存后是否要重读 /capabilities
 * @property {Array<[string[], unknown]>} [changes] 要写入的 [完整路径, 值]
 * @property {string} [error] 校验没通过的原因（有它时没有 changes）
 */

/**
 * 校验并换算一个字段的输入，不碰 DOM。
 * @param {string} field IMAGE_MODEL_FIELDS 的键
 * @param {unknown} rawValue 控件的值（复选框传布尔值）
 * @param {Record<string, any>} settings state.settings
 * @param {{ limits?: { countMax?: number, maxDimension?: number | null, dimensionMultiple?: number | null } | null }} [context]
 *   /capabilities 的 limits（读到了才传），用来收紧数量和尺寸的范围
 * @returns {ImageModelFieldResolution | null} 不认识的字段返回 null
 */
export function resolveImageModelField(field, rawValue, settings, context = {}) {
    const spec = Object.hasOwn(IMAGE_MODEL_FIELDS, field) ? IMAGE_MODEL_FIELDS[field] : null;
    if (!spec) {
        return null;
    }
    const config = getImageGenerationConfig(settings);
    const limits = context?.limits || null;
    const base = { field, label: spec.label, reloadsCapabilities: Boolean(spec.capabilities) };
    /** @param {string} error 原因 */
    const fail = error => ({ ...base, error });
    /**
     * @param {unknown} value 值
     * @param {Array<[string[], unknown]>} [extra] 一起写入的其他路径
     * @returns {ImageModelFieldResolution} 结果
     */
    const accept = (value, extra = []) => {
        /** @type {Array<[string[], unknown]>} */
        const changes = [[toSettingsPath(spec.path), value], ...extra];
        return { ...base, changes };
    };
    const text = toText(rawValue);

    switch (field) {
        case 'provider': {
            const provider = getImageProvider(text);
            if (!provider) {
                return fail('请选择图片供应商。');
            }
            const model = pickModelForProvider(config, provider);
            return accept(provider.id, model === config.model ? [] : [[toSettingsPath(IMAGE_MODEL_FIELDS.model.path), model]]);
        }
        case 'baseUrl': {
            const provider = getImageProvider(config.provider);
            if (!text) {
                return provider?.requiresBaseUrl ? fail(`${provider.label} 必须填写地址。`) : accept('');
            }
            const problem = checkBaseUrl(text);
            return problem ? fail(problem) : accept(text);
        }
        case 'model': {
            // 本地 SD WebUI 允许留空（core/image-generation-config.js 的约定：用 WebUI 当前加载的模型）
            if (!text && config.provider !== 'automatic1111') {
                return fail('请填写图片模型。');
            }
            if (text.length > MAX_FIELD_LENGTH) {
                return fail(`模型名不能超过 ${MAX_FIELD_LENGTH} 个字符。`);
            }
            return accept(text);
        }
        case 'size': {
            if (!text) {
                return accept('');
            }
            const size = parseImageSize(text);
            if (!size || !size.width || !size.height) {
                return fail('尺寸要写成「宽x高」，例如 1024x1024。');
            }
            const maxDimension = Number(limits?.maxDimension) || 0;
            if (maxDimension && (size.width > maxDimension || size.height > maxDimension)) {
                return fail(`宽和高都不能超过 ${maxDimension}。`);
            }
            const multiple = Number(limits?.dimensionMultiple) || 0;
            if (multiple && (size.width % multiple || size.height % multiple)) {
                return fail(`宽和高都要是 ${multiple} 的倍数。`);
            }
            return accept(`${size.width}x${size.height}`);
        }
        case 'aspectRatio': {
            if (!text) {
                return accept('');
            }
            const match = /^(\d{1,2}):(\d{1,2})$/.exec(text);
            if (!match || !Number(match[1]) || !Number(match[2])) {
                return fail('比例要写成「宽:高」，例如 16:9。');
            }
            return accept(`${Number(match[1])}:${Number(match[2])}`);
        }
        case 'quality':
        case 'style': {
            if (!/^[A-Za-z0-9_-]{0,32}$/.test(text)) {
                return fail(`${spec.label}只能是选项里的值。`);
            }
            return accept(text);
        }
        case 'count': {
            const max = Math.min(MAX_COUNT, Math.max(1, Number(limits?.countMax) || MAX_COUNT));
            const count = toInteger(text);
            if (count === null || count < 1 || count > max) {
                return fail(max === 1 ? '当前模型一次只能生成 1 张。' : `数量要是 1 到 ${max} 的整数。`);
            }
            return accept(count);
        }
        case 'negativePrompt': {
            if (Array.from(text).length > MAX_NEGATIVE_LENGTH) {
                return fail(`反向提示词不能超过 ${MAX_NEGATIVE_LENGTH} 字。`);
            }
            return accept(text);
        }
        case 'seed': {
            if (!text) {
                return accept(null);
            }
            const seed = toInteger(text);
            if (seed === null || seed < 0 || seed > MAX_SEED) {
                return fail(`种子要是 0 到 ${MAX_SEED} 的整数，留空表示随机。`);
            }
            return accept(seed);
        }
        case 'steps': {
            if (!text) {
                return accept(null);
            }
            const steps = toInteger(text);
            if (steps === null || steps < 1 || steps > MAX_STEPS) {
                return fail(`步数要是 1 到 ${MAX_STEPS} 的整数，留空使用供应商默认值。`);
            }
            return accept(steps);
        }
        case 'promptTemplate': {
            // 清空 = 使用默认模板（getImageGenerationConfig 把空模板换成 DEFAULT_PROMPT_TEMPLATE）
            if (Array.from(text).length > MAX_TEMPLATE_LENGTH) {
                return fail(`提示词模板不能超过 ${MAX_TEMPLATE_LENGTH} 字。`);
            }
            return accept(text);
        }
        case 'promptSelectCount': {
            const count = toInteger(text);
            if (count === null || count < 1 || count > PROMPT_SOURCE_LIMITS.maxMessages) {
                return fail(`默认勾选条数要是 1 到 ${PROMPT_SOURCE_LIMITS.maxMessages} 的整数。`);
            }
            return accept(count);
        }
        case 'promptAppearance':
            return accept(rawValue === true || text === 'true' || text === 'on');
        default:
            return null;
    }
}

/**
 * /capabilities 的不支持原因（适配层的固定英文）换成中文。
 * @param {unknown} reason capability.reason
 * @returns {string} 说明
 */
export function describeImageCapabilityReason(reason) {
    const text = toText(reason);
    if (!text) {
        return '后端没有说明原因。';
    }
    return Object.hasOwn(CAPABILITY_REASONS, text) ? CAPABILITY_REASONS[text] : text;
}

/**
 * 把 /api/image-generation/* 的失败换成面向用户的一句话。
 * @param {any} error apiFetch 抛出的错误（带 status、body），或 AbortError / 网络错误
 * @returns {{ text: string, code: string, outcome: 'not-charged'|'unknown'|'charged', outcomeLabel: string, uncertain: boolean, status: number | null }}
 */
export function describeImageModelError(error) {
    const failure = describeImageFailure(error);
    let text;
    if (!failure.uncertain) {
        const describe = Object.hasOwn(FAILURE_TEXTS, failure.code) ? FAILURE_TEXTS[failure.code] : null;
        text = describe ? describe(failure) : `${failure.message}（${failure.code}）`;
    } else if (failure.status === 404) {
        text = '后端没有图片生成接口（/api/image-generation），服务端版本可能过旧。';
    } else if (failure.status) {
        text = `服务端返回 HTTP ${failure.status}，没有说明原因。`;
    } else {
        text = failure.message;
    }
    return {
        text,
        code: failure.code,
        outcome: failure.outcome,
        outcomeLabel: OUTCOME_LABELS[failure.outcome] || OUTCOME_LABELS.unknown,
        uncertain: failure.uncertain,
        status: failure.status,
    };
}

/**
 * 默认参数各字段在当前供应商下是否可用。parameters 还没读到时都是 null（不置灰）。
 * @param {string[] | null | undefined} parameters /capabilities 的 parameters
 * @returns {{ size: boolean | null, aspectRatio: boolean | null, quality: boolean | null, count: boolean | null, style: boolean | null, negativePrompt: boolean | null, seed: boolean | null, steps: boolean | null }}
 */
export function getImageModelParameterStates(parameters) {
    const known = Array.isArray(parameters);
    /** @param {string} key 参数名 */
    const has = key => (known ? parameters.includes(key) : null);
    return {
        size: known ? parameters.includes('width') && parameters.includes('height') : null,
        aspectRatio: has('aspectRatio'),
        quality: has('quality'),
        count: has('count'),
        style: has('style'),
        negativePrompt: has('negativePrompt'),
        seed: has('seed'),
        steps: has('steps'),
    };
}

/**
 * 可用参数的中文名，宽和高合并成「尺寸」，按出现顺序去重。
 * @param {string[] | null | undefined} parameters /capabilities 的 parameters
 * @returns {string[]} 名称
 */
export function describeImageModelParameters(parameters) {
    const labels = (Array.isArray(parameters) ? parameters : [])
        .map(key => (Object.hasOwn(IMAGE_PARAMETER_LABELS, key) ? IMAGE_PARAMETER_LABELS[key] : key));
    return [...new Set(labels)];
}

/**
 * 「检查配置」的结论。
 * @param {any} capability /capabilities 的结果
 * @param {string} providerLabel 供应商显示名
 * @returns {{ ok: boolean, level: 'ok' | 'warn', text: string }}
 */
export function summarizeImageModelCheck(capability, providerLabel) {
    if (!capability?.supported) {
        return { ok: false, level: 'warn', text: `${providerLabel} 不能用当前配置生图：${describeImageCapabilityReason(capability?.reason)}` };
    }
    if (capability.requiresKey && !capability.keySaved) {
        return { ok: false, level: 'warn', text: `${providerLabel} 支持当前配置，但还没有保存 API Key。` };
    }
    const labels = describeImageModelParameters(capability.parameters);
    return { ok: true, level: 'ok', text: `${providerLabel} 支持当前配置${labels.length ? `，可用参数：${labels.join('、')}` : ''}。没有发出图片请求，不计费。` };
}

/**
 * 「试生成一张」的请求体。数量固定为 1（按次计费，试一下只出一张），其余参数用配置默认值并按 parameters 过滤。
 * @param {ReturnType<typeof getImageGenerationConfig>} config 图片配置
 * @param {string[] | null | undefined} parameters /capabilities 的 parameters
 * @param {string} requestId 新的 UUID
 * @returns {Record<string, any>} 请求体
 */
export function buildImageModelTestRequest(config, parameters, requestId) {
    return {
        requestId,
        provider: config.provider,
        model: config.model,
        baseUrl: config.baseUrl,
        characterName: IMAGE_MODEL_TEST_CHARACTER,
        prompt: IMAGE_MODEL_TEST_PROMPT,
        ...buildImageRequestParams({ ...config.defaults, count: 1 }, parameters),
    };
}

/**
 * @typedef {object} ImageModelTestResult
 * @property {boolean} ok 是否成功
 * @property {number} at 结束时间
 * @property {string} text 说明
 * @property {string} requestId 请求 id（没发出时为空）
 * @property {{ path: string, width?: number, height?: number } | null} [image] 第一张图
 * @property {number} [imageCount] 保存成功的张数
 * @property {number | null} [elapsedMs] 后端耗时
 * @property {string} [outcome] 失败时是否可能已计费
 * @property {string} [outcomeLabel] outcome 的中文
 */

/**
 * 设置中心自己用的状态（与聊天输入框共用 state.imageModelSettings 里的能力缓存）。
 * @param {any} state 全局状态
 * @returns {{ capabilities: Map<string, any>, pending: Map<string, Promise<any>>,
 *   capabilityStatus: { key: string, loading: boolean, error: string },
 *   check: { running: boolean, at: number, ok: boolean, level: string, text: string } | null,
 *   test: { confirming: boolean, running: boolean, requestId: string, startedAt: number, result: ImageModelTestResult | null },
 *   secretBusy: boolean }}
 */
export function ensureImageModelUiState(state) {
    const slot = /** @type {any} */ (ensureImageModelSettingsState(state));
    slot.capabilityStatus ??= { key: '', loading: false, error: '' };
    slot.check ??= null;
    slot.test ??= { confirming: false, running: false, requestId: '', startedAt: 0, result: null };
    slot.secretBusy ??= false;
    return slot;
}

/**
 * @param {number} ms 毫秒
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @param {import('../shell/feature-slot-actions.js').FeatureSlotDeps} deps 依赖
 * @returns {Record<string, Function>}
 */
export function createImageModelSettingsActions(deps) {
    const { state, apiFetch, render, showToast } = deps;

    // 设置中心共用的改动即保存（actions/api-connection.js 创建），在动作执行时再取，不依赖创建顺序
    function getAutosave() {
        const autosave = deps.actionRegistry?.apiConnectionActions?.settingsAutosave;
        if (!autosave) {
            throw new Error('设置自动保存还没有准备好。');
        }
        return autosave;
    }

    function getConfig() {
        return getImageGenerationConfig(state.settings || {});
    }

    /**
     * @param {ReturnType<typeof getImageGenerationConfig>} [config] 配置
     * @returns {{ provider: string, model: string, baseUrl: string }} /capabilities 的目标
     */
    function getTarget(config = getConfig()) {
        return { provider: config.provider, model: config.model, baseUrl: config.baseUrl };
    }

    /**
     * 「模型连接」标签里的「文本模型 / 图片模型」切换，记在 localStorage。不重绘，调用方决定何时重绘。
     * @param {string} view 'text' | 'image'
     * @returns {'text' | 'image'} 切换后的视图
     */
    function setSettingsConnectionView(view) {
        const next = view === 'image' ? 'image' : 'text';
        state.settingsConnectionView = next;
        try {
            globalThis.localStorage?.setItem(SETTINGS_CONNECTION_VIEW_STORAGE_KEY, next);
        } catch {
            // 无痕模式等写不进 localStorage：本次会话内照样生效
        }
        return next;
    }

    /**
     * 读当前配置的能力，结果写进 state.imageModelSettings（缓存 + capabilityStatus），结束后重绘。
     * @param {{ provider: string, model: string, baseUrl: string }} target 目标
     * @param {boolean} force 是否忽略缓存
     * @returns {Promise<{ ok: boolean, capability?: any, error?: string }>}
     */
    async function loadCapabilityStatus(target, force) {
        const ui = ensureImageModelUiState(state);
        const key = getCapabilityCacheKey(target);
        const cached = getCachedImageCapabilities(state, target);
        if (cached && !force) {
            ui.capabilityStatus = { key, loading: false, error: '' };
            return { ok: true, capability: cached };
        }
        ui.capabilityStatus = { key, loading: true, error: '' };
        render();
        try {
            const capability = await loadImageCapabilities(apiFetch, state, target, { force });
            if (ui.capabilityStatus.key === key) {
                ui.capabilityStatus = { key, loading: false, error: '' };
            }
            return { ok: true, capability };
        } catch (error) {
            const text = describeImageModelError(error).text;
            if (ui.capabilityStatus.key === key) {
                ui.capabilityStatus = { key, loading: false, error: text };
            }
            return { ok: false, error: text };
        } finally {
            render();
        }
    }

    /**
     * 渲染时调用：当前配置的能力还没读过就排一次读取（不在渲染过程中发请求）。读失败后不自动重试，「检查配置」会强制重读。
     */
    function ensureImageModelCapabilities() {
        const target = getTarget();
        const key = getCapabilityCacheKey(target);
        const ui = ensureImageModelUiState(state);
        if (getCachedImageCapabilities(state, target) || ui.capabilityStatus.key === key) {
            return;
        }
        ui.capabilityStatus = { key, loading: true, error: '' };
        setTimeout(() => {
            void loadCapabilityStatus(target, false);
        }, 0);
    }

    /**
     * 重新读当前配置的能力。
     * @param {{ force?: boolean }} [options] force 为真时忽略缓存
     */
    function refreshImageModelCapabilities({ force = false } = {}) {
        return loadCapabilityStatus(getTarget(), force);
    }

    /**
     * 保存一个字段。校验不通过时不保存，返回 invalid；保存失败时设置已回滚，调用方负责把控件退回原值。
     * @param {string} field IMAGE_MODEL_FIELDS 的键
     * @param {unknown} rawValue 控件的值
     * @returns {Promise<{ ok: boolean, handled: boolean, invalid?: boolean, unchanged?: boolean, error?: string }>}
     */
    async function saveImageModelField(field, rawValue) {
        const capability = getCachedImageCapabilities(state, getTarget());
        const resolution = resolveImageModelField(field, rawValue, state.settings || {}, { limits: capability?.limits });
        if (!resolution) {
            return { ok: false, handled: false };
        }
        const autosave = getAutosave();
        if (resolution.error) {
            autosave.markInvalid(resolution.error);
            return { ok: false, handled: true, invalid: true, error: resolution.error };
        }
        const result = await autosave.commit({ changes: resolution.changes, label: resolution.label, syncEngine: false });
        if (!result.ok) {
            return { ok: false, handled: true, error: result.error?.message || '' };
        }
        if (!result.unchanged) {
            // 配置变了，之前的「确认试生成」作废，免得确认的是旧配置
            ensureImageModelUiState(state).test.confirming = false;
            if (resolution.reloadsCapabilities) {
                await loadCapabilityStatus(getTarget(), false);
            }
        }
        return { ok: true, handled: true, unchanged: Boolean(result.unchanged) };
    }

    /**
     * 保存图片模型的 API Key（空输入不改），然后强制重读能力（keySaved 跟着变）。
     * @param {unknown} rawValue 输入框的值
     * @returns {Promise<{ ok: boolean, unchanged?: boolean, error?: Error }>}
     */
    async function saveImageModelSecret(rawValue) {
        const value = toText(rawValue);
        if (!value) {
            return { ok: true, unchanged: true };
        }
        const result = await getAutosave().commitSecret({
            key: IMAGE_GENERATION_SECRET_KEY,
            value,
            label: 'image-generation modern',
            description: '图片模型 API Key',
        });
        if (result.ok) {
            ensureImageModelUiState(state).test.confirming = false;
            await loadCapabilityStatus(getTarget(), true);
        }
        return result;
    }

    /**
     * 清除已保存的图片模型 API Key：这个键下的每一条都删掉（界面只显示一把密钥，只删当前那条会让旧的一条顶上来）。
     * @returns {Promise<{ ok: boolean, error?: Error }>}
     */
    async function clearImageModelSecret() {
        const ui = ensureImageModelUiState(state);
        if (ui.secretBusy) {
            return { ok: false };
        }
        const entries = Array.isArray(state.secretState?.[IMAGE_GENERATION_SECRET_KEY]) ? state.secretState[IMAGE_GENERATION_SECRET_KEY] : [];
        const ids = entries.map(entry => entry?.id).filter(id => typeof id === 'string' && id);
        ui.secretBusy = true;
        render();
        try {
            if (ids.length) {
                for (const id of ids) {
                    await apiFetch('/api/secrets/delete', { body: { key: IMAGE_GENERATION_SECRET_KEY, id } });
                }
            } else {
                await apiFetch('/api/secrets/delete', { body: { key: IMAGE_GENERATION_SECRET_KEY } });
            }
            try {
                state.secretState = await apiFetch('/api/secrets/read');
            } catch {
                state.secretState = { ...(state.secretState || {}), [IMAGE_GENERATION_SECRET_KEY]: null };
            }
            ui.test.confirming = false;
            showToast('图片模型 API Key 已清除', '之后生图会提示先保存密钥。');
        } catch (error) {
            showToast('清除图片模型 API Key 失败', error.message);
            return { ok: false, error };
        } finally {
            ui.secretBusy = false;
            render();
        }
        await loadCapabilityStatus(getTarget(), true);
        return { ok: true };
    }

    /**
     * 「检查配置」：强制重读 /capabilities，不出图、不计费。结果留在 state.imageModelSettings.check。
     */
    async function checkImageModelConfig() {
        const ui = ensureImageModelUiState(state);
        if (ui.check?.running) {
            return ui.check;
        }
        // 用已保存的配置检查：先等刚改的字段保存完
        await getAutosave().flush();
        const config = getConfig();
        const providerLabel = getImageProvider(config.provider)?.label || config.provider;
        ui.check = { running: true, at: 0, ok: false, level: 'muted', text: '正在检查…' };
        render();
        const result = await loadCapabilityStatus(getTarget(config), true);
        const summary = result.ok
            ? summarizeImageModelCheck(result.capability, providerLabel)
            : { ok: false, level: 'error', text: `检查失败：${result.error}` };
        ui.check = { running: false, at: Date.now(), ...summary };
        render();
        return ui.check;
    }

    /**
     * 后端记录里的失败（GET /requests/:id 的 error）换成和 apiFetch 一样的错误形状，交给 describeImageModelError。
     * @param {any} record 请求记录
     * @returns {{ status: null, body: string }}
     */
    function recordFailure(record) {
        const body = record?.error && typeof record.error === 'object'
            ? record.error
            : { error: record?.status === 'cancelled' ? 'cancelled' : 'internal-error', message: '', outcome: 'unknown' };
        return { status: null, body: JSON.stringify(body) };
    }

    /**
     * 查询一次生成的结果，直到不再是 pending 或超过截止时间。
     * @param {string} requestId 请求 id
     * @param {number} deadline 截止时间（时间戳）
     * @returns {Promise<any>} 请求记录
     */
    async function waitForImageModelRequest(requestId, deadline) {
        for (;;) {
            const record = await apiFetch(`${IMAGE_GENERATION_API}/requests/${encodeURIComponent(requestId)}`, { method: 'GET' });
            if (record?.status !== 'pending') {
                return record;
            }
            if (Date.now() >= deadline) {
                const error = new Error('等待图片结果超时。');
                error.name = 'TimeoutError';
                throw error;
            }
            await sleep(POLL_INTERVAL_MS);
        }
    }

    /**
     * @param {any} response /generate 的成功结果或 completed 的请求记录
     * @param {string} requestId 请求 id
     * @returns {ImageModelTestResult}
     */
    function toTestSuccess(response, requestId) {
        const images = Array.isArray(response?.images) ? response.images : [];
        const first = images[0];
        if (!first || typeof first.path !== 'string' || !first.path) {
            return { ok: false, at: Date.now(), requestId, text: '后端说已完成，但没有返回图片。', outcome: 'charged', outcomeLabel: OUTCOME_LABELS.charged };
        }
        const elapsedMs = Number.isFinite(response.elapsedMs) ? response.elapsedMs : null;
        const seconds = elapsedMs === null ? '' : `，用时 ${(elapsedMs / 1000).toFixed(1)} 秒`;
        return {
            ok: true,
            at: Date.now(),
            requestId,
            text: `生成成功${seconds}。`,
            image: { path: first.path, width: first.width, height: first.height },
            imageCount: images.length,
            elapsedMs,
        };
    }

    /**
     * @param {any} error 错误
     * @param {string} requestId 请求 id
     * @returns {ImageModelTestResult}
     */
    function toTestFailure(error, requestId) {
        const failure = describeImageModelError(error);
        return { ok: false, at: Date.now(), requestId, text: failure.text, outcome: failure.outcome, outcomeLabel: failure.outcomeLabel };
    }

    /**
     * 「试生成一张」：第一次调用只进入确认状态，再调用一次才发出 /generate（按次计费）。
     * 超时或断网时不重新提交，改查 /requests/:id；结果留在 state.imageModelSettings.test.result。
     * @returns {Promise<ImageModelTestResult | null>} 没有发出请求（只是进入确认状态或正在进行）时为 null
     */
    async function runImageModelTest() {
        const ui = ensureImageModelUiState(state);
        if (ui.test.running) {
            return null;
        }
        if (!ui.test.confirming) {
            ui.test.confirming = true;
            render();
            return null;
        }
        ui.test.confirming = false;
        await getAutosave().flush();
        const config = getConfig();
        const readiness = getImageConfigReadiness(config, state.secretState);
        if (!readiness.ok) {
            ui.test.result = { ok: false, at: Date.now(), requestId: '', text: readiness.reason, outcome: 'not-charged', outcomeLabel: OUTCOME_LABELS['not-charged'] };
            render();
            return ui.test.result;
        }

        const target = getTarget(config);
        const loaded = await loadCapabilityStatus(target, false);
        if (!loaded.ok || !loaded.capability?.supported) {
            const text = loaded.ok ? describeImageCapabilityReason(loaded.capability?.reason) : loaded.error;
            ui.test.result = { ok: false, at: Date.now(), requestId: '', text: `没有发出请求：${text}`, outcome: 'not-charged', outcomeLabel: OUTCOME_LABELS['not-charged'] };
            render();
            return ui.test.result;
        }

        const body = buildImageModelTestRequest(config, loaded.capability.parameters, globalThis.crypto.randomUUID());
        const startedAt = Date.now();
        const deadline = startedAt + TEST_TIMEOUT_MS;
        ui.test.running = true;
        ui.test.requestId = body.requestId;
        ui.test.startedAt = startedAt;
        render();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
        try {
            let response = await apiFetch(`${IMAGE_GENERATION_API}/generate`, { body, signal: controller.signal });
            if (response?.status === 'pending') {
                response = await waitForImageModelRequest(body.requestId, deadline);
            }
            ui.test.result = response?.status === 'failed' || response?.status === 'cancelled'
                ? toTestFailure(recordFailure(response), body.requestId)
                : toTestSuccess(response, body.requestId);
        } catch (error) {
            let result = toTestFailure(error, body.requestId);
            if (describeImageModelError(error).uncertain) {
                // 没拿到后端结论（超时、断网）：后端会继续生成并保留结果，去查一次，不重新提交
                try {
                    const record = await waitForImageModelRequest(body.requestId, Math.max(deadline, Date.now() + POLL_INTERVAL_MS));
                    result = record?.status === 'completed' ? toTestSuccess(record, body.requestId) : toTestFailure(recordFailure(record), body.requestId);
                } catch (queryError) {
                    const failure = describeImageModelError(queryError);
                    result = failure.code === 'request-not-found'
                        ? { ...result, text: `${result.text} 后端也查不到这次请求，结果未知。` }
                        : result;
                }
            }
            ui.test.result = result;
        } finally {
            clearTimeout(timer);
            ui.test.running = false;
            render();
        }
        return ui.test.result;
    }

    /** 取消「确认试生成」状态。 */
    function cancelImageModelTest() {
        const ui = ensureImageModelUiState(state);
        if (ui.test.confirming) {
            ui.test.confirming = false;
            render();
        }
    }

    return {
        setSettingsConnectionView,
        ensureImageModelCapabilities,
        refreshImageModelCapabilities,
        saveImageModelField,
        saveImageModelSecret,
        clearImageModelSecret,
        checkImageModelConfig,
        runImageModelTest,
        cancelImageModelTest,
    };
}
