export function createSettingsEvents(ctx) {
    const {
        state,
        render,
        showToast,
        loadSettingsSnapshots,
        createSettingsSnapshot,
        saveModernPreferencesFromForm,
        saveRequestCompressionFromForm,
        previewSettingsSnapshot,
        beginSettingsSnapshotRestore,
        cancelSettingsSnapshotRestore,
        confirmSettingsSnapshotRestore,
    } = ctx;

    async function setSettingsSection(section, { loadSnapshots = true } = {}) {
        state.settingsSection = ['preferences', 'status', 'snapshots', 'diagnostics'].includes(section) ? section : 'preferences';
        localStorage.setItem('st-modern-settings-section', state.settingsSection);
        if (loadSnapshots && state.settingsSection === 'snapshots' && !state.settingsSnapshots.loaded && !state.settingsSnapshots.loading) {
            await loadSettingsSnapshots();
        }
    }

    async function handleSettingsClick(event) {
        const settingsSectionButton = event.target.closest('[data-settings-section]');
        if (settingsSectionButton) {
            try {
                await setSettingsSection(settingsSectionButton.dataset.settingsSection);
                render();
            } catch (error) {
                state.errors.push({ key: 'settings-snapshots', message: error.message });
                showToast('设置快照读取失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-load-settings-snapshots]')) {
            try {
                await setSettingsSection('snapshots', { loadSnapshots: false });
                await loadSettingsSnapshots({ force: true });
                render();
            } catch (error) {
                state.errors.push({ key: 'settings-snapshots', message: error.message });
                showToast('设置快照读取失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-create-settings-snapshot]')) {
            try {
                await setSettingsSection('snapshots', { loadSnapshots: false });
                await createSettingsSnapshot();
            } catch (error) {
                state.errors.push({ key: 'settings-snapshot-create', message: error.message });
                showToast('设置快照创建失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-save-modern-preferences]')) {
            saveModernPreferencesFromForm();
            return true;
        }

        if (event.target.closest('[data-save-request-compression]')) {
            try {
                await saveRequestCompressionFromForm();
            } catch (error) {
                state.errors.push({ key: 'request-compression-save', message: error.message });
                showToast('请求压缩保存失败', error.message);
                render();
            }
            return true;
        }

        const previewSettingsSnapshotButton = event.target.closest('[data-preview-settings-snapshot]');
        if (previewSettingsSnapshotButton) {
            try {
                await previewSettingsSnapshot(previewSettingsSnapshotButton.dataset.previewSettingsSnapshot);
            } catch (error) {
                state.errors.push({ key: 'settings-snapshot-preview', message: error.message });
                showToast('设置快照预览失败', error.message);
                render();
            }
            return true;
        }

        const restoreSettingsSnapshotButton = event.target.closest('[data-restore-settings-snapshot]');
        if (restoreSettingsSnapshotButton) {
            beginSettingsSnapshotRestore(restoreSettingsSnapshotButton.dataset.restoreSettingsSnapshot);
            return true;
        }

        if (event.target.closest('[data-cancel-settings-restore]')) {
            cancelSettingsSnapshotRestore();
            return true;
        }

        if (event.target.closest('[data-confirm-settings-restore]')) {
            try {
                await confirmSettingsSnapshotRestore();
            } catch (error) {
                state.errors.push({ key: 'settings-snapshot-restore', message: error.message });
                showToast('设置快照恢复失败', error.message);
                render();
            }
            return true;
        }

        return false;
    }

    return {
        handleSettingsClick,
    };
}
