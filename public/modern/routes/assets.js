export function createAssetsRoute(ctx) {
    const {
        state,
        escapeHtml,
        formatNumber,
        metricCard,
        pageHead,
        renderEmptyState,
        renderInlineEmpty,
        matchesQuery,
        getAssetGroups,
        getAssetCount,
        getAssetEntries,
        getBackgroundUrl,
        getBackgroundFilename,
        getBackgroundFolderData,
        getBackgroundFolderById,
        getBackgroundFolderIds,
        getBackgroundFoldersFor,
        getBackgroundFolderCounts,
        render,
        showToast,
        setBackgroundSelectionMode,
        setBackgroundFolderFilter,
        toggleBackgroundFolderCreate,
        createBackgroundFolder,
        beginBackgroundFolderRename,
        cancelBackgroundFolderRename,
        confirmBackgroundFolderRename,
        beginBackgroundFolderDelete,
        cancelBackgroundFolderDelete,
        confirmBackgroundFolderDelete,
        assignSelectedBackgroundsToFolder,
        beginBackgroundBatchDelete,
        showMoreBackgrounds,
        cancelBackgroundDelete,
        confirmBackgroundDelete,
        beginBackgroundRename,
        cancelBackgroundRename,
        confirmBackgroundRename,
        toggleAssetDownload,
        downloadAssetFromForm,
        toggleAssetGroup,
        beginAssetDelete,
        cancelAssetDelete,
        confirmAssetDelete,
        toggleBackgroundSelection,
        uploadBackgroundFile,
    } = ctx;

    function renderAssets() {
        const groups = getAssetGroups().filter(group => matchesQuery(group.name));
        const allBackgrounds = state.backgrounds?.images || [];
        const backgroundFolders = getBackgroundFolderData().folders;
        const folderCounts = getBackgroundFolderCounts();
        if (state.backgroundFolderFilter && !getBackgroundFolderById(state.backgroundFolderFilter)) {
            state.backgroundFolderFilter = '';
        }
        if (!state.backgroundFolderAssignment && backgroundFolders[0]) {
            state.backgroundFolderAssignment = backgroundFolders[0].id;
        }
        const backgrounds = allBackgrounds
            .filter(background => matchesQuery(getBackgroundFilename(background)))
            .filter(background => !state.backgroundFolderFilter || getBackgroundFolderIds(getBackgroundFilename(background)).includes(state.backgroundFolderFilter));
        const visibleBackgrounds = backgrounds.slice(0, state.backgroundVisibleCount);
        const hasMoreBackgrounds = visibleBackgrounds.length < backgrounds.length;
        const selection = state.backgroundSelection;
        const selectedCount = selection.filenames.length;
        const folderFilterName = getBackgroundFolderById(state.backgroundFolderFilter)?.name || '全部背景';
        const assetTab = state.assetTab === 'files' ? 'files' : 'backgrounds';

        return `
        ${pageHead('素材库', '背景、音频、Live2D、VRM 和资产文件。', `
            <button class="primary-button" type="button" data-toggle-asset-download>
                <i class="fa-solid ${state.assetDownload.active ? 'fa-xmark' : 'fa-cloud-arrow-down'}"></i>
                ${state.assetDownload.active ? '取消下载' : '下载资产'}
            </button>
            <label class="secondary-button file-action">
                <i class="fa-solid fa-upload"></i>
                上传背景
                <input class="visually-hidden" type="file" accept="image/*,.gif,.webp,.apng" data-background-upload-file>
            </label>
            <button class="secondary-button" type="button" data-toggle-background-selection>
                <i class="fa-solid ${selection.active ? 'fa-xmark' : 'fa-check-square'}"></i>
                ${selection.active ? '退出选择' : '选择背景'}
            </button>
            ${selection.active ? `
                <button class="secondary-button danger-action" type="button" data-delete-selected-backgrounds ${selectedCount ? '' : 'disabled'}>
                    <i class="fa-solid fa-trash"></i>
                    删除所选 ${formatNumber(selectedCount)}
                </button>
            ` : ''}
        `)}
        ${state.assetDownload.active ? renderAssetDownloadPanel() : ''}
        <div class="metrics-grid">
            ${metricCard('背景', formatNumber(allBackgrounds.length), '背景图片', 'fa-image')}
            ${metricCard('资产文件', formatNumber(getAssetCount()), 'assets 目录', 'fa-folder-tree')}
            ${metricCard('背景文件夹', formatNumber(backgroundFolders.length), folderFilterName, 'fa-folder')}
            ${metricCard('动画背景', formatNumber(allBackgrounds.filter(item => item.isAnimated).length), 'metadata 标记', 'fa-film')}
        </div>
        ${renderAssetTabs(assetTab, backgrounds.length, getAssetCount())}
        ${assetTab === 'backgrounds' ? `
            ${renderBackgroundFoldersPanel(backgroundFolders, folderCounts, selectedCount)}
            ${renderBackgroundLibraryPanel(folderFilterName, visibleBackgrounds, backgrounds.length, selectedCount, selection, hasMoreBackgrounds)}
        ` : `
            <div class="grid-list">
                ${groups.map(group => renderAssetGroupCard(group)).join('') || renderEmptyState('fa-folder-tree', '暂无素材', '当前资产目录还没有可显示文件。')}
            </div>
        `}
    `;
    }

    function renderAssetTabs(assetTab, backgroundCount, assetCount) {
        return `
        <div class="segmented-control asset-tabs" role="tablist" aria-label="素材类型">
            <button class="${assetTab === 'backgrounds' ? 'active' : ''}" type="button" data-asset-tab="backgrounds" aria-selected="${assetTab === 'backgrounds'}">
                <i class="fa-solid fa-image"></i>
                背景
                <span class="badge">${formatNumber(backgroundCount)}</span>
            </button>
            <button class="${assetTab === 'files' ? 'active' : ''}" type="button" data-asset-tab="files" aria-selected="${assetTab === 'files'}">
                <i class="fa-solid fa-folder-tree"></i>
                文件资产
                <span class="badge">${formatNumber(assetCount)}</span>
            </button>
        </div>
    `;
    }

    function renderBackgroundLibraryPanel(folderFilterName, visibleBackgrounds, totalBackgrounds, selectedCount, selection, hasMoreBackgrounds) {
        return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">背景</h2>
                    <p class="panel-subtitle">${escapeHtml(folderFilterName)} · 显示 ${formatNumber(visibleBackgrounds.length)} / ${formatNumber(totalBackgrounds)} 个匹配项。${selection.active ? `已选择 ${formatNumber(selectedCount)} 个。` : ''}</p>
                </div>
            </div>
            ${selection.deleteConfirm ? `
                <div class="settings-form inline-form danger-panel">
                    <strong>删除所选背景</strong>
                    <p class="panel-subtitle">将删除 ${formatNumber(selectedCount)} 个背景文件，此操作会调用现有背景删除接口。</p>
                    <div class="message-edit-actions">
                        <button class="secondary-button" type="button" data-cancel-background-delete ${selection.deleting ? 'disabled' : ''}>
                            <i class="fa-solid fa-xmark"></i>
                            取消
                        </button>
                        <button class="secondary-button danger-action" type="button" data-confirm-background-delete ${selection.deleting ? 'disabled' : ''}>
                            <i class="fa-solid ${selection.deleting ? 'fa-circle-notch fa-spin' : 'fa-trash'}"></i>
                            ${selection.deleting ? '删除中' : '确认删除'}
                        </button>
                    </div>
                </div>
            ` : ''}
            <div class="background-grid">
                ${visibleBackgrounds.map(background => renderBackgroundCard(background)).join('') || renderInlineEmpty('暂无背景')}
            </div>
            ${hasMoreBackgrounds ? `
                <button class="secondary-button load-more-button" type="button" data-load-more-backgrounds>
                    <i class="fa-solid fa-chevron-down"></i>
                    加载更多背景 ${formatNumber(totalBackgrounds - visibleBackgrounds.length)}
                </button>
            ` : ''}
        </section>
    `;
    }

    function renderAssetGroupCard(group) {
        const expanded = state.assetExpandedGroups.includes(group.name);
        const entries = getAssetEntries(group, expanded ? Infinity : 8);
        const hiddenCount = Math.max(group.count - entries.length, 0);

        return `
        <article class="resource-card">
            <div class="card-head">
                <div>
                    <h2 class="card-title">${escapeHtml(group.name)}</h2>
                    <div class="card-meta">${formatNumber(group.count)} 个文件</div>
                </div>
                <span class="badge">${formatNumber(group.count)}</span>
            </div>
            <div class="resource-list compact-list">
                ${entries.map(entry => renderAssetEntryRow(entry)).join('') || renderInlineEmpty('空分类')}
            </div>
            ${group.count > 8 ? `
                <button class="secondary-button load-more-button" type="button" data-toggle-asset-group="${escapeHtml(group.name)}">
                    <i class="fa-solid ${expanded ? 'fa-chevron-up' : 'fa-chevron-down'}"></i>
                    ${expanded ? '收起资产' : `展开全部 ${formatNumber(hiddenCount)}`}
                </button>
            ` : ''}
        </article>
    `;
    }

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

    function renderAssetDownloadPanel() {
        const download = state.assetDownload;
        const categories = [
            { value: 'bgm', label: 'BGM' },
            { value: 'ambient', label: '环境音' },
            { value: 'blip', label: '提示音' },
        ];

        return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">下载资产</h2>
                    <p class="panel-subtitle">把白名单域名下的文件下载到 assets 分类目录。</p>
                </div>
            </div>
            <div class="settings-form">
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>资产 URL</span>
                        <input class="text-input" type="url" data-asset-download-url value="${escapeHtml(download.url)}" placeholder="https://example.com/file.mp3" autocomplete="off">
                    </label>
                    <label class="field-label">
                        <span>文件名</span>
                        <input class="text-input" type="text" data-asset-download-filename value="${escapeHtml(download.filename)}" placeholder="sound.mp3" autocomplete="off">
                    </label>
                    <label class="field-label">
                        <span>分类</span>
                        <select class="select-input" data-asset-download-category>
                            ${categories.map(category => `<option value="${category.value}" ${download.category === category.value ? 'selected' : ''}>${escapeHtml(category.label)}</option>`).join('')}
                        </select>
                    </label>
                </div>
                <div class="message-edit-actions">
                    <button class="secondary-button" type="button" data-toggle-asset-download ${download.running ? 'disabled' : ''}>
                        <i class="fa-solid fa-xmark"></i>
                        取消
                    </button>
                    <button class="primary-button" type="button" data-download-asset ${download.running ? 'disabled' : ''}>
                        <i class="fa-solid ${download.running ? 'fa-circle-notch fa-spin' : 'fa-cloud-arrow-down'}"></i>
                        ${download.running ? '下载中' : '下载'}
                    </button>
                </div>
            </div>
        </section>
    `;
    }

    function renderBackgroundCard(background) {
        const filename = getBackgroundFilename(background);
        const isSelected = state.backgroundSelection.filenames.includes(filename);
        const isSelecting = state.backgroundSelection.active;
        const isAnimated = typeof background === 'object' && Boolean(background?.isAnimated);
        const isRenaming = state.backgroundRenaming.filename === filename;
        const folders = getBackgroundFoldersFor(filename);
        const folderText = folders.length ? folders.map(folder => folder.name).join(', ') : '未归档';

        return `
        <article class="resource-card background-card ${isSelected ? 'selected' : ''}">
            <img class="background-thumb" src="${getBackgroundUrl(filename)}" alt="" loading="lazy">
            <div class="card-head">
                <div>
                    <h3 class="card-title">${escapeHtml(filename)}</h3>
                    <div class="card-meta">${isAnimated ? '动画背景' : '静态背景'} · ${escapeHtml(folderText)}</div>
                </div>
            </div>
            ${!isSelecting && !isRenaming ? `
                <div class="row-actions">
                    <button class="secondary-button" type="button" data-background-rename="${escapeHtml(filename)}">
                        <i class="fa-solid fa-i-cursor"></i>
                        重命名
                    </button>
                </div>
            ` : ''}
            ${isRenaming ? `
                <div class="settings-form inline-form">
                    <label class="field-label">
                        <span>新文件名</span>
                        <input class="text-input" type="text" data-background-rename-input value="${escapeHtml(state.backgroundRenaming.name)}">
                    </label>
                    <div class="message-edit-actions">
                        <button class="secondary-button" type="button" data-cancel-background-rename ${state.backgroundRenaming.running ? 'disabled' : ''}>
                            <i class="fa-solid fa-xmark"></i>
                            取消
                        </button>
                        <button class="primary-button" type="button" data-confirm-background-rename ${state.backgroundRenaming.running ? 'disabled' : ''}>
                            <i class="fa-solid ${state.backgroundRenaming.running ? 'fa-circle-notch fa-spin' : 'fa-check'}"></i>
                            ${state.backgroundRenaming.running ? '保存中' : '保存'}
                        </button>
                    </div>
                </div>
            ` : ''}
            ${isSelecting ? `
                <label class="selection-row">
                    <input type="checkbox" data-background-select="${escapeHtml(filename)}" ${isSelected ? 'checked' : ''}>
                    <span>${isSelected ? '已选择' : '选择'}</span>
                </label>
            ` : ''}
        </article>
    `;
    }

    function renderAssetEntryRow(entry) {
        const isDeleting = state.assetDeleteConfirm.category === entry.category && state.assetDeleteConfirm.filename === entry.filename;
        const isBusy = isDeleting && state.assetDeleteConfirm.running;
        const readOnlyReason = entry.filename?.includes('/')
            ? '嵌套资源需在资源目录管理'
            : '当前分类不支持删除';

        return `
        <div class="resource-row asset-row">
            <span class="avatar-fallback"><i class="fa-solid fa-file"></i></span>
            <span class="row-main">
                <span class="row-title">${escapeHtml(entry.label || entry.filename)}</span>
                <span class="row-subtitle">${escapeHtml(entry.path)}</span>
            </span>
            ${entry.deletable ? `
                <span class="row-actions">
                    ${isDeleting ? `
                        <button class="secondary-button" type="button" data-cancel-asset-delete ${isBusy ? 'disabled' : ''}>
                            取消
                        </button>
                        <button class="secondary-button danger-action" type="button" data-confirm-asset-delete ${isBusy ? 'disabled' : ''}>
                            <i class="fa-solid ${isBusy ? 'fa-circle-notch fa-spin' : 'fa-trash'}"></i>
                            确认
                        </button>
                    ` : `
                        <button class="secondary-button" type="button" data-delete-asset data-asset-category="${escapeHtml(entry.category)}" data-asset-filename="${escapeHtml(entry.filename)}">
                            <i class="fa-solid fa-ellipsis"></i>
                            管理
                        </button>
                    `}
                </span>
            ` : `<span class="card-meta asset-readonly">${escapeHtml(readOnlyReason)}</span>`}
        </div>
    `;
    }

    async function handleClick(event) {
        if (event.target.closest('[data-toggle-background-selection]')) {
            setBackgroundSelectionMode(!state.backgroundSelection.active);
            return true;
        }

        const assetTabButton = event.target.closest('[data-asset-tab]');
        if (assetTabButton) {
            state.assetTab = assetTabButton.dataset.assetTab === 'files' ? 'files' : 'backgrounds';
            localStorage.setItem('st-modern-asset-tab', state.assetTab);
            render();
            return true;
        }

        const backgroundFolderFilterButton = event.target.closest('[data-background-folder-filter]');
        if (backgroundFolderFilterButton) {
            setBackgroundFolderFilter(backgroundFolderFilterButton.dataset.backgroundFolderFilter || '');
            return true;
        }

        if (event.target.closest('[data-toggle-background-folder-create]')) {
            toggleBackgroundFolderCreate();
            return true;
        }

        if (event.target.closest('[data-cancel-background-folder-create]')) {
            toggleBackgroundFolderCreate(false);
            return true;
        }

        if (event.target.closest('[data-save-background-folder-create]')) {
            try {
                await createBackgroundFolder();
            } catch (error) {
                state.errors.push({ key: 'background-folder-create', message: error.message });
                showToast('背景文件夹创建失败', error.message);
                state.backgroundFolderCreating.running = false;
                render();
            }
            return true;
        }

        const renameBackgroundFolderButton = event.target.closest('[data-rename-background-folder]');
        if (renameBackgroundFolderButton) {
            try {
                beginBackgroundFolderRename(renameBackgroundFolderButton.dataset.renameBackgroundFolder);
            } catch (error) {
                showToast('背景文件夹不可编辑', error.message);
            }
            return true;
        }

        if (event.target.closest('[data-cancel-background-folder-rename]')) {
            cancelBackgroundFolderRename();
            return true;
        }

        if (event.target.closest('[data-confirm-background-folder-rename]')) {
            try {
                await confirmBackgroundFolderRename();
            } catch (error) {
                state.errors.push({ key: 'background-folder-rename', message: error.message });
                showToast('背景文件夹重命名失败', error.message);
                state.backgroundFolderRenaming.running = false;
                render();
            }
            return true;
        }

        const deleteBackgroundFolderButton = event.target.closest('[data-delete-background-folder]');
        if (deleteBackgroundFolderButton) {
            try {
                beginBackgroundFolderDelete(deleteBackgroundFolderButton.dataset.deleteBackgroundFolder);
            } catch (error) {
                showToast('背景文件夹不可删除', error.message);
            }
            return true;
        }

        if (event.target.closest('[data-cancel-background-folder-delete]')) {
            cancelBackgroundFolderDelete();
            return true;
        }

        if (event.target.closest('[data-confirm-background-folder-delete]')) {
            try {
                await confirmBackgroundFolderDelete();
            } catch (error) {
                state.errors.push({ key: 'background-folder-delete', message: error.message });
                showToast('背景文件夹删除失败', error.message);
                state.backgroundFolderDeleteConfirm.running = false;
                render();
            }
            return true;
        }

        if (event.target.closest('[data-assign-selected-backgrounds]')) {
            try {
                await assignSelectedBackgroundsToFolder(false);
            } catch (error) {
                state.errors.push({ key: 'background-folder-assign', message: error.message });
                showToast('背景归档失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-unassign-selected-backgrounds]')) {
            try {
                await assignSelectedBackgroundsToFolder(true);
            } catch (error) {
                state.errors.push({ key: 'background-folder-unassign', message: error.message });
                showToast('移出背景文件夹失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-delete-selected-backgrounds]')) {
            try {
                beginBackgroundBatchDelete();
            } catch (error) {
                showToast('请选择背景', error.message);
            }
            return true;
        }

        if (event.target.closest('[data-load-more-backgrounds]')) {
            showMoreBackgrounds();
            return true;
        }

        if (event.target.closest('[data-cancel-background-delete]')) {
            cancelBackgroundDelete();
            return true;
        }

        if (event.target.closest('[data-confirm-background-delete]')) {
            try {
                await confirmBackgroundDelete();
            } catch (error) {
                state.errors.push({ key: 'background-delete', message: error.message });
                showToast('背景删除失败', error.message);
                render();
            }
            return true;
        }

        const backgroundRenameButton = event.target.closest('[data-background-rename]');
        if (backgroundRenameButton) {
            beginBackgroundRename(backgroundRenameButton.dataset.backgroundRename);
            return true;
        }

        if (event.target.closest('[data-cancel-background-rename]')) {
            cancelBackgroundRename();
            return true;
        }

        if (event.target.closest('[data-confirm-background-rename]')) {
            try {
                await confirmBackgroundRename();
            } catch (error) {
                state.errors.push({ key: 'background-rename', message: error.message });
                showToast('背景重命名失败', error.message);
                state.backgroundRenaming.running = false;
                render();
            }
            return true;
        }

        if (event.target.closest('[data-toggle-asset-download]')) {
            toggleAssetDownload();
            return true;
        }

        if (event.target.closest('[data-download-asset]')) {
            try {
                await downloadAssetFromForm();
            } catch (error) {
                state.errors.push({ key: 'asset-download', message: error.message });
                showToast('资产下载失败', error.message);
                state.assetDownload.running = false;
                render();
            }
            return true;
        }

        const toggleAssetGroupButton = event.target.closest('[data-toggle-asset-group]');
        if (toggleAssetGroupButton) {
            toggleAssetGroup(toggleAssetGroupButton.dataset.toggleAssetGroup);
            return true;
        }

        const deleteAssetButton = event.target.closest('[data-delete-asset]');
        if (deleteAssetButton) {
            beginAssetDelete(deleteAssetButton.dataset.assetCategory, deleteAssetButton.dataset.assetFilename);
            return true;
        }

        if (event.target.closest('[data-cancel-asset-delete]')) {
            cancelAssetDelete();
            return true;
        }

        if (event.target.closest('[data-confirm-asset-delete]')) {
            try {
                await confirmAssetDelete();
            } catch (error) {
                state.errors.push({ key: 'asset-delete', message: error.message });
                showToast('资产删除失败', error.message);
                state.assetDeleteConfirm.running = false;
                render();
            }
            return true;
        }


        return false;
    }

    function handleInput(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-background-rename-input]')) {
            state.backgroundRenaming.name = event.target.value;
        }
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-background-folder-create-name]')) {
            state.backgroundFolderCreating.name = event.target.value;
        }
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-background-folder-rename-name]')) {
            state.backgroundFolderRenaming.name = event.target.value;
        }
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-asset-download-url]')) {
            state.assetDownload.url = event.target.value;
        }
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-asset-download-filename]')) {
            state.assetDownload.filename = event.target.value;
        }

        return false;
    }

    async function handleChange(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-background-select]')) {
            toggleBackgroundSelection(event.target.dataset.backgroundSelect, event.target.checked);
            return true;
        }

        if (event.target instanceof HTMLSelectElement && event.target.matches('[data-background-folder-assignment]')) {
            state.backgroundFolderAssignment = event.target.value;
            return true;
        }

        if (event.target instanceof HTMLSelectElement && event.target.matches('[data-asset-download-category]')) {
            state.assetDownload.category = event.target.value;
            return true;
        }

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-background-upload-file]')) {
            try {
                await uploadBackgroundFile(event.target.files?.[0]);
            } catch (error) {
                state.errors.push({ key: 'background-upload', message: error.message });
                showToast('背景上传失败', error.message);
                render();
            } finally {
                event.target.value = '';
            }
            return true;
        }

        return false;
    }

    return {
        render: renderAssets,
        handleClick,
        handleInput,
        handleChange,
    };
}
