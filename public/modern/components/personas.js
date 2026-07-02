export function createPersonasComponents(ctx) {
    const {
        state,
        escapeHtml,
        getPersonaUrl,
        pageHead,
        renderEmptyState,
        matchesQuery,
        getPersonas,
    } = ctx;

    function renderPersonas() {
        const selectedPersonaId = state.selected.persona;
        const personas = getPersonas()
            .filter(persona => matchesQuery(persona.name, persona.title, persona.description, persona.avatarId))
            .sort((a, b) => Number(b.avatarId === selectedPersonaId) - Number(a.avatarId === selectedPersonaId));

        return `
        ${pageHead('用户人设', '头像、标题和默认身份。', `
            <button class="primary-button" type="button" data-create-persona>
                <i class="fa-solid fa-plus"></i>
                新建人设
            </button>
        `)}
        ${state.personaCreating.active ? renderPersonaCreatePanel() : ''}
        <div class="grid-list">
            ${personas.map(persona => `
                <article class="resource-card persona-card ${persona.avatarId === selectedPersonaId ? 'selected' : ''}" data-persona-card="${escapeHtml(persona.avatarId)}">
                    <div class="detail-hero compact-hero">
                        <img class="avatar large" src="${getPersonaUrl(persona.avatarId)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'), { className: 'avatar-fallback large', textContent: 'P' }))">
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
                    ${state.personaEditing.avatarId === persona.avatarId ? renderPersonaEditPanel(persona) : ''}
                    ${state.personaDeleteConfirm.avatarId === persona.avatarId ? renderPersonaDeletePanel(persona) : ''}
                </article>
            `).join('') || renderEmptyState('fa-user-gear', '暂无用户人设', '当前目录没有用户人设。')}
        </div>
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

    function renderPersonaEditPanel(persona) {
        const form = state.personaEditing.form;
        const formValue = {
            name: form.name || persona.name,
            title: form.title || '',
            description: form.description || '',
        };

        return `
        <div class="settings-form">
            ${renderPersonaFormContent(formValue, 'edit')}
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
        return `
        <div class="form-grid">
            <label class="field-label">
                <span>名称</span>
                <input class="text-input" type="text" data-persona-field="name" data-persona-scope="${escapeHtml(scope)}" value="${escapeHtml(form.name || '')}">
            </label>
            <label class="field-label">
                <span>标题</span>
                <input class="text-input" type="text" data-persona-field="title" data-persona-scope="${escapeHtml(scope)}" value="${escapeHtml(form.title || '')}">
            </label>
            <label class="field-label">
                <span>描述</span>
                <textarea data-persona-field="description" data-persona-scope="${escapeHtml(scope)}">${escapeHtml(form.description || '')}</textarea>
            </label>
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
        renderPersonas,
    };
}
