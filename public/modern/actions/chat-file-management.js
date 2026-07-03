import { stripJsonlExtension } from '../core/utils.js';

export function createChatFileManagementActions({
    state,
    apiFetch,
    render,
    showToast,
    getSelectedChatEntity,
    getChatContextKey,
    isGroupChatMode,
    getSelectedChatList,
    getChatCacheKey,
    saveGroupMetadata,
    refreshSelectedChatList,
    loadChatMessages,
}) {
    function beginModernChatRename() {
        const entity = getSelectedChatEntity();
        const contextKey = getChatContextKey(entity);
        if (!contextKey || !state.selected.chat) {
            showToast('重命名失败', '请先选择一个聊天文件。');
            return;
        }

        const selectedChat = getSelectedChatList().find(chat => chat.file_id === state.selected.chat);
        state.chatRenaming = {
            key: getChatCacheKey(contextKey, state.selected.chat),
            name: stripJsonlExtension(selectedChat?.file_name || state.selected.chat),
        };
        state.chatDeleteConfirm = { key: '', name: '' };
        render();
    }

    function cancelModernChatRename() {
        state.chatRenaming = { key: '', name: '' };
        render();
    }

    async function saveModernChatRename() {
        const entity = getSelectedChatEntity();
        const contextKey = getChatContextKey(entity);
        const oldChatId = stripJsonlExtension(state.selected.chat);
        const newChatId = stripJsonlExtension(state.chatRenaming.name.trim());
        const renameKey = getChatCacheKey(contextKey, state.selected.chat);
        if (!contextKey || !oldChatId || !newChatId || state.chatRenaming.key !== renameKey) {
            throw new Error('重命名目标已变化，请重新选择聊天。');
        }
        if (oldChatId === newChatId) {
            cancelModernChatRename();
            return;
        }

        const result = await apiFetch('/api/chats/rename', {
            body: {
                avatar_url: isGroupChatMode() ? null : entity.avatar,
                original_file: `${oldChatId}.jsonl`,
                renamed_file: `${newChatId}.jsonl`,
                is_group: isGroupChatMode(),
            },
        });
        if (result?.error) {
            throw new Error('聊天文件重命名失败，可能存在同名文件。');
        }

        const renamedChatId = stripJsonlExtension(result?.sanitizedFileName || newChatId);
        if (isGroupChatMode()) {
            const index = entity.chats?.indexOf(oldChatId) ?? -1;
            if (index >= 0) {
                entity.chats.splice(index, 1, renamedChatId);
            }
            if (entity.chat_id === oldChatId) {
                entity.chat_id = renamedChatId;
            }
            await saveGroupMetadata(entity);
        }

        const oldKey = getChatCacheKey(contextKey, oldChatId);
        const newKey = getChatCacheKey(contextKey, renamedChatId);
        state.selected.chat = renamedChatId;
        if (state.chatMessages[oldKey]) {
            state.chatMessages[newKey] = state.chatMessages[oldKey];
            delete state.chatMessages[oldKey];
        }
        if (state.chatMetadata[oldKey]) {
            state.chatMetadata[newKey] = state.chatMetadata[oldKey];
            delete state.chatMetadata[oldKey];
        }
        state.chatRenaming = { key: '', name: '' };
        await refreshSelectedChatList(entity);
        await loadChatMessages(entity, renamedChatId);
        showToast('聊天已重命名', `${oldChatId} → ${renamedChatId}`);
        render();
    }

    function beginModernChatDelete() {
        if (state.engine.generating) {
            showToast('删除失败', '生成中不能删除聊天文件。');
            return;
        }

        const entity = getSelectedChatEntity();
        const contextKey = getChatContextKey(entity);
        const chatId = stripJsonlExtension(state.selected.chat);
        if (!contextKey || !chatId) {
            showToast('删除失败', '请先选择一个聊天文件。');
            return;
        }

        state.chatDeleteConfirm = {
            key: getChatCacheKey(contextKey, state.selected.chat),
            name: chatId,
        };
        state.chatRenaming = { key: '', name: '' };
        render();
    }

    function cancelModernChatDelete() {
        state.chatDeleteConfirm = { key: '', name: '' };
        render();
    }

    async function confirmModernChatDelete() {
        const entity = getSelectedChatEntity();
        const contextKey = getChatContextKey(entity);
        const chatId = stripJsonlExtension(state.chatDeleteConfirm.name);
        const deleteKey = getChatCacheKey(contextKey, state.selected.chat);
        if (!contextKey || !chatId || state.chatDeleteConfirm.key !== deleteKey) {
            throw new Error('删除目标已变化，请重新选择聊天。');
        }

        const result = isGroupChatMode()
            ? await apiFetch('/api/chats/group/delete', { body: { id: chatId } })
            : await apiFetch('/api/chats/delete', {
                body: {
                    avatar_url: entity.avatar,
                    chatfile: `${chatId}.jsonl`,
                },
            });
        if (result?.error) {
            throw new Error('聊天文件删除失败。');
        }

        if (isGroupChatMode()) {
            entity.chats = (entity.chats || []).filter(item => item !== chatId);
            if (entity.chat_id === chatId) {
                entity.chat_id = entity.chats[0] || '';
            }
            await saveGroupMetadata(entity);
        }

        const cacheKey = getChatCacheKey(contextKey, chatId);
        delete state.chatMessages[cacheKey];
        delete state.chatMessageLimits[cacheKey];
        delete state.chatMetadata[cacheKey];
        delete state.chatDrafts[cacheKey];
        state.chatRenaming = { key: '', name: '' };
        state.chatDeleteConfirm = { key: '', name: '' };
        state.selected.chat = '';
        await refreshSelectedChatList(entity);
        const chats = getSelectedChatList();
        state.selected.chat = chats[0]?.file_id || '';
        if (state.selected.chat) {
            await loadChatMessages(entity, state.selected.chat);
        }
        showToast('聊天已删除', `${chatId}.jsonl`);
        render();
    }

    return {
        beginModernChatRename,
        cancelModernChatRename,
        saveModernChatRename,
        beginModernChatDelete,
        cancelModernChatDelete,
        confirmModernChatDelete,
    };
}
