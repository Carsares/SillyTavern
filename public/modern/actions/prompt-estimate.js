import { BRIDGE_ACTIONS, BRIDGE_TIMEOUTS } from '../core/bridge-protocol.js';
import { onBridgeReloadSettled } from '../core/bridge-reload.js';
import { normalizePromptEstimateReply } from '../core/prompt-estimate.js';
import { onGenerationFinished } from './inspector-itemized.js';

// 设置同步完成后等这么久再估算，并把连续的同步合并成一次：保存预设、切换连接档案常会连着触发好几次 reloadSettings
const SETTINGS_ESTIMATE_DELAY_MS = 1000;

/**
 * 预估「下次发送」的提示词用量（A1 第二阶段）。引擎侧用旧版「干跑」把下次要发的提示词拼一遍、数 token（不请求模型），
 * 结果存进 state.inspector.promptEstimate，输入框下方的用量标签（components/chat-usage-label.js）和上下文抽屉的「提示词预算」区块共用它。
 * 估算不含输入框里还没发出去的草稿，也不含发送时才运行的扩展（如向量检索）。
 *
 * 触发时机：
 * - 手动：抽屉里的「估算下次发送」按钮，任何时候都可以点（引擎没加载过也会把它拉起来）。
 * - 自动，且只在生成引擎已加载（state.engine.ready）、聊天页、不在生成中、不是群聊时才发，不会为了估算把隐藏的旧版引擎页面拉起来：
 *   打开上下文抽屉时本聊天还没有估算；设置同步（reloadSettings）成功后约 1 秒。
 * - 一次生成结束后，生成之前的估算作废（标签退回「上次发送」，那时引擎里已有这次生成的真实快照）。
 * - 设置、聊天、角色、世界书同步到引擎后，已有的估算同样作废；只有设置同步且满足自动条件时才会接着重估。
 * 自动估算失败不弹任何错误，只记下原因；手动估算失败才把错误显示在抽屉里。
 * @param {object} deps 依赖
 * @param {any} deps.state 全局界面状态
 * @param {Function} deps.callLegacyBridge bridge 调用函数 (action, payload, timeoutMs) => Promise
 * @param {() => void} [deps.renderInspector] 重绘上下文抽屉（同时更新输入框下方的用量标签）
 * @param {{ waitForPendingReloads?: (options?: { timeoutMs?: number }) => Promise<any> }} [deps.bridgeReload] 引擎同步通道，用来等在途的重载
 * @param {Record<string, any>} deps.actionRegistry 聊天动作注册表，用来取当前选中的聊天对象
 * @returns {Record<string, any>} 动作；disposePromptEstimate 取消对设置同步和生成结束的订阅，供测试清理
 */
