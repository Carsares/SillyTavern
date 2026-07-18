import { saveSettingsSerialized } from '../core/keyed-queue.js';

/**
 * @param {{
 *     state: any,
 *     elements: any,
 *     apiFetch: any,
 *     loadData: any,
 *     render: any,
 *     showToast: any,
 *     setTheme: any,
 *     getChatModeLabel: any,
 *     numberInput: any,
 *     reloadSettings: any,
 *     formatBytes?: (bytes: number) => string,
 * }} deps
 */
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

    // 打开原始设置编辑器：拉取当前完整 settings.json 并格式化为可编辑文本。
    async function openRawSettingsEditor() {
        state.rawSettingsEditor.open = true;
        state.rawSettingsEditor.loading = true;
        state.rawSettingsEditor.error = '';
        render();
        try {
            const result = await apiFetch('/api/settings/get', { body: {} });
            // 与 legacy getSettings 一致：响应形如 { settings: '<json 字符串>' }，需再解析一层。
            const settings = result?.settings ? JSON.parse(result.settings) : {};
            state.rawSettingsEditor.value = JSON.stringify(settings, null, 2);
        } finally {
            state.rawSettingsEditor.loading = false;
            render();
        }
    }

    function updateRawSettingsEditorValue(value) {
        state.rawSettingsEditor.value = value;
    }

    function closeRawSettingsEditor() {
        state.rawSettingsEditor.open = false;
        state.rawSettingsEditor.value = '';
        state.rawSettingsEditor.error = '';
        render();
    }

    // 保存原始设置：解析文本、写入前强制快照、经串行队列 POST 整份设置。
    async function saveRawSettingsFromEditor() {
        let parsed;
        try {
            parsed = JSON.parse(state.rawSettingsEditor.value);
        } catch (error) {
            state.rawSettingsEditor.error = `JSON 格式错误：${error.message}`;
            render();
            throw new Error(`JSON 格式错误：${error.message}`);
        }

        // settings.json 必须是对象；数组/基础类型会覆盖后写坏配置（oai_settings 等变 undefined），此处在快照/写入前拦截。
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            const message = '设置必须是一个 JSON 对象（不能是数组或其它类型）。';
            state.rawSettingsEditor.error = message;
            render();
            throw new Error(message);
        }

        state.rawSettingsEditor.saving = true;
        state.rawSettingsEditor.error = '';
        render();
        try {
            // 写入前自动创建快照，任何失败都直接冒泡阻断，避免无保护写入。
            await apiFetch('/api/settings/make-snapshot');
            // 直接把编辑后的完整设置对象作为 body，复用串行队列保证写入不乱序。
            await saveSettingsSerialized(apiFetch, parsed);
            await loadData({ silent: true });
            showToast('原始设置已保存', '已创建快照并写入 settings.json。');
            // 设置已落盘，通知 iframe 生成引擎重载生成相关配置，使下次生成生效。
            await reloadSettings();
        } finally {
            state.rawSettingsEditor.saving = false;
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
        openRawSettingsEditor,
        updateRawSettingsEditorValue,
        closeRawSettingsEditor,
        saveRawSettingsFromEditor,
    };
}
