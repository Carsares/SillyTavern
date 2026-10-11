// 设置页「聊天工具」标签里的聊天摘要设置分区（A6）：编辑 extension_settings.memory（摘要扩展的设置）。
// 字段名和取值范围对照 public/scripts/extensions/memory/index.js 的 defaultSettings 和 settings.html，校验规则在 core/chat-summary.js。
// render() 返回一个完整的 <section class="form-section">；事件在 routes/settings-tool-summary-events.js，动作在 actions/chat-summary.js。
// 输入框的改动只写进草稿、不重新渲染；未保存标记、校验错误、深度和角色的显隐由事件文件按 data-ss-* 属性就地更新。
import {
    SUMMARY_NUMBER_FIELDS,
    SUMMARY_POSITIONS,
    SUMMARY_PROMPT_BUILDERS,
    SUMMARY_ROLES,
    SUMMARY_SOURCES,
} from '../core/chat-summary.js';

export function createSettingsToolSummary(ctx) {
    const { escapeHtml } = ctx;

    function renderError(view, field) {
        return `<span class="field-error" data-ss-error="${field}" role="alert" ${view.errors?.[field] ? '' : 'hidden'}>${escapeHtml(view.errors?.[field] || '')}</span>`;
    }

    function renderNumber(view, field, hint) {
        const range = SUMMARY_NUMBER_FIELDS[field];
        return `
        <label class="field-label">
            <span>${escapeHtml(range.label)}${range.unit ? `（${escapeHtml(range.unit)}）` : ''}</span>
            <input class="text-input" type="number" min="${range.min}" max="${range.max}" step="1" inputmode="numeric" data-ss-field="${field}" value="${escapeHtml(view.draft[field])}" aria-invalid="${view.errors?.[field] ? 'true' : 'false'}">
            <span class="authors-note-hint">${hint}</span>
            ${renderError(view, field)}
        </label>
    `;
    }

    function renderCheckbox(view, field, label, hint = '') {
        return `
        <label class="checkbox-card compact-checkbox">
            <input type="checkbox" data-ss-field="${field}" ${view.draft[field] === '1' ? 'checked' : ''}>
            <span>${escapeHtml(label)}${hint ? ` <span class="authors-note-hint">${escapeHtml(hint)}</span>` : ''}</span>
        </label>
    `;
    }

    function renderOptions(options, selected) {
        return options.map(option => `<option value="${option.value}" ${String(option.value) === selected ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('');
    }

    function renderExtrasBanner(view) {
        if (view.extensionDisabled) {
            return `
            <div class="chat-summary-callout" role="alert" data-ss-disabled-banner>
                <p>摘要扩展已在扩展页被禁用，下面的设置要启用它之后才会生效。</p>
            </div>
        `;
        }
        if (!view.extrasSaved) {
            return '';
        }
        return `
        <div class="chat-summary-callout" role="alert" data-ss-extras-banner>
            <p>当前摘要来源是 Extras API（已弃用）。它需要连接 Extras 服务器，这里没有连接，所以自动摘要一直没有运行过。建议改用主模型：每次摘要会多一次主模型调用，按下面的间隔触发。</p>
            <button class="primary-button" type="button" data-ss-switch-main ${view.saving ? 'disabled' : ''}>
                <i class="fa-solid ${view.saving ? 'fa-circle-notch fa-spin' : 'fa-right-left'}"></i>
                切换为主模型
            </button>
            <span class="authors-note-hint">只改「摘要来源」这一项并立即保存，其它设置不变。</span>
        </div>
    `;
    }

    return {
        id: 'summary',
        label: '聊天摘要',
        isAvailable() {
            return true;
        },
        render() {
            const view = ctx.getSummarySettingsView();
            return `
            <section class="form-section" data-settings-summary>
                <div>
                    <h3 class="form-section-title">聊天摘要</h3>
                    <p class="panel-subtitle">聊天变长后，让模型把前面的剧情压缩成一段摘要，放进提示词里代替被挤出上下文的旧消息。摘要保存在聊天文件里，可以在聊天页「聊天工具 → 聊天摘要」查看和编辑。</p>
                </div>
                ${renderExtrasBanner(view)}
                <div class="settings-form chat-summary-settings">
                    <div class="form-grid two-columns">
                        <label class="field-label">
                            <span>摘要来源</span>
                            <select class="select-input" data-ss-field="source" aria-invalid="${view.errors?.source ? 'true' : 'false'}">
                                ${renderOptions(SUMMARY_SOURCES, view.draft.source)}
                            </select>
                            <span class="authors-note-hint">主模型使用聊天页当前连接的模型；WebLLM 需要浏览器支持 WebGPU 并安装 WebLLM 扩展。</span>
                            ${renderError(view, 'source')}
                        </label>
                        <label class="field-label">
                            <span>提示词构造方式（仅主模型）</span>
                            <select class="select-input" data-ss-field="prompt_builder" aria-invalid="${view.errors?.prompt_builder ? 'true' : 'false'}">
                                ${renderOptions(SUMMARY_PROMPT_BUILDERS, view.draft.prompt_builder)}
                            </select>
                            <span class="authors-note-hint">「原始」方式只发上次摘要之后的消息，请求更短，但已经摘要到最后时「重新摘要」会提示没有新消息。</span>
                            ${renderError(view, 'prompt_builder')}
                        </label>
                    </div>

                    <h4 class="chat-summary-subtitle">什么时候摘要</h4>
                    <div class="form-grid two-columns">
                        ${renderNumber(view, 'promptInterval', '0 = 关闭自动摘要（包括按字数触发）。每新增这么多条消息摘要一次。')}
                        ${renderNumber(view, 'promptForceWords', '0 = 不按字数触发。只统计英文和数字单词，中文几乎数不出字，中文聊天请用左边的消息间隔。')}
                    </div>
                    ${renderCheckbox(view, 'memoryFrozen', '暂停自动摘要', '暂停后摘要保持原样，仍可手动「重新摘要」。')}

                    <h4 class="chat-summary-subtitle">怎么摘要</h4>
                    <div class="form-grid two-columns">
                        ${renderNumber(view, 'promptWords', '提示词里的 {{words}} 会换成这个数字。')}
                        ${renderNumber(view, 'overrideResponseLength', '0 = 沿用聊天的回复长度上限。')}
                        ${renderNumber(view, 'maxMessagesPerRequest', '0 = 不限。只对「原始」构造方式和 WebLLM 生效。')}
                    </div>
                    ${renderCheckbox(view, 'SkipWIAN', '摘要请求不带世界书和作者注释', '只对主模型来源有效。')}
                    <label class="field-label">
                        <span>摘要提示词</span>
                        <textarea rows="6" data-ss-field="prompt" aria-invalid="${view.errors?.prompt ? 'true' : 'false'}">${escapeHtml(view.draft.prompt)}</textarea>
                        <span class="authors-note-hint">发给模型的指令，{{words}} 会换成目标摘要字数。</span>
                        ${renderError(view, 'prompt')}
                    </label>
                    <div class="chat-summary-inline-actions">
                        <button class="secondary-button compact-button" type="button" data-ss-restore-prompt>
                            <i class="fa-solid fa-clock-rotate-left"></i>
                            恢复默认提示词
                        </button>
                    </div>

                    <h4 class="chat-summary-subtitle">摘要放在提示词的哪里</h4>
                    <label class="field-label">
                        <span>注入模板</span>
                        <textarea rows="2" data-ss-field="template" aria-invalid="${view.errors?.template ? 'true' : 'false'}">${escapeHtml(view.draft.template)}</textarea>
                        <span class="authors-note-hint">{{summary}} 会换成当前摘要。留空则使用扩展内置格式 Summary: …</span>
                        ${renderError(view, 'template')}
                    </label>
                    <div class="form-grid two-columns">
                        <label class="field-label">
                            <span>注入位置</span>
                            <select class="select-input" data-ss-field="position" aria-invalid="${view.errors?.position ? 'true' : 'false'}">
                                ${renderOptions(SUMMARY_POSITIONS, view.draft.position)}
                            </select>
                            ${renderError(view, 'position')}
                        </label>
                        ${renderCheckbox(view, 'scan', '摘要参与世界书扫描')}
                    </div>
                    <div class="form-grid two-columns" data-ss-depth-group ${view.inChat ? '' : 'hidden'}>
                        ${renderNumber(view, 'depth', '0 = 最新消息之后，数字越大越靠前。')}
                        <label class="field-label">
                            <span>注入角色</span>
                            <select class="select-input" data-ss-field="role" aria-invalid="${view.errors?.role ? 'true' : 'false'}">
                                ${renderOptions(SUMMARY_ROLES, view.draft.role)}
                            </select>
                            <span class="authors-note-hint">以哪种身份的消息放进提示词。</span>
                            ${renderError(view, 'role')}
                        </label>
                    </div>

                    <div class="chat-summary-feedback">
                        <p class="chat-summary-message error" role="alert" data-ss-message="error" ${view.error ? '' : 'hidden'}>${escapeHtml(view.error || '')}</p>
                        <p class="chat-summary-message warning" role="alert" data-ss-message="warning" ${view.warning ? '' : 'hidden'}>${escapeHtml(view.warning || '')}</p>
                        <p class="chat-summary-message success" role="status" data-ss-message="notice" ${view.notice ? '' : 'hidden'}>${escapeHtml(view.notice || '')}</p>
                    </div>
                    <div class="chat-summary-actions">
                        <span class="badge" data-ss-dirty ${view.dirty ? '' : 'hidden'}>编辑中，离开输入框后保存</span>
                    </div>
                </div>
            </section>
        `;
        },
    };
}
