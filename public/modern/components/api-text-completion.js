const textCompletionTypeOptions = [
    { id: 'ooba', label: 'Text Generation WebUI / Ooba' },
    { id: 'generic', label: 'Generic OpenAI-compatible' },
    { id: 'openrouter', label: 'OpenRouter' },
    { id: 'ollama', label: 'Ollama' },
    { id: 'vllm', label: 'vLLM' },
    { id: 'aphrodite', label: 'Aphrodite' },
    { id: 'tabby', label: 'TabbyAPI' },
    { id: 'koboldcpp', label: 'KoboldCpp' },
    { id: 'llamacpp', label: 'llama.cpp' },
    { id: 'huggingface', label: 'Hugging Face' },
    { id: 'mancer', label: 'Mancer' },
    { id: 'togetherai', label: 'TogetherAI' },
    { id: 'infermaticai', label: 'InfermaticAI' },
    { id: 'dreamgen', label: 'DreamGen' },
    { id: 'featherless', label: 'Featherless' },
];

const textCompletionModelFields = {
    ooba: 'custom_model',
    generic: 'generic_model',
    openrouter: 'openrouter_model',
    ollama: 'ollama_model',
    vllm: 'vllm_model',
    aphrodite: 'aphrodite_model',
    tabby: 'tabby_model',
    llamacpp: 'llamacpp_model',
    mancer: 'mancer_model',
    togetherai: 'togetherai_model',
    infermaticai: 'infermaticai_model',
    dreamgen: 'dreamgen_model',
    featherless: 'featherless_model',
};

const secretKeyByTextCompletionType = {
    ooba: 'api_key_ooba',
    generic: 'api_key_generic',
    openrouter: 'api_key_openrouter',
    vllm: 'api_key_vllm',
    aphrodite: 'api_key_aphrodite',
    tabby: 'api_key_tabby',
    llamacpp: 'api_key_llamacpp',
    koboldcpp: 'api_key_koboldcpp',
    mancer: 'api_key_mancer',
    togetherai: 'api_key_togetherai',
    infermaticai: 'api_key_infermaticai',
    dreamgen: 'api_key_dreamgen',
    featherless: 'api_key_featherless',
    huggingface: 'api_key_huggingface',
};

const textCompletionSamplingFields = [
    { key: 'temp', label: '温度', step: '0.01', fallback: 0.7 },
    { key: 'top_p', label: 'Top P', step: '0.01', fallback: 0.5 },
    { key: 'top_k', label: 'Top K', step: '1', fallback: 40 },
    { key: 'min_p', label: 'Min P', step: '0.01', fallback: 0 },
    { key: 'rep_pen', label: '重复惩罚', step: '0.01', fallback: 1.2 },
    { key: 'rep_pen_range', label: '重复范围', step: '1', fallback: 0 },
];

