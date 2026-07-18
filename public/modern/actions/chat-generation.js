import { BRIDGE_ACTIONS, BRIDGE_TIMEOUTS } from '../core/bridge-protocol.js';
import { stripJsonlExtension } from '../core/utils.js';

export function createChatGenerationActions({
    state,
    render,
    showToast,
    callLegacyBridge,
    subscribeProgress,
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
    runModernChatFileOperation,
}) {
    let generationSequence = 0;
    let activeGenerationToken = 0;
    const stoppedGenerationTokens = new Set();

    function isGenerationContextCurrent(contextKey, chatId) {
        return getChatContextKey() === contextKey && state.selected.chat === chatId;
    }

    function beginGeneration(status, detail) {
        const token = ++generationSequence;
        activeGenerationToken = token;
        state.engine.generating = true;
        state.engine.status = status;
        state.engine.error = '';
        state.engine.detail = detail;
        render();
        return token;
    }

    function failGeneration(token, error, status) {
        if (activeGenerationToken !== token) {
            return;
        }
        state.engine.error = error.message;
        state.engine.status = status;
        state.engine.detail = error.message;
    }

    function finishGeneration(token) {
        stoppedGenerationTokens.delete(token);
        if (activeGenerationToken !== token) {
            return;
        }
        activeGenerationToken = 0;
        state.engine.generating = false;
        render();
    }

    // 流式增量收到的是到当前为止的完整累积文本，用纯文本整体替换气泡内容（textContent，非追加、天然防注入）；
    // 同时写入 state 以备全量重渲染兜底恢复。用纯文本预览而非 markdown，是为了不把 lib.js 拉进 app 启动核心导入图。
    function updateStreamBubble(text) {
        const value = String(text ?? '');
        state.engine.streaming.text = value;
        // 仅当气泡属于当前正查看的聊天时才定点更新，避免生成期切到别的聊天后把本段生成写进错误视图。
        if (state.engine.streaming.chatId !== state.selected.chat) {
            return;
        }
        const bodyEl = document.querySelector('[data-streaming-bubble] .message-body');
        if (!bodyEl) {
            return;
        }
        bodyEl.textContent = value;
        // 仅当用户仍在跟读底部（气泡尚在视口附近）时才滚动，避免生成期上滑看历史被每 token 反复拉回底部。用视口坐标判断，与滚动容器无关。
        const bubble = bodyEl.closest('[data-streaming-bubble]');
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        if (bubble && bubble.getBoundingClientRect().top < viewportHeight + 400) {
            bubble.scrollIntoView({ block: 'end' });
        }
    }

    async function syncGeneratedChat({ entity, groupMode, contextKey, chatId, nextChatId, detail, toastTitle, toastMessage }) {
        delete state.chatMessages[getChatCacheKey(contextKey, nextChatId)];
        delete state.chatMetadata[getChatCacheKey(contextKey, nextChatId)];
        state.engine.ready = true;
        state.engine.status = '就绪';

        // The bridge updates the original chat even if the user has navigated elsewhere; only sync it into the still-matching UI context.
        if (!isGenerationContextCurrent(contextKey, chatId)) {
            state.engine.detail = `${nextChatId} · 原聊天已更新，当前上下文保持不变`;
            return;
        }

        await refreshSelectedChatList(entity, { groupMode });
        if (!isGenerationContextCurrent(contextKey, chatId)) {
            state.engine.detail = `${nextChatId} · 原聊天已更新，当前上下文保持不变`;
            return;
        }

        state.selected.chat = nextChatId;
        await loadChatMessages(entity, nextChatId, {
            force: true,
            groupMode,
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
            const result = await callLegacyBridge(BRIDGE_ACTIONS.STATUS, {
                avatar: isGroupChatMode() ? null : entity?.avatar,
                groupId: isGroupChatMode() ? entity?.id : null,
                chat: state.selected.chat || '',
            }, BRIDGE_TIMEOUTS.STATUS);
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

    async function runLegacyChatGeneration(type, {
        entity,
        chatId,
        groupMode = isGroupChatMode(),
        contextKey = getChatContextKey(entity, groupMode),
        entityName = getChatEntityName(entity),
        message = '',
        forceAvatar = null,
        toastTitle,
        toastMessage,
    }) {
        if (state.engine.generating) {
            return;
        }

        if (!contextKey || !chatId) {
            throw new Error(groupMode ? '请先选择群聊和聊天文件' : '请先选择角色和聊天文件');
        }

        // 生成开始前置流式气泡状态并绑定发起生成的 chatId，beginGeneration 的 render() 会一次性把气泡插入 DOM
        state.engine.streaming = { active: true, text: '', chatId };
        const token = beginGeneration('生成中', `${entityName} · ${chatId}`);
        // onProgress 只做定点 DOM 更新，不触发 render()，避免每 token 全量重建；stale 守卫按 token 丢弃旧流
        const unsubscribe = subscribeProgress((data) => {
            if (activeGenerationToken === token) {
                updateStreamBubble(data?.text);
            }
        });

        try {
            await runModernChatFileOperation(entity, chatId, async () => {
                if (stoppedGenerationTokens.has(token)) {
                    throw new Error('生成已停止');
                }
                const result = await callLegacyBridge(BRIDGE_ACTIONS.GENERATE, {
                    avatar: groupMode ? null : entity.avatar,
                    groupId: groupMode ? entity.id : null,
                    chat: chatId,
                    type,
                    message,
                    // Manual group activation: only forwarded when a specific member is forced, so other flows are unchanged
                    ...(groupMode && forceAvatar ? { forceAvatar } : {}),
                });
                // 保存失败时不再同步：从后端重载会拿到未保存的旧状态而丢消息，直接暴露为失败。
                if (result?.saved === false) {
                    throw new Error('生成结果未能保存到聊天文件，请重试或刷新后再试。');
                }
                const nextChatId = stripJsonlExtension(result?.chat || chatId);
                await syncGeneratedChat({
                    entity,
                    groupMode,
                    contextKey,
                    chatId,
                    nextChatId,
                    detail: `${nextChatId} · 已同步最新消息`,
                    toastTitle,
                    toastMessage,
                });
            }, { groupMode });
        } catch (error) {
            failGeneration(token, error, error.message.includes('停止') ? '已停止' : '生成失败');
            throw error;
        } finally {
            // 取消订阅并关闭气泡；syncGeneratedChat 已带真实消息全量重渲染收尾，finishGeneration 的 render() 移除气泡
            unsubscribe();
            state.engine.streaming = { active: false, text: '', chatId: '' };
            finishGeneration(token);
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

        const token = beginGeneration('候选切换中', `${chatId} · ${direction === 'left' ? '上一个候选' : '下一个候选'}`);

        try {
            await runModernChatFileOperation(entity, chatId, async () => {
                if (stoppedGenerationTokens.has(token)) {
                    throw new Error('生成已停止');
                }
                const result = await callLegacyBridge(BRIDGE_ACTIONS.SWIPE, {
                    avatar: groupMode ? null : entity.avatar,
                    groupId: groupMode ? entity.id : null,
                    chat: chatId,
                    messageIndex: index,
                    direction,
                });
                if (result?.saved === false) {
                    throw new Error('候选切换未能保存到聊天文件，请重试或刷新后再试。');
                }
                const nextChatId = stripJsonlExtension(result?.chat || chatId);
                const swipeDetail = `当前候选 ${formatNumber((result?.swipeId || 0) + 1)}/${formatNumber(result?.swipeCount || 1)}`;
                await syncGeneratedChat({
                    entity,
                    groupMode,
                    contextKey,
                    chatId,
                    nextChatId,
                    detail: `${nextChatId} · ${swipeDetail}`,
                    toastTitle: '候选已切换',
                    toastMessage: swipeDetail,
                });
            }, { groupMode });
        } catch (error) {
            failGeneration(token, error, error.message.includes('停止') ? '已停止' : '候选切换失败');
            throw error;
        } finally {
            finishGeneration(token);
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
        const groupMode = isGroupChatMode();
        const contextKey = getChatContextKey(entity, groupMode);
        const entityName = getChatEntityName(entity);
        if (!contextKey) {
            throw new Error(groupMode ? '请先选择群聊和聊天文件' : '请先选择角色和聊天文件');
        }
        let chatId = state.selected.chat;
        if (!chatId) {
            chatId = await createModernChatFile(entity);
        }

        if (!chatId) {
            throw new Error(groupMode ? '请先选择群聊和聊天文件' : '请先选择角色和聊天文件');
        }

        const cacheKey = getChatCacheKey(contextKey, chatId);
        state.chatDrafts[draftKey] = '';
        state.chatDrafts[cacheKey] = '';
        appendOptimisticUserMessage(cacheKey, draft);

        try {
            await runLegacyChatGeneration('normal', {
                entity,
                chatId,
                groupMode,
                contextKey,
                entityName,
                message: draft,
                toastTitle: '消息已生成',
                toastMessage: '生成引擎已完成回复并保存聊天文件。',
            });
        } catch (error) {
            delete state.chatMessages[cacheKey];
            if (isGenerationContextCurrent(contextKey, chatId)) {
                await loadChatMessages(entity, chatId, {
                    force: true,
                    groupMode,
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

    // Manual group activation: force a specific member to speak next without a new user message
    async function triggerGroupMemberModernReply(avatar) {
        if (state.engine.generating) {
            return;
        }

        if (!isGroupChatMode()) {
            throw new Error('仅群聊支持手动指定发言成员');
        }

        const entity = getSelectedChatEntity();
        if (!getChatContextKey(entity) || !state.selected.chat) {
            throw new Error('请先选择群聊和聊天文件');
        }

        await runLegacyChatGeneration('normal', {
            entity,
            chatId: state.selected.chat,
            message: '',
            forceAvatar: avatar,
            toastTitle: '已生成回复',
            toastMessage: '指定成员已发言并保存聊天文件。',
        });
    }

    async function stopModernGeneration() {
        if (!state.engine.generating) {
            return;
        }

        const token = activeGenerationToken;
        stoppedGenerationTokens.add(token);
        state.engine.status = '停止中';
        state.engine.detail = '正在向生成引擎发送停止请求。';
        render();
        try {
            await callLegacyBridge(BRIDGE_ACTIONS.STOP, {}, BRIDGE_TIMEOUTS.STOP);
            if (activeGenerationToken === token) {
                state.engine.detail = '停止请求已发送，正在等待生成任务结束。';
            }
        } catch (error) {
            stoppedGenerationTokens.delete(token);
            state.errors.push({ key: 'legacy-stop', message: error.message });
            if (activeGenerationToken === token) {
                state.engine.status = '生成中';
                state.engine.detail = `停止请求失败：${error.message}`;
            }
        }
        render();
    }

    return {
        checkLegacyGenerationEngine,
        sendModernMessage,
        stopModernGeneration,
        regenerateModernReply,
        continueModernReply,
        triggerGroupMemberModernReply,
        swipeModernMessage,
    };
}
