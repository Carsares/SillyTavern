export function createRemoteResourceEvents(ctx) {
    const {
        state,
        render,
        showToast,
        cancelPresetImport,
        deleteRemoteProviderCredential,
        deleteRemoteRecord,
        downloadRemoteResource,
        importPresetWithType,
        importRemoteResource,
        importRemoteUrl,
        refreshRemoteResources,
        saveRemoteProviderCredential,
        searchRemoteResources,
        setRemoteCredentialDraft,
        setRemoteResourceQuery,
        setRemoteResourceTab,
        setRemoteResourceType,
        setRemoteUrlImport,
        toggleProviderEnabled,
        toggleRemoteProvider,
    } = ctx;

    async function handleRemoteResourcesClick(event) {
        const tabButton = event.target.closest('[data-remote-resource-tab]');
        if (tabButton) {
            setRemoteResourceTab(tabButton.dataset.remoteResourceTab);
            return;
        }

        if (event.target.closest('[data-refresh-remote-resources]')) {
            await runRemoteAction('remote-refresh', '远程资源刷新失败', () => refreshRemoteResources());
            return;
        }

        if (event.target.closest('[data-search-remote-resources]')) {
            await runRemoteAction('remote-search', '远程搜索失败', () => searchRemoteResources());
            return;
        }

        if (event.target.closest('[data-import-remote-url]')) {
            await runRemoteAction('remote-url-import', '远程 URL 导入失败', () => importRemoteUrl());
            return;
        }

        const importButton = event.target.closest('[data-import-remote-resource]');
        if (importButton) {
            await runRemoteAction('remote-import', '远程资源导入失败', () => importRemoteResource(Number(importButton.dataset.importRemoteResource)));
            return;
        }

        const downloadButton = event.target.closest('[data-download-remote-resource]');
        if (downloadButton) {
            await runRemoteAction('remote-download', '远程资源下载失败', () => downloadRemoteResource(Number(downloadButton.dataset.downloadRemoteResource)));
            return;
        }

        const confirmPresetButton = event.target.closest('[data-confirm-preset-import]');
        if (confirmPresetButton) {
            const index = Number(confirmPresetButton.dataset.confirmPresetImport);
            // 读同卡片内联 select 选定的 apiId，再确认导入。
            const card = confirmPresetButton.closest('.remote-resource-card');
            const select = card ? card.querySelector('[data-preset-apiid]') : null;
            const apiId = select ? select.value : '';
            await runRemoteAction('remote-preset-import', '预设导入失败', () => importPresetWithType(index, apiId));
            return;
        }

        if (event.target.closest('[data-cancel-preset-import]')) {
            cancelPresetImport();
            return;
        }

        const saveCredentialButton = event.target.closest('[data-save-remote-credential]');
        if (saveCredentialButton) {
            const providerId = saveCredentialButton.dataset.providerId;
            const credentialId = saveCredentialButton.dataset.credentialId;
            const value = state.remoteResources.credentialDrafts[`${providerId}:${credentialId}`] || '';
            await runRemoteAction('remote-credential-save', '资源站凭据保存失败', () => saveRemoteProviderCredential(providerId, credentialId, value));
            return;
        }

        const deleteCredentialButton = event.target.closest('[data-delete-remote-credential]');
        if (deleteCredentialButton) {
            await runRemoteAction('remote-credential-delete', '资源站凭据删除失败', () => deleteRemoteProviderCredential(deleteCredentialButton.dataset.providerId, deleteCredentialButton.dataset.credentialId));
            return;
        }

        const deleteRecordButton = event.target.closest('[data-delete-remote-record]');
        if (deleteRecordButton) {
            await runRemoteAction('remote-record-delete', '导入记录删除失败', () => deleteRemoteRecord(deleteRecordButton.dataset.deleteRemoteRecord));
            return;
        }

        return false;
    }

    function handleRemoteResourcesInput(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-remote-resource-query]')) {
            setRemoteResourceQuery(event.target.value);
            return;
        }

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-remote-url-import]')) {
            setRemoteUrlImport(event.target.value);
            return;
        }

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-remote-credential-provider]')) {
            setRemoteCredentialDraft(event.target.dataset.remoteCredentialProvider, event.target.dataset.remoteCredentialId, event.target.value);
            return;
        }

        return false;
    }

    function handleRemoteResourcesChange(event) {
        if (event.target instanceof HTMLSelectElement && event.target.matches('[data-remote-resource-type]')) {
            setRemoteResourceType(event.target.value);
            return;
        }

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-remote-provider]')) {
            toggleRemoteProvider(event.target.dataset.remoteProvider, event.target.checked);
            return;
        }

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-toggle-provider-enabled]')) {
            const providerId = event.target.dataset.providerId;
            const enabled = event.target.checked;
            runRemoteAction('remote-provider-toggle', '资源站启用状态更新失败', () => toggleProviderEnabled(providerId, enabled));
            return;
        }

        return false;
    }

    function handleRemoteResourcesKeydown(event) {
        if (event.key !== 'Enter') {
            return false;
        }

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-remote-resource-query]')) {
            event.preventDefault();
            runRemoteAction('remote-search', '远程搜索失败', () => searchRemoteResources());
            return;
        }

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-remote-url-import]')) {
            event.preventDefault();
            runRemoteAction('remote-url-import', '远程 URL 导入失败', () => importRemoteUrl());
            return;
        }

        return false;
    }

    async function runRemoteAction(key, title, action) {
        try {
            await action();
        } catch (error) {
            state.errors.push({ key, message: error.message });
            showToast(title, error.message);
            state.remoteResources.operation = { key: '', running: false };
            state.remoteResources.searching = false;
            state.remoteResources.loading = false;
            state.remoteResources.urlImport.running = false;
            state.remoteResources.credentialSaving = '';
            render();
        }
    }

    return {
        handleRemoteResourcesChange,
        handleRemoteResourcesClick,
        handleRemoteResourcesInput,
        handleRemoteResourcesKeydown,
    };
}
