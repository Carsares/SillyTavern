import { createAssetDataHelpers } from './asset-data.js';

export function createAssetActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
    backgroundPageSize,
    formatNumber,
}) {
    const {
        getAssetCount,
        getAssetEntries,
        getAssetGroups,
        getBackgroundFilename,
        getBackgroundFolderById,
        getBackgroundFolderCounts,
        getBackgroundFolderData,
        getBackgroundFolderIds,
        getBackgroundFoldersFor,
        getBackgroundUrl,
    } = createAssetDataHelpers({ state });

    async function uploadBackgroundFile(file) {
        if (!file) {
            return;
        }

        const formData = new FormData();
        formData.set('avatar', file, file.name);
        const filename = await apiFetch('/api/backgrounds/upload', { body: formData, omitContentType: true });
        await loadData({ silent: true });
        showToast('背景已上传', filename || file.name);
        render();
    }

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

    function beginBackgroundRename(filename) {
        state.backgroundRenaming = { filename, name: filename, running: false };
        state.backgroundSelection.deleteConfirm = false;
        render();
    }

    function cancelBackgroundRename() {
        state.backgroundRenaming = { filename: '', name: '', running: false };
        render();
    }

    async function confirmBackgroundRename() {
        const oldName = state.backgroundRenaming.filename;
        const newName = state.backgroundRenaming.name.trim();
        if (!oldName || !newName) {
            throw new Error('请输入新的背景文件名。');
        }
        if (oldName === newName) {
            cancelBackgroundRename();
            return;
        }

        state.backgroundRenaming.running = true;
        render();
        try {
            await apiFetch('/api/backgrounds/rename', { body: { old_bg: oldName, new_bg: newName } });
            state.backgroundRenaming = { filename: '', name: '', running: false };
            await loadData({ silent: true });
            showToast('背景已重命名', `${oldName} → ${newName}`);
        } finally {
            state.backgroundRenaming.running = false;
            render();
        }
    }

    function setBackgroundSelectionMode(active) {
        state.backgroundSelection = {
            active,
            filenames: active ? state.backgroundSelection.filenames : [],
            deleteConfirm: false,
            deleting: false,
        };
        render();
    }

    function toggleBackgroundSelection(filename, checked) {
        const names = new Set(state.backgroundSelection.filenames);
        if (checked) {
            names.add(filename);
        } else {
            names.delete(filename);
        }
        state.backgroundSelection.filenames = [...names];
        state.backgroundSelection.deleteConfirm = false;
        render();
    }

    function beginBackgroundBatchDelete() {
        if (!state.backgroundSelection.filenames.length) {
            throw new Error('请选择要删除的背景。');
        }
        state.backgroundSelection.deleteConfirm = true;
        render();
    }

    function cancelBackgroundDelete() {
        state.backgroundSelection.deleteConfirm = false;
        render();
    }

    async function confirmBackgroundDelete() {
        const filenames = [...state.backgroundSelection.filenames];
        if (!filenames.length) {
            throw new Error('请选择要删除的背景。');
        }

        state.backgroundSelection.deleting = true;
        render();
        for (const filename of filenames) {
            await apiFetch('/api/backgrounds/delete', { body: { bg: filename } });
        }
        state.backgroundSelection = { active: false, filenames: [], deleteConfirm: false, deleting: false };
        await loadData({ silent: true });
        showToast('背景已删除', `${formatNumber(filenames.length)} 个文件`);
        render();
    }

    function toggleAssetDownload(active = !state.assetDownload.active) {
        state.assetDownload = {
            active,
            url: active ? state.assetDownload.url : '',
            category: active ? state.assetDownload.category : 'bgm',
            filename: active ? state.assetDownload.filename : '',
            running: false,
        };
        render();
    }

    function toggleAssetGroup(name) {
        const groups = new Set(state.assetExpandedGroups);
        if (groups.has(name)) {
            groups.delete(name);
        } else {
            groups.add(name);
        }
        state.assetExpandedGroups = [...groups];
        render();
    }

    async function downloadAssetFromForm() {
        const url = state.assetDownload.url.trim();
        const filename = state.assetDownload.filename.trim();
        const category = state.assetDownload.category;
        if (!url || !filename) {
            throw new Error('请输入资产 URL 和文件名。');
        }

        const parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            throw new Error('资产 URL 只支持 HTTP 或 HTTPS。');
        }

        state.assetDownload.running = true;
        render();
        try {
            await apiFetch('/api/assets/download', { body: { url, category, filename } });
            state.assetDownload = { active: false, url: '', category: 'bgm', filename: '', running: false };
            await loadData({ silent: true });
            showToast('资产已下载', `${category}/${filename}`);
        } finally {
            state.assetDownload.running = false;
            render();
        }
    }

    function beginAssetDelete(category, filename) {
        state.assetDeleteConfirm = { category, filename, running: false };
        render();
    }

    function cancelAssetDelete() {
        state.assetDeleteConfirm = { category: '', filename: '', running: false };
        render();
    }

    async function confirmAssetDelete() {
        const { category, filename } = state.assetDeleteConfirm;
        if (!category || !filename) {
            throw new Error('请选择要删除的资产文件。');
        }

        state.assetDeleteConfirm.running = true;
        render();
        try {
            await apiFetch('/api/assets/delete', { body: { category, filename } });
            state.assetDeleteConfirm = { category: '', filename: '', running: false };
            await loadData({ silent: true });
            showToast('资产已删除', `${category}/${filename}`);
        } finally {
            state.assetDeleteConfirm.running = false;
            render();
        }
    }

    return {
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
        uploadBackgroundFile,
        setBackgroundFolderFilter,
        showMoreBackgrounds,
        toggleBackgroundFolderCreate,
        createBackgroundFolder,
        beginBackgroundFolderRename,
        cancelBackgroundFolderRename,
        confirmBackgroundFolderRename,
        beginBackgroundFolderDelete,
        cancelBackgroundFolderDelete,
        confirmBackgroundFolderDelete,
        assignSelectedBackgroundsToFolder,
        beginBackgroundRename,
        cancelBackgroundRename,
        confirmBackgroundRename,
        setBackgroundSelectionMode,
        toggleBackgroundSelection,
        beginBackgroundBatchDelete,
        cancelBackgroundDelete,
        confirmBackgroundDelete,
        toggleAssetDownload,
        toggleAssetGroup,
        downloadAssetFromForm,
        beginAssetDelete,
        cancelAssetDelete,
        confirmAssetDelete,
    };
}
