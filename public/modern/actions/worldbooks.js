import { createWorldbookEntryDataHelpers } from './worldbook-entry-data.js';

export function createWorldbookActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
    downloadFile,
    arrayToEntryInput,
    entryInputToArray,
    formatNumber,
    normalizeText,
    numberInput,
    setObjectPath,
    worldEntryDefaults,
}) {
    const {
        createWorldEntry,
        deleteWorldEntryOriginalData,
        formToWorldEntry,
        getFreeWorldEntryUid,
        getWorldEntryTitle,
        syncWorldEntryOriginalData,
        worldEntryToForm,
    } = createWorldbookEntryDataHelpers({
        arrayToEntryInput,
        entryInputToArray,
        numberInput,
        setObjectPath,
        worldEntryDefaults,
    });

    async function loadWorldDetail(worldbookId, { force = false } = {}) {
        if (!worldbookId || (state.worldDetails[worldbookId] && !force)) {
            return state.worldDetails[worldbookId] || null;
        }

        try {
            state.worldDetails[worldbookId] = await apiFetch('/api/worldinfo/get', { body: { name: worldbookId } });
            return state.worldDetails[worldbookId];
        } catch (error) {
            state.errors.push({ key: 'worldbook', message: error.message });
            showToast('世界书读取失败', error.message);
            return null;
        }
    }

    function getGlobalWorldNames() {
        return state.settings.world_info_settings?.world_info?.globalSelect || [];
    }

    function isGlobalWorldEnabled(worldbookId) {
        return getGlobalWorldNames().includes(worldbookId);
    }

    async function toggleGlobalWorld(worldbookId) {
        if (!worldbookId) {
            return;
        }

        state.settings.world_info_settings = state.settings.world_info_settings || {};
        state.settings.world_info_settings.world_info = state.settings.world_info_settings.world_info || {};
        const globalWorlds = getGlobalWorldNames();
        const nextGlobalWorlds = globalWorlds.includes(worldbookId)
            ? globalWorlds.filter(name => name !== worldbookId)
            : [...globalWorlds, worldbookId];

        state.settings.world_info_settings.world_info.globalSelect = nextGlobalWorlds;
        await apiFetch('/api/settings/save', { body: state.settings });
        await loadData({ silent: true });
        showToast(nextGlobalWorlds.includes(worldbookId) ? '世界书已启用' : '世界书已停用', worldbookId);
    }

    async function toggleWorldEntry(worldbookId, entryKey) {
        if (!worldbookId || entryKey === undefined) {
            return;
        }

        await loadWorldDetail(worldbookId);
        const detail = state.worldDetails[worldbookId];
        const nextDetail = structuredClone(detail);
        const entry = nextDetail?.entries?.[entryKey];
        if (!entry) {
            throw new Error('世界书条目不存在，请刷新后重试。');
        }

        entry.disable = !entry.disable;
        syncWorldEntryOriginalData(nextDetail, Number(entryKey), entry);
        await saveWorldbookDetail(worldbookId, nextDetail);
        showToast(entry.disable ? '条目已禁用' : '条目已启用', entry.comment || entry.name || entryKey);
        render();
    }

    function getWorldEntryListState(worldbookId) {
        if (state.worldEntryList.worldbookId !== worldbookId) {
            state.worldEntryList = { worldbookId, query: '', sort: 'order', page: 1, selectedKeys: [] };
        }
        return state.worldEntryList;
    }

    function updateWorldEntryListField(field, value) {
        state.worldEntryList[field] = value;
        if (field === 'query' || field === 'sort') {
            state.worldEntryList.page = 1;
        }
        render();
    }

    function setWorldEntryPage(page) {
        state.worldEntryList.page = Math.max(1, Number(page) || 1);
        render();
    }

    function toggleWorldEntrySelection(entryKey, checked) {
        const keys = new Set(state.worldEntryList.selectedKeys);
        if (checked) {
            keys.add(String(entryKey));
        } else {
            keys.delete(String(entryKey));
        }
        state.worldEntryList.selectedKeys = [...keys];
        render();
    }

    function getWorldEntrySearchText(entryKey, entry) {
        return normalizeText([
            entryKey,
            entry?.comment,
            entry?.name,
            Array.isArray(entry?.key) ? entry.key.join(', ') : entry?.key,
            Array.isArray(entry?.keysecondary) ? entry.keysecondary.join(', ') : entry?.keysecondary,
            entry?.content,
        ].filter(Boolean).join(' '));
    }

    function sortWorldEntries(entries, sort) {
        const sortedEntries = [...entries];
        sortedEntries.sort(([leftKey, leftEntry], [rightKey, rightEntry]) => {
            if (sort === 'comment') {
                return getWorldEntryTitle(leftEntry, leftKey).localeCompare(getWorldEntryTitle(rightEntry, rightKey), 'zh-Hans-CN');
            }
            if (sort === 'status') {
                return Number(!!leftEntry.disable) - Number(!!rightEntry.disable) || Number(leftKey) - Number(rightKey);
            }
            if (sort === 'key') {
                const leftValue = Array.isArray(leftEntry.key) ? leftEntry.key.join(', ') : String(leftEntry.key || '');
                const rightValue = Array.isArray(rightEntry.key) ? rightEntry.key.join(', ') : String(rightEntry.key || '');
                return leftValue.localeCompare(rightValue, 'zh-Hans-CN') || Number(leftKey) - Number(rightKey);
            }
            return Number(leftEntry.order ?? 0) - Number(rightEntry.order ?? 0) || Number(leftKey) - Number(rightKey);
        });
        return sortedEntries;
    }

    function getVisibleWorldEntries(entries, listState) {
        const query = normalizeText(listState.query);
        const filteredEntries = query
            ? entries.filter(([entryKey, entry]) => getWorldEntrySearchText(entryKey, entry).includes(query))
            : entries;
        return sortWorldEntries(filteredEntries, listState.sort);
    }

    async function setSelectedWorldEntriesDisabled(worldbookId, disabled) {
        const selectedKeys = [...state.worldEntryList.selectedKeys];
        if (!selectedKeys.length) {
            throw new Error('请先选择世界书条目。');
        }

        await loadWorldDetail(worldbookId);
        const detail = state.worldDetails[worldbookId];
        const nextDetail = structuredClone(detail);
        let changedCount = 0;
        for (const entryKey of selectedKeys) {
            const entry = nextDetail?.entries?.[entryKey];
            if (!entry || entry.disable === disabled) {
                continue;
            }
            entry.disable = disabled;
            syncWorldEntryOriginalData(nextDetail, Number(entryKey), entry);
            changedCount++;
        }
        if (!changedCount) {
            showToast('条目未变更', disabled ? '所选条目已经禁用。' : '所选条目已经启用。');
            return;
        }

        await saveWorldbookDetail(worldbookId, nextDetail);
        state.worldEntryList.selectedKeys = [];
        showToast(disabled ? '条目已批量禁用' : '条目已批量启用', `${formatNumber(changedCount)} 个条目`);
        render();
    }

    function beginWorldEntryBulkDelete(worldbookId) {
        if (!state.worldEntryList.selectedKeys.length) {
            throw new Error('请先选择世界书条目。');
        }

        state.worldEntryBulkDeleteConfirm = { worldbookId };
        state.worldEntryDeleteConfirm = { worldbookId: '', entryKey: '' };
        state.worldEntryEditing = { worldbookId: '', entryKey: '', mode: '', form: {} };
        render();
    }

    function cancelWorldEntryBulkDelete() {
        state.worldEntryBulkDeleteConfirm = { worldbookId: '' };
        render();
    }

    async function confirmWorldEntryBulkDelete() {
        const worldbookId = state.worldEntryBulkDeleteConfirm.worldbookId;
        const selectedKeys = [...state.worldEntryList.selectedKeys];
        if (!worldbookId || !selectedKeys.length) {
            throw new Error('请先选择世界书条目。');
        }

        await loadWorldDetail(worldbookId);
        const detail = state.worldDetails[worldbookId];
        const nextDetail = structuredClone(detail);
        let deletedCount = 0;
        for (const entryKey of selectedKeys) {
            if (!nextDetail?.entries?.[entryKey]) {
                continue;
            }
            delete nextDetail.entries[entryKey];
            deleteWorldEntryOriginalData(nextDetail, entryKey);
            deletedCount++;
        }
        if (!deletedCount) {
            throw new Error('所选条目已经不存在，请刷新后重试。');
        }

        await saveWorldbookDetail(worldbookId, nextDetail);
        state.worldEntryList.selectedKeys = [];
        state.worldEntryBulkDeleteConfirm = { worldbookId: '' };
        showToast('条目已批量删除', `${formatNumber(deletedCount)} 个条目`);
        render();
    }

    async function saveWorldbookDetail(worldbookId, detail) {
        await apiFetch('/api/worldinfo/edit', { body: { name: worldbookId, data: detail } });
        state.worldDetails[worldbookId] = detail;
    }

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

    async function beginWorldEntryCreate(worldbookId) {
        await loadWorldDetail(worldbookId);
        const detail = state.worldDetails[worldbookId];
        detail.entries = detail.entries || {};
        const uid = getFreeWorldEntryUid(detail);
        if (!Number.isInteger(uid)) {
            showToast('新增失败', '无法分配世界书条目 UID。');
            return;
        }

        state.worldEntryEditing = {
            worldbookId,
            entryKey: String(uid),
            mode: 'create',
            form: worldEntryToForm(createWorldEntry(uid)),
        };
        state.worldEntryDeleteConfirm = { worldbookId: '', entryKey: '' };
        render();
    }

    async function beginWorldEntryEdit(worldbookId, entryKey) {
        await loadWorldDetail(worldbookId);
        const entry = state.worldDetails[worldbookId]?.entries?.[entryKey];
        if (!entry) {
            showToast('编辑失败', '世界书条目不存在，请刷新后重试。');
            return;
        }

        state.worldEntryEditing = {
            worldbookId,
            entryKey,
            mode: 'edit',
            form: worldEntryToForm(entry),
        };
        state.worldEntryDeleteConfirm = { worldbookId: '', entryKey: '' };
        render();
    }

    function cancelWorldEntryEdit() {
        state.worldEntryEditing = { worldbookId: '', entryKey: '', mode: '', form: {} };
        render();
    }

    async function saveWorldEntryEdit() {
        const edit = state.worldEntryEditing;
        const form = edit.form || {};
        if (!edit.worldbookId || edit.entryKey === '') {
            throw new Error('世界书条目目标无效。');
        }

        await loadWorldDetail(edit.worldbookId);
        const detail = state.worldDetails[edit.worldbookId];
        const nextDetail = structuredClone(detail);
        const uid = Number(edit.entryKey);
        const entry = nextDetail?.entries?.[edit.entryKey];
        if (edit.mode !== 'create' && !entry) {
            throw new Error('世界书条目不存在，请刷新后重试。');
        }

        nextDetail.entries = nextDetail.entries || {};
        nextDetail.entries[edit.entryKey] = formToWorldEntry(form, uid, entry || createWorldEntry(uid));
        syncWorldEntryOriginalData(nextDetail, uid, nextDetail.entries[edit.entryKey]);
        await saveWorldbookDetail(edit.worldbookId, nextDetail);
        state.worldEntryEditing = { worldbookId: '', entryKey: '', mode: '', form: {} };
        showToast(edit.mode === 'create' ? '条目已创建' : '条目已保存', getWorldEntryTitle(nextDetail.entries[edit.entryKey], edit.entryKey));
        render();
    }

    async function duplicateWorldEntry(worldbookId, entryKey) {
        await loadWorldDetail(worldbookId);
        const detail = state.worldDetails[worldbookId];
        const source = detail?.entries?.[entryKey];
        const uid = getFreeWorldEntryUid(detail);
        if (!source || !Number.isInteger(uid)) {
            throw new Error('无法复制这个世界书条目。');
        }

        const nextDetail = structuredClone(detail);
        const copiedEntry = structuredClone(source);
        copiedEntry.uid = uid;
        nextDetail.entries[String(uid)] = copiedEntry;
        await saveWorldbookDetail(worldbookId, nextDetail);
        showToast('条目已复制', getWorldEntryTitle(copiedEntry, uid));
        render();
    }

    function beginWorldEntryDelete(worldbookId, entryKey) {
        state.worldEntryDeleteConfirm = { worldbookId, entryKey };
        state.worldEntryEditing = { worldbookId: '', entryKey: '', mode: '', form: {} };
        render();
    }

    function cancelWorldEntryDelete() {
        state.worldEntryDeleteConfirm = { worldbookId: '', entryKey: '' };
        render();
    }

    function updateWorldEntryFormField(element) {
        if (!state.worldEntryEditing.worldbookId) {
            return;
        }

        const field = element.dataset.worldEntryField;
        if (!field) {
            return;
        }

        state.worldEntryEditing.form = state.worldEntryEditing.form || {};
        state.worldEntryEditing.form[field] = element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element.value;
    }

    async function confirmWorldEntryDelete() {
        const { worldbookId, entryKey } = state.worldEntryDeleteConfirm;
        if (!worldbookId || entryKey === '') {
            throw new Error('删除目标已变化，请重新选择条目。');
        }

        await loadWorldDetail(worldbookId);
        const detail = state.worldDetails[worldbookId];
        const entry = detail?.entries?.[entryKey];
        if (!entry) {
            throw new Error('世界书条目不存在，请刷新后重试。');
        }

        const nextDetail = structuredClone(detail);
        delete nextDetail.entries[entryKey];
        deleteWorldEntryOriginalData(nextDetail, entryKey);
        await saveWorldbookDetail(worldbookId, nextDetail);
        state.worldEntryDeleteConfirm = { worldbookId: '', entryKey: '' };
        showToast('条目已删除', getWorldEntryTitle(entry, entryKey));
        render();
    }

    return {
        loadWorldDetail,
        isGlobalWorldEnabled,
        toggleGlobalWorld,
        toggleWorldEntry,
        getWorldEntryListState,
        updateWorldEntryListField,
        setWorldEntryPage,
        toggleWorldEntrySelection,
        getVisibleWorldEntries,
        setSelectedWorldEntriesDisabled,
        beginWorldEntryBulkDelete,
        cancelWorldEntryBulkDelete,
        confirmWorldEntryBulkDelete,
        getWorldEntryTitle,
        createWorldEntry,
        worldEntryToForm,
        beginWorldbookCreate,
        cancelWorldbookCreate,
        saveWorldbookCreate,
        importWorldbookFile,
        exportWorldbook,
        beginWorldbookDelete,
        cancelWorldbookDelete,
        confirmWorldbookDelete,
        beginWorldEntryCreate,
        beginWorldEntryEdit,
        cancelWorldEntryEdit,
        saveWorldEntryEdit,
        duplicateWorldEntry,
        beginWorldEntryDelete,
        cancelWorldEntryDelete,
        updateWorldEntryFormField,
        confirmWorldEntryDelete,
    };
}
