/**
 * 连接档案（B1）：读取旧版连接管理扩展保存在 extension_settings.connectionManager 里的档案，在 Modern 里应用、创建、删除，
 * 并提供聊天输入框旁「最近使用的模型」和一键换模型。
 *
 * 旧版（public/scripts/extensions/connection-manager/index.js）靠一串斜杠命令应用档案：
 *   聊天补全 CC_COMMANDS：api → preset → api（预设可能把来源改掉，所以再写一次）→ api-url → model → proxy → stop-strings →
 *                         start-reply-with → reasoning-template → prompt-post-processing → secret-id → regex-preset
 *   文本补全 TC_COMMANDS：api → preset → api-url → model → sysprompt → sysprompt-state → instruct → context → instruct-state →
 *                         tokenizer → stop-strings → start-reply-with → reasoning-template → secret-id → regex-preset
 * 值为空的字段跳过，只有 stop-strings 和 start-reply-with 允许空串（表示清空）。
 *
 * Modern 与旧版的有意差异（界面上也会写明）：
 *   - 名称只做精确匹配。旧版对预设、代理、推理模板、分词器、模型都有模糊匹配（Fuse），找不到时挑「最像的」；这里找不到就跳过并说明原因。
 *   - 文本补全的预设（采样参数）、指令/上下文模板、系统提示词、分词器，以及正则预设、推理模板暂不应用，列入「已跳过」。
 *   - 模型 id 是自由文本，原样写入，不像旧版那样对照远端模型列表。
 *
 * 文件分三层：纯函数（只依赖入参，不改入参，tests/modern-connection-profiles.test.js 覆盖）、最近模型的 localStorage 读写、
 * 动作工厂 createConnectionProfileActions（保存设置、切换密钥、通知生成引擎，注册在 shell/feature-slot-actions.js）。
 */
import { describeReloadFailure, noEngineSync } from '../core/bridge-reload.js';
import { CONNECT_API_MAP, chatCompletionModelFields, secretKeyByChatSource } from '../core/constants.js';
import {
    getConnectionSourceLabel,
    getMainApiLabel,
    resolveTextCompletionSelection,
    secretKeyByTextCompletionType,
    textCompletionModelFields,
} from '../core/connection-labels.js';
import { saveSettingsSerialized } from '../core/keyed-queue.js';
import { formatNumber, maskEndpoint, parsePreset } from '../core/utils.js';
import { useOpenAiPresetFields } from './openai-preset-fields.js';

/**
 * @typedef {object} AppliedItem
 * @property {string} field 档案字段名，例如 `model`、`api-url`
 * @property {string} label 中文名称
 * @property {string} value 写入的值（已做脱敏：地址去掉查询串，密钥只显示名称）
 */

/**
 * @typedef {object} SkippedItem
 * @property {string} field 档案字段名
 * @property {string} label 中文名称
 * @property {string} reason 没有应用的原因
 */

/**
 * @typedef {object} SecretRotation
 * @property {string} key 密钥类别，例如 `api_key_custom`
 * @property {string} id 要设为当前的密钥 id
 * @property {string} label 密钥的名称
 */

/**
 * @typedef {object} ProfileApplication
 * @property {Record<string, any>} nextSettings 应用后的完整设置（入参的副本，已写好 selectedProfile）
 * @property {SecretRotation | null} secretRotation 还要调用 /api/secrets/rotate 的请求，不需要切换时为 null
 * @property {AppliedItem[]} applied 已应用的项
 * @property {SkippedItem[]} skipped 没有应用的项和原因
 */

export const CONNECTION_PROFILE_NONE_NAME = '<None>';
export const PROFILE_NAME_MAX_LENGTH = 80;
export const RECENT_MODELS_STORAGE_KEY = 'st-modern-recent-models';
export const RECENT_MODELS_LIMIT = 5;

/** 旧版 CC_COMMANDS：聊天补全档案的应用顺序（api 出现两次是有意的，见文件头部说明） */
export const CC_COMMANDS = Object.freeze([
    'api', 'preset', 'api', 'api-url', 'model', 'proxy', 'stop-strings', 'start-reply-with',
    'reasoning-template', 'prompt-post-processing', 'secret-id', 'regex-preset',
]);

/** 旧版 TC_COMMANDS：文本补全（以及 Kobold / NovelAI / Horde）档案的应用顺序 */
export const TC_COMMANDS = Object.freeze([
    'api', 'preset', 'api-url', 'model', 'sysprompt', 'sysprompt-state', 'instruct', 'context', 'instruct-state',
    'tokenizer', 'stop-strings', 'start-reply-with', 'reasoning-template', 'secret-id', 'regex-preset',
]);

/** 允许把空串记进档案的字段（旧版 ALLOW_EMPTY） */
const ALLOW_EMPTY = Object.freeze(['stop-strings', 'start-reply-with']);

export const PROFILE_FIELD_LABELS = Object.freeze({
    api: 'API',
    'api-url': '服务器地址',
    preset: '预设',
    model: '模型',
    proxy: '代理预设',
    'sysprompt-state': '系统提示词开关',
    sysprompt: '系统提示词',
    'instruct-state': '指令模式开关',
    instruct: '指令模板',
    context: '上下文模板',
    tokenizer: '分词器',
    'stop-strings': '自定义停止字符串',
    'start-reply-with': '回复前缀',
    'reasoning-template': '推理模板',
    'prompt-post-processing': '提示词后处理',
    'secret-id': '密钥',
    'regex-preset': '正则预设',
});

// 聊天补全里有「地址」概念的来源，对应 oai_settings 里的字段（与旧版 /api-url 命令一致，其余来源没有）
const CHAT_URL_FIELDS = Object.freeze({
    custom: 'custom_url',
    zai: 'zai_endpoint',
    siliconflow: 'siliconflow_endpoint',
    minimax: 'minimax_endpoint',
    vertexai: 'vertexai_region',
});

// 这几个来源的「地址」是固定几个取值之一（旧版对不在其中的值直接拒绝）
const CHAT_URL_CHOICES = Object.freeze({
    zai: Object.freeze(['common', 'coding']),
    siliconflow: Object.freeze(['global', 'cn']),
    minimax: Object.freeze(['global', 'cn']),
});

// 旧版 SERVER_INPUTS：文本补全里有服务器地址输入框的类型，其余类型（openrouter、mancer 等）地址固定
const TEXT_COMPLETION_URL_TYPES = Object.freeze([
    'ooba', 'vllm', 'aphrodite', 'tabby', 'koboldcpp', 'llamacpp', 'ollama', 'huggingface', 'generic',
]);

// 与 public/index.html 的 #custom_prompt_post_processing 选项一致，空串（None）在旧版里写作 `none`
const PROMPT_POST_PROCESSING_VALUES = Object.freeze([
    'merge_tools', 'semi_tools', 'strict_tools', 'merge', 'semi', 'strict', 'single',
]);

