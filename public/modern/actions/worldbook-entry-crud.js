export function createWorldbookEntryCrudActions({
    state,
    loadWorldDetail,
    updateWorldbookDetail,
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
        const edit = structuredClone(state.worldEntryEditing);
        const form = edit.form || {};
        if (!edit.worldbookId || edit.entryKey === '') {
            throw new Error('世界书条目目标无效。');
        }

        const result = await updateWorldbookDetail(edit.worldbookId, nextDetail => {
            nextDetail.entries = nextDetail.entries || {};
            let entryKey = edit.entryKey;
            let entry = nextDetail.entries[entryKey];
            if (edit.mode !== 'create' && !entry) {
                throw new Error('世界书条目不存在，请刷新后重试。');
            }
            if (edit.mode === 'create' && entry) {
                const nextUid = getFreeWorldEntryUid(nextDetail);
                if (!Number.isInteger(nextUid)) {
                    throw new Error('无法分配世界书条目 UID。');
                }
                entryKey = String(nextUid);
                entry = null;
            }

            const uid = Number(entryKey);
            nextDetail.entries[entryKey] = formToWorldEntry(form, uid, entry || createWorldEntry(uid));
            syncWorldEntryOriginalData(nextDetail, uid, nextDetail.entries[entryKey]);
            return { title: getWorldEntryTitle(nextDetail.entries[entryKey], entryKey) };
        });
        if (state.worldEntryEditing.worldbookId === edit.worldbookId && state.worldEntryEditing.entryKey === edit.entryKey && state.worldEntryEditing.mode === edit.mode) {
            state.worldEntryEditing = { worldbookId: '', entryKey: '', mode: '', form: {} };
        }
        showToast(edit.mode === 'create' ? '条目已创建' : '条目已保存', result.title);
        render();
    }

    async function duplicateWorldEntry(worldbookId, entryKey) {
        const result = await updateWorldbookDetail(worldbookId, nextDetail => {
            const source = nextDetail?.entries?.[entryKey];
            const uid = getFreeWorldEntryUid(nextDetail);
            if (!source || !Number.isInteger(uid)) {
                throw new Error('无法复制这个世界书条目。');
            }

            const copiedEntry = structuredClone(source);
            copiedEntry.uid = uid;
            nextDetail.entries[String(uid)] = copiedEntry;
            return { title: getWorldEntryTitle(copiedEntry, uid) };
        });
        showToast('条目已复制', result.title);
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

        const result = await updateWorldbookDetail(worldbookId, nextDetail => {
            const entry = nextDetail?.entries?.[entryKey];
            if (!entry) {
                throw new Error('世界书条目不存在，请刷新后重试。');
            }

            delete nextDetail.entries[entryKey];
            deleteWorldEntryOriginalData(nextDetail, entryKey);
            return { title: getWorldEntryTitle(entry, entryKey) };
        });
        state.worldEntryDeleteConfirm = { worldbookId: '', entryKey: '' };
        showToast('条目已删除', result.title);
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
