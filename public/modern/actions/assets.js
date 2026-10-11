import { createAssetDataHelpers } from './asset-data.js';
import { createBackgroundFolderActions } from './background-folders.js';
import {
    TRANSPARENT_BACKGROUND_NAME,
    buildBackgroundCssUrl,
    findBackgroundReferences,
    resetChatBackgroundImageStatus,
} from '../core/chat-background.js';
import { saveSettingsSerialized } from '../core/keyed-queue.js';

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

    // 聊天背景功能（actions/chat-background.js）登记的回调：背景被重命名或删除后，处理它负责的「当前聊天锁定」。
    // 回调返回一段附在提示后面的说明（可为空）；全局背景的引用由本文件自己维护。
    let referenceHooks = { afterRename: null, afterDelete: null };

    function registerBackgroundReferenceHooks(hooks) {
        referenceHooks = { ...referenceHooks, ...hooks };
    }

    async function runReferenceHook(name, ...args) {
        if (typeof referenceHooks[name] !== 'function') {
            return '';
        }
        try {
            return (await referenceHooks[name](...args)) || '';
        } catch (error) {
            return `；聊天背景引用未能同步（${error.message}）`;
        }
    }

    async function uploadBackgroundFile(file) {
        if (!file) {
            return;
        }

        const formData = new FormData();
        formData.set('avatar', file, file.name);
        const filename = await apiFetch('/api/backgrounds/upload', { body: formData, omitContentType: true });
        // 同名文件被覆盖时，之前加载失败的记录不再可信
        resetChatBackgroundImageStatus(state);
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
            // 当前查看的背景被重命名时跟随新文件名，卡片高亮和「上下文」抽屉不丢失。
            if (state.selected.background === oldName) {
                state.selected.background = savedName;
            }
            if (state.backgroundGridFocus === oldName) {
                state.backgroundGridFocus = savedName;
            }
            const backgroundSettings = state.settings?.background;
            if (backgroundSettings && findBackgroundReferences({ settings: state.settings, filename: oldName }).global) {
                state.settings.background = {
                    ...backgroundSettings,
                    name: savedName,
                    url: buildBackgroundCssUrl(savedName),
                };
                await saveSettingsSerialized(apiFetch, state.settings);
            }
            await loadData({ silent: true });
            const referenceNote = await runReferenceHook('afterRename', oldName, savedName);
            showToast('背景已重命名', `${oldName} → ${savedName}${referenceNote}`);
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
                await reconcileDeletedBackgrounds(filenames.slice(0, deletedCount));
            }
            render();
            throw error;
        }
        state.backgroundSelection = { active: false, filenames: [], deleteConfirm: false, deleting: false };
        if (filenames.includes(state.selected.background)) {
            state.selected.background = '';
        }
        await loadData({ silent: true });
        const referenceNote = await reconcileDeletedBackgrounds(filenames);
        showToast('背景已删除', `${formatNumber(filenames.length)} 个文件${referenceNote}`);
        render();
    }

    // 文件已经删掉后清理引用：全局背景指向被删文件时恢复为「无背景」（旧版透明占位图），当前聊天的锁定由聊天背景功能的回调清除。
    async function reconcileDeletedBackgrounds(deletedNames) {
        resetChatBackgroundImageStatus(state);
        let note = '';
        const background = state.settings?.background;
        const globalDeleted = background && deletedNames.some(name => name !== TRANSPARENT_BACKGROUND_NAME
            && findBackgroundReferences({ settings: state.settings, filename: name }).global);
        if (globalDeleted) {
            try {
                state.settings.background = {
                    ...background,
                    name: TRANSPARENT_BACKGROUND_NAME,
                    url: buildBackgroundCssUrl(TRANSPARENT_BACKGROUND_NAME),
                };
                await saveSettingsSerialized(apiFetch, state.settings);
                note += '；全局背景已恢复为无背景';
            } catch (error) {
                note += `；全局背景仍指向已删除的文件，重置失败（${error.message}）`;
            }
        }
        return note + await runReferenceHook('afterDelete', deletedNames);
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
        registerBackgroundReferenceHooks,
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
