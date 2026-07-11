import { saveSettingsSerialized } from '../core/keyed-queue.js';

// NovelAI subscription tiers returned by /user/subscription, surfaced as the connection status
const NAI_TIERS = { 0: 'Paper', 1: 'Tablet', 2: 'Scroll', 3: 'Opus' };

// NovelAI connection: an API key (secret NOVEL) + a static model choice (settings.model_novel)
export function createApiNovelConnectionActions({
    state,
    elements,
    apiFetch,
    loadData,
    render,
    showToast,
    recordApiTestResult,
}) {
    function getNovelModelFromForm() {
        return elements.content.querySelector('[data-novel-model]')?.value || state.settings.model_novel || 'clio-v1';
    }

    async function saveNovelConnectionFromForm() {
        const model = getNovelModelFromForm();
        const keyInput = elements.content.querySelector('[data-novel-api-key]');
        const apiKey = keyInput?.value.trim() || '';

        state.settings.main_api = 'novel';
        state.settings.model_novel = model;

        if (apiKey) {
            await apiFetch('/api/secrets/write', { body: { key: 'api_key_novel', value: apiKey, label: 'novel modern' } });
        }

        await saveSettingsSerialized(apiFetch, state.settings);
        state.apiMainDraft = '';
        await loadData({ silent: true });
        showToast('NovelAI 连接已保存', model);
    }

    async function testNovelConnection() {
        const model = getNovelModelFromForm();
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
        saveNovelConnectionFromForm,
        testNovelConnection,
    };
}
