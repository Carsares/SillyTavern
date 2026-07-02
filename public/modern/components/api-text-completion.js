import { createApiTextCompletionEditorComponents } from './api-text-completion-editor.js';

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

export function createApiTextCompletionComponents(ctx) {
    const {
        state,
        maskEndpoint,
    } = ctx;
    const { renderTextCompletionEditor } = createApiTextCompletionEditorComponents({
        ...ctx,
        getTextCompletionProfile,
        getTextCompletionSecretUiState,
        getTextCompletionTypeOptions,
    });

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
