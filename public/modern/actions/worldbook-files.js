export function createWorldbookFileActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
    downloadFile,
    loadWorldDetail,
    getGlobalWorldNames,
}) {
    function beginWorldbookCreate() {
        state.worldbookCreating = { active: true, name: '' };
        render();
    }

    function cancelWorldbookCreate() {
        state.worldbookCreating = { active: false, name: '' };
        render();
    }

    async function saveWorldbookCreate() {
        const name = state.worldbookCreating.name.trim();
        if (!name) {
            throw new Error('世界书名称不能为空。');
        }
        const exists = state.worldbooks.some(worldbook => worldbook.file_id === name) || (state.settingsBundle.world_names || []).includes(name);
        if (exists) {
            throw new Error('同名世界书已存在。');
        }

        const detail = { name, entries: {}, extensions: {} };
        await apiFetch('/api/worldinfo/edit', { body: { name, data: detail } });
        delete state.worldDetails[name];
        state.worldbookCreating = { active: false, name: '' };
        state.selected.worldbook = name;
        await loadData({ silent: true });
        await loadWorldDetail(name);
        showToast('世界书已创建', `${name}.json`);
        render();
    }

    async function importWorldbookFile(file) {
        if (!file) {
            return;
        }
        if (!file.name.toLowerCase().endsWith('.json')) {
            throw new Error('现代页暂只支持导入标准 JSON 世界书。');
        }

        const worldName = file.name.replace(/\.json$/i, '');
        if (state.worldbooks.some(worldbook => worldbook.file_id === worldName)) {
            throw new Error('同名世界书已存在，请先重命名文件或删除旧世界书。');
        }

        const formData = new FormData();
        formData.append('avatar', file);
        const result = await apiFetch('/api/worldinfo/import', { body: formData, omitContentType: true });
        const importedName = result?.name || worldName;
        state.selected.worldbook = importedName;
        delete state.worldDetails[importedName];
        await loadData({ silent: true });
        await loadWorldDetail(importedName);
        showToast('世界书已导入', `${importedName}.json`);
        render();
    }

    async function exportWorldbook(worldbookId) {
        if (!worldbookId) {
            throw new Error('请先选择世界书。');
        }

        await loadWorldDetail(worldbookId);
        const detail = state.worldDetails[worldbookId];
        if (!detail) {
            throw new Error('世界书内容读取失败。');
        }

        downloadFile(JSON.stringify(detail, null, 2), `${worldbookId}.json`, 'application/json');
        showToast('世界书导出已开始', `${worldbookId}.json`);
    }

    function beginWorldbookDelete(worldbookId) {
        state.worldbookDeleteConfirm = { worldbookId };
        state.worldEntryDeleteConfirm = { worldbookId: '', entryKey: '' };
        render();
    }

    function cancelWorldbookDelete() {
        state.worldbookDeleteConfirm = { worldbookId: '' };
        render();
    }

    function clearDeletedWorldbookState(worldbookId, removeGlobal) {
        delete state.worldDetails[worldbookId];
        state.worldbooks = (state.worldbooks || []).filter(worldbook => worldbook.file_id !== worldbookId);
        if (Array.isArray(state.settingsBundle.world_names)) {
            state.settingsBundle.world_names = state.settingsBundle.world_names.filter(name => name !== worldbookId);
        }
        if (state.worldbookDeleteConfirm.worldbookId === worldbookId) {
            state.worldbookDeleteConfirm = { worldbookId: '' };
        }
        if (state.worldEntryEditing.worldbookId === worldbookId) {
            state.worldEntryEditing = { worldbookId: '', entryKey: '', mode: '', form: {} };
        }
        if (state.worldEntryDeleteConfirm.worldbookId === worldbookId) {
            state.worldEntryDeleteConfirm = { worldbookId: '', entryKey: '' };
        }
        if (state.worldEntryBulkDeleteConfirm?.worldbookId === worldbookId) {
            state.worldEntryBulkDeleteConfirm = { worldbookId: '' };
        }
        if (state.worldEntryList?.worldbookId === worldbookId) {
            state.worldEntryList = { worldbookId: '', query: '', sort: 'order', page: 1, selectedKeys: [] };
        }
        if (state.selected.worldbook === worldbookId) {
            state.selected.worldbook = '';
        }
        if (removeGlobal) {
            state.settings.world_info_settings = state.settings.world_info_settings || {};
            state.settings.world_info_settings.world_info = state.settings.world_info_settings.world_info || {};
            state.settings.world_info_settings.world_info.globalSelect = getGlobalWorldNames().filter(name => name !== worldbookId);
        }
    }

    async function confirmWorldbookDelete() {
        const worldbookId = state.worldbookDeleteConfirm.worldbookId;
        if (!worldbookId || state.selected.worldbook !== worldbookId) {
            throw new Error('删除目标已变化，请重新选择世界书。');
        }

        await apiFetch('/api/worldinfo/delete', { body: { name: worldbookId } });
        const globalWorlds = getGlobalWorldNames();
        const removeGlobal = globalWorlds.includes(worldbookId);
        clearDeletedWorldbookState(worldbookId, removeGlobal);

        let settingsError = null;
        if (removeGlobal) {
            try {
                await apiFetch('/api/settings/save', { body: state.settings });
            } catch (error) {
                settingsError = error;
            }
        }

        let refreshError = null;
        try {
            await loadData({ silent: true });
        } catch (error) {
            refreshError = error;
        }
        // Keep the known file deletion reflected even when a secondary refresh or settings save failed.
        clearDeletedWorldbookState(worldbookId, removeGlobal);
        if (settingsError || refreshError) {
            const details = [
                settingsError ? `全局启用设置保存失败：${settingsError.message}` : '',
                refreshError ? `列表刷新失败：${refreshError.message}` : '',
            ].filter(Boolean).join('；');
            throw new Error(`世界书 ${worldbookId}.json 已删除，但${details}`);
        }
        showToast('世界书已删除', `${worldbookId}.json`);
    }

    return {
        beginWorldbookCreate,
        cancelWorldbookCreate,
        saveWorldbookCreate,
        importWorldbookFile,
        exportWorldbook,
        beginWorldbookDelete,
        cancelWorldbookDelete,
        confirmWorldbookDelete,
    };
}
