export function createWorldbooksEvents(ctx) {
    const {
        state,
        render,
        showToast,
        loadWorldDetail,
        beginWorldbookCreate,
        cancelWorldbookCreate,
        saveWorldbookCreate,
        exportWorldbook,
        toggleGlobalWorld,
        beginWorldbookDelete,
        cancelWorldbookDelete,
        confirmWorldbookDelete,
        beginWorldEntryCreate,
        toggleWorldEntry,
        setWorldEntryPage,
        setSelectedWorldEntriesDisabled,
        beginWorldEntryBulkDelete,
        cancelWorldEntryBulkDelete,
        confirmWorldEntryBulkDelete,
        duplicateWorldEntry,
        beginWorldEntryDelete,
        cancelWorldEntryDelete,
        confirmWorldEntryDelete,
        beginWorldEntryEdit,
        cancelWorldEntryEdit,
        saveWorldEntryEdit,
        updateWorldEntryListField,
        updateWorldEntryFormField,
        importWorldbookFile,
        toggleWorldEntrySelection,
    } = ctx;

    async function handleWorldbooksClick(event) {
        const worldbookButton = event.target.closest('[data-select-worldbook]');
        if (worldbookButton) {
            state.selected.worldbook = worldbookButton.dataset.selectWorldbook;
            await loadWorldDetail(state.selected.worldbook);
            render();
            return;
        }

        if (event.target.closest('[data-create-worldbook]')) {
            beginWorldbookCreate();
            return;
        }

        if (event.target.closest('[data-cancel-worldbook-create]')) {
            cancelWorldbookCreate();
            return;
        }

        if (event.target.closest('[data-save-worldbook-create]')) {
            try {
                await saveWorldbookCreate();
            } catch (error) {
                state.errors.push({ key: 'worldbook-create', message: error.message });
                showToast('世界书创建失败', error.message);
                render();
            }
            return;
        }

        const loadWorldbookButton = event.target.closest('[data-load-worldbook]');
        if (loadWorldbookButton) {
            await loadWorldDetail(loadWorldbookButton.dataset.loadWorldbook, { force: true });
            render();
            return;
        }

        const exportWorldbookButton = event.target.closest('[data-export-worldbook]');
        if (exportWorldbookButton) {
            try {
                await exportWorldbook(exportWorldbookButton.dataset.exportWorldbook);
            } catch (error) {
                state.errors.push({ key: 'worldbook-export', message: error.message });
                showToast('世界书导出失败', error.message);
                render();
            }
            return;
        }

        const toggleWorldGlobalButton = event.target.closest('[data-toggle-world-global]');
        if (toggleWorldGlobalButton) {
            try {
                await toggleGlobalWorld(toggleWorldGlobalButton.dataset.toggleWorldGlobal);
            } catch (error) {
                state.errors.push({ key: 'worldbook', message: error.message });
                showToast('世界书切换失败', error.message);
                render();
            }
            return;
        }

        const deleteWorldbookButton = event.target.closest('[data-delete-worldbook]');
        if (deleteWorldbookButton) {
            beginWorldbookDelete(deleteWorldbookButton.dataset.deleteWorldbook);
            return;
        }

        if (event.target.closest('[data-cancel-worldbook-delete]')) {
            cancelWorldbookDelete();
            return;
        }

        if (event.target.closest('[data-confirm-worldbook-delete]')) {
            try {
                await confirmWorldbookDelete();
            } catch (error) {
                state.errors.push({ key: 'worldbook-delete', message: error.message });
                showToast('世界书删除失败', error.message);
                render();
            }
            return;
        }

        const createWorldEntryButton = event.target.closest('[data-create-world-entry]');
        if (createWorldEntryButton) {
            await beginWorldEntryCreate(createWorldEntryButton.dataset.createWorldEntry);
            return;
        }

        const toggleWorldEntryButton = event.target.closest('[data-toggle-world-entry]');
        if (toggleWorldEntryButton) {
            try {
                await toggleWorldEntry(toggleWorldEntryButton.dataset.toggleWorldEntry, toggleWorldEntryButton.dataset.worldEntryKey);
            } catch (error) {
                state.errors.push({ key: 'worldbook-entry', message: error.message });
                showToast('条目切换失败', error.message);
                render();
            }
            return;
        }

        const worldEntryPageButton = event.target.closest('[data-world-entry-page]');
        if (worldEntryPageButton) {
            setWorldEntryPage(worldEntryPageButton.dataset.worldEntryPage);
            return;
        }

        const bulkWorldEntryButton = event.target.closest('[data-bulk-world-entries]');
        if (bulkWorldEntryButton) {
            try {
                await setSelectedWorldEntriesDisabled(state.selected.worldbook, bulkWorldEntryButton.dataset.bulkWorldEntries === 'disable');
            } catch (error) {
                state.errors.push({ key: 'worldbook-entry-bulk', message: error.message });
                showToast('批量操作失败', error.message);
                render();
            }
            return;
        }

        if (event.target.closest('[data-delete-selected-world-entries]')) {
            try {
                beginWorldEntryBulkDelete(state.selected.worldbook);
            } catch (error) {
                showToast('请选择条目', error.message);
            }
            return;
        }

        if (event.target.closest('[data-cancel-world-entry-bulk-delete]')) {
            cancelWorldEntryBulkDelete();
            return;
        }

        if (event.target.closest('[data-confirm-world-entry-bulk-delete]')) {
            try {
                await confirmWorldEntryBulkDelete();
            } catch (error) {
                state.errors.push({ key: 'worldbook-entry-bulk-delete', message: error.message });
                showToast('批量删除失败', error.message);
                render();
            }
            return;
        }

        const copyWorldEntryButton = event.target.closest('[data-copy-world-entry]');
        if (copyWorldEntryButton) {
            try {
                await duplicateWorldEntry(copyWorldEntryButton.dataset.copyWorldEntry, copyWorldEntryButton.dataset.worldEntryKey);
            } catch (error) {
                state.errors.push({ key: 'worldbook-entry-copy', message: error.message });
                showToast('条目复制失败', error.message);
                render();
            }
            return;
        }

        const deleteWorldEntryButton = event.target.closest('[data-delete-world-entry]');
        if (deleteWorldEntryButton) {
            beginWorldEntryDelete(deleteWorldEntryButton.dataset.deleteWorldEntry, deleteWorldEntryButton.dataset.worldEntryKey);
            return;
        }

        if (event.target.closest('[data-cancel-world-entry-delete]')) {
            cancelWorldEntryDelete();
            return;
        }

        if (event.target.closest('[data-confirm-world-entry-delete]')) {
            try {
                await confirmWorldEntryDelete();
            } catch (error) {
                state.errors.push({ key: 'worldbook-entry-delete', message: error.message });
                showToast('条目删除失败', error.message);
                render();
            }
            return;
        }

        const editWorldEntryButton = event.target.closest('[data-edit-world-entry]');
        if (editWorldEntryButton) {
            await beginWorldEntryEdit(editWorldEntryButton.dataset.editWorldEntry, editWorldEntryButton.dataset.worldEntryKey);
            return;
        }

        if (event.target.closest('[data-cancel-world-entry-edit]')) {
            cancelWorldEntryEdit();
            return;
        }

        if (event.target.closest('[data-save-world-entry-edit]')) {
            try {
                await saveWorldEntryEdit();
            } catch (error) {
                state.errors.push({ key: 'worldbook-entry-edit', message: error.message });
                showToast('条目保存失败', error.message);
                render();
            }
            return;
        }

        return false;
    }

    function handleWorldbooksInput(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-worldbook-create-name]')) {
            state.worldbookCreating.name = event.target.value;
        }

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-world-entry-search]')) {
            updateWorldEntryListField('query', event.target.value);
        }

        if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) && event.target.matches('[data-world-entry-field]')) {
            updateWorldEntryFormField(event.target);
        }

        return false;
    }

    async function handleWorldbooksChange(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-worldbook-import-file]')) {
            try {
                await importWorldbookFile(event.target.files?.[0]);
            } catch (error) {
                state.errors.push({ key: 'worldbook-import', message: error.message });
                showToast('世界书导入失败', error.message);
                render();
            } finally {
                event.target.value = '';
            }
            return;
        }

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-world-entry-select]')) {
            toggleWorldEntrySelection(event.target.dataset.worldEntrySelect, event.target.checked);
            return;
        }

        if (event.target instanceof HTMLSelectElement && event.target.matches('[data-world-entry-sort]')) {
            updateWorldEntryListField('sort', event.target.value);
            return;
        }

        if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) && event.target.matches('[data-world-entry-field]')) {
            updateWorldEntryFormField(event.target);
        }

        return false;
    }

    return {
        handleWorldbooksClick,
        handleWorldbooksInput,
        handleWorldbooksChange,
    };
}
