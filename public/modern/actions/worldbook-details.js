import { noEngineSync } from '../core/bridge-reload.js';
import { KeyedPromiseQueue, saveSettingsSerialized } from '../core/keyed-queue.js';

export function createWorldbookDetailActions({
    state,
    apiFetch,
    loadData,
    showToast,
    // 同步通道：世界书文件变化后通知隐藏的生成引擎丢弃缓存（core/bridge-reload.js 的 reloadWorldInfo，永不 reject）
    reloadWorldInfo = noEngineSync,
}) {
    const worldbookQueue = new KeyedPromiseQueue();
    const worldbookDeleteBarriers = new Map();
    const worldbookLoadTokens = new Map();

    // 通知引擎丢弃这些世界书的缓存（引擎读过一次就永久缓存，不通知则生成一直用旧内容）。刻意不等引擎确认：
    // 冷启动的引擎要数秒才响应，期间编辑面板若还开着，用户重复点保存会重复提交条目；bridge-reload 已把它记为
    // 在途同步，生成 / 候选切换发出前会等它完成（有上限），引擎侧也按到达顺序先重载后生成。
    // refreshList 为 false 时只清缓存，不重新拉取世界书名称列表（只改条目内容、文件名单没变）。
    function syncEngineWorldInfo(names, options = {}) {
        (async () => {
            try {
                await reloadWorldInfo(names, options);
            } catch (error) {
                console.warn('Modern bridge reloadWorldInfo failed', error);
            }
        })();
    }

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
        let saveAttempted = false;
        try {
            return await worldbookQueue.run(worldbookId, async () => {
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
                saveAttempted = true;
                await saveWorldbookDetail(worldbookId, nextDetail);
                return result;
            });
        } finally {
            // 保存请求即使在响应前失败，服务端也可能已写入，同样让引擎重读
            if (saveAttempted) {
                syncEngineWorldInfo([worldbookId], { refreshList: false });
            }
        }
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
            syncEngineWorldInfo([worldbookId]);
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
            syncEngineWorldInfo([worldbookId]);
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
        syncEngineWorldInfo,
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
