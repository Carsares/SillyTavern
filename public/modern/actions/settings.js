export function createSettingsActions({
    state,
    elements,
    apiFetch,
    loadData,
    render,
    showToast,
    setTheme,
    getChatModeLabel,
    numberInput,
    reloadSettings,
}) {
    async function loadSettingsSnapshots({ force = false } = {}) {
        if (state.settingsSnapshots.loaded && !force) {
            return state.settingsSnapshots.items;
        }

        state.settingsSnapshots.loading = true;
        render();
        try {
            const result = await apiFetch('/api/settings/get-snapshots');
            const snapshots = Array.isArray(result)
                ? [...result].sort((a, b) => Number(b.date || 0) - Number(a.date || 0))
                : [];
            state.settingsSnapshots.items = snapshots;
            state.settingsSnapshots.loaded = true;
            return snapshots;
        } finally {
            state.settingsSnapshots.loading = false;
        }
    }

    async function createSettingsSnapshot() {
        state.settingsSnapshots.creating = true;
        render();
        try {
            await apiFetch('/api/settings/make-snapshot');
            await loadSettingsSnapshots({ force: true });
            showToast('设置快照已创建', '当前 settings.json 已备份。');
        } finally {
            state.settingsSnapshots.creating = false;
            render();
        }
    }

    async function previewSettingsSnapshot(name) {
        const text = await apiFetch('/api/settings/load-snapshot', { body: { name } });
        state.settingsSnapshots.previewName = name;
        state.settingsSnapshots.previewText = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
        render();
    }

    function beginSettingsSnapshotRestore(name) {
        state.settingsSnapshots.restoreConfirm = name;
        render();
    }

    function cancelSettingsSnapshotRestore() {
        state.settingsSnapshots.restoreConfirm = '';
        render();
    }

    async function confirmSettingsSnapshotRestore() {
        const name = state.settingsSnapshots.restoreConfirm;
        if (!name) {
            throw new Error('请先选择一个设置快照。');
        }

        state.settingsSnapshots.restoring = true;
        render();
        try {
            await apiFetch('/api/settings/restore-snapshot', { body: { name } });
            state.settingsSnapshots.restoreConfirm = '';
            await loadData({ silent: true });
            showToast('设置已恢复', name);
            // 设置快照已落盘，通知 iframe 生成引擎重载生成相关配置，使下次生成生效。
            await reloadSettings();
        } finally {
            state.settingsSnapshots.restoring = false;
            render();
        }
    }

    function getRequestCompressionSettings() {
        return state.settingsBundle.request_compression || {};
    }

    function saveModernPreferencesFromForm() {
        const theme = elements.content.querySelector('[data-modern-theme]')?.value === 'dark' ? 'dark' : 'light';
        const chatMode = elements.content.querySelector('[data-modern-chat-mode]')?.value === 'group' ? 'group' : 'character';
        const chatSidebarOpen = Boolean(elements.content.querySelector('[data-modern-chat-sidebar-open]')?.checked);
        const inspectorOpen = Boolean(elements.content.querySelector('[data-modern-inspector-open]')?.checked);

        setTheme(theme);
        state.chatMode = chatMode;
        localStorage.setItem('st-modern-chat-mode', chatMode);
        localStorage.setItem('st-modern-chat-sidebar-open', String(chatSidebarOpen));
        localStorage.setItem('st-modern-inspector-open', String(inspectorOpen));
        showToast('界面偏好已保存', `${theme} / ${getChatModeLabel()}`);
        render();
    }

    return {
        getRequestCompressionSettings,
        loadSettingsSnapshots,
        createSettingsSnapshot,
        saveModernPreferencesFromForm,
        previewSettingsSnapshot,
        beginSettingsSnapshotRestore,
        cancelSettingsSnapshotRestore,
        confirmSettingsSnapshotRestore,
    };
}
