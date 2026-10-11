// 聊天摘要（A6）的纯函数：读取摘要、判断是否到点、校验设置草稿。不碰 DOM、不发请求，jest 直接测试。
// 对照旧版 public/scripts/extensions/memory/index.js（摘要扩展）：
//   - 摘要存在消息的 extra.memory 里；读取时跳过最后一条消息（getLatestMemoryFromChat / getIndexOfLatestChatSummary）；
//   - 触发判断是 getSummaryPromptForNow：间隔为 0 = 整个自动摘要关闭（连按字数触发也一起关）；聊天消息数小于间隔不触发；
//     「距上次摘要的消息数」从最后一条往前数到第一条带 extra.memory 的消息为止（这次数包含最后一条消息，与读取摘要时的跳过规则不同，旧版如此）；
//     消息数 >= 间隔，或字数 >= 强制字数（非 0 时）才到点；
//   - 字数用 extractAllWords：正则 /\b\w+\b/ 只认 ASCII 字母数字下划线，中文几乎数不出字，所以中文聊天按「间隔」触发才可靠。
// 旧版这几处改动时，需要同步修改这里和 tests/modern-chat-summary.test.js。

export const SUMMARY_SOURCES = Object.freeze([
    { value: 'main', label: '主模型' },
    { value: 'webllm', label: 'WebLLM 扩展' },
    { value: 'extras', label: 'Extras API（已弃用）' },
]);

// 注入位置，值与引擎的 extension_prompt_types 一致
export const SUMMARY_POSITIONS = Object.freeze([
    { value: -1, label: '不注入（只能用 {{summary}} 宏取用）' },
    { value: 2, label: '主提示前' },
    { value: 0, label: '主提示后' },
    { value: 1, label: '聊天内按深度' },
]);

// 注入角色，值与引擎的 extension_prompt_roles 一致
export const SUMMARY_ROLES = Object.freeze([
    { value: 0, label: '系统' },
    { value: 1, label: '用户' },
    { value: 2, label: '助手' },
]);

export const SUMMARY_PROMPT_BUILDERS = Object.freeze([
    { value: 0, label: '经典：沿用主提示词构造，摘要请求作为最后一条系统消息（阻塞）' },
    { value: 1, label: '原始（阻塞）：只用尚未摘要的消息自行构造请求，生成期间锁住聊天' },
    { value: 2, label: '原始（非阻塞）：同上，但不锁住聊天，部分后端不支持' },
]);

export const DEFAULT_SUMMARY_PROMPT = 'Ignore previous instructions. Summarize the most important facts and events in the story so far. If a summary already exists in your memory, use that as a base and expand with new facts. Limit the summary to {{words}} words or less. Your response should include nothing but the summary.';
export const DEFAULT_SUMMARY_TEMPLATE = '[Summary: {{summary}}]';

// 滑块范围取自摘要扩展的 defaultSettings（promptMinInterval 等），不读用户设置文件里保存的 *Min / *Max：
// 旧的默认 settings.json 里 promptMinInterval 是 1、promptMaxInterval 是 100，扩展并不使用它们
export const SUMMARY_NUMBER_FIELDS = Object.freeze({
    promptInterval: { label: '摘要间隔', min: 0, max: 250, unit: '条消息' },
    promptForceWords: { label: '摘要字数阈值', min: 0, max: 10000, unit: '字' },
    promptWords: { label: '目标摘要字数', min: 25, max: 1000, unit: '字' },
    overrideResponseLength: { label: '摘要回复长度', min: 0, max: 4096, unit: 'tokens' },
    maxMessagesPerRequest: { label: '每次请求最多消息数', min: 0, max: 250, unit: '条消息' },
    depth: { label: '注入深度', min: 0, max: 9999, unit: '' },
});

const SOURCE_VALUES = SUMMARY_SOURCES.map(item => item.value);
const POSITION_VALUES = SUMMARY_POSITIONS.map(item => item.value);
const ROLE_VALUES = SUMMARY_ROLES.map(item => item.value);
const BUILDER_VALUES = SUMMARY_PROMPT_BUILDERS.map(item => item.value);

