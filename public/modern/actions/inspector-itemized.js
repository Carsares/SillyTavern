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
        if (state.route !== 'chat' || view.loaded || view.loading) {
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
