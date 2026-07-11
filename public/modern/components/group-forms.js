export function createGroupFormComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatNumber,
        renderInlineEmpty,
        defaultGroupForm,
        groupToForm,
    } = ctx;

    function renderGroupCreatePanel() {
        return `
        <div class="settings-form inline-form">
            <strong>新建群组</strong>
            ${renderGroupFormContent(state.groupCreating.form || defaultGroupForm(), 'create', true)}
        </div>
    `;
    }

    function renderGroupEditPanel(group) {
        return `
        <div class="settings-form inline-form">
            <strong>编辑群组</strong>
            ${renderGroupFormContent(state.groupEditing.form || groupToForm(group), 'edit', false)}
        </div>
    `;
    }

    function renderGroupDeletePanel(group) {
        return `
        <div class="settings-form inline-form danger-panel">
            <div>
                <strong>删除群组</strong>
                <p class="panel-subtitle">将删除 ${escapeHtml(state.groupDeleteConfirm.name || group.name || group.id)}，并删除这个群组下的聊天文件。</p>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-group-delete>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button danger-action" type="button" data-confirm-group-delete>
                    <i class="fa-solid fa-trash"></i>
                    确认删除
                </button>
            </div>
        </div>
    `;
    }

    function renderGroupFormContent(form, scope, isCreate) {
        const scopeAttribute = escapeHtml(scope);
        const selectedMembers = new Set(Array.isArray(form.members) ? form.members : []);
        const memberOptions = state.characters.map(character => {
            const avatar = character.avatar || '';
            const title = character.name || character.data?.name || avatar;
            return `
            <label class="checkbox-card">
                <input type="checkbox" data-group-member="${escapeHtml(avatar)}" data-group-scope="${scopeAttribute}" ${selectedMembers.has(avatar) ? 'checked' : ''}>
                <span>${escapeHtml(title)}</span>
            </label>
        `;
        }).join('') || renderInlineEmpty('暂无角色，先导入或创建角色卡。');

        // Ordered view of selected members: drives the "列表顺序" strategy and exposes per-member enable/disable
        const orderedMembers = Array.isArray(form.members) ? form.members : [];
        const disabledMembers = new Set(Array.isArray(form.disabled_members) ? form.disabled_members : []);
        const memberOrderRows = orderedMembers.map((avatar, index) => {
            const character = state.characters.find(item => (item.avatar || '') === avatar);
            const title = character?.name || character?.data?.name || avatar;
            const isDisabled = disabledMembers.has(avatar);
            return `
            <li class="group-member-row${isDisabled ? ' is-disabled' : ''}">
                <span class="group-member-order">${formatNumber(index + 1)}</span>
                <span class="group-member-name">${escapeHtml(title)}${isDisabled ? '（已禁用）' : ''}</span>
                <div class="group-member-controls">
                    <button class="secondary-button compact-button" type="button" data-group-member-move="up" data-group-member-avatar="${escapeHtml(avatar)}" data-group-scope="${scopeAttribute}" ${index === 0 ? 'disabled' : ''} title="上移" aria-label="上移">
                        <i class="fa-solid fa-arrow-up"></i>
                    </button>
                    <button class="secondary-button compact-button" type="button" data-group-member-move="down" data-group-member-avatar="${escapeHtml(avatar)}" data-group-scope="${scopeAttribute}" ${index === orderedMembers.length - 1 ? 'disabled' : ''} title="下移" aria-label="下移">
                        <i class="fa-solid fa-arrow-down"></i>
                    </button>
                    <button class="secondary-button compact-button" type="button" data-group-member-toggle-enabled="${escapeHtml(avatar)}" data-group-scope="${scopeAttribute}" title="${isDisabled ? '启用成员' : '禁用成员'}" aria-label="${isDisabled ? '启用成员' : '禁用成员'}">
                        <i class="fa-solid ${isDisabled ? 'fa-toggle-off' : 'fa-toggle-on'}"></i>
                    </button>
                </div>
            </li>`;
        }).join('');

        return `
        <div class="character-form">
            <div class="form-grid two-columns">
                <label class="field-label">
                    <span>名称</span>
                    <input class="text-input" type="text" data-group-field="name" data-group-scope="${scopeAttribute}" value="${escapeHtml(form.name || '')}" placeholder="留空时使用默认群组名">
                </label>
                <label class="field-label">
                    <span>头像 URL</span>
                    <input class="text-input" type="url" data-group-field="avatar_url" data-group-scope="${scopeAttribute}" value="${escapeHtml(form.avatar_url || '')}" placeholder="可选">
                </label>
                <label class="field-label">
                    <span>激活策略</span>
                    <select class="select-input" data-group-field="activation_strategy" data-group-scope="${scopeAttribute}">
                        <option value="0" ${String(form.activation_strategy) === '0' ? 'selected' : ''}>自然顺序</option>
                        <option value="1" ${String(form.activation_strategy) === '1' ? 'selected' : ''}>列表顺序</option>
                        <option value="2" ${String(form.activation_strategy) === '2' ? 'selected' : ''}>手动</option>
                        <option value="3" ${String(form.activation_strategy) === '3' ? 'selected' : ''}>随机轮流顺序</option>
                    </select>
                </label>
                <label class="field-label">
                    <span>生成模式</span>
                    <select class="select-input" data-group-field="generation_mode" data-group-scope="${scopeAttribute}">
                        <option value="0" ${String(form.generation_mode) === '0' ? 'selected' : ''}>交换</option>
                        <option value="1" ${String(form.generation_mode) === '1' ? 'selected' : ''}>加入前缀</option>
                    </select>
                </label>
                <label class="field-label">
                    <span>自动模式延迟</span>
                    <input class="text-input" type="number" min="0" step="1" data-group-field="auto_mode_delay" data-group-scope="${scopeAttribute}" value="${escapeHtml(form.auto_mode_delay || '5')}">
                </label>
                <label class="checkbox-card compact-checkbox">
                    <input type="checkbox" data-group-field="allow_self_responses" data-group-scope="${scopeAttribute}" ${form.allow_self_responses ? 'checked' : ''}>
                    <span>允许角色连续回复</span>
                </label>
                <label class="checkbox-card compact-checkbox">
                    <input type="checkbox" data-group-field="fav" data-group-scope="${scopeAttribute}" ${form.fav ? 'checked' : ''}>
                    <span>收藏群组</span>
                </label>
            </div>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">成员</h3>
                    <p class="panel-subtitle">勾选加入群组的角色；下方可调整发言顺序（用于"列表顺序"策略）并临时禁用成员。已选择 ${formatNumber(selectedMembers.size)} 个角色。</p>
                </div>
                <div class="checkbox-grid">
                    ${memberOptions}
                </div>
                ${orderedMembers.length ? `
                <div class="group-member-order-section">
                    <h4 class="form-subsection-title">成员顺序与状态</h4>
                    <ol class="group-member-order-list">
                        ${memberOrderRows}
                    </ol>
                </div>
                ` : ''}
            </section>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" ${isCreate ? 'data-cancel-group-create' : 'data-cancel-group-edit'}>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="primary-button" type="button" ${isCreate ? 'data-save-group-create' : 'data-save-group-edit'}>
                    <i class="fa-solid fa-check"></i>
                    ${isCreate ? '创建群组' : '保存群组'}
                </button>
            </div>
        </div>
    `;
    }

    return {
        renderGroupCreatePanel,
        renderGroupEditPanel,
        renderGroupDeletePanel,
    };
}
