export function createExtensionsEvents(ctx) {
    const {
        state,
        render,
        showToast,
        toggleExtensionInstall,
        installExtensionFromForm,
        loadExtensionDetails,
        switchExtensionBranch,
        beginExtensionOperation,
        cancelExtensionOperation,
        confirmExtensionOperation,
    } = ctx;

    function setExtensionView(view) {
        state.extensionView = ['all', 'manageable', 'system', 'local', 'global'].includes(view) ? view : 'all';
        localStorage.setItem('st-modern-extension-view', state.extensionView);
    }

    async function handleExtensionsClick(event) {
        const extensionViewButton = event.target.closest('[data-extension-view]');
        if (extensionViewButton) {
            setExtensionView(extensionViewButton.dataset.extensionView);
            render();
            return true;
        }

        if (event.target.closest('[data-toggle-extension-install]')) {
            toggleExtensionInstall();
            return;
        }

        if (event.target.closest('[data-install-extension]')) {
            try {
                await installExtensionFromForm();
            } catch (error) {
                state.errors.push({ key: 'extension-install', message: error.message });
                showToast('扩展安装失败', error.message);
                state.extensionInstall.running = false;
                render();
            }
            return;
        }

        const extensionDetailsButton = event.target.closest('[data-extension-details]');
        if (extensionDetailsButton) {
            try {
                await loadExtensionDetails(extensionDetailsButton.dataset.extensionDetails, extensionDetailsButton.dataset.extensionType);
            } catch (error) {
                state.errors.push({ key: 'extension-details', message: error.message });
                showToast('扩展状态读取失败', error.message);
            }
            return;
        }

        const refreshExtensionDetailsButton = event.target.closest('[data-refresh-extension-details]');
        if (refreshExtensionDetailsButton) {
            try {
                await loadExtensionDetails(refreshExtensionDetailsButton.dataset.refreshExtensionDetails, refreshExtensionDetailsButton.dataset.extensionType);
            } catch (error) {
                state.errors.push({ key: 'extension-details-refresh', message: error.message });
                showToast('扩展状态刷新失败', error.message);
            }
            return;
        }

        const loadExtensionBranchesButton = event.target.closest('[data-load-extension-branches]');
        if (loadExtensionBranchesButton) {
            try {
                await loadExtensionDetails(loadExtensionBranchesButton.dataset.loadExtensionBranches, loadExtensionBranchesButton.dataset.extensionType, { branches: true });
            } catch (error) {
                state.errors.push({ key: 'extension-branches', message: error.message });
                showToast('扩展分支读取失败', error.message);
            }
            return;
        }

        if (event.target.closest('[data-switch-extension-branch]')) {
            try {
                await switchExtensionBranch();
            } catch (error) {
                state.errors.push({ key: 'extension-switch', message: error.message });
                showToast('扩展分支切换失败', error.message);
                state.extensionDetails.loading = false;
                render();
            }
            return;
        }

        const extensionActionButton = event.target.closest('[data-extension-action]');
        if (extensionActionButton) {
            beginExtensionOperation(extensionActionButton.dataset.extensionName, extensionActionButton.dataset.extensionType, extensionActionButton.dataset.extensionAction);
            return;
        }

        if (event.target.closest('[data-cancel-extension-operation]')) {
            cancelExtensionOperation();
            return;
        }

        if (event.target.closest('[data-confirm-extension-operation]')) {
            try {
                await confirmExtensionOperation();
            } catch (error) {
                state.errors.push({ key: 'extension-operation', message: error.message });
                showToast('扩展操作失败', error.message);
                cancelExtensionOperation();
            }
            return;
        }

        return false;
    }

    function handleExtensionsInput(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-extension-install-url]')) {
            const hadError = Boolean(state.extensionInstall.urlError);
            const cursor = event.target.selectionStart ?? event.target.value.length;
            state.extensionInstall.url = event.target.value;
            state.extensionInstall.urlError = '';
            if (hadError) {
                render();
                const input = document.querySelector('[data-extension-install-url]');
                if (input instanceof HTMLInputElement) {
                    input.focus();
                    input.setSelectionRange(cursor, cursor);
                }
            }
        }

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-extension-install-branch]')) {
            state.extensionInstall.branch = event.target.value;
        }

        if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) && event.target.matches('[data-extension-branch]')) {
            state.extensionDetails.branch = event.target.value;
        }

        return false;
    }

    function handleExtensionsChange(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-extension-install-global]')) {
            state.extensionInstall.global = event.target.checked;
            return;
        }

        if (event.target instanceof HTMLSelectElement && event.target.matches('[data-extension-branch]')) {
            state.extensionDetails.branch = event.target.value;
            render();
            return;
        }

        return false;
    }

    return {
        handleExtensionsClick,
        handleExtensionsInput,
        handleExtensionsChange,
    };
}
