import { BRIDGE_ACTIONS, BRIDGE_TIMEOUTS } from '../core/bridge-protocol.js';
import { describeReloadFailure } from '../core/bridge-reload.js';
import { describeSummaryOutcome, getAutoSummaryGate, getManualSummaryGate, getSummaryProgress, readSummarySettings } from '../core/chat-summary.js';
import { stripJsonlExtension } from '../core/utils.js';
import { canSwitchGreetingLocally, planAlternateGreetingLoad, switchGreetingMessage } from './chat-greetings.js';
import { createChatAgentActions } from './chat-agent.js';

export function createChatGenerationActions({
    state,
    apiFetch,
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
    // 等待在途的引擎同步（reloadChat / Settings / Character / WorldInfo）完成，有上限；未注入时无需等待
    waitForEngineSync = async (/** @type {{ timeoutMs?: number }} */ _options = {}) => ({ settled: true }),
    // 在聊天文件队列里改消息、保存，并登记 reloadChat（chat-context.js 的 updateModernChatAndSync）。
    // 未注入时开场白切换退回引擎的 SWIPE，「载入备用开场白」不可用。
    updateModernChatAndSync = null,
}) {
    const agent = createChatAgentActions({ state, apiFetch, render, getSelectedChatEntity, getChatContextKey, getChatCacheKey, isGroupChatMode, waitForEngineSync });
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

    // Modern 已知的聊天文件 integrity（聊天头 chat_metadata.integrity，服务端每次保存都会换新）。引擎据此发现自己内存里的
    // 同名聊天已落后于文件，先重开再生成，避免保存时被完整性校验拒绝。未读到聊天头时返回 undefined，引擎不做比较。
    function getKnownChatIntegrity(contextKey, chatId) {
        const integrity = state.chatMetadata?.[getChatCacheKey(contextKey, chatId)]?.integrity;
        return typeof integrity === 'string' && integrity ? integrity : undefined;
    }

    // 发给引擎前先等设置 / 角色 / 聊天 / 世界书的同步结束，让这次生成用上刚保存的配置。等待有上限，超时照常发送
    // （引擎侧按消息到达顺序串行，先发出的重载仍会先于这次生成执行）。返回 false 表示等待期间收到了停止请求。
    async function waitForSyncBeforeEngine(token) {
        const syncing = state.engine.settingsSyncPending > 0;
        const detailBeforeSync = state.engine.detail;
        if (syncing) {
            state.engine.detail = '正在把最新设置同步到生成引擎。';
            render();
        }
        await waitForEngineSync();
        if (syncing && activeGenerationToken === token && state.engine.detail === '正在把最新设置同步到生成引擎。') {
            state.engine.detail = detailBeforeSync;
        }
        return !stoppedGenerationTokens.has(token);
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
        // 不在这里滚动：是否贴底跟随由 routes/chat-scroll.js 统一判断（用户上滑看历史时不拉回底部）。
    }

    async function syncGeneratedChat({ entity, groupMode, contextKey, chatId, nextChatId, detail, toastTitle, toastMessage, status = '就绪' }) {
        delete state.chatMessages[getChatCacheKey(contextKey, nextChatId)];
        delete state.chatMetadata[getChatCacheKey(contextKey, nextChatId)];
        state.engine.ready = true;
        state.engine.status = status;

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
            rememberAsLastUsed: true,
        });
        if (!isGenerationContextCurrent(contextKey, nextChatId)) {
            state.engine.detail = `${nextChatId} · 原聊天已更新，当前上下文保持不变`;
            return;
        }

        state.engine.detail = detail;
        showToast(toastTitle, toastMessage);
    }

    // 聊天摘要（A6）----------------------------------------------------------------------------------------------------
    // 谁决定何时摘要：Modern。引擎在 bridge 模式下不再自己触发摘要（public/scripts/extensions/memory/index.js 的 init），
    // 所以摘要的模型调用和聊天文件保存不会在 Modern 不知道的时刻发生，不会和 Modern 的保存抢 integrity。
    // 两个入口都在聊天文件队列里、占着「生成中」状态执行，期间不能发送、编辑，可以停止：
    //   - 自动：每次生成成功并同步到界面之后（runLegacyChatGeneration），先按设置和本地进度判断，到点才请求引擎；
    //   - 手动：聊天工具「聊天摘要」里的「重新摘要」（summarizeModernChat）。
    // 失败、没到点、被停止都只是一条提示，绝不让生成本身失败。

    function setSummaryNotice(cacheKey, notice) {
        state.chatSummary.notice = notice ? { key: cacheKey, ...notice } : null;
    }

    /**
     * 请求引擎摘要一次，写入成功后把聊天消息从文件重读进界面。
     * @param {object} options 参数
     * @param {any} options.entity 角色或群聊
     * @param {boolean} options.groupMode 是否群聊
     * @param {string} options.contextKey 聊天上下文键
     * @param {string} options.chatId 聊天文件 ID
     * @param {'force' | 'auto'} options.mode force 一定摘要，auto 由引擎按扩展自己的触发条件判断
     * @param {number} options.token 当前生成令牌（用于判断是否被停止）
     * @returns {Promise<{ stopped: boolean, written: boolean, result: any }>} 引擎回复；stopped 为真表示等待同步期间收到了停止请求
     */
    async function requestChatSummary({ entity, groupMode, contextKey, chatId, mode, token }) {
        if (!await waitForSyncBeforeEngine(token)) {
            return { stopped: true, written: false, result: { reason: 'stopped' } };
        }

        const result = await callLegacyBridge(BRIDGE_ACTIONS.SUMMARIZE, {
            avatar: groupMode ? null : entity.avatar,
            groupId: groupMode ? entity.id : null,
            chat: chatId,
            integrity: getKnownChatIntegrity(contextKey, chatId),
            mode,
        }, BRIDGE_TIMEOUTS.SUMMARIZE);
        const written = Boolean(result?.summary) && result?.saved === true && !result?.reason;
        if (written && isGenerationContextCurrent(contextKey, chatId)) {
            // 摘要只改了消息的 extra，聊天文件已由引擎保存；重读文件拿到摘要和新的 integrity
            await loadChatMessages(entity, chatId, {
                force: true,
                groupMode,
                isContextCurrent: () => isGenerationContextCurrent(contextKey, chatId),
            });
        } else if (written) {
            // 已切到别的聊天：与 syncGeneratedChat 一致丢掉这份聊天的缓存，切回时从文件重读。摘要不改变条数和末条时间，
            // 留着缓存会一直用旧 integrity 保存，之后的编辑、删除、作者注释和摘要修改都会被服务端拒绝
            delete state.chatMessages[getChatCacheKey(contextKey, chatId)];
            delete state.chatMetadata[getChatCacheKey(contextKey, chatId)];
        }
        return { stopped: result?.stopped === true || result?.reason === 'stopped', written, result };
    }

    async function runAutoSummaryAfterGeneration({ entity, groupMode, contextKey, chatId, token }) {
        const cacheKey = getChatCacheKey(contextKey, chatId);
        // 只在摘要来源可用且已开启时才打扰引擎；来源是 Extras 时（用户现状）这里什么也不做
        if (!getAutoSummaryGate(state.settings).eligible) {
            return;
        }
        const progress = getSummaryProgress(state.chatMessages[cacheKey], readSummarySettings(state.settings));
        if (!progress.due) {
            return;
        }

        const previousStatus = state.engine.status;
        const previousDetail = state.engine.detail;
        state.chatSummary.running = true;
        state.engine.status = '摘要生成中';
        state.engine.detail = `${chatId} · 距上次摘要已有 ${formatNumber(progress.messagesSince)} 条消息，正在更新聊天摘要`;
        render();
        let stopped = false;
        try {
            const outcome = await requestChatSummary({ entity, groupMode, contextKey, chatId, mode: 'auto', token });
            stopped = outcome.stopped;
            const notice = describeSummaryOutcome(outcome.result, { mode: 'auto' });
            setSummaryNotice(cacheKey, notice);
            if (notice && notice.kind !== 'success') {
                showToast('聊天摘要', notice.text);
            }
        } catch (error) {
            setSummaryNotice(cacheKey, { kind: 'warning', text: `摘要没有更新：${error.message}` });
            showToast('聊天摘要未更新', `${error.message}（这条回复本身已正常保存）`);
        } finally {
            state.chatSummary.running = false;
            if (activeGenerationToken === token) {
                state.engine.status = stopped ? '已停止' : previousStatus;
                state.engine.detail = stopped ? `${chatId} · 摘要已停止` : previousDetail;
            }
        }
    }

    /**
     * 手动「重新摘要」：一定摘要一次，写入摘要所在的那条消息（已有摘要就覆盖，不产生第二份）。
     * @returns {Promise<{ stopped: boolean, written: boolean, notice: { kind: string, text: string } | null } | null>} 正在生成时返回 null
     */
    async function summarizeModernChat() {
        if (state.engine.generating) {
            return null;
        }

        const entity = getSelectedChatEntity();
        const groupMode = isGroupChatMode();
        const contextKey = getChatContextKey(entity, groupMode);
        const chatId = state.selected.chat;
        if (!entity || !contextKey || !chatId) {
            throw new Error('请先选择一个聊天文件');
        }

        const cacheKey = getChatCacheKey(contextKey, chatId);
        const gate = getManualSummaryGate(state.settings, (state.chatMessages[cacheKey] || []).length);
        if (!gate.ok) {
            throw new Error(gate.message);
        }

        setSummaryNotice(cacheKey, null);
        state.chatSummary.running = true;
        const token = beginGeneration('摘要生成中', `${getChatEntityName(entity)} · ${chatId}`);
        try {
            return await runModernChatFileOperation(entity, chatId, async () => {
                const outcome = await requestChatSummary({ entity, groupMode, contextKey, chatId, mode: 'force', token });
                const notice = describeSummaryOutcome(outcome.result, { mode: 'force' });
                setSummaryNotice(cacheKey, notice);
                state.engine.status = outcome.stopped ? '已停止' : '就绪';
                state.engine.detail = `${chatId} · ${notice?.text || '摘要已更新'}`;
                if (notice) {
                    showToast(outcome.written ? '聊天摘要已更新' : '聊天摘要', notice.text);
                }
                return { stopped: outcome.stopped, written: outcome.written, notice };
            }, { groupMode });
        } catch (error) {
            failGeneration(token, error, '摘要失败');
            setSummaryNotice(cacheKey, { kind: 'error', text: `摘要失败：${error.message}` });
            throw error;
        } finally {
            state.chatSummary.running = false;
            finishGeneration(token);
        }
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
            const chatId = state.selected.chat || '';
            // Without a selected chat only the engine itself is checked: switching the engine to the entity would
            // open its default legacy chat, and the engine saves a greeting-only file when that chat does not exist
            const result = await callLegacyBridge(BRIDGE_ACTIONS.STATUS, chatId ? {
                avatar: isGroupChatMode() ? null : entity?.avatar,
                groupId: isGroupChatMode() ? entity?.id : null,
                chat: chatId,
            } : {}, BRIDGE_TIMEOUTS.STATUS);
            const messageCount = Number(result?.messageCount || 0);
            state.engine.ready = true;
            state.engine.status = '引擎就绪';
            state.engine.detail = chatId
                ? `${result?.chat || chatId} · ${formatNumber(messageCount)} 条上下文消息`
                : '未选择聊天';
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

    // 「停止」后的反馈：说明保留了多少回复。没有可见正文的回复（只有推理或占位）由引擎移出聊天文件，不留空消息。
    function describeStoppedReply(result) {
        const keptReplyChars = Number(result?.keptReplyChars) || 0;
        if (keptReplyChars > 0) {
            return `已保留 ${formatNumber(keptReplyChars)} 字的部分回复。`;
        }
        if (result?.removedEmptyReply) {
            return '回复还没有可见内容，没有保存空消息。';
        }
        if (result?.started === false) {
            return '生成尚未开始，聊天文件没有变化。';
        }
        return '没有生成新的回复内容。';
    }

    // The engine did not report a result for a stopped request: the stop came before the request reached it (it still
    // waited for an earlier save of the same chat), or the engine rejected the aborted request. Neither is a failure;
    // reload what the chat file holds.
    async function syncStoppedChat({ entity, groupMode, contextKey, chatId, started }) {
        state.engine.status = '已停止';
        state.engine.detail = `${chatId} · 已停止生成`;
        delete state.chatMessages[getChatCacheKey(contextKey, chatId)];
        if (!isGenerationContextCurrent(contextKey, chatId)) {
            return;
        }
        await loadChatMessages(entity, chatId, {
            force: true,
            groupMode,
            isContextCurrent: () => isGenerationContextCurrent(contextKey, chatId),
        });
        if (isGenerationContextCurrent(contextKey, chatId)) {
            showToast('已停止生成', started ? '生成已中止，聊天已按文件内容刷新。' : '生成尚未开始，聊天文件没有变化。');
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
            return null;
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

        let bridgeCalled = false;
        try {
            return await runModernChatFileOperation(entity, chatId, async () => {
                if (!await waitForSyncBeforeEngine(token)) {
                    throw new Error('生成已停止');
                }
                bridgeCalled = true;
                const result = await callLegacyBridge(BRIDGE_ACTIONS.GENERATE, {
                    avatar: groupMode ? null : entity.avatar,
                    groupId: groupMode ? entity.id : null,
                    chat: chatId,
                    integrity: getKnownChatIntegrity(contextKey, chatId),
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
                const stopped = result?.stopped === true;
                await syncGeneratedChat({
                    entity,
                    groupMode,
                    contextKey,
                    chatId,
                    nextChatId,
                    detail: stopped ? `${nextChatId} · 已停止生成` : `${nextChatId} · 已同步最新消息`,
                    toastTitle: stopped ? '已停止生成' : toastTitle,
                    toastMessage: stopped ? describeStoppedReply(result) : toastMessage,
                    status: stopped ? '已停止' : '就绪',
                });
                // 回复已落盘并同步到界面：再由 Modern 决定要不要摘要。停止的回复、已离开这个聊天时不摘要，下一次回复结束后会补上
                if (!stopped && !stoppedGenerationTokens.has(token) && isGenerationContextCurrent(contextKey, nextChatId)) {
                    await runAutoSummaryAfterGeneration({ entity, groupMode, contextKey, chatId: nextChatId, token });
                }
                return { stopped, started: result?.started !== false };
            }, { groupMode });
        } catch (error) {
            if (stoppedGenerationTokens.has(token)) {
                await syncStoppedChat({ entity, groupMode, contextKey, chatId, started: bridgeCalled });
                return { stopped: true, started: bridgeCalled };
            }
            failGeneration(token, error, error.message.includes('停止') ? '已停止' : '生成失败');
            throw error;
        } finally {
            // 取消订阅并关闭气泡；syncGeneratedChat 已带真实消息全量重渲染收尾，finishGeneration 的 render() 移除气泡
            unsubscribe();
            state.engine.streaming = { active: false, text: '', chatId: '' };
            finishGeneration(token);
        }
    }

    /**
     * 在聊天文件队列里改第 0 条消息（开场白）并保存，界面先刷新，再等引擎重开聊天。引擎不参与消息修改：
     * 只有开场白、未对话的聊天里，开场白之间的切换是纯文件操作，对应旧版 PRISTINE_GREETING 的循环行为。
     * @param {object} options 参数
     * @param {object} options.entity 角色
     * @param {boolean} options.groupMode 是否群聊
     * @param {string} options.chatId 聊天文件 ID
     * @param {string} options.status 引擎状态栏文字
     * @param {string} options.failedStatus 失败时的状态栏文字
     * @param {string} options.detail 开始时的详情
     * @param {(messages: object[]) => { swipeId: number, swipeCount: number }} options.mutate 就地改消息副本，抛错则不保存
     * @param {(result: { swipeId: number, swipeCount: number }) => string} options.describeDone 完成后的详情
     * @param {string} options.doneTitle 引擎同步失败时的提示标题
     * @returns {Promise<{ swipeId: number, swipeCount: number }>} 新的候选下标和数量
     */
    async function editGreetingMessage({ entity, groupMode, chatId, status, failedStatus, detail, mutate, describeDone, doneTitle }) {
        // 占住「生成中」状态：期间发送、编辑、再次切换都被挡住，直到文件保存完
        const token = beginGeneration(status, detail);
        let outcome;
        let engineSync;
        try {
            ({ result: outcome, engineSync } = await updateModernChatAndSync(entity, chatId, mutate, { groupMode }));
            state.engine.status = '就绪';
            state.engine.detail = `${chatId} · ${describeDone(outcome)}`;
        } catch (error) {
            failGeneration(token, error, failedStatus);
            throw error;
        } finally {
            finishGeneration(token);
        }

        // 文件已保存、界面已刷新；引擎重开聊天失败只提示，不当作保存失败
        const reload = await engineSync;
        if (reload.ok === false) {
            showToast(doneTitle, `已保存到聊天文件${describeReloadFailure(reload)}`);
        }
        return outcome;
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

        // 只有开场白、没有对话过的聊天：开场白候选之间本地切换，不调用引擎。其余情况（已对话、不止一条消息、候选不足）
        // 都交给引擎，保持旧版语义（例如已对话后在最后一个候选上右切会生成新回复）。
        const cacheKey = getChatCacheKey(contextKey, chatId);
        if (index === 0 && typeof updateModernChatAndSync === 'function' && canSwitchGreetingLocally(messages, state.chatMetadata?.[cacheKey])) {
            await editGreetingMessage({
                entity,
                groupMode,
                chatId,
                status: '开场白切换中',
                failedStatus: '开场白切换失败',
                detail: `${chatId} · ${direction === 'left' ? '上一个开场白' : '下一个开场白'}`,
                mutate: latestMessages => {
                    // 排队期间聊天可能已变化（例如另一次生成刚结束）：条件不再成立就不改文件
                    if (!canSwitchGreetingLocally(latestMessages, state.chatMetadata?.[cacheKey])) {
                        throw new Error('开场白已变化，请刷新后重试。');
                    }
                    const switched = switchGreetingMessage(latestMessages[0], direction);
                    latestMessages[0] = switched.message;
                    return switched;
                },
                describeDone: result => `开场白 ${formatNumber(result.swipeId + 1)}/${formatNumber(result.swipeCount)}`,
                doneTitle: '开场白已切换',
            });
            return;
        }

        const token = beginGeneration('候选切换中', `${chatId} · ${direction === 'left' ? '上一个候选' : '下一个候选'}`);

        let bridgeCalled = false;
        try {
            await runModernChatFileOperation(entity, chatId, async () => {
                if (!await waitForSyncBeforeEngine(token)) {
                    throw new Error('生成已停止');
                }
                bridgeCalled = true;
                const result = await callLegacyBridge(BRIDGE_ACTIONS.SWIPE, {
                    avatar: groupMode ? null : entity.avatar,
                    groupId: groupMode ? entity.id : null,
                    chat: chatId,
                    integrity: getKnownChatIntegrity(contextKey, chatId),
                    messageIndex: index,
                    direction,
                });
                if (result?.saved === false) {
                    throw new Error('候选切换未能保存到聊天文件，请重试或刷新后再试。');
                }
                const nextChatId = stripJsonlExtension(result?.chat || chatId);
                const swipeDetail = `当前候选 ${formatNumber((result?.swipeId || 0) + 1)}/${formatNumber(result?.swipeCount || 1)}`;
                const stopped = result?.stopped === true;
                await syncGeneratedChat({
                    entity,
                    groupMode,
                    contextKey,
                    chatId,
                    nextChatId,
                    detail: `${nextChatId} · ${stopped ? '已停止生成 · ' : ''}${swipeDetail}`,
                    toastTitle: stopped ? '已停止生成' : '候选已切换',
                    toastMessage: stopped ? `${describeStoppedReply(result)}${swipeDetail}。` : swipeDetail,
                    status: stopped ? '已停止' : '就绪',
                });
            }, { groupMode });
        } catch (error) {
            if (stoppedGenerationTokens.has(token)) {
                await syncStoppedChat({ entity, groupMode, contextKey, chatId, started: bridgeCalled });
                return;
            }
            failGeneration(token, error, error.message.includes('停止') ? '已停止' : '候选切换失败');
            throw error;
        } finally {
            finishGeneration(token);
        }
    }

    // 只有开场白的旧聊天（第 0 条消息还没有候选）补上角色卡的备用开场白。第 0 条必须与卡上某条开场白一致才处理。
    async function loadAlternateGreetings() {
        if (state.engine.generating) {
            return null;
        }
        if (typeof updateModernChatAndSync !== 'function') {
            throw new Error('当前环境不支持载入备用开场白。');
        }

        const entity = getSelectedChatEntity();
        const groupMode = isGroupChatMode();
        const contextKey = getChatContextKey(entity, groupMode);
        const chatId = state.selected.chat;
        if (!contextKey || !chatId) {
            throw new Error('请先选择一个聊天文件');
        }
        if (groupMode) {
            throw new Error('群聊不支持载入备用开场白。');
        }

        const cacheKey = getChatCacheKey(contextKey, chatId);
        const outcome = await editGreetingMessage({
            entity,
            groupMode,
            chatId,
            status: '载入备用开场白',
            failedStatus: '载入备用开场白失败',
            detail: chatId,
            mutate: latestMessages => {
                const plan = planAlternateGreetingLoad({
                    messages: latestMessages,
                    metadata: state.chatMetadata?.[cacheKey],
                    character: entity,
                    userName: getUserName(),
                });
                if ('error' in plan) {
                    throw new Error(plan.error);
                }
                latestMessages[0] = plan.message;
                return plan;
            },
            describeDone: result => `已载入备用开场白，共 ${formatNumber(result.swipeCount)} 个`,
            doneTitle: '备用开场白已载入',
        });
        showToast('已载入备用开场白', `共 ${formatNumber(outcome.swipeCount)} 个开场白，当前是第 ${formatNumber(outcome.swipeId + 1)} 个。`);
        return outcome;
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
            const outcome = await runLegacyChatGeneration('normal', {
                entity,
                chatId,
                groupMode,
                contextKey,
                entityName,
                message: draft,
                toastTitle: '消息已生成',
                toastMessage: '生成引擎已完成回复并保存聊天文件。',
            });
            // Stopped before the engine took the message: give the text back instead of dropping it
            if (outcome?.stopped && !outcome.started && !state.chatDrafts[cacheKey]) {
                state.chatDrafts[cacheKey] = draft;
                render();
            }
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
        // 会话内生图占着生成锁时，「停止」改为请后端取消（/api/image-generation/cancel），不向隐藏引擎发 STOP。
        // 取消动作由 actions/chat-image-generation.js 创建时挂在 state.chatImageGeneration.cancelJob 上（这里拿不到功能插槽的动作）
        if (state.engine.activity === 'image') return state.chatImageGeneration?.cancelJob?.();
        if (agent.isChatAgentActive()) return agent.stopChatAgent();
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
        ...agent,
        checkLegacyGenerationEngine,
        sendModernMessage,
        stopModernGeneration,
        regenerateModernReply,
        continueModernReply,
        triggerGroupMemberModernReply,
        swipeModernMessage,
        loadAlternateGreetings,
        summarizeModernChat,
    };
}
