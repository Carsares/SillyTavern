import { createApiStateComponents } from '../public/modern/components/api-state.js';

// Builds a getApiProfiles() over a synthetic settings blob. The chat-completion / text-completion
// helpers are stubbed; the assertions check the resolved 主连接 summary, not that a stub was called.
function makeProfiles(settings) {
    const ctx = {
        state: { settings },
        secretKeyByChatSource: {},
        formatNumber: value => String(value),
        maskEndpoint: url => url || '',
        getProviderInfo: () => ({ api: settings.main_api, chatSource: '', model: '', preset: '' }),
        getSelectedApiMain: () => settings.main_api,
        getChatCompletionModel: (oaiSettings, source) => (source === 'custom' ? oaiSettings.custom_model || '' : ''),
        getSecretStateForSource: () => [],
        getChatCompletionEndpoint: () => 'https://endpoint',
        getTextCompletionProfile: () => ({ source: 'ooba', model: 'textgen-model', preset: 'P', endpoint: 'http://tg' }),
        getTextCompletionSecretKey: () => '',
    };
    return createApiStateComponents(ctx).getApiProfiles();
}

describe('getApiProfiles 主连接 resolves source/model per main API', () => {
    test('chat completion shows the real provider and model, not the internal main_api id', () => {
        const main = makeProfiles({
            main_api: 'openai',
            chat_completion_source: 'custom',
            oai_settings: { chat_completion_source: 'custom', custom_model: 'deepseek-v4-flash' },
        })[0];
        expect(main.title).toBe('主连接');
        expect(main.source).toBe('custom'); // not 'openai'
        expect(main.model).toBe('deepseek-v4-flash');
    });

    test('novel uses model_novel and the novel provider, ignoring a stale flat settings.model', () => {
        const main = makeProfiles({ main_api: 'novel', model_novel: 'nai-v4', model: 'stale-custom', oai_settings: {} })[0];
        expect(main.source).toBe('novel');
        expect(main.model).toBe('nai-v4');
    });

    test('koboldhorde joins the selected horde models', () => {
        const main = makeProfiles({ main_api: 'koboldhorde', horde_settings: { models: ['modelA', 'modelB'] }, oai_settings: {} })[0];
        expect(main.source).toBe('koboldhorde');
        expect(main.model).toBe('modelA、modelB');
    });
});
