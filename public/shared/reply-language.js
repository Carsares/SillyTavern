// 角色回复语言（设置中心「语言」标签）的纯函数部分：生成引擎（public/script.js）、现代页和 Agent 服务端共用。
//
// 存储：settings.json 的 power_user.reply_language
//   没有这个字段  按默认值简体中文处理
//   语言代码      例如 zh-CN、en：要求角色用这种语言回复
//   follow       跟随用户最后一条消息的语言
//   ''（空串）    不指定，不加任何语言指令

export const DEFAULT_REPLY_LANGUAGE = 'zh-CN';
export const REPLY_LANGUAGE_FOLLOW = 'follow';
export const REPLY_LANGUAGE_NONE = '';

/**
 * 可选的回复语言。name 是写进指令里给模型看的名称。
 * @type {ReadonlyArray<Readonly<{ value: string, label: string, name: string }>>}
 */
export const REPLY_LANGUAGE_OPTIONS = Object.freeze([
    Object.freeze({ value: 'zh-CN', label: '简体中文', name: 'Simplified Chinese (简体中文)' }),
    Object.freeze({ value: 'zh-TW', label: '繁體中文', name: 'Traditional Chinese (繁體中文)' }),
    Object.freeze({ value: 'en', label: 'English', name: 'English' }),
    Object.freeze({ value: 'ja', label: '日本語', name: 'Japanese (日本語)' }),
    Object.freeze({ value: 'ko', label: '한국어', name: 'Korean (한국어)' }),
]);

/**
 * @param {Record<string, any> | null | undefined} powerUser settings.power_user
 * @returns {string} 回复语言设置：语言代码、follow 或空串
 */
export function resolveReplyLanguage(powerUser) {
    const value = powerUser?.reply_language;
    if (value === undefined || value === null) {
        return DEFAULT_REPLY_LANGUAGE;
    }
    if (value === REPLY_LANGUAGE_FOLLOW || value === REPLY_LANGUAGE_NONE) {
        return value;
    }
    return REPLY_LANGUAGE_OPTIONS.some(option => option.value === value) ? value : DEFAULT_REPLY_LANGUAGE;
}

/**
 * @param {string} value 语言代码
 * @returns {Readonly<{ value: string, label: string, name: string }> | null} 选项
 */
export function getReplyLanguageOption(value) {
    return REPLY_LANGUAGE_OPTIONS.find(option => option.value === value) || null;
}

/**
 * 放在聊天记录之后的语言指令；不指定时为空串。
 * @param {string} setting resolveReplyLanguage 的结果
 * @returns {string} 指令
 */
export function buildReplyLanguageInstruction(setting) {
    if (setting === REPLY_LANGUAGE_FOLLOW) {
        return 'Write the next reply in the same language as the user\'s latest message, even if the character card, the examples or earlier messages use another language. Keep names and proper nouns as they are.';
    }
    const option = getReplyLanguageOption(setting);
    if (!option) {
        return '';
    }
    return `Write the next reply in ${option.name}, even if the character card, the examples, earlier messages or the user use another language. Keep names, proper nouns and required formatting markers as they are.`;
}

// 早先手写进主提示词的语言规则（「跟随用户最后一条消息的语言」），和回复语言设置冲突时由「语言」标签提示删除
const LEGACY_RULE_START = /^Always reply in the same language as /;

/**
 * 找出手写的语言规则段落（以空行分段）。
 * @param {unknown} text 提示词
 * @returns {string} 规则段落，没有时为空串
 */
export function findLegacyLanguageRule(text) {
    if (typeof text !== 'string') {
        return '';
    }
    return text.split(/\n{2,}/).find(paragraph => LEGACY_RULE_START.test(paragraph.trim())) || '';
}

/**
 * 删掉手写的语言规则段落，其余内容和段落间距保持不变。
 * @param {string} text 提示词
 * @returns {string} 删除后的提示词
 */
export function removeLegacyLanguageRule(text) {
    const parts = text.split(/(\n{2,})/);
    const index = parts.findIndex(part => LEGACY_RULE_START.test(part.trim()));
    if (index < 0) {
        return text;
    }
    // 连同它前面（没有时是后面）的空行一起删掉
    const removeFrom = index > 0 ? index - 1 : index;
    const removeCount = index > 0 ? 2 : Math.min(2, parts.length - index);
    parts.splice(removeFrom, removeCount);
    return parts.join('');
}