export function createPromptEstimateActions({ state, callLegacyBridge, renderInspector = () => {}, bridgeReload = {}, actionRegistry }) {
    // 估算进行中又来了新请求：等当前这次结束后再补一次，不丢掉后到的请求；手动请求的标记要保留，这样失败才会提示
    /** @type {{ manual: boolean } | null} */
    let followUp = null;
    let settingsTimer = 0;
    // 每次作废加一。请求发出时的值与回复到达时不同，说明期间发生过生成，这份回复属于生成前的状态，丢掉
    let epoch = 0;
    // 在途请求属于哪个聊天：打开抽屉时同一个聊天已经有请求在飞，就不再排一次重复的
    let inFlightChatId = '';

    function getView() {
        return state.inspector.promptEstimate;
    }

    function getTarget() {
        const entity = actionRegistry.getSelectedChatEntity();
        const groupMode = actionRegistry.isGroupChatMode();
        const chatId = state.selected.chat;
        const contextKey = actionRegistry.getChatContextKey(entity, groupMode);
        if (!entity || !contextKey || !chatId) {
            return null;
        }
        return { entity, groupMode, chatId, contextKey };
    }

    // Modern 已知的聊天文件 integrity：引擎发现自己内存里的同名聊天落后于文件时会先重开再估算，与生成请求的做法一致
    function getKnownChatIntegrity(contextKey, chatId) {
        const cacheKey = actionRegistry.chatContextActions.getChatCacheKey(contextKey, chatId);
        const integrity = state.chatMetadata?.[cacheKey]?.integrity;
        return typeof integrity === 'string' && integrity ? integrity : undefined;
    }

    // 自动触发的统一条件：聊天页、引擎已加载（不唤醒隐藏的旧版页面）、没有生成或引擎检查在进行、不是群聊
    function canAutoEstimate() {
        if (state.route !== 'chat' || !state.engine.ready || state.engine.generating || state.engine.checking) {
            return false;
        }
        const target = getTarget();
        return Boolean(target && !target.groupMode);
    }

    /**
     * 估算下次发送的提示词用量。
     * @param {{ manual?: boolean }} [options] manual 为真表示用户点了按钮：失败会显示错误，群聊会提示不支持
     * @returns {Promise<void>}
     */
    async function estimatePrompt({ manual = false } = {}) {
        const view = getView();
        if (state.engine.generating) {
            return;
        }
        const target = getTarget();
        if (!target) {
            return;
        }
        if (target.groupMode) {
            // 引擎对群聊也只会回复 group，这里直接记下原因，不为此唤醒引擎
            view.loaded = true;
            view.chatId = target.chatId;
            view.data = null;
            view.error = '';
            view.reason = 'group';
            view.message = '';
            renderInspector();
            return;
        }
        if (view.loading) {
            followUp = { manual: Boolean(followUp?.manual) || manual };
            return;
        }

        const requestedChatId = target.chatId;
        const requestedContextKey = target.contextKey;
        const requestedEpoch = epoch;
        const stillCurrent = () => requestedEpoch === epoch
            && state.selected.chat === requestedChatId
            && actionRegistry.getChatContextKey(actionRegistry.getSelectedChatEntity(), actionRegistry.isGroupChatMode()) === requestedContextKey;

        inFlightChatId = requestedChatId;
        view.loading = true;
        if (manual) {
            view.error = '';
        }
        renderInspector();
        try {
            // 先等设置 / 角色 / 聊天 / 世界书的同步结束，估的才是刚保存的配置；等待有上限，超时照常发送
            await bridgeReload.waitForPendingReloads?.();
            // 等待期间开始了生成，或者切到了别的聊天：引擎被生成占着，估算排在后面只会白等，这份结果也不属于现在的聊天
            if (!state.engine.generating && stillCurrent()) {
                const reply = await callLegacyBridge(BRIDGE_ACTIONS.ESTIMATE_PROMPT, {
                    avatar: target.entity.avatar,
                    groupId: null,
                    chat: requestedChatId,
                    integrity: getKnownChatIntegrity(requestedContextKey, requestedChatId),
                }, BRIDGE_TIMEOUTS.ESTIMATE);

                // 回复到达时已经离开这个聊天或发生过生成：不采用
                if (stillCurrent()) {
                    const outcome = normalizePromptEstimateReply(reply);
                    view.loaded = true;
                    view.chatId = requestedChatId;
                    view.data = outcome.data;
                    view.reason = outcome.reason;
                    view.message = outcome.message;
                    view.error = '';
                }
            }
        } catch (error) {
            if (stillCurrent()) {
                view.data = null;
                view.loaded = false;
                view.chatId = requestedChatId;
                view.message = '';
                if (manual) {
                    view.reason = '';
                    view.error = error.message || String(error);
                } else {
                    // 自动估算失败不打扰用户：只记下原因，抽屉里能看到并重试
                    view.reason = 'failed';
                }
            }
        } finally {
            inFlightChatId = '';
            view.loading = false;
            renderInspector();
        }

        if (followUp) {
            const next = followUp;
            followUp = null;
            await estimatePrompt(next);
        }
    }

    // 打开上下文抽屉时自动估算：本聊天还没有估算（读到过的结果，哪怕是「估不了」，也不重复请求）才发
    function estimatePromptOnInspectorOpen() {
        const view = getView();
        if ((view.loading && inFlightChatId === state.selected.chat) || (view.loaded && view.chatId === state.selected.chat) || !canAutoEstimate()) {
            return;
        }
        estimatePrompt({ manual: false });
    }

    // 一次生成结束：生成之前的估算作废，在途的请求也不再采用
    function invalidatePromptEstimate() {
        epoch++;
        window.clearTimeout(settingsTimer);
        settingsTimer = 0;
        followUp = null;
        const view = getView();
        const changed = view.loaded || view.data || view.error || view.reason;
        view.loaded = false;
        view.data = null;
        view.error = '';
        view.reason = '';
        view.message = '';
        if (changed) {
            renderInspector();
        }
    }

    // 设置同步成功后重新估算：预设、模型、上下文长度等都会改变提示词和预算。合并连续的同步，到点再按自动触发的条件检查一遍
    function scheduleEstimateAfterSettingsReload() {
        window.clearTimeout(settingsTimer);
        settingsTimer = window.setTimeout(() => {
            settingsTimer = 0;
            if (canAutoEstimate()) {
                estimatePrompt({ manual: false });
            }
        }, SETTINGS_ESTIMATE_DELAY_MS);
    }

    const unsubscribeReload = onBridgeReloadSettled(({ action }) => {
        if (action === BRIDGE_ACTIONS.RELOAD_SETTINGS && canAutoEstimate()) {
            // 旧估算先留着，新估算到达时替换
            scheduleEstimateAfterSettingsReload();
            return;
        }
        // 设置、聊天、角色或世界书变了，已有的估算不再对应下次发送，又不能自动重估（引擎没加载、不在聊天页、群聊，或这是聊天 / 角色 / 世界书的同步）：
        // 作废它，标签退回「上次发送」，免得显示按旧配置算出的数字
        invalidatePromptEstimate();
    });
    const unsubscribeGeneration = onGenerationFinished(invalidatePromptEstimate);

    function disposePromptEstimate() {
        unsubscribeReload();
        unsubscribeGeneration();
        window.clearTimeout(settingsTimer);
        settingsTimer = 0;
    }

    return {
        estimatePrompt,
        estimatePromptOnInspectorOpen,
        disposePromptEstimate,
    };
}
