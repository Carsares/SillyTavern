import { createChatLayoutComponents } from '../components/chat-layout.js';
import { createChatBackupEvents } from './chat-backup-events.js';
import { createChatContextEvents } from './chat-context-events.js';
import { createChatFileEvents } from './chat-file-events.js';
import { createChatInputEvents } from './chat-input-events.js';
import { createChatMessageEvents } from './chat-message-events.js';

export function createChatRoute(ctx) {
    const { renderChat } = createChatLayoutComponents(ctx);
    const { handleChatBackupClick } = createChatBackupEvents(ctx);
    const { handleChatContextClick } = createChatContextEvents(ctx);
    const { handleChatFileClick } = createChatFileEvents(ctx);
    const { handleChatInput, handleChatInputChange, handleChatInputKeydown } = createChatInputEvents(ctx);
    const { handleChatMessageClick } = createChatMessageEvents(ctx);

    async function handleClick(event) {
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
        return handleChatInput(event);
    }

    async function handleChange(event) {
        return handleChatInputChange(event);
    }

    function handleKeydown(event) {
        return handleChatInputKeydown(event);
    }

    return {
        render: renderChat,
        handleClick,
        handleInput,
        handleChange,
        handleKeydown,
    };
}
