export function createCharacterFormFieldComponents({
    state,
    escapeHtml,
    uniqueValues,
}) {
    function renderCharacterFormContent(form, scope, isCreate) {
        const scopeAttribute = escapeHtml(scope);
        const errors = getCharacterFormErrors(scope);

        return `
        <div class="character-form">
            <div class="form-grid two-columns">
                ${renderCharacterInput('name', '名称', form.name, scopeAttribute, '', errors, true)}
                ${renderCharacterInput('creator', '作者', form.creator, scopeAttribute, '', errors)}
                ${renderCharacterInput('character_version', '版本', form.character_version, scopeAttribute, '', errors)}
                ${renderCharacterInput('tags', '标签', form.tags, scopeAttribute, '用逗号分隔', errors)}
                ${renderCharacterWorldSelect(form, scopeAttribute)}
                ${renderCharacterNumberInput('talkativeness', '发言概率', form.talkativeness, scopeAttribute, '0', '1', '0.05')}
                ${renderCharacterNumberInput('depth_prompt_depth', 'Depth 深度', form.depth_prompt_depth, scopeAttribute, '0', '9999', '1')}
                ${renderCharacterDepthRoleSelect(form, scopeAttribute)}
                ${renderCharacterCheckbox('favorite', '收藏角色', form.favorite, scopeAttribute)}
            </div>
            ${renderCharacterTextarea('description', '描述', form.description, scopeAttribute)}
            ${renderCharacterTextarea('personality', '性格', form.personality, scopeAttribute)}
            ${renderCharacterTextarea('scenario', '场景', form.scenario, scopeAttribute)}
            ${renderCharacterTextarea('first_mes', '首条消息', form.first_mes, scopeAttribute)}
            ${renderCharacterTextarea('alternate_greetings', '备用开场白', form.alternate_greetings, scopeAttribute, '多条开场白用单独一行 --- 分隔')}
            ${renderCharacterTextarea('mes_example', '示例消息', form.mes_example, scopeAttribute)}
            ${renderCharacterTextarea('creator_notes', '作者备注', form.creator_notes, scopeAttribute)}
            ${renderCharacterTextarea('system_prompt', '系统提示词', form.system_prompt, scopeAttribute)}
            ${renderCharacterTextarea('depth_prompt_prompt', 'Depth Prompt', form.depth_prompt_prompt, scopeAttribute)}
            ${renderCharacterTextarea('post_history_instructions', '历史后置提示', form.post_history_instructions, scopeAttribute)}
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" ${isCreate ? 'data-cancel-character-create' : 'data-cancel-character-edit'}>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="primary-button" type="button" ${isCreate ? 'data-save-character-create' : 'data-save-character-edit'}>
                    <i class="fa-solid fa-check"></i>
                    ${isCreate ? '创建角色' : '保存角色'}
                </button>
            </div>
        </div>
    `;
    }

    function getCharacterFormErrors(scope) {
        return scope === 'create'
            ? state.characterCreating.errors || {}
            : state.characterEditing.errors || {};
    }

    function renderCharacterInput(field, label, value, scope, placeholder = '', errors = {}, required = false) {
        const error = errors[field] || '';
        const errorId = `character-${scope}-${field}-error`;
        const requiredAttribute = required ? 'required' : '';
        const errorAttribute = error ? `aria-invalid="true" aria-describedby="${escapeHtml(errorId)}"` : '';
        return `
        <label class="field-label">
            <span>${escapeHtml(label)}${required ? '<span class="required-marker">必填</span>' : ''}</span>
            <input
                class="text-input"
                type="text"
                data-character-field="${escapeHtml(field)}"
                data-character-scope="${scope}"
                value="${escapeHtml(value)}"
                placeholder="${escapeHtml(placeholder)}"
                ${requiredAttribute}
                ${errorAttribute}
            >
            ${error ? `<span class="field-error" id="${escapeHtml(errorId)}">${escapeHtml(error)}</span>` : ''}
        </label>
    `;
    }

    function renderCharacterNumberInput(field, label, value, scope, min, max, step) {
        return `
        <label class="field-label">
            <span>${escapeHtml(label)}</span>
            <input
                class="text-input"
                type="number"
                min="${escapeHtml(min)}"
                max="${escapeHtml(max)}"
                step="${escapeHtml(step)}"
                data-character-field="${escapeHtml(field)}"
                data-character-scope="${scope}"
                value="${escapeHtml(value)}"
            >
        </label>
    `;
    }

    function renderCharacterTextarea(field, label, value, scope, placeholder = '') {
        return `
        <label class="field-label">
            <span>${escapeHtml(label)}</span>
            <textarea data-character-field="${escapeHtml(field)}" data-character-scope="${scope}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
        </label>
    `;
    }

    function renderCharacterCheckbox(field, label, checked, scope) {
        return `
        <label class="checkbox-card compact-checkbox">
            <input type="checkbox" data-character-field="${escapeHtml(field)}" data-character-scope="${scope}" ${checked ? 'checked' : ''}>
            <span>${escapeHtml(label)}</span>
        </label>
    `;
    }

    function renderCharacterDepthRoleSelect(form, scope) {
        const roles = ['system', 'user', 'assistant'];
        return `
        <label class="field-label">
            <span>Depth Prompt 角色</span>
            <select class="select-input" data-character-field="depth_prompt_role" data-character-scope="${scope}">
                ${roles.map(role => `<option value="${role}" ${form.depth_prompt_role === role ? 'selected' : ''}>${role}</option>`).join('')}
            </select>
        </label>
    `;
    }

    function renderCharacterWorldSelect(form, scope) {
        const worldNames = uniqueValues([
            form.world,
            ...(state.worldbooks || []).map(worldbook => worldbook.file_id || worldbook.name),
            ...(state.settingsBundle.world_names || []),
        ]);

        return `
        <label class="field-label">
            <span>关联世界书</span>
            <select class="select-input" data-character-field="world" data-character-scope="${scope}">
                <option value="">不关联</option>
                ${worldNames.map(name => `<option value="${escapeHtml(name)}" ${form.world === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
            </select>
        </label>
    `;
    }

    return {
        renderCharacterFormContent,
    };
}
