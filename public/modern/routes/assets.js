import { createAssetsComponents } from '../components/assets.js';

export function createAssetsRoute(ctx) {
    const {
        state,
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
    const { renderAssets } = createAssetsComponents(ctx);

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
