import { getSettingsTabs, normalizeSettingsSection } from '../components/settings.js';
import { getSettingsOptionalParts } from '../components/settings-optional-tabs.js';
import { createApiEvents } from './api-events.js';
import { createSettingsLanguageEvents } from './settings-language-events.js';
import { bindSettingsChatToolsEvents } from './settings-chat-tools-events.js';
import { bindSettingsMaintenanceEvents } from './settings-maintenance-events.js';

export function createSettingsEvents(ctx) {
    const {
        state,
        render,
        showToast,
        settingsAutosave,
        loadSettingsSnapshots,
        createSettingsSnapshot,
        saveModernPreferenceField,
        previewSettingsSnapshot,
        beginSettingsSnapshotRestore,
        cancelSettingsSnapshotRestore,
        confirmSettingsSnapshotRestore,
        openRawSettingsEditor,
        updateRawSettingsEditorValue,
        closeRawSettingsEditor,
        saveRawSettingsFromEditor,
    } = ctx;
    const optionalParts = getSettingsOptionalParts(ctx);
    // 「模型连接」标签的事件只在这个标签打开时处理
    const connectionEvents = createApiEvents(ctx);
    const languageEvents = createSettingsLanguageEvents(ctx);
    // 「聊天工具」标签和数据维护分区里的控件事件，各自的约定见对应文件顶部注释
    const slotHandlers = [
        bindSettingsChatToolsEvents(ctx),
        bindSettingsMaintenanceEvents(ctx),
    ].map(handlers => handlers || {});

    function getActiveSection() {
        const tabs = getSettingsTabs(optionalParts);
        const section = normalizeSettingsSection(state.settingsSection);
        return tabs.some(tab => tab.id === section) ? section : tabs[0].id;
    }

    function setSettingsSection(section) {
        const tabs = getSettingsTabs(optionalParts);
        const normalized = normalizeSettingsSection(section);
        state.settingsSection = tabs.some(tab => tab.id === normalized) ? normalized : tabs[0].id;
        localStorage.setItem('st-modern-settings-section', state.settingsSection);
    }

    async function handleSettingsClick(event) {
        const settingsSectionButton = event.target.closest('[data-settings-section]');
        if (settingsSectionButton) {
            setSettingsSection(settingsSectionButton.dataset.settingsSection);
            render();
            return true;
        }

        if (getActiveSection() === 'connection' && await connectionEvents.handleApiClick(event)) {
            return true;
        }
        if (getActiveSection() === 'language' && await languageEvents.handleClick(event)) {
            return true;
        }

        if (event.target.closest('[data-load-settings-snapshots]')) {
            try {
                await loadSettingsSnapshots({ force: true });
                render();
            } catch (error) {
                state.settingsSnapshots.error = error.message;
                state.errors.push({ key: 'settings-snapshots', message: error.message });
                showToast('设置快照读取失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-create-settings-snapshot]')) {
            try {
                await createSettingsSnapshot();
            } catch (error) {
                state.errors.push({ key: 'settings-snapshot-create', message: error.message });
                showToast('设置快照创建失败', error.message);
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

        if (event.target.closest('[data-open-raw-settings]')) {
            try {
                await openRawSettingsEditor();
            } catch (error) {
                state.errors.push({ key: 'raw-settings-open', message: error.message });
                showToast('原始设置加载失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-save-raw-settings]')) {
            try {
                await saveRawSettingsFromEditor();
            } catch (error) {
                state.errors.push({ key: 'raw-settings-save', message: error.message });
                showToast('原始设置保存失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-cancel-raw-settings]')) {
            closeRawSettingsEditor();
            return true;
        }

        for (const handlers of slotHandlers) {
            if (handlers.handleClick && await handlers.handleClick(event)) {
                return true;
            }
        }

        return false;
    }

    async function handleSettingsChange(event) {
        if (getActiveSection() === 'connection' && await connectionEvents.handleApiChange(event)) {
            return true;
        }
        if (getActiveSection() === 'language' && await languageEvents.handleChange(event)) {
            return true;
        }

        const preference = saveModernPreferenceField(event.target);
        if (preference) {
            settingsAutosave.markSaved(preference);
            return true;
        }

        for (const handlers of slotHandlers) {
            if (handlers.handleChange && await handlers.handleChange(event)) {
                return true;
            }
        }
        return false;
    }

    async function handleSettingsSubmit(event) {
        return getActiveSection() === 'connection' && connectionEvents.handleApiSubmit(event);
    }

    // 必须在没处理时返回 false：shell/events.js 对 keydown 的返回值不是 false 就不再走全局快捷键
    function handleSettingsKeydown(event) {
        if (getActiveSection() === 'connection' && connectionEvents.handleApiKeydown(event)) {
            return true;
        }
        return slotHandlers.some(handlers => handlers.handleKeydown?.(event));
    }

    function handleSettingsInput(event) {
        if (getActiveSection() === 'connection' && connectionEvents.handleApiInput(event)) {
            return true;
        }

        if (slotHandlers.some(handlers => handlers.handleInput?.(event))) {
            return true;
        }

        // 原始设置编辑器：仅同步 value，不触发重渲染以保留光标位置。
        if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-raw-settings-input]')) {
            updateRawSettingsEditorValue(event.target.value);
            return true;
        }

        if (!(event.target instanceof HTMLInputElement) || !event.target.matches('[data-settings-snapshot-search]')) {
            return false;
        }

        const cursor = event.target.selectionStart ?? event.target.value.length;
        state.settingsSnapshots.query = event.target.value;
        render();
        const input = document.querySelector('[data-settings-snapshot-search]');
        if (input instanceof HTMLInputElement) {
            input.focus();
            input.setSelectionRange(cursor, cursor);
        }
        return true;
    }

    return {
        handleSettingsChange,
        handleSettingsClick,
        handleSettingsInput,
        handleSettingsKeydown,
        handleSettingsSubmit,
    };
}
