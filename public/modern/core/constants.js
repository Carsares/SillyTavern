export const routes = [
    { id: 'dashboard', label: '总览', icon: 'fa-gauge-high' },
    { id: 'chat', label: '聊天', icon: 'fa-comments' },
    { id: 'characters', label: '角色', icon: 'fa-address-card' },
    { id: 'groups', label: '群组', icon: 'fa-users' },
    { id: 'worldbooks', label: '世界书', icon: 'fa-book-open' },
    { id: 'presets', label: '预设', icon: 'fa-sliders' },
    { id: 'personas', label: '用户人设', icon: 'fa-user-gear' },
    { id: 'assets', label: '素材', icon: 'fa-folder-tree' },
    { id: 'remoteResources', label: '远程资源', icon: 'fa-cloud-arrow-down' },
    { id: 'api', label: 'API', icon: 'fa-plug' },
    { id: 'extensions', label: '扩展', icon: 'fa-cubes' },
    { id: 'activity', label: '活动', icon: 'fa-chart-line' },
    { id: 'settings', label: '设置', icon: 'fa-gear' },
];

export const routeLabels = Object.fromEntries(routes.map(route => [route.id, route.label]));

export const chatCompletionModelFields = {
    openai: 'openai_model',
    claude: 'claude_model',
    openrouter: 'openrouter_model',
    ai21: 'ai21_model',
    makersuite: 'google_model',
    vertexai: 'vertexai_model',
    mistralai: 'mistralai_model',
    custom: 'custom_model',
    cohere: 'cohere_model',
    perplexity: 'perplexity_model',
    groq: 'groq_model',
    chutes: 'chutes_model',
    electronhub: 'electronhub_model',
    nanogpt: 'nanogpt_model',
    deepseek: 'deepseek_model',
    aimlapi: 'aimlapi_model',
    xai: 'xai_model',
    pollinations: 'pollinations_model',
    moonshot: 'moonshot_model',
    fireworks: 'fireworks_model',
    cometapi: 'cometapi_model',
    azure_openai: 'azure_openai_model',
    zai: 'zai_model',
    siliconflow: 'siliconflow_model',
    workers_ai: 'workers_ai_model',
    minimax: 'minimax_model',
};

export const chatCompletionSourceOptions = [
    { id: 'openai', label: 'OpenAI' },
    { id: 'siliconflow', label: 'SiliconFlow' },
    { id: 'deepseek', label: 'DeepSeek' },
    { id: 'openrouter', label: 'OpenRouter' },
    { id: 'custom', label: 'Custom OpenAI-compatible' },
    { id: 'claude', label: 'Claude' },
    { id: 'ai21', label: 'AI21' },
    { id: 'makersuite', label: 'Google AI Studio' },
    { id: 'vertexai', label: 'Google Vertex AI' },
    { id: 'mistralai', label: 'MistralAI' },
    { id: 'cohere', label: 'Cohere' },
    { id: 'perplexity', label: 'Perplexity' },
    { id: 'groq', label: 'Groq' },
    { id: 'chutes', label: 'Chutes' },
    { id: 'electronhub', label: 'ElectronHub' },
    { id: 'nanogpt', label: 'NanoGPT' },
    { id: 'aimlapi', label: 'AI/ML API' },
    { id: 'xai', label: 'xAI' },
    { id: 'pollinations', label: 'Pollinations' },
    { id: 'moonshot', label: 'Moonshot' },
    { id: 'fireworks', label: 'Fireworks' },
    { id: 'cometapi', label: 'CometAPI' },
    { id: 'azure_openai', label: 'Azure OpenAI' },
    { id: 'zai', label: 'Z.AI' },
    { id: 'workers_ai', label: 'Workers AI' },
    { id: 'minimax', label: 'MiniMax' },
];

/**
 * 旧版 `/api` 斜杠命令使用的 API 别名表（public/scripts/slash-commands.js 的 setupConnectAPIMap）。连接档案的 `api` 字段存的就是这里的键，
 * 例如 `google`（其实是 makersuite 来源）、`openrouter`（聊天补全）与 `openrouter-text`（文本补全）。
 * 键的顺序与旧版一致：由当前设置反查别名时取第一个匹配的键（makersuite 先命中 `google`，koboldcpp 先命中 `koboldcpp`），
 * tests/modern-connection-profiles.test.js 会对照旧版源码里的 textgen_types / chat_completion_sources 检查有没有漏项。
 * selected 是 main_api 的取值，source 是聊天补全来源，type 是文本补全类型。
 */
const legacyTextCompletionTypes = [
    'ooba', 'mancer', 'vllm', 'aphrodite', 'tabby', 'koboldcpp', 'togetherai', 'llamacpp', 'ollama',
    'infermaticai', 'dreamgen', 'openrouter', 'featherless', 'huggingface', 'generic',
];
const legacyChatCompletionSources = [
    'openai', 'claude', 'openrouter', 'ai21', 'makersuite', 'vertexai', 'mistralai', 'custom', 'cohere', 'perplexity',
    'groq', 'electronhub', 'chutes', 'nanogpt', 'deepseek', 'aimlapi', 'xai', 'pollinations', 'moonshot', 'fireworks',
    'cometapi', 'azure_openai', 'zai', 'siliconflow', 'workers_ai', 'minimax',
];

