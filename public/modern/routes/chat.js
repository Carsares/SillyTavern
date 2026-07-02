import { createChatLayoutComponents } from '../components/chat-layout.js';
import { createChatBackupEvents } from './chat-backup-events.js';
import { createChatFileEvents } from './chat-file-events.js';
import { createChatMessageEvents } from './chat-message-events.js';

export function createChatRoute(ctx) {
    const {
        state,
        render,
        showToast,
        getSelectedChatEntity,
        clearChatSearch,
        prepareChatForSelectedContext,
        closeChatSidebarForMobileSelection,
        loadChatMessages,
        searchSelectedChats,
        increaseCurrentMessageLimit,
        sendModernMessage,
        cancelModernMessageDelete,
        cancelModernMessageEdit,
        getCurrentDraftKey,
        setCurrentDraft,
        importModernChatFiles,
    } = ctx;
    const { renderChat } = createChatLayoutComponents(ctx);
    const { handleChatBackupClick } = createChatBackupEvents(ctx);
    const { handleChatFileClick } = createChatFileEvents(ctx);
    const { handleChatMessageClick } = createChatMessageEvents(ctx);

    async function handleClick(event) {
        const chatModeButton = event.target.closest('[data-chat-mode]');
        if (chatModeButton) {
            const nextMode = chatModeButton.dataset.chatMode === 'group' ? 'group' : 'character';
            if (state.chatMode !== nextMode) {
                state.chatMode = nextMode;
                localStorage.setItem('st-modern-chat-mode', nextMode);
                state.selected.chat = '';
                state.chatRenaming = { key: '', name: '' };
                state.chatDeleteConfirm = { key: '', name: '' };
                state.chatEditing = { key: '', index: -1, text: '' };
                clearChatSearch();
                await prepareChatForSelectedContext();
            }
            render();
            return true;
        }

        const chatButton = event.target.closest('[data-select-chat]');
        if (chatButton) {
            state.selected.chat = chatButton.dataset.selectChat;
            await loadChatMessages(getSelectedChatEntity(), state.selected.chat);
            closeChatSidebarForMobileSelection();
            render();
            return true;
        }

        if (event.target.closest('[data-chat-search-run]')) {
            try {
                if (!state.chatSearch.query.trim()) {
                    clearChatSearch();
                } else {
                    await searchSelectedChats();
                }
                render();
            } catch (error) {
                state.errors.push({ key: 'chat-search', message: error.message });
                showToast('聊天搜索失败', error.message);
                render();
            }
            return true;
        }

        if (event.target.closest('[data-chat-search-clear]')) {
            clearChatSearch();
            render();
            return true;
        }

        if (event.target.closest('[data-load-earlier-messages]')) {
            increaseCurrentMessageLimit();
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
        if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-chat-input]')) {
            setCurrentDraft(event.target.value);
            updateComposerSendState(event.target);
            return true;
        }
        if (event.target instanceof HTMLTextAreaElement && event.target.matches('[data-edit-message-input]')) {
            state.chatEditing.text = event.target.value;
            return true;
        }
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-chat-rename-input]')) {
            state.chatRenaming.name = event.target.value;
            return true;
        }
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-chat-search-input]')) {
            state.chatSearch.query = event.target.value;
            return true;
        }

        return false;
    }

    function updateComposerSendState(input) {
        const draftLength = input.value.trim().length;
        const hasTarget = Boolean(getSelectedChatEntity());
        const canSend = !state.engine.generating && hasTarget && draftLength > 0;
        const composer = input.closest('.composer');
        const sendButton = composer?.querySelector('[data-send-message]');
        const status = composer?.querySelector('[data-composer-status]');

        if (sendButton instanceof HTMLButtonElement) {
            sendButton.disabled = !canSend;
        }
        if (status) {
            status.textContent = getComposerStatusText(draftLength, hasTarget);
        }
    }

    function getComposerStatusText(draftLength, hasTarget) {
        if (!hasTarget) {
            return '先选择角色或群聊。';
        }
        if (state.engine.generating) {
            return state.engine.detail || '生成中，请等待当前回复完成。';
        }
        if (draftLength > 0) {
            return `${draftLength} 字，准备发送。`;
        }
        return '输入消息后可发送；空消息不会提交。';
    }

    async function handleChange(event) {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-chat-import-file]')) {
            try {
                await importModernChatFiles(event.target.files);
            } catch (error) {
                state.errors.push({ key: 'chat-import', message: error.message });
                showToast('聊天导入失败', error.message);
                render();
            } finally {
                event.target.value = '';
            }
            return true;
        }

        return false;
    }

    function handleKeydown(event) {
        if (event.key === 'Escape') {
            const currentDraftKey = getCurrentDraftKey();
            if (state.chatEditing.key === currentDraftKey && state.chatEditing.index >= 0) {
                event.preventDefault();
                cancelModernMessageEdit();
                return true;
            }
            if (state.chatMessageDeleteConfirm.key === currentDraftKey && state.chatMessageDeleteConfirm.index >= 0) {
                event.preventDefault();
                cancelModernMessageDelete();
                return true;
            }
        }

        if (event.target instanceof HTMLElement && event.target.matches('[data-chat-input]') && (event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            sendModernMessage().catch(error => {
                state.errors.push({ key: 'modern-send', message: error.message });
                showToast('发送失败', error.message);
                render();
            });
            return true;
        }

        if (event.target instanceof HTMLElement && event.target.matches('[data-chat-search-input]') && event.key === 'Enter') {
            event.preventDefault();
            if (!state.chatSearch.query.trim()) {
                clearChatSearch();
                render();
                return true;
            }
            searchSelectedChats().then(() => render()).catch(error => {
                state.errors.push({ key: 'chat-search', message: error.message });
                showToast('聊天搜索失败', error.message);
                render();
            });
            return true;
        }

        return false;
    }

    return {
        render: renderChat,
        handleClick,
        handleInput,
        handleChange,
        handleKeydown,
    };
}
