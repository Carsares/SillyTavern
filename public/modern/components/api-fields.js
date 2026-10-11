// 「模型连接」各编辑器共用的字段片段：密钥输入框，以及文本补全类共用的上下文长度 / 回复长度分区。
// 所有字段改动即保存（actions/api-autosave.js），这里只负责渲染。
import {
    DEFAULT_CONTEXT_LENGTH,
    DEFAULT_RESPONSE_LENGTH,
    describeTextCompletionContext,
    TEXT_COMPLETION_INPUT_RANGE,
} from '../actions/chat-completion-limits.js';

/**
 * @param {object} ctx 路由上下文（需要 escapeHtml）
 */
export function createApiFieldComponents(ctx) {
    const { state, escapeHtml, getNumberSetting } = ctx;

    /**
     * 密钥输入框：不回显已保存的值；输入新值后失焦即保存并清空输入框。
     * @param {{ attribute: string, name: string, saved: boolean, label?: string, emptyPlaceholder?: string, hidden?: boolean, fieldAttribute?: string }} options 字段选项
     * @returns {string} HTML
     */
    function renderSecretField({ attribute, name, saved, label = 'API Key', emptyPlaceholder = '粘贴后离开输入框即保存', hidden = false, fieldAttribute = '' }) {
        return `
        <label class="field-label" ${fieldAttribute} ${hidden ? 'hidden' : ''}>
            <span class="field-label-row">
                ${escapeHtml(label)}
                <span class="field-state ${saved ? 'is-saved' : ''}" data-secret-state>${saved ? '已保存' : '未保存'}</span>
            </span>
            <input class="text-input" type="password" name="${escapeHtml(name)}" ${attribute}
                value="" autocomplete="new-password"
                placeholder="${escapeHtml(saved ? '已保存；粘贴新密钥会替换' : emptyPlaceholder)}">
        </label>
        `;
    }

    /**
     * 文本补全、KoboldAI、NovelAI、AI Horde 共用的顶层 max_context / amount_gen。
     * @param {string} mainApi 当前主 API
     * @returns {string} HTML
     */
    function renderTextLengthSection(mainApi) {
        const settings = state.settings || {};
        // 设置里没有 max_context / amount_gen 时按默认值显示，与 default/content/settings.json 一致
        const context = getNumberSetting(settings, 'max_context', DEFAULT_CONTEXT_LENGTH);
        const response = getNumberSetting(settings, 'amount_gen', DEFAULT_RESPONSE_LENGTH);
        const hint = describeTextCompletionContext({ mainApi, context, response });
        const { context: contextRange, response: responseRange } = TEXT_COMPLETION_INPUT_RANGE;
        return `
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">长度</h3>
                    <p class="panel-subtitle">上下文长度减去回复长度是提示词预算，放不下的早期消息不会发送。按模型实际支持的长度填写。</p>
                </div>
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>上下文长度</span>
                        <input class="text-input" type="number" inputmode="numeric" step="1" min="${contextRange.min}" max="${contextRange.max}" data-textgen-max-context value="${escapeHtml(context)}">
                    </label>
                    <label class="field-label">
                        <span>回复长度</span>
                        <input class="text-input" type="number" inputmode="numeric" step="1" min="${responseRange.min}" max="${responseRange.max}" data-textgen-amount-gen value="${escapeHtml(response)}">
                    </label>
                </div>
                <p class="api-context-hint ${hint.level === 'warning' ? 'is-warning' : ''}" data-textgen-context-hint ${hint.text ? '' : 'hidden'}>${escapeHtml(hint.text)}</p>
            </section>
        `;
    }

    return {
        renderSecretField,
        renderTextLengthSection,
    };
}