const DEPENDS_ON_API_REASON = '依赖的 API 没有应用成功';
const TEXT_COMPLETION_ONLY_UNSUPPORTED_REASON = '指令/上下文模板、系统提示词和分词器暂不支持随档案切换，保留当前设置';

/**
 * @param {any} value 任意值
 * @returns {value is Record<string, any>} 是否为普通对象
 */
function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 取 target[key] 这个对象，不存在或不是对象时创建一个。
 * @param {Record<string, any>} target 父对象
 * @param {string} key 键
 * @returns {Record<string, any>} 子对象
 */
function ensureObject(target, key) {
    if (!isObject(target[key])) {
        target[key] = {};
    }
    return target[key];
}

/**
 * @param {string} value 原文
 * @returns {string} 密钥 id 的前 8 位，用来在界面上区分，不暴露完整 id
 */
function shortId(value) {
    return String(value || '').slice(0, 8);
}

// ---------------------------------------------------------------------------------------------------------------------
// 当前连接
// ---------------------------------------------------------------------------------------------------------------------

/**
 * 读出设置里当前的主 API、聊天补全来源和文本补全类型，口径与 shell/metadata.js 的 getProviderInfo 一致（顶层 chat_completion_source 优先）。
 * @param {Record<string, any>} settings settings.json 解析后的对象
 * @returns {{ mainApi: string, source: string, type: string }} 当前连接
 */
export function readCurrentConnection(settings = {}) {
    const oai = isObject(settings?.oai_settings) ? settings.oai_settings : {};
    const textgen = isObject(settings?.textgenerationwebui_settings) ? settings.textgenerationwebui_settings : {};
    return {
        mainApi: settings?.main_api || '',
        source: settings?.chat_completion_source || oai.chat_completion_source || '',
        type: textgen.type || settings?.textgen_type || 'ooba',
    };
}

/**
 * 由主 API、来源、类型反查旧版 `/api` 命令里的别名（取别名表里第一个匹配的键，规则同旧版 `/api` 无参数时）。
 * @param {{ mainApi: string, source?: string, type?: string }} connection 当前连接
 * @returns {string} 别名，例如 `google`、`openrouter-text`；认不出时为空串
 */
export function resolveConnectApiKey({ mainApi, source = '', type = '' }) {
    for (const [key, config] of Object.entries(CONNECT_API_MAP)) {
        if (config.selected !== mainApi) {
            continue;
        }
        if (config.source) {
            if (source === config.source) {
                return key;
            }
            continue;
        }
        if (config.type) {
            if (type === config.type) {
                return key;
            }
            continue;
        }
        return key;
    }
    return '';
}

/**
 * 当前连接使用的密钥类别（对应 /api/secrets/read 返回的键），规则同旧版 secrets.js 的 resolveSecretKey。
 * @param {Record<string, any>} settings settings.json 解析后的对象
 * @returns {string} 密钥类别；这个 API 没有密钥时为空串
 */
export function resolveSecretKey(settings = {}) {
    const { mainApi, source, type } = readCurrentConnection(settings);
    if (mainApi === 'koboldhorde') {
        return 'api_key_horde';
    }
    if (mainApi === 'novel') {
        return 'api_key_novel';
    }
    if (mainApi === 'textgenerationwebui') {
        return secretKeyByTextCompletionType[type] || '';
    }
    if (mainApi === 'openai') {
        if (source === 'vertexai' && settings.oai_settings?.vertexai_auth_mode === 'full') {
            return 'vertexai_service_account_json';
        }
        return secretKeyByChatSource[source] || '';
    }
    return '';
}

/**
 * 当前 API 能在聊天里一键换的模型：聊天补全写 `oai_settings[<来源>_model]`，文本补全写 `textgenerationwebui_settings[<类型>_model]`。
 * @param {Record<string, any>} settings settings.json 解析后的对象
 * @returns {{ mainApi: string, source: string, field: string, model: string } | null} 目标；不支持（Kobold、NovelAI、没有模型字段的类型）时为 null
 */
export function getCurrentModelTarget(settings = {}) {
    const { mainApi, source, type } = readCurrentConnection(settings);
    if (mainApi === 'openai') {
        const field = chatCompletionModelFields[source];
        if (!source || !field) {
            return null;
        }
        const model = settings.oai_settings?.[field];
        return { mainApi, source, field, model: typeof model === 'string' ? model : '' };
    }
    if (mainApi === 'textgenerationwebui') {
        const field = textCompletionModelFields[type];
        if (!field) {
            return null;
        }
        const model = settings.textgenerationwebui_settings?.[field];
        return { mainApi, source: type, field, model: typeof model === 'string' ? model : '' };
    }
    return null;
}

/**
 * 把模型写进设置里（返回副本，不改入参）。
 * @param {Record<string, any>} settings settings.json 解析后的对象
 * @param {string} model 模型 id
 * @returns {{ nextSettings: Record<string, any>, target: NonNullable<ReturnType<typeof getCurrentModelTarget>>, unchanged: boolean }} 新设置和目标；与当前相同时 unchanged 为 true
 */
export function applyModelToSettings(settings, model) {
    const wanted = String(model ?? '').trim();
    if (!wanted) {
        throw new Error('模型不能为空。');
    }
    const target = getCurrentModelTarget(settings);
    if (!target) {
        throw new Error('当前 API 暂不支持在聊天里切换模型，请到 API 页修改。');
    }
    const nextSettings = structuredClone(settings);
    const section = target.mainApi === 'openai' ? ensureObject(nextSettings, 'oai_settings') : ensureObject(nextSettings, 'textgenerationwebui_settings');
    section[target.field] = wanted;
    return { nextSettings, target, unchanged: wanted === target.model };
}

// ---------------------------------------------------------------------------------------------------------------------
// 档案列表
// ---------------------------------------------------------------------------------------------------------------------

/**
 * 读出连接管理的设置，缺字段时补上空值（返回的是设置里的原对象，调用方只读；需要写入时用 ensureConnectionManager）。
 * @param {Record<string, any>} settings settings.json 解析后的对象
 * @returns {{ profiles: Record<string, any>[], selectedProfile: string }} 档案列表和当前选中的档案 id
 */
export function readConnectionManager(settings = {}) {
    const manager = settings?.extension_settings?.connectionManager;
    const profiles = Array.isArray(manager?.profiles) ? manager.profiles.filter(isObject) : [];
    const selectedProfile = typeof manager?.selectedProfile === 'string' ? manager.selectedProfile : '';
    return { profiles, selectedProfile };
}

