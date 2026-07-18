import { DOMPurify, showdown } from '../../lib.js';

/**
 * showdown / DOMPurify 均无随包类型声明，这里用结构化类型描述本模块实际用到的能力，
 * 使 checkJs 无需依赖 @types 即可通过。
 * @typedef {{ makeHtml(text: string): string }} MarkdownConverter
 */

/**
 * @typedef {object} RenderMarkdownOptions
 * @property {boolean} [inline] 内联模式：去掉最外层 <p> 包裹，用于单行/行内文本
 * @property {boolean} [stripEmphasis] 剥掉斜体强调标签（em/i）只保留其文字，用于 RP 场景把单星号动作与单下划线心声渲染成纯文本；strong 粗体不受影响
 * @property {object} [sanitizerOverrides] DOMPurify 白名单覆盖项，与默认配置浅合并
 */

// 关键阅读选项子集（表格、软换行、删除线、代码块）。不启用 underline：其会把单下划线 _x_ 留成字面下划线，
// 与「强调符渲染成纯文本」相冲突；关闭后 _x_ 走标准 <em>，再由 stripEmphasis 统一剥成纯文本。
const converterOptions = {
    literalMidWordUnderscores: true,
    parseImgDimensions: true,
    tables: true,
    simpleLineBreaks: true,
    strikethrough: true,
    disableForced4SpacesIndentedSublists: true,
    ghCodeBlocks: true,
};

// 斜体强调标签：stripEmphasis 时移出白名单，DOMPurify 会剥标签保留其文字内容。<strong>/<b> 粗体保留。
const emphasisTags = ['em', 'i'];

// RP 常见格式与代码块所需的标签白名单；未列出的标签一律被 DOMPurify 剥离。
const allowedTags = [
    'p', 'br', 'hr',
    'em', 'strong', 'i', 'b', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup', 'small',
    'blockquote', 'q',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'code', 'pre', 'kbd', 'samp',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'a', 'img', 'span',
];

// 仅保留展示所需属性；on* 事件属性与 script/style 标签由 DOMPurify 默认策略剥离。
const allowedAttr = [
    'href', 'title', 'target', 'rel',
    'src', 'alt', 'width', 'height',
    'class', 'align', 'colspan', 'rowspan', 'start',
];

/**
 * @type {MarkdownConverter | null}
 */
let sharedConverter = null;

/**
 * 惰性构造并复用单例 showdown 转换器，避免每次渲染重建。
 * @returns {MarkdownConverter}
 */
function getConverter() {
    if (!sharedConverter) {
        sharedConverter = new showdown.Converter(converterOptions);
    }
    return sharedConverter;
}

/**
 * 构造 DOMPurify 净化配置，允许调用方浅合并覆盖白名单。
 * @param {object} [overrides]
 * @param {boolean} [stripEmphasis] 是否把斜体强调标签移出白名单（剥标签保留文字）
 */
function buildSanitizerConfig(overrides = {}, stripEmphasis = false) {
    const tags = stripEmphasis ? allowedTags.filter(tag => !emphasisTags.includes(tag)) : allowedTags;
    return {
        ALLOWED_TAGS: tags,
        ALLOWED_ATTR: allowedAttr,
        ALLOW_DATA_ATTR: false,
        RETURN_DOM: false,
        RETURN_DOM_FRAGMENT: false,
        ...overrides,
    };
}

/**
 * 去掉最外层单个 <p>…</p> 包裹，用于内联渲染；存在多个段落时保持原样。
 * @param {string} html
 * @returns {string}
 */
function unwrapParagraph(html) {
    const match = html.match(/^<p>([\s\S]*)<\/p>$/);
    if (match && !/<p[\s>]/i.test(match[1])) {
        return match[1];
    }
    return html;
}

/**
 * 将消息文本从 Markdown 渲染为经 DOMPurify 白名单净化的 HTML 字符串（块级，含段落包裹）。
 * @param {string} text 原始 Markdown 文本
 * @param {RenderMarkdownOptions} [options]
 * @returns {string} 净化后的 HTML 字符串
 */
export function renderMessageMarkdown(text, options = {}) {
    const source = String(text ?? '');
    if (!source) {
        return '';
    }

    const rawHtml = getConverter().makeHtml(source).trim();
    const cleanHtml = String(DOMPurify.sanitize(rawHtml, buildSanitizerConfig(options.sanitizerOverrides, options.stripEmphasis)));
    return options.inline ? unwrapParagraph(cleanHtml) : cleanHtml;
}

/**
 * renderMessageMarkdown 的内联变体：渲染结果不含最外层 <p> 包裹，用于单行/行内场景。
 * @param {string} text 原始 Markdown 文本
 * @param {Omit<RenderMarkdownOptions, 'inline'>} [options]
 * @returns {string} 净化后的内联 HTML 字符串
 */
export function renderInlineMarkdown(text, options = {}) {
    return renderMessageMarkdown(text, { ...options, inline: true });
}
