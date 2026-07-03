export function createAssetBackgroundFolderComponents({
    state,
    escapeHtml,
    formatNumber,
    renderInlineEmpty,
    getBackgroundFolderById,
}) {
    function renderBackgroundFoldersPanel(folders, folderCounts, selectedCount) {
        const creating = state.backgroundFolderCreating;
        const activeFolder = getBackgroundFolderById(state.backgroundFolderFilter);
        const assignmentOptions = folders.map(folder => `
        <option value="${escapeHtml(folder.id)}" ${state.backgroundFolderAssignment === folder.id ? 'selected' : ''}>${escapeHtml(folder.name)}</option>
    `).join('');

        return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">背景文件夹</h2>
                    <p class="panel-subtitle">使用现有 image metadata 文件夹能力筛选和批量归档背景。</p>
                </div>
                <button class="secondary-button" type="button" data-toggle-background-folder-create>
                    <i class="fa-solid ${creating.active ? 'fa-xmark' : 'fa-folder-plus'}"></i>
                    ${creating.active ? '取消新建' : '新建文件夹'}
                </button>
            </div>
            <div class="tag-row">
                <button class="secondary-button ${state.backgroundFolderFilter ? '' : 'active'}" type="button" data-background-folder-filter="">
                    <i class="fa-solid fa-layer-group"></i>
                    全部背景
                    <span class="badge">${formatNumber(state.backgrounds?.images?.length || 0)}</span>
                </button>
                ${folders.map(folder => `
                    <button class="secondary-button ${state.backgroundFolderFilter === folder.id ? 'active' : ''}" type="button" data-background-folder-filter="${escapeHtml(folder.id)}">
                        <i class="fa-solid fa-folder"></i>
                        ${escapeHtml(folder.name)}
                        <span class="badge">${formatNumber(folderCounts[folder.id] || 0)}</span>
                    </button>
                `).join('') || renderInlineEmpty('还没有背景文件夹')}
            </div>
            ${activeFolder ? renderBackgroundFolderManagement(activeFolder, folderCounts[activeFolder.id] || 0) : ''}
            ${creating.active ? `
                <div class="settings-form inline-form">
                    <label class="field-label">
                        <span>文件夹名称</span>
                        <input class="text-input" type="text" data-background-folder-create-name value="${escapeHtml(creating.name)}" autocomplete="off">
                    </label>
                    <div class="message-edit-actions">
                        <button class="secondary-button" type="button" data-cancel-background-folder-create ${creating.running ? 'disabled' : ''}>
                            <i class="fa-solid fa-xmark"></i>
                            取消
                        </button>
                        <button class="primary-button" type="button" data-save-background-folder-create ${creating.running ? 'disabled' : ''}>
                            <i class="fa-solid ${creating.running ? 'fa-circle-notch fa-spin' : 'fa-check'}"></i>
                            ${creating.running ? '创建中' : '创建'}
                        </button>
                    </div>
                </div>
            ` : ''}
            ${state.backgroundSelection.active ? `
                <div class="list-toolbar">
                    <label class="field-label">
                        <span>批量归档目标</span>
                        <select class="select-input" data-background-folder-assignment ${folders.length ? '' : 'disabled'}>
                            ${assignmentOptions || '<option value="">暂无文件夹</option>'}
                        </select>
                    </label>
                    <div class="toolbar-actions">
                        <button class="secondary-button" type="button" data-assign-selected-backgrounds ${selectedCount && folders.length ? '' : 'disabled'}>
                            <i class="fa-solid fa-folder-plus"></i>
                            加入文件夹 ${formatNumber(selectedCount)}
                        </button>
                        <button class="secondary-button" type="button" data-unassign-selected-backgrounds ${selectedCount && folders.length ? '' : 'disabled'}>
                            <i class="fa-solid fa-folder-minus"></i>
                            移出文件夹 ${formatNumber(selectedCount)}
                        </button>
                    </div>
                </div>
            ` : ''}
        </section>
    `;
    }

    function renderBackgroundFolderManagement(folder, count) {
        const renaming = state.backgroundFolderRenaming.id === folder.id ? state.backgroundFolderRenaming : null;
        const deleting = state.backgroundFolderDeleteConfirm.id === folder.id ? state.backgroundFolderDeleteConfirm : null;

        if (renaming) {
            return `
            <div class="settings-form inline-form">
                <label class="field-label">
                    <span>重命名文件夹</span>
                    <input class="text-input" type="text" data-background-folder-rename-name value="${escapeHtml(renaming.name)}" autocomplete="off">
                </label>
                <div class="message-edit-actions">
                    <button class="secondary-button" type="button" data-cancel-background-folder-rename ${renaming.running ? 'disabled' : ''}>
                        <i class="fa-solid fa-xmark"></i>
                        取消
                    </button>
                    <button class="primary-button" type="button" data-confirm-background-folder-rename ${renaming.running ? 'disabled' : ''}>
                        <i class="fa-solid ${renaming.running ? 'fa-circle-notch fa-spin' : 'fa-check'}"></i>
                        ${renaming.running ? '保存中' : '保存'}
                    </button>
                </div>
            </div>
        `;
        }

        if (deleting) {
            return `
            <div class="settings-form inline-form danger-panel">
                <div>
                    <strong>删除背景文件夹</strong>
                    <p class="panel-subtitle">将删除“${escapeHtml(folder.name)}”这个虚拟文件夹，并移除 ${formatNumber(count)} 个背景的归档关系；不会删除背景图片文件。</p>
                </div>
                <div class="message-edit-actions">
                    <button class="secondary-button" type="button" data-cancel-background-folder-delete ${deleting.running ? 'disabled' : ''}>
                        <i class="fa-solid fa-xmark"></i>
                        取消
                    </button>
                    <button class="secondary-button danger-action" type="button" data-confirm-background-folder-delete ${deleting.running ? 'disabled' : ''}>
                        <i class="fa-solid ${deleting.running ? 'fa-circle-notch fa-spin' : 'fa-trash'}"></i>
                        ${deleting.running ? '删除中' : '确认删除'}
                    </button>
                </div>
            </div>
        `;
        }

        return `
        <div class="list-toolbar">
            <div>
                <strong>${escapeHtml(folder.name)}</strong>
                <p class="panel-subtitle">${formatNumber(count)} 个背景已归档到这个文件夹。</p>
            </div>
            <div class="toolbar-actions">
                <button class="secondary-button" type="button" data-rename-background-folder="${escapeHtml(folder.id)}">
                    <i class="fa-solid fa-i-cursor"></i>
                    重命名
                </button>
                <button class="secondary-button" type="button" data-delete-background-folder="${escapeHtml(folder.id)}">
                    <i class="fa-solid fa-ellipsis"></i>
                    管理文件夹
                </button>
            </div>
        </div>
    `;
    }

    return {
        renderBackgroundFoldersPanel,
    };
}
