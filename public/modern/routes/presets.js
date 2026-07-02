import { createPresetsComponents } from '../components/presets.js';

export function createPresetsRoute(ctx) {
    const {
        state,
        render,
        showToast,
        saveOpenAiPresetFromForm,
        selectPreset,
        savePresetJsonFromEditor,
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
    const { renderPresets } = createPresetsComponents(ctx);

    async function handleClick(event) {
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

    function handleInput(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-openai-preset-name]')) {
            state.openAiPresetDraft.name = event.target.value;
        }

        if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-preset-json-input]')) {
            updatePresetEditorText(event.target.value);
        }

        return false;
    }

    async function handleChange(event) {
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
        render: renderPresets,
        handleClick,
        handleInput,
        handleChange,
    };
}
