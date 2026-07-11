import { createAssetDataHelpers } from './asset-data.js';
import { createBackgroundFolderActions } from './background-folders.js';
import { saveSettingsSerialized } from '../core/keyed-queue.js';

function getBackgroundSettingsUrl(filename) {
    return `url("backgrounds/${encodeURIComponent(filename)}")`;
}

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
    const {
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
    } = createBackgroundFolderActions({
        state,
        apiFetch,
        loadData,
        render,
        showToast,
        backgroundPageSize,
        formatNumber,
        getBackgroundFolderById,
    });

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
            const result = await apiFetch('/api/backgrounds/rename', { body: { old_bg: oldName, new_bg: newName } });
            const savedName = typeof result?.name === 'string' ? result.name : '';
            if (!savedName) {
                throw new Error('服务端未返回重命名后的背景文件名。');
            }
            state.backgroundRenaming = { filename: '', name: '', running: false };
            const backgroundSettings = state.settings?.background;
            const oldUrl = getBackgroundSettingsUrl(oldName);
            if (backgroundSettings && (backgroundSettings.name === oldName || backgroundSettings.url === oldUrl)) {
                state.settings.background = {
                    ...backgroundSettings,
                    name: savedName,
                    url: getBackgroundSettingsUrl(savedName),
                };
                await saveSettingsSerialized(apiFetch, state.settings);
            }
            await loadData({ silent: true });
            showToast('背景已重命名', `${oldName} → ${savedName}`);
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

    function selectVisibleBackgrounds(filenames) {
        const names = new Set(state.backgroundSelection.filenames);
        filenames.filter(Boolean).forEach(filename => names.add(filename));
        state.backgroundSelection.filenames = [...names];
        state.backgroundSelection.deleteConfirm = false;
        render();
    }

    function clearBackgroundSelection() {
        state.backgroundSelection.filenames = [];
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
        let deletedCount = 0;
        try {
            for (const filename of filenames) {
                await apiFetch('/api/backgrounds/delete', { body: { bg: filename } });
                deletedCount += 1;
            }
        } catch (error) {
            state.backgroundSelection.deleting = false;
            if (deletedCount) {
                await loadData({ silent: true });
            }
            render();
            throw error;
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
        selectVisibleBackgrounds,
        clearBackgroundSelection,
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