export function createApiTextCompletionComponents(ctx) {
    const {
        state,
        escapeHtml,
        maskEndpoint,
        getPresetGroups,
        getNumberSetting,
    } = ctx;

    function renderTextCompletionEditor(mainApi, renderApiMainSelect) {
        const profile = getTextCompletionProfile();
        const textgenSettings = state.settings?.textgenerationwebui_settings || {};
        const textgenPresetNames = getPresetGroups().find(group => group.id === 'textgenerationwebui')?.names || [];
        const secretUiState = getTextCompletionSecretUiState(profile.source);
        const typeOptions = getTextCompletionTypeOptions(profile.source);

        return `
        <div class="settings-form">
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">连接</h3>
                    <p class="panel-subtitle">在现代页编辑文本补全的 type、端点和档案字段。</p>
                </div>
                <div class="form-grid two-columns">
                    ${renderApiMainSelect(mainApi)}
                    <label class="field-label">
                        <span>文本补全来源</span>
                        <select class="select-input" data-textgen-type>
                            ${typeOptions.map(option => `<option value="${escapeHtml(option.id)}" ${profile.source === option.id ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
                        </select>
                    </label>
                    <label class="field-label">
                        <span>端点</span>
                        <input class="text-input" type="url" data-textgen-endpoint value="${escapeHtml(profile.rawEndpoint)}" autocomplete="off" placeholder="例如 http://127.0.0.1:5000">
                    </label>
                </div>
            </section>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">模型参数</h3>
                    <p class="panel-subtitle">只承接文本补全连接必需的浅层档案字段。</p>
                </div>
                <div class="form-grid two-columns">
                    <label class="field-label">
                        <span>模型</span>
                        <input class="text-input" type="text" data-textgen-model value="${escapeHtml(profile.model)}" autocomplete="off" placeholder="当前 type 对应模型字段">
                    </label>
                    <label class="field-label">
                        <span>文本补全预设</span>
                        <select class="select-input" data-textgen-preset>
                            <option value="">未选择</option>
                            ${textgenPresetNames.map(name => `<option value="${escapeHtml(name)}" ${profile.preset === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
                        </select>
                    </label>
                </div>
            </section>
            <section class="form-section">
                <div>
                    <h3 class="form-section-title">基础采样</h3>
                    <p class="panel-subtitle">承接文本补全常用采样字段，保存为旧设置同名字段。</p>
                </div>
                <div class="form-grid two-columns">
                    ${textCompletionSamplingFields.map(field => renderTextCompletionSamplingField(field, textgenSettings)).join('')}
                </div>
            </section>
            <div class="form-section">
                <div>
                    <h3 class="form-section-title">安全密钥</h3>
                    <p class="panel-subtitle">密钥写入本地 secrets，不在页面回显。</p>
                </div>
                <label class="field-label" data-textgen-field="api-key" ${secretUiState.hasSecretMapping ? '' : 'hidden'}>
                    <span>API Key</span>
                    <input class="text-input" type="password" data-textgen-api-key value="" autocomplete="new-password" placeholder="${secretUiState.secretSaved ? '密钥已保存；留空不修改' : '输入后保存到 secrets'}">
                </label>
            </div>
            <div class="connection-test">
                <span class="badge" data-textgen-secret-status>${secretUiState.secretSaved ? '密钥已保存' : (secretUiState.hasSecretMapping ? '未保存密钥' : '无密钥字段')}</span>
                <span data-textgen-secret-key>${escapeHtml(secretUiState.secretKey)}</span>
            </div>
            <div class="message-edit-actions">
                <button class="secondary-button" type="button" data-save-api-connection>
                    <i class="fa-solid fa-floppy-disk"></i>
                    保存连接字段
                </button>
            </div>
        </div>
    `;
    }

    function renderTextCompletionSamplingField(field, settings) {
        return `
        <label class="field-label">
            <span>${escapeHtml(field.label)}</span>
            <input class="text-input" type="number" step="${escapeHtml(field.step)}" data-textgen-sampling="${escapeHtml(field.key)}" value="${escapeHtml(getNumberSetting(settings, field.key, field.fallback))}">
        </label>
    `;
    }

    function getTextCompletionProfile() {
        const settings = state.settings || {};
        const textgen = settings.textgenerationwebui_settings || {};
        const source = textgen.type || settings.textgen_type || 'ooba';
        const rawEndpoint = getTextCompletionEndpoint(textgen, source, settings);

        return {
            source,
            model: getTextCompletionModel(textgen, source),
            preset: textgen.preset || settings.textgenerationwebui_preset || settings.textgenerationwebui_settings_preset || '',
            rawEndpoint,
            endpoint: maskEndpoint(rawEndpoint),
        };
    }

    function getTextCompletionModel(textgen, source) {
        const modelField = textCompletionModelFields[source];
        return (modelField ? textgen[modelField] : '') || textgen.model || '';
    }

    function getTextCompletionEndpoint(textgen, source, settings) {
        return textgen.server_urls?.[source] || textgen.api_server || settings.api_server_textgenerationwebui || '';
    }

    function getTextCompletionTypeOptions(source) {
        const knownTypes = new Set(textCompletionTypeOptions.map(option => option.id));
        if (!source || knownTypes.has(source)) {
            return textCompletionTypeOptions;
        }

        return [
            ...textCompletionTypeOptions,
            { id: source, label: source },
        ];
    }

    function getTextCompletionSecretKey(source) {
        return secretKeyByTextCompletionType[source];
    }

    function getTextCompletionSecretUiState(source) {
        const secretKey = getTextCompletionSecretKey(source);
        const value = secretKey ? state.secretState?.[secretKey] : null;
        const secretState = Array.isArray(value) ? value : [];
        return {
            hasSecretMapping: Boolean(secretKey),
            secretKey: secretKey || '当前来源没有密钥映射',
            secretSaved: secretState.length > 0,
        };
    }

    return {
        renderTextCompletionEditor,
        getTextCompletionProfile,
        getTextCompletionSecretKey,
    };
}
