/**
 * 聊天背景（B5）的纯函数：旧版背景值的构造与解析、聊天锁定 > 全局 > 无 的优先级、显示偏好的读写。
 * 不碰 DOM 和 state，Node 里可以直接 import 做单元测试。
 *
 * 数据来源（与旧版 public/scripts/backgrounds.js 完全一致，Modern 只是换了读写方）：
 *   全局背景  settings.background = { name, url, fitting, animation, ... }，url 是 CSS 字符串 url("backgrounds/<encodeURIComponent(文件名)>")
 *   聊天锁定  chat_metadata.custom_background，同样是 CSS 字符串；聊天专属上传图是 url("<encodeURI(路径)>")，路径形如 /user/images/<角色名>/<文件>
 *   专属图列表 chat_metadata.chat_backgrounds（路径数组）。数据维护（Data Maid）靠它判断 user/images 下的图是否仍被引用，新增专属图必须登记
 */

export const TRANSPARENT_BACKGROUND_NAME = '__transparent.png';
export const BACKGROUND_FITTINGS = ['classic', 'cover', 'contain', 'stretch', 'center'];
export const DEFAULT_BACKGROUND_FITTING = 'classic';

export const CHAT_BG_DIM_STORAGE_KEY = 'st-modern-chat-bg-dim';
export const CHAT_BG_ENABLED_STORAGE_KEY = 'st-modern-chat-bg-enabled';
export const DEFAULT_CHAT_BG_DIM = 55;
export const MIN_CHAT_BG_DIM = 0;
export const MAX_CHAT_BG_DIM = 90;

const MAX_BACKGROUND_PATH_LENGTH = 1024;
const SYSTEM_PREFIX = 'backgrounds';
const CHAT_IMAGE_PREFIX = ['user', 'images'];
// 动画格式：mp4 不是 CSS 背景图能播放的格式，列在这里是为了在「减少动态效果」下一并隐藏
const ANIMATED_EXTENSIONS = new Set(['gif', 'apng', 'mp4']);

// 只接受整个值恰好是一个 url(...)：引号包裹的内容里不能再出现同种引号、反斜杠和换行，不加引号时不能有空白、括号和引号。
// 后面还有任何内容（例如 `url("a"); background: red`、`url("a") , url(http://x)`）都会整体不匹配。
const CSS_URL_PATTERN = /^\s*url\(\s*(?:"([^"\\\r\n]*)"|'([^'\\\r\n]*)'|([^\s"'()\\]*))\s*\)\s*$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * 路径分段的 URL 编码：encodeURIComponent 之外再编码 ! ' ( ) *，保证拼进 CSS 的 url('…') 后不可能被引号或括号截断。
 * @param {string} segment 解码后的路径分段。
 * @returns {string} 编码后的分段。
 */
