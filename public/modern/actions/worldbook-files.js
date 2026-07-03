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

    async function confirmWorldbookDelete() {
        const worldbookId = state.worldbookDeleteConfirm.worldbookId;
        if (!worldbookId || state.selected.worldbook !== worldbookId) {
            throw new Error('删除目标已变化，请重新选择世界书。');
        }

        await apiFetch('/api/worldinfo/delete', { body: { name: worldbookId } });
        delete state.worldDetails[worldbookId];
        state.worldbookDeleteConfirm = { worldbookId: '' };
        state.worldEntryEditing = { worldbookId: '', entryKey: '', mode: '', form: {} };
        state.worldEntryDeleteConfirm = { worldbookId: '', entryKey: '' };
        const globalWorlds = getGlobalWorldNames();
        if (globalWorlds.includes(worldbookId)) {
            state.settings.world_info_settings.world_info.globalSelect = globalWorlds.filter(name => name !== worldbookId);
            await apiFetch('/api/settings/save', { body: state.settings });
        }
        state.selected.worldbook = '';
        await loadData({ silent: true });
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
