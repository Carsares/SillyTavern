import { describeConnection, withRawValue } from '../core/connection-labels.js';
import { readConnectionManager, findConnectionProfile } from '../actions/connection-profiles.js';

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

    // 「连接档案」一行说的是真正保存的档案（旧版连接管理扩展的 extension_settings.connectionManager），
    // 不是页面上由当前设置整理出的几张来源卡；一个都没有只是还没创建，不算要检查
    function getConnectionProfilesCheck(derivedCards) {
        const saved = readConnectionManager(state.settings || {});
        if (!saved.profiles.length) {
            const hasConnection = derivedCards.some(card => card.source || card.model || card.endpoint);
            return {
                label: '连接档案',
                state: 'pending',
                statusText: '未创建',
                detail: hasConnection ? '还没有连接档案，可以把当前连接存成档案方便切换。' : '还没有连接档案，也还没有配置连接。',
            };
        }
        const current = saved.selectedProfile ? findConnectionProfile(state.settings, saved.selectedProfile) : null;
        return {
            label: '连接档案',
            state: 'configured',
            detail: `${formatNumber(saved.profiles.length)} 个档案${current ? `，当前：${current.name}` : '，当前没有选中档案'}。`,
        };
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

    // Only a finished connection test can say the connection works (正常 / 可用); before that the
    // diagnostics can only report whether each piece is configured
    function getConnectionTestCheck() {
        const { status, detail } = state.apiTest;
        if (status === '可用') {
            return { label: '连接测试', state: 'ok', statusText: '可用', detail };
        }
        if (status === '失败') {
            return { label: '连接测试', state: 'error', statusText: '失败', detail };
        }
        return { label: '连接测试', state: 'pending', statusText: status || '未测试', detail };
    }

    /**
     * Diagnostic rows for the API page. `state` is one of: ok (a test passed), configured (setting present,
     * not yet proven), pending (no test result), warn (missing or risky setting), error (test failed).
     */
    function getApiChecks(provider, profiles) {
        const mainApi = getSelectedApiMain();
        const secretKey = mainApi === 'textgenerationwebui' ? getTextCompletionSecretKey(provider.chatSource) : secretKeyByChatSource[provider.chatSource];
        const textgenSecretState = secretKey ? state.secretState?.[secretKey] : null;
        const secretState = mainApi === 'textgenerationwebui' ? (Array.isArray(textgenSecretState) ? textgenSecretState : []) : getSecretStateForSource(provider.chatSource);
        const connection = describeConnection({ api: provider.api, source: provider.chatSource, model: provider.model });

        return [
            getConnectionTestCheck(),
            {
                label: '主 API',
                state: connection.mainApi ? 'configured' : 'warn',
                detail: connection.mainApi ? withRawValue(connection.mainApiLabel, connection.mainApi) : '尚未选择主 API。',
            },
            {
                label: '模型',
                state: provider.model ? 'configured' : 'warn',
                detail: provider.model || '未读取到模型字段。',
            },
            getConnectionProfilesCheck(profiles),
            {
                label: '密钥显示',
                state: state.secrets?.allowKeysExposure ? 'warn' : 'configured',
                statusText: state.secrets?.allowKeysExposure ? '' : '已隐藏',
                detail: state.secrets?.allowKeysExposure ? '当前允许查看密钥。' : '当前不会暴露密钥明文。',
            },
            {
                label: '当前来源密钥',
                state: !secretKey || secretState.length ? 'configured' : 'warn',
                statusText: secretKey ? '' : '无需密钥',
                detail: secretKey ? (secretState.length ? `${secretKey} 已保存` : `${secretKey} 未保存`) : '当前来源无需或暂未映射密钥。',
            },
            {
                label: 'CSRF',
                state: state.csrfToken ? 'configured' : 'warn',
                statusText: state.csrfToken ? '已获取' : '',
                detail: state.csrfToken ? '现代页请求令牌已获取。' : '尚未获取请求令牌。',
            },
        ];
    }

    return {
        getApiProfiles,
        getCurrentProviderInfo,
        getApiChecks,
    };
}
