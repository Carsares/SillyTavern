/**
 * 设置页「聊天工具」标签的事件：把点击、输入、change、keydown 依次转给各分区自己的事件文件。
 *
 * 每个分区的事件文件导出 bindSettingsTool…Events(ctx)，返回下面这些可选处理函数（缺哪个都行）：
 *   handleClick(event)    返回 true（或解析为 true 的 Promise）表示已处理，后面的处理函数不再收到这次事件
 *   handleInput(event)    同上，同步
 *   handleChange(event)   同上
 *   handleKeydown(event)  同上，同步
 * 事件在设置页任何标签下都会转发，所以处理函数要自己用 data-属性判断事件是不是它的。
 * 处理函数里需要的业务动作从 ctx 解构，注册方式见 components/chat-tools.js 顶部注释。
 */
import { bindSettingsToolReasoningEvents } from './settings-tool-reasoning-events.js';
import { bindSettingsToolSummaryEvents } from './settings-tool-summary-events.js';
import { bindSettingsToolTranslateEvents } from './settings-tool-translate-events.js';

export function bindSettingsChatToolsEvents(ctx) {
    const sectionHandlers = [
        bindSettingsToolTranslateEvents(ctx),
        bindSettingsToolReasoningEvents(ctx),
        bindSettingsToolSummaryEvents(ctx),
    ].map(handlers => handlers || {});

    async function handleClick(event) {
        for (const handlers of sectionHandlers) {
            if (handlers.handleClick && await handlers.handleClick(event)) {
                return true;
            }
        }
        return false;
    }

    function handleInput(event) {
        return sectionHandlers.some(handlers => handlers.handleInput?.(event));
    }

    async function handleChange(event) {
        for (const handlers of sectionHandlers) {
            if (handlers.handleChange && await handlers.handleChange(event)) {
                return true;
            }
        }
        return false;
    }

    function handleKeydown(event) {
        return sectionHandlers.some(handlers => handlers.handleKeydown?.(event));
    }

    return {
        handleClick,
        handleInput,
        handleChange,
        handleKeydown,
    };
}
