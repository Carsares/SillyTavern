// NovelAI subscription tiers returned by /user/subscription, surfaced as the connection status
const NAI_TIERS = { 0: 'Paper', 1: 'Tablet', 2: 'Scroll', 3: 'Opus' };

// NovelAI connection test: an API key (secret NOVEL) + a static model choice. Both are saved by actions/api-autosave.js.
export function createApiNovelConnectionActions({
    state,
    apiFetch,
    render,
    showToast,
    recordApiTestResult,
}) {
    // The engine reads the model from nai_settings when that object exists (script.js loadNovelSettings)
    function getSavedNovelModel() {
        return state.settings.nai_settings?.model_novel || state.settings.model_novel || 'clio-v1';
    }

    async function testNovelConnection() {
        const model = getSavedNovelModel();
        state.apiTest = { running: true, status: '测试中', detail: model };
        render();

        try {
            // /status proxies /user/subscription; it reads the key from secrets and returns {error:true} on 401
            const response = await apiFetch('/api/novelai/status', { body: {} });
            if (!response || response.error) {
                throw new Error('NovelAI 校验失败，请检查 API key。');
            }
            const tier = NAI_TIERS[response.tier] ?? '已连接';
            state.apiTest = { running: false, status: '可用', detail: `NovelAI: ${tier}` };
            recordApiTestResult('可用', state.apiTest.detail, { source: 'novel', model });
            showToast('NovelAI 连接测试成功', state.apiTest.detail);
        } catch (error) {
            state.apiTest = { running: false, status: '失败', detail: error.message };
            recordApiTestResult('失败', error.message, { source: 'novel', model });
            throw error;
        } finally {
            render();
        }
    }

    return {
        testNovelConnection,
    };
}
