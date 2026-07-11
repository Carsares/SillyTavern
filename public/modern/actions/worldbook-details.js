import { KeyedPromiseQueue, saveSettingsSerialized } from '../core/keyed-queue.js';

export function createWorldbookDetailActions({
    state,
    apiFetch,
    loadData,
    showToast,
}) {
    const worldbookQueue = new KeyedPromiseQueue();
    const worldbookDeleteBarriers = new Map();
    const worldbookLoadTokens = new Map();

    async function loadWorldDetail(worldbookId, { force = false, isCurrent = () => true } = {}) {
        if (!worldbookId || (state.worldDetails[worldbookId] && !force)) {
            return state.worldDetails[worldbookId] || null;
        }

        const loadToken = Symbol(worldbookId);
        worldbookLoadTokens.set(worldbookId, loadToken);
        try {
            const detail = await apiFetch('/api/worldinfo/get', { body: { name: worldbookId } });
            if (!isCurrent() || worldbookLoadTokens.get(worldbookId) !== loadToken) {
                return state.worldDetails[worldbookId] || null;
            }
            state.worldDetails[worldbookId] = detail;
            return detail;
        } catch (error) {
            if (isCurrent() && worldbookLoadTokens.get(worldbookId) === loadToken) {
                state.errors.push({ key: 'worldbook', message: error.message });
                showToast('世界书读取失败', error.message);
            }
            return null;
        } finally {
            if (worldbookLoadTokens.get(worldbookId) === loadToken) {
                worldbookLoadTokens.delete(worldbookId);
            }
        }
    }

    async function saveWorldbookDetail(worldbookId, detail) {
        try {
            await apiFetch('/api/worldinfo/edit', { body: { name: worldbookId, data: detail } });
            state.worldDetails[worldbookId] = detail;
        } catch (error) {
            // The server may have committed the edit before its response failed, so cached data is no longer authoritative.
            delete state.worldDetails[worldbookId];
            throw error;
        }
    }

    async function getWorldbookExistence(worldbookId) {
        try {
            const worldbooks = await apiFetch('/api/worldinfo/list');
            return Array.isArray(worldbooks) ? worldbooks.some(item => item.file_id === worldbookId) : null;
        } catch {
            return null;
        }
    }

    async function updateWorldbookDetail(worldbookId, updateDetail) {
        if (!worldbookId || typeof updateDetail !== 'function') {
            throw new Error('世界书更新目标无效。');
        }
        if (worldbookDeleteBarriers.has(worldbookId)) {
            throw new Error('世界书已删除或正在删除，无法继续更新。');
        }

        // Serialize each world's read-modify-save cycle so later edits clone the latest saved detail.
        return worldbookQueue.run(worldbookId, async () => {
            await loadWorldDetail(worldbookId, { force: !state.worldDetails[worldbookId] });
            const detail = state.worldDetails[worldbookId];
            if (!detail) {
                throw new Error('世界书内容读取失败。');
            }

            const nextDetail = structuredClone(detail);
            const result = await updateDetail(nextDetail);
            if (result?.save === false) {
                return result;
            }
            await saveWorldbookDetail(worldbookId, nextDetail);
            return result;
        });
    }

    async function deleteWorldbookFile(worldbookId) {
        if (!worldbookId) {
            throw new Error('缺少待删除世界书。');
        }
        if (worldbookDeleteBarriers.has(worldbookId)) {
            throw new Error('世界书已删除或正在删除。');
        }

        // Block newly started edits immediately, while allowing already queued edits to finish before deletion.
        worldbookDeleteBarriers.set(worldbookId, 'deleting');
        try {
            await worldbookQueue.run(worldbookId, () => apiFetch('/api/worldinfo/delete', { body: { name: worldbookId } }));
            worldbookDeleteBarriers.set(worldbookId, 'deleted');
        } catch (error) {
            const worldbookExists = await getWorldbookExistence(worldbookId);
            if (worldbookExists === true) {
                worldbookDeleteBarriers.delete(worldbookId);
                throw error;
            }
            if (worldbookExists === null) {
                throw error;
            }
            worldbookDeleteBarriers.set(worldbookId, 'deleted');
        }
    }

    function restoreWorldbookFile(worldbookId) {
        if (worldbookDeleteBarriers.get(worldbookId) === 'deleted') {
            worldbookDeleteBarriers.delete(worldbookId);
        }
    }

    function ensureWorldbookFileWriteAllowed(worldbookId) {
        if (!worldbookId) {
            throw new Error('世界书写入目标无效。');
        }
        if (worldbookDeleteBarriers.get(worldbookId) === 'deleting') {
            throw new Error('世界书正在删除，无法创建或导入同名文件。');
        }
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
        await saveSettingsSerialized(apiFetch, state.settings);
        await loadData({ silent: true });
        showToast(nextGlobalWorlds.includes(worldbookId) ? '世界书已启用' : '世界书已停用', worldbookId);
    }

    // Persists a global world-info generation parameter (depth/budget/recursive/...) into the shared settings blob
    async function saveWorldInfoGlobalSetting(field, value) {
        state.settings.world_info_settings = state.settings.world_info_settings || {};
        state.settings.world_info_settings[field] = value;
        await saveSettingsSerialized(apiFetch, state.settings);
    }

    return {
        loadWorldDetail,
        saveWorldbookDetail,
        updateWorldbookDetail,
        deleteWorldbookFile,
        restoreWorldbookFile,
        ensureWorldbookFileWriteAllowed,
        getGlobalWorldNames,
        isGlobalWorldEnabled,
        toggleGlobalWorld,
        saveWorldInfoGlobalSetting,
    };
}