/** 扩展自己的默认值（defaultSettings），设置里缺哪项就按它补，与旧版 loadSettings 一致。 */
export const SUMMARY_SETTING_DEFAULTS = Object.freeze({
    memoryFrozen: false,
    SkipWIAN: false,
    source: 'extras',
    prompt: DEFAULT_SUMMARY_PROMPT,
    template: DEFAULT_SUMMARY_TEMPLATE,
    position: 0,
    role: 0,
    scan: false,
    depth: 2,
    promptWords: 200,
    promptInterval: 10,
    promptForceWords: 0,
    overrideResponseLength: 0,
    maxMessagesPerRequest: 0,
    prompt_builder: 0,
});

function toNumberOr(value, fallback) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

/**
 * 读出生效的摘要设置：缺失项用扩展默认值，数字项转成数字（旧版界面会把位置存成字符串）。
 * @param {object} [settings] state.settings（整份设置）
 * @returns {{ memoryFrozen: boolean, SkipWIAN: boolean, source: string, prompt: string, template: string, position: number, role: number, scan: boolean, depth: number, promptWords: number, promptInterval: number, promptForceWords: number, overrideResponseLength: number, maxMessagesPerRequest: number, prompt_builder: number }} 摘要设置
 */
export function readSummarySettings(settings) {
    const raw = settings?.extension_settings?.memory;
    const memory = raw && typeof raw === 'object' ? raw : {};
    const defaults = SUMMARY_SETTING_DEFAULTS;
    return {
        memoryFrozen: memory.memoryFrozen === undefined ? defaults.memoryFrozen : !!memory.memoryFrozen,
        SkipWIAN: memory.SkipWIAN === undefined ? defaults.SkipWIAN : !!memory.SkipWIAN,
        source: typeof memory.source === 'string' && memory.source ? memory.source : defaults.source,
        prompt: typeof memory.prompt === 'string' ? memory.prompt : defaults.prompt,
        template: typeof memory.template === 'string' ? memory.template : defaults.template,
        position: toNumberOr(memory.position, defaults.position),
        role: toNumberOr(memory.role, defaults.role),
        scan: memory.scan === undefined ? defaults.scan : !!memory.scan,
        depth: toNumberOr(memory.depth, defaults.depth),
        promptWords: toNumberOr(memory.promptWords, defaults.promptWords),
        promptInterval: toNumberOr(memory.promptInterval, defaults.promptInterval),
        promptForceWords: toNumberOr(memory.promptForceWords, defaults.promptForceWords),
        overrideResponseLength: toNumberOr(memory.overrideResponseLength, defaults.overrideResponseLength),
        maxMessagesPerRequest: toNumberOr(memory.maxMessagesPerRequest, defaults.maxMessagesPerRequest),
        prompt_builder: toNumberOr(memory.prompt_builder, defaults.prompt_builder),
    };
}

/**
 * @param {string} source 摘要来源
 * @returns {string} 界面上的来源名称
 */
export function describeSummarySource(source) {
    return SUMMARY_SOURCES.find(item => item.value === source)?.label || `未知来源（${source}）`;
}

/**
 * 摘要扩展是否被禁用（扩展页里关掉了）。
 * @param {object} [settings] state.settings
 * @returns {boolean} 被禁用时为 true
 */
export function isSummaryExtensionDisabled(settings) {
    const disabled = settings?.extension_settings?.disabledExtensions;
    return Array.isArray(disabled) && disabled.includes('memory');
}

/**
 * 旧版 getLatestMemoryFromChat / getIndexOfLatestChatSummary：从倒数第二条往前找第一条带摘要的消息，最后一条消息不参与。
 * @param {object[]} [messages] 聊天消息
 * @returns {{ text: string, index: number }} 没有摘要时 text 为空串、index 为 -1
 */
export function getLatestChatSummary(messages) {
    if (!Array.isArray(messages)) {
        return { text: '', index: -1 };
    }

    for (let index = messages.length - 2; index >= 0; index--) {
        const memory = messages[index]?.extra?.memory;
        if (memory) {
            return { text: String(memory), index };
        }
    }

    return { text: '', index: -1 };
}

/**
 * 旧版 extractAllWords 的字数：只数 ASCII 单词，中文不计。
 * @param {unknown} value 消息正文
 * @returns {number} 单词数
 */
