import { describeReloadFailure } from '../core/bridge-reload.js';
import { clearMessageTranslation, getMessageTranslationView, getMessageUiKey, hasMessageTranslation } from '../core/translation.js';

export function createChatMessageActions({
    state,
    render,
    showToast,
    getSelectedChatEntity,
    getChatContextKey,
    getSelectedChatMessages,
    getCurrentDraftKey,
    getChatCacheKey,
    isGroupChatMode,
    updateModernChat,
    refreshSelectedChatList,
    reloadChat,
}) {
    // 同步通道：消息编辑/删除保存成功后，用当前选中实体口径（与生成引擎 generate 一致）通知 iframe 重载当前聊天。
    function buildReloadChatPayload(entity, groupMode, chatId) {
        return groupMode ? { groupId: entity.id, chat: chatId } : { avatar: entity.avatar, chat: chatId };
    }

    // 等引擎重开聊天；失败时在已有的成功提示之外补一条说明（生成引擎仍可能用旧内容）
    async function syncEngineAfterEdit(entity, groupMode, chatId, doneTitle) {
        const reload = await reloadChat(buildReloadChatPayload(entity, groupMode, chatId));
        if (reload && reload.ok === false) {
            showToast(doneTitle, `已保存到聊天文件${describeReloadFailure(reload)}`);
        }
    }

    function findQueuedMessageIndex(messages, originalMessage, originalIndex) {
        if (!originalMessage?.send_date) {
            return originalIndex < messages.length ? originalIndex : -1;
        }

        return messages.findIndex(message => message?.send_date === originalMessage.send_date
            && message?.name === originalMessage.name
            && !!message?.is_user === !!originalMessage.is_user);
    }

    async function copyModernMessage(messageIndex) {
        const index = Number(messageIndex);
        const messages = getSelectedChatMessages();
        if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
            throw new Error('消息位置无效，请刷新后重试。');
        }

        const message = messages[index];
        // 复制眼前显示的那份：译文还是原文取决于「原文 / 译文」开关（见 core/translation.js 的 getMessageTranslationView）
        const text = getMessageTranslationView(message, state.chatTranslation?.viewOriginal?.[getMessageUiKey(getCurrentDraftKey(), index)]).text;
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
        const groupMode = isGroupChatMode();
        const contextKey = getChatContextKey(entity, groupMode);
        const chatId = state.selected.chat;
        if (!contextKey || !chatId) {
            throw new Error('请先选择一个聊天文件');
        }

        const index = Number(messageIndex);
        const messages = getSelectedChatMessages();
        if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
            throw new Error('消息位置无效，请刷新后重试。');
        }
        const originalMessage = messages[index];

        const deletedMessage = await updateModernChat(entity, chatId, latestMessages => {
            const latestIndex = findQueuedMessageIndex(latestMessages, originalMessage, index);
            if (latestIndex < 0) {
                throw new Error('删除目标已变化，请重新选择消息。');
            }
            return latestMessages.splice(latestIndex, 1)[0];
        }, { groupMode });
        await refreshSelectedChatList(entity, { groupMode });
        state.chatMessageDeleteConfirm = { key: '', index: -1 };
        showToast('消息已删除', deletedMessage?.name || '当前聊天');
        // 文件已改好：界面先刷新，不等引擎（引擎还没启动时重载要等它加载完）。
        render();
        // 删除已落盘，通知 iframe 生成引擎重载当前聊天，避免下次生成基于陈旧快照；同步失败只提示，不当作删除失败。
        await syncEngineAfterEdit(entity, groupMode, chatId, '消息已删除');
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
            // 编辑框始终是原文（mes）：译文只用于显示，不能让保存把译文写回原文
            text: message.mes || '',
        };
        state.chatMessageDeleteConfirm = { key: '', index: -1 };
        render();
    }

    function cancelModernMessageEdit() {
        state.chatEditing = { key: '', index: -1, text: '' };
        render();
    }

    // 返回改好的消息；原文没有变（去掉首尾空白后相同）时原样返回，不动译文。原文改了，译文就和它对不上了：
    // 与旧版翻译扩展（自动翻译关闭时编辑会删掉 display_text）一致，清掉正文译文，推理内容的译文不受影响。
    function formatEditedModernMessage(message, text) {
        if (text === String(message.mes ?? '').trim()) {
            return { message, translationCleared: false };
        }

        const nextMessage = structuredClone(message);
        nextMessage.mes = text;
        const translationCleared = hasMessageTranslation(nextMessage) && clearMessageTranslation(nextMessage, { reasoning: false });

        if (nextMessage.swipe_id !== undefined) {
            const swipeId = Math.max(0, Number(nextMessage.swipe_id) || 0);
            const swipes = Array.isArray(nextMessage.swipes) ? [...nextMessage.swipes] : [message.mes || ''];
            while (swipes.length <= swipeId) {
                swipes.push('');
            }
            swipes[swipeId] = text;
            nextMessage.swipes = swipes;
        }

        return { message: nextMessage, translationCleared };
    }

    async function saveModernMessageEdit() {
        if (state.engine.generating) {
            throw new Error('生成中不能保存编辑。');
        }

        const entity = getSelectedChatEntity();
        const groupMode = isGroupChatMode();
        const contextKey = getChatContextKey(entity, groupMode);
        const chatId = state.selected.chat;
        const editKey = getChatCacheKey(contextKey, chatId);
        const edit = state.chatEditing;
        const text = edit.text.trim();
        const messages = getSelectedChatMessages();
        if (!contextKey || !chatId || edit.key !== editKey || edit.index < 0 || edit.index >= messages.length) {
            throw new Error('编辑目标已变化，请重新选择消息。');
        }
        if (!text) {
            throw new Error('消息内容不能为空。');
        }
        const originalMessage = messages[edit.index];

        const { message: nextMessage, translationCleared } = await updateModernChat(entity, chatId, latestMessages => {
            const latestIndex = findQueuedMessageIndex(latestMessages, originalMessage, edit.index);
            if (latestIndex < 0) {
                throw new Error('编辑目标已变化，请重新选择消息。');
            }
            const edited = formatEditedModernMessage(latestMessages[latestIndex], text);
            latestMessages[latestIndex] = edited.message;
            return edited;
        }, { groupMode });
        await refreshSelectedChatList(entity, { groupMode });
        state.chatEditing = { key: '', index: -1, text: '' };
        showToast('消息已保存', `${nextMessage.name || '当前聊天'}${translationCleared ? '；原有译文和新原文对不上，已移除，需要时可以重新翻译' : ''}`);
        // 文件已改好：界面先刷新，不等引擎（引擎还没启动时重载要等它加载完）。
        render();
        // 编辑已落盘，通知 iframe 生成引擎重载当前聊天，避免下次生成基于陈旧快照；同步失败只提示，不当作保存失败。
        await syncEngineAfterEdit(entity, groupMode, chatId, '消息已保存');
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
