import { createChatLayoutComponents } from '../components/chat-layout.js';
import { createChatBackupEvents } from './chat-backup-events.js';
import { createChatContextEvents } from './chat-context-events.js';
import { createChatFileEvents } from './chat-file-events.js';
import { createChatInputEvents, fitComposerInput } from './chat-input-events.js';
import { createChatMessageEvents } from './chat-message-events.js';
import { createChatScrollController } from './chat-scroll.js';
import { createChatToolsEvents } from './chat-tools-events.js';

export function createChatRoute(ctx) {
    const { renderChat } = createChatLayoutComponents(ctx);
    const { bindChatBackupDom, handleChatBackupChange, handleChatBackupClick, handleChatBackupInput } = createChatBackupEvents(ctx);
    const { handleChatContextClick } = createChatContextEvents(ctx);
    const { handleChatFileClick } = createChatFileEvents(ctx);
    const { handleChatInput, handleChatInputChange, handleChatInputKeydown } = createChatInputEvents(ctx);
    const { handleChatMessageClick } = createChatMessageEvents(ctx);
    const {
        bindChatToolsDom,
        handleChatToolsChange,
        handleChatToolsClick,
        handleChatToolsInput,
        handleChatToolsKeydown,
    } = createChatToolsEvents(ctx);
    const chatScroll = createChatScrollController({
        afterRender() {
            // render 重建了输入框，按恢复出来的草稿重新定高（发送后草稿清空即缩回一行）
            fitComposerInput(document.querySelector('[data-chat-input]'));
            bindChatBackupDom();
            bindChatToolsDom();
            // 外语开场白自动显示译文（设置中心「语言」里的开关）；条件不满足时什么也不做，同一条最多尝试一次
            void ctx.maybeAutoTranslateGreeting?.();
        },
    });

    function render() {
        chatScroll.beforeRender();
        return renderChat();
    }

    async function handleClick(event) {
        if (event.target.closest('[data-scroll-to-latest]')) {
            chatScroll.scrollToLatest();
            return true;
        }

        if (await handleChatToolsClick(event)) {
            return true;
        }

        if (await handleChatContextClick(event)) {
            return true;
        }

        if (await handleChatBackupClick(event)) {
            return true;
        }

        if (await handleChatMessageClick(event)) {
            return true;
        }

        if (await handleChatFileClick(event)) {
            return true;
        }

        return false;
    }

    function handleInput(event) {
        if (handleChatToolsInput(event)) {
            return true;
        }

        if (handleChatBackupInput(event)) {
            return true;
        }

        return handleChatInput(event);
    }

    async function handleChange(event) {
        if (await handleChatToolsChange(event)) {
            return true;
        }

        if (handleChatBackupChange(event)) {
            return true;
        }

        return handleChatInputChange(event);
    }

    function handleKeydown(event) {
        if (handleChatToolsKeydown(event)) {
            return true;
        }

        return handleChatInputKeydown(event);
    }

    return {
        render,
        handleClick,
        handleInput,
        handleChange,
        handleKeydown,
    };
}
