export function createWorldbookDetailActions({
    state,
    apiFetch,
    loadData,
    showToast,
}) {
    async function loadWorldDetail(worldbookId, { force = false } = {}) {
        if (!worldbookId || (state.worldDetails[worldbookId] && !force)) {
            return state.worldDetails[worldbookId] || null;
        }

        try {
            state.worldDetails[worldbookId] = await apiFetch('/api/worldinfo/get', { body: { name: worldbookId } });
            return state.worldDetails[worldbookId];
        } catch (error) {
            state.errors.push({ key: 'worldbook', message: error.message });
            showToast('世界书读取失败', error.message);
            return null;
        }
    }

    async function saveWorldbookDetail(worldbookId, detail) {
        await apiFetch('/api/worldinfo/edit', { body: { name: worldbookId, data: detail } });
        state.worldDetails[worldbookId] = detail;
    }

    function getGlobalWorldNames() {
        return state.settings.world_info_settings?.world_info?.globalSelect || [];
    }

    function isGlobalWorldEnabled(worldbookId) {
        return getGlobalWorldNames().includes(worldbookId);
    }

    async function toggleGlobalWorld(worldbookId) {
        if (!worldbookId) {
            return;
        }

        state.settings.world_info_settings = state.settings.world_info_settings || {};
        state.settings.world_info_settings.world_info = state.settings.world_info_settings.world_info || {};
        const globalWorlds = getGlobalWorldNames();
        const nextGlobalWorlds = globalWorlds.includes(worldbookId)
            ? globalWorlds.filter(name => name !== worldbookId)
            : [...globalWorlds, worldbookId];

        state.settings.world_info_settings.world_info.globalSelect = nextGlobalWorlds;
        await apiFetch('/api/settings/save', { body: state.settings });
        await loadData({ silent: true });
        showToast(nextGlobalWorlds.includes(worldbookId) ? '世界书已启用' : '世界书已停用', worldbookId);
    }

    return {
        loadWorldDetail,
        saveWorldbookDetail,
        getGlobalWorldNames,
        isGlobalWorldEnabled,
        toggleGlobalWorld,
    };
}
