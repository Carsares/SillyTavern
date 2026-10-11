import { getCharacterWorldStatus } from '../actions/character-data.js';
import { createCharacterTranslationPanel } from './character-translation-panel.js';

export function createCharacterFormFieldComponents(ctx) {
    const {
        state,
        escapeHtml,
        uniqueValues,
    } = ctx;
    const { renderCharacterTranslationPanel } = createCharacterTranslationPanel(ctx);

    function renderCharacterFormContent(form, scope, { dirty = false, avatar = '' } = {}) {
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
            ${scope === 'create' ? renderCharacterCreateAvatarInput(errors) : ''}
            ${scope === 'edit' ? renderCharacterTranslationPanel() : ''}
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
            ${renderCharacterFormActions(scope, { dirty, avatar })}
        </div>
    `;
    }

    // 表单底部操作栏固定在视口底部；有未保存修改时显示提示，并给出明确的「放弃修改」入口。
    function renderCharacterFormActions(scope, { dirty = false, avatar = '' } = {}) {
        const isCreate = scope === 'create';
        const status = dirty
            ? '<span class="dot warning"></span><span>有未保存的修改</span>'
            : `<span>${isCreate ? '尚未填写内容' : '没有未保存的修改'}</span>`;
        let secondaryActions;
        if (isCreate) {
            secondaryActions = dirty
                ? `<button class="secondary-button danger-action" type="button" data-cancel-character-create>
                    <i class="fa-solid fa-trash-can"></i>
                    放弃修改
                </button>`
                : `<button class="secondary-button" type="button" data-cancel-character-create>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>`;
        } else {
            secondaryActions = dirty
                ? `<button class="secondary-button" type="button" data-cancel-character-edit title="收起编辑区，未保存的修改会保留">
                    <i class="fa-solid fa-chevron-up"></i>
                    收起
                </button>
                <button class="secondary-button danger-action" type="button" data-discard-character-draft="${escapeHtml(avatar)}">
                    <i class="fa-solid fa-trash-can"></i>
                    放弃修改
                </button>`
                : `<button class="secondary-button" type="button" data-cancel-character-edit>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>`;
        }

        return `
        <div class="character-form-actions ${dirty ? 'is-dirty' : ''}" data-character-form-actions="${escapeHtml(scope)}" data-dirty="${dirty ? 'true' : 'false'}">
            <span class="character-form-status" role="status">${status}</span>
            <div class="message-edit-actions">
                ${secondaryActions}
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

    // 新建角色时可直接带上头像；文件对象保存在 state 里，重绘后输入框会清空，所以单独显示已选文件和「移除」。
    function renderCharacterCreateAvatarInput(errors = {}) {
        const file = state.characterCreating.avatarFile;
        const error = errors.avatar || '';
        const hintId = 'character-create-avatar-hint';
        const errorId = 'character-create-avatar-error';
        const describedBy = error ? `${hintId} ${errorId}` : hintId;
        return `
        <div class="character-avatar-field" data-character-create-avatar-field>
            <label class="field-label">
                <span>头像图片（可选）</span>
                <input
                    class="text-input"
                    type="file"
                    accept="image/*"
                    data-character-create-avatar
                    data-character-focus="create-avatar"
                    aria-describedby="${describedBy}"
                    ${error ? 'aria-invalid="true"' : ''}
                >
            </label>
            <p class="panel-subtitle" id="${hintId}">不选择时使用默认头像；创建后也可以在角色详情里「替换头像」。</p>
            ${file ? `
                <div class="character-avatar-selected" data-character-create-avatar-selected>
                    <i class="fa-solid fa-image"></i>
                    <span>已选择：${escapeHtml(file.name || '头像图片')}</span>
                    <button class="secondary-button compact-button" type="button" data-clear-character-create-avatar>
                        <i class="fa-solid fa-xmark"></i>
                        移除
                    </button>
                </div>
            ` : ''}
            ${error ? `<span class="field-error" id="${errorId}">${escapeHtml(error)}</span>` : ''}
        </div>
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
        // 卡片里记录的世界书已不存在时仍保留选项，但标注「未找到」，提醒重新选择。
        const worldOptions = worldNames.map(name => {
            const label = getCharacterWorldStatus(name, state) === 'missing' ? `${name}（未找到）` : name;
            return `<option value="${escapeHtml(name)}" ${form.world === name ? 'selected' : ''}>${escapeHtml(label)}</option>`;
        }).join('');

        return `
        <label class="field-label">
            <span>关联世界书</span>
            <select class="select-input" data-character-field="world" data-character-scope="${scope}">
                <option value="">不关联</option>
                ${worldOptions}
            </select>
        </label>
    `;
    }

    return {
        renderCharacterFormContent,
        renderCharacterFormActions,
    };
}
