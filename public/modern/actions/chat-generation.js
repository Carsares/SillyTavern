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
    getUserName,
    loadChatMessages,
    refreshSelectedChatList,
    createModernChatFile,
}) {
    function isGenerationContextCurrent(contextKey, chatId) {
        return getChatContextKey() === contextKey && state.selected.chat === chatId;
    }

    async function syncGeneratedChat({ entity, contextKey, chatId, nextChatId, detail, toastTitle, toastMessage }) {
        delete state.chatMessages[getChatCacheKey(contextKey, nextChatId)];
        delete state.chatMetadata[getChatCacheKey(contextKey, nextChatId)];
        state.engine.ready = true;
        state.engine.status = '就绪';

        // The bridge updates the original chat even if the user has navigated elsewhere; only sync it into the still-matching UI context.
        if (!isGenerationContextCurrent(contextKey, chatId)) {
            state.engine.detail = `${nextChatId} · 原聊天已更新，当前上下文保持不变`;
            return;
        }

        await refreshSelectedChatList(entity);
        if (!isGenerationContextCurrent(contextKey, chatId)) {
            state.engine.detail = `${nextChatId} · 原聊天已更新，当前上下文保持不变`;
            return;
        }

        state.selected.chat = nextChatId;
        await loadChatMessages(entity, nextChatId, {
            force: true,
            isContextCurrent: () => isGenerationContextCurrent(contextKey, nextChatId),
        });
        if (!isGenerationContextCurrent(contextKey, nextChatId)) {
            state.engine.detail = `${nextChatId} · 原聊天已更新，当前上下文保持不变`;
            return;
        }

        state.engine.detail = detail;
        showToast(toastTitle, toastMessage);
    }

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
        const groupMode = isGroupChatMode();

        state.engine.generating = true;
        state.engine.status = '生成中';
        state.engine.error = '';
        state.engine.detail = `${getChatEntityName(entity)} · ${chatId}`;
        render();

        try {
            const result = await callLegacyBridge('generate', {
                avatar: groupMode ? null : entity.avatar,
                groupId: groupMode ? entity.id : null,
                chat: chatId,
                type,
                message,
            });
            const nextChatId = stripJsonlExtension(result?.chat || chatId);
            await syncGeneratedChat({
                entity,
                contextKey,
                chatId,
                nextChatId,
                detail: `${nextChatId} · 已同步最新消息`,
                toastTitle,
                toastMessage,
            });
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
        const chatId = state.selected.chat;
        const groupMode = isGroupChatMode();

        const index = Number(messageIndex);
        const messages = getSelectedChatMessages();
        if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
            throw new Error('消息位置无效，请刷新后重试。');
        }

        state.engine.generating = true;
        state.engine.status = '候选切换中';
        state.engine.error = '';
        state.engine.detail = `${chatId} · ${direction === 'left' ? '上一个候选' : '下一个候选'}`;
        render();

        try {
            const result = await callLegacyBridge('swipe', {
                avatar: groupMode ? null : entity.avatar,
                groupId: groupMode ? entity.id : null,
                chat: chatId,
                messageIndex: index,
                direction,
            });
            const nextChatId = stripJsonlExtension(result?.chat || chatId);
            const swipeDetail = `当前候选 ${formatNumber((result?.swipeId || 0) + 1)}/${formatNumber(result?.swipeCount || 1)}`;
            await syncGeneratedChat({
                entity,
                contextKey,
                chatId,
                nextChatId,
                detail: `${nextChatId} · ${swipeDetail}`,
                toastTitle: '候选已切换',
                toastMessage: swipeDetail,
            });
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

    function appendOptimisticUserMessage(cacheKey, message) {
        const messages = state.chatMessages[cacheKey] || [];
        state.chatMessages[cacheKey] = [
            ...messages,
            {
                name: getUserName(),
                is_user: true,
                is_system: false,
                send_date: new Date().toISOString(),
                mes: message,
            },
        ];
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

        const contextKey = getChatContextKey(entity);
        if (!contextKey || !chatId) {
            throw new Error(isGroupChatMode() ? '请先选择群聊和聊天文件' : '请先选择角色和聊天文件');
        }

        const cacheKey = getChatCacheKey(contextKey, chatId);
        state.chatDrafts[draftKey] = '';
        state.chatDrafts[cacheKey] = '';
        appendOptimisticUserMessage(cacheKey, draft);

        try {
            await runLegacyChatGeneration('normal', {
                entity,
                chatId,
                message: draft,
                toastTitle: '消息已生成',
                toastMessage: '生成引擎已完成回复并保存聊天文件。',
            });
        } catch (error) {
            delete state.chatMessages[cacheKey];
            if (isGenerationContextCurrent(contextKey, chatId)) {
                await loadChatMessages(entity, chatId, {
                    force: true,
                    isContextCurrent: () => isGenerationContextCurrent(contextKey, chatId),
                });
            }
            throw error;
        }
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
