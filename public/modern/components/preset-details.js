export function createPresetDetailComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatNumber,
        parsePreset,
        renderKeyValue,
        getPresetEditorText,
        getOaiSettings,
    } = ctx;

    function renderPresetDetail(group, item) {
        const isOpenAi = group.id === 'openai';
        const isDeleting = state.presetDeleteConfirm.apiId === group.id && state.presetDeleteConfirm.name === item.name;
        const jsonText = getPresetEditorText(group.id, item.name, item.content);
        const parsedPreset = parsePreset(item.content);
        const editorError = state.presetEditor.apiId === group.id && state.presetEditor.name === item.name ? state.presetEditor.error : '';

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
                <button class="secondary-button" type="button" data-restore-preset="${escapeHtml(item.name)}" data-preset-api="${escapeHtml(group.id)}">
                    <i class="fa-solid fa-clock-rotate-left"></i>
                    恢复默认
                </button>
                <button class="secondary-button" type="button" data-delete-preset="${escapeHtml(item.name)}" data-preset-api="${escapeHtml(group.id)}">
                    <i class="fa-solid fa-ellipsis"></i>
                    管理
                </button>
            </div>
        </div>
        ${isDeleting ? `
            <div class="settings-form inline-form danger-panel">
                <div>
                    <strong>删除预设</strong>
                    <p class="panel-subtitle">将删除 ${escapeHtml(group.label)} / ${escapeHtml(item.name)}。</p>
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
        <section class="form-section">
            <div>
                <h3 class="form-section-title">摘要</h3>
                <p class="panel-subtitle">常用字段预览；完整内容在下方 JSON 编辑器。</p>
            </div>
            <div class="kv-list">
                ${renderPresetPreviewRows(parsedPreset)}
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
                    <p class="panel-subtitle">保存现代 API 页可编辑的模型、端点和采样参数；高级字段保留在原预设中。</p>
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

    function renderPresetPreviewRows(preset) {
        if (!preset || typeof preset !== 'object') {
            return renderKeyValue('格式', '非 JSON 或空预设');
        }

        const modelFields = ['model', 'openai_model', 'siliconflow_model', 'claude_model', 'openrouter_model', 'custom_model'];
        const model = modelFields.map(field => preset[field]).find(Boolean);
        const rows = [
            ['模型', model || '未设置'],
            ['来源', preset.chat_completion_source || preset.source || '未设置'],
            ['Temperature', preset.temperature ?? preset.temp_openai ?? '未设置'],
            ['Max Tokens', preset.openai_max_tokens ?? preset.max_tokens ?? '未设置'],
            ['Prompts', Array.isArray(preset.prompts) ? `${formatNumber(preset.prompts.length)} 个` : '未设置'],
            ['Prompt Order', Array.isArray(preset.prompt_order) ? `${formatNumber(preset.prompt_order.length)} 个` : '未设置'],
            ['字段数', formatNumber(Object.keys(preset).length)],
        ];

        return rows.map(([key, value]) => renderKeyValue(key, String(value))).join('');
    }

    return {
        renderPresetDetail,
    };
}
