export function createAssetsFileEvents(ctx) {
    const {
        state,
        render,
        showToast,
        toggleAssetDownload,
        downloadAssetFromForm,
        toggleAssetGroup,
        beginAssetDelete,
        cancelAssetDelete,
        confirmAssetDelete,
    } = ctx;

    async function handleAssetsFileClick(event) {
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

    function handleAssetsFileInput(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-asset-download-url]')) {
            state.assetDownload.url = event.target.value;
        }
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-asset-download-filename]')) {
            state.assetDownload.filename = event.target.value;
        }

        return false;
    }

    function handleAssetsFileChange(event) {
        if (event.target instanceof HTMLSelectElement && event.target.matches('[data-asset-download-category]')) {
            state.assetDownload.category = event.target.value;
            return true;
        }

        return false;
    }

    return {
        handleAssetsFileClick,
        handleAssetsFileInput,
        handleAssetsFileChange,
    };
}
