export function createWorldbookEntryComponents(ctx) {
    const {
        state,
        worldEntryPositions,
        worldEntryRoleOptions,
        worldEntrySelectiveLogicOptions,
        escapeHtml,
        formatNumber,
        getWorldEntryTitle,
        createWorldEntry,
        worldEntryToForm,
    } = ctx;

    function renderWorldEntryBulkDeletePanel(selectedCount) {
        return `
        <div class="settings-form inline-form danger-panel">
            <div>
                <strong>批量删除条目</strong>
                <p class="panel-subtitle">将删除当前选中的 ${formatNumber(selectedCount)} 个世界书条目，此操作不可撤销。</p>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-world-entry-bulk-delete>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button danger-action" type="button" data-confirm-world-entry-bulk-delete>
                    <i class="fa-solid fa-trash"></i>
                    确认删除
                </button>
            </div>
        </div>
    `;
    }

    function renderWorldEntryCard(worldbook, entryKey, entry) {
        const isEditing = state.worldEntryEditing.worldbookId === worldbook.file_id && state.worldEntryEditing.entryKey === entryKey;
        const isDeleting = state.worldEntryDeleteConfirm.worldbookId === worldbook.file_id && state.worldEntryDeleteConfirm.entryKey === entryKey;
        const isSelected = state.worldEntryList.selectedKeys.includes(String(entryKey));
        const keywords = Array.isArray(entry.key) ? entry.key.filter(Boolean).join(', ') : entry.key || '无关键词';
        const content = String(entry.content || '').replace(/\s+/g, ' ').trim();
        const preview = content.length > 220 ? `${content.slice(0, 220)}...` : content;

        return `
        <article class="resource-card world-entry-card ${isSelected ? 'selected' : ''}">
            <div class="card-head">
                <label class="selection-row">
                    <input type="checkbox" data-world-entry-select="${escapeHtml(entryKey)}" ${isSelected ? 'checked' : ''}>
                    <span>${isSelected ? '已选择' : '选择'}</span>
                </label>
                <span class="${entry.disable ? 'danger' : 'success'}">
                    <i class="fa-solid ${entry.disable ? 'fa-circle-pause' : 'fa-circle-check'}"></i>
                    ${entry.disable ? '禁用' : '启用'}
                </span>
            </div>
            <div>
                <h3 class="card-title">${escapeHtml(getWorldEntryTitle(entry, entryKey))}</h3>
                <p class="row-subtitle">${escapeHtml(keywords)}</p>
            </div>
            ${preview ? `<p class="detail-text world-entry-preview">${escapeHtml(preview)}</p>` : ''}
            <div class="tag-row">
                <span class="tag">#${escapeHtml(entryKey)}</span>
                <span class="tag">顺序 ${escapeHtml(entry.order ?? 0)}</span>
                <span class="tag">位置 ${escapeHtml(entry.position ?? '默认')}</span>
                ${entry.probability !== undefined ? `<span class="tag">概率 ${escapeHtml(entry.probability)}</span>` : ''}
                ${entry.constant ? '<span class="tag">常驻</span>' : ''}
                ${entry.selective ? '<span class="tag">关键词触发</span>' : ''}
            </div>
            <div class="row-actions">
                <button class="secondary-button" type="button" data-edit-world-entry="${escapeHtml(worldbook.file_id)}" data-world-entry-key="${escapeHtml(entryKey)}" ${isEditing ? 'disabled' : ''}>
                    <i class="fa-solid fa-pen"></i>
                    编辑
                </button>
                <button class="secondary-button" type="button" data-toggle-world-entry="${escapeHtml(worldbook.file_id)}" data-world-entry-key="${escapeHtml(entryKey)}">
                    <i class="fa-solid ${entry.disable ? 'fa-toggle-off' : 'fa-toggle-on'}"></i>
                    ${entry.disable ? '启用' : '禁用'}
                </button>
                <button class="secondary-button" type="button" data-copy-world-entry="${escapeHtml(worldbook.file_id)}" data-world-entry-key="${escapeHtml(entryKey)}">
                    <i class="fa-solid fa-copy"></i>
                    复制
                </button>
                <button class="secondary-button" type="button" data-delete-world-entry="${escapeHtml(worldbook.file_id)}" data-world-entry-key="${escapeHtml(entryKey)}">
                    <i class="fa-solid fa-ellipsis"></i>
                    管理
                </button>
            </div>
            ${isEditing ? renderWorldEntryForm(entryKey, entry) : ''}
            ${isDeleting ? renderWorldEntryDeletePanel(entryKey, entry) : ''}
        </article>
    `;
    }

    function renderWorldEntryDeletePanel(entryKey, entry) {
        return `
        <div class="settings-form inline-form danger-panel">
            <div>
                <strong>删除条目</strong>
                <p class="panel-subtitle">将删除 ${escapeHtml(getWorldEntryTitle(entry, entryKey))}，操作不可撤销。</p>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-world-entry-delete>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button danger-action" type="button" data-confirm-world-entry-delete>
                    <i class="fa-solid fa-trash"></i>
                    确认删除
                </button>
            </div>
        </div>
    `;
    }

    function renderWorldEntryForm(entryKey, entry) {
        const edit = state.worldEntryEditing;
        const form = edit.form || worldEntryToForm(entry || createWorldEntry(Number(entryKey)));
        const isCreate = edit.mode === 'create';
        return renderWorldEntryFormContent(form, isCreate);
    }

    function renderWorldEntryCreatePanel(entryKey) {
        const form = state.worldEntryEditing.form || worldEntryToForm(createWorldEntry(Number(entryKey)));
        return `
        <div class="settings-form inline-form">
            <strong>新建条目</strong>
            ${renderWorldEntryFormContent(form, true)}
        </div>
    `;
    }

    function renderWorldEntryFormContent(form, isCreate) {
        return `
        <div class="world-entry-form">
            <div class="form-grid two-columns">
                <label class="field-label">
                    <span>主关键词</span>
                    <input class="text-input" type="text" data-world-entry-field="key" value="${escapeHtml(form.key)}" placeholder="用逗号分隔">
                </label>
                <label class="field-label">
                    <span>次级关键词</span>
                    <input class="text-input" type="text" data-world-entry-field="keysecondary" value="${escapeHtml(form.keysecondary)}" placeholder="用逗号分隔">
                </label>
                <label class="field-label">
                    <span>注释</span>
                    <input class="text-input" type="text" data-world-entry-field="comment" value="${escapeHtml(form.comment)}">
                </label>
                <label class="field-label">
                    <span>插入位置</span>
                    <select class="select-input" data-world-entry-field="position">
                        ${worldEntryPositions.map(position => `<option value="${position.value}" ${Number(form.position) === position.value ? 'selected' : ''}>${escapeHtml(position.label)}</option>`).join('')}
                    </select>
                </label>
                ${renderWorldEntryOptionSelect('selectiveLogic', '触发逻辑', form.selectiveLogic, worldEntrySelectiveLogicOptions)}
                ${renderWorldEntryOptionSelect('role', '按深度插入角色', form.role, worldEntryRoleOptions)}
                <label class="field-label">
                    <span>顺序</span>
                    <input class="text-input" type="number" data-world-entry-field="order" value="${escapeHtml(form.order)}">
                </label>
                <label class="field-label">
                    <span>深度</span>
                    <input class="text-input" type="number" data-world-entry-field="depth" value="${escapeHtml(form.depth)}">
                </label>
                <label class="field-label">
                    <span>扫描深度</span>
                    <input class="text-input" type="number" data-world-entry-field="scanDepth" value="${escapeHtml(form.scanDepth)}" placeholder="留空继承全局">
                </label>
                <label class="field-label">
                    <span>概率</span>
                    <input class="text-input" type="number" min="0" max="100" data-world-entry-field="probability" value="${escapeHtml(form.probability)}">
                </label>
            </div>
            <label class="field-label">
                <span>内容</span>
                <textarea data-world-entry-field="content">${escapeHtml(form.content)}</textarea>
            </label>
            <div class="checkbox-grid">
                ${renderWorldEntryCheckbox('constant', '常驻', form.constant)}
                ${renderWorldEntryCheckbox('vectorized', '向量化', form.vectorized)}
                ${renderWorldEntryCheckbox('selective', '使用关键词触发', form.selective)}
                ${renderWorldEntryCheckbox('addMemo', '显示备注字段', form.addMemo)}
                ${renderWorldEntryCheckbox('useProbability', '使用概率', form.useProbability)}
                ${renderWorldEntryCheckbox('disable', '禁用', form.disable)}
                ${renderWorldEntryCheckbox('ignoreBudget', '忽略预算', form.ignoreBudget)}
                ${renderWorldEntryCheckbox('excludeRecursion', '不递归扫描', form.excludeRecursion)}
                ${renderWorldEntryCheckbox('preventRecursion', '阻止递归', form.preventRecursion)}
            </div>
            <div class="form-grid two-columns">
                ${renderWorldEntryNullableBooleanSelect('caseSensitive', '大小写敏感', form.caseSensitive)}
                ${renderWorldEntryNullableBooleanSelect('matchWholeWords', '整词匹配', form.matchWholeWords)}
                ${renderWorldEntryNullableBooleanSelect('useGroupScoring', '使用分组评分', form.useGroupScoring)}
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-world-entry-edit>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="primary-button" type="button" data-save-world-entry-edit>
                    <i class="fa-solid fa-check"></i>
                    ${isCreate ? '创建条目' : '保存条目'}
                </button>
            </div>
        </div>
    `;
    }

    function renderWorldEntryOptionSelect(field, label, value, options) {
        const selected = String(value ?? '');
        const optionHtml = options.map(option => {
            const optionValue = String(option.value);
            return `<option value="${escapeHtml(optionValue)}" ${selected === optionValue ? 'selected' : ''}>${escapeHtml(option.label)}</option>`;
        }).join('');

        return `
        <label class="field-label">
            <span>${escapeHtml(label)}</span>
            <select class="select-input" data-world-entry-field="${escapeHtml(field)}">
                ${optionHtml}
            </select>
        </label>
    `;
    }

    function renderWorldEntryNullableBooleanSelect(field, label, value) {
        return renderWorldEntryOptionSelect(field, label, value, [
            { value: '', label: '继承全局' },
            { value: 'true', label: '是' },
            { value: 'false', label: '否' },
        ]);
    }

    function renderWorldEntryCheckbox(field, label, checked) {
        return `
        <label class="checkbox-card">
            <input type="checkbox" data-world-entry-field="${escapeHtml(field)}" ${checked ? 'checked' : ''}>
            <span>${escapeHtml(label)}</span>
        </label>
    `;
    }

    return {
        renderWorldEntryBulkDeletePanel,
        renderWorldEntryCard,
        renderWorldEntryCreatePanel,
    };
}
