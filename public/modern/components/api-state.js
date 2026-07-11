export function createApiStateComponents(ctx) {
    const {
        state,
        secretKeyByChatSource,
        formatNumber,
        maskEndpoint,
        getProviderInfo,
        getSelectedApiMain,
        getChatCompletionModel,
        getSecretStateForSource,
        getChatCompletionEndpoint,
        getTextCompletionProfile,
        getTextCompletionSecretKey,
    } = ctx;

    function getApiProfiles() {
        const settings = state.settings || {};
        const oaiSettings = settings.oai_settings || {};
        const openaiSource = settings.chat_completion_source || oaiSettings.chat_completion_source || '';
        const openaiModel = openaiSource ? getChatCompletionModel(oaiSettings, openaiSource) : '';
        const textgenProfile = getTextCompletionProfile();
        const chatPreset = oaiSettings.preset_settings_openai || settings.preset_settings_openai || '';
        const chatEndpoint = getChatCompletionEndpoint(openaiSource, oaiSettings);
        const mainIsChat = settings.main_api === 'openai';
        const mainIsTextgen = settings.main_api === 'textgenerationwebui';
        // For a kobold/novel/koboldhorde main API the provider is the main_api itself; resolve that API's own model
        // rather than the flat settings.model (which is empty for novel/horde and would show 未配置)
        let otherApiModel = settings.model || '';
        if (settings.main_api === 'novel') {
            otherApiModel = settings.model_novel || '';
        } else if (settings.main_api === 'koboldhorde') {
            otherApiModel = (settings.horde_settings?.models || []).join('、');
        }
        const mainApiSource = mainIsChat ? openaiSource : (mainIsTextgen ? textgenProfile.source : (settings.main_api || ''));
        const mainApiModel = mainIsChat ? openaiModel : (mainIsTextgen ? textgenProfile.model : otherApiModel);

        return [
            {
                title: '主连接',
                kind: 'generation',
                mainApi: settings.main_api || '',
                active: true,
                source: mainApiSource,
                model: mainApiModel,
                preset: mainIsChat ? chatPreset : (mainIsTextgen ? textgenProfile.preset : settings.preset_settings || settings.active_preset || ''),
                endpoint: mainIsChat ? chatEndpoint : (mainIsTextgen ? textgenProfile.endpoint : maskEndpoint(settings.api_server || settings.api_server_textgenerationwebui || '')),
            },
            {
                title: '聊天补全',
                kind: 'chat-completions',
                mainApi: 'openai',
                active: settings.main_api === 'openai',
                source: openaiSource,
                model: openaiModel,
                preset: chatPreset,
                endpoint: chatEndpoint,
            },
            {
                title: '文本补全',
                kind: 'text-completions',
                mainApi: 'textgenerationwebui',
                active: settings.main_api === 'textgenerationwebui',
                source: textgenProfile.source,
                model: textgenProfile.model,
                preset: textgenProfile.preset,
                endpoint: textgenProfile.endpoint,
            },
        ];
    }

    function getCurrentProviderInfo() {
        const provider = getProviderInfo();
        if (getSelectedApiMain() !== 'textgenerationwebui') {
            return provider;
        }

        const textgenProfile = getTextCompletionProfile();
        return {
            ...provider,
            api: 'textgenerationwebui',
            chatSource: textgenProfile.source,
            model: textgenProfile.model,
            preset: textgenProfile.preset,
        };
    }

    function getApiChecks(provider, profiles) {
        const mainApi = getSelectedApiMain();
        const secretKey = mainApi === 'textgenerationwebui' ? getTextCompletionSecretKey(provider.chatSource) : secretKeyByChatSource[provider.chatSource];
        const textgenSecretState = secretKey ? state.secretState?.[secretKey] : null;
        const secretState = mainApi === 'textgenerationwebui' ? (Array.isArray(textgenSecretState) ? textgenSecretState : []) : getSecretStateForSource(provider.chatSource);

        return [
            {
                label: '主 API',
                state: provider.api && provider.api !== '未选择' ? 'ok' : 'warn',
                detail: provider.api && provider.api !== '未选择' ? provider.api : '尚未选择主 API。',
            },
            {
                label: '模型',
                state: provider.model ? 'ok' : 'warn',
                detail: provider.model || '未读取到模型字段。',
            },
            {
                label: '连接档案',
                state: profiles.some(profile => profile.source || profile.model || profile.endpoint) ? 'ok' : 'warn',
                detail: `${formatNumber(profiles.length)} 个可见档案。`,
            },
            {
                label: '密钥显示',
                state: state.secrets?.allowKeysExposure ? 'warn' : 'ok',
                detail: state.secrets?.allowKeysExposure ? '当前允许查看密钥。' : '当前不会暴露密钥明文。',
            },
            {
                label: '当前来源密钥',
                state: !secretKey || secretState.length ? 'ok' : 'warn',
                detail: secretKey ? (secretState.length ? `${secretKey} 已保存` : `${secretKey} 未保存`) : '当前来源无需或暂未映射密钥。',
            },
            {
                label: 'CSRF',
                state: state.csrfToken ? 'ok' : 'warn',
                detail: state.csrfToken ? '现代页请求令牌正常。' : '尚未获取请求令牌。',
            },
        ];
    }

    return {
        getApiProfiles,
        getCurrentProviderInfo,
        getApiChecks,
    };
}
