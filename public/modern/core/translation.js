// 翻译（B3）的纯函数部分：翻译服务清单、语言码、分块、占位符保护、译文在消息 extra 里的读写、报错说明。
// 没有 DOM、网络、localStorage 依赖，tests/modern-translation.test.js 直接覆盖；发请求的部分在 actions/translation-client.js。
//
// 旧版对照（public/scripts/extensions/translate/index.js）：
//   - 设置键：target_language / internal_language / provider / auto_mode / deepl_endpoint，存在 extension_settings.translate；
//   - 译文只用于显示：AI 回复的译文放 extra.display_text，推理内容的译文放 extra.reasoning_display_text，原文始终留在 mes；
//   - 旧版先按 Markdown 图片链接把文本切开，只翻译链接之间的文字，链接原样拼回；
//   - 单次请求的长度上限：google / lingva 5000，deeplx 1500，bing 1000，其余不分块。
import { alternateGreetingsToInput, inputToAlternateGreetings } from './utils.js';
import { getReplyLanguageOption, resolveReplyLanguage } from '../../shared/reply-language.js';

// ---------------------------------------------------------------------------------------------------------------------
// 翻译服务
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {object} TranslateProvider
 * @property {string} id 存在 extension_settings.translate.provider 里的值（与旧版一致）
 * @property {string} label 界面名称
 * @property {string} route /api/translate/<route>，OneRing 的路由名与 id 不同
 * @property {number} chunkLimit 单次请求的字符数上限，更长的文本按这个长度分块逐块请求
 * @property {'public' | 'self-hosted'} scope public：文本发给第三方公网服务；self-hosted：发到你配置的地址
 * @property {string} keySecret API Key 的密钥名，空表示没有
 * @property {boolean} keyRequired 没有 API Key 能不能用
 * @property {string} urlSecret 服务地址的密钥名，空表示没有
 * @property {boolean} urlRequired 没有地址能不能用
 * @property {string} defaultUrl 不填地址时后端使用的默认地址
 * @property {string} description 一句话说明（需要什么、文本发到哪里）
 */

/** @type {readonly TranslateProvider[]} */
export const TRANSLATE_PROVIDERS = Object.freeze([
    {
        id: 'google',
        label: 'Google 翻译',
        route: 'google',
        chunkLimit: 5000,
        scope: 'public',
        keySecret: '',
        keyRequired: false,
        urlSecret: '',
        urlRequired: false,
        defaultUrl: '',
        description: '免密钥，不用配置；文本经本机后端转发给 Google（第三方公网服务）。使用的是非官方接口，可能被限流或在部分网络下不可用。',
    },
    {
        id: 'bing',
        label: 'Bing 翻译',
        route: 'bing',
        chunkLimit: 1000,
        scope: 'public',
        keySecret: '',
        keyRequired: false,
        urlSecret: '',
        urlRequired: false,
        defaultUrl: '',
        description: '免密钥，不用配置；文本发给微软 Bing 翻译（第三方公网服务）。单次请求只能带 1000 字，长文本会拆成很多段。',
    },
    {
        id: 'lingva',
        label: 'Lingva',
        route: 'lingva',
        chunkLimit: 5000,
        scope: 'public',
        keySecret: '',
        keyRequired: false,
        urlSecret: 'lingva_url',
        urlRequired: false,
        defaultUrl: 'https://lingva.ml/api/v1',
        description: '免密钥；地址留空时使用公共实例 lingva.ml（第三方公网服务），也可以填你自己部署的 Lingva 地址。',
    },
    {
        id: 'yandex',
        label: 'Yandex 翻译',
        route: 'yandex',
        chunkLimit: 5000,
        scope: 'public',
        keySecret: '',
        keyRequired: false,
        urlSecret: '',
        urlRequired: false,
        defaultUrl: '',
        description: '免密钥，不用配置；文本发给 Yandex（第三方公网服务）。',
    },
    {
        id: 'deepl',
        label: 'DeepL',
        route: 'deepl',
        chunkLimit: 5000,
        scope: 'public',
        keySecret: 'deepl',
        keyRequired: true,
        urlSecret: '',
        urlRequired: false,
        defaultUrl: '',
        description: '需要 DeepL API Key，并选择免费版或 Pro 版接口；文本发给 DeepL（第三方公网服务）。',
    },
    {
        id: 'libre',
        label: 'LibreTranslate',
        route: 'libre',
        chunkLimit: 5000,
        scope: 'self-hosted',
        keySecret: 'libre',
        keyRequired: false,
        urlSecret: 'libre_url',
        urlRequired: true,
        defaultUrl: '',
        description: '必须填写 LibreTranslate 服务地址（API Key 视该服务是否要求而定）；文本发到你填写的地址。',
    },
    {
        id: 'oneringtranslator',
        label: 'OneRingTranslator',
        route: 'onering',
        chunkLimit: 1500,
        scope: 'self-hosted',
        keySecret: '',
        keyRequired: false,
        urlSecret: 'oneringtranslator_url',
        urlRequired: false,
        defaultUrl: 'http://127.0.0.1:4990/translate',
        description: '本机或自建的 OneRingTranslator；地址留空时使用 http://127.0.0.1:4990/translate，文本发到该地址。',
    },
    {
        id: 'deeplx',
        label: 'DeepLX',
        route: 'deeplx',
        chunkLimit: 1500,
        scope: 'self-hosted',
        keySecret: '',
        keyRequired: false,
        urlSecret: 'deeplx_url',
        urlRequired: false,
        defaultUrl: 'http://127.0.0.1:1188/translate',
        description: '本机或自建的 DeepLX；地址留空时使用 http://127.0.0.1:1188/translate，文本发到该地址。',
    },
]);

export const DEFAULT_TRANSLATE_PROVIDER = 'google';

/** 翻译方式：大模型翻译（走设置中心「模型连接」里的翻译场景，默认）或机器翻译（上面的服务）。 */
export const TRANSLATE_MODES = Object.freeze(['llm', 'machine']);
export const DEFAULT_TRANSLATE_MODE = 'llm';

/**
 * 大模型翻译的显示名和分块上限。它不进 TRANSLATE_PROVIDERS：方式另存在 translate.mode，
 * 旧版翻译扩展（在生成引擎里运行）看到的 provider 始终是它认识的机器翻译服务。
 */
