// AI Horde connection: an optional key (secret HORDE) + a multi-select of live models (settings.horde_settings.models).
// Both are saved by actions/api-autosave.js; this file loads the live model list and tests the key.
export function createApiHordeConnectionActions({
    state,
    apiFetch,
    render,
    showToast,
    recordApiTestResult,
}) {
    async function loadHordeModels({ force = false } = {}) {
        if (!force && (state.hordeModels.loaded || state.hordeModels.loading)) {
            return;
        }
        state.hordeModels.loading = true;
        if (force) {
            render();
        }
        try {
            const models = await apiFetch('/api/horde/text-models', { body: { force } });
            state.hordeModels.items = Array.isArray(models) ? models : [];
            state.hordeModels.loaded = true;
        } finally {
            state.hordeModels.loading = false;
            render();
        }
    }

    async function refreshHordeModels() {
        await loadHordeModels({ force: true });
        showToast('AI Horde 模型已刷新', `${state.hordeModels.items.length} 个可用模型`);
    }

    async function testHordeConnection() {
        state.apiTest = { running: true, status: '测试中', detail: 'AI Horde' };
        render();

        try {
            // user-info validates the stored key: {anonymous:true} without a key, otherwise the user + shared key
            const response = await apiFetch('/api/horde/user-info', { body: {} });
            if (!response || response.error) {
                throw new Error('AI Horde 校验失败。');
            }
            let detail;
            if (response.anonymous) {
                detail = 'AI Horde: 匿名连接（未设置 key）';
            } else {
                const name = response.user?.username || '已登录';
                const kudos = response.sharedKey?.kudos ?? response.user?.kudos;
                detail = `AI Horde: ${name}${kudos != null ? ` · ${kudos} kudos` : ''}`;
            }
            state.apiTest = { running: false, status: '可用', detail };
            recordApiTestResult('可用', detail, { source: 'koboldhorde', model: '' });
            showToast('AI Horde 连接测试成功', detail);
        } catch (error) {
            state.apiTest = { running: false, status: '失败', detail: error.message };
            recordApiTestResult('失败', error.message, { source: 'koboldhorde', model: '' });
            throw error;
        } finally {
            render();
        }
    }

    return {
        loadHordeModels,
        refreshHordeModels,
        testHordeConnection,
    };
}
