import { chatCompletionSourceOptions } from './constants.js';
import { maskEndpoint } from './utils.js';

/**
 * @typedef {object} ConnectionInput
 * @property {string} [api] Raw `main_api` value.
 * @property {string} [source] Chat completion source or text completion type.
 * @property {string} [model] Effective model id.
 * @property {string} [endpoint] Endpoint shown in the raw-value tooltip.
 */

/**
 * @typedef {object} ConnectionDescription
 * @property {string} mainApi Raw `main_api` value ('' when unselected).
 * @property {string} mainApiLabel Human label for the main API.
 * @property {string} source Raw source / type id ('' when not applicable).
 * @property {string} sourceLabel Human label for the provider the request goes to.
 * @property {string} model Effective model id.
 * @property {string} endpoint Masked endpoint ('' when unknown).
 * @property {string} label Short "provider · model" text for chips and summaries.
 * @property {string} title Raw values, one per line, for tooltips.
 */

// Same labels as the 主 API select on the API page (components/api-current.js)
export const mainApiLabels = {
    openai: '聊天补全',
    textgenerationwebui: '文本补全',
    kobold: 'KoboldAI Classic',
    novel: 'NovelAI',
    koboldhorde: 'AI Horde',
};

// Text completion types and model fields; components/api-text-completion.js and
// actions/api-text-completion-connection.js still keep their own copies of these tables
export const textCompletionTypeOptions = [
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

export const textCompletionModelFields = {
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

const chatCompletionSourceLabels = Object.fromEntries(chatCompletionSourceOptions.map(option => [option.id, option.label]));
const textCompletionTypeLabels = Object.fromEntries(textCompletionTypeOptions.map(option => [option.id, option.label]));

/**
 * @param {string} mainApi Raw `main_api` value.
 * @returns {string} Human label, or the raw value for main APIs the Modern UI does not know.
 */
export function getMainApiLabel(mainApi) {
    return mainApiLabels[mainApi] || mainApi || '';
}

/**
 * @param {string} mainApi Raw `main_api` value.
 * @param {string} source Chat completion source or text completion type.
 * @returns {string} Label of the provider the next request is sent to.
 */
export function getConnectionSourceLabel(mainApi, source) {
    if (mainApi === 'openai') {
        return chatCompletionSourceLabels[source] || source || '';
    }
    if (mainApi === 'textgenerationwebui') {
        return textCompletionTypeLabels[source] || source || '';
    }
    return getMainApiLabel(mainApi);
}

/**
 * Text completion type, model and endpoint saved in settings.json (mirrors getTextCompletionProfile).
 * @param {Record<string, any>} settings Parsed settings.json.
 * @returns {{ type: string, model: string, endpoint: string }} Saved text completion selection.
 */
export function resolveTextCompletionSelection(settings = {}) {
    const textgen = settings.textgenerationwebui_settings || {};
    const type = textgen.type || settings.textgen_type || 'ooba';
    const modelField = textCompletionModelFields[type];
    return {
        type,
        model: (modelField ? textgen[modelField] : '') || textgen.model || '',
        endpoint: textgen.server_urls?.[type] || textgen.api_server || settings.api_server_textgenerationwebui || '',
    };
}

/**
 * Builds the labels for one connection. The main API alone ("openai") does not say where requests go,
 * so the short label names the provider and the model; the raw values stay in `title`.
 * @param {ConnectionInput} input Raw connection values.
 * @returns {ConnectionDescription} Labels for display.
 */
export function describeConnection({ api = '', source = '', model = '', endpoint = '' } = {}) {
    const mainApi = api && api !== '未选择' ? api : '';
    if (!mainApi) {
        return {
            mainApi: '',
            mainApiLabel: '',
            source: '',
            sourceLabel: '',
            model: '',
            endpoint: '',
            label: '未选择 API',
            title: '主 API（main_api）：未选择',
        };
    }

    // Only chat/text completion pick a provider through a source id. KoboldAI Classic has none and
    // getProviderInfo reports its server URL in the source slot instead.
    const hasSourceSlot = mainApi === 'openai' || mainApi === 'textgenerationwebui';
    const rawSource = hasSourceSlot ? String(source || '') : '';
    const rawEndpoint = maskEndpoint((mainApi === 'kobold' ? (endpoint || source) : endpoint) || '');
    const mainApiLabel = getMainApiLabel(mainApi);
    const sourceLabel = getConnectionSourceLabel(mainApi, rawSource);
    const titleLines = [
        `主 API（main_api）：${mainApi}`,
        hasSourceSlot ? `来源：${rawSource || '未配置'}` : '',
        `模型：${model || '未配置'}`,
        rawEndpoint ? `端点：${rawEndpoint}` : '',
    ].filter(Boolean);

    return {
        mainApi,
        mainApiLabel,
        source: rawSource,
        sourceLabel,
        model: model || '',
        endpoint: rawEndpoint,
        label: [sourceLabel || mainApiLabel, model].filter(Boolean).join(' · '),
        title: titleLines.join('\n'),
    };
}

/**
 * Connection that the saved settings route generation to.
 * @param {Record<string, any>} settings Parsed settings.json.
 * @param {{ api?: string, chatSource?: string, model?: string }} provider Result of getProviderInfo().
 * @returns {ConnectionDescription} Labels for display.
 */
export function getEffectiveConnection(settings = {}, provider = {}) {
    const mainApi = settings.main_api || '';
    if (mainApi === 'textgenerationwebui') {
        const textgen = resolveTextCompletionSelection(settings);
        return describeConnection({ api: mainApi, source: textgen.type, model: textgen.model, endpoint: textgen.endpoint });
    }

    const oaiSettings = settings.oai_settings || {};
    const source = provider.chatSource || '';
    const endpoint = mainApi === 'openai'
        ? (oaiSettings.reverse_proxy || (source === 'custom' ? oaiSettings.custom_url : '') || '')
        : '';
    return describeConnection({ api: mainApi || provider.api, source, model: provider.model, endpoint });
}

/**
 * "Label（raw）" text so a friendly name keeps the raw settings value visible.
 * @param {string} label Human label.
 * @param {string} raw Raw settings value.
 * @returns {string} Combined text.
 */
export function withRawValue(label, raw) {
    if (!raw || label === raw) {
        return label || raw || '';
    }
    return label ? `${label}（${raw}）` : raw;
}
