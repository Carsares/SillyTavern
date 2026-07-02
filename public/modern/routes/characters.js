import { createCharactersComponents } from '../components/characters.js';

export function createCharactersRoute(ctx) {
    const {
        state,
        render,
        showToast,
        beginCharacterCreate,
        cancelCharacterCreate,
        saveCharacterCreate,
        loadCharacterDetail,
        beginCharacterEdit,
        cancelCharacterEdit,
        saveCharacterEdit,
        duplicateCharacter,
        getCharacterByAvatar,
        beginCharacterRename,
        cancelCharacterRename,
        confirmCharacterRename,
        exportCharacter,
        beginCharacterDelete,
        cancelCharacterDelete,
        confirmCharacterDelete,
        updateCharacterFormField,
        replaceCharacterAvatar,
        importCharacterFile,
    } = ctx;
    const { renderCharacters } = createCharactersComponents(ctx);

    async function handleClick(event) {
        if (event.target.closest('[data-create-character]')) {
            beginCharacterCreate();
            return;
        }

        if (event.target.closest('[data-cancel-character-create]')) {
            cancelCharacterCreate();
            return;
        }

        if (event.target.closest('[data-save-character-create]')) {
            try {
                await saveCharacterCreate();
            } catch (error) {
                state.errors.push({ key: 'character-create', message: error.message });
                showToast('角色创建失败', error.message);
                render();
            }
            return;
        }

        const loadCharacterButton = event.target.closest('[data-load-character-detail]');
        if (loadCharacterButton) {
            await loadCharacterDetail(loadCharacterButton.dataset.loadCharacterDetail, { force: true });
            render();
            return;
        }

        const editCharacterButton = event.target.closest('[data-edit-character]');
        if (editCharacterButton) {
            await beginCharacterEdit(editCharacterButton.dataset.editCharacter);
            return;
        }

        if (event.target.closest('[data-cancel-character-edit]')) {
            cancelCharacterEdit();
            return;
        }

        if (event.target.closest('[data-save-character-edit]')) {
            try {
                await saveCharacterEdit();
            } catch (error) {
                state.errors.push({ key: 'character-edit', message: error.message });
                showToast('角色保存失败', error.message);
                render();
            }
            return;
        }

        const duplicateCharacterButton = event.target.closest('[data-duplicate-character]');
        if (duplicateCharacterButton) {
            try {
                await duplicateCharacter(duplicateCharacterButton.dataset.duplicateCharacter);
            } catch (error) {
                state.errors.push({ key: 'character-duplicate', message: error.message });
                showToast('角色复制失败', error.message);
                render();
            }
            return;
        }

        const renameCharacterButton = event.target.closest('[data-rename-character]');
        if (renameCharacterButton) {
            const character = getCharacterByAvatar(renameCharacterButton.dataset.renameCharacter);
            if (character) {
                beginCharacterRename(character);
            }
            return;
        }

        if (event.target.closest('[data-cancel-character-rename]')) {
            cancelCharacterRename();
            return;
        }

        if (event.target.closest('[data-confirm-character-rename]')) {
            try {
                await confirmCharacterRename();
            } catch (error) {
                state.errors.push({ key: 'character-rename', message: error.message });
                showToast('角色重命名失败', error.message);
                render();
            }
            return;
        }

        const exportCharacterButton = event.target.closest('[data-export-character]');
        if (exportCharacterButton) {
            try {
                await exportCharacter(exportCharacterButton.dataset.exportCharacter, exportCharacterButton.dataset.characterExportFormat || 'png');
            } catch (error) {
                state.errors.push({ key: 'character-export', message: error.message });
                showToast('角色导出失败', error.message);
                render();
            }
            return;
        }

        const deleteCharacterButton = event.target.closest('[data-delete-character]');
        if (deleteCharacterButton) {
            const character = getCharacterByAvatar(deleteCharacterButton.dataset.deleteCharacter);
            if (character) {
                beginCharacterDelete(character);
            }
            return;
        }

        if (event.target.closest('[data-cancel-character-delete]')) {
            cancelCharacterDelete();
            return;
        }

        if (event.target.closest('[data-confirm-character-delete]')) {
            try {
                await confirmCharacterDelete();
            } catch (error) {
                state.errors.push({ key: 'character-delete', message: error.message });
                showToast('角色删除失败', error.message);
                render();
            }
            return;
        }


        return false;
    }

    function handleInput(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-character-rename-input]')) {
            state.characterRenaming.name = event.target.value;
        }

        if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) && event.target.matches('[data-character-field]')) {
            updateCharacterFormField(event.target);
        }

        return false;
    }

    async function handleChange(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-character-avatar-file]')) {
            try {
                await replaceCharacterAvatar(event.target.dataset.characterAvatarFile, event.target.files?.[0]);
            } catch (error) {
                state.errors.push({ key: 'character-avatar', message: error.message });
                showToast('角色头像替换失败', error.message);
                render();
            } finally {
                event.target.value = '';
            }
            return;
        }

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-character-import-file]')) {
            try {
                await importCharacterFile(event.target.files?.[0]);
            } catch (error) {
                state.errors.push({ key: 'character-import', message: error.message });
                showToast('角色导入失败', error.message);
                render();
            } finally {
                event.target.value = '';
            }
            return;
        }

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-character-delete-chats]')) {
            state.characterDeleteConfirm.deleteChats = event.target.checked;
        }

        if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) && event.target.matches('[data-character-field]')) {
            updateCharacterFormField(event.target);
        }

        return false;
    }

    return {
        render: renderCharacters,
        handleClick,
        handleInput,
        handleChange,
    };
}
