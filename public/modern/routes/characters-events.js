import { countAddedCharacterFields } from '../actions/character-data.js';

export function createCharactersEvents(ctx) {
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
        discardCharacterEditDraft,
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
        startCharacterEmbeddedWorldImport,
        resolveCharacterEmbeddedWorldConflict,
        dismissCharacterEmbeddedWorldPrompt,
    } = ctx;

    async function handleCharactersClick(event) {
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
            await reloadCharacterDetail(loadCharacterButton.dataset.loadCharacterDetail);
            return;
        }

        const importEmbeddedWorldButton = event.target.closest('[data-import-character-embedded-world]');
        if (importEmbeddedWorldButton) {
            try {
                await startCharacterEmbeddedWorldImport(importEmbeddedWorldButton.dataset.importCharacterEmbeddedWorld);
            } catch (error) {
                state.errors.push({ key: 'character-embedded-world', message: error.message });
                showToast('内嵌世界书导入失败', error.message);
                render();
            }
            return;
        }

        const embeddedWorldConflictButton = event.target.closest('[data-character-embedded-world-conflict-choice]');
        if (embeddedWorldConflictButton) {
            resolveCharacterEmbeddedWorldConflict(embeddedWorldConflictButton.dataset.characterEmbeddedWorldConflictChoice);
            return;
        }

        if (event.target.closest('[data-dismiss-character-embedded-world-prompt]')) {
            dismissCharacterEmbeddedWorldPrompt();
            return;
        }

        if (event.target.closest('[data-clear-character-create-avatar]')) {
            setCharacterCreateAvatar(null);
            return;
        }

        const editCharacterButton = event.target.closest('[data-edit-character]');
        if (editCharacterButton) {
            await beginCharacterEdit(editCharacterButton.dataset.editCharacter);
            return;
        }

        const resumeDraftButton = event.target.closest('[data-resume-character-draft]');
        if (resumeDraftButton) {
            await beginCharacterEdit(resumeDraftButton.dataset.resumeCharacterDraft);
            return;
        }

        const discardDraftButton = event.target.closest('[data-discard-character-draft]');
        if (discardDraftButton) {
            discardCharacterEditDraft(discardDraftButton.dataset.discardCharacterDraft);
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

    // 「读取完整卡」：按钮进入读取中状态，完成后用提示告诉用户补到了多少字段。
    async function reloadCharacterDetail(avatar) {
        if (!avatar || state.characterDetailLoading === avatar) {
            return;
        }

        const previous = state.characterDetails[avatar] || getCharacterByAvatar(avatar);
        state.characterDetailLoading = avatar;
        render();
        try {
            // 读取失败时 loadCharacterDetail 自己会提示「角色卡读取失败」并返回 null。
            const detail = await loadCharacterDetail(avatar, { force: true });
            if (detail) {
                const addedCount = countAddedCharacterFields(previous, detail);
                if (addedCount > 0) {
                    showToast('已读取完整卡', `新增 ${addedCount} 个字段`);
                } else {
                    showToast('已是完整数据', '已从角色卡文件重新读取，没有新的字段。');
                }
            }
        } finally {
            if (state.characterDetailLoading === avatar) {
                state.characterDetailLoading = '';
            }
            render();
        }
    }

    // 新建表单里选择或移除头像：文件只暂存在表单状态里，创建角色时一并上传。
    function setCharacterCreateAvatar(file) {
        if (!state.characterCreating.active) {
            return;
        }

        state.characterCreating.avatarFile = file || null;
        if (state.characterCreating.errors?.avatar) {
            delete state.characterCreating.errors.avatar;
        }
        render();
    }

    function handleCharactersInput(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-character-rename-input]')) {
            state.characterRenaming.name = event.target.value;
        }

        if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) && event.target.matches('[data-character-field]')) {
            updateCharacterFormField(event.target);
        }

        return false;
    }

    async function handleCharactersChange(event) {
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

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-character-create-avatar]')) {
            // 取消选择对话框不清掉已选头像，移除走「移除」按钮。
            const file = event.target.files?.[0];
            if (file) {
                setCharacterCreateAvatar(file);
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
        handleCharactersClick,
        handleCharactersInput,
        handleCharactersChange,
    };
}