export const LLM_TRANSLATION = Object.freeze({ id: 'llm', label: '大模型翻译', chunkLimit: 3000 });

/**
 * @param {string} id 翻译服务 id
 * @returns {TranslateProvider | undefined} 服务信息，未知 id 返回 undefined
 */
export function getTranslateProvider(id) {
    return TRANSLATE_PROVIDERS.find(provider => provider.id === id);
}

/**
 * 界面上称呼当前翻译方式的名字：大模型翻译，或机器翻译服务的名字。
 * @param {{ mode?: string, provider?: string }} settings resolveTranslateSettings 的结果
 * @returns {string} 名字
 */
export function getTranslatorLabel(settings) {
    if (settings?.mode === 'llm') {
        return LLM_TRANSLATION.label;
    }
    return getTranslateProvider(settings?.provider)?.label || settings?.provider || '';
}

/**
 * 隐私提示里的一句话：这次翻译会把文本发给谁。
 * @param {TranslateProvider} provider 翻译服务
 * @param {boolean} [urlConfigured] 是否已经配置了服务地址
 * @returns {string} 提示文字
 */
export function describeTranslatePrivacy(provider, urlConfigured = false) {
    if (provider.scope === 'public') {
        const custom = provider.id === 'lingva' && urlConfigured;
        return custom
            ? '翻译会把文本发送到你配置的 Lingva 地址。'
            : `翻译会把文本发送给第三方翻译服务（${provider.label}），文本会离开你的电脑。`;
    }
    return urlConfigured || provider.defaultUrl
        ? `翻译会把文本发送到你配置的 ${provider.label} 地址（${urlConfigured ? '已填写' : provider.defaultUrl}）。`
        : `翻译会把文本发送到你配置的 ${provider.label} 地址。`;
}

// ---------------------------------------------------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------------------------------------------------

export const AUTO_MODES = Object.freeze(['none', 'responses', 'inputs', 'both']);

export const AUTO_MODE_LABELS = Object.freeze({
    none: '关闭',
    responses: '翻译回复',
    inputs: '翻译输入',
    both: '翻译回复和输入',
});

// 旧版翻译扩展的出厂值；target_language 'en' 对中文界面没有意义，所以设置里从没出现过 target_language 时 Modern 用简体中文
export const LEGACY_TRANSLATE_DEFAULTS = Object.freeze({
    target_language: 'en',
    internal_language: 'en',
    provider: DEFAULT_TRANSLATE_PROVIDER,
    auto_mode: 'none',
    deepl_endpoint: 'free',
});

export const MODERN_DEFAULT_TARGET_LANGUAGE = 'zh-CN';

/**
 * @typedef {object} TranslateSettings
 * @property {string} provider 翻译服务 id
 * @property {string} target_language 目标语言码
 * @property {string} internal_language 内部语言码（旧版：模型使用的语言；Modern 一期只在 OneRing 里当源语言）
 * @property {string} auto_mode 旧版自动翻译模式
 * @property {string} deepl_endpoint 'free' 或 'pro'
 * @property {boolean} configured settings 里是否已经有翻译设置
 * @property {'llm' | 'machine'} mode 翻译方式
 * @property {boolean} follow_reply_language 目标语言跟随设置中心「语言」里的回复语言
 * @property {boolean} auto_greeting 打开聊天时自动翻译不是目标语言的开场白
 */

/**
 * 读出生效的翻译设置：缺失或非法的项取默认值，不修改传入对象。
 * @param {any} settings state.settings（整份 settings.json）
 * @returns {TranslateSettings} 翻译设置
 */
