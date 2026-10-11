import { getOpenAiPromptOrderEntry, getOpenAiPromptName } from '../actions/openai-preset-fields.js';
import { chatCompletionModelFields } from '../core/constants.js';

export function createPresetDetailComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatNumber,
        parsePreset,
        renderKeyValue,
        getPresetEditorText,
        getOaiSettings,
        getChatCompletionModel,
        getPresetRestoreStatus,
    } = ctx;

    // 「恢复默认」只对有内置默认版本的预设可用；其他预设（复制、导入或另存的）禁用并说明原因。
    function renderPresetRestoreButton(group, item) {
        const status = getPresetRestoreStatus(group.id, item.name);
        const titles = {
            checking: '正在检查这个预设是否有内置默认版本…',
            available: '用内置默认版本覆盖这个预设的当前内容',
            unavailable: '这个预设不是内置预设（例如复制、导入或另存的预设），没有可恢复的默认版本。',
            unknown: '用内置默认版本覆盖这个预设的当前内容',
        };
        const disabled = status === 'checking' || status === 'unavailable';
        return `
                <button class="secondary-button" type="button" data-restore-preset="${escapeHtml(item.name)}" data-preset-api="${escapeHtml(group.id)}" data-restore-status="${escapeHtml(status)}" title="${escapeHtml(titles[status] || titles.unknown)}" ${disabled ? 'disabled' : ''}>
                    <i class="fa-solid fa-clock-rotate-left"></i>
                    恢复默认
                </button>`;
    }

    function getPresetDeleteNotice(group, item) {
        const confirm = state.presetDeleteConfirm;
        const base = `将删除 ${group.label} / ${item.name}，此操作不可撤销。`;
        if (!confirm.active) {
            return base;
        }
        const fallback = confirm.fallbackName
            ? `删除后，当前聊天补全预设会切换为「${confirm.fallbackName}」。`
            : '删除后将没有当前聊天补全预设。';
        return `${base}这是正在使用的聊天补全预设（标记为「当前」）；${fallback}`;
    }

    function renderPresetDetail(group, item) {
        const isOpenAi = group.id === 'openai';
        const isDeleting = state.presetDeleteConfirm.apiId === group.id && state.presetDeleteConfirm.name === item.name;
        const jsonText = getPresetEditorText(group.id, item.name, item.content);
        const parsedPreset = parsePreset(item.content);
        const editorError = state.presetEditor.apiId === group.id && state.presetEditor.name === item.name ? state.presetEditor.error : '';
        const summaryNote = isOpenAi
            ? '这里显示预设文件里保存的值，不一定是当前 API 连接正在用的值；与当前连接不同的字段已标出。完整内容在下方 JSON 编辑器。'
            : '常用字段预览；完整内容在下方 JSON 编辑器。';

        return `
        <div class="detail-hero preset-detail-hero">
            <span class="avatar-fallback large"><i class="fa-solid fa-file-lines"></i></span>
            <div>
                <h2 class="detail-title">${escapeHtml(item.name)}</h2>
                <p class="panel-subtitle">${escapeHtml(group.label)} · ${escapeHtml(group.id)}</p>
                <div class="tag-row detail-tags">
                    ${item.active ? '<span class="tag">当前聊天补全预设</span>' : ''}
                    <span class="tag">${parsedPreset ? 'JSON 可编辑' : '非 JSON 文本'}</span>
                    <span class="tag">${formatNumber(Object.keys(parsedPreset || {}).length)} 个顶层字段</span>
                </div>
            </div>
            <div class="detail-actions page-actions">
                ${item.actionable ? `
                    <button class="secondary-button" type="button" data-use-openai-preset="${escapeHtml(item.name)}" ${item.active ? 'disabled' : ''}>
                        <i class="fa-solid fa-check"></i>
                        ${item.active ? '当前' : '使用'}
                    </button>
                ` : ''}
                <button class="secondary-button" type="button" data-duplicate-preset="${escapeHtml(item.name)}" data-preset-api="${escapeHtml(group.id)}">
                    <i class="fa-solid fa-copy"></i>
                    复制
                </button>
                <button class="secondary-button" type="button" data-export-preset="${escapeHtml(item.name)}" data-preset-api="${escapeHtml(group.id)}">
                    <i class="fa-solid fa-file-export"></i>
                    导出
                </button>
                ${renderPresetRestoreButton(group, item)}
                <button class="secondary-button danger-action" type="button" data-delete-preset="${escapeHtml(item.name)}" data-preset-api="${escapeHtml(group.id)}">
                    <i class="fa-solid fa-trash-can"></i>
                    删除
                </button>
            </div>
        </div>
        ${isDeleting ? `
            <div class="settings-form inline-form danger-panel">
                <div>
                    <strong>删除预设</strong>
                    <p class="panel-subtitle" data-preset-delete-notice>${escapeHtml(getPresetDeleteNotice(group, item))}</p>
                </div>
                <div class="message-edit-actions">
                    <button class="secondary-button" type="button" data-cancel-preset-delete>
                        <i class="fa-solid fa-xmark"></i>
                        取消
                    </button>
                    <button class="secondary-button danger-action" type="button" data-confirm-preset-delete>
                        <i class="fa-solid fa-trash"></i>
                        确认删除
                    </button>
                </div>
            </div>
        ` : ''}
        ${isOpenAi ? renderOpenAiPresetTools() : ''}
        ${isOpenAi ? renderPromptOrderSection(parsedPreset, item.name) : ''}
        <section class="form-section">
            <div>
                <h3 class="form-section-title">摘要</h3>
                <p class="panel-subtitle" data-preset-summary-note>${escapeHtml(summaryNote)}</p>
            </div>
            <div class="kv-list">
                ${renderPresetPreviewRows(parsedPreset, isOpenAi)}
            </div>
        </section>
        <section class="form-section">
            <div>
                <h3 class="form-section-title">JSON 编辑</h3>
                <p class="panel-subtitle">直接编辑预设文件内容，保存后调用现有预设保存接口。</p>
            </div>
            <textarea class="preset-json-editor" spellcheck="false" data-preset-json-input>${escapeHtml(jsonText)}</textarea>
            ${editorError ? `<p class="danger">${escapeHtml(editorError)}</p>` : ''}
            <div class="message-edit-actions">
                <button class="primary-button" type="button" data-save-preset-json>
                    <i class="fa-solid fa-floppy-disk"></i>
                    保存 JSON
                </button>
            </div>
        </section>
    `;
    }

    function renderOpenAiPresetTools() {
        const currentPreset = getOaiSettings().preset_settings_openai || '';
        const draftName = state.openAiPresetDraft.name || currentPreset;

        return `
        <section class="form-section">
            <div class="panel-header">
                <div>
                    <h3 class="form-section-title">从当前 API 配置保存</h3>
                    <p class="panel-subtitle">保存「模型连接」里可编辑的模型、端点和采样参数；高级字段保留在原预设中。</p>
                </div>
                <span class="badge">${escapeHtml(currentPreset || '未选择')}</span>
            </div>
            <div class="form-grid two-columns">
                <label class="field-label">
                    <span>预设名称</span>
                    <input class="text-input" type="text" data-openai-preset-name value="${escapeHtml(draftName)}" placeholder="输入新名称或覆盖当前预设">
                </label>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-save-openai-preset>
                    <i class="fa-solid fa-floppy-disk"></i>
                    保存当前配置为预设
                </button>
            </div>
        </section>
    `;
    }

    // 渲染当前生效角色的 prompt_order：每项含启用复选框与上移/下移按钮，操作即走保存链路持久化。
    function renderPromptOrderSection(preset, presetName) {
        const orderEntry = getOpenAiPromptOrderEntry(preset);
        if (!orderEntry) {
            return '';
        }

        const order = orderEntry.order;
        const rows = order.map((entry, index) => {
            const identifier = typeof entry?.identifier === 'string' ? entry.identifier : '';
            const name = getOpenAiPromptName(preset, identifier);
            const enabled = entry?.enabled !== false;
            return `
            <div class="prompt-order-row">
                <label class="prompt-order-toggle">
                    <input type="checkbox" ${enabled ? 'checked' : ''} data-toggle-prompt-order="${escapeHtml(identifier)}" data-preset-name="${escapeHtml(presetName)}">
                    <span class="prompt-order-name">${escapeHtml(name)}</span>
                </label>
                <div class="prompt-order-actions">
                    <button class="icon-button mini" type="button" title="上移" data-move-prompt-order="${escapeHtml(identifier)}" data-move-direction="up" data-preset-name="${escapeHtml(presetName)}" ${index === 0 ? 'disabled' : ''}>
                        <i class="fa-solid fa-arrow-up"></i>
                    </button>
                    <button class="icon-button mini" type="button" title="下移" data-move-prompt-order="${escapeHtml(identifier)}" data-move-direction="down" data-preset-name="${escapeHtml(presetName)}" ${index === order.length - 1 ? 'disabled' : ''}>
                        <i class="fa-solid fa-arrow-down"></i>
                    </button>
                </div>
            </div>`;
        }).join('');

        return `
        <section class="form-section">
            <div>
                <h3 class="form-section-title">Prompt 顺序与启用</h3>
                <p class="panel-subtitle">切换启用或调整顺序即保存到该预设，并同步当前生效配置；作用于当前生效角色的提示词排序。</p>
            </div>
            <div class="prompt-order-list">
                ${rows}
            </div>
        </section>
    `;
    }

    // 预设的模型按它自己保存的来源取对应字段（如 custom → custom_model），没有来源时沿用常见字段顺序。
    function getPresetModel(preset, source) {
        const sourceField = chatCompletionModelFields[source];
        if (sourceField && preset[sourceField]) {
            return preset[sourceField];
        }

        const modelFields = ['model', 'openai_model', 'siliconflow_model', 'claude_model', 'openrouter_model', 'custom_model'];
        return modelFields.map(field => preset[field]).find(Boolean) || '';
    }

    // 当前 API 连接的来源和模型，取自设置里的 oai_settings，与 API 页显示口径一致。
    function getCurrentChatCompletionConnection() {
        const settings = getOaiSettings();
        const source = settings.chat_completion_source || '';
        return {
            source,
            model: source ? getChatCompletionModel(settings, source) : '',
        };
    }

    function renderPresetSummaryRow(key, field, value, currentValue) {
        const differs = Boolean(value && currentValue && String(value) !== String(currentValue));
        if (!differs) {
            return renderKeyValue(key, String(value || '未设置'));
        }

        return `
            <div class="kv-row preset-summary-diff" data-preset-summary-diff="${escapeHtml(field)}">
                <span class="kv-key">${escapeHtml(key)}</span>
                <span class="preset-summary-diff-values">
                    <span class="kv-value" title="${escapeHtml(value)}">${escapeHtml(value)}</span>
                    <span class="preset-summary-current" title="${escapeHtml(currentValue)}">当前连接：${escapeHtml(currentValue)}</span>
                </span>
            </div>
        `;
    }

    function renderPresetPreviewRows(preset, isOpenAi) {
        if (!preset || typeof preset !== 'object') {
            return renderKeyValue('格式', '非 JSON 或空预设');
        }

        const source = preset.chat_completion_source || preset.source || '';
        const model = getPresetModel(preset, source);
        const current = isOpenAi ? getCurrentChatCompletionConnection() : { source: '', model: '' };
        const rows = [
            ['Temperature', preset.temperature ?? preset.temp_openai ?? '未设置'],
            ['Max Tokens', preset.openai_max_tokens ?? preset.max_tokens ?? '未设置'],
            ['Prompts', Array.isArray(preset.prompts) ? `${formatNumber(preset.prompts.length)} 个` : '未设置'],
            ['Prompt Order', Array.isArray(preset.prompt_order) ? `${formatNumber(preset.prompt_order.length)} 个` : '未设置'],
            ['字段数', formatNumber(Object.keys(preset).length)],
        ];

        return [
            renderPresetSummaryRow('模型', 'model', model, current.model),
            renderPresetSummaryRow('来源', 'source', source, current.source),
            ...rows.map(([key, value]) => renderKeyValue(key, String(value))),
        ].join('');
    }

    return {
        renderPresetDetail,
    };
}
