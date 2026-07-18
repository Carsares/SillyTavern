export function buildOpenAiPresetFromSettings({
    settings,
    preset = {},
    chatCompletionModelFields,
}) {
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

export function useOpenAiPresetFields(settings, preset) {
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

// chat completion 的 PromptManager 采用 global 策略，激活的 prompt_order 归属 dummyId 100001
// （见 legacy public/scripts/openai.js 的 promptManager 配置）。只有该条目会影响实际生成顺序。
export const OPENAI_PROMPT_ORDER_CHARACTER_ID = 100001;

// 取出预设中当前生效角色的 prompt_order 条目；缺失时返回 null，调用方据此跳过排序编辑。
export function getOpenAiPromptOrderEntry(preset) {
    if (!Array.isArray(preset?.prompt_order)) {
        return null;
    }
    const entry = preset.prompt_order.find(item => item?.character_id === OPENAI_PROMPT_ORDER_CHARACTER_ID);
    return Array.isArray(entry?.order) ? entry : null;
}

// 按 identifier 解析 prompt 展示名，未命中 prompts 定义时回退到 identifier 本身。
export function getOpenAiPromptName(preset, identifier) {
    const prompts = Array.isArray(preset?.prompts) ? preset.prompts : [];
    const match = prompts.find(item => item?.identifier === identifier);
    const name = typeof match?.name === 'string' ? match.name.trim() : '';
    return name || identifier;
}
