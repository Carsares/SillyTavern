import { BRIDGE_ACTIONS, BRIDGE_TIMEOUTS } from '../core/bridge-protocol.js';

// 生成结束的通知：shell/inspector.js 在渲染时发现 state.engine.generating 由 true 变回 false 就调用 notifyGenerationFinished，
// 本文件创建的刷新动作订阅它，在不改 actions/chat-generation.js 的前提下，让生成结束后自动刷新提示词分解。
const generationFinishedListeners = new Set();

// 生成结束后等这么久再读提示词分解，见 createInspectorItemizedActions 里的说明
const AUTO_REFRESH_DELAY_MS = 800;

/**
 * 通知「一次生成刚结束」。订阅者各自决定要不要刷新，异常不会影响其他订阅者。
 */
export function notifyGenerationFinished() {
    for (const listener of [...generationFinishedListeners]) {
        try {
            listener();
        } catch (error) {
            console.warn('Generation finished listener failed', error);
        }
    }
}

// 只读观测：从 legacy bridge 拉取最近一次生成的提示词分解快照，存入 inspector 状态供只读展示。
// 只发只读 action、只写 inspector 展示状态，不参与也不改动任何生成状态，属纯增量观测能力。
// 快照缓存在 state.inspector.itemizedPrompt，上下文抽屉和输入框下方的用量标签（components/chat-usage-label.js）共用它。
export function createInspectorItemizedActions({ state, callLegacyBridge, renderInspector }) {
    // 刷新进行中又来了新请求（例如手动刷新时恰好一次生成结束）：等当前这次结束后再补一次，不丢掉后到的请求
    let refreshQueued = false;
    let autoRefreshTimer = 0;

    function getView() {
        return state.inspector.itemizedPrompt;
    }

    async function refreshItemizedPrompt() {
        const view = getView();
        if (view.loading) {
            refreshQueued = true;
            return;
        }

        // 记下发起时的聊天：请求期间切换了聊天，这份快照就不属于现在查看的聊天，按过期处理
        const requestedChatId = state.selected.chat;
        view.loading = true;
        view.error = '';
        renderInspector();
        try {
            const snapshot = await callLegacyBridge(BRIDGE_ACTIONS.GET_ITEMIZED_PROMPT, {}, BRIDGE_TIMEOUTS.STATUS);
            view.loaded = true;
            // 记录快照所属聊天，切换聊天后据此判定为过期并重新拉取，避免展示别的聊天的旧分解。
            view.chatId = requestedChatId;
            view.data = snapshot?.available ? snapshot : null;
        } catch (error) {
            view.error = error.message;
        } finally {
            view.loading = false;
            renderInspector();
        }

        if (refreshQueued) {
            refreshQueued = false;
            await refreshItemizedPrompt();
        }
    }

    // inspector 打开时按需首拉：仅在 chat 路由且尚未拉取过时触发，后续更新由刷新按钮和生成结束后的自动刷新驱动，避免重复重算 token。
    function refreshItemizedPromptOnInspectorOpen() {
        const view = getView();
        if (state.route !== 'chat' || view.loading) {
            return;
        }
        // 已加载且仍是同一聊天才跳过；切换聊天后 chatId 不匹配，重新拉取当前聊天的分解。
        if (view.loaded && view.chatId === state.selected.chat) {
            return;
        }
        refreshItemizedPrompt();
    }

    function toggleItemizedPrompt() {
        const view = getView();
        view.expanded = !view.expanded;
        renderInspector();
    }

    // 一次生成结束后自动刷新。两个保护：
    // 1. 引擎还没加载过（state.engine.ready 为假）时不刷新：此时没有可读的快照，发请求只会白白把隐藏的旧版引擎页面拉起来，
    //    例如只切换开场白的操作也会走「生成中」状态。
    // 2. 延迟一小会儿再读，并把连续的结束合并成一次：重新生成、继续、切换候选连点时只在最后一次之后读一遍
    //    （非聊天补全的主 API 每读一次都要重新数 token），紧接着又开始下一次生成时就不读，等那次结束再读。
    //    切换了聊天也不读，引擎里的快照属于刚才生成的聊天。
    generationFinishedListeners.add(() => {
        if (!state.engine.ready) {
            return;
        }
        const chatAtFinish = state.selected.chat;
        window.clearTimeout(autoRefreshTimer);
        autoRefreshTimer = window.setTimeout(() => {
            autoRefreshTimer = 0;
            if (state.engine.generating || state.selected.chat !== chatAtFinish) {
                return;
            }
            refreshItemizedPrompt();
        }, AUTO_REFRESH_DELAY_MS);
    });

    return {
        refreshItemizedPrompt,
        refreshItemizedPromptOnInspectorOpen,
        toggleItemizedPrompt,
    };
}
