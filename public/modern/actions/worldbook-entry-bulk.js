export function createWorldbookEntryBulkActions({
    state,
    updateWorldbookDetail,
    render,
    showToast,
    formatNumber,
    syncWorldEntryOriginalData,
    deleteWorldEntryOriginalData,
}) {
    async function toggleWorldEntry(worldbookId, entryKey) {
        if (!worldbookId || entryKey === undefined) {
            return;
        }

        const result = await updateWorldbookDetail(worldbookId, nextDetail => {
            const entry = nextDetail?.entries?.[entryKey];
            if (!entry) {
                throw new Error('世界书条目不存在，请刷新后重试。');
            }

            entry.disable = !entry.disable;
            syncWorldEntryOriginalData(nextDetail, Number(entryKey), entry);
            return { disabled: entry.disable, title: entry.comment || entry.name || entryKey };
        });
        showToast(result.disabled ? '条目已禁用' : '条目已启用', result.title);
        render();
    }

    async function setSelectedWorldEntriesDisabled(worldbookId, disabled) {
        const selectedKeys = [...state.worldEntryList.selectedKeys];
        if (!selectedKeys.length) {
            throw new Error('请先选择世界书条目。');
        }

        const result = await updateWorldbookDetail(worldbookId, nextDetail => {
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
            return { changedCount, save: changedCount > 0 };
        });
        if (!result.changedCount) {
            showToast('条目未变更', disabled ? '所选条目已经禁用。' : '所选条目已经启用。');
            return;
        }

        state.worldEntryList.selectedKeys = [];
        showToast(disabled ? '条目已批量禁用' : '条目已批量启用', `${formatNumber(result.changedCount)} 个条目`);
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

        const result = await updateWorldbookDetail(worldbookId, nextDetail => {
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
            return { deletedCount };
        });

        state.worldEntryList.selectedKeys = [];
        state.worldEntryBulkDeleteConfirm = { worldbookId: '' };
        showToast('条目已批量删除', `${formatNumber(result.deletedCount)} 个条目`);
        render();
    }

    return {
        toggleWorldEntry,
        setSelectedWorldEntriesDisabled,
        beginWorldEntryBulkDelete,
        cancelWorldEntryBulkDelete,
        confirmWorldEntryBulkDelete,
    };
}
