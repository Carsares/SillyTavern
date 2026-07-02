export function createGroupsEvents(ctx) {
    const {
        state,
        render,
        showToast,
        beginGroupCreate,
        cancelGroupCreate,
        saveGroupCreate,
        beginGroupEdit,
        cancelGroupEdit,
        saveGroupEdit,
        beginGroupDelete,
        cancelGroupDelete,
        confirmGroupDelete,
        updateGroupFormField,
        toggleGroupFormMember,
    } = ctx;

    async function handleGroupsClick(event) {
        if (event.target.closest('[data-create-group]')) {
            beginGroupCreate();
            return;
        }

        if (event.target.closest('[data-cancel-group-create]')) {
            cancelGroupCreate();
            return;
        }

        if (event.target.closest('[data-save-group-create]')) {
            try {
                await saveGroupCreate();
            } catch (error) {
                state.errors.push({ key: 'group-create', message: error.message });
                showToast('群组创建失败', error.message);
                render();
            }
            return;
        }

        const editGroupButton = event.target.closest('[data-edit-group]');
        if (editGroupButton) {
            beginGroupEdit(editGroupButton.dataset.editGroup);
            return;
        }

        if (event.target.closest('[data-cancel-group-edit]')) {
            cancelGroupEdit();
            return;
        }

        if (event.target.closest('[data-save-group-edit]')) {
            try {
                await saveGroupEdit();
            } catch (error) {
                state.errors.push({ key: 'group-edit', message: error.message });
                showToast('群组保存失败', error.message);
                render();
            }
            return;
        }

        const deleteGroupButton = event.target.closest('[data-delete-group]');
        if (deleteGroupButton) {
            const group = state.groups.find(item => item.id === deleteGroupButton.dataset.deleteGroup);
            if (group) {
                beginGroupDelete(group);
            }
            return;
        }

        if (event.target.closest('[data-cancel-group-delete]')) {
            cancelGroupDelete();
            return;
        }

        if (event.target.closest('[data-confirm-group-delete]')) {
            try {
                await confirmGroupDelete();
            } catch (error) {
                state.errors.push({ key: 'group-delete', message: error.message });
                showToast('群组删除失败', error.message);
                render();
            }
            return;
        }

        return false;
    }

    function handleGroupsInput(event) {
        if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) && event.target.matches('[data-group-field]')) {
            updateGroupFormField(event.target);
        }

        return false;
    }

    function handleGroupsChange(event) {
        if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) && event.target.matches('[data-group-field]')) {
            updateGroupFormField(event.target);
        }

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-group-member]')) {
            toggleGroupFormMember(event.target.dataset.groupScope, event.target.dataset.groupMember, event.target.checked);
            return;
        }

        return false;
    }

    return {
        handleGroupsClick,
        handleGroupsInput,
        handleGroupsChange,
    };
}