/**
 * 在设置副本上取（必要时创建）extension_settings.connectionManager，结构同旧版 DEFAULT_SETTINGS。
 * @param {Record<string, any>} settings 会被就地修改的设置
 * @returns {{ profiles: Record<string, any>[], selectedProfile: string | null }} 连接管理设置
 */
export function ensureConnectionManager(settings) {
    const extensionSettings = ensureObject(settings, 'extension_settings');
    const manager = ensureObject(extensionSettings, 'connectionManager');
    if (!Array.isArray(manager.profiles)) {
        manager.profiles = [];
    }
    if (manager.selectedProfile === undefined) {
        manager.selectedProfile = null;
    }
    return /** @type {any} */ (manager);
}

/**
 * @param {Record<string, any>} settings settings.json 解析后的对象
 * @param {string} id 档案 id
 * @returns {Record<string, any> | null} 档案；找不到为 null
 */
export function findConnectionProfile(settings, id) {
    return readConnectionManager(settings).profiles.find(profile => profile.id === id) || null;
}

/**
 * 档案里 `api` 字段对应的别名配置。别名按小写查找，与旧版 `/api` 一致。
 * @param {any} value 档案的 api 字段
 * @returns {{ selected: string, source?: string, type?: string } | null} 配置；不认识为 null
 */
export function lookupConnectApi(value) {
    const key = String(value ?? '').trim().toLowerCase();
    return key && Object.hasOwn(CONNECT_API_MAP, key) ? CONNECT_API_MAP[key] : null;
}

/**
 * 一个档案在界面上的概要。
 * @param {Record<string, any>} profile 档案
 * @returns {{
 *   id: string, name: string, mode: string, modeLabel: string, sourceLabel: string, model: string, preset: string,
 *   endpoint: string, proxy: string, summary: string, excludedLabels: string[],
 * }} 概要
 */
