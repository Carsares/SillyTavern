export function createWorldbookEntryFormComponents(ctx) {
    const {
        state,
        worldEntryPositions,
        worldEntryRoleOptions,
        worldEntrySelectiveLogicOptions,
        escapeHtml,
        createWorldEntry,
        worldEntryToForm,
    } = ctx;

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
        renderWorldEntryForm,
        renderWorldEntryCreatePanel,
    };
}
