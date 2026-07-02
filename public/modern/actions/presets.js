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

    function selectPreset(apiId, name) {
        state.presetSelection = { apiId, name };
        state.presetEditor = { apiId: '', name: '', json: '', error: '' };
        state.presetDeleteConfirm = { apiId: '', name: '' };
        render();
    }

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
        const source = settings.chat_completion_source || 'openai';
        const modelField = chatCompletionModelFields[source];

        preset.temperature = settings.temp_openai;
        preset.openai_max_tokens = settings.openai_max_tokens;
        preset.top_p = settings.top_p_openai;
        preset.frequency_penalty = settings.freq_pen_openai;
        preset.presence_penalty = settings.pres_pen_openai;
        preset.chat_completion_source = source;
        if (modelField) {
            preset[modelField] = settings[modelField];
        }
        if (source === 'siliconflow') {
            preset.siliconflow_endpoint = settings.siliconflow_endpoint || 'cn';
        }
        if (source === 'custom') {
            preset.custom_url = settings.custom_url || '';
        }
        if (settings.reverse_proxy) {
            preset.reverse_proxy = settings.reverse_proxy;
        }

        return preset;
    }

    async function saveOpenAiPresetFromForm() {
        const name = (state.openAiPresetDraft.name || getOaiSettings().preset_settings_openai || '').trim();
        if (!name) {
            throw new Error('预设名称不能为空。');
        }

        const preset = buildOpenAiPresetFromCurrentSettings();
        state.settings.oai_settings = state.settings.oai_settings || {};
        state.settings.oai_settings.preset_settings_openai = name;
        await apiFetch('/api/presets/save', { body: { apiId: 'openai', name, preset } });
        await apiFetch('/api/settings/save', { body: state.settings });
        state.openAiPresetDraft = { name: '' };
        state.presetSelection = { apiId: 'openai', name };
        state.presetEditor = { apiId: '', name: '', json: '', error: '' };
        await loadData({ silent: true });
        showToast('预设已保存', name);
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
        await apiFetch('/api/presets/save', { body: { apiId, name: nextName, preset } });
        state.presetSelection = { apiId, name: nextName };
        state.presetEditor = { apiId: '', name: '', json: '', error: '' };
        await loadData({ silent: true });
        showToast('预设已复制', `${name} → ${nextName}`);
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
        await apiFetch('/api/presets/save', { body: { apiId, name, preset } });
        state.presetSelection = { apiId, name };
        state.presetEditor = { apiId: '', name: '', json: '', error: '' };
        await loadData({ silent: true });
        showToast('预设已导入', `${getPresetGroup(apiId)?.label || apiId} / ${name}`);
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

        await apiFetch('/api/presets/save', { body: { apiId, name, preset } });
        state.presetSelection = { apiId, name };
        state.presetEditor = { apiId, name, json: JSON.stringify(preset, null, 2), error: '' };
        await loadData({ silent: true });
        showToast('预设已保存', name);
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

        await apiFetch('/api/presets/save', { body: { apiId, name, preset: result.preset } });
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
        await apiFetch('/api/presets/delete', { body: { apiId, name } });
        if (apiId === 'openai' && getOaiSettings().preset_settings_openai === name) {
            state.settings.oai_settings = state.settings.oai_settings || {};
            state.settings.oai_settings.preset_settings_openai = nextName;
            await apiFetch('/api/settings/save', { body: state.settings });
        }
        state.presetDeleteConfirm = { apiId: '', name: '' };
        state.presetSelection = { apiId, name: nextName };
        state.presetEditor = { apiId: '', name: '', json: '', error: '' };
        await loadData({ silent: true });
        showToast('预设已删除', name);
        render();
    }

    function applyOpenAiPresetFields(settings, preset) {
        const fieldMap = {
            temperature: ['temp_openai', false],
            frequency_penalty: ['freq_pen_openai', false],
            presence_penalty: ['pres_pen_openai', false],
            top_p: ['top_p_openai', false],
            top_k: ['top_k_openai', false],
            top_a: ['top_a_openai', false],
            min_p: ['min_p_openai', false],
            repetition_penalty: ['repetition_penalty_openai', false],
            max_context_unlocked: ['max_context_unlocked', false],
            openai_max_context: ['openai_max_context', false],
            openai_max_tokens: ['openai_max_tokens', false],
            names_behavior: ['names_behavior', false],
            send_if_empty: ['send_if_empty', false],
            impersonation_prompt: ['impersonation_prompt', false],
            new_chat_prompt: ['new_chat_prompt', false],
            new_group_chat_prompt: ['new_group_chat_prompt', false],
            new_example_chat_prompt: ['new_example_chat_prompt', false],
            continue_nudge_prompt: ['continue_nudge_prompt', false],
            bias_preset_selected: ['bias_preset_selected', false],
            wi_format: ['wi_format', false],
            scenario_format: ['scenario_format', false],
            personality_format: ['personality_format', false],
            group_nudge_prompt: ['group_nudge_prompt', false],
            stream_openai: ['stream_openai', false],
            prompts: ['prompts', false],
            prompt_order: ['prompt_order', false],
            chat_completion_source: ['chat_completion_source', true],
            openai_model: ['openai_model', true],
            claude_model: ['claude_model', true],
            openrouter_model: ['openrouter_model', true],
            ai21_model: ['ai21_model', true],
            mistralai_model: ['mistralai_model', true],
            cohere_model: ['cohere_model', true],
            perplexity_model: ['perplexity_model', true],
            groq_model: ['groq_model', true],
            chutes_model: ['chutes_model', true],
            siliconflow_model: ['siliconflow_model', true],
            siliconflow_endpoint: ['siliconflow_endpoint', true],
            minimax_model: ['minimax_model', true],
            minimax_endpoint: ['minimax_endpoint', true],
            electronhub_model: ['electronhub_model', true],
            nanogpt_model: ['nanogpt_model', true],
            deepseek_model: ['deepseek_model', true],
            aimlapi_model: ['aimlapi_model', true],
            xai_model: ['xai_model', true],
            pollinations_model: ['pollinations_model', true],
            moonshot_model: ['moonshot_model', true],
            fireworks_model: ['fireworks_model', true],
            cometapi_model: ['cometapi_model', true],
            custom_model: ['custom_model', true],
            custom_url: ['custom_url', true],
            custom_include_body: ['custom_include_body', true],
            custom_exclude_body: ['custom_exclude_body', true],
            custom_include_headers: ['custom_include_headers', true],
            custom_prompt_post_processing: ['custom_prompt_post_processing', true],
            google_model: ['google_model', true],
            vertexai_model: ['vertexai_model', true],
            zai_model: ['zai_model', true],
            zai_endpoint: ['zai_endpoint', true],
            workers_ai_model: ['workers_ai_model', true],
            workers_ai_account_id: ['workers_ai_account_id', true],
            reverse_proxy: ['reverse_proxy', true],
            proxy_password: ['proxy_password', true],
        };
        const useConnectionFields = Boolean(settings.bind_preset_to_connection);

        for (const [presetKey, [settingsKey, isConnection]] of Object.entries(fieldMap)) {
            if (isConnection && !useConnectionFields) {
                continue;
            }
            if (preset[presetKey] !== undefined) {
                settings[settingsKey] = structuredClone(preset[presetKey]);
            }
        }

        if (preset.extensions) {
            settings.extensions = structuredClone(preset.extensions);
        }
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
        applyOpenAiPresetFields(state.settings.oai_settings, preset);
        await apiFetch('/api/settings/save', { body: state.settings });
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