export function describeProfile(profile) {
    const config = lookupConnectApi(profile?.api);
    const sourceLabel = config
        ? getConnectionSourceLabel(config.selected, config.source || config.type || '')
        : String(profile?.api || '');
    const modeLabel = config ? getMainApiLabel(config.selected) : (profile?.mode === 'cc' ? '聊天补全' : '文本补全');
    const model = typeof profile?.model === 'string' ? profile.model : '';
    const preset = typeof profile?.preset === 'string' ? profile.preset : '';
    const exclude = Array.isArray(profile?.exclude) ? profile.exclude : [];
    return {
        id: String(profile?.id ?? ''),
        name: String(profile?.name ?? '未命名'),
        mode: profile?.mode === 'cc' ? 'cc' : 'tc',
        modeLabel,
        sourceLabel,
        model,
        preset,
        endpoint: maskEndpoint(typeof profile?.['api-url'] === 'string' ? profile['api-url'] : ''),
        proxy: typeof profile?.proxy === 'string' ? profile.proxy : '',
        summary: [sourceLabel, model, preset ? `预设 ${preset}` : ''].filter(Boolean).join(' · '),
        excludedLabels: exclude.map(field => PROFILE_FIELD_LABELS[field] || String(field)),
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// 应用档案
// ---------------------------------------------------------------------------------------------------------------------

/**
 * 按旧版的顺序把档案应用到设置的副本上，名称一律精确匹配，没法应用的项记入 skipped。入参不会被修改。
 *
 * 密钥不在这里切换：secretRotation 是要调用 `POST /api/secrets/rotate` 的请求，由动作负责发出并核对结果。
 * 推理模板按「本期不做推理相关设置」的决定列为已跳过；文本补全的预设、指令/上下文模板、系统提示词、分词器和正则预设也一样。
 * 聊天补全预设已经是当前预设时不重复套用（与旧版一致，保住用户调过的参数）。
 * @param {object} input 入参
 * @param {Record<string, any>} input.settings settings.json 解析后的对象
 * @param {Record<string, any>} input.profile 要应用的档案
 * @param {{ id: string, names: string[], contents: any[] }[]} [input.presetGroups] 预设分组（actions/preset-list.js 的 getPresetGroups），用来按名称找聊天补全预设
 * @param {Record<string, any>} [input.secretState] /api/secrets/read 的结果；提供时会核对档案里的密钥还在不在、是不是已经是当前密钥
 * @returns {ProfileApplication & { excluded: string[] }} 应用结果；excluded 是档案里被「不包含」的字段
 */
export function buildProfileApplication({ settings, profile, presetGroups = [], secretState } = /** @type {any} */ ({})) {
    const next = structuredClone(isObject(settings) ? settings : {});
    /** @type {AppliedItem[]} */
    const applied = [];
    /** @type {SkippedItem[]} */
    const skipped = [];
    /** @type {SecretRotation | null} */
    let secretRotation = null;
    let apiFailed = false;

    const excluded = Array.isArray(profile?.exclude) ? profile.exclude.map(String) : [];
    const commands = profile?.mode === 'cc' ? CC_COMMANDS : TC_COMMANDS;

    const labelOf = field => PROFILE_FIELD_LABELS[field] || field;
    const markApplied = (field, value) => {
        if (!applied.some(item => item.field === field)) {
            applied.push({ field, label: labelOf(field), value: String(value) });
        }
    };
    const markSkipped = (field, reason) => {
        if (!skipped.some(item => item.field === field)) {
            skipped.push({ field, label: labelOf(field), reason });
        }
    };

    const current = () => readCurrentConnection(next);
    const oaiSettings = () => ensureObject(next, 'oai_settings');
    const powerUser = () => ensureObject(next, 'power_user');

    // 顶层 chat_completion_source 与 oai_settings 里的要一起改：Modern 的读取口径（getProviderInfo）优先看顶层，引擎看 oai_settings
    const setChatSource = source => {
        next.chat_completion_source = source;
        oaiSettings().chat_completion_source = source;
    };
    const syncTopLevelSource = () => {
        if (Object.hasOwn(next, 'chat_completion_source') && isObject(next.oai_settings) && next.oai_settings.chat_completion_source) {
            next.chat_completion_source = next.oai_settings.chat_completion_source;
        }
    };

    const handlers = {
        api(value, repeat) {
            const config = lookupConnectApi(value);
            if (!config) {
                apiFailed = true;
                markSkipped('api', `不认识的 API“${value}”`);
                return;
            }
            apiFailed = false;
            next.main_api = config.selected;
            if (config.source) {
                setChatSource(config.source);
            }
            if (config.type) {
                ensureObject(next, 'textgenerationwebui_settings').type = config.type;
            }
            if (!repeat) {
                markApplied('api', `${getConnectionSourceLabel(config.selected, config.source || config.type || '')}（${String(value).trim()}）`);
            }
        },

        preset(value) {
            if (apiFailed) {
                markSkipped('preset', DEPENDS_ON_API_REASON);
                return;
            }
            const { mainApi } = current();
            if (mainApi === 'textgenerationwebui') {
                markSkipped('preset', '文本补全预设的采样参数暂不套用，请在 API 页选择预设');
                return;
            }
            if (mainApi !== 'openai') {
                markSkipped('preset', '这个 API 的预设暂不支持在档案里切换');
                return;
            }
            const group = presetGroups.find(item => item.id === 'openai');
            if (!group) {
                markSkipped('preset', '没有读取到聊天补全预设列表');
                return;
            }
            const index = group.names.indexOf(value);
            if (index < 0) {
                markSkipped('preset', `聊天补全预设“${value}”不存在（只按名称精确匹配）`);
                return;
            }
            const oai = oaiSettings();
            // 旧版 /preset 在目标预设已经是当前预设时什么也不做（presetCommandCallback 里 currentPreset !== exactMatch 才会套用），
            // 所以用户在 API 页调过的采样参数、上下文长度不会因为切换到同一个预设的档案而被预设里的旧值覆盖
            if (oai.preset_settings_openai === value) {
                markApplied('preset', `${value}（已是当前预设，参数保持不变）`);
                return;
            }
            const content = parsePreset(group.contents[index]);
            if (!isObject(content)) {
                markSkipped('preset', `预设“${value}”的内容无法读取`);
                return;
            }
            oai.preset_settings_openai = value;
            // 旧版 bind_preset_to_connection 缺省为开：预设里的来源、模型、地址、代理会一并写入，后面的 api / api-url / model / proxy 再按档案改回来
            useOpenAiPresetFields(oai, content);
            syncTopLevelSource();
            markApplied('preset', value);
        },

        'api-url'(value) {
            if (apiFailed) {
                markSkipped('api-url', DEPENDS_ON_API_REASON);
                return;
            }
            const text = String(value).trim();
            const { mainApi, source, type } = current();
            if (mainApi === 'openai') {
                const field = CHAT_URL_FIELDS[source];
                if (!field) {
                    markSkipped('api-url', `聊天补全来源“${source}”没有可设置的地址`);
                    return;
                }
                const choices = CHAT_URL_CHOICES[source];
                if (choices && !choices.includes(text)) {
                    markSkipped('api-url', `“${text}”不是有效取值（可选：${choices.join('、')}）`);
                    return;
                }
                oaiSettings()[field] = text;
                markApplied('api-url', maskEndpoint(text));
                return;
            }
            if (mainApi === 'textgenerationwebui') {
                if (!TEXT_COMPLETION_URL_TYPES.includes(type)) {
                    markSkipped('api-url', `文本补全类型“${type}”的地址是固定的，不能设置`);
                    return;
                }
                const textgen = ensureObject(next, 'textgenerationwebui_settings');
                textgen.server_urls = { ...(isObject(textgen.server_urls) ? textgen.server_urls : {}), [type]: text };
                markApplied('api-url', maskEndpoint(text));
                return;
            }
            if (mainApi === 'kobold') {
                next.api_server = text;
                if (isObject(next.kai_settings) && Object.hasOwn(next.kai_settings, 'api_server')) {
                    next.kai_settings.api_server = text;
                }
                markApplied('api-url', maskEndpoint(text));
                return;
            }
            markSkipped('api-url', '这个 API 没有可设置的地址');
        },

        model(value) {
            if (apiFailed) {
                markSkipped('model', DEPENDS_ON_API_REASON);
                return;
            }
            const text = String(value).trim();
            const { mainApi, source, type } = current();
            if (mainApi === 'openai') {
                const field = chatCompletionModelFields[source];
                if (!field) {
                    markSkipped('model', `聊天补全来源“${source}”没有模型字段`);
                    return;
                }
                oaiSettings()[field] = text;
                markApplied('model', text);
                return;
            }
            if (mainApi === 'textgenerationwebui') {
                const field = textCompletionModelFields[type];
                if (!field) {
                    markSkipped('model', `文本补全类型“${type}”没有模型字段`);
                    return;
                }
                ensureObject(next, 'textgenerationwebui_settings')[field] = text;
                markApplied('model', text);
                return;
            }
            markSkipped('model', '这个 API 暂不支持在档案里设置模型');
        },

        proxy(value) {
            if (apiFailed) {
                markSkipped('proxy', DEPENDS_ON_API_REASON);
                return;
            }
            if (current().mainApi !== 'openai') {
                markSkipped('proxy', '只有聊天补全使用代理预设');
                return;
            }
            const name = String(value);
            // 设置里没有保存过代理列表时，旧版只有内置的 None（地址为空）
            const proxies = Array.isArray(next.proxies) && next.proxies.length
                ? next.proxies
                : [{ name: 'None', url: '', password: '' }];
            const preset = proxies.find(item => isObject(item) && item.name === name);
            if (!preset) {
                markSkipped('proxy', `代理预设“${name}”不存在（只按名称精确匹配）`);
                return;
            }
            const oai = oaiSettings();
            oai.reverse_proxy = typeof preset.url === 'string' ? preset.url : '';
            oai.proxy_password = typeof preset.password === 'string' ? preset.password : '';
            next.selected_proxy = structuredClone(preset);
            markApplied('proxy', name);
        },

        'stop-strings'(value) {
            const text = Array.isArray(value) ? JSON.stringify(value) : String(value ?? '').trim();
            if (!text) {
                // 旧版 force 写入空值：存成空数组的 JSON
                powerUser().custom_stopping_strings = JSON.stringify([]);
                markApplied('stop-strings', '清空');
                return;
            }
            /** @type {any} */
            let parsed = null;
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = null;
            }
            if (!Array.isArray(parsed)) {
                markSkipped('stop-strings', '档案里的值不是有效的 JSON 字符串数组');
                return;
            }
            powerUser().custom_stopping_strings = JSON.stringify(parsed.map(String));
            markApplied('stop-strings', parsed.length ? `${formatNumber(parsed.length)} 条` : '清空');
        },

        'start-reply-with'(value) {
            powerUser().user_prompt_bias = String(value ?? '');
            markApplied('start-reply-with', String(value ?? '') || '清空');
        },

        'reasoning-template'() {
            markSkipped('reasoning-template', '推理模板属于推理相关设置，本期不处理');
        },

        'prompt-post-processing'(value) {
            const text = String(value).trim().toLowerCase();
            if (text !== 'none' && !PROMPT_POST_PROCESSING_VALUES.includes(text)) {
                markSkipped('prompt-post-processing', `不认识的提示词后处理方式“${value}”`);
                return;
            }
            oaiSettings().custom_prompt_post_processing = text === 'none' ? '' : text;
            markApplied('prompt-post-processing', text === 'none' ? '无' : text);
        },

        'secret-id'(value) {
            if (apiFailed) {
                markSkipped('secret-id', DEPENDS_ON_API_REASON);
                return;
            }
            const key = resolveSecretKey(next);
            if (!key) {
                markSkipped('secret-id', '当前 API 没有可切换的密钥');
                return;
            }
            const wanted = String(value).trim();
            if (!isObject(secretState)) {
                secretRotation = { key, id: wanted, label: '' };
                markApplied('secret-id', shortId(wanted));
                return;
            }
            const list = Array.isArray(secretState[key]) ? secretState[key] : [];
            if (!list.length) {
                markSkipped('secret-id', `当前来源（${key}）还没有保存过密钥`);
                return;
            }
            // 旧版先按 id、再按名称精确查找
            const hit = list.find(item => item?.id === wanted) ?? list.find(item => item?.label === wanted);
            if (!hit) {
                markSkipped('secret-id', '档案记录的密钥已被删除或改名');
                return;
            }
            const label = hit.label || shortId(hit.id);
            if (hit.active) {
                markApplied('secret-id', `${label}（已是当前密钥）`);
                return;
            }
            secretRotation = { key, id: hit.id, label: hit.label || '' };
            markApplied('secret-id', label);
        },

        'regex-preset'() {
            markSkipped('regex-preset', '正则预设暂不支持');
        },
    };

    for (const field of ['sysprompt', 'sysprompt-state', 'instruct', 'context', 'instruct-state', 'tokenizer']) {
        handlers[field] = () => markSkipped(field, TEXT_COMPLETION_ONLY_UNSUPPORTED_REASON);
    }

    let apiSeen = false;
    for (const command of commands) {
        if (excluded.includes(command)) {
            continue;
        }
        const value = profile?.[command];
        const allowEmpty = ALLOW_EMPTY.includes(command);
        if (!value && !(allowEmpty && value === '')) {
            continue;
        }
        const handler = handlers[command];
        if (!handler) {
            continue;
        }
        if (command === 'api') {
            handler(value, apiSeen);
            apiSeen = true;
        } else {
            handler(value);
        }
    }

    if (profile?.id) {
        ensureConnectionManager(next).selectedProfile = String(profile.id);
    }

    return { nextSettings: next, secretRotation, applied, skipped, excluded };
}

/**
 * 「已应用 N 项，跳过 M 项（原因…）」。原因只列前三条，其余折叠成「等 K 项」，完整列表在切换结果里。
 * @param {{ applied: unknown[], skipped: { label: string, reason: string }[] }} result 应用结果
 * @returns {string} 概要
 */
export function formatApplySummary({ applied, skipped }) {
    let text = `已应用 ${formatNumber(applied.length)} 项`;
    if (skipped.length) {
        const shown = skipped.slice(0, 3).map(item => `${item.label}：${item.reason}`);
        const rest = skipped.length - shown.length;
        text += `，跳过 ${formatNumber(skipped.length)} 项（${shown.join('；')}${rest > 0 ? `；另有 ${formatNumber(rest)} 项见详情` : ''}）`;
    }
    return text;
}

// ---------------------------------------------------------------------------------------------------------------------
// 从当前连接创建档案
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @returns {string} 新档案 id（UUID v4）
 */
export function createProfileId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
        const random = Math.floor(Math.random() * 16);
        return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
    });
}

