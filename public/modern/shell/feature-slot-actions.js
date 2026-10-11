import { createChatGlobalSearchActions } from '../actions/chat-global-search.js';

/**
 * 聊天工具、设置页工具和输入框连接标签等界面插槽的业务动作注册处。
 *
 * 返回值按功能分组：{ authorsNote: { ... }, summary: { ... } }。每个组里的函数会原样并入所有路由上下文
 * （见 shell/route-context-chat.js 的 createFeatureSlotRouteContext），面板、事件文件、设置分区直接从 ctx 解构使用，
 * 所以接一个新功能只需要：
 *   1. 新建 actions/<功能>.js，导出 create<功能>Actions(deps)；
 *   2. 在下面的返回对象里加一行，例如 `authorsNote: createChatAuthorsNoteActions({ state, apiFetch, render, showToast, ... })`；
 *   3. 业务动作名在所有功能之间唯一，不能与已有路由上下文里的名字重复，否则启动时会直接抛错。
 *
 * deps 里能直接拿到的东西：state、apiFetch、apiFetchResponse、loadData、render、showToast、callLegacyBridge、
 * subscribeProgress、bridgeReload，以及聊天动作注册表返回的全部内容 actionRegistry
 * （例如 actionRegistry.getSelectedChatEntity、actionRegistry.chatContextActions.updateModernChat）。
 */

import { createChatBackgroundActions } from '../actions/chat-background.js';
import { createChatAuthorsNoteActions } from '../actions/chat-authors-note.js';
import { createMaintenanceActions } from '../actions/maintenance.js';

/**
 * @typedef {object} FeatureSlotDeps
 * @property {any} state 全局界面状态。
 * @property {Function} apiFetch 带 CSRF 的 JSON 请求。
 * @property {Function} apiFetchResponse 返回原始 Response 的请求。
 * @property {Function} loadData 重新读取全部数据。
 * @property {Function} render 重新渲染当前路由。
 * @property {Function} showToast 弹出提示。
 * @property {Function} callLegacyBridge 调用隐藏引擎。
 * @property {Function} subscribeProgress 订阅引擎进度。
 * @property {any} bridgeReload 引擎同步函数（reloadChat 等）。
 * @property {Record<string, any>} actionRegistry createActionRegistry 的完整返回值。
 */

/**
 * @param {FeatureSlotDeps} deps 见文件顶部说明。
 * @returns {Record<string, Record<string, any>>} 按功能分组的动作。
 */
export function createFeatureSlotActions(deps) {
    return {
        maintenance: createMaintenanceActions(deps), // 设置页「数据维护」（B4）
        chatGlobalSearch: createChatGlobalSearchActions(deps), // 跨角色聊天搜索（B2）
        // 目前没有任何功能接入；各功能代理在这里各加一行自己的分组
        chatBackground: createChatBackgroundActions(deps),
        authorsNote: createChatAuthorsNoteActions(deps), // 作者注释（A5）
        // 备用开场白（A4）：面板外的消息区按钮「载入备用开场白」，逻辑在 chat-generation.js 的 loadAlternateGreetings
        greetings: { loadAlternateGreetings: (...args) => deps.actionRegistry.chatGenerationActions.loadAlternateGreetings(...args) },
    };
}