export function countSummaryWords(value) {
    if (!value || typeof value !== 'string') {
        return 0;
    }
    return (value.match(/\b\w+\b/gim) || []).length;
}

/**
 * 旧版 getSummaryPromptForNow 里的计数循环：从最后一条往前数到第一条带摘要的消息为止（该消息本身不计，最后一条消息带摘要时为 0）。
 * @param {object[]} [messages] 聊天消息
 * @returns {{ messagesSince: number, wordsSince: number }} 距上次摘要的消息数和字数
 */
export function countSinceLastSummary(messages) {
    let messagesSince = 0;
    let wordsSince = 0;
    if (!Array.isArray(messages)) {
        return { messagesSince, wordsSince };
    }

    for (let index = messages.length - 1; index >= 0; index--) {
        if (messages[index]?.extra?.memory) {
            break;
        }
        messagesSince++;
        wordsSince += countSummaryWords(messages[index]?.mes);
    }

    return { messagesSince, wordsSince };
}

/**
 * 自动摘要现在是否到点，以及显示用的进度。对照旧版 getSummaryPromptForNow（不含等待发送键、提示词为空的检查）。
 * @param {object[] | undefined} messages 聊天消息
 * @param {{ promptInterval: number, promptForceWords: number } | undefined} memory 摘要设置（readSummarySettings 的结果）
 * @returns {{ due: boolean, reason: 'off' | 'empty' | 'too-short' | 'interval' | 'words' | 'waiting', messagesSince: number, wordsSince: number, interval: number, forceWords: number, remainingMessages: number }} 进度；
 * reason：off = 间隔为 0，empty = 聊天为空，too-short = 消息总数还没到间隔，interval / words = 到点的原因，waiting = 还没到点
 */
export function getSummaryProgress(messages, memory) {
    const interval = Math.max(0, Math.trunc(toNumberOr(memory?.promptInterval, 0)));
    const forceWords = Math.max(0, toNumberOr(memory?.promptForceWords, 0));
    const length = Array.isArray(messages) ? messages.length : 0;
    const { messagesSince, wordsSince } = countSinceLastSummary(messages);
    const base = { messagesSince, wordsSince, interval, forceWords, remainingMessages: Math.max(0, interval - messagesSince) };

    if (interval === 0) {
        return { ...base, due: false, reason: 'off', remainingMessages: 0 };
    }
    if (length === 0) {
        return { ...base, due: false, reason: 'empty' };
    }
    if (length < interval) {
        return { ...base, due: false, reason: 'too-short', remainingMessages: interval - length };
    }
    if (messagesSince >= interval) {
        return { ...base, due: true, reason: 'interval' };
    }
    if (forceWords && wordsSince >= forceWords) {
        return { ...base, due: true, reason: 'words' };
    }

    return { ...base, due: false, reason: 'waiting' };
}

/**
 * 界面上的一句话说明自动摘要的进度。
 * @param {ReturnType<typeof getSummaryProgress>} progress getSummaryProgress 的结果
 * @returns {string} 说明
 */
export function describeSummaryProgress(progress) {
    switch (progress.reason) {
        case 'off':
            return '摘要间隔为 0，自动摘要已关闭。';
        case 'empty':
            return '聊天里还没有消息。';
        case 'too-short':
            return `聊天一共不到 ${progress.interval} 条消息，还差 ${progress.remainingMessages} 条才会自动摘要。`;
        case 'interval':
            return `距上次摘要已有 ${progress.messagesSince} 条消息，达到间隔 ${progress.interval} 条，下一条回复结束后会自动摘要。`;
        case 'words':
            return `距上次摘要的字数已达 ${progress.forceWords}，下一条回复结束后会自动摘要。`;
        default:
            return `距上次摘要已有 ${progress.messagesSince} 条消息，间隔 ${progress.interval} 条，还差 ${progress.remainingMessages} 条。`;
    }
}

/**
 * Modern 在每次生成成功后决定要不要请求引擎摘要。这里只看设置（便宜、不发请求），最终是否到点由引擎再判断一次。
 * @param {object} [settings] state.settings
 * @returns {{ eligible: boolean, reason: '' | 'extension-disabled' | 'source' | 'frozen' | 'off', message: string }} eligible 为 false 时 reason 说明为什么不请求
 */
