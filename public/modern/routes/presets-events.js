export function createPresetsEvents(ctx) {
    const {
        state,
        render,
        showToast,
        saveOpenAiPresetFromForm,
        selectPreset,
        savePresetJsonFromEditor,
        togglePromptOrderEntry,
        movePromptOrderEntry,
        useOpenAiPreset,
        duplicatePreset,
        exportPreset,
        restorePreset,
        beginPresetDelete,
        cancelPresetDelete,
        confirmPresetDelete,
        updatePresetEditorText,
        importPresetFile,
    } = ctx;

    async function handlePresetsClick(event) {
        if (event.target.closest('[data-save-openai-preset]')) {
            try {
                await saveOpenAiPresetFromForm();
            } catch (error) {
                state.errors.push({ key: 'preset-save', message: error.message });
                showToast('预设保存失败', error.message);
                render();
            }
            return;
        }

        const presetGroupSummary = event.target.closest('[data-preset-group] > summary');
        if (presetGroupSummary) {
            // The native <details> toggle runs as this click's default action; record the resulting
            // open state so a later render (filter, delete, etc.) doesn't re-expand a group the user collapsed
            const presetGroup = presetGroupSummary.parentElement;
            const groupId = presetGroup.dataset.presetGroup;
            const expanded = new Set(state.presetExpandedGroups);
            if (presetGroup.open) {
                expanded.delete(groupId);
            } else {
                expanded.add(groupId);
            }
            state.presetExpandedGroups = [...expanded];
            return;
        }

        const selectPresetButton = event.target.closest('[data-select-preset]');
        if (selectPresetButton) {
            selectPreset(selectPresetButton.dataset.presetApi, selectPresetButton.dataset.selectPreset);
            return;
        }

        if (event.target.closest('[data-save-preset-json]')) {
            try {
                await savePresetJsonFromEditor();
            } catch (error) {
                state.errors.push({ key: 'preset-json-save', message: error.message });
                showToast('预设保存失败', error.message);
                render();
            }
            return;
        }

        const movePromptOrderButton = event.target.closest('[data-move-prompt-order]');
        if (movePromptOrderButton) {
            try {
                await movePromptOrderEntry(movePromptOrderButton.dataset.presetName, movePromptOrderButton.dataset.movePromptOrder, movePromptOrderButton.dataset.moveDirection);
            } catch (error) {
                state.errors.push({ key: 'preset-prompt-order', message: error.message });
                showToast('Prompt 顺序更新失败', error.message);
                render();
            }
            return;
        }

        const presetButton = event.target.closest('[data-use-openai-preset]');
        if (presetButton) {
            try {
                await useOpenAiPreset(presetButton.dataset.useOpenaiPreset);
            } catch (error) {
                state.errors.push({ key: 'preset', message: error.message });
                showToast('预设切换失败', error.message);
                render();
            }
            return;
        }

        const duplicatePresetButton = event.target.closest('[data-duplicate-preset]');
        if (duplicatePresetButton) {
            try {
                await duplicatePreset(duplicatePresetButton.dataset.presetApi, duplicatePresetButton.dataset.duplicatePreset);
            } catch (error) {
                state.errors.push({ key: 'preset-duplicate', message: error.message });
                showToast('预设复制失败', error.message);
                render();
            }
            return;
        }

        const exportPresetButton = event.target.closest('[data-export-preset]');
        if (exportPresetButton) {
            try {
                exportPreset(exportPresetButton.dataset.presetApi, exportPresetButton.dataset.exportPreset);
            } catch (error) {
                state.errors.push({ key: 'preset-export', message: error.message });
                showToast('预设导出失败', error.message);
                render();
            }
            return;
        }

        const restorePresetButton = event.target.closest('[data-restore-preset]');
        if (restorePresetButton) {
            try {
                await restorePreset(restorePresetButton.dataset.presetApi, restorePresetButton.dataset.restorePreset);
            } catch (error) {
                state.errors.push({ key: 'preset-restore', message: error.message });
                showToast('预设恢复失败', error.message);
                render();
            }
            return;
        }

        const deletePresetButton = event.target.closest('[data-delete-preset]');
        if (deletePresetButton) {
            beginPresetDelete(deletePresetButton.dataset.presetApi, deletePresetButton.dataset.deletePreset);
            return;
        }

        if (event.target.closest('[data-cancel-preset-delete]')) {
            cancelPresetDelete();
            return;
        }

        if (event.target.closest('[data-confirm-preset-delete]')) {
            try {
                await confirmPresetDelete();
            } catch (error) {
                state.errors.push({ key: 'preset-delete', message: error.message });
                showToast('预设删除失败', error.message);
                render();
            }
            return;
        }

        return false;
    }

    function handlePresetsInput(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-openai-preset-name]')) {
            state.openAiPresetDraft.name = event.target.value;
        }

        if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-preset-json-input]')) {
            updatePresetEditorText(event.target.value);
        }

        return false;
    }

    async function handlePresetsChange(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-toggle-prompt-order]')) {
            try {
                await togglePromptOrderEntry(event.target.dataset.presetName, event.target.dataset.togglePromptOrder);
            } catch (error) {
                state.errors.push({ key: 'preset-prompt-order', message: error.message });
                showToast('Prompt 启用切换失败', error.message);
                render();
            }
            return;
        }

        if (event.target instanceof HTMLInputElement && event.target.matches('[data-preset-import-file]')) {
            try {
                await importPresetFile(event.target.files?.[0]);
            } catch (error) {
                state.errors.push({ key: 'preset-import', message: error.message });
                showToast('预设导入失败', error.message);
                render();
            } finally {
                event.target.value = '';
            }
            return;
        }

        return false;
    }

    return {
        handlePresetsClick,
        handlePresetsInput,
        handlePresetsChange,
    };
}
