export function createGroupsRoute(ctx) {
    const {
        state,
        escapeHtml,
        formatBytes,
        formatDate,
        formatNumber,
        metricCard,
        pageHead,
        renderCharacterRow,
        renderEmptyState,
        renderGroupRow,
        renderInlineEmpty,
        matchesQuery,
        getChatEntityAvatarUrl,
        getCharacterByAvatar,
        defaultGroupForm,
        groupToForm,
    } = ctx;

    function renderGroups() {
        const groups = state.groups.filter(group => matchesQuery(group.name, group.id, ...(Array.isArray(group.members) ? group.members : [])));
        const selected = state.groups.find(group => group.id === state.selected.group) || groups[0];
        if (selected && state.selected.group !== selected.id) {
            state.selected.group = selected.id;
        }

        return `
        ${pageHead('群组管理', '群聊成员、生成策略和聊天文件归属。', `
            <button class="primary-button" type="button" data-create-group>
                <i class="fa-solid fa-plus"></i>
                新建群组
            </button>
        `)}
        <div class="split-grid">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">群组列表</h2>
                        <p class="panel-subtitle">${formatNumber(groups.length)} 个匹配项</p>
                    </div>
                </div>
                ${state.groupCreating.active ? renderGroupCreatePanel() : ''}
                <div class="resource-list">
                    ${groups.map(group => renderGroupRow(group)).join('') || renderInlineEmpty('暂无匹配群组')}
                </div>
            </section>
            <section class="panel">
                ${selected ? renderGroupDetail(selected) : renderEmptyState('fa-users', '暂无群组', '当前用户目录里没有群组。')}
            </section>
        </div>
    `;
    }

    function renderGroupDetail(group) {
        const avatar = getChatEntityAvatarUrl(group);
        const memberAvatars = Array.isArray(group.members) ? group.members : [];
        const members = memberAvatars.map(avatarId => getCharacterByAvatar(avatarId)).filter(Boolean);
        const missingMembers = memberAvatars.filter(avatarId => !getCharacterByAvatar(avatarId));
        const isEditing = state.groupEditing.id === group.id;
        const isDeleting = state.groupDeleteConfirm.id === group.id;

        return `
        <div class="detail-hero">
            ${avatar ? `<img class="avatar large" src="${escapeHtml(avatar)}" alt="">` : '<span class="avatar-fallback large"><i class="fa-solid fa-users"></i></span>'}
            <div>
                <h2 class="detail-title">${escapeHtml(group.name || group.id || '未命名群组')}</h2>
                <p class="panel-subtitle">${escapeHtml(group.id)} · ${formatNumber(memberAvatars.length)} 个成员 · ${formatNumber((group.chats || []).length)} 个会话</p>
                <div class="tag-row detail-tags">
                    <span class="tag">${group.allow_self_responses ? '允许自回复' : '禁止自回复'}</span>
                    <span class="tag">策略 ${formatNumber(group.activation_strategy ?? 0)}</span>
                    <span class="tag">模式 ${formatNumber(group.generation_mode ?? 0)}</span>
                    ${group.fav ? '<span class="tag">收藏</span>' : ''}
                </div>
            </div>
            <div class="detail-actions page-actions">
                <button class="secondary-button" type="button" data-route="chat" data-open-group-chat="${escapeHtml(group.id)}">
                    <i class="fa-solid fa-comments"></i>
                    打开聊天
                </button>
                <button class="secondary-button" type="button" data-edit-group="${escapeHtml(group.id)}" ${isEditing ? 'disabled' : ''}>
                    <i class="fa-solid fa-pen"></i>
                    编辑
                </button>
                <button class="secondary-button danger-action" type="button" data-delete-group="${escapeHtml(group.id)}">
                    <i class="fa-solid fa-trash"></i>
                    删除
                </button>
            </div>
        </div>
        ${isDeleting ? renderGroupDeletePanel(group) : ''}
        ${isEditing ? renderGroupEditPanel(group) : ''}
        <div class="metrics-grid compact-metrics">
            ${metricCard('成员', formatNumber(memberAvatars.length), `${formatNumber(missingMembers.length)} 个缺失`, 'fa-users')}
            ${metricCard('聊天文件', formatNumber((group.chats || []).length), formatBytes(group.chat_size), 'fa-message')}
            ${metricCard('最近聊天', group.date_last_chat ? formatDate(group.date_last_chat) : '暂无', '群组聊天记录', 'fa-clock')}
        </div>
        <section class="panel section-panel">
            <div class="panel-header compact-header">
                <div>
                    <h3 class="panel-title">成员</h3>
                    <p class="panel-subtitle">按群组成员顺序展示角色卡。</p>
                </div>
            </div>
            <div class="resource-list">
                ${members.map(character => renderCharacterRow(character)).join('')}
                ${missingMembers.map(avatarId => `
                    <div class="resource-row">
                        <span class="avatar-fallback"><i class="fa-solid fa-triangle-exclamation"></i></span>
                        <span class="row-main">
                            <span class="row-title">${escapeHtml(avatarId)}</span>
                            <span class="row-subtitle">角色卡缺失或未读取</span>
                        </span>
                    </div>
                `).join('')}
                ${memberAvatars.length ? '' : renderInlineEmpty('这个群组还没有成员')}
            </div>
        </section>
    `;
    }

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
                        <option value="0" ${String(form.activation_strategy) === '0' ? 'selected' : ''}>自然发言</option>
                        <option value="1" ${String(form.activation_strategy) === '1' ? 'selected' : ''}>列表顺序</option>
                        <option value="2" ${String(form.activation_strategy) === '2' ? 'selected' : ''}>随机</option>
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
                    <p class="panel-subtitle">已选择 ${formatNumber(selectedMembers.size)} 个角色。</p>
                </div>
                <div class="checkbox-grid">
                    ${memberOptions}
                </div>
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
        render: renderGroups,
    };
}
