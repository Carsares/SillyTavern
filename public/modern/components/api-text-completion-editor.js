import { textCompletionModelFields } from '../core/connection-labels.js';
import { createApiFieldComponents } from './api-fields.js';

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
    const { renderSecretField, renderTextLengthSection } = createApiFieldComponents(ctx);

    // 所有字段改动即保存（actions/api-autosave.js）；换来源后整页重绘，端点、模型和密钥按新来源显示
    function renderTextCompletionEditor(mainApi, renderApiMainSelect) {
        const profile = getTextCompletionProfile();
        const textgenSettings = state.settings?.textgenerationwebui_settings || {};
        const textgenPresetNames = getPresetGroups().find(group => group.id === 'textgenerationwebui')?.names || [];
        const secretUiState = getTextCompletionSecretUiState(profile.source);
        const typeOptions = getTextCompletionTypeOptions(profile.source);
        const hasModelField = Boolean(textCompletionModelFields[profile.source]);

        return `
        <form class="settings-form" data-api-connection-form autocomplete="off" novalidate>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">连接</h3>
                    <p class="panel-subtitle">填写本地或远程文本补全服务的地址。密钥只保存在本机，不会显示出来。</p>
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
                    ${secretUiState.hasSecretMapping ? renderSecretField({ attribute: 'data-textgen-api-key', name: 'text_completion_api_key', saved: secretUiState.secretSaved, fieldAttribute: 'data-textgen-field="api-key"' }) : ''}
                    ${hasModelField ? `
                    <label class="field-label">
                        <span>模型</span>
                        <input class="text-input" type="text" data-textgen-model value="${escapeHtml(profile.model)}" autocomplete="off" placeholder="留空时使用服务端当前加载的模型">
                    </label>` : ''}
                    <label class="field-label">
                        <span>文本补全预设</span>
                        <select class="select-input" data-textgen-preset>
                            <option value="" ${profile.preset ? '' : 'selected'}>未选择</option>
                            ${textgenPresetNames.map(name => `<option value="${escapeHtml(name)}" ${profile.preset === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
                        </select>
                    </label>
                </div>
            </section>
            ${renderTextLengthSection(mainApi)}
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">采样</h3>
                    <p class="panel-subtitle">控制回复的随机程度和重复程度。</p>
                </div>
                <div class="form-grid two-columns">
                    ${textCompletionSamplingFields.map(field => renderTextCompletionSamplingField(field, textgenSettings)).join('')}
                </div>
            </section>
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
