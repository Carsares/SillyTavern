export function createWorldbookEntryCrudActions({
    state,
    loadWorldDetail,
    saveWorldbookDetail,
    render,
    showToast,
    createWorldEntry,
    deleteWorldEntryOriginalData,
    formToWorldEntry,
    getFreeWorldEntryUid,
    getWorldEntryTitle,
    syncWorldEntryOriginalData,
    worldEntryToForm,
}) {
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
