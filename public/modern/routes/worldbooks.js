export function createWorldbooksRoute(ctx) {
    const {
        state,
        worldEntryPageSize,
        worldEntryPositions,
        worldEntryRoleOptions,
        worldEntrySelectiveLogicOptions,
        escapeHtml,
        formatNumber,
        metricCard,
        pageHead,
        renderEmptyState,
        renderInlineEmpty,
        matchesQuery,
        isGlobalWorldEnabled,
        getWorldEntryListState,
        getVisibleWorldEntries,
        getWorldEntryTitle,
        createWorldEntry,
        worldEntryToForm,
    } = ctx;

    function renderWorldbooks() {
        const namesFromSettings = (state.settingsBundle.world_names || []).map(name => ({ file_id: name, name }));
        const worldbooks = (state.worldbooks.length ? state.worldbooks : namesFromSettings)
            .filter(worldbook => matchesQuery(worldbook.name, worldbook.file_id));
        const selected = worldbooks.find(worldbook => worldbook.file_id === state.selected.worldbook) || worldbooks[0];
        if (selected && state.selected.worldbook !== selected.file_id) {
            state.selected.worldbook = selected.file_id;
        }

        return `
        ${pageHead('世界书', '知识库文件、条目和启用状态。', `
            <button class="primary-button" type="button" data-create-worldbook>
                <i class="fa-solid fa-plus"></i>
                新建世界书
            </button>
            <label class="secondary-button file-action">
                <i class="fa-solid fa-file-import"></i>
                导入 JSON
                <input class="visually-hidden" type="file" accept=".json,application/json" data-worldbook-import-file>
            </label>
        `)}
        <div class="split-grid">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">世界书列表</h2>
                        <p class="panel-subtitle">${formatNumber(worldbooks.length)} 个匹配项</p>
                    </div>
                </div>
                ${state.worldbookCreating.active ? renderWorldbookCreatePanel() : ''}
                <div class="resource-list">
                    ${worldbooks.map(worldbook => renderWorldbookRow(worldbook)).join('') || renderInlineEmpty('暂无世界书')}
                </div>
            </section>
            <section class="panel">
                ${selected ? renderWorldbookDetail(selected) : renderEmptyState('fa-book-open', '暂无世界书', '当前用户目录里没有世界书。')}
            </section>
        </div>
    `;
    }

    function renderWorldbookCreatePanel() {
        return `
        <div class="settings-form inline-form">
            <label class="field-label">
                <span>世界书名称</span>
                <input class="text-input" type="text" data-worldbook-create-name value="${escapeHtml(state.worldbookCreating.name)}" placeholder="例如：角色设定集">
            </label>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-worldbook-create>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="primary-button" type="button" data-save-worldbook-create>
                    <i class="fa-solid fa-check"></i>
                    创建
                </button>
            </div>
        </div>
    `;
    }

    function renderWorldbookRow(worldbook) {
        const globalEnabled = isGlobalWorldEnabled(worldbook.file_id);

        return `
        <button class="resource-row ${state.selected.worldbook === worldbook.file_id ? 'active' : ''}" type="button" data-select-worldbook="${escapeHtml(worldbook.file_id)}">
            <span class="avatar-fallback"><i class="fa-solid fa-book-open"></i></span>
            <span class="row-main">
                <span class="row-title">${escapeHtml(worldbook.name || worldbook.file_id)}</span>
                <span class="row-subtitle">${escapeHtml(worldbook.file_id)}</span>
            </span>
            <span class="badge ${globalEnabled ? '' : 'danger'}">${globalEnabled ? '全局启用' : '未启用'}</span>
        </button>
    `;
    }

    function renderWorldbookDetail(worldbook) {
        const detail = state.worldDetails[worldbook.file_id];
        const entries = detail?.entries ? Object.entries(detail.entries) : [];
        const listState = getWorldEntryListState(worldbook.file_id);
        const visibleEntries = getVisibleWorldEntries(entries, listState);
        const totalPages = Math.max(1, Math.ceil(visibleEntries.length / worldEntryPageSize));
        listState.page = Math.min(Math.max(1, listState.page), totalPages);
        const pageEntries = visibleEntries.slice((listState.page - 1) * worldEntryPageSize, listState.page * worldEntryPageSize);
        const selectedCount = listState.selectedKeys.length;
        const enabledEntries = entries.filter(([, entry]) => !entry.disable);
        const globalEnabled = isGlobalWorldEnabled(worldbook.file_id);
        const isDeleting = state.worldbookDeleteConfirm.worldbookId === worldbook.file_id;
        const isCreatingEntry = state.worldEntryEditing.worldbookId === worldbook.file_id && state.worldEntryEditing.mode === 'create';

        return `
        <div class="panel-header">
            <div>
                <h2 class="panel-title">${escapeHtml(worldbook.name || worldbook.file_id)}</h2>
                <p class="panel-subtitle">${escapeHtml(worldbook.file_id)}.json</p>
            </div>
            <div class="page-actions">
                <button class="secondary-button" type="button" data-toggle-world-global="${escapeHtml(worldbook.file_id)}">
                    <i class="fa-solid ${globalEnabled ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
                    ${globalEnabled ? '停用全局' : '启用全局'}
                </button>
                <button class="secondary-button" type="button" data-load-worldbook="${escapeHtml(worldbook.file_id)}">
                    <i class="fa-solid ${detail ? 'fa-rotate' : 'fa-database'}"></i>
                    ${detail ? '刷新条目' : '读取条目'}
                </button>
                ${detail ? `
                    <button class="secondary-button" type="button" data-export-worldbook="${escapeHtml(worldbook.file_id)}">
                        <i class="fa-solid fa-file-export"></i>
                        导出 JSON
                    </button>
                    <button class="secondary-button" type="button" data-create-world-entry="${escapeHtml(worldbook.file_id)}">
                        <i class="fa-solid fa-plus"></i>
                        新条目
                    </button>
                ` : ''}
                <button class="secondary-button danger-action" type="button" data-delete-worldbook="${escapeHtml(worldbook.file_id)}">
                    <i class="fa-solid fa-trash"></i>
                    删除
                </button>
            </div>
        </div>
        ${isDeleting ? renderWorldbookDeletePanel(worldbook) : ''}
        ${detail ? `
            <div class="metrics-grid compact-metrics">
                ${metricCard('条目', formatNumber(entries.length), '全部 entries', 'fa-list')}
                ${metricCard('启用', formatNumber(enabledEntries.length), '未禁用条目', 'fa-toggle-on')}
                ${metricCard('扩展字段', formatNumber(Object.keys(detail.extensions || {}).length), 'metadata', 'fa-code-branch')}
            </div>
            ${isCreatingEntry ? renderWorldEntryCreatePanel(state.worldEntryEditing.entryKey) : ''}
            <div class="list-toolbar">
                <label class="field-label">
                    <span>搜索条目</span>
                    <input class="text-input" type="search" data-world-entry-search value="${escapeHtml(listState.query)}" placeholder="关键词、注释或内容">
                </label>
                <label class="field-label">
                    <span>排序</span>
                    <select class="select-input" data-world-entry-sort>
                        <option value="order" ${listState.sort === 'order' ? 'selected' : ''}>按插入顺序</option>
                        <option value="comment" ${listState.sort === 'comment' ? 'selected' : ''}>按注释</option>
                        <option value="key" ${listState.sort === 'key' ? 'selected' : ''}>按关键词</option>
                        <option value="status" ${listState.sort === 'status' ? 'selected' : ''}>按启用状态</option>
                    </select>
                </label>
                <div class="toolbar-actions">
                    <button class="secondary-button" type="button" data-world-entry-page="${listState.page - 1}" ${listState.page <= 1 ? 'disabled' : ''}>
                        <i class="fa-solid fa-chevron-left"></i>
                        上一页
                    </button>
                    <span class="badge">${formatNumber(listState.page)} / ${formatNumber(totalPages)}</span>
                    <button class="secondary-button" type="button" data-world-entry-page="${listState.page + 1}" ${listState.page >= totalPages ? 'disabled' : ''}>
                        下一页
                        <i class="fa-solid fa-chevron-right"></i>
                    </button>
                    <button class="secondary-button" type="button" data-bulk-world-entries="enable" ${selectedCount ? '' : 'disabled'}>
                        <i class="fa-solid fa-toggle-on"></i>
                        启用所选 ${formatNumber(selectedCount)}
                    </button>
                    <button class="secondary-button" type="button" data-bulk-world-entries="disable" ${selectedCount ? '' : 'disabled'}>
                        <i class="fa-solid fa-toggle-off"></i>
                        禁用所选 ${formatNumber(selectedCount)}
                    </button>
                    <button class="secondary-button danger-action" type="button" data-delete-selected-world-entries ${selectedCount ? '' : 'disabled'}>
                        <i class="fa-solid fa-trash"></i>
                        删除所选 ${formatNumber(selectedCount)}
                    </button>
                </div>
            </div>
            ${state.worldEntryBulkDeleteConfirm.worldbookId === worldbook.file_id ? renderWorldEntryBulkDeletePanel(selectedCount) : ''}
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr><th>选择</th><th>键</th><th>注释</th><th>状态</th><th>操作</th></tr>
                    </thead>
                    <tbody>
                        ${pageEntries.map(([entryKey, entry]) => renderWorldEntryRow(worldbook, entryKey, entry)).join('') || '<tr><td colspan="5">没有条目</td></tr>'}
                    </tbody>
                </table>
            </div>
        ` : renderEmptyState('fa-database', '正在读取条目', '如果长时间没有变化，可以点击“读取条目”重试。')}
    `;
    }

    function renderWorldbookDeletePanel(worldbook) {
        return `
        <div class="settings-form inline-form danger-panel">
            <div>
                <strong>删除世界书</strong>
                <p class="panel-subtitle">将删除 ${escapeHtml(worldbook.file_id)}.json，并从全局启用列表移除。角色卡里已有的关联字段不会自动改写。</p>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-cancel-worldbook-delete>
                    <i class="fa-solid fa-xmark"></i>
                    取消
                </button>
                <button class="secondary-button danger-action" type="button" data-confirm-worldbook-delete>
                    <i class="fa-solid fa-trash"></i>
                    确认删除
                </button>
            </div>
        </div>
    `;
    }

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

    function renderWorldEntryRow(worldbook, entryKey, entry) {
        const isEditing = state.worldEntryEditing.worldbookId === worldbook.file_id && state.worldEntryEditing.entryKey === entryKey;
        const isDeleting = state.worldEntryDeleteConfirm.worldbookId === worldbook.file_id && state.worldEntryDeleteConfirm.entryKey === entryKey;
        const isSelected = state.worldEntryList.selectedKeys.includes(String(entryKey));

        return `
        <tr>
            <td>
                <input type="checkbox" data-world-entry-select="${escapeHtml(entryKey)}" ${isSelected ? 'checked' : ''}>
            </td>
            <td>${escapeHtml(Array.isArray(entry.key) ? entry.key.join(', ') : entry.key || '无关键词')}</td>
            <td>${escapeHtml(entry.comment || entry.name || '未命名条目')}</td>
            <td>${entry.disable ? '<span class="danger">禁用</span>' : '<span class="success">启用</span>'}</td>
            <td>
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
                    <button class="secondary-button danger-action" type="button" data-delete-world-entry="${escapeHtml(worldbook.file_id)}" data-world-entry-key="${escapeHtml(entryKey)}">
                        <i class="fa-solid fa-trash"></i>
                        删除
                    </button>
                </div>
            </td>
        </tr>
        ${isEditing ? renderWorldEntryForm(entryKey, entry) : ''}
        ${isDeleting ? renderWorldEntryDeleteRow(entryKey, entry) : ''}
    `;
    }

    function renderWorldEntryDeleteRow(entryKey, entry) {
        return `
        <tr>
            <td colspan="5">
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
            </td>
        </tr>
    `;
    }

    function renderWorldEntryForm(entryKey, entry) {
        const edit = state.worldEntryEditing;
        const form = edit.form || worldEntryToForm(entry || createWorldEntry(Number(entryKey)));
        const isCreate = edit.mode === 'create';
        const formContent = renderWorldEntryFormContent(form, isCreate);

        return `
        <tr>
            <td colspan="5">${formContent}</td>
        </tr>
    `;
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
        render: renderWorldbooks,
    };
}
