import { BRIDGE_ACTIONS, BRIDGE_TIMEOUTS } from './bridge-protocol.js';

// 同步通道的 modern 侧触发助手：各保存动作成功后，通知隐藏 iframe 的生成引擎从后端重载对应状态，
// 消除跨 frame 的陈旧快照（改了生效）。
//
// 每个 reloadXxx 返回 Promise，在引擎确认完成后 resolve：
//   成功 { ok: true, ...引擎回传的字段 }；失败（引擎报错、超时、iframe 加载失败）{ ok: false, error: '原因' }。
// Promise 永不 reject，调用方可以直接 await 而不必 try/catch；reload 是主保存之上的附加动作，失败只
// console.warn，由调用方按需提示，绝不让 reload 失败冒充主保存失败。
//
// 在途的重载同时记入 state.engine.settingsSyncPending（计数），并可经 waitForPendingReloads() 等待；
// 生成 / 候选切换发出前用它保证先看到最新配置。引擎侧另有一条串行队列，保证消息先后顺序下重载总是先于生成执行。

/**
 * @typedef {object} BridgeReloadResult
 * @property {boolean} ok 引擎是否确认完成
 * @property {string} [error] ok 为 false 时的原因
 */

/**
 * 没有接入隐藏引擎时的占位同步：直接视为成功。供各 action 工厂给可选的注入参数设默认值（独立构造 action 的测试不必提供）。
 * @param {...any} _args 与真实 reloadXxx 相同的参数，被忽略
 * @returns {Promise<BridgeReloadResult>} 恒为 { ok: true }
 */
export async function noEngineSync(..._args) {
    return { ok: true };
}

/**
 * 重载失败时附加在成功提示后的说明；成功返回空字符串。
 * @param {BridgeReloadResult | null | undefined} result reloadXxx 的返回值
 * @returns {string} 提示后缀
 */
export function describeReloadFailure(result) {
    if (!result || result.ok !== false) {
        return '';
    }
    return `（生成引擎未能同步：${result.error || '未知原因'}，下次生成可能仍用旧配置）`;
}

/**
 * @param {(action: string, payload?: object, timeoutMs?: number) => Promise<any>} callLegacyBridge bridge 调用函数
 * @param {object} [options] 可选项
 * @param {{ engine?: { settingsSyncPending?: number } } | null} [options.state] 提供时把在途重载数写入 state.engine.settingsSyncPending
 * @param {number} [options.timeoutMs] 单次重载等待引擎确认的上限
 */
export function createBridgeReload(callLegacyBridge, { state = null, timeoutMs = BRIDGE_TIMEOUTS.RELOAD } = {}) {
    /** @type {Set<Promise<BridgeReloadResult>>} */
    const pending = new Set();

    function publishPendingCount() {
        if (state?.engine) {
            state.engine.settingsSyncPending = pending.size;
        }
    }

    /**
     * @param {string} label 日志里的重载名
     * @param {string} action bridge 动作名
     * @param {object} payload 动作载荷
     * @returns {Promise<BridgeReloadResult>} 永不 reject 的重载结果
     */
    function runReload(label, action, payload) {
        const promise = (async () => {
            try {
                const result = await callLegacyBridge(action, payload, timeoutMs);
                if (result && typeof result === 'object' && result.ok === false) {
                    const error = String(result.error || '生成引擎同步失败。');
                    console.warn(`Modern bridge ${label} failed`, error);
                    return { ok: false, error };
                }
                return { ...(result && typeof result === 'object' ? result : {}), ok: true };
            } catch (error) {
                console.warn(`Modern bridge ${label} failed`, error);
                return { ok: false, error: error?.message || String(error) };
            }
        })();

        pending.add(promise);
        publishPendingCount();
        const settle = () => {
            pending.delete(promise);
            publishPendingCount();
        };
        promise.then(settle, settle);
        return promise;
    }

    function reloadChat(payload = {}) {
        return runReload('reloadChat', BRIDGE_ACTIONS.RELOAD_CHAT, payload);
    }

    function reloadCharacter() {
        return runReload('reloadCharacter', BRIDGE_ACTIONS.RELOAD_CHARACTER, {});
    }

    function reloadSettings() {
        return runReload('reloadSettings', BRIDGE_ACTIONS.RELOAD_SETTINGS, {});
    }

    /**
     * 通知引擎丢弃世界书缓存。
     * @param {string[] | null} [names] 受影响的世界书名；省略或为空表示全部
     * @param {{ refreshList?: boolean }} [options] refreshList 为 false 时只清缓存、不重新拉取世界书名称列表（仅改条目内容时使用）
     */
    function reloadWorldInfo(names = null, { refreshList = true } = {}) {
        const uniqueNames = Array.isArray(names) ? [...new Set(names.filter(name => typeof name === 'string' && name))] : [];
        return runReload('reloadWorldInfo', BRIDGE_ACTIONS.RELOAD_WORLDINFO, {
            ...(uniqueNames.length ? { names: uniqueNames } : {}),
            ...(refreshList === false ? { refreshList: false } : {}),
        });
    }

    /**
     * 等待当前在途的重载全部结束（含等待期间新发起的），最多等 timeoutMs。重载本身永不 reject，所以这里只回答「是否等完了」。
     * @param {{ timeoutMs?: number }} [options] 等待上限
     * @returns {Promise<{ settled: boolean }>} settled 为 false 表示超时，仍有重载在途
     */
    async function waitForPendingReloads({ timeoutMs: waitTimeoutMs = BRIDGE_TIMEOUTS.RELOAD_WAIT } = {}) {
        if (!pending.size) {
            return { settled: true };
        }

        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let timer;
        const deadline = new Promise(resolve => {
            timer = setTimeout(() => resolve('timeout'), waitTimeoutMs);
        });
        try {
            while (pending.size) {
                const outcome = await Promise.race([Promise.allSettled([...pending]), deadline]);
                if (outcome === 'timeout') {
                    return { settled: false };
                }
            }
            return { settled: true };
        } finally {
            clearTimeout(timer);
        }
    }

    return { reloadChat, reloadCharacter, reloadSettings, reloadWorldInfo, waitForPendingReloads };
}
