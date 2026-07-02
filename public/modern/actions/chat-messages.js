export function createChatMessageActions({
    state,
    render,
    showToast,
    getSelectedChatEntity,
    getChatContextKey,
    getSelectedChatMessages,
    getCurrentDraftKey,
    getChatCacheKey,
    saveModernChat,
    refreshSelectedChatList,
}) {
    async function copyModernMessage(messageIndex) {
        const index = Number(messageIndex);
        const messages = getSelectedChatMessages();
        if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
            throw new Error('消息位置无效，请刷新后重试。');
        }

        const message = messages[index];
        const text = message.extra?.display_text || message.mes || '';
        if (!text) {
            throw new Error('消息内容为空。');
        }

        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.append(textarea);
            textarea.select();
            document.execCommand('copy');
            textarea.remove();
        }
        showToast('消息已复制', message.name || '当前聊天');
    }

    async function deleteModernMessage(messageIndex) {
        if (state.engine.generating) {
            throw new Error('生成中不能删除消息。');
        }

        const entity = getSelectedChatEntity();
        if (!getChatContextKey(entity) || !state.selected.chat) {
            throw new Error('请先选择一个聊天文件');
        }

        const index = Number(messageIndex);
        const messages = [...getSelectedChatMessages()];
        if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
            throw new Error('消息位置无效，请刷新后重试。');
        }

        const [deletedMessage] = messages.splice(index, 1);
        await saveModernChat(entity, state.selected.chat, messages);
        await refreshSelectedChatList(entity);
        state.chatMessageDeleteConfirm = { key: '', index: -1 };
        showToast('消息已删除', deletedMessage?.name || '当前聊天');
        render();
    }

    function beginModernMessageDelete(messageIndex) {
        if (state.engine.generating) {
            showToast('删除失败', '生成中不能删除消息。');
            return;
        }

        const entity = getSelectedChatEntity();
        const contextKey = getChatContextKey(entity);
        if (!contextKey || !state.selected.chat) {
            showToast('删除失败', '请先选择一个聊天文件。');
            return;
        }

        const index = Number(messageIndex);
        const messages = getSelectedChatMessages();
        if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
            showToast('删除失败', '消息位置无效，请刷新后重试。');
            return;
        }

        state.chatMessageDeleteConfirm = { key: getCurrentDraftKey(), index };
        state.chatEditing = { key: '', index: -1, text: '' };
        render();
    }

    function cancelModernMessageDelete() {
        state.chatMessageDeleteConfirm = { key: '', index: -1 };
        render();
    }

    async function confirmModernMessageDelete() {
        const confirm = state.chatMessageDeleteConfirm;
        if (confirm.key !== getCurrentDraftKey() || confirm.index < 0) {
            throw new Error('删除目标已变化，请重新选择消息。');
        }

        await deleteModernMessage(confirm.index);
    }

    function beginModernMessageEdit(messageIndex) {
        if (state.engine.generating) {
            showToast('暂不能编辑', '生成中不能编辑消息。');
            return;
        }

        const entity = getSelectedChatEntity();
        const contextKey = getChatContextKey(entity);
        const index = Number(messageIndex);
        const messages = getSelectedChatMessages();
        if (!contextKey || !state.selected.chat || !Number.isInteger(index) || index < 0 || index >= messages.length) {
            showToast('编辑失败', '消息位置无效，请刷新后重试。');
            return;
        }

        const message = messages[index];
        state.chatEditing = {
            key: getChatCacheKey(contextKey, state.selected.chat),
            index,
            text: message.extra?.display_text || message.mes || '',
        };
        state.chatMessageDeleteConfirm = { key: '', index: -1 };
        render();
    }

    function cancelModernMessageEdit() {
        state.chatEditing = { key: '', index: -1, text: '' };
        render();
    }

    function formatEditedModernMessage(message, text) {
        const nextMessage = {
            ...message,
            mes: text,
        };

        if (nextMessage.extra?.display_text !== undefined) {
            nextMessage.extra = { ...nextMessage.extra, display_text: text };
        }

        if (nextMessage.swipe_id !== undefined) {
            const swipeId = Math.max(0, Number(nextMessage.swipe_id) || 0);
            const swipes = Array.isArray(nextMessage.swipes) ? [...nextMessage.swipes] : [message.mes || ''];
            while (swipes.length <= swipeId) {
                swipes.push('');
            }
            swipes[swipeId] = text;
            nextMessage.swipes = swipes;

            if (Array.isArray(nextMessage.swipe_info)) {
                nextMessage.swipe_info = nextMessage.swipe_info.map((item, index) => {
                    if (index !== swipeId || item?.extra?.display_text === undefined) {
                        return item;
                    }
                    return { ...item, extra: { ...item.extra, display_text: text } };
                });
            }
        }

        return nextMessage;
    }

    async function saveModernMessageEdit() {
        if (state.engine.generating) {
            throw new Error('生成中不能保存编辑。');
        }

        const entity = getSelectedChatEntity();
        const contextKey = getChatContextKey(entity);
        const editKey = getChatCacheKey(contextKey, state.selected.chat);
        const edit = state.chatEditing;
        const text = edit.text.trim();
        const messages = [...getSelectedChatMessages()];
        if (!contextKey || !state.selected.chat || edit.key !== editKey || edit.index < 0 || edit.index >= messages.length) {
            throw new Error('编辑目标已变化，请重新选择消息。');
        }
        if (!text) {
            throw new Error('消息内容不能为空。');
        }

        const nextMessage = formatEditedModernMessage(messages[edit.index], text);
        messages[edit.index] = nextMessage;

        await saveModernChat(entity, state.selected.chat, messages);
        await refreshSelectedChatList(entity);
        state.chatEditing = { key: '', index: -1, text: '' };
        showToast('消息已保存', nextMessage.name || '当前聊天');
        render();
    }

    return {
        copyModernMessage,
        deleteModernMessage,
        beginModernMessageDelete,
        cancelModernMessageDelete,
        confirmModernMessageDelete,
        beginModernMessageEdit,
        cancelModernMessageEdit,
        saveModernMessageEdit,
    };
}
