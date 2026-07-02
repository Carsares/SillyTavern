export function createCharactersComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatBytes,
        formatDate,
        formatNumber,
        uniqueValues,
        pageHead,
        renderCharacterRow,
        renderEmptyState,
        renderInlineEmpty,
        renderKeyValue,
        matchesQuery,
        getCharacterAvatarUrl,
        getCharacterTags,
        characterToForm,
    } = ctx;

    function renderCharacters() {
        const characters = state.characters.filter(character => matchesQuery(character.name, character.avatar, character.data?.creator, character.data?.tags?.join(' ')));
        const selected = state.characters.find(character => character.avatar === state.selected.character) || characters[0];
        if (selected && state.selected.character !== selected.avatar) {
            state.selected.character = selected.avatar;
        }

        return `
        ${pageHead('角色库', '角色卡、来源、世界书和聊天占用。', `
            <button class="primary-button" type="button" data-create-character>
                <i class="fa-solid fa-plus"></i>
                新建角色
            </button>
            <label class="secondary-button file-action">
                <i class="fa-solid fa-upload"></i>
                导入文件
                <input class="visually-hidden" type="file" accept=".png,.json,.yaml,.yml,.charx,.byaf" data-character-import-file>
            </label>
        `)}
        <div class="split-grid">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">角色列表</h2>
                        <p class="panel-subtitle">${formatNumber(characters.length)} 个匹配项</p>
                    </div>
                </div>
                ${state.characterCreating.active ? renderCharacterCreatePanel() : ''}
                <div class="resource-list">
                    ${characters.map(character => renderCharacterRow(character)).join('') || renderInlineEmpty('暂无匹配角色')}
                </div>
            </section>
            <section class="panel">
                ${selected ? renderCharacterDetail(selected) : renderEmptyState('fa-address-card', '暂无角色', '当前用户目录里没有角色卡。')}
            </section>
        </div>
    `;
    }

    function renderCharacterDetail(character) {
        const detail = state.characterDetails[character.avatar] || character;
        const avatar = getCharacterAvatarUrl(detail);
        const name = detail.name || detail.data?.name || '未命名角色';
        const tags = getCharacterTags(detail);
        const isEditing = state.characterEditing.avatar === character.avatar;
        const isRenaming = state.characterRenaming.avatar === character.avatar;
        const isDeleting = state.characterDeleteConfirm.avatar === character.avatar;

        return `
        <div class="detail-hero character-detail-hero">
            ${avatar ? `<img class="avatar large" src="${avatar}" alt="">` : '<span class="avatar-fallback large">C</span>'}
            <div>
                <h2 class="detail-title">${escapeHtml(name)}</h2>
                <p class="panel-subtitle">${escapeHtml(detail.avatar || character.avatar || '角色卡')}</p>
                <div class="tag-row detail-tags">
                    ${tags.slice(0, 8).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('') || '<span class="tag">未打标签</span>'}
                </div>
            </div>
            <div class="detail-actions page-actions">
                <button class="secondary-button" type="button" data-load-character-detail="${escapeHtml(character.avatar)}">
                    <i class="fa-solid fa-database"></i>
                    读取完整卡
                </button>
                <button class="secondary-button" type="button" data-edit-character="${escapeHtml(character.avatar)}" ${isEditing ? 'disabled' : ''}>
                    <i class="fa-solid fa-pen"></i>
                    编辑
                </button>
                <button class="secondary-button" type="button" data-duplicate-character="${escapeHtml(character.avatar)}">
                    <i class="fa-solid fa-copy"></i>
                    复制
                </button>
                <button class="secondary-button" type="button" data-rename-character="${escapeHtml(character.avatar)}">
                    <i class="fa-solid fa-i-cursor"></i>
                    重命名
                </button>
                <label class="secondary-button file-action">
                    <i class="fa-solid fa-image"></i>
                    替换头像
                    <input class="visually-hidden" type="file" accept="image/*" data-character-avatar-file="${escapeHtml(character.avatar)}">
                </label>
                <button class="secondary-button" type="button" data-export-character="${escapeHtml(character.avatar)}" data-character-export-format="png">
                    <i class="fa-solid fa-image"></i>
                    PNG
                </button>
                <button class="secondary-button" type="button" data-export-character="${escapeHtml(character.avatar)}" data-character-export-format="json">
                    <i class="fa-solid fa-file-code"></i>
                    JSON
                </button>
                <button class="secondary-button" type="button" data-delete-character="${escapeHtml(character.avatar)}">
                    <i class="fa-solid fa-ellipsis"></i>
                    管理
                </button>
            </div>
        </div>
        ${isRenaming ? renderCharacterRenamePanel(detail) : ''}
        ${isDeleting ? renderCharacterDeletePanel(detail) : ''}
        ${isEditing ? renderCharacterEditPanel(detail) : ''}
        <div class="character-meta-grid">
            ${renderKeyValue('创建时间', formatDate(detail.create_date || detail.date_added))}
            ${renderKeyValue('最近聊天', formatDate(detail.date_last_chat))}
            ${renderKeyValue('聊天占用', formatBytes(detail.chat_size))}
            ${renderKeyValue('卡片大小', formatBytes(detail.data_size))}
            ${renderKeyValue('作者', detail.data?.creator || '未知')}
            ${renderKeyValue('关联世界书', detail.data?.extensions?.world || '未关联')}
        </div>
        <p class="detail-text">${escapeHtml(detail.description || detail.data?.description || detail.data?.creator_notes || '当前列表接口未返回完整角色描述。')}</p>
    `;
    }

    function renderCharacterCreatePanel() {
        return `
        <div class="settings-form inline-form">
            <strong>新建角色</strong>
            ${renderCharacterFormContent(state.characterCreating.form, 'create', true)}
        </div>
    `;
    }

    function renderCharacterEditPanel(character) {
        return `
        <div class="settings-form inline-form">
            <strong>编辑角色卡</strong>
            ${renderCharacterFormContent(state.characterEditing.form || characterToForm(character), 'edit', false)}
        </div>
    `;
    }

    function renderCharacterRenamePanel(character) {
        return `
        <div class="settings-form inline-form">
            <div class="form-grid two-columns">
                <label class="field-label">
                    <span>新名称</span>
                    <input class="text-input" type="text" data-character-rename-input value="${escapeHtml(state.characterRenaming.name)}">
                </label>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-character-rename>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="primary-button" type="button" data-confirm-character-rename>
                    <i class="fa-solid fa-check"></i>
                    保存重命名
                </button>
            </div>
            <p class="panel-subtitle">将同步更新卡片名称、PNG 文件名和对应聊天目录：${escapeHtml(character.avatar || '')}</p>
        </div>
    `;
    }

    function renderCharacterDeletePanel(character) {
        return `
        <div class="settings-form inline-form danger-panel">
            <div>
                <strong>删除角色</strong>
                <p class="panel-subtitle">将删除 ${escapeHtml(state.characterDeleteConfirm.name || character.avatar)} 的角色卡文件。</p>
            </div>
            <label class="checkbox-card compact-checkbox">
                <input type="checkbox" data-character-delete-chats ${state.characterDeleteConfirm.deleteChats ? 'checked' : ''}>
                <span>同时删除聊天记录目录</span>
            </label>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-character-delete>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button danger-action" type="button" data-confirm-character-delete>
                    <i class="fa-solid fa-trash"></i>
                    确认删除
                </button>
            </div>
        </div>
    `;
    }

    function renderCharacterFormContent(form, scope, isCreate) {
        const scopeAttribute = escapeHtml(scope);

        return `
        <div class="character-form">
            <div class="form-grid two-columns">
                ${renderCharacterInput('name', '名称', form.name, scopeAttribute)}
                ${renderCharacterInput('creator', '作者', form.creator, scopeAttribute)}
                ${renderCharacterInput('character_version', '版本', form.character_version, scopeAttribute)}
                ${renderCharacterInput('tags', '标签', form.tags, scopeAttribute, '用逗号分隔')}
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

    function renderCharacterInput(field, label, value, scope, placeholder = '') {
        return `
        <label class="field-label">
            <span>${escapeHtml(label)}</span>
            <input class="text-input" type="text" data-character-field="${escapeHtml(field)}" data-character-scope="${scope}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">
        </label>
    `;
    }

    function renderCharacterNumberInput(field, label, value, scope, min, max, step) {
        return `
        <label class="field-label">
            <span>${escapeHtml(label)}</span>
            <input class="text-input" type="number" min="${escapeHtml(min)}" max="${escapeHtml(max)}" step="${escapeHtml(step)}" data-character-field="${escapeHtml(field)}" data-character-scope="${scope}" value="${escapeHtml(value)}">
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
        renderCharacters,
    };
}
