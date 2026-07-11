import { saveSettingsSerialized } from '../core/keyed-queue.js';

// AI Horde connection: an optional key (secret HORDE) + a multi-select of live models (settings.horde_settings.models)
export function createApiHordeConnectionActions({
    state,
    elements,
    apiFetch,
    loadData,
    render,
    showToast,
    recordApiTestResult,
}) {
    function getHordeSettings() {
        return state.settings.horde_settings || {};
    }

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

    function getSelectedHordeModels() {
        const select = elements.content.querySelector('[data-horde-model]');
        if (!select) {
            const models = getHordeSettings().models;
            return Array.isArray(models) ? models : [];
        }
        return Array.from(select.selectedOptions).map(option => option.value);
    }

    async function saveHordeConnectionFromForm() {
        const models = getSelectedHordeModels();
        const keyInput = elements.content.querySelector('[data-horde-api-key]');
        const apiKey = keyInput?.value.trim() || '';
        const hordeSettings = state.settings.horde_settings || {};

        state.settings.horde_settings = hordeSettings;
        state.settings.main_api = 'koboldhorde';
        hordeSettings.models = models;

        if (apiKey) {
            await apiFetch('/api/secrets/write', { body: { key: 'api_key_horde', value: apiKey, label: 'horde modern' } });
        }

        await saveSettingsSerialized(apiFetch, state.settings);
        state.apiMainDraft = '';
        await loadData({ silent: true });
        showToast('AI Horde 连接已保存', models.length ? `${models.length} 个模型` : '未选择模型');
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
        saveHordeConnectionFromForm,
        testHordeConnection,
    };
}
