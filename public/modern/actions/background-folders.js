export function createBackgroundFolderActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
    backgroundPageSize,
    formatNumber,
    getBackgroundFolderById,
}) {
    function setBackgroundFolderFilter(folderId) {
        state.backgroundFolderFilter = folderId && getBackgroundFolderById(folderId) ? folderId : '';
        state.backgroundVisibleCount = backgroundPageSize;
        render();
    }

    function showMoreBackgrounds() {
        state.backgroundVisibleCount += backgroundPageSize;
        render();
    }

    function toggleBackgroundFolderCreate(active = !state.backgroundFolderCreating.active) {
        state.backgroundFolderCreating = {
            active,
            name: active ? state.backgroundFolderCreating.name : '',
            running: false,
        };
        render();
    }

    async function createBackgroundFolder() {
        const name = state.backgroundFolderCreating.name.trim();
        if (!name) {
            throw new Error('请输入背景文件夹名称。');
        }

        state.backgroundFolderCreating.running = true;
        render();
        try {
            const folder = await apiFetch('/api/image-metadata/folders/create', { body: { name } });
            state.backgroundFolderCreating = { active: false, name: '', running: false };
            state.backgroundFolderFilter = folder?.id || '';
            state.backgroundFolderAssignment = folder?.id || '';
            await loadData({ silent: true });
            showToast('背景文件夹已创建', folder?.name || name);
        } finally {
            state.backgroundFolderCreating.running = false;
            render();
        }
    }

    function beginBackgroundFolderRename(folderId) {
        const folder = getBackgroundFolderById(folderId);
        if (!folder) {
            throw new Error('背景文件夹不存在，请刷新后重试。');
        }
        state.backgroundFolderRenaming = { id: folder.id, name: folder.name || '', running: false };
        state.backgroundFolderDeleteConfirm = { id: '', running: false };
        render();
    }

    function cancelBackgroundFolderRename() {
        state.backgroundFolderRenaming = { id: '', name: '', running: false };
        render();
    }

    async function confirmBackgroundFolderRename() {
        const { id, name } = state.backgroundFolderRenaming;
        const nextName = name.trim();
        if (!id || !getBackgroundFolderById(id)) {
            throw new Error('背景文件夹不存在，请刷新后重试。');
        }
        if (!nextName) {
            throw new Error('请输入背景文件夹名称。');
        }

        state.backgroundFolderRenaming.running = true;
        render();
        try {
            await apiFetch('/api/image-metadata/folders/update', { body: { id, name: nextName } });
            state.backgroundFolderRenaming = { id: '', name: '', running: false };
            await loadData({ silent: true });
            showToast('背景文件夹已重命名', nextName);
        } finally {
            state.backgroundFolderRenaming.running = false;
            render();
        }
    }

    function beginBackgroundFolderDelete(folderId) {
        const folder = getBackgroundFolderById(folderId);
        if (!folder) {
            throw new Error('背景文件夹不存在，请刷新后重试。');
        }
        state.backgroundFolderDeleteConfirm = { id: folder.id, running: false };
        state.backgroundFolderRenaming = { id: '', name: '', running: false };
        render();
    }

    function cancelBackgroundFolderDelete() {
        state.backgroundFolderDeleteConfirm = { id: '', running: false };
        render();
    }

    async function confirmBackgroundFolderDelete() {
        const { id } = state.backgroundFolderDeleteConfirm;
        const folder = getBackgroundFolderById(id);
        if (!folder) {
            throw new Error('背景文件夹不存在，请刷新后重试。');
        }

        state.backgroundFolderDeleteConfirm.running = true;
        render();
        try {
            await apiFetch('/api/image-metadata/folders/delete', { body: { id } });
            if (state.backgroundFolderFilter === id) {
                state.backgroundFolderFilter = '';
            }
            if (state.backgroundFolderAssignment === id) {
                state.backgroundFolderAssignment = '';
            }
            state.backgroundFolderDeleteConfirm = { id: '', running: false };
            await loadData({ silent: true });
            showToast('背景文件夹已删除', `${folder.name}，背景图片未删除。`);
        } finally {
            state.backgroundFolderDeleteConfirm.running = false;
            render();
        }
    }

    async function assignSelectedBackgroundsToFolder(remove = false) {
        const folderId = state.backgroundFolderAssignment || state.backgroundFolderFilter;
        const folder = getBackgroundFolderById(folderId);
        const filenames = [...state.backgroundSelection.filenames];
        if (!folder) {
            throw new Error('请选择目标背景文件夹。');
        }
        if (!filenames.length) {
            throw new Error('请选择要处理的背景。');
        }

        const endpoint = remove ? '/api/image-metadata/folders/unassign' : '/api/image-metadata/folders/assign';
        await apiFetch(endpoint, {
            body: {
                id: folder.id,
                paths: filenames.map(filename => `backgrounds/${filename}`),
            },
        });
        await loadData({ silent: true });
        showToast(remove ? '已移出背景文件夹' : '已加入背景文件夹', `${formatNumber(filenames.length)} 个背景 · ${folder.name}`);
        render();
    }

    return {
        assignSelectedBackgroundsToFolder,
        beginBackgroundFolderDelete,
        beginBackgroundFolderRename,
        cancelBackgroundFolderDelete,
        cancelBackgroundFolderRename,
        confirmBackgroundFolderDelete,
        confirmBackgroundFolderRename,
        createBackgroundFolder,
        setBackgroundFolderFilter,
        showMoreBackgrounds,
        toggleBackgroundFolderCreate,
    };
}
