import { saveSettingsSerialized } from '../core/keyed-queue.js';

// KoboldAI Classic connection: just a server URL (no key, no model list), tested via /api/backends/kobold/status
export function createApiKoboldConnectionActions({
    state,
    elements,
    apiFetch,
    loadData,
    render,
    showToast,
    recordApiTestResult,
}) {
    function getKoboldServerFromForm() {
        const input = elements.content.querySelector('[data-kobold-api-url]');
        return (input?.value.trim() || state.settings.api_server || '').trim();
    }

    async function saveKoboldConnectionFromForm() {
        const apiServer = getKoboldServerFromForm();
        if (!apiServer) {
            throw new Error('请填写 KoboldAI 服务地址。');
        }
        state.settings.main_api = 'kobold';
        state.settings.api_server = apiServer;
        await saveSettingsSerialized(apiFetch, state.settings);
        state.apiMainDraft = '';
        await loadData({ silent: true });
        showToast('KoboldAI 连接已保存', apiServer);
    }

    async function testKoboldConnection() {
        const apiServer = getKoboldServerFromForm();
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
        saveKoboldConnectionFromForm,
        testKoboldConnection,
    };
}
