import { createPersonasComponents } from '../components/personas.js';

export function createPersonasRoute(ctx) {
    const {
        state,
        getPersonas,
        render,
        showToast,
        beginPersonaCreate,
        cancelPersonaCreate,
        savePersonaCreate,
        beginPersonaEdit,
        setDefaultPersona,
        beginPersonaDelete,
        cancelPersonaDelete,
        confirmPersonaDelete,
        cancelPersonaEdit,
        savePersonaEdit,
        updatePersonaFormField,
        replacePersonaAvatar,
    } = ctx;
    const { renderPersonas } = createPersonasComponents(ctx);

    async function handleClick(event) {
        if (event.target.closest('[data-create-persona]')) {
            beginPersonaCreate();
            return;
        }

        if (event.target.closest('[data-cancel-persona-create]')) {
            cancelPersonaCreate();
            return;
        }

        if (event.target.closest('[data-save-persona-create]')) {
            try {
                await savePersonaCreate();
            } catch (error) {
                state.errors.push({ key: 'persona-create', message: error.message });
                showToast('用户人设创建失败', error.message);
                render();
            }
            return;
        }

        const editPersonaButton = event.target.closest('[data-edit-persona]');
        if (editPersonaButton) {
            const persona = getPersonas().find(item => item.avatarId === editPersonaButton.dataset.editPersona);
            if (persona) {
                beginPersonaEdit(persona);
            }
            return;
        }

        const defaultPersonaButton = event.target.closest('[data-set-default-persona]');
        if (defaultPersonaButton) {
            try {
                await setDefaultPersona(defaultPersonaButton.dataset.setDefaultPersona);
            } catch (error) {
                state.errors.push({ key: 'persona-default', message: error.message });
                showToast('默认人设保存失败', error.message);
                render();
            }
            return;
        }

        const deletePersonaButton = event.target.closest('[data-delete-persona]');
        if (deletePersonaButton) {
            beginPersonaDelete(deletePersonaButton.dataset.deletePersona);
            return;
        }

        if (event.target.closest('[data-cancel-persona-delete]')) {
            cancelPersonaDelete();
            return;
        }

        if (event.target.closest('[data-confirm-persona-delete]')) {
            try {
                await confirmPersonaDelete();
            } catch (error) {
                state.errors.push({ key: 'persona-delete', message: error.message });
                showToast('用户人设删除失败', error.message);
                render();
            }
            return;
        }

        if (event.target.closest('[data-cancel-persona-edit]')) {
            cancelPersonaEdit();
            return;
        }

        if (event.target.closest('[data-save-persona-edit]')) {
            try {
                await savePersonaEdit();
            } catch (error) {
                state.errors.push({ key: 'persona-edit', message: error.message });
                showToast('用户人设保存失败', error.message);
                render();
            }
            return;
        }


        return false;
    }

    function handleInput(event) {
        if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) && event.target.matches('[data-persona-field]')) {
            updatePersonaFormField(event.target);
        }

        return false;
    }

    async function handleChange(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-persona-create-file]')) {
            state.personaCreating.file = event.target.files?.[0] || null;
            render();
            return;
        }

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-persona-avatar-file]')) {
            try {
                await replacePersonaAvatar(event.target.dataset.personaAvatarFile, event.target.files?.[0]);
            } catch (error) {
                state.errors.push({ key: 'persona-avatar', message: error.message });
                showToast('头像替换失败', error.message);
                render();
            } finally {
                event.target.value = '';
            }
            return;
        }

        return false;
    }

    return {
        render: renderPersonas,
        handleClick,
        handleInput,
        handleChange,
    };
}