export function getAutoSummaryGate(settings) {
    if (isSummaryExtensionDisabled(settings)) {
        return { eligible: false, reason: 'extension-disabled', message: '摘要扩展已在扩展页被禁用。' };
    }

    const memory = readSummarySettings(settings);
    if (memory.source === 'extras') {
        return { eligible: false, reason: 'source', message: '摘要来源是 Extras API（需要 Extras 服务器，通常没有连接），不会自动生成摘要。请把来源改为主模型。' };
    }
    if (!SOURCE_VALUES.includes(memory.source)) {
        return { eligible: false, reason: 'source', message: `未知的摘要来源：${memory.source}。` };
    }
    if (memory.memoryFrozen) {
        return { eligible: false, reason: 'frozen', message: '自动摘要已暂停（仍可手动「重新摘要」）。' };
    }
    if (Math.trunc(memory.promptInterval) <= 0) {
        return { eligible: false, reason: 'off', message: '摘要间隔为 0，自动摘要已关闭。' };
    }

    return { eligible: true, reason: '', message: '' };
}

/**
 * 手动「重新摘要」能不能点，不能点时给出原因。
 * @param {object | undefined} settings state.settings
 * @param {number} messageCount 聊天消息数
 * @returns {{ ok: boolean, reason: 'extension-disabled' | 'source' | 'empty' | '', message: string }} 检查结果
 */
export function getManualSummaryGate(settings, messageCount) {
    if (isSummaryExtensionDisabled(settings)) {
        return { ok: false, reason: 'extension-disabled', message: '摘要扩展已在扩展页被禁用，启用后才能生成摘要。' };
    }

    const { source } = readSummarySettings(settings);
    if (source === 'extras') {
        return { ok: false, reason: 'source', message: '摘要来源是 Extras API，它需要连接 Extras 服务器，这里没有连接，无法生成。请到「设置 → 聊天工具」把来源切换为主模型。' };
    }
    if (!SOURCE_VALUES.includes(source)) {
        return { ok: false, reason: 'source', message: `未知的摘要来源：${source}。请到「设置 → 聊天工具」重新选择。` };
    }
    if (!messageCount) {
        return { ok: false, reason: 'empty', message: '聊天里还没有消息，无法摘要。' };
    }

    return { ok: true, reason: '', message: '' };
}

/**
 * 把引擎对 SUMMARIZE 的回复翻成一条提示。自动摘要时「还没到点」不值得提示，返回 null。
 * @param {object} [result] 引擎的回复（summarizeForModernBridge 的结果，可带 stopped）
 * @param {{ mode?: 'force' | 'auto' }} [options] mode 是发起时的模式
 * @returns {{ kind: 'success' | 'info' | 'warning', text: string } | null} 提示；没有要说的返回 null
 */
export function describeSummaryOutcome(result, { mode = 'force' } = {}) {
    const reason = result?.reason || '';
    if (result?.stopped || reason === 'stopped') {
        return { kind: 'info', text: '摘要已停止，聊天文件没有变化。' };
    }
    if (!reason && result?.summary) {
        return { kind: 'success', text: `摘要已更新，写在第 ${Number(result.index) + 1} 条消息上。` };
    }

    switch (reason) {
        case 'no-prompt':
            return { kind: 'warning', text: '摘要提示词是空的，扩展不会发出摘要请求。请到「设置 → 聊天工具」填写，或点「恢复默认」。' };
        case 'nothing':
            return { kind: 'info', text: '没有尚未摘要的消息可用：当前的提示词构造方式只摘要上次摘要之后的消息。要从头重新摘要，请先清除当前摘要。' };
        case 'empty-summary':
            return { kind: 'warning', text: '模型没有返回摘要内容，聊天没有变化。' };
        case 'save-failed':
            return { kind: 'warning', text: '摘要已生成，但聊天文件没有接受写入（可能在别处被修改过），聊天没有变化。请稍后重新摘要。' };
        case 'empty':
            return mode === 'force' ? { kind: 'info', text: '聊天里还没有消息，无法摘要。' } : null;
        default:
            // frozen / off / too-short / waiting：自动摘要没到点，不打扰用户
            return mode === 'force' ? { kind: 'info', text: '没有生成摘要。' } : null;
    }
}

