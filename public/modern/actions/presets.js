import { buildOpenAiPresetFromSettings, useOpenAiPresetFields } from './openai-preset-fields.js';
import { createPresetListHelpers } from './preset-list.js';
import { saveSettingsSerialized } from '../core/keyed-queue.js';

export function createPresetActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
    getOaiSettings,
    chatCompletionModelFields,
    parsePreset,
    downloadFile,
    matchesQuery,
}) {
    const {
        getPresetGroups,
        getPresetCount,
        getPresetItems,
        getVisiblePresetGroups,
        getSelectedPresetRecord,
        selectPreset,
    } = createPresetListHelpers({
        state,
        render,
        getOaiSettings,
        matchesQuery,
    });

    function getPresetEditorText(apiId, name, content) {
        if (state.presetEditor.apiId === apiId && state.presetEditor.name === name) {
            return state.presetEditor.json;
        }

        const preset = parsePreset(content);
        if (preset) {
            return JSON.stringify(preset, null, 2);
        }

        return typeof content === 'string' ? content : '';
    }

    function updatePresetEditorText(value) {
        const selected = getSelectedPresetRecord(getPresetGroups().map(group => ({ ...group, items: getPresetItems(group) })));
        if (!selected) {
            return;
        }

        state.presetEditor = {
            apiId: selected.group.id,
            name: selected.preset.name,
            json: value,
            error: '',
        };
    }

    function getOpenAiPresetByName(presetName) {
        const group = getPresetGroups().find(item => item.id === 'openai');
        const presetIndex = group?.names.indexOf(presetName) ?? -1;
        return parsePreset(presetIndex >= 0 ? group.contents[presetIndex] : null);
    }

    function buildOpenAiPresetFromCurrentSettings() {
        const settings = getOaiSettings();
        const preset = getOpenAiPresetByName(settings.preset_settings_openai) || {};
        return buildOpenAiPresetFromSettings({ settings, preset, chatCompletionModelFields });
    }

    async function savePresetFile(apiId, name, preset, { overwrite = true } = {}) {
        const result = await apiFetch('/api/presets/save', { body: { apiId, name, preset, overwrite } });
        const savedName = typeof result?.name === 'string' ? result.name : '';
        if (!savedName) {
            throw new Error('服务端未返回有效的预设名称。');
        }
        return savedName;
    }

    async function saveOpenAiPresetFromForm() {
        const name = (state.openAiPresetDraft.name || getOaiSettings().preset_settings_openai || '').trim();
        if (!name) {
            throw new Error('预设名称不能为空。');
        }

        const currentName = getOaiSettings().preset_settings_openai || '';
        const preset = buildOpenAiPresetFromCurrentSettings();
        const savedName = await savePresetFile('openai', name, preset, { overwrite: name === currentName });
        state.settings.oai_settings = state.settings.oai_settings || {};
        state.settings.oai_settings.preset_settings_openai = savedName;
        await saveSettingsSerialized(apiFetch, state.settings);
        state.openAiPresetDraft = { name: '' };
        state.presetSelection = { apiId: 'openai', name: savedName };
        state.presetEditor = { apiId: '', name: '', json: '', error: '' };
        await loadData({ silent: true });
        showToast('预设已保存', savedName);
    }

    function getPresetGroup(apiId) {
        return getPresetGroups().find(group => group.id === apiId);
    }

    function getPresetContent(apiId, name) {
        const group = getPresetGroup(apiId);
        const index = group?.names.indexOf(name) ?? -1;
        return index >= 0 ? group.contents[index] : null;
    }

    function getUniquePresetName(apiId, baseName) {
        const names = new Set(getPresetGroup(apiId)?.names || []);
        let nextName = `${baseName} copy`;
        let index = 2;
        while (names.has(nextName)) {
            nextName = `${baseName} copy ${index}`;
            index++;
        }
        return nextName;
    }

    function getAvailablePresetName(apiId, baseName) {
        const name = String(baseName || 'imported preset').trim() || 'imported preset';
        const names = new Set(getPresetGroup(apiId)?.names || []);
        return names.has(name) ? getUniquePresetName(apiId, name) : name;
    }

    async function duplicatePreset(apiId, name) {
        const preset = parsePreset(getPresetContent(apiId, name));
        if (!preset) {
            throw new Error('预设内容读取失败。');
        }

        const nextName = getUniquePresetName(apiId, name);
        const savedName = await savePresetFile(apiId, nextName, preset, { overwrite: false });
        state.presetSelection = { apiId, name: savedName };
        state.presetEditor = { apiId: '', name: '', json: '', error: '' };
        await loadData({ silent: true });
        showToast('预设已复制', `${name} → ${savedName}`);
        render();
    }

    async function importPresetFile(file) {
        if (!file) {
            throw new Error('请选择一个 JSON 预设文件。');
        }

        const apiId = state.presetSelection.apiId || 'openai';
        let preset;
        try {
            preset = JSON.parse(await file.text());
        } catch {
            throw new Error('预设文件不是有效 JSON。');
        }

        const rawName = file.name.replace(/\.json$/i, '').trim() || 'imported preset';
        const name = getAvailablePresetName(apiId, rawName);
        const savedName = await savePresetFile(apiId, name, preset, { overwrite: false });
        state.presetSelection = { apiId, name: savedName };
        state.presetEditor = { apiId: '', name: '', json: '', error: '' };
        await loadData({ silent: true });
        showToast('预设已导入', `${getPresetGroup(apiId)?.label || apiId} / ${savedName}`);
        render();
    }

    async function savePresetJsonFromEditor() {
        const selected = getSelectedPresetRecord(getVisiblePresetGroups());
        if (!selected) {
            throw new Error('请先选择预设。');
        }

        const apiId = selected.group.id;
        const name = selected.preset.name;
        const json = getPresetEditorText(apiId, name, selected.preset.content);
        let preset;
        try {
            preset = JSON.parse(json);
        } catch (error) {
            state.presetEditor = { apiId, name, json, error: error.message };
            render();
            throw new Error(`JSON 格式错误：${error.message}`);
        }

        const savedName = await savePresetFile(apiId, name, preset);
        state.presetSelection = { apiId, name: savedName };
        state.presetEditor = { apiId, name: savedName, json: JSON.stringify(preset, null, 2), error: '' };
        await loadData({ silent: true });
        showToast('预设已保存', savedName);
        render();
    }

    function exportPreset(apiId, name) {
        const preset = parsePreset(getPresetContent(apiId, name));
        if (!preset) {
            throw new Error('预设内容读取失败。');
        }

        downloadFile(JSON.stringify(preset, null, 2), `${apiId}-${name}.json`, 'application/json');
        showToast('预设导出已开始', name);
    }

    async function restorePreset(apiId, name) {
        const result = await apiFetch('/api/presets/restore', { body: { apiId, name } });
        if (!result?.isDefault || !result?.preset) {
            throw new Error('这个预设没有可恢复的内置默认版本。');
        }

        await savePresetFile(apiId, name, result.preset);
        await loadData({ silent: true });
        showToast('预设已恢复默认', name);
        render();
    }

    function beginPresetDelete(apiId, name) {
        state.presetDeleteConfirm = { apiId, name };
        render();
    }

    function cancelPresetDelete() {
        state.presetDeleteConfirm = { apiId: '', name: '' };
        render();
    }

    async function confirmPresetDelete() {
        const { apiId, name } = state.presetDeleteConfirm;
        if (!apiId || !name) {
            throw new Error('请先选择预设。');
        }

        const nextName = (getPresetGroup(apiId)?.names || []).find(item => item !== name) || '';
        const deletingCurrentOpenAiPreset = apiId === 'openai' && getOaiSettings().preset_settings_openai === name;
        if (deletingCurrentOpenAiPreset) {
            state.settings.oai_settings = state.settings.oai_settings || {};
            state.settings.oai_settings.preset_settings_openai = nextName;
            try {
                await saveSettingsSerialized(apiFetch, state.settings);
            } catch (error) {
                state.settings.oai_settings.preset_settings_openai = name;
                throw error;
            }
        }
        await apiFetch('/api/presets/delete', { body: { apiId, name } });
        state.presetDeleteConfirm = { apiId: '', name: '' };
        state.presetSelection = { apiId, name: nextName };
        state.presetEditor = { apiId: '', name: '', json: '', error: '' };
        await loadData({ silent: true });
        showToast('预设已删除', name);
        render();
    }

    async function useOpenAiPreset(presetName) {
        const group = getPresetGroups().find(item => item.id === 'openai');
        const presetIndex = group?.names.indexOf(presetName) ?? -1;
        const preset = parsePreset(presetIndex >= 0 ? group.contents[presetIndex] : null);
        if (!preset) {
            throw new Error('预设读取失败。');
        }

        state.settings.oai_settings = state.settings.oai_settings || {};
        state.settings.oai_settings.preset_settings_openai = presetName;
        useOpenAiPresetFields(state.settings.oai_settings, preset);
        await saveSettingsSerialized(apiFetch, state.settings);
        await loadData({ silent: true });
        showToast('预设已切换', `当前聊天补全预设：${presetName}`);
    }

    return {
        getPresetGroups,
        getPresetCount,
        getPresetItems,
        getVisiblePresetGroups,
        getSelectedPresetRecord,
        selectPreset,
        getPresetEditorText,
        updatePresetEditorText,
        saveOpenAiPresetFromForm,
        savePresetJsonFromEditor,
        useOpenAiPreset,
        duplicatePreset,
        exportPreset,
        restorePreset,
        beginPresetDelete,
        cancelPresetDelete,
        confirmPresetDelete,
        importPresetFile,
    };
}
