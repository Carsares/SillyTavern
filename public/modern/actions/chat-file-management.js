import { stripJsonlExtension } from '../core/utils.js';

function isConfirmedUnchangedChatFileError(error) {
    return error?.status === 400 || error?.status === 409;
}

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
    updateGroupMetadata,
    refreshSelectedChatList,
    loadChatMessages,
    moveChatReadState,
    deleteChatReadState,
    renameModernChatFile,
    deleteModernChatFile,
}) {
    function getChatId(chat) {
        return stripJsonlExtension(chat?.file_id || chat?.file_name || '');
    }

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
        const groupMode = isGroupChatMode();
        const contextKey = getChatContextKey(entity, groupMode);
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
        const isContextCurrent = () => isGroupChatMode() === groupMode && getChatContextKey(getSelectedChatEntity(), groupMode) === contextKey;

        const result = await renameModernChatFile(contextKey, oldChatId, async ({ confirmUnchanged } = /** @type {{ confirmUnchanged?: () => void }} */ ({})) => {
            let renameResult;
            try {
                renameResult = await apiFetch('/api/chats/rename', {
                    body: {
                        avatar_url: groupMode ? null : entity.avatar,
                        original_file: `${oldChatId}.jsonl`,
                        renamed_file: `${newChatId}.jsonl`,
                        is_group: groupMode,
                    },
                });
            } catch (error) {
                if (isConfirmedUnchangedChatFileError(error)) {
                    confirmUnchanged?.();
                }
                throw error;
            }
            if (renameResult?.error) {
                confirmUnchanged?.();
                throw new Error('聊天文件重命名失败，可能存在同名文件。');
            }
            return renameResult;
        });

        const renamedChatId = stripJsonlExtension(result?.sanitizedFileName || newChatId);
        let metadataError = null;
        if (groupMode) {
            try {
                await updateGroupMetadata(entity, nextMetadata => {
                    nextMetadata.chats = (nextMetadata.chats || []).map(chatId => chatId === oldChatId ? renamedChatId : chatId);
                    if (nextMetadata.chat_id === oldChatId) {
                        nextMetadata.chat_id = renamedChatId;
                    }
                });
            } catch (error) {
                metadataError = error;
            }
        }

        const oldKey = getChatCacheKey(contextKey, oldChatId);
        const newKey = getChatCacheKey(contextKey, renamedChatId);
        if (state.chatMessages[oldKey]) {
            state.chatMessages[newKey] = state.chatMessages[oldKey];
            delete state.chatMessages[oldKey];
        }
        if (state.chatMetadata[oldKey]) {
            state.chatMetadata[newKey] = state.chatMetadata[oldKey];
            delete state.chatMetadata[oldKey];
        }
        state.chatLists[contextKey] = (state.chatLists[contextKey] || []).map(chat => getChatId(chat) === oldChatId
            ? { ...chat, file_id: renamedChatId, file_name: `${renamedChatId}.jsonl` }
            : chat);
        moveChatReadState(contextKey, oldChatId, renamedChatId);
        if (state.chatRenaming.key === renameKey) {
            state.chatRenaming = { key: '', name: '' };
        }
        await refreshSelectedChatList(entity, { groupMode, quiet: !!metadataError });
        if (isContextCurrent()) {
            const chats = state.chatLists[contextKey] || [];
            state.selected.chat = chats.some(chat => getChatId(chat) === renamedChatId) ? renamedChatId : getChatId(chats[0]);
            if (state.selected.chat) {
                await loadChatMessages(entity, state.selected.chat, { groupMode, isContextCurrent });
            }
        }
        if (metadataError) {
            throw new Error(`聊天文件已重命名为 ${renamedChatId}.jsonl，但群聊索引更新失败：${metadataError.message}`);
        }
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
        const groupMode = isGroupChatMode();
        const contextKey = getChatContextKey(entity, groupMode);
        const chatId = stripJsonlExtension(state.chatDeleteConfirm.name);
        const deleteKey = getChatCacheKey(contextKey, state.selected.chat);
        if (!contextKey || !chatId || state.chatDeleteConfirm.key !== deleteKey) {
            throw new Error('删除目标已变化，请重新选择聊天。');
        }
        const isContextCurrent = () => isGroupChatMode() === groupMode && getChatContextKey(getSelectedChatEntity(), groupMode) === contextKey;

        await deleteModernChatFile(contextKey, chatId, async ({ confirmUnchanged } = /** @type {{ confirmUnchanged?: () => void }} */ ({})) => {
            let result;
            try {
                result = groupMode
                    ? await apiFetch('/api/chats/group/delete', { body: { id: chatId } })
                    : await apiFetch('/api/chats/delete', {
                        body: {
                            avatar_url: entity.avatar,
                            chatfile: `${chatId}.jsonl`,
                        },
                    });
            } catch (error) {
                if (isConfirmedUnchangedChatFileError(error)) {
                    confirmUnchanged?.();
                }
                throw error;
            }
            if (result?.error) {
                confirmUnchanged?.();
                throw new Error('聊天文件删除失败。');
            }
        });

        let metadataError = null;
        if (groupMode) {
            try {
                await updateGroupMetadata(entity, nextMetadata => {
                    nextMetadata.chats = (nextMetadata.chats || []).filter(item => item !== chatId);
                    if (nextMetadata.chat_id === chatId) {
                        nextMetadata.chat_id = nextMetadata.chats[0] || '';
                    }
                });
            } catch (error) {
                metadataError = error;
            }
        }

        const cacheKey = getChatCacheKey(contextKey, chatId);
        delete state.chatMessages[cacheKey];
        delete state.chatMessageLimits[cacheKey];
        delete state.chatMetadata[cacheKey];
        delete state.chatDrafts[cacheKey];
        state.chatLists[contextKey] = (state.chatLists[contextKey] || []).filter(chat => getChatId(chat) !== chatId);
        deleteChatReadState(contextKey, chatId);
        if (state.chatDeleteConfirm.key === deleteKey) {
            state.chatDeleteConfirm = { key: '', name: '' };
        }
        await refreshSelectedChatList(entity, { groupMode, quiet: !!metadataError });
        if (isContextCurrent()) {
            const chats = state.chatLists[contextKey] || [];
            state.selected.chat = getChatId(chats[0]);
            if (state.selected.chat) {
                await loadChatMessages(entity, state.selected.chat, { groupMode, isContextCurrent });
            }
        }
        if (metadataError) {
            throw new Error(`聊天文件 ${chatId}.jsonl 已删除，但群聊索引更新失败：${metadataError.message}`);
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