/**
 * 写入摘要的楼层：已有摘要就覆盖它所在的那一条（不产生第二份），没有则与旧版一致写在倒数第二条（只有一条消息时写在第 0 条）。
 * @param {object[]} messages 聊天消息
 * @returns {number} 目标下标，聊天为空时为 -1
 */
export function resolveSummaryWriteIndex(messages) {
    if (!Array.isArray(messages) || !messages.length) {
        return -1;
    }

    const latest = getLatestChatSummary(messages);
    return latest.index >= 0 ? latest.index : Math.max(0, messages.length - 2);
}

/**
 * 就地把摘要写进一条消息的 extra.memory（messages 应是副本）。
 * @param {object[]} messages 聊天消息
 * @param {number} index 目标下标
 * @param {string} text 摘要内容
 */
export function setSummaryOnMessage(messages, index, text) {
    const message = messages?.[index];
    if (!message) {
        throw new Error('摘要所在的消息已不存在，请刷新后重试。');
    }
    if (!message.extra || typeof message.extra !== 'object') {
        message.extra = {};
    }
    message.extra.memory = String(text);
}

/**
 * 就地删除一条消息上的摘要（旧版 delete mes.extra.memory，extra 里的其它字段保留）。
 * @param {object[]} messages 聊天消息
 * @param {number} index 目标下标
 * @returns {boolean} 是否真的删掉了一份摘要
 */
export function clearSummaryOnMessage(messages, index) {
    const extra = messages?.[index]?.extra;
    if (!extra || !Object.hasOwn(extra, 'memory')) {
        return false;
    }
    delete extra.memory;
    return true;
}

/**
 * 帮用户认出摘要挂在哪条消息上。
 * @param {object} [message] 消息
 * @param {number} [maxLength] 预览最多多少字
 * @returns {string} 形如「角色名：开头的几十个字…」
 */
export function previewSummaryHolder(message, maxLength = 36) {
    if (!message) {
        return '';
    }
    const name = message.name || (message.is_user ? '用户' : '角色');
    const text = String(message.mes || '').replace(/\s+/g, ' ').trim();
    const clipped = text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
    return clipped ? `${name}：${clipped}` : String(name);
}

// 设置草稿 ---------------------------------------------------------------------------------------------------------------

/**
 * 设置草稿一律用字符串（输入框的值），布尔项用 '1' / ''。
 * @param {ReturnType<typeof readSummarySettings>} memory 摘要设置
 * @returns {Record<string, string>} 草稿
 */
export function toSummarySettingsDraft(memory) {
    return {
        source: memory.source,
        memoryFrozen: memory.memoryFrozen ? '1' : '',
        SkipWIAN: memory.SkipWIAN ? '1' : '',
        scan: memory.scan ? '1' : '',
        prompt_builder: String(memory.prompt_builder),
        prompt: memory.prompt,
        template: memory.template,
        promptWords: String(memory.promptWords),
        overrideResponseLength: String(memory.overrideResponseLength),
        maxMessagesPerRequest: String(memory.maxMessagesPerRequest),
        promptInterval: String(memory.promptInterval),
        promptForceWords: String(memory.promptForceWords),
        position: String(memory.position),
        depth: String(memory.depth),
        role: String(memory.role),
    };
}

function parseBoundedInteger(text, { min, max }) {
    const trimmed = String(text ?? '').trim();
    if (!/^\d+$/.test(trimmed)) {
        return null;
    }
    const number = Number(trimmed);
    return number >= min && number <= max ? number : null;
}

function parseChoice(text, allowed) {
    const trimmed = String(text ?? '').trim();
    if (!/^-?\d+$/.test(trimmed)) {
        return null;
    }
    const number = Number(trimmed);
    return allowed.includes(number) ? number : null;
}

/**
 * 校验设置草稿。深度和角色只在注入位置为「聊天内按深度」时生效，其它位置下草稿里的非法值不阻塞保存，沿用 fallback 里的旧值。
 * @param {Record<string, string>} draft 草稿
 * @param {ReturnType<typeof readSummarySettings>} fallback 当前生效的设置
 * @returns {{ ok: boolean, values: ReturnType<typeof readSummarySettings>, errors: Record<string, string> }} 校验结果，errors 的键是字段名
 */