function encodePathSegment(segment) {
    return encodeURIComponent(segment).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * 系统背景（backgrounds 目录）在设置和聊天头里的 CSS 值，格式与旧版 getBackgroundPath/generateUrlParameter 相同。
 * @param {string} file 背景文件名。
 * @returns {string} 形如 url("backgrounds/a%20b.png")。
 */
export function buildBackgroundCssUrl(file) {
    return `url("backgrounds/${encodeURIComponent(file)}")`;
}

/**
 * 聊天专属图（user/images 下）在聊天头里的 CSS 值，格式与旧版 generateUrlParameter(bg, true) 相同。
 * @param {string} imagePath 服务端 /api/images/upload 返回的路径，例如 /user/images/Alice/a.png。
 * @returns {string} 形如 url("/user/images/Alice/a.png")。
 */
export function buildChatImageCssUrl(imagePath) {
    return `url("${encodeURI(imagePath)}")`;
}

/**
 * @typedef {object} ParsedBackground
 * @property {string} url 可直接写进 CSS 的站内绝对路径，每个分段都已重新编码，例如 /backgrounds/a%20b.png。
 * @property {string} relativePath 解码后的相对路径，例如 backgrounds/a b.png，用来做相等比较。
 * @property {string} name 解码后的文件名（最后一段）。
 * @property {'system' | 'chat'} kind system 为 backgrounds 目录，chat 为 user/images 下的聊天专属图。
 */

/**
 * 解析旧版背景值（url("…")），只接受站内相对路径，解码后必须落在 backgrounds/ 或 user/images/ 之下。
 * 外链、data:、javascript:、协议相对地址、带 .. 的路径、夹带其他 CSS 的值一律返回 null。
 * 路径允许一个前导 /（旧版聊天专属图的路径就带它）。文件名里的括号和引号是合法字符（例如 image (1).png），
 * 解码后重新编码输出，所以返回的 url 里不会出现可截断 CSS 的字符。
 * @param {unknown} value 设置或聊天头里的原始值。
 * @returns {ParsedBackground | null} 解析结果，不合法为 null。
 */
export function parseBackgroundCssUrl(value) {
    if (typeof value !== 'string' || !value || value.length > MAX_BACKGROUND_PATH_LENGTH) {
        return null;
    }

    const match = CSS_URL_PATTERN.exec(value);
    if (!match) {
        return null;
    }

    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    // 冒号只会出现在协议里（文件名里的冒号会被编码成 %3A），整体拒绝比逐个识别协议名更稳
    if (!raw || raw.includes(':') || CONTROL_CHARACTERS.test(raw)) {
        return null;
    }

    const trimmed = raw.startsWith('/') ? raw.slice(1) : raw;
    const rawSegments = trimmed.split('/');
    const segments = [];
    for (const rawSegment of rawSegments) {
        if (!rawSegment) {
            return null;
        }
        let decoded;
        try {
            decoded = decodeURIComponent(rawSegment);
        } catch {
            return null;
        }
        if (!decoded || decoded === '.' || decoded === '..' || /[\\/"]/.test(decoded) || CONTROL_CHARACTERS.test(decoded)) {
            return null;
        }
        segments.push(decoded);
    }

    /** @type {'system' | 'chat'} */
    let kind;
    if (segments[0] === SYSTEM_PREFIX && segments.length >= 2) {
        kind = 'system';
    } else if (segments[0] === CHAT_IMAGE_PREFIX[0] && segments[1] === CHAT_IMAGE_PREFIX[1] && segments.length >= 3) {
        kind = 'chat';
    } else {
        return null;
    }

    return {
        url: `/${segments.map(encodePathSegment).join('/')}`,
        relativePath: segments.join('/'),
        name: segments[segments.length - 1],
        kind,
    };
}

/**
 * @param {ParsedBackground | null | undefined} parsed parseBackgroundCssUrl 的结果。
 * @returns {boolean} 是否是旧版用来表示「没有背景」的透明占位图。
 */
export function isTransparentBackground(parsed) {
    return Boolean(parsed && parsed.kind === 'system' && parsed.relativePath === `${SYSTEM_PREFIX}/${TRANSPARENT_BACKGROUND_NAME}`);
}

/**
 * @param {unknown} fitting settings.background.fitting。
 * @returns {string} 合法的填充方式，缺省或未知为 classic。
 */
export function normalizeBackgroundFitting(fitting) {
    return typeof fitting === 'string' && BACKGROUND_FITTINGS.includes(fitting) ? fitting : DEFAULT_BACKGROUND_FITTING;
}

/**
 * 全局背景的解析结果。url 缺失时退回 name（旧版保存的设置两者总是同时存在，缺省只见于手工编辑）；
 * url 存在但不合法时不退回 name，避免被改过的值绕过校验。
 * @param {any} background settings.background。
 * @returns {ParsedBackground | null} 解析结果。
 */
export function parseGlobalBackground(background) {
    if (!background || typeof background !== 'object') {
        return null;
    }
    if (typeof background.url === 'string' && background.url.trim()) {
        return parseBackgroundCssUrl(background.url);
    }
    if (typeof background.name === 'string' && background.name.trim()) {
        return parseBackgroundCssUrl(buildBackgroundCssUrl(background.name));
    }
    return null;
}

/**
 * @typedef {object} ResolvedChatBackground
 * @property {'chat' | 'global' | 'none'} source 当前生效的来源：聊天锁定、全局、没有背景。
 * @property {string} path 站内绝对路径（可直接用于 CSS url）；source 为 none 时为空字符串。
 * @property {string} fitting 填充方式（classic、cover、contain、stretch、center）。
 * @property {string} file 解码后的相对路径，例如 backgrounds/a b.png；source 为 none 时为空字符串。
 * @property {string} name 解码后的文件名。
 * @property {'system' | 'chat' | ''} kind 图片类型。
 * @property {boolean} locked 聊天头里是否有一个合法的锁定值（包括锁定为「无背景」和锁定图加载失败的情况）。
 * @property {boolean} lockedNone 聊天被锁定为「无背景」（锁定值是透明占位图）。
 * @property {boolean} lockFailed 聊天锁定的图加载失败，已回退到全局。
 */

/**
 * 当前聊天应显示的背景：聊天锁定优先，其次全局，都没有则无。
 * 非法的锁定值（外链、路径穿越等）被忽略并视为没有锁定；failedPaths 里的路径（图片加载失败）被跳过，从而回退到下一级。
 * @param {object} input 输入。
 * @param {any} [input.settings] 全部设置（用到 background）。
 * @param {any} [input.chatMetadata] 当前聊天的 chat_metadata。
 * @param {Iterable<string> | Record<string, any> | null} [input.failedPaths] 已知加载失败的 path（站内绝对路径），数组、Set 或以 path 为键的对象。
 * @returns {ResolvedChatBackground} 解析结果。
 */
export function resolveChatBackground({ settings, chatMetadata, failedPaths = null } = {}) {
    const fitting = normalizeBackgroundFitting(settings?.background?.fitting);
    const failed = toPathSet(failedPaths);
    const none = { source: /** @type {const} */ ('none'), path: '', fitting, file: '', name: '', kind: /** @type {const} */ (''), locked: false, lockedNone: false, lockFailed: false };

    const lock = parseBackgroundCssUrl(chatMetadata?.custom_background);
    if (lock) {
        if (isTransparentBackground(lock)) {
            return { ...none, locked: true, lockedNone: true };
        }
        if (!failed.has(lock.url)) {
            return { source: 'chat', path: lock.url, fitting, file: lock.relativePath, name: lock.name, kind: lock.kind, locked: true, lockedNone: false, lockFailed: false };
        }
    }

    const global = parseGlobalBackground(settings?.background);
    if (global && !isTransparentBackground(global) && !failed.has(global.url)) {
        return { source: 'global', path: global.url, fitting, file: global.relativePath, name: global.name, kind: global.kind, locked: Boolean(lock), lockedNone: false, lockFailed: Boolean(lock) };
    }

    return { ...none, locked: Boolean(lock), lockFailed: Boolean(lock) };
}

/**
 * @param {Iterable<string> | Record<string, any> | null | undefined} value 路径集合。
 * @returns {Set<string>} 路径集合。
 */
function toPathSet(value) {
    if (!value) {
        return new Set();
    }
    if (value instanceof Set) {
        return value;
    }
    if (Array.isArray(value)) {
        return new Set(value);
    }
    if (typeof value === 'object') {
        return new Set(Object.keys(value).filter(key => value[key]));
    }
    return new Set();
}

/**
 * 某个系统背景是否被全局设置或当前聊天锁定引用（删除、重命名前的提示依据）。
 * 全局按 name 或 url 任一匹配（与旧版重命名逻辑一致）；聊天按解析出的相对路径比较，不依赖引号和编码写法。
 * @param {object} input 输入。
 * @param {any} [input.settings] 全部设置。
 * @param {any} [input.chatMetadata] 当前聊天的 chat_metadata，未读取时传空。
 * @param {string} input.filename 系统背景文件名。
 * @returns {{ global: boolean, chat: boolean }} 引用情况。
 */
export function findBackgroundReferences({ settings, chatMetadata, filename }) {
    const relativePath = `${SYSTEM_PREFIX}/${filename}`;
    const background = settings?.background;
    const globalParsed = parseGlobalBackground(background);
    const global = Boolean(filename) && (background?.name === filename || globalParsed?.relativePath === relativePath);
    const chat = Boolean(filename) && parseBackgroundCssUrl(chatMetadata?.custom_background)?.relativePath === relativePath;
    return { global, chat };
}

/**
 * @param {string} name 文件名或路径。
 * @param {boolean} [knownAnimated] 服务端已标出该文件是动画（/api/backgrounds/all 的 isAnimated）。
 * @returns {boolean} 是否应在「减少动态效果」下隐藏。
 */
export function isAnimatedBackground(name, knownAnimated = false) {
    if (knownAnimated) {
        return true;
    }
    const extension = String(name || '').split('.').pop()?.toLowerCase() || '';
    return ANIMATED_EXTENSIONS.has(extension);
}

/**
 * @param {unknown} value 遮罩浓度（百分比）。
 * @returns {number} 限制在 0 到 90 之间的整数，非数字为默认值。
 */
export function clampChatBackgroundDim(value) {
    const number = typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value);
    if (!Number.isFinite(number)) {
        return DEFAULT_CHAT_BG_DIM;
    }
    return Math.min(MAX_CHAT_BG_DIM, Math.max(MIN_CHAT_BG_DIM, Math.round(number)));
}

/**
 * @param {Pick<Storage, 'getItem'> | null | undefined} storage localStorage 或替身。
 * @returns {{ enabled: boolean, dim: number }} 显示偏好；读取失败时用默认值（显示背景、遮罩 55%）。
 */
export function readChatBackgroundPrefs(storage) {
    let enabled = true;
    let dim = DEFAULT_CHAT_BG_DIM;
    try {
        enabled = storage?.getItem(CHAT_BG_ENABLED_STORAGE_KEY) !== '0';
        const storedDim = storage?.getItem(CHAT_BG_DIM_STORAGE_KEY);
        dim = storedDim === null || storedDim === undefined ? DEFAULT_CHAT_BG_DIM : clampChatBackgroundDim(storedDim);
    } catch {
        // 隐私模式或存储不可用时退回默认值
    }
    return { enabled, dim };
}

/**
 * @param {Pick<Storage, 'setItem'> | null | undefined} storage localStorage 或替身。
 * @param {{ enabled?: boolean, dim?: number }} prefs 要保存的偏好，只写出现的字段。
 */
export function writeChatBackgroundPrefs(storage, prefs) {
    try {
        if (typeof prefs.enabled === 'boolean') {
            storage?.setItem(CHAT_BG_ENABLED_STORAGE_KEY, prefs.enabled ? '1' : '0');
        }
        if (prefs.dim !== undefined) {
            storage?.setItem(CHAT_BG_DIM_STORAGE_KEY, String(clampChatBackgroundDim(prefs.dim)));
        }
    } catch {
        // 存储写入失败不影响本次会话内的显示
    }
}

/**
 * 背景文件被重命名、删除、重新上传或重新选择后，清掉「加载失败 / 已验证」的缓存，让图片重新探测一次。
 * @param {{ chatBackground?: any }} state 全局界面状态。
 */
export function resetChatBackgroundImageStatus(state) {
    if (state.chatBackground && typeof state.chatBackground === 'object') {
        state.chatBackground.failed = {};
        state.chatBackground.verified = {};
    }
}

/**
 * 补全 state.chatBackground 的字段并返回它。偏好只在第一次调用时从 storage 读取。
 * @param {{ chatBackground?: any }} state 全局界面状态。
 * @param {Pick<Storage, 'getItem'> | null | undefined} storage localStorage 或替身。
 * @returns {{ enabled: boolean, dim: number, failed: Record<string, boolean>, verified: Record<string, boolean>, query: string, visibleCount: number, busy: boolean }} 补全后的聊天背景状态。
 */
export function ensureChatBackgroundState(state, storage) {
    if (!state.chatBackground || typeof state.chatBackground !== 'object') {
        state.chatBackground = {};
    }
    const target = state.chatBackground;
    if (typeof target.enabled !== 'boolean' || typeof target.dim !== 'number') {
        const prefs = readChatBackgroundPrefs(storage);
        target.enabled = prefs.enabled;
        target.dim = prefs.dim;
    }
    target.failed ||= {};
    target.verified ||= {};
    if (typeof target.query !== 'string') {
        target.query = '';
    }
    if (!Number.isInteger(target.visibleCount) || target.visibleCount < 1) {
        target.visibleCount = 24;
    }
    target.busy = Boolean(target.busy);
    return target;
}
