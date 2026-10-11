// KoboldAI Classic connection test: just a server URL (no key, no model list), tested via /api/backends/kobold/status.
// The address is saved by actions/api-autosave.js; the test reads the saved value.
export function createApiKoboldConnectionActions({
    state,
    apiFetch,
    render,
    showToast,
    recordApiTestResult,
}) {
    // The engine reads kai_settings.api_server first (kai-settings.js loadKoboldSettings)
    function getSavedKoboldServer() {
        return String(state.settings.kai_settings?.api_server || state.settings.api_server || '').trim();
    }

    async function testKoboldConnection() {
        const apiServer = getSavedKoboldServer();
        if (!apiServer) {
            throw new Error('请填写 KoboldAI 服务地址。');
        }

        state.apiTest = { running: true, status: '测试中', detail: apiServer };
        render();

        try {
            const response = await apiFetch('/api/backends/kobold/status', { body: { api_server: apiServer } });
            const model = response?.model || response?.version || '已连接';
            state.apiTest = { running: false, status: '可用', detail: `${apiServer}: ${model}` };
            recordApiTestResult('可用', state.apiTest.detail, { source: 'kobold', model });
            showToast('KoboldAI 连接测试成功', state.apiTest.detail);
        } catch (error) {
            state.apiTest = { running: false, status: '失败', detail: error.message };
            recordApiTestResult('失败', error.message, { source: 'kobold', model: apiServer });
            throw error;
        } finally {
            render();
        }
    }

    return {
        testKoboldConnection,
    };
}