export function parseSummarySettingsDraft(draft, fallback) {
    /** @type {Record<string, string>} */
    const errors = {};
    const values = { ...fallback };

    const source = String(draft.source ?? '').trim();
    if (SOURCE_VALUES.includes(source)) {
        values.source = source;
    } else {
        errors.source = '请选择摘要来源。';
    }

    for (const field of /** @type {const} */ (['promptInterval', 'promptForceWords', 'promptWords', 'overrideResponseLength', 'maxMessagesPerRequest'])) {
        const range = SUMMARY_NUMBER_FIELDS[field];
        const number = parseBoundedInteger(draft[field], range);
        if (number === null) {
            errors[field] = `${range.label}需要是 ${range.min} 到 ${range.max} 的整数。`;
        } else {
            values[field] = number;
        }
    }

    const position = parseChoice(draft.position, POSITION_VALUES);
    if (position === null) {
        errors.position = '请选择注入位置。';
    } else {
        values.position = position;
    }

    const inChat = position === 1;
    const depth = parseBoundedInteger(draft.depth, SUMMARY_NUMBER_FIELDS.depth);
    if (depth === null) {
        if (inChat) {
            errors.depth = `${SUMMARY_NUMBER_FIELDS.depth.label}需要是 ${SUMMARY_NUMBER_FIELDS.depth.min} 到 ${SUMMARY_NUMBER_FIELDS.depth.max} 的整数。`;
        }
    } else {
        values.depth = depth;
    }
    const role = parseChoice(draft.role, ROLE_VALUES);
    if (role === null) {
        if (inChat) {
            errors.role = '请选择注入角色。';
        }
    } else {
        values.role = role;
    }

    const builder = parseChoice(draft.prompt_builder, BUILDER_VALUES);
    if (builder === null) {
        errors.prompt_builder = '请选择提示词构造方式。';
    } else {
        values.prompt_builder = builder;
    }

    const prompt = String(draft.prompt ?? '');
    if (values.source !== 'extras' && !prompt.trim()) {
        errors.prompt = '摘要提示词不能为空，留空时扩展不会发出摘要请求。可以点「恢复默认」。';
    }
    values.prompt = prompt;

    const template = String(draft.template ?? '');
    if (template.trim() && !/\{\{\s*summary\s*\}\}/i.test(template)) {
        errors.template = '注入模板需要包含 {{summary}}，否则摘要内容不会进入提示词。留空则使用扩展内置格式。';
    }
    values.template = template;

    values.memoryFrozen = draft.memoryFrozen === '1';
    values.SkipWIAN = draft.SkipWIAN === '1';
    values.scan = draft.scan === '1';

    return { ok: Object.keys(errors).length === 0, values, errors };
}

/**
 * 保存时写进 extension_settings.memory 的键值（只含界面能改的字段，其余键如旧的 *Min / *Max 原样保留）。
 * @param {ReturnType<typeof readSummarySettings>} values 校验后的取值
 * @returns {Record<string, string | number | boolean>} 要合并进设置的字段
 */
export function buildSummarySettingsPatch(values) {
    return {
        source: values.source,
        memoryFrozen: values.memoryFrozen,
        SkipWIAN: values.SkipWIAN,
        scan: values.scan,
        prompt_builder: values.prompt_builder,
        prompt: values.prompt,
        template: values.template,
        promptWords: values.promptWords,
        overrideResponseLength: values.overrideResponseLength,
        maxMessagesPerRequest: values.maxMessagesPerRequest,
        promptInterval: values.promptInterval,
        promptForceWords: values.promptForceWords,
        position: values.position,
        depth: values.depth,
        role: values.role,
    };
}

/**
 * 草稿和基线是否不同。
 * @param {Record<string, string>} draft 草稿
 * @param {Record<string, string>} baselineDraft 基线草稿
 * @returns {boolean} 有未保存的修改时为 true
 */
export function isSummaryDraftDirty(draft, baselineDraft) {
    return Object.keys(baselineDraft).some(key => String(draft[key] ?? '') !== baselineDraft[key]);
}