function buildConnectApiMap() {
    /** @type {Record<string, { selected: string, source?: string, type?: string }>} */
    const map = {
        kobold: { selected: 'kobold' },
        horde: { selected: 'koboldhorde' },
        novel: { selected: 'novel' },
        koboldcpp: { selected: 'textgenerationwebui', type: 'koboldcpp' },
        kcpp: { selected: 'textgenerationwebui', type: 'koboldcpp' },
        openai: { selected: 'openai', source: 'openai' },
        oai: { selected: 'openai', source: 'openai' },
        google: { selected: 'openai', source: 'makersuite' },
        openrouter: { selected: 'openai', source: 'openrouter' },
        'openrouter-text': { selected: 'textgenerationwebui', type: 'openrouter' },
    };
    for (const type of legacyTextCompletionTypes) {
        if (!Object.hasOwn(map, type)) {
            map[type] = { selected: 'textgenerationwebui', type };
        }
    }
    for (const source of legacyChatCompletionSources) {
        if (!Object.hasOwn(map, source)) {
            map[source] = { selected: 'openai', source };
        }
    }
    for (const config of Object.values(map)) {
        Object.freeze(config);
    }
    return Object.freeze(map);
}

export const CONNECT_API_MAP = buildConnectApiMap();

export const apiModelSuggestions = {
    openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
    siliconflow: ['deepseek-ai/DeepSeek-V4-Pro', 'deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-235B-A22B', 'moonshotai/Kimi-K2-Instruct'],
    deepseek: ['deepseek-chat', 'deepseek-reasoner'],
    openrouter: ['openai/gpt-4.1', 'anthropic/claude-sonnet-4', 'deepseek/deepseek-chat-v3-0324'],
    custom: ['deepseek-ai/DeepSeek-V4-Pro', 'gpt-4.1-mini'],
    claude: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
    groq: ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct'],
};

export const secretKeyByChatSource = {
    openai: 'api_key_openai',
    claude: 'api_key_claude',
    openrouter: 'api_key_openrouter',
    ai21: 'api_key_ai21',
    makersuite: 'api_key_makersuite',
    vertexai: 'api_key_vertexai',
    mistralai: 'api_key_mistralai',
    custom: 'api_key_custom',
    cohere: 'api_key_cohere',
    perplexity: 'api_key_perplexity',
    groq: 'api_key_groq',
    chutes: 'api_key_chutes',
    electronhub: 'api_key_electronhub',
    nanogpt: 'api_key_nanogpt',
    deepseek: 'api_key_deepseek',
    aimlapi: 'api_key_aimlapi',
    xai: 'api_key_xai',
    pollinations: 'api_key_pollinations',
    moonshot: 'api_key_moonshot',
    fireworks: 'api_key_fireworks',
    cometapi: 'api_key_cometapi',
    azure_openai: 'api_key_azure_openai',
    zai: 'api_key_zai',
    siliconflow: 'api_key_siliconflow',
    workers_ai: 'api_key_workers_ai',
    minimax: 'api_key_minimax',
};

export const characterFormDefaults = {
    name: '',
    description: '',
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    creator: '',
    character_version: '',
    tags: '',
    world: '',
    alternate_greetings: '',
    depth_prompt_prompt: '',
    depth_prompt_depth: '4',
    depth_prompt_role: 'system',
    talkativeness: '0.5',
    favorite: false,
};

export const worldEntryDefaults = {
    key: [],
    keysecondary: [],
    comment: '',
    content: '',
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: 0,
    addMemo: false,
    order: 100,
    position: 0,
    disable: false,
    ignoreBudget: false,
    excludeRecursion: false,
    preventRecursion: false,
    probability: 100,
    useProbability: true,
    depth: 4,
    role: 0,
};

export const worldEntryPositions = [
    { value: 0, label: '角色前' },
    { value: 1, label: '角色后' },
    { value: 2, label: '作者注释顶部' },
    { value: 3, label: '作者注释底部' },
    { value: 4, label: '按深度插入' },
    { value: 5, label: '示例消息顶部' },
    { value: 6, label: '示例消息底部' },
];

export const worldEntrySelectiveLogicOptions = [
    { value: 0, label: '主关键词命中 + 次关键词任一' },
    { value: 1, label: '主关键词命中 + 次关键词不全中' },
    { value: 2, label: '主关键词命中 + 次关键词全不命中' },
    { value: 3, label: '主关键词命中 + 次关键词全命中' },
];

export const worldEntryRoleOptions = [
    { value: '', label: '默认' },
    { value: 0, label: '系统（System）' },
    { value: 1, label: '用户（User）' },
    { value: 2, label: '助手（Assistant）' },
];

export const worldEntryPageSize = 20;