/**
 * 把当前连接记成一个档案（与旧版 createConnectionProfile 读取的字段一致：空值不记，停止字符串和回复前缀允许空串）。
 * 文本补全的预设、模板类字段、推理模板、正则预设不记录，因为 Modern 现在不会应用它们。
 * @param {Record<string, any>} settings settings.json 解析后的对象
 * @param {object} [options] 选项
 * @param {string} [options.name] 档案名称（调用方负责校验唯一）
 * @param {Record<string, any>} [options.secretState] /api/secrets/read 的结果，用来记录当前启用的密钥 id
 * @param {string} [options.id] 指定 id，省略时生成
 * @returns {Record<string, any>} 档案
 */
export function buildProfileFromCurrentConnection(settings, { name = '', secretState, id } = {}) {
    const source = isObject(settings) ? settings : {};
    const { mainApi, source: chatSource, type } = readCurrentConnection(source);
    const oai = isObject(source.oai_settings) ? source.oai_settings : {};
    const power = isObject(source.power_user) ? source.power_user : {};
    /** @type {Record<string, any>} */
    const profile = {
        id: id || createProfileId(),
        mode: mainApi === 'openai' ? 'cc' : 'tc',
        name: String(name),
        exclude: [],
    };

    const apiKey = resolveConnectApiKey({ mainApi, source: chatSource, type });
    if (apiKey) {
        profile.api = apiKey;
    }

    if (mainApi === 'openai') {
        if (typeof oai.preset_settings_openai === 'string' && oai.preset_settings_openai) {
            profile.preset = oai.preset_settings_openai;
        }
        const modelField = chatCompletionModelFields[chatSource];
        if (modelField && typeof oai[modelField] === 'string' && oai[modelField]) {
            profile.model = oai[modelField];
        }
        const urlField = CHAT_URL_FIELDS[chatSource];
        if (urlField && typeof oai[urlField] === 'string' && oai[urlField]) {
            profile['api-url'] = oai[urlField];
        }
        if (typeof source.selected_proxy?.name === 'string' && source.selected_proxy.name) {
            profile.proxy = source.selected_proxy.name;
        }
    } else if (mainApi === 'textgenerationwebui') {
        const selection = resolveTextCompletionSelection(source);
        if (selection.model) {
            profile.model = selection.model;
        }
        if (selection.endpoint && TEXT_COMPLETION_URL_TYPES.includes(type)) {
            profile['api-url'] = selection.endpoint;
        }
    } else if (mainApi === 'kobold') {
        const server = source.api_server || source.kai_settings?.api_server;
        if (typeof server === 'string' && server) {
            profile['api-url'] = server;
        }
    }

    if (typeof power.custom_stopping_strings === 'string') {
        profile['stop-strings'] = power.custom_stopping_strings;
    }
    if (typeof power.user_prompt_bias === 'string') {
        profile['start-reply-with'] = power.user_prompt_bias;
    }
    if (mainApi === 'openai') {
        profile['prompt-post-processing'] = oai.custom_prompt_post_processing || 'none';
    }

    const secretKey = resolveSecretKey(source);
    const secrets = secretKey && isObject(secretState) && Array.isArray(secretState[secretKey]) ? secretState[secretKey] : [];
    const activeSecret = secrets.find(item => item?.active);
    if (activeSecret?.id) {
        profile['secret-id'] = activeSecret.id;
    }

    return profile;
}

/**
 * @param {string} name 用户输入的名称
 * @param {Record<string, any>[]} profiles 已有档案
 * @returns {{ ok: boolean, name?: string, error?: string }} 校验结果；通过时 name 是整理空白后的名称，不通过时 error 是原因
 */
