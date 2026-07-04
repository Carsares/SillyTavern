export function createQueryMatcher({
    state,
    formatText,
}) {
    function matchesQuery(...values) {
        if (!state.query) {
            return true;
        }

        return values.some(value => formatText(value).includes(state.query));
    }

    return { matchesQuery };
}

export function createShellMetadata({
    state,
    getChatCompletionModel,
    getPresetCount,
    getPersonas,
    getAssetCount,
    getTotalChatUnreadCount,
}) {
    function getProviderInfo() {
        const settings = state.settings || {};
        const bundle = state.settingsBundle || {};
        const api = settings.main_api || '未选择';
        const oaiSettings = settings.oai_settings || {};
        const chatSource = settings.chat_completion_source || oaiSettings.chat_completion_source || '';
        const chatModel = chatSource ? getChatCompletionModel(oaiSettings, chatSource) : '';
        const model = chatModel
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
