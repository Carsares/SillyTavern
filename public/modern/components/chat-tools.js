/**
 * 聊天工具抽屉：聊天页头部的「聊天工具」按钮和从右侧滑出的抽屉，样式复用聊天备份抽屉（.chat-tools-drawer）。
 *
 * 每个工具是一个面板文件，格式固定为 { id, label, icon?, isAvailable(): boolean, render(): string }：
 *   authors-note  components/chat-tool-authors-note.js   A5 作者注释
 *   summary       components/chat-tool-summary.js        A6 聊天摘要
 *   background    components/chat-tool-background.js     B5 聊天背景
 * isAvailable() 为 false 的工具不出现在抽屉标签里；一个工具都不可用时聊天头部没有「聊天工具」按钮，抽屉也不渲染。
 * 面板之外的开关、标签切换、Esc 关闭都在 routes/chat-tools-events.js，不需要改 chat-thread.js、chat-layout.js、chat-composer.js。
 *
 * 做一个工具只需要改自己的四类文件（以作者注释为例）：
 *   1. components/chat-tool-authors-note.js：实现 isAvailable() 和 render()。面板的 ctx 就是路由上下文，
 *      已有 state、escapeHtml、formatNumber、showToast、render、getSelectedChatEntity 等。
 *   2. routes/chat-tool-authors-note-events.js：实现 bindChatToolAuthorsNoteEvents(ctx)，返回可选的
 *      { handleClick, handleInput, handleChange, handleKeydown, afterRender }，约定见 routes/chat-tools-events.js 顶部注释。
 *   3. state.chatAuthorsNote：core/state.js 里已留好空对象，往里加自己的字段。
 *   4. 业务动作：新建 actions/chat-authors-note.js，导出 createChatAuthorsNoteActions({ state, apiFetch, render, showToast, ... })，
 *      然后在 shell/feature-slot-actions.js 的返回对象里加一行 `authorsNote: createChatAuthorsNoteActions({...})`。
 *      该对象里的函数会原样出现在所有路由上下文里（shell/route-context-chat.js 的 createFeatureSlotRouteContext），
 *      面板和事件文件直接从 ctx 解构即可；函数名必须在全局唯一，重名会在启动时报错。
 */
import { resolveSlotAvailability } from '../core/test-flags.js';
import { createChatToolAuthorsNotePanel } from './chat-tool-authors-note.js';
import { createChatToolBackgroundPanel } from './chat-tool-background.js';
import { createChatToolSummaryPanel } from './chat-tool-summary.js';

// 抽屉里标签的排列顺序
const chatToolPanelFactories = [
    createChatToolAuthorsNotePanel,
    createChatToolSummaryPanel,
    createChatToolBackgroundPanel,
];

const registryCache = new WeakMap();

/**
 * 同一个路由上下文只创建一套面板，渲染和事件两边共用，面板自己的闭包状态才不会分叉。
 * @param {object} ctx 路由上下文。
 * @returns {{ panels: any[], getAvailablePanels: () => any[], getActivePanel: () => any }}
 */
export function getChatToolsRegistry(ctx) {
    let registry = registryCache.get(ctx);
    if (!registry) {
        registry = createChatToolsRegistry(ctx);
        registryCache.set(ctx, registry);
    }
    return registry;
}

function createChatToolsRegistry(ctx) {
    const { state } = ctx;
    const panels = chatToolPanelFactories.map(createPanel => createPanel(ctx));

    function getAvailablePanels() {
        return panels.filter(panel => resolveSlotAvailability('chatTools', panel.id, panel.isAvailable()));
    }

    // 记住的标签不可用时（换了聊天、功能关闭）退回第一个可用工具；这里只读 state，不改它
    function getActivePanel() {
        const available = getAvailablePanels();
        return available.find(panel => panel.id === state.chatTools.tab) || available[0] || null;
    }

    return { panels, getAvailablePanels, getActivePanel };
}

export function createChatToolsComponents(ctx) {
    const { state, escapeHtml } = ctx;
    const registry = getChatToolsRegistry(ctx);

    function renderChatToolsButton() {
        if (!registry.getAvailablePanels().length) {
            return '';
        }

        return `
        <button class="secondary-button" type="button" data-chat-tools-toggle aria-expanded="${state.chatTools.open ? 'true' : 'false'}">
            <i class="fa-solid fa-screwdriver-wrench"></i>
            聊天工具
        </button>
    `;
    }

    function renderChatToolsDrawer() {
        const available = registry.getAvailablePanels();
        if (!state.chatTools.open || !available.length) {
            return '';
        }

        const active = registry.getActivePanel();
        return `
        <button class="chat-tools-scrim" type="button" data-chat-tools-close aria-label="关闭聊天工具"></button>
        <aside class="chat-tools-drawer" role="dialog" aria-label="聊天工具" data-chat-tools-drawer>
            <section class="panel chat-tool-panel">
                <div class="panel-header chat-tool-header">
                    <div class="chat-tool-heading">
                        <h2 class="panel-title">聊天工具</h2>
                        <p class="panel-subtitle">只作用于当前聊天。</p>
                    </div>
                    <div class="panel-actions">
                        <button class="icon-button" type="button" data-chat-tools-close title="关闭聊天工具" aria-label="关闭聊天工具">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                </div>
                <div class="segmented-control chat-tools-tabs" role="tablist" aria-label="聊天工具">
                    ${available.map(panel => `
                        <button class="${panel.id === active.id ? 'active' : ''}" type="button" role="tab" data-chat-tools-tab="${escapeHtml(panel.id)}" aria-selected="${panel.id === active.id}">
                            ${panel.icon ? `<i class="fa-solid ${escapeHtml(panel.icon)}"></i>` : ''}
                            ${escapeHtml(panel.label)}
                        </button>
                    `).join('')}
                </div>
                <div class="chat-tool-body" role="tabpanel" data-chat-tools-body data-chat-tool-pane="${escapeHtml(active.id)}">
                    ${active.render()}
                </div>
            </section>
        </aside>
    `;
    }

    return {
        renderChatToolsButton,
        renderChatToolsDrawer,
    };
}