export function validateProfileName(name, profiles) {
    const cleaned = String(name ?? '').replace(/\s+/g, ' ').trim();
    if (!cleaned) {
        return { ok: false, error: '请填写档案名称。' };
    }
    if (cleaned.length > PROFILE_NAME_MAX_LENGTH) {
        return { ok: false, error: `档案名称最多 ${PROFILE_NAME_MAX_LENGTH} 个字符。` };
    }
    if (cleaned === CONNECTION_PROFILE_NONE_NAME) {
        return { ok: false, error: `“${CONNECTION_PROFILE_NONE_NAME}”是保留名称，请换一个。` };
    }
    if (profiles.some(profile => profile?.name === cleaned)) {
        return { ok: false, error: `已经有名为“${cleaned}”的档案。` };
    }
    return { ok: true, name: cleaned };
}

/**
 * 创建档案时输入框里预填的名称：`<API> <模型> - <预设>`，重名时加序号。
 * @param {Record<string, any>} settings settings.json 解析后的对象
 * @param {Record<string, any>[]} profiles 已有档案
 * @returns {string} 建议名称
 */
export function suggestProfileName(settings, profiles) {
    const draft = buildProfileFromCurrentConnection(settings);
    const base = [draft.api, draft.model].filter(Boolean).join(' ')
        + (draft.preset ? ` - ${draft.preset}` : '');
    const cleaned = base.replace(/\s+/g, ' ').trim().slice(0, PROFILE_NAME_MAX_LENGTH - 8) || '新连接档案';
    let candidate = cleaned;
    for (let index = 2; profiles.some(profile => profile?.name === candidate); index += 1) {
        candidate = `${cleaned} (${index})`;
    }
    return candidate;
}

// ---------------------------------------------------------------------------------------------------------------------
// 最近使用的模型（localStorage st-modern-recent-models：{ "<main_api>:<来源或类型>": [模型, ...] }，最近的在前，每个来源最多 5 个）
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @returns {Pick<Storage, 'getItem' | 'setItem'> | null} 浏览器的 localStorage；不可用（隐私模式等）时为 null
 */
function getDefaultStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

/**
 * @param {Pick<Storage, 'getItem'> | null} storage 存储
 * @returns {Record<string, string[]>} 整个映射；内容损坏时为空对象
 */
function readRecentModelsMap(storage) {
    try {
        const parsed = JSON.parse(storage?.getItem(RECENT_MODELS_STORAGE_KEY) || '{}');
        if (!isObject(parsed)) {
            return {};
        }
        return Object.fromEntries(Object.entries(parsed)
            .filter(([, list]) => Array.isArray(list))
            .map(([key, list]) => [key, list.filter(item => typeof item === 'string' && item.trim()).slice(0, RECENT_MODELS_LIMIT)]));
    } catch {
        return {};
    }
}

/**
 * @param {string} mainApi main_api 取值
 * @param {string} source 聊天补全来源或文本补全类型
 * @returns {string} 存储里的键
 */
export function getRecentModelsKey(mainApi, source) {
    return `${mainApi}:${source}`;
}

/**
 * @param {string} mainApi main_api 取值
 * @param {string} source 聊天补全来源或文本补全类型
 * @param {Pick<Storage, 'getItem'> | null} [storage] 存储，默认 localStorage
 * @returns {string[]} 这个来源最近用过的模型，最近的在前
 */
export function getRecentModels(mainApi, source, storage = getDefaultStorage()) {
    return readRecentModelsMap(storage)[getRecentModelsKey(mainApi, source)] || [];
}

/**
 * 记下一次使用的模型：移到最前、去重、只留最近 5 个。存储不可用或写入失败时静默忽略（最近模型只是便利功能）。
 * @param {string} mainApi main_api 取值
 * @param {string} source 聊天补全来源或文本补全类型
 * @param {string} model 模型 id
 * @param {Pick<Storage, 'getItem' | 'setItem'> | null} [storage] 存储，默认 localStorage
 * @returns {string[]} 更新后的列表
 */
export function recordRecentModel(mainApi, source, model, storage = getDefaultStorage()) {
    const wanted = String(model ?? '').trim();
    if (!mainApi || !source || !wanted) {
        return getRecentModels(mainApi, source, storage);
    }
    const map = readRecentModelsMap(storage);
    const key = getRecentModelsKey(mainApi, source);
    map[key] = [wanted, ...(map[key] || []).filter(item => item !== wanted)].slice(0, RECENT_MODELS_LIMIT);
    try {
        storage?.setItem(RECENT_MODELS_STORAGE_KEY, JSON.stringify(map));
    } catch {
        // 容量满或被禁用：不影响切换本身
    }
    return map[key];
}

// ---------------------------------------------------------------------------------------------------------------------
// 界面状态与视图数据（聊天输入框旁的连接标签和 API 页的档案区共用）
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {object} SwitchResult
 * @property {'profile' | 'model'} kind 来源
 * @property {string} title 结果标题
 * @property {AppliedItem[]} applied 已应用的项
 * @property {SkippedItem[]} skipped 已跳过的项
 * @property {string} summary 「已应用 N 项…」
 * @property {string} warning 附带的提醒（引擎未同步、密钥切换没有生效），没有时为空串
 * @property {number} at 完成时间
 */

/**
 * state.connectionSwitcher 的字段，缺的补上默认值（状态骨架在 core/state.js 里只是一个空对象）。
 * @param {any} state 全局界面状态
 * @returns {{
 *   open: boolean, busy: boolean, busyLabel: string, createOpen: boolean, createName: string, error: string,
 *   deleteConfirmId: string, lastResult: SwitchResult | null,
 * }} 状态对象（就是 state.connectionSwitcher 本身）
 */
export function getSwitcherState(state) {
    if (!isObject(state.connectionSwitcher)) {
        state.connectionSwitcher = {};
    }
    const switcher = state.connectionSwitcher;
    switcher.open ??= false;
    switcher.busy ??= false;
    switcher.busyLabel ??= '';
    switcher.createOpen ??= false;
    switcher.createName ??= '';
    switcher.error ??= '';
    switcher.deleteConfirmId ??= '';
    switcher.lastResult ??= null;
    return switcher;
}

/**
 * 现在不能切换连接的原因。
 * @param {any} state 全局界面状态
 * @returns {string} 原因；可以切换时为空串
 */
export function getSwitchBlocker(state) {
    if (state.engine?.generating) {
        return '生成中，等当前回复结束后再切换连接';
    }
    if (getSwitcherState(state).busy) {
        return getSwitcherState(state).busyLabel || '正在切换连接';
    }
    return '';
}

