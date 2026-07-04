import { getElementScrollTop, restoreElementScrollTop } from '../core/scroll-state.js';

export function createPresetListHelpers({
    state,
    render,
    getOaiSettings,
    matchesQuery,
}) {
    function getPresetGroups() {
        const bundle = state.settingsBundle;
        return [
            { id: 'openai', label: '聊天补全', names: bundle.openai_setting_names || [], contents: bundle.openai_settings || [] },
            { id: 'textgenerationwebui', label: '文本补全', names: bundle.textgenerationwebui_preset_names || [], contents: bundle.textgenerationwebui_presets || [] },
            { id: 'kobold', label: 'Kobold', names: bundle.koboldai_setting_names || [], contents: bundle.koboldai_settings || [] },
            { id: 'novel', label: 'NovelAI', names: bundle.novelai_setting_names || [], contents: bundle.novelai_settings || [] },
            { id: 'instruct', label: '指令模板', names: (bundle.instruct || []).map(item => item.name || item.system_prompt_name || '未命名'), contents: bundle.instruct || [] },
            { id: 'context', label: '上下文模板', names: (bundle.context || []).map(item => item.name || item.context_name || '未命名'), contents: bundle.context || [] },
            { id: 'sysprompt', label: '系统提示词', names: (bundle.sysprompt || []).map(item => item.name || item.sysprompt_name || '未命名'), contents: bundle.sysprompt || [] },
            { id: 'reasoning', label: '推理模板', names: (bundle.reasoning || []).map(item => item.name || item.reasoning_name || '未命名'), contents: bundle.reasoning || [] },
        ];
    }

    function getPresetCount() {
        return getPresetGroups().reduce((total, group) => total + group.names.length, 0);
    }

    function getPresetItems(group) {
        return group.names
            .map((name, index) => ({
                name,
                content: group.contents[index],
                active: group.id === 'openai' && name === getOaiSettings().preset_settings_openai,
                actionable: group.id === 'openai',
            }))
            .filter(item => matchesQuery(item.name, group.label, group.id));
    }

    function getVisiblePresetGroups() {
        return getPresetGroups()
            .map(group => ({ ...group, items: getPresetItems(group) }))
            .filter(group => group.items.length > 0);
    }

    function findPresetRecord(groups, apiId, name) {
        const group = groups.find(item => item.id === apiId);
        const preset = group?.items.find(item => item.name === name);
        return group && preset ? { group, preset } : null;
    }

    function getSelectedPresetRecord(groups) {
        const selected = findPresetRecord(groups, state.presetSelection.apiId, state.presetSelection.name);
        if (selected) {
            return selected;
        }

        const fallbackGroup = groups.find(group => group.items.length > 0);
        const fallbackPreset = fallbackGroup?.items[0];
        if (fallbackGroup && fallbackPreset) {
            state.presetSelection = { apiId: fallbackGroup.id, name: fallbackPreset.name };
            return { group: fallbackGroup, preset: fallbackPreset };
        }

        state.presetSelection = { apiId: '', name: '' };
        return null;
    }

    function getPresetList(apiId) {
        return Array.from(document.querySelectorAll('[data-preset-group]'))
            .find(group => group.dataset.presetGroup === apiId)
            ?.querySelector('.preset-list') || null;
    }

    function selectPreset(apiId, name) {
        const presetListScrollTop = getElementScrollTop(getPresetList(apiId));
        state.presetSelection = { apiId, name };
        state.presetEditor = { apiId: '', name: '', json: '', error: '' };
        state.presetDeleteConfirm = { apiId: '', name: '' };
        render();
        restoreElementScrollTop(getPresetList(apiId), presetListScrollTop);
    }

    return {
        getPresetGroups,
        getPresetCount,
        getPresetItems,
        getVisiblePresetGroups,
        getSelectedPresetRecord,
        selectPreset,
    };
}
