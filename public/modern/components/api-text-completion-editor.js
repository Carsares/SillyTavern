import {
    describeTextCompletionLimitHint,
    getTextCompletionLimits,
} from '../actions/chat-completion-limits.js';

// 设置里没有 max_context / amount_gen 时的显示值，与 default/content/settings.json 的默认设置一致
const TEXT_COMPLETION_CONTEXT_FALLBACK = 8192;
const TEXT_COMPLETION_RESPONSE_FALLBACK = 350;

const textCompletionSamplingFields = [
    { key: 'temp', label: '温度', step: '0.01', fallback: 0.7 },
    { key: 'top_p', label: 'Top P', step: '0.01', fallback: 0.5 },
    { key: 'top_k', label: 'Top K', step: '1', fallback: 40 },
    { key: 'min_p', label: 'Min P', step: '0.01', fallback: 0 },
    { key: 'rep_pen', label: '重复惩罚', step: '0.01', fallback: 1.2 },
    { key: 'rep_pen_range', label: '重复范围', step: '1', fallback: 0 },
];

export function createApiTextCompletionEditorComponents(ctx) {
    const {
        state,
        escapeHtml,
        getPresetGroups,
        getNumberSetting,
        getTextCompletionProfile,
        getTextCompletionSecretUiState,
        getTextCompletionTypeOptions,
    } = ctx;

    function renderTextCompletionEditor(mainApi, renderApiMainSelect) {
        const profile = getTextCompletionProfile();
        const textgenSettings = state.settings?.textgenerationwebui_settings || {};
        const textgenPresetNames = getPresetGroups().find(group => group.id === 'textgenerationwebui')?.names || [];
        const secretUiState = getTextCompletionSecretUiState(profile.source);
        const typeOptions = getTextCompletionTypeOptions(profile.source);
        // 上下文长度 / 回复长度是顶层 max_context / amount_gen，「解锁」是 power_user.max_context_unlocked（与旧版一致）。
        // 输入框不设 min / max / step：这个表单没有 novalidate（端点输入框靠浏览器校验网址），范围由保存时的字段级错误把关
        const limitsUnlocked = Boolean(state.settings?.power_user?.max_context_unlocked);
        const limits = getTextCompletionLimits({ unlocked: limitsUnlocked });
        const contextValue = getNumberSetting(state.settings || {}, 'max_context', TEXT_COMPLETION_CONTEXT_FALLBACK);
        const responseValue = getNumberSetting(state.settings || {}, 'amount_gen', TEXT_COMPLETION_RESPONSE_FALLBACK);

        return `
        <form class="settings-form" data-api-connection-form autocomplete="off">
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">连接</h3>
                    <p class="panel-subtitle">在现代页编辑文本补全的 type、端点和档案字段。</p>
                </div>
                <div class="form-grid two-columns">
                    ${renderApiMainSelect(mainApi)}
                    <label class="field-label">
                        <span>文本补全来源</span>
                        <select class="select-input" data-textgen-type>
                            ${typeOptions.map(option => `<option value="${escapeHtml(option.id)}" ${profile.source === option.id ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
                        </select>
                    </label>
                    <label class="field-label">
                        <span>端点</span>
                        <input class="text-input" type="url" data-textgen-endpoint value="${escapeHtml(profile.rawEndpoint)}" autocomplete="off" placeholder="例如 http://127.0.0.1:5000">
                    </label>
                </div>
            </section>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">模型参数</h3>
                    <p class="panel-subtitle">只承接文本补全连接必需的浅层档案字段。</p>
                </div>
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>模型</span>
                        <input class="text-input" type="text" data-textgen-model value="${escapeHtml(profile.model)}" autocomplete="off" placeholder="当前 type 对应模型字段">
                    </label>
                    <label class="field-label">
                        <span>文本补全预设</span>
                        <select class="select-input" data-textgen-preset>
                            <option value="">未选择</option>
                            ${textgenPresetNames.map(name => `<option value="${escapeHtml(name)}" ${profile.preset === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
                        </select>
                    </label>
                </div>
            </section>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">上下文与回复长度</h3>
                    <p class="panel-subtitle">上下文长度减去回复长度就是提示词预算；超出预算的历史会从最早的消息开始丢弃。</p>
                </div>
                <div class="form-grid two-columns">
                    <label class="field-label api-limit-field">
                        <span>上下文长度</span>
                        <input class="text-input" type="number" step="any" data-textgen-max-context value="${escapeHtml(contextValue)}">
                    </label>
                    <label class="field-label api-limit-field">
                        <span>回复长度</span>
                        <input class="text-input" type="number" step="any" data-textgen-amount-gen value="${escapeHtml(responseValue)}">
                    </label>
                </div>
                <label class="checkbox-card">
                    <input type="checkbox" data-textgen-max-context-unlocked ${limitsUnlocked ? 'checked' : ''}>
                    <span>解锁上限，仅在模型确实支持更长上下文时开启</span>
                </label>
                <span class="api-context-hint" data-textgen-context-hint>${escapeHtml(describeTextCompletionLimitHint({ limits, context: contextValue, response: responseValue }))}</span>
            </section>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">基础采样</h3>
                    <p class="panel-subtitle">承接文本补全常用采样字段，保存为旧设置同名字段。</p>
                </div>
                <div class="form-grid two-columns">
                    ${textCompletionSamplingFields.map(field => renderTextCompletionSamplingField(field, textgenSettings)).join('')}
                </div>
            </section>
            <div class="form-section">
                <div>
                    <h3 class="form-section-title">安全密钥</h3>
                    <p class="panel-subtitle">密钥写入本地 secrets，不在页面回显。</p>
                </div>
                <label class="field-label" data-textgen-field="api-key" ${secretUiState.hasSecretMapping ? '' : 'hidden'}>
                    <span>API Key</span>
                    <input class="text-input" type="password" name="text_completion_api_key" data-textgen-api-key
                        value="" autocomplete="new-password"
                        placeholder="${secretUiState.secretSaved ? '密钥已保存；留空不修改' : '输入后保存到 secrets'}">
                </label>
            </div>
            <div class="connection-test">
                <span class="badge" data-textgen-secret-status>${secretUiState.secretSaved ? '密钥已保存' : (secretUiState.hasSecretMapping ? '未保存密钥' : '无密钥字段')}</span>
                <span data-textgen-secret-key>${escapeHtml(secretUiState.secretKey)}</span>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="submit" data-save-api-connection>
                    <i class="fa-solid fa-floppy-disk"></i>
                    保存连接字段
                </button>
            </div>
        </form>
    `;
    }

    function renderTextCompletionSamplingField(field, settings) {
        return `
        <label class="field-label">
            <span>${escapeHtml(field.label)}</span>
            <input class="text-input" type="number" step="${escapeHtml(field.step)}" data-textgen-sampling="${escapeHtml(field.key)}" value="${escapeHtml(getNumberSetting(settings, field.key, field.fallback))}">
        </label>
    `;
    }

    return {
        renderTextCompletionEditor,
    };
}
