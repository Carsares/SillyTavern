export function createPersonaCardComponents(ctx) {
    const {
        state,
        escapeHtml,
        getPersonaUrl,
    } = ctx;

    function renderPersonaCard(persona, selectedPersonaId) {
        const cacheBust = state.avatarCacheBust[persona.avatarId];
        const avatarUrl = `${getPersonaUrl(persona.avatarId)}${cacheBust ? `?v=${encodeURIComponent(cacheBust)}` : ''}`;
        return `
        <article class="resource-card persona-card ${persona.avatarId === selectedPersonaId ? 'selected' : ''}" data-persona-card="${escapeHtml(persona.avatarId)}">
            <div class="detail-hero compact-hero">
                <img class="avatar large" src="${avatarUrl}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'), { className: 'avatar-fallback large', textContent: 'P' }))">
                <div>
                    <h2 class="card-title">${escapeHtml(persona.name || '未命名人设')}</h2>
                    <div class="card-meta">${escapeHtml(persona.title || persona.avatarId)}</div>
                    ${persona.default ? '<span class="tag">默认</span>' : ''}
                </div>
            </div>
            <p class="detail-text">${escapeHtml(persona.description || '暂无描述')}</p>
            <div class="row-actions">
                <button class="secondary-button" type="button" data-edit-persona="${escapeHtml(persona.avatarId)}">
                    <i class="fa-solid fa-pen"></i>
                    编辑
                </button>
                <button class="secondary-button" type="button" data-set-default-persona="${escapeHtml(persona.avatarId)}" ${persona.default ? 'disabled' : ''}>
                    <i class="fa-solid fa-user-check"></i>
                    设为默认
                </button>
                <label class="secondary-button file-action">
                    <i class="fa-solid fa-image"></i>
                    替换头像
                    <input class="visually-hidden" type="file" accept="image/*" data-persona-avatar-file="${escapeHtml(persona.avatarId)}">
                </label>
                <button class="secondary-button" type="button" data-delete-persona="${escapeHtml(persona.avatarId)}">
                    <i class="fa-solid fa-ellipsis"></i>
                    管理
                </button>
            </div>
            ${state.personaEditing.avatarId === persona.avatarId ? renderPersonaEditPanel() : ''}
            ${state.personaDeleteConfirm.avatarId === persona.avatarId ? renderPersonaDeletePanel(persona) : ''}
        </article>
    `;
    }

    function renderPersonaCreatePanel() {
        return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">新建用户人设</h2>
                    <p class="panel-subtitle">上传头像后写入 personas 设置。</p>
                </div>
            </div>
            <div class="settings-form inline-form">
                ${renderPersonaFormContent(state.personaCreating.form, 'create')}
                <label class="field-label">
                    <span>头像图片</span>
                    <input class="text-input" type="file" accept="image/*" data-persona-create-file>
                    ${state.personaCreating.file ? `<span class="card-meta">${escapeHtml(state.personaCreating.file.name)}</span>` : ''}
                </label>
                <div class="message-edit-actions">
                    <button class="secondary-button" type="button" data-cancel-persona-create>
                        <i class="fa-solid fa-xmark"></i>
                        取消
                    </button>
                    <button class="primary-button" type="button" data-save-persona-create>
                        <i class="fa-solid fa-check"></i>
                        创建人设
                    </button>
                </div>
            </div>
        </section>
    `;
    }

    function renderPersonaEditPanel() {
        // Pass the editing form straight through (like the create panel) so every persisted
        // descriptor field — position/depth/role/lorebook/connections — is reflected when editing
        return `
        <div class="settings-form">
            ${renderPersonaFormContent(state.personaEditing.form, 'edit')}
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-persona-edit>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="primary-button" type="button" data-save-persona-edit>
                    <i class="fa-solid fa-check"></i>
                    保存
                </button>
            </div>
        </div>
    `;
    }

    function renderPersonaFormContent(form, scope) {
        const scopeAttr = escapeHtml(scope);
        const position = Number.isFinite(Number(form.position)) ? Number(form.position) : 0;
        const positionOptions = [
            { value: 0, label: '嵌入提示词（In-Prompt）' },
            { value: 2, label: '作者注释顶部' },
            { value: 3, label: '作者注释底部' },
            { value: 4, label: '按深度插入' },
            { value: 9, label: '不注入' },
        ].map(option => `<option value="${option.value}" ${position === option.value ? 'selected' : ''}>${option.label}</option>`).join('');
        const role = Number.isFinite(Number(form.role)) ? Number(form.role) : 0;
        const roleOptions = [
            { value: 0, label: 'System' },
            { value: 1, label: 'User' },
            { value: 2, label: 'Assistant' },
        ].map(option => `<option value="${option.value}" ${role === option.value ? 'selected' : ''}>${option.label}</option>`).join('');
        const lorebookOptions = ['<option value="">（无）</option>']
            .concat(state.worldbooks.map(worldbook => {
                const id = worldbook.file_id;
                return `<option value="${escapeHtml(id)}" ${form.lorebook === id ? 'selected' : ''}>${escapeHtml(worldbook.name || id)}</option>`;
            })).join('');
        const connections = Array.isArray(form.connections) ? form.connections : [];
        return `
        <div class="form-grid">
            <label class="field-label">
                <span>名称</span>
                <input class="text-input" type="text" data-persona-field="name" data-persona-scope="${scopeAttr}" value="${escapeHtml(form.name || '')}">
            </label>
            <label class="field-label">
                <span>标题</span>
                <input class="text-input" type="text" data-persona-field="title" data-persona-scope="${scopeAttr}" value="${escapeHtml(form.title || '')}">
            </label>
            <label class="field-label">
                <span>描述</span>
                <textarea data-persona-field="description" data-persona-scope="${scopeAttr}">${escapeHtml(form.description || '')}</textarea>
            </label>
            <label class="field-label">
                <span>描述注入位置</span>
                <select class="select-input" data-persona-field="position" data-persona-scope="${scopeAttr}">${positionOptions}</select>
            </label>
            <div class="form-grid two-columns">
                <label class="field-label">
                    <span>插入深度（按深度插入时生效）</span>
                    <input class="text-input" type="number" min="0" step="1" data-persona-field="depth" data-persona-scope="${scopeAttr}" value="${escapeHtml(String(form.depth ?? 2))}">
                </label>
                <label class="field-label">
                    <span>插入角色</span>
                    <select class="select-input" data-persona-field="role" data-persona-scope="${scopeAttr}">${roleOptions}</select>
                </label>
            </div>
            <label class="field-label">
                <span>关联世界书</span>
                <select class="select-input" data-persona-field="lorebook" data-persona-scope="${scopeAttr}">${lorebookOptions}</select>
            </label>
            ${scope === 'edit' && connections.length ? `
            <div class="field-label">
                <span>角色连接（只读）</span>
                <p class="panel-subtitle">已连接 ${connections.length} 个角色/群组，切换到该人设时自动生效；连接的增删请在角色或群组页操作。</p>
            </div>
            ` : ''}
        </div>
    `;
    }

    function renderPersonaDeletePanel(persona) {
        return `
        <div class="settings-form inline-form danger-panel">
            <div>
                <strong>删除用户人设</strong>
                <p class="panel-subtitle">将删除 ${escapeHtml(persona.name || persona.avatarId)} 的设置和头像文件。</p>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-persona-delete>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button danger-action" type="button" data-confirm-persona-delete>
                    <i class="fa-solid fa-trash"></i>
                    确认删除
                </button>
            </div>
        </div>
    `;
    }

    return {
        renderPersonaCard,
        renderPersonaCreatePanel,
    };
}
