import { BRIDGE_ACTIONS, BRIDGE_TIMEOUTS } from '../core/bridge-protocol.js';

// 只读观测：从 legacy bridge 拉取最近一次生成的提示词分解快照，存入 inspector 状态供只读展示。
// 只发只读 action、只写 inspector 展示状态，不参与也不改动任何生成状态，属纯增量观测能力。
export function createInspectorItemizedActions({ state, callLegacyBridge, renderInspector }) {
    function getView() {
        return state.inspector.itemizedPrompt;
    }

    async function refreshItemizedPrompt() {
        const view = getView();
        if (view.loading) {
            return;
        }

        view.loading = true;
        view.error = '';
        renderInspector();
        try {
            const snapshot = await callLegacyBridge(BRIDGE_ACTIONS.GET_ITEMIZED_PROMPT, {}, BRIDGE_TIMEOUTS.STATUS);
            view.loaded = true;
            // 记录快照所属聊天，切换聊天后据此判定为过期并重新拉取，避免展示别的聊天的旧分解。
            view.chatId = state.selected.chat;
            view.data = snapshot?.available ? snapshot : null;
        } catch (error) {
            view.error = error.message;
        } finally {
            view.loading = false;
            renderInspector();
        }
    }

    // inspector 打开时按需首拉：仅在 chat 路由且尚未拉取过时触发，后续更新由刷新按钮驱动，避免重复重算 token。
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

    return {
        refreshItemizedPrompt,
        refreshItemizedPromptOnInspectorOpen,
        toggleItemizedPrompt,
    };
}
