import { stripJsonlExtension } from '../core/utils.js';

export function createChatGenerationActions({
    state,
    render,
    showToast,
    callLegacyBridge,
    formatNumber,
    getSelectedChatEntity,
    getChatContextKey,
    getChatEntityName,
    isGroupChatMode,
    getSelectedChatMessages,
    getCurrentDraftKey,
    getChatCacheKey,
    loadChatMessages,
    refreshSelectedChatList,
    createModernChatFile,
}) {
    async function checkLegacyGenerationEngine({ quiet = false } = {}) {
        if (state.engine.checking || state.engine.generating) {
            return;
        }

        const entity = getSelectedChatEntity();
        if (!entity) {
            state.engine.status = '未选择对象';
            state.engine.detail = '请先选择角色或群聊。';
            state.engine.error = '';
            render();
            return;
        }
        state.engine.checking = true;
        state.engine.ready = false;
        state.engine.status = '检查生成引擎';
        state.engine.error = '';
        state.engine.detail = '正在加载生成上下文。';
        render();

        try {
            const result = await callLegacyBridge('status', {
                avatar: isGroupChatMode() ? null : entity?.avatar,
                groupId: isGroupChatMode() ? entity?.id : null,
                chat: state.selected.chat || '',
            }, 60000);
            const messageCount = Number(result?.messageCount || 0);
            state.engine.ready = true;
            state.engine.status = '引擎就绪';
            state.engine.detail = `${result?.chat || state.selected.chat || '未选择聊天'} · ${formatNumber(messageCount)} 条上下文消息`;
            if (!quiet) {
                showToast('生成引擎已就绪', state.engine.detail);
            }
        } catch (error) {
            state.engine.ready = false;
            state.engine.error = error.message;
            state.engine.status = '引擎不可用';
            state.engine.detail = error.message;
            if (!quiet) {
                throw error;
            }
        } finally {
            state.engine.checking = false;
            render();
        }
    }

    async function runLegacyChatGeneration(type, { entity, chatId, message = '', toastTitle, toastMessage }) {
        if (state.engine.generating) {
            return;
        }

        const contextKey = getChatContextKey(entity);
        if (!contextKey || !chatId) {
            throw new Error(isGroupChatMode() ? '请先选择群聊和聊天文件' : '请先选择角色和聊天文件');
        }

        state.engine.generating = true;
        state.engine.status = '生成中';
        state.engine.error = '';
        state.engine.detail = `${getChatEntityName(entity)} · ${chatId}`;
        render();

        try {
            const result = await callLegacyBridge('generate', {
                avatar: isGroupChatMode() ? null : entity.avatar,
                groupId: isGroupChatMode() ? entity.id : null,
                chat: chatId,
                type,
                message,
            });
            const nextChatId = stripJsonlExtension(result?.chat || chatId);
            state.selected.chat = nextChatId;
            delete state.chatMessages[getChatCacheKey(contextKey, nextChatId)];
            delete state.chatMetadata[getChatCacheKey(contextKey, nextChatId)];
            await refreshSelectedChatList(entity);
            await loadChatMessages(entity, nextChatId, { force: true });
            state.engine.ready = true;
            state.engine.status = '就绪';
            state.engine.detail = `${nextChatId} · 已同步最新消息`;
            showToast(toastTitle, toastMessage);
        } catch (error) {
            state.engine.error = error.message;
            state.engine.status = error.message.includes('停止') ? '已停止' : '生成失败';
            state.engine.detail = error.message;
            throw error;
        } finally {
            state.engine.generating = false;
            render();
        }
    }

    async function swipeModernMessage(messageIndex, direction) {
        if (state.engine.generating) {
            return;
        }

        const entity = getSelectedChatEntity();
        const contextKey = getChatContextKey(entity);
        if (!contextKey || !state.selected.chat) {
            throw new Error('请先选择一个聊天文件');
        }

        const index = Number(messageIndex);
        const messages = getSelectedChatMessages();
        if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
            throw new Error('消息位置无效，请刷新后重试。');
        }

        state.engine.generating = true;
        state.engine.status = '候选切换中';
        state.engine.error = '';
        state.engine.detail = `${state.selected.chat} · ${direction === 'left' ? '上一个候选' : '下一个候选'}`;
        render();

        try {
            const result = await callLegacyBridge('swipe', {
                avatar: isGroupChatMode() ? null : entity.avatar,
                groupId: isGroupChatMode() ? entity.id : null,
                chat: state.selected.chat,
                messageIndex: index,
                direction,
            });
            const nextChatId = stripJsonlExtension(result?.chat || state.selected.chat);
            state.selected.chat = nextChatId;
            delete state.chatMessages[getChatCacheKey(contextKey, nextChatId)];
            delete state.chatMetadata[getChatCacheKey(contextKey, nextChatId)];
            await refreshSelectedChatList(entity);
            await loadChatMessages(entity, nextChatId, { force: true });
            state.engine.ready = true;
            state.engine.status = '就绪';
            state.engine.detail = `${nextChatId} · 当前候选 ${formatNumber((result?.swipeId || 0) + 1)}/${formatNumber(result?.swipeCount || 1)}`;
            showToast('候选已切换', `当前候选 ${formatNumber((result?.swipeId || 0) + 1)}/${formatNumber(result?.swipeCount || 1)}`);
        } catch (error) {
            state.engine.error = error.message;
            state.engine.status = '候选切换失败';
            state.engine.detail = error.message;
            throw error;
        } finally {
            state.engine.generating = false;
            render();
        }
    }

    async function sendModernMessage() {
        const draftKey = getCurrentDraftKey();
        const draft = (state.chatDrafts[draftKey] || '').trim();
        if (!draft || state.engine.generating) {
            return;
        }

        const entity = getSelectedChatEntity();
        let chatId = state.selected.chat;
        if (!chatId) {
            chatId = await createModernChatFile(entity);
        }

        state.chatDrafts[draftKey] = '';
        state.chatDrafts[getChatCacheKey(getChatContextKey(entity), chatId)] = '';
        await runLegacyChatGeneration('normal', {
            entity,
            chatId,
            message: draft,
            toastTitle: '消息已生成',
            toastMessage: '生成引擎已完成回复并保存聊天文件。',
        });
    }

    async function regenerateModernReply() {
        if (state.engine.generating) {
            return;
        }

        const entity = getSelectedChatEntity();
        if (!getChatContextKey(entity) || !state.selected.chat) {
            throw new Error('请先选择一个聊天文件');
        }

        if (!getSelectedChatMessages().length) {
            throw new Error('当前聊天没有可重生成的上下文');
        }

        await runLegacyChatGeneration('regenerate', {
            entity,
            chatId: state.selected.chat,
            toastTitle: '回复已重生成',
            toastMessage: '生成引擎已更新最后一条回复。',
        });
    }

    async function continueModernReply() {
        if (state.engine.generating) {
            return;
        }

        const entity = getSelectedChatEntity();
        if (!getChatContextKey(entity) || !state.selected.chat) {
            throw new Error('请先选择一个聊天文件');
        }

        if (!getSelectedChatMessages().length) {
            throw new Error('当前聊天没有可继续生成的上下文');
        }

        await runLegacyChatGeneration('continue', {
            entity,
            chatId: state.selected.chat,
            toastTitle: '已继续生成',
            toastMessage: '生成引擎已追加到当前回复。',
        });
    }

    async function stopModernGeneration() {
        try {
            await callLegacyBridge('stop', {}, 15000);
        } catch (error) {
            state.errors.push({ key: 'legacy-stop', message: error.message });
        }
        state.engine.generating = false;
        state.engine.status = '已停止';
        state.engine.detail = '已向生成引擎发送停止请求。';
        render();
    }

    return {
        checkLegacyGenerationEngine,
        sendModernMessage,
        stopModernGeneration,
        regenerateModernReply,
        continueModernReply,
        swipeModernMessage,
    };
}