export function resolveTranslateSettings(settings) {
    const raw = settings?.extension_settings?.translate;
    const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const hasTarget = typeof stored.target_language === 'string' && stored.target_language !== '';
    // 没存过「跟随」时：从没选过目标语言就跟随回复语言，选过就沿用选过的
    const followReply = typeof stored.follow_reply_language === 'boolean' ? stored.follow_reply_language : !hasTarget;
    const replyLanguage = resolveReplyLanguage(settings?.power_user);
    const storedTarget = normalizeLanguageCode(stored.target_language, hasTarget ? LEGACY_TRANSLATE_DEFAULTS.target_language : MODERN_DEFAULT_TARGET_LANGUAGE);
    return {
        mode: TRANSLATE_MODES.includes(stored.mode) ? stored.mode : DEFAULT_TRANSLATE_MODE,
        follow_reply_language: followReply,
        auto_greeting: stored.auto_greeting !== false,
        provider: getTranslateProvider(stored.provider) ? stored.provider : DEFAULT_TRANSLATE_PROVIDER,
        target_language: followReply && getReplyLanguageOption(replyLanguage) ? replyLanguage : storedTarget,
        internal_language: normalizeLanguageCode(stored.internal_language, LEGACY_TRANSLATE_DEFAULTS.internal_language),
        auto_mode: AUTO_MODES.includes(stored.auto_mode) ? stored.auto_mode : 'none',
        deepl_endpoint: stored.deepl_endpoint === 'pro' ? 'pro' : 'free',
        configured: Object.keys(stored).length > 0,
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// 语言
// ---------------------------------------------------------------------------------------------------------------------

// 与旧版 translate 扩展 languageCodes 一致（后端按提供方再做一次码映射，例如 zh-CN → zh / zh-Hans / ZH）
const LANGUAGE_NAMES = Object.freeze({
    'af': 'Afrikaans', 'sq': 'Albanian', 'am': 'Amharic', 'ar': 'Arabic', 'hy': 'Armenian', 'az': 'Azerbaijani',
    'eu': 'Basque', 'be': 'Belarusian', 'bn': 'Bengali', 'bs': 'Bosnian', 'bg': 'Bulgarian', 'ca': 'Catalan',
    'ceb': 'Cebuano', 'zh-CN': 'Chinese (Simplified)', 'zh-TW': 'Chinese (Traditional)', 'co': 'Corsican',
    'hr': 'Croatian', 'cs': 'Czech', 'da': 'Danish', 'nl': 'Dutch', 'en': 'English', 'eo': 'Esperanto',
    'et': 'Estonian', 'fi': 'Finnish', 'fr': 'French', 'fy': 'Frisian', 'gl': 'Galician', 'ka': 'Georgian',
    'de': 'German', 'el': 'Greek', 'gu': 'Gujarati', 'ht': 'Haitian Creole', 'ha': 'Hausa', 'haw': 'Hawaiian',
    'iw': 'Hebrew', 'hi': 'Hindi', 'hmn': 'Hmong', 'hu': 'Hungarian', 'is': 'Icelandic', 'ig': 'Igbo',
    'id': 'Indonesian', 'ga': 'Irish', 'it': 'Italian', 'ja': 'Japanese', 'jw': 'Javanese', 'kn': 'Kannada',
    'kk': 'Kazakh', 'km': 'Khmer', 'ko': 'Korean', 'ku': 'Kurdish', 'ky': 'Kyrgyz', 'lo': 'Lao', 'la': 'Latin',
    'lv': 'Latvian', 'lt': 'Lithuanian', 'lb': 'Luxembourgish', 'mk': 'Macedonian', 'mg': 'Malagasy', 'ms': 'Malay',
    'ml': 'Malayalam', 'mt': 'Maltese', 'mi': 'Maori', 'mr': 'Marathi', 'mn': 'Mongolian', 'my': 'Myanmar (Burmese)',
    'ne': 'Nepali', 'no': 'Norwegian', 'ny': 'Nyanja (Chichewa)', 'ps': 'Pashto', 'fa': 'Persian', 'pl': 'Polish',
    'pt-PT': 'Portuguese (Portugal)', 'pt-BR': 'Portuguese (Brazil)', 'pa': 'Punjabi', 'ro': 'Romanian',
    'ru': 'Russian', 'sm': 'Samoan', 'gd': 'Scots Gaelic', 'sr': 'Serbian', 'st': 'Sesotho', 'sn': 'Shona',
    'sd': 'Sindhi', 'si': 'Sinhala (Sinhalese)', 'sk': 'Slovak', 'sl': 'Slovenian', 'so': 'Somali', 'es': 'Spanish',
    'su': 'Sundanese', 'sw': 'Swahili', 'sv': 'Swedish', 'tl': 'Tagalog (Filipino)', 'tg': 'Tajik', 'ta': 'Tamil',
    'te': 'Telugu', 'th': 'Thai', 'tr': 'Turkish', 'uk': 'Ukrainian', 'ur': 'Urdu', 'uz': 'Uzbek', 'vi': 'Vietnamese',
    'cy': 'Welsh', 'xh': 'Xhosa', 'yi': 'Yiddish', 'yo': 'Yoruba', 'zu': 'Zulu',
});

// Intl.DisplayNames 对这几个码给出的中文名不如常用说法清楚
const LANGUAGE_NAME_OVERRIDES = Object.freeze({
    'zh-CN': '简体中文',
    'zh-TW': '繁体中文',
    'pt-PT': '葡萄牙语（葡萄牙）',
    'pt-BR': '葡萄牙语（巴西）',
});

/** @type {Intl.DisplayNames | null | undefined} */
let chineseLanguageNames;

function getChineseLanguageName(code) {
    if (Object.hasOwn(LANGUAGE_NAME_OVERRIDES, code)) {
        return LANGUAGE_NAME_OVERRIDES[code];
    }
    if (chineseLanguageNames === undefined) {
        try {
            chineseLanguageNames = new Intl.DisplayNames(['zh-CN'], { type: 'language' });
        } catch {
            chineseLanguageNames = null;
        }
    }
    try {
        const name = chineseLanguageNames?.of(code);
        return name && name !== code ? name : '';
    } catch {
        return '';
    }
}

/** @type {readonly { code: string, name: string }[]} */
export const TRANSLATE_LANGUAGES = Object.freeze(Object.entries(LANGUAGE_NAMES).map(([code, name]) => ({ code, name })));

/**
 * @param {unknown} value 语言码，大小写不敏感
 * @param {string} [fallback] 不在列表里时返回的值
 * @returns {string} 列表里的标准写法（例如 'zh-cn' → 'zh-CN'），不认识时返回 fallback
 */
export function normalizeLanguageCode(value, fallback = '') {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) {
        return fallback;
    }
    const match = Object.keys(LANGUAGE_NAMES).find(code => code.toLowerCase() === text);
    return match || fallback;
}

/**
 * @param {string} code 语言码
 * @returns {boolean} 是不是中文（简体或繁体）
 */
export function isChineseLanguage(code) {
    return /^zh(-|$)/i.test(String(code || ''));
}

/**
 * 界面上的语言名：中文名加英文名，例如「日语（Japanese）」「简体中文（Chinese (Simplified)）」。
 * @param {string} code 语言码
 * @returns {string} 名称；不在列表里的码原样返回
 */
export function getLanguageLabel(code) {
    const normalized = normalizeLanguageCode(code);
    if (!normalized) {
        return String(code || '');
    }
    const english = LANGUAGE_NAMES[normalized];
    const chinese = getChineseLanguageName(normalized);
    return chinese && chinese !== english ? `${chinese}（${english}）` : english;
}

/**
 * 按钮上的短名：中文不带英文括号，其他语言用中文名（取不到时用英文名）。
 * @param {string} code 语言码
 * @returns {string} 短名
 */
export function getLanguageShortLabel(code) {
    const normalized = normalizeLanguageCode(code);
    if (!normalized) {
        return String(code || '');
    }
    return getChineseLanguageName(normalized) || LANGUAGE_NAMES[normalized];
}

/**
 * OneRingTranslator 需要明确的源语言。旧版规则：目标语言等于内部语言时，源语言用目标语言设置，否则用内部语言。
 * @param {string} targetLanguage 这次要翻译成的语言码
 * @param {Pick<TranslateSettings, 'internal_language' | 'target_language'>} settings 翻译设置
 * @returns {{ from_lang: string, to_lang: string }} OneRing 的源语言和目标语言
 */
export function getOneRingLanguages(targetLanguage, settings) {
    const from = targetLanguage === settings.internal_language ? settings.target_language : settings.internal_language;
    return { from_lang: from, to_lang: targetLanguage };
}

// ---------------------------------------------------------------------------------------------------------------------
// 分块
// ---------------------------------------------------------------------------------------------------------------------

// 与旧版相同的 Markdown 图片链接写法
const IMAGE_LINK_SOURCE = '!\\[.*?]\\([^)]*\\)';

/**
 * 按图片链接把文本切开：文字部分交给翻译，链接原样保留（链接里的地址不该发给翻译服务）。
 * @param {string} text 文本
 * @returns {{ type: 'text' | 'image', value: string }[]} 依次排列的片段，拼起来等于原文；没有空片段
 */
export function splitAroundImageLinks(text) {
    const input = String(text ?? '');
    /** @type {{ type: 'text' | 'image', value: string }[]} */
    const parts = [];
    let cursor = 0;
    for (const match of input.matchAll(new RegExp(IMAGE_LINK_SOURCE, 'g'))) {
        if (match.index > cursor) {
            parts.push({ type: 'text', value: input.slice(cursor, match.index) });
        }
        parts.push({ type: 'image', value: match[0] });
        cursor = match.index + match[0].length;
    }
    if (cursor < input.length) {
        parts.push({ type: 'text', value: input.slice(cursor) });
    }
    return parts;
}

// 由粗到细的断点：先在空行切，再换行、句末、空格，最后才硬切
const DEFAULT_DELIMITERS = Object.freeze(['\n\n', '\n', '。', '！', '？', '. ', '! ', '? ', ' ']);

function splitKeepingDelimiter(text, delimiter) {
    const pieces = [];
    let cursor = 0;
    for (;;) {
        const hit = text.indexOf(delimiter, cursor);
        if (hit < 0) {
            break;
        }
        pieces.push(text.slice(cursor, hit + delimiter.length));
        cursor = hit + delimiter.length;
    }
    if (cursor < text.length) {
        pieces.push(text.slice(cursor));
    }
    return pieces;
}

function findProtectedRanges(text, pattern) {
    if (!pattern) {
        return [];
    }
    return [...text.matchAll(pattern)].map(match => ({ start: match.index, end: match.index + match[0].length }));
}

function hardSplit(text, limit, pattern) {
    const ranges = findProtectedRanges(text, pattern);
    const pieces = [];
    let start = 0;
    while (start < text.length) {
        let end = Math.min(start + limit, text.length);
        if (end < text.length) {
            // 不拆开代理对（emoji 等）
            const code = text.charCodeAt(end - 1);
            if (code >= 0xD800 && code <= 0xDBFF) {
                end -= 1;
            }
            // 不切进占位符里面
            const range = ranges.find(item => item.start < end && end < item.end);
            if (range && range.start > start) {
                end = range.start;
            }
        }
        if (end <= start) {
            end = Math.min(start + limit, text.length);
        }
        pieces.push(text.slice(start, end));
        start = end;
    }
    return pieces;
}

function splitPieces(text, limit, delimiters, pattern) {
    if (text.length <= limit) {
        return [text];
    }
    const index = delimiters.findIndex(delimiter => text.includes(delimiter));
    if (index < 0) {
        return hardSplit(text, limit, pattern);
    }
    const rest = delimiters.slice(index + 1);
    return splitKeepingDelimiter(text, delimiters[index])
        .flatMap(piece => piece.length <= limit ? [piece] : splitPieces(piece, limit, rest, pattern));
}

/**
 * 把长文本切成不超过 limit 个字符的块。块保留各自末尾的断点（换行、空格），所以 `chunks.join('') === text`，
 * 旧版 splitRecursive 会丢掉块之间的分隔符，译文拼起来就少了段落间的空行。
 * @param {string} text 文本
 * @param {number} limit 每块的字符上限；不是正数时不分块
 * @param {{ delimiters?: readonly string[], keepTogether?: RegExp | null }} [options] delimiters：断点，由粗到细；
 * keepTogether：带 g 标志的正则，硬切时不会切进它匹配到的内容（占位符）
 * @returns {string[]} 分块结果；空文本返回 ['']
 */
export function splitIntoChunks(text, limit, { delimiters = DEFAULT_DELIMITERS, keepTogether = null } = {}) {
    const input = String(text ?? '');
    if (!Number.isFinite(limit) || limit <= 0 || input.length <= limit) {
        return [input];
    }

    const chunks = [];
    let current = '';
    for (const piece of splitPieces(input, limit, delimiters, keepTogether)) {
        if (current && current.length + piece.length > limit) {
            chunks.push(current);
            current = piece;
        } else {
            current += piece;
        }
    }
    if (current) {
        chunks.push(current);
    }
    return chunks;
}

// ---------------------------------------------------------------------------------------------------------------------
// 占位符保护
// ---------------------------------------------------------------------------------------------------------------------

// 翻译服务会把 {{char}} 译成「{{字符}}」、把 <START> 译坏、改写图片地址，所以这些内容先换成带编号的占位符，译完再换回来。
const PROTECT_SOURCES = Object.freeze({
    code: '```[\\s\\S]*?```',
    image: IMAGE_LINK_SOURCE,
    macro: '\\{\\{[\\s\\S]*?\\}\\}',
    tag: '<\\/?[A-Za-z][^<>]*>',
});

// 占位符写法，按顺序取第一种没有出现在原文里的；译文里的括号可能被换成全角，所以识别时容忍全角和空格
const MARKER_STYLES = Object.freeze([
    { open: '[[', close: ']]' },
    { open: '((', close: '))' },
    { open: '⟦', close: '⟧' },
]);

const MARKER_ALTERNATIVES = Object.freeze({
    '[': '[\\[［【]',
    ']': '[\\]］】]',
    '(': '[(（]',
    ')': '[)）]',
    '⟦': '[⟦［【]',
    '⟧': '[⟧］】]',
});

function markerClass(text) {
    return [...text].map(char => MARKER_ALTERNATIVES[char] || char).join('');
}

function markerPatternSource(style) {
    return `${markerClass(style.open)}\\s*(\\d+)\\s*${markerClass(style.close)}`;
}

/**
 * @typedef {object} PlaceholderProtection
 * @property {string} text 已把受保护内容换成占位符的文本
 * @property {{ index: number, kind: string, original: string }[]} tokens 占位符清单，编号从 1 开始
 * @property {string} patternSource 识别占位符的正则源码（容忍空格和全角括号），没有占位符时为空
 */

/**
 * 把宏（{{char}}）、HTML 标签（含 <START>）、Markdown 图片链接和代码块换成带编号的占位符，如 [[1]]。
 * @param {string} text 原文
 * @param {{ images?: boolean, macros?: boolean, tags?: boolean, code?: boolean }} [options] 各类内容是否保护，默认全部
 * @returns {PlaceholderProtection} 保护结果；没有可保护内容时 tokens 为空，text 即原文
 */
export function protectPlaceholders(text, { images = true, macros = true, tags = true, code = true } = {}) {
    const input = String(text ?? '');
    const kinds = [];
    if (code) kinds.push('code');
    if (images) kinds.push('image');
    if (macros) kinds.push('macro');
    if (tags) kinds.push('tag');
    if (!kinds.length) {
        return { text: input, tokens: [], patternSource: '' };
    }

    const combined = new RegExp(kinds.map(kind => `(${PROTECT_SOURCES[kind]})`).join('|'), 'g');
    const matches = [...input.matchAll(combined)];
    if (!matches.length) {
        return { text: input, tokens: [], patternSource: '' };
    }

    const style = MARKER_STYLES.find(candidate => !new RegExp(markerPatternSource(candidate)).test(input));
    if (!style) {
        throw new Error('文本里已经有和占位符相同的符号，无法保护其中的宏和标签。');
    }

    const tokens = [];
    let result = '';
    let cursor = 0;
    for (const match of matches) {
        const index = tokens.length + 1;
        const kind = kinds[match.slice(1).findIndex(group => group !== undefined)];
        tokens.push({ index, kind, original: match[0] });
        result += input.slice(cursor, match.index) + style.open + index + style.close;
        cursor = match.index + match[0].length;
    }
    result += input.slice(cursor);

    return { text: result, tokens, patternSource: markerPatternSource(style) };
}

/**
 * @typedef {object} PlaceholderIssues
 * @property {{ index: number, kind: string, original: string }[]} missing 译文里不见了的占位符
 * @property {{ index: number, kind: string, original: string }[]} duplicated 译文里出现了多次的占位符
 * @property {string[]} unexpected 编号不在清单里的占位符
 */

/**
 * 把译文里的占位符换回原内容，并核对数量：每个占位符必须正好出现一次。
 * @param {string} translated 译文
 * @param {PlaceholderProtection} protection protectPlaceholders 的结果
 * @returns {{ text: string, ok: boolean } & PlaceholderIssues} text 是还原后的文本（有问题时仍尽量还原），ok 表示数量完全对得上
 */
export function restorePlaceholders(translated, protection) {
    const output = String(translated ?? '');
    if (!protection.tokens.length) {
        return { text: output, ok: true, missing: [], duplicated: [], unexpected: [] };
    }

    const counts = protection.tokens.map(() => 0);
    /** @type {string[]} */
    const unexpected = [];
    const text = output.replace(new RegExp(protection.patternSource, 'g'), (match, number) => {
        const token = protection.tokens[Number(number) - 1];
        if (!token) {
            unexpected.push(match);
            return match;
        }
        counts[token.index - 1] += 1;
        return token.original;
    });
    const missing = protection.tokens.filter(token => counts[token.index - 1] === 0);
    const duplicated = protection.tokens.filter(token => counts[token.index - 1] > 1);
    return { text, ok: !missing.length && !duplicated.length && !unexpected.length, missing, duplicated, unexpected };
}

function shorten(text, length = 24) {
    const flat = String(text).replace(/\s+/g, ' ');
    return flat.length > length ? `${flat.slice(0, length)}…` : flat;
}

/**
 * @param {PlaceholderIssues} issues 占位符核对结果
 * @returns {string} 一句话说明哪些内容丢了或多了，没有问题返回空字符串
 */
export function describePlaceholderIssues(issues) {
    const parts = [];
    if (issues.missing.length) {
        parts.push(`译文里缺少 ${issues.missing.length} 处原有内容（${issues.missing.slice(0, 3).map(token => shorten(token.original)).join('、')}${issues.missing.length > 3 ? ' 等' : ''}）`);
    }
    if (issues.duplicated.length) {
        parts.push(`${issues.duplicated.length} 处原有内容在译文里重复出现`);
    }
    if (issues.unexpected.length) {
        parts.push(`多出 ${issues.unexpected.length} 个无法对应的占位符`);
    }
    return parts.join('；');
}

// ---------------------------------------------------------------------------------------------------------------------
// 翻译流程
// ---------------------------------------------------------------------------------------------------------------------

const HAS_LETTER_PATTERN = /[\p{L}\p{N}]/u;

function splitEdgeWhitespace(chunk) {
    const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(chunk) || ['', '', chunk, ''];
    return { lead, core, trail };
}

function createAbortError() {
    const error = new Error('翻译已取消。');
    error.name = 'AbortError';
    return error;
}

/**
 * @typedef {object} TranslateTextOptions
 * @property {(chunk: string) => Promise<string>} translateChunk 翻译一块文本，返回译文；失败时抛错
 * @property {number} [chunkLimit] 每块的字符上限，默认不分块
 * @property {'split' | 'placeholder'} [imageMode] 图片链接的处理：split 按链接切开、链接不进翻译请求（旧版做法，聊天消息用）；
 * placeholder 换成占位符（角色卡字段用）
 * @property {{ macros?: boolean, tags?: boolean, code?: boolean }} [protect] 要保护的内容，默认全部
 * @property {AbortSignal} [signal] 取消信号
 */

/**
 * @typedef {object} TranslateTextResult
 * @property {string} text 译文（占位符已还原；有问题时是尽力还原的结果）
 * @property {boolean} ok 占位符数量是否完全对得上
 * @property {PlaceholderIssues} issues 占位符核对结果
 * @property {number} requests 实际发出的翻译请求数
 */

/**
 * 翻译一段文本：先保护宏和标签，按服务的长度上限分块，逐块请求，译完还原并核对占位符。
 * 每块的首尾空白不发给翻译服务，译完原样补回，所以段落之间的空行不会丢。
 * @param {string} text 原文
 * @param {TranslateTextOptions} options 选项
 * @returns {Promise<TranslateTextResult>} 译文
 */
export async function translateText(text, { translateChunk, chunkLimit = 0, imageMode = 'split', protect = {}, signal }) {
    const input = String(text ?? '');
    const issues = { missing: [], duplicated: [], unexpected: [] };
    let requests = 0;

    async function translateSegment(segment) {
        const protection = protectPlaceholders(segment, { ...protect, images: imageMode === 'placeholder' });
        const tokenPattern = protection.patternSource ? new RegExp(protection.patternSource, 'g') : null;
        const chunks = splitIntoChunks(protection.text, chunkLimit, { keepTogether: tokenPattern });
        let joined = '';
        for (const chunk of chunks) {
            const { lead, core, trail } = splitEdgeWhitespace(chunk);
            const translatable = HAS_LETTER_PATTERN.test(tokenPattern ? core.replace(tokenPattern, '') : core);
            if (!translatable) {
                joined += chunk;
                continue;
            }
            if (signal?.aborted) {
                throw createAbortError();
            }
            requests += 1;
            joined += lead + await translateChunk(core) + trail;
        }
        const restored = restorePlaceholders(joined, protection);
        issues.missing.push(...restored.missing);
        issues.duplicated.push(...restored.duplicated);
        issues.unexpected.push(...restored.unexpected);
        return restored.text;
    }

    if (!input.trim()) {
        return { text: input, ok: true, issues, requests };
    }

    let result = '';
    if (imageMode === 'split') {
        for (const part of splitAroundImageLinks(input)) {
            result += part.type === 'image' ? part.value : await translateSegment(part.value);
        }
    } else {
        result = await translateSegment(input);
    }

    const ok = !issues.missing.length && !issues.duplicated.length && !issues.unexpected.length;
    return { text: result, ok, issues, requests };
}

// ---------------------------------------------------------------------------------------------------------------------
// 报错说明
// ---------------------------------------------------------------------------------------------------------------------

/**
 * 把 /api/translate/* 的失败整理成一句能照着处理的中文。后端失败时返回 `{ error, message, detail? }`（见 src/endpoints/translate.js），
 * apiFetch 抛出的错误带 status 和 body。
 * @param {any} error 抛出的错误，可以带 status（HTTP 状态）和 body（响应文本）
 * @param {string} providerId 翻译服务 id
 * @returns {string} 面向用户的说明
 */
export function describeTranslateFailure(error, providerId) {
    const provider = getTranslateProvider(providerId);
    const label = provider?.label || providerId || '翻译服务';
    const status = Number(error?.status) || 0;

    /** @type {any} */
    let body = null;
    if (typeof error?.body === 'string' && error.body.trim().startsWith('{')) {
        try {
            body = JSON.parse(error.body);
        } catch {
            body = null;
        }
    }

    const hint = '到「设置 → 聊天工具 → 翻译」检查配置，或换一个翻译服务重试。';
    switch (body?.error) {
        case 'url_not_configured':
            return `${label} 还没有配置服务地址。${hint}`;
        case 'key_not_configured':
            return `${label} 还没有填写 API Key。${hint}`;
        case 'invalid_request':
            return `${label} 拒绝了请求：缺少文本或目标语言。`;
        case 'provider_error':
            return `${label} 返回了错误（${body.detail ? `HTTP ${body.detail}` : body.message}）。可能被限流、被屏蔽或额度用尽，稍后重试，或${hint}`;
        case 'provider_failed':
            return `连不上 ${label}（${body.detail || body.message}）。检查网络和服务地址，或${hint}`;
        case 'invalid_response':
            return `${label} 返回了无法识别的内容。${hint}`;
        default:
            break;
    }

    if (error?.code === 'empty_response') {
        return `${label} 返回了空内容。${hint}`;
    }
    if (error?.name === 'AbortError') {
        return '翻译已取消。';
    }
    if (status === 404) {
        return '后端没有翻译接口（/api/translate），服务端版本可能过旧。';
    }
    if (status >= 400) {
        return `${label} 翻译失败（HTTP ${status}）。${hint}`;
    }
    return `翻译请求没有发出去：${error?.message || '未知错误'}`;
}

/**
 * 粗略判断一段文字是不是已经是目标语言：只按文字体系（汉字、假名、谚文、拉丁字母等）区分，分不出英语和法语。
 * 用于决定开场白要不要自动翻译，宁可少翻也不误翻。
 * @param {string} text 文本
 * @param {string} lang 目标语言码
 * @returns {boolean} 看起来已经是目标语言（或没有可判断的文字）
 */
export function looksLikeLanguage(text, lang) {
    const letters = String(text ?? '').match(/\p{L}/gu) || [];
    if (letters.length < 8) {
        return true;
    }
    const count = pattern => letters.filter(letter => pattern.test(letter)).length / letters.length;
    const han = count(/\p{Script=Han}/u);
    const kana = count(/[\p{Script=Hiragana}\p{Script=Katakana}]/u);
    const hangul = count(/\p{Script=Hangul}/u);
    const code = normalizeLanguageCode(lang) || String(lang || '');
    if (code.startsWith('zh')) {
        return han >= 0.3 && kana < 0.1;
    }
    if (code === 'ja') {
        return kana >= 0.1 || han >= 0.3;
    }
    if (code === 'ko') {
        return hangul >= 0.3;
    }
    // 拉丁、西里尔等目标语言：只在明显是中日韩文字时判为需要翻译
    return han + kana + hangul < 0.3;
}

/**
 * 大模型翻译（/api/model-services/complete）的失败说明。后端失败时返回 `{ error, message, detail? }`（见 src/endpoints/model-services.js），
 * 本地判断的截断、只有推理内容、空回复用 error.code 传进来。
 * @param {any} error 抛出的错误，可以带 status 和 body
 * @returns {string} 面向用户的说明
 */
export function describeLlmTranslateFailure(error) {
    /** @type {any} */
    let body = null;
    if (typeof error?.body === 'string' && error.body.trim().startsWith('{')) {
        try {
            body = JSON.parse(error.body);
        } catch {
            body = null;
        }
    }
    const scenes = '到「设置 → 模型连接 → 场景」';
    switch (body?.error ?? error?.code) {
        case 'scene-not-configured':
            return `翻译场景还没有可用的模型服务。${scenes}为翻译选择服务。`;
        case 'service-not-found':
            return `翻译场景选的模型服务已经删除。${scenes}重新选择。`;
        case 'model-missing':
            return `翻译场景还没有选模型。${scenes}选择。`;
        case 'secret-missing':
            return '这个模型服务还没有保存 API Key。到「设置 → 模型连接 → 模型服务」填写。';
        case 'invalid-service':
            return '模型服务的配置不完整或无效（类型或地址）。到「设置 → 模型连接 → 模型服务」检查。';
        case 'provider-http-error':
            return `模型服务返回了错误（${body?.detail || body?.message || '未知原因'}）。可能被限流、额度用尽或模型名不对，稍后重试或换一个模型。`;
        case 'provider-timeout':
            return '模型服务太久没有回复，稍后重试。';
        case 'provider-network-error':
            return '连不上模型服务，检查网络、代理和服务地址。';
        case 'provider-content-blocked':
            return '模型服务拒绝翻译这段内容，可以换一个模型或改用机器翻译。';
        case 'provider-response-invalid':
            return '模型服务返回了无法识别的内容，稍后重试或换一个模型。';
        case 'truncated':
            return `译文超过了翻译场景的回复上限，被截断了，没有保存。${scenes}调大翻译的回复上限后重试。`;
        case 'reasoning_only':
            return '模型只给出了推理内容，没有给出译文。换一个不强制推理的模型，或调大翻译的回复上限。';
        case 'empty_response':
            return '模型服务返回了空内容，稍后重试或换一个模型。';
        default:
            break;
    }
    if (error?.name === 'AbortError') {
        return '翻译已取消。';
    }
    const status = Number(error?.status) || 0;
    if (status === 404) {
        return '后端没有模型服务接口（/api/model-services），服务端版本可能过旧。';
    }
    if (status >= 400) {
        return `大模型翻译失败（HTTP ${status}）。`;
    }
    return `翻译请求没有发出去：${error?.message || '未知错误'}`;
}

/**
 * 大模型翻译的系统指令：只输出译文，原样保留占位符和格式。
 * @param {string} lang 目标语言码
 * @returns {string} 指令
 */
export function buildLlmTranslatePrompt(lang) {
    const name = TRANSLATE_LANGUAGES.find(language => language.code === lang)?.name || lang;
    return [
        `You are a professional translator. Translate the user's text into ${name}.`,
        '- Output only the translation: no explanations, notes, quotes or code fences.',
        '- Keep every placeholder such as [[0]], ((1)) or ⟦2⟧ exactly as written, in the same order.',
        '- Keep line breaks, Markdown, emoji, names and proper nouns.',
        `- Leave parts that are already in ${name} unchanged.`,
    ].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// 聊天消息里的译文
// ---------------------------------------------------------------------------------------------------------------------

// 译文放在 extra 里，原文留在 mes。display_text / reasoning_display_text 与旧版一致；*_src 记录译文对应的原文指纹，
// 原文之后变了（继续生成、别处编辑）就能判断译文已过期；display_text_lang 是译成的语言码。
const DISPLAY_KEYS = Object.freeze(['display_text', 'display_text_src', 'display_text_lang']);
const REASONING_KEYS = Object.freeze(['reasoning_display_text', 'reasoning_display_text_src']);

/**
 * 文本指纹：长度加 32 位 FNV-1a 哈希，用来判断译文对应的原文有没有变，不用于安全用途。
 * @param {string} text 原文
 * @returns {string} 形如 "12:1a2b3c4d"
 */
export function createSourceSignature(text) {
    const value = String(text ?? '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `${value.length}:${hash.toString(16).padStart(8, '0')}`;
}

/**
 * 译文是否已经和原文对不上。没有记录原文指纹的译文（旧版生成的）无法判断，按未过期处理。
 * @param {unknown} recordedSignature extra 里记录的指纹
 * @param {string} currentText 当前原文
 * @returns {boolean} true 表示原文已经变了
 */
export function isTranslationStale(recordedSignature, currentText) {
    return typeof recordedSignature === 'string' && recordedSignature !== createSourceSignature(currentText);
}

/**
 * @param {any} message 聊天消息
 * @returns {boolean} 能不能翻译：只翻译 AI 回复；用户消息和系统消息一期不动
 */
export function canTranslateMessage(message) {
    return !!message && !message.is_user && !message.is_system;
}

function getCurrentSwipeInfo(message) {
    const swipeId = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
    const info = Array.isArray(message?.swipe_info) ? message.swipe_info[swipeId] : null;
    return info && typeof info === 'object' ? info : null;
}

/**
 * 当前候选的推理原文（与界面展示一致：先取 extra，再取候选信息里的）。
 * @param {any} message 聊天消息
 * @returns {string} 推理原文
 */
export function getOriginalReasoning(message) {
    return String(message?.extra?.reasoning || getCurrentSwipeInfo(message)?.extra?.reasoning || '');
}

/**
 * @typedef {object} MessageTranslationView
 * @property {boolean} controls 是否显示翻译控件（有译文的 AI 回复）
 * @property {boolean} hasTranslation 有没有译文
 * @property {boolean} stale 译文是否已过期
 * @property {'original' | 'translation'} showing 现在展示哪一个
 * @property {string} text 展示的正文
 * @property {string} reasoning 展示的推理内容
 * @property {string} lang 译文的语言码（旧版译文没有记录则为空）
 */

/**
 * 决定一条消息现在展示什么。view：true 强制原文，false 强制译文，undefined 默认（译文未过期展示译文，过期展示原文）。
 * 用户消息和系统消息保持旧行为：有 display_text 就展示它（旧版翻译输入时把用户原文放在那里），不提供翻译控件。
 * @param {any} message 聊天消息
 * @param {boolean | undefined} [view] 用户用「原文 / 译文」开关选的
 * @returns {MessageTranslationView} 展示内容
 */
export function getMessageTranslationView(message, view = undefined) {
    const original = String(message?.mes ?? '');
    const extra = message?.extra;
    const translated = typeof extra?.display_text === 'string' ? extra.display_text : '';
    const reasoningOriginal = getOriginalReasoning(message);
    const reasoningTranslated = typeof extra?.reasoning_display_text === 'string' ? extra.reasoning_display_text : '';

    if (!canTranslateMessage(message)) {
        return {
            controls: false,
            hasTranslation: false,
            stale: false,
            showing: translated ? 'translation' : 'original',
            text: translated || original,
            reasoning: reasoningTranslated || reasoningOriginal,
            lang: '',
        };
    }

    if (!translated) {
        return {
            controls: false,
            hasTranslation: false,
            stale: false,
            showing: 'original',
            text: original,
            reasoning: reasoningTranslated || reasoningOriginal,
            lang: '',
        };
    }

    const stale = isTranslationStale(extra.display_text_src, original);
    const showing = view === true ? 'original' : view === false ? 'translation' : (stale ? 'original' : 'translation');
    const reasoningStale = reasoningTranslated && reasoningOriginal && isTranslationStale(extra.reasoning_display_text_src, reasoningOriginal);
    const reasoning = showing === 'translation' && reasoningTranslated && !reasoningStale ? reasoningTranslated : reasoningOriginal;
    return {
        controls: true,
        hasTranslation: true,
        stale,
        showing,
        text: showing === 'translation' ? translated : original,
        reasoning,
        lang: typeof extra.display_text_lang === 'string' ? extra.display_text_lang : '',
    };
}

function mirrorToSwipeInfo(message, keys) {
    const info = getCurrentSwipeInfo(message);
    if (!info) {
        return;
    }
    if (!info.extra || typeof info.extra !== 'object') {
        info.extra = {};
    }
    for (const key of keys) {
        if (message.extra && Object.hasOwn(message.extra, key)) {
            info.extra[key] = message.extra[key];
        } else {
            delete info.extra[key];
        }
    }
}

/**
 * 把译文写进消息（就地修改，调用方传入的应是副本）。同时写进当前候选的 swipe_info，否则引擎切换候选再切回来会丢失译文。
 * 不碰 mes。
 * @param {any} message 聊天消息
 * @param {{ text: string, reasoningText?: string, lang: string }} translation 译文；没有推理译文时旧的推理译文会被移除
 */
export function applyMessageTranslation(message, { text, reasoningText = '', lang }) {
    if (!message.extra || typeof message.extra !== 'object') {
        message.extra = {};
    }
    message.extra.display_text = text;
    message.extra.display_text_src = createSourceSignature(message.mes);
    message.extra.display_text_lang = lang;
    if (reasoningText) {
        message.extra.reasoning_display_text = reasoningText;
        message.extra.reasoning_display_text_src = createSourceSignature(getOriginalReasoning(message));
    } else {
        for (const key of REASONING_KEYS) {
            delete message.extra[key];
        }
    }
    mirrorToSwipeInfo(message, [...DISPLAY_KEYS, ...REASONING_KEYS]);
}

/**
 * 移除消息的译文（就地修改）。
 * @param {any} message 聊天消息
 * @param {{ reasoning?: boolean }} [options] reasoning 为 false 时保留推理内容的译文（编辑正文时用），默认一起移除
 * @returns {boolean} 有没有移除过东西
 */
export function clearMessageTranslation(message, { reasoning = true } = {}) {
    const keys = reasoning ? [...DISPLAY_KEYS, ...REASONING_KEYS] : [...DISPLAY_KEYS];
    let changed = false;
    if (message?.extra && typeof message.extra === 'object') {
        for (const key of keys) {
            if (Object.hasOwn(message.extra, key)) {
                delete message.extra[key];
                changed = true;
            }
        }
    }
    const info = getCurrentSwipeInfo(message);
    if (info?.extra && typeof info.extra === 'object') {
        for (const key of keys) {
            if (Object.hasOwn(info.extra, key)) {
                delete info.extra[key];
                changed = true;
            }
        }
    }
    return changed;
}

/**
 * @param {any} message 聊天消息
 * @returns {boolean} 消息上有没有（正文）译文
 */
export function hasMessageTranslation(message) {
    return typeof message?.extra?.display_text === 'string' && message.extra.display_text !== '';
}

/**
 * 消息在界面状态里的键：同一份聊天里按位置区分。
 * @param {string} chatKey 当前聊天的草稿键
 * @param {number} index 消息位置
 * @returns {string} 键
 */
export function getMessageUiKey(chatKey, index) {
    return `${chatKey}:${index}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// 角色卡字段
// ---------------------------------------------------------------------------------------------------------------------

/** 角色卡里参与翻译的字段，顺序即翻译顺序（表单字段名，见 actions/character-data.js 的 characterToForm） */
export const CHARACTER_TRANSLATION_FIELDS = Object.freeze([
    { field: 'description', label: '描述' },
    { field: 'personality', label: '性格' },
    { field: 'scenario', label: '场景' },
    { field: 'first_mes', label: '首条消息' },
    { field: 'mes_example', label: '示例消息' },
    { field: 'creator_notes', label: '作者备注' },
    { field: 'system_prompt', label: '系统提示词' },
    { field: 'post_history_instructions', label: '历史后置提示' },
    { field: 'alternate_greetings', label: '备用开场白', list: true },
]);

/**
 * @typedef {object} CharacterTranslationJob
 * @property {string} id 任务 id；备用开场白每条一个，形如 alternate_greetings:0
 * @property {string} field 表单字段名
 * @property {number} [index] 备用开场白的序号
 * @property {string} label 界面名称
 * @property {string} text 要翻译的原文
 */

/**
 * 从编辑表单当前的草稿里列出要翻译的内容：空字段跳过，备用开场白逐条翻译。
 * @param {Record<string, any>} form 编辑表单草稿
 * @returns {CharacterTranslationJob[]} 翻译任务
 */
export function buildCharacterTranslationJobs(form) {
    /** @type {CharacterTranslationJob[]} */
    const jobs = [];
    for (const { field, label, list } of CHARACTER_TRANSLATION_FIELDS) {
        if (list) {
            inputToAlternateGreetings(form?.[field]).forEach((text, index) => {
                jobs.push({ id: `${field}:${index}`, field, index, label: `${label} ${index + 1}`, text });
            });
            continue;
        }
        const text = String(form?.[field] ?? '');
        if (text.trim()) {
            jobs.push({ id: field, field, label, text });
        }
    }
    return jobs;
}

/**
 * 把一条译文写回表单值：普通字段整体替换，备用开场白替换其中的某一条。
 * @param {Record<string, any>} form 编辑表单草稿
 * @param {CharacterTranslationJob} job 翻译任务
 * @param {string} translated 译文
 * @returns {string} 该字段的新表单值
 */
export function replaceCharacterFieldValue(form, job, translated) {
    if (job.index === undefined) {
        return translated;
    }
    const greetings = inputToAlternateGreetings(form?.[job.field]);
    greetings[job.index] = translated;
    return alternateGreetingsToInput(greetings);
}

/**
 * 表单里该任务对应的当前原文，用来确认翻译期间用户没有改过它。
 * @param {Record<string, any>} form 编辑表单草稿
 * @param {CharacterTranslationJob} job 翻译任务
 * @returns {string} 当前文本
 */
export function readCharacterFieldValue(form, job) {
    if (job.index === undefined) {
        return String(form?.[job.field] ?? '');
    }
    return inputToAlternateGreetings(form?.[job.field])[job.index] ?? '';
}
