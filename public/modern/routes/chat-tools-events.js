/**
 * 聊天工具抽屉的事件：打开、关闭（× 按钮、遮罩、Esc）、标签切换，再把事件转给各工具自己的事件文件。
 *
 * 每个工具的事件文件导出 bindChatTool…Events(ctx)，返回下面这些可选处理函数（缺哪个都行）：
 *   handleClick(event)    返回 true（或解析为 true 的 Promise）表示已处理，后面的处理函数不再收到这次点击
 *   handleInput(event)    同上，输入框 input 事件
 *   handleChange(event)   同上，change 事件
 *   handleKeydown(event)  同上，同步返回；抽屉打开时它先于 Esc 关闭，工具可以先用 Esc 取消自己的编辑状态
 *   afterRender()         每次聊天页渲染完成后调用，用来给重建后的 DOM 重新挂不能委托的监听（如输入法 compositionend）
 * 事件无论抽屉是否打开都会转给工具，所以处理函数要自己用 data-属性判断事件是不是它的。
 * 处理函数里需要的业务动作从 ctx 解构，注册方式见 components/chat-tools.js 顶部注释。
 */
import { getChatToolsRegistry } from '../components/chat-tools.js';
import { bindChatConnectionEvents } from './chat-connection-events.js';
import { bindChatToolAuthorsNoteEvents } from './chat-tool-authors-note-events.js';
import { bindChatToolBackgroundEvents } from './chat-tool-background-events.js';
import { bindChatToolSummaryEvents } from './chat-tool-summary-events.js';

export function createChatToolsEvents(ctx) {
    const { state, render } = ctx;
    const registry = getChatToolsRegistry(ctx);
    // 连接标签不属于抽屉，但和工具共用同一套转发约定，省得 routes/chat.js 再单独接一遍
    const toolHandlers = [
        bindChatToolAuthorsNoteEvents(ctx),
        bindChatToolSummaryEvents(ctx),
        bindChatToolBackgroundEvents(ctx),
        bindChatConnectionEvents(ctx),
    ].map(handlers => handlers || {});

    function openDrawer() {
        const available = registry.getAvailablePanels();
        if (!available.length) {
            return;
        }

        // 备份抽屉和工具抽屉占同一块位置，打开一个就收起另一个
        state.chatBackups.open = false;
        state.chatBackups.restoreConfirm = '';
        state.chatTools.open = true;
        state.chatTools.tab = registry.getActivePanel()?.id || available[0].id;
    }

    async function handleChatToolsClick(event) {
        if (event.target.closest('[data-chat-tools-toggle]')) {
            if (state.chatTools.open) {
                state.chatTools.open = false;
            } else {
                openDrawer();
            }
            render();
            return true;
        }

        if (event.target.closest('[data-chat-tools-close]')) {
            if (state.chatTools.open) {
                state.chatTools.open = false;
                render();
            }
            return true;
        }

        const tabButton = event.target.closest('[data-chat-tools-tab]');
        if (tabButton) {
            const tabId = tabButton.dataset.chatToolsTab;
            if (registry.getAvailablePanels().some(panel => panel.id === tabId)) {
                state.chatTools.tab = tabId;
                render();
            }
            return true;
        }

        for (const handlers of toolHandlers) {
            if (handlers.handleClick && await handlers.handleClick(event)) {
                return true;
            }
        }

        return false;
    }

    function handleChatToolsInput(event) {
        return toolHandlers.some(handlers => handlers.handleInput?.(event));
    }

    async function handleChatToolsChange(event) {
        for (const handlers of toolHandlers) {
            if (handlers.handleChange && await handlers.handleChange(event)) {
                return true;
            }
        }
        return false;
    }

    function handleChatToolsKeydown(event) {
        if (toolHandlers.some(handlers => handlers.handleKeydown?.(event))) {
            return true;
        }

        if (event.key === 'Escape' && state.chatTools.open && registry.getAvailablePanels().length) {
            event.preventDefault();
            state.chatTools.open = false;
            render();
            return true;
        }

        return false;
    }

    function bindChatToolsDom() {
        for (const handlers of toolHandlers) {
            handlers.afterRender?.();
        }
    }

    return {
        bindChatToolsDom,
        handleChatToolsChange,
        handleChatToolsClick,
        handleChatToolsInput,
        handleChatToolsKeydown,
    };
}