/**
 * 聊天输入框旁弹层要显示的数据。
 * @param {object} input 入参
 * @param {Record<string, any>} input.settings settings.json 解析后的对象
 * @param {Pick<Storage, 'getItem'> | null} [input.storage] 最近模型的存储，默认 localStorage
 * @returns {{
 *   profiles: (ReturnType<typeof describeProfile> & { current: boolean })[],
 *   models: { supported: boolean, sourceLabel: string, items: { model: string, current: boolean }[] },
 * }} 视图数据
 */
export function buildConnectionSwitcherView({ settings, storage }) {
    const { profiles, selectedProfile } = readConnectionManager(settings);
    const target = getCurrentModelTarget(settings);
    const items = [];
    if (target) {
        const models = [target.model, ...getRecentModels(target.mainApi, target.source, storage)].filter(Boolean);
        for (const model of [...new Set(models)].slice(0, RECENT_MODELS_LIMIT)) {
            items.push({ model, current: model === target.model });
        }
    }
    return {
        profiles: profiles.map(profile => ({ ...describeProfile(profile), current: profile.id === selectedProfile })),
        models: {
            supported: Boolean(target),
            sourceLabel: target ? getConnectionSourceLabel(target.mainApi, target.source) : '',
            items,
        },
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// 动作
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @param {object} deps 依赖
 * @param {any} deps.state 全局界面状态
 * @param {Function} deps.apiFetch 带 CSRF 的 JSON 请求
 * @param {Function} deps.loadData 重新读取全部数据
 * @param {Function} deps.render 重新渲染当前路由
 * @param {Function} deps.showToast 弹出提示
 * @param {{ reloadSettings?: Function }} [deps.bridgeReload] 引擎同步函数
 * @param {Record<string, any>} [deps.actionRegistry] 动作注册表，用它取预设列表
 * @param {Pick<Storage, 'getItem' | 'setItem'> | null} [deps.storage] 最近模型的存储，默认 localStorage
 * @returns {Record<string, Function>} 并入路由上下文的动作
 */
export function createConnectionProfileActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
    bridgeReload = {},
    actionRegistry = {},
    storage = getDefaultStorage(),
}) {
    const reloadSettings = bridgeReload.reloadSettings ?? noEngineSync;
    const store = () => getSwitcherState(state);

    function getProfiles() {
        return readConnectionManager(state.settings).profiles;
    }

    /**
     * 保存设置；失败时恢复内存里的设置并重新抛出。
     * @param {Record<string, any>} nextSettings 要保存的完整设置
     */
    async function persistSettings(nextSettings) {
        const previous = state.settings;
        state.settings = nextSettings;
        try {
            await saveSettingsSerialized(/** @type {any} */ (apiFetch), nextSettings);
        } catch (error) {
            if (state.settings === nextSettings) {
                state.settings = previous;
            }
            throw error;
        }
    }

    /**
     * 独占执行一个会改连接的操作：期间界面显示忙碌状态，输入框的发送按钮暂时禁用。
     * @param {string} label 忙碌时显示的文字
     * @param {() => Promise<any>} task 操作
     * @returns {Promise<any>} 操作的返回值
     */
    async function runExclusive(label, task) {
        const switcher = store();
        switcher.busy = true;
        switcher.busyLabel = label;
        render();
        try {
            return await task();
        } finally {
            switcher.busy = false;
            switcher.busyLabel = '';
            render();
        }
    }

    function rejectIfBlocked() {
        const reason = getSwitchBlocker(state);
        if (reason) {
            showToast('暂时不能切换连接', reason);
            return { ok: false, reason };
        }
        return null;
    }

    /**
     * 设置已经落盘之后刷新页面数据。刷新失败不算切换失败（设置和引擎都已经是新的），只作为提醒带回去。
     * @returns {Promise<string>} 失败原因，成功时为空串
     */
    async function refreshPageData() {
        try {
            await loadData({ silent: true });
            return '';
        } catch (error) {
            return error?.message || '未知原因';
        }
    }

    function recordCurrentModel(settings) {
        const target = getCurrentModelTarget(settings);
        if (target?.model) {
            recordRecentModel(target.mainApi, target.source, target.model, storage);
        }
    }

    /**
     * 应用一个连接档案：保存设置 → 需要时切换密钥 → 同时通知生成引擎重载并刷新页面数据 → 汇报结果。
     * @param {string} id 档案 id
     * @returns {Promise<{ ok: boolean, applied?: AppliedItem[], skipped?: SkippedItem[], engineSync?: any, reason?: string, error?: string }>} 结果
     */
    async function applyConnectionProfile(id) {
        const blocked = rejectIfBlocked();
        if (blocked) {
            return blocked;
        }
        const profile = findConnectionProfile(state.settings, id);
        if (!profile) {
            showToast('没有找到这个连接档案', '它可能已被删除，请刷新后再试。');
            return { ok: false, reason: 'not-found' };
        }

        const result = buildProfileApplication({
            settings: state.settings,
            profile,
            presetGroups: actionRegistry.getPresetGroups?.() ?? [],
            secretState: state.secretState,
        });
        const name = String(profile.name ?? '未命名');
        if (!result.applied.length) {
            const summary = formatApplySummary(result);
            store().lastResult = { kind: 'profile', title: `档案“${name}”`, applied: [], skipped: result.skipped, summary, warning: '', at: Date.now() };
            showToast(`档案“${name}”没有可应用的项`, summary);
            render();
            return { ok: false, reason: 'nothing-applied', applied: [], skipped: result.skipped };
        }

        return runExclusive(`正在切换到“${name}”`, async () => {
            /** @type {SecretRotation | null} */
            const rotation = result.secretRotation;
            let rotationError = '';
            try {
                await persistSettings(result.nextSettings);
                // 设置落盘后立刻通知引擎：这之后发出的生成会等它完成（bridgeReload 的在途计数）
                const engineSyncPromise = reloadSettings();
                if (rotation) {
                    try {
                        await apiFetch('/api/secrets/rotate', { body: { key: rotation.key, id: rotation.id } });
                    } catch (error) {
                        rotationError = `密钥切换请求失败：${error.message}`;
                    }
                }
                state.apiMainDraft = '';
                const [engineSync, refreshError] = await Promise.all([engineSyncPromise, refreshPageData()]);

                // /api/secrets/rotate 对不存在的 id 也回 204，所以用重新读到的密钥状态核对
                if (rotation && !rotationError) {
                    const list = state.secretState?.[rotation.key];
                    const active = Array.isArray(list) ? list.find(item => item?.active) : null;
                    if (active?.id !== rotation.id) {
                        rotationError = '服务端没有确认密钥已切换';
                    }
                }

                const applied = rotationError ? result.applied.filter(item => item.field !== 'secret-id') : result.applied;
                const skipped = rotationError
                    ? [...result.skipped, { field: 'secret-id', label: PROFILE_FIELD_LABELS['secret-id'], reason: rotationError }]
                    : result.skipped;
                const warnings = [];
                if (engineSync?.ok === false) {
                    warnings.push(`生成引擎未能同步：${engineSync.error || '未知原因'}，下次生成可能仍用旧配置`);
                }
                if (refreshError) {
                    warnings.push(`页面数据刷新失败：${refreshError}，请手动刷新`);
                }
                const summary = formatApplySummary({ applied, skipped });
                store().lastResult = { kind: 'profile', title: `档案“${name}”`, applied, skipped, summary, warning: warnings.join('；'), at: Date.now() };
                recordCurrentModel(result.nextSettings);
                showToast(`已切换到“${name}”`, `${summary}${describeReloadFailure(engineSync)}`);
                return { ok: true, applied, skipped, engineSync };
            } catch (error) {
                showToast('连接档案应用失败', error.message);
                return { ok: false, error: error.message };
            }
        });
    }

    /**
     * 把当前连接存成档案，并设为当前档案（与旧版创建后自动选中一致）。名称不合法时不抛错，错误写进 state.connectionSwitcher.error。
     * @param {string} name 档案名称
     * @returns {Promise<{ ok: boolean, error?: string, profile?: Record<string, any> }>} 结果
     */
    async function createProfileFromCurrentConnection(name) {
        const switcher = store();
        if (switcher.busy) {
            return { ok: false, error: switcher.busyLabel || '正在切换连接，请稍候。' };
        }
        const checked = validateProfileName(name, getProfiles());
        if (!checked.ok) {
            switcher.error = checked.error;
            return { ok: false, error: checked.error };
        }
        const profile = buildProfileFromCurrentConnection(state.settings, { name: checked.name, secretState: state.secretState });
        if (!profile.api) {
            const error = '当前连接无法识别，不能创建档案。请先在 API 页保存一个连接。';
            switcher.error = error;
            return { ok: false, error };
        }

        const nextSettings = structuredClone(state.settings);
        const manager = ensureConnectionManager(nextSettings);
        manager.profiles.push(profile);
        manager.selectedProfile = profile.id;
        try {
            await persistSettings(nextSettings);
        } catch (error) {
            switcher.error = `保存失败：${error.message}`;
            showToast('连接档案创建失败', error.message);
            return { ok: false, error: error.message };
        }

        switcher.error = '';
        switcher.createOpen = false;
        switcher.createName = '';
        const recordedCount = Object.keys(profile).filter(key => !['id', 'mode', 'name', 'exclude'].includes(key)).length;
        showToast('已创建连接档案', `“${checked.name}”，记录了 ${formatNumber(recordedCount)} 项设置`);
        render();
        // 档案列表只是附带同步给引擎：不等它，也不让它挡住界面
        reloadSettings().then(sync => {
            if (sync?.ok === false) {
                showToast('生成引擎未能同步档案列表', sync.error || '未知原因');
            }
        });
        return { ok: true, profile };
    }

    /**
     * 删除一个档案（二次确认由界面完成）。
     * @param {string} id 档案 id
     * @returns {Promise<{ ok: boolean, error?: string }>} 结果
     */
    async function deleteConnectionProfile(id) {
        const switcher = store();
        if (switcher.busy) {
            return { ok: false, error: switcher.busyLabel || '正在切换连接，请稍候。' };
        }
        const profile = findConnectionProfile(state.settings, id);
        if (!profile) {
            showToast('没有找到这个连接档案', '它可能已被删除。');
            switcher.deleteConfirmId = '';
            render();
            return { ok: false, error: 'not-found' };
        }

        const nextSettings = structuredClone(state.settings);
        const manager = ensureConnectionManager(nextSettings);
        manager.profiles = manager.profiles.filter(item => item?.id !== id);
        if (manager.selectedProfile === id) {
            manager.selectedProfile = null;
        }
        try {
            await persistSettings(nextSettings);
        } catch (error) {
            showToast('连接档案删除失败', error.message);
            return { ok: false, error: error.message };
        }

        switcher.deleteConfirmId = '';
        if (switcher.lastResult?.kind === 'profile') {
            switcher.lastResult = null;
        }
        showToast('已删除连接档案', `“${String(profile.name ?? '未命名')}”`);
        render();
        reloadSettings().then(sync => {
            if (sync?.ok === false) {
                showToast('生成引擎未能同步档案列表', sync.error || '未知原因');
            }
        });
        return { ok: true };
    }

    /**
     * 只换当前来源的模型（聊天补全写 `<来源>_model`，文本补全写 `<类型>_model`）：保存 → 通知引擎 → 刷新页面数据，并记入最近模型。
     * @param {string} model 模型 id
     * @returns {Promise<{ ok: boolean, unchanged?: boolean, reason?: string, error?: string, engineSync?: any }>} 结果
     */
    async function switchModelQuick(model) {
        const blocked = rejectIfBlocked();
        if (blocked) {
            return blocked;
        }
        /** @type {ReturnType<typeof applyModelToSettings>} */
        let change;
        try {
            change = applyModelToSettings(state.settings, model);
        } catch (error) {
            showToast('不能切换模型', error.message);
            return { ok: false, error: error.message };
        }
        if (change.unchanged) {
            showToast('已经在使用这个模型', String(model));
            return { ok: true, unchanged: true };
        }

        const wanted = String(model).trim();
        return runExclusive(`正在切换到 ${wanted}`, async () => {
            try {
                await persistSettings(change.nextSettings);
                const engineSyncPromise = reloadSettings();
                state.apiMainDraft = '';
                const [engineSync, refreshError] = await Promise.all([engineSyncPromise, refreshPageData()]);
                recordRecentModel(change.target.mainApi, change.target.source, wanted, storage);
                const applied = [{ field: 'model', label: PROFILE_FIELD_LABELS.model, value: wanted }];
                const summary = `已切换到 ${wanted}`;
                const warning = [
                    engineSync?.ok === false ? `生成引擎未能同步：${engineSync.error || '未知原因'}，下次生成可能仍用旧配置` : '',
                    refreshError ? `页面数据刷新失败：${refreshError}，请手动刷新` : '',
                ].filter(Boolean).join('；');
                store().lastResult = { kind: 'model', title: `${getConnectionSourceLabel(change.target.mainApi, change.target.source)} 的模型`, applied, skipped: [], summary, warning, at: Date.now() };
                showToast('已切换模型', `${wanted}${describeReloadFailure(engineSync)}`);
                return { ok: true, engineSync };
            } catch (error) {
                showToast('模型切换失败', error.message);
                return { ok: false, error: error.message };
            }
        });
    }

    function suggestConnectionProfileName() {
        return suggestProfileName(state.settings || {}, getProfiles());
    }

    return {
        applyConnectionProfile,
        createProfileFromCurrentConnection,
        deleteConnectionProfile,
        switchModelQuick,
        suggestConnectionProfileName,
    };
}
