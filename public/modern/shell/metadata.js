export function createQueryMatcher({
    state,
    formatText,
}) {
    function matchesQuery(...values) {
        const query = formatText(state.query);
        if (!query) {
            return true;
        }

        return values.some(value => formatText(value).includes(query));
    }

    return { matchesQuery };
}

export function createShellMetadata({
    state,
    getChatCompletionModel,
    getPresetCount,
    getPersonas,
    getAssetCount,
    getRemoteResourceCount,
    getTotalChatUnreadCount,
}) {
    function getProviderInfo() {
        const settings = state.settings || {};
        const bundle = state.settingsBundle || {};
        const api = settings.main_api || '未选择';
        const oaiSettings = settings.oai_settings || {};
        // KoboldAI Classic has no completion source; its connection is the server URL
        const chatSource = api === 'kobold'
            ? (settings.api_server || '')
            : (settings.chat_completion_source || oaiSettings.chat_completion_source || '');
        // kobold's chatSource is a server URL, not a completion source, so skip the chat-completion model lookup
        const chatModel = (chatSource && api !== 'kobold') ? getChatCompletionModel(oaiSettings, chatSource) : '';
        const model = chatModel
            || (api === 'novel' ? settings.model_novel : '')
            || (api === 'koboldhorde' ? (settings.horde_settings?.models || []).join('、') : '')
            || settings.textgenerationwebui_settings?.openrouter_model
            || settings.textgenerationwebui_settings?.custom_model
            || settings.model
            || '';
        const preset = oaiSettings.preset_settings_openai || settings.preset_settings_openai || settings.preset_settings || '';

        return {
            api,
            chatSource,
            model,
            preset,
            worldCount: (bundle.world_names || []).length,
            extensionsEnabled: bundle.enable_extensions !== false,
        };
    }

    function getRouteCount(routeId) {
        switch (routeId) {
            case 'characters':
            case 'chat':
                return state.characters.length;
            case 'groups':
                return state.groups.length;
            case 'worldbooks':
                return state.worldbooks.length || (state.settingsBundle.world_names || []).length;
            case 'presets':
                return getPresetCount();
            case 'personas':
                return getPersonas().length;
            case 'assets':
                return getAssetCount();
            case 'remoteResources':
                return getRemoteResourceCount();
            case 'extensions':
                return state.extensions.length;
            default:
                return '';
        }
    }

    function getRouteUnreadCount(routeId) {
        return routeId === 'chat' ? getTotalChatUnreadCount() : 0;
    }

    return {
        getProviderInfo,
        getRouteCount,
        getRouteUnreadCount,
    };
}
