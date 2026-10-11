/**
 * 从消息生成的事件（WP5）：点消息勾选、快速选择、附带外貌开关、生成提示词、取消、返回勾选、Esc 退出勾选。
 * 转发约定见 routes/chat-tools-events.js 顶部注释；这个文件排在所有聊天工具前面，勾选模式下点消息要先于消息上的按钮处理。
 *
 * 勾选模式下点可勾选消息的任意位置（含消息上的按钮）都只切换勾选，消息自己的按钮不会触发；点链接照常打开、不切换；
 * 拖选文字松开时不切换，免得复制一段话时把勾选也改了。不可勾选的消息（图片、系统消息）上的点击不拦截。
 *
 * @param {any} ctx 聊天路由上下文。
 * @returns {{ handleClick?: Function, handleInput?: Function, handleChange?: Function, handleKeydown?: Function, afterRender?: Function }}
 */
import { peekChatImageView } from '../core/chat-image-state.js';
import { isChatImageSelectionActive } from '../actions/chat-image-prompt.js';

/**
 * @param {string} value 属性值。
 * @returns {string} 可放进属性选择器的值。
 */
function cssEscape(value) {
    return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(value)
        : String(value).replace(/["\\]/g, '\\$&');
}

const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file']);

/**
 * @param {any} target 事件目标。
 * @returns {boolean} 是否是正在输入文字的元素（这时 Esc 留给它自己）。
 */
function isTextEntryTarget(target) {
    const tag = String(target?.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') {
        return true;
    }
    if (tag === 'INPUT') {
        return !NON_TEXT_INPUT_TYPES.has(String(target.type || '').toLowerCase());
    }
    return Boolean(target?.isContentEditable);
}

/**
 * @param {Element} element 消息元素。
 * @returns {boolean} 这次点击是不是拖选文字结束（选区落在这条消息里且不为空）。
 */
function hasTextSelectionInside(element) {
    const selection = typeof window !== 'undefined' && typeof window.getSelection === 'function' ? window.getSelection() : null;
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        return false;
    }
    return element.contains(selection.anchorNode) || element.contains(selection.focusNode);
}

export function bindChatImagePromptEvents(ctx) {
    const {
        state,
        getCurrentDraftKey,
        toggleChatImageSelection,
        selectRecentChatImageMessages,
        clearChatImageSelection,
        setChatImageIncludeAppearance,
        generateChatImagePrompt,
        cancelChatImagePrompt,
        returnToChatImageSelection,
        exitChatImageSelection,
    } = ctx;

    function isSelecting() {
        return isChatImageSelectionActive(peekChatImageView(state, getCurrentDraftKey()), state.settings);
    }

    // 用复选框（键盘空格或点击）切换后整页重绘，焦点放回同一条消息的复选框
    function focusCheckbox(identity) {
        if (typeof document === 'undefined') {
            return;
        }
        const checkbox = document.querySelector(`[data-image-select="${cssEscape(identity)}"] [data-image-select-checkbox]`);
        if (checkbox instanceof HTMLElement) {
            checkbox.focus({ preventScroll: true });
        }
    }

    function handleClick(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') {
            return false;
        }

        if (target.closest('[data-image-select-exit]')) {
            exitChatImageSelection();
            return true;
        }
        const recent = target.closest('[data-image-select-recent]');
        if (recent) {
            selectRecentChatImageMessages(Number(recent.dataset.imageSelectRecent));
            return true;
        }
        if (target.closest('[data-image-select-clear]')) {
            clearChatImageSelection();
            return true;
        }
        if (target.closest('[data-image-prompt-generate], [data-image-prompt-regenerate]')) {
            void generateChatImagePrompt();
            return true;
        }
        if (target.closest('[data-image-prompt-cancel]')) {
            cancelChatImagePrompt();
            return true;
        }
        if (target.closest('[data-image-prompt-back]')) {
            returnToChatImageSelection();
            return true;
        }

        const message = target.closest('[data-image-select]');
        if (!message || !isSelecting()) {
            return false;
        }
        // 链接照常打开（不阻止默认行为），拖选文字也不切换；两种情况都不再交给消息上的其他处理函数
        if (target.closest('a[href]') || hasTextSelectionInside(message)) {
            return true;
        }
        // 挡住消息里 label / summary 之类的默认行为（展开开场白、展开详情），点它们也只是切换勾选
        event.preventDefault();
        const identity = message.dataset.imageSelect || '';
        const fromCheckbox = Boolean(target.closest('[data-image-select-checkbox]'));
        if (toggleChatImageSelection(identity) && fromCheckbox) {
            focusCheckbox(identity);
        }
        return true;
    }

    function handleChange(event) {
        const target = event.target;
        if (!target || typeof target.closest !== 'function') {
            return false;
        }
        if (target.closest('[data-image-prompt-appearance]')) {
            setChatImageIncludeAppearance(Boolean(target.checked));
            return true;
        }
        // 复选框的切换已经在点击里处理
        return Boolean(target.closest('[data-image-select-checkbox]'));
    }

    function handleKeydown(event) {
        if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !isSelecting()) {
            return false;
        }
        // 聊天工具抽屉、大图浮层开着时 Esc 先关它们；正在输入文字时 Esc 留给输入框
        if (state.chatTools?.open || state.chatImageGeneration?.lightbox || isTextEntryTarget(event.target)) {
            return false;
        }
        event.preventDefault();
        exitChatImageSelection();
        return true;
    }

    return {
        handleClick,
        handleChange,
        handleKeydown,
    };
}
