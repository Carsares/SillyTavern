import { createChatContextLoaderActions } from './chat-context-loaders.js';
import { createChatContextSelectorHelpers } from './chat-context-selectors.js';
import { chatReadStateStorageKey } from '../core/state.js';
import { KeyedPromiseQueue } from '../core/keyed-queue.js';
import { noEngineSync } from '../core/bridge-reload.js';
import { readChatSelectionFromUrl, syncChatSelectionToUrl } from '../core/chat-url-selection.js';

// 每个角色/群聊上次实际使用（点开、发送、生成、编辑、新建、导入）的聊天：重新进入该对象时优先打开它，
// 避免未读标记把用户带到一份从没用过的聊天（例如旧引擎自动生成、只含开场白的文件）。
const lastUsedChatStorageKey = 'st-modern-chat-last-used:v1';

const CHAT_INTEGRITY_CONFLICT_MESSAGE = '聊天文件已被其他会话修改，请刷新后重试。';

/**
 * apiFetch 抛出的错误是否是聊天保存的完整性冲突（HTTP 400，响应体 JSON 的 error 为 'integrity'）。
 * @param {any} error apiFetch 抛出的错误，带 status 和 body（响应体前 2000 字）
 * @returns {boolean} 是完整性冲突时为 true
 */
function isChatIntegrityConflictError(error) {
    if (error?.status !== 400 || typeof error.body !== 'string') {
        return false;
    }
    try {
        return JSON.parse(error.body)?.error === 'integrity';
    } catch {
        return false;
    }
}

function loadLastUsedChats() {
    try {
        const value = JSON.parse(localStorage.getItem(lastUsedChatStorageKey) || '{}');
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return Object.fromEntries(Object.entries(value).filter(([, chatId]) => typeof chatId === 'string' && chatId));
        }
    } catch {
        // Invalid stored state only loses the preference; selection falls back to the chat list order.
    }
    return {};
}

export function createChatContextActions({
    state,
    apiFetch,
    render,
    showToast,
    getCharacterAvatarUrl,
    // 同步通道：保存聊天头元数据后通知引擎重开该聊天；未注入时视为引擎同步成功（独立测试只关心保存）。
    reloadChat = noEngineSync,
}) {
    const {
        createGreetingMessage,
        createGroupMemberGreetingMessage,
        createModernChatId,
        getCharacterName,
        getChatCacheKey,
        getChatContextKey,
        getChatEntityAvatarUrl,
        getChatEntityEmptyDescription,
        getChatEntityEmptyTitle,
        getChatEntityFallbackIcon,
        getChatEntityListEmptyText,
        getChatEntityName,
        getChatId,
        getChatMessageCount,
        getChatModeLabel,
        getChatUnreadCount,
        getLatestUnreadChat,
        getLatestUnreadChatTarget,
        getGroupAvatarUrl,
        getCurrentDraftKey,
        getCurrentMessageLimit,
        getEntityUnreadCount,
        getTotalChatUnreadCount,
        getSelectedCharacter,
        getSelectedChatEntity,
        getSelectedChatList,
        getSelectedChatMessages,
        getSelectedChatMetadata,
        getSelectedGroup,
        getUserName,
        getVisibleChatList,
        isGroupChatMode,
        sortChats,
    } = createChatContextSelectorHelpers({
        state,
        getCharacterAvatarUrl,
    });

    // A reload restores the chat the URL names (UX-018). It is checked against the loaded character/group lists in
    // ensureAvailableChatMode(); a stale entity falls back to the selection the page makes without URL parameters.
    let pendingUrlChatSelection = null;
    const urlChatSelection = readChatSelectionFromUrl();
    if (urlChatSelection) {
        pendingUrlChatSelection = { ...urlChatSelection, previousChatMode: state.chatMode };
        state.chatMode = urlChatSelection.groupMode ? 'group' : 'character';
        if (urlChatSelection.groupMode) {
            state.selected.group = urlChatSelection.entityId;
        } else {
            state.selected.character = urlChatSelection.entityId;
        }
        state.selected.chat = urlChatSelection.chatId;
    }

    function syncChatSelectionUrl() {
        syncChatSelectionToUrl(state, getSelectedChatEntity(), isGroupChatMode());
    }

    function reconcileUrlChatSelection() {
        const restored = pendingUrlChatSelection;
        if (!restored) {
            return;
        }
        pendingUrlChatSelection = null;

        const available = restored.groupMode
            ? state.groups.some(group => group.id === restored.entityId)
            : state.characters.some(character => character.avatar === restored.entityId);
        if (available) {
            localStorage.setItem('st-modern-chat-mode', state.chatMode);
            return;
        }

        state.chatMode = restored.previousChatMode;
        if (restored.groupMode) {
            state.selected.group = state.groups[0]?.id || '';
        } else {
            state.selected.character = state.characters[0]?.avatar || '';
        }
        state.selected.chat = '';
    }

    function getChatReadCursors() {
        if (!state.chatReadState || typeof state.chatReadState !== 'object') {
            state.chatReadState = { cursors: {}, contexts: {} };
        }
        if (!state.chatReadState.cursors || typeof state.chatReadState.cursors !== 'object' || Array.isArray(state.chatReadState.cursors)) {
            state.chatReadState.cursors = {};
        }
        if (!state.chatReadState.contexts || typeof state.chatReadState.contexts !== 'object' || Array.isArray(state.chatReadState.contexts)) {
            state.chatReadState.contexts = {};
        }
        return state.chatReadState.cursors;
    }

    function getChatReadContexts() {
        getChatReadCursors();
        return state.chatReadState.contexts;
    }

    function persistChatReadState() {
        try {
            localStorage.setItem(chatReadStateStorageKey, JSON.stringify(state.chatReadState));
        } catch {
            // Read state is a UI convenience; storage failures should not block chat actions.
        }
    }

    function getKnownChat(contextKey, chatId) {
        return (state.chatLists[contextKey] || []).find(chat => getChatId(chat) === chatId) || null;
    }

    const lastUsedChats = loadLastUsedChats();

    function persistLastUsedChats() {
        try {
            localStorage.setItem(lastUsedChatStorageKey, JSON.stringify(lastUsedChats));
        } catch {
            // The last-used chat is a UI convenience; storage failures should not block chat actions.
        }
    }

    function getLastUsedChat(contextKey) {
        return contextKey ? lastUsedChats[contextKey] || '' : '';
    }

    function rememberLastUsedChat(contextKey, chatId) {
        const normalizedChatId = getChatId({ file_id: chatId, file_name: chatId });
        if (!contextKey || !normalizedChatId || lastUsedChats[contextKey] === normalizedChatId) {
            return;
        }
        lastUsedChats[contextKey] = normalizedChatId;
        persistLastUsedChats();
    }

    function setChatReadCursor(contextKey, chatId, messageCount, lastMes = '') {
        if (!contextKey || !chatId) {
            return;
        }

        const cursors = getChatReadCursors();
        const contexts = getChatReadContexts();
        const cacheKey = getChatCacheKey(contextKey, chatId);
        const count = Number(messageCount);
        const nextCursor = {
            messageCount: Number.isFinite(count) ? Math.max(0, count) : 0,
            lastMes: lastMes || '',
        };
        const previous = cursors[cacheKey];
        contexts[contextKey] = true;
        if (previous?.messageCount === nextCursor.messageCount && previous?.lastMes === nextCursor.lastMes) {
            persistChatReadState();
            return;
        }

        cursors[cacheKey] = nextCursor;
        persistChatReadState();
    }

    function syncChatReadStateForList(contextKey, chats) {
        if (!contextKey) {
            return;
        }

        const cursors = getChatReadCursors();
        const contexts = getChatReadContexts();
        const firstLoad = !contexts[contextKey];
        let changed = false;
        for (const chat of chats || []) {
            const chatId = getChatId(chat);
            if (!chatId) {
                continue;
            }

            const cacheKey = getChatCacheKey(contextKey, chatId);
            const messageCount = getChatMessageCount(chat);
            const cursor = cursors[cacheKey];
            if (!cursor) {
                if (firstLoad) {
                    cursors[cacheKey] = { messageCount, lastMes: chat.last_mes || '' };
                    changed = true;
                }
                continue;
            }

            const readCount = Number(cursor.messageCount || 0);
            if (readCount > messageCount) {
                cursors[cacheKey] = { messageCount, lastMes: chat.last_mes || cursor.lastMes || '' };
                changed = true;
            }
        }

        if (firstLoad) {
            contexts[contextKey] = true;
            changed = true;
        }
        if (changed) {
            persistChatReadState();
        }
    }

    function markChatRead(entity, chatId, messages = null, groupMode = isGroupChatMode()) {
        const contextKey = getChatContextKey(entity, groupMode);
        const normalizedChatId = getChatId({ file_id: chatId, file_name: chatId });
        const knownChat = getKnownChat(contextKey, normalizedChatId);
        const messageCount = Array.isArray(messages) ? messages.length : getChatMessageCount(knownChat);
        const lastMes = knownChat?.last_mes || (Array.isArray(messages) ? messages.at(-1)?.send_date : '') || '';
        setChatReadCursor(contextKey, normalizedChatId, messageCount, lastMes);
    }

    function moveChatReadState(contextKey, oldChatId, newChatId) {
        const oldId = getChatId({ file_id: oldChatId, file_name: oldChatId });
        const newId = getChatId({ file_id: newChatId, file_name: newChatId });
        if (!contextKey || !oldId || !newId || oldId === newId) {
            return;
        }

        const cursors = getChatReadCursors();
        const oldKey = getChatCacheKey(contextKey, oldId);
        const newKey = getChatCacheKey(contextKey, newId);
        if (cursors[oldKey]) {
            cursors[newKey] = cursors[oldKey];
            delete cursors[oldKey];
            persistChatReadState();
        }
        if (lastUsedChats[contextKey] === oldId) {
            lastUsedChats[contextKey] = newId;
            persistLastUsedChats();
        }
    }

    function deleteChatReadState(contextKey, chatId) {
        const normalizedChatId = getChatId({ file_id: chatId, file_name: chatId });
        const cacheKey = getChatCacheKey(contextKey, normalizedChatId);
        const cursors = getChatReadCursors();
        if (cursors[cacheKey]) {
            delete cursors[cacheKey];
            persistChatReadState();
        }
        if (lastUsedChats[contextKey] === normalizedChatId) {
            delete lastUsedChats[contextKey];
            persistLastUsedChats();
        }
    }

    function clearChatTransientState() {
        state.chatRenaming = { key: '', name: '' };
        state.chatDeleteConfirm = { key: '', name: '' };
        state.chatEditing = { key: '', index: -1, text: '' };
        state.chatMessageDeleteConfirm = { key: '', index: -1 };
    }

    const {
        clearChatSearch,
        loadCharacterChats,
        loadChatMessages,
        loadGroupChats,
        prepareChatForSelectedContext,
        refreshCachedChatLists,
        refreshSelectedChatList,
        searchSelectedChats,
    } = createChatContextLoaderActions({
        state,
        apiFetch,
        render,
        showToast,
        getChatCacheKey,
        getChatContextKey,
        getChatId,
        getChatMessageCount,
        getLastUsedChat,
        getLatestUnreadChat,
        getSelectedChatEntity,
        isGroupChatMode,
        markChatRead,
        onChatSelectionShown: syncChatSelectionUrl,
        rememberLastUsedChat,
        sortChats,
        syncChatReadStateForList,
    });

    function selectLatestUnreadChatTarget() {
        const target = getLatestUnreadChatTarget();
        if (!target) {
            return false;
        }

        state.chatMode = target.groupMode ? 'group' : 'character';
        localStorage.setItem('st-modern-chat-mode', state.chatMode);
        if (target.groupMode) {
            state.selected.group = target.entity.id;
        } else {
            state.selected.character = target.entity.avatar;
        }
        state.selected.chat = target.chatId;
        clearChatTransientState();
        clearChatSearch();
        return true;
    }

    function useChatMode(mode, { resetChat = false } = {}) {
        const nextMode = mode === 'group' ? 'group' : 'character';
        if (state.chatMode === nextMode) {
            return false;
        }

        state.chatMode = nextMode;
        localStorage.setItem('st-modern-chat-mode', nextMode);
        if (resetChat) {
            state.selected.chat = '';
            clearChatTransientState();
            clearChatSearch();
        }
        return true;
    }

    function ensureAvailableChatMode() {
        reconcileUrlChatSelection();
        if (state.chatMode === 'group' && !state.groups.length && state.characters.length) {
            return useChatMode('character', { resetChat: true });
        }
        if (state.chatMode === 'character' && !state.characters.length && state.groups.length) {
            return useChatMode('group', { resetChat: true });
        }
        return false;
    }

    function increaseCurrentMessageLimit() {
        const key = getCurrentDraftKey();
        if (!key) {
            return;
        }
        state.chatMessageLimits[key] = Math.min(getSelectedChatMessages().length, getCurrentMessageLimit() + 80);
        render();
    }

    function getCurrentDraft() {
        return state.chatDrafts[getCurrentDraftKey()] || '';
    }

    function setCurrentDraft(value) {
        state.chatDrafts[getCurrentDraftKey()] = value;
    }

    async function saveGroupMetadata(group) {
        if (!group?.id) {
            throw new Error('缺少群聊。');
        }
        await apiFetch('/api/groups/edit', { body: group });
    }

    const groupMetadataQueue = new KeyedPromiseQueue();
    const groupMetadataReloadRequired = new Set();
    const groupMetadataDeleteBarriers = new Set();

    function useGroupMetadata(group, metadata) {
        Object.assign(group, metadata);
        const currentGroup = state.groups.find(item => item.id === group.id);
        if (currentGroup && currentGroup !== group) {
            Object.assign(currentGroup, metadata);
        }
    }

    async function reloadGroupMetadata(group) {
        const groups = await apiFetch('/api/groups/all');
        const metadata = Array.isArray(groups) ? groups.find(item => item.id === group.id) : null;
        if (!metadata) {
            throw new Error('群聊元数据重新读取失败。');
        }
        useGroupMetadata(group, metadata);
        groupMetadataReloadRequired.delete(group.id);
    }

    async function getGroupMetadataExistence(groupId) {
        try {
            const groups = await apiFetch('/api/groups/all');
            return Array.isArray(groups) ? groups.some(item => item.id === groupId) : null;
        } catch {
            return null;
        }
    }

    async function updateGroupMetadata(group, updateMetadata) {
        if (!group?.id || typeof updateMetadata !== 'function') {
            throw new Error('群聊元数据更新目标无效。');
        }

        const groupId = group.id;
        if (groupMetadataDeleteBarriers.has(groupId)) {
            throw new Error('群聊已删除或正在删除，无法继续更新。');
        }

        return groupMetadataQueue.run(groupId, async () => {
            if (groupMetadataReloadRequired.has(groupId)) {
                await reloadGroupMetadata(group);
            }

            async function getNextMetadata() {
                const currentGroup = state.groups.find(item => item.id === groupId) || group;
                const nextMetadata = structuredClone(currentGroup);
                await updateMetadata(nextMetadata);
                return nextMetadata;
            }

            let nextMetadata = await getNextMetadata();
            try {
                await saveGroupMetadata(nextMetadata);
            } catch (error) {
                groupMetadataReloadRequired.add(groupId);
                try {
                    // Resolve an uncertain response from authoritative data, then retry the same idempotent RMW once.
                    await reloadGroupMetadata(group);
                    nextMetadata = await getNextMetadata();
                    await saveGroupMetadata(nextMetadata);
                } catch {
                    groupMetadataReloadRequired.add(groupId);
                    throw error;
                }
            }
            useGroupMetadata(group, nextMetadata);
            groupMetadataReloadRequired.delete(groupId);
            return nextMetadata;
        });
    }

    async function deleteGroupMetadata(groupId) {
        if (!groupId) {
            throw new Error('缺少待删除群聊。');
        }
        if (groupMetadataDeleteBarriers.has(groupId)) {
            throw new Error('群聊已删除或正在删除。');
        }

        // Mark deletion before waiting so operations that have not entered the queue cannot recreate the group.
        groupMetadataDeleteBarriers.add(groupId);
        try {
            await groupMetadataQueue.run(groupId, async () => {
                await apiFetch('/api/groups/delete', { body: { id: groupId } });
                groupMetadataReloadRequired.delete(groupId);
            });
        } catch (error) {
            const groupExists = await getGroupMetadataExistence(groupId);
            if (groupExists === true) {
                groupMetadataDeleteBarriers.delete(groupId);
                throw error;
            }
            if (groupExists === null) {
                throw error;
            }
            groupMetadataReloadRequired.delete(groupId);
        }
    }

    async function refreshSelectedChatUnreadState() {
        // Poll-driven refresh: silent errors and no loading indicators, so a skipped
        // re-render can never leave stale loading UI behind
        await refreshCachedChatLists({ quiet: true, background: true });
    }

    const chatFileOperationQueue = new KeyedPromiseQueue();
    const chatFileOperationBarriers = new Map();

    function getChatFileOperationTarget(contextKey, chatId) {
        const normalizedChatId = getChatId({ file_id: chatId, file_name: chatId });
        return {
            chatId: normalizedChatId,
            key: contextKey && normalizedChatId ? getChatCacheKey(contextKey, normalizedChatId) : '',
        };
    }

    async function runModernChatFileOperation(entity, chatId, operation, { groupMode = isGroupChatMode() } = {}) {
        const contextKey = getChatContextKey(entity, groupMode);
        const target = getChatFileOperationTarget(contextKey, chatId);
        if (!target.key || typeof operation !== 'function') {
            throw new Error(groupMode ? '缺少群聊或聊天文件' : '缺少角色或聊天文件');
        }
        if (chatFileOperationBarriers.has(target.key)) {
            throw new Error('聊天文件已删除、重命名或正在变更，无法继续保存。');
        }

        // Every accepted write (new chat, send/generate, swipe, message edit) marks the chat as the one in use for its context.
        rememberLastUsedChat(contextKey, target.chatId);
        // Accept the operation before entering the queue. A later delete/rename waits for it, while newer saves are rejected by the barrier.
        return chatFileOperationQueue.run(target.key, () => operation({ contextKey, chatId: target.chatId }));
    }

    async function changeModernChatFile(contextKey, chatId, change, operation) {
        const target = getChatFileOperationTarget(contextKey, chatId);
        if (!target.key || typeof operation !== 'function') {
            throw new Error('聊天文件变更目标无效。');
        }
        if (chatFileOperationBarriers.has(target.key)) {
            throw new Error('聊天文件已删除、重命名或正在变更。');
        }

        // Install the barrier before waiting for previously accepted saves/generation work.
        chatFileOperationBarriers.set(target.key, `${change}中`);
        let confirmedUnchanged = false;
        try {
            const result = await chatFileOperationQueue.run(target.key, () => operation({
                confirmUnchanged: () => {
                    confirmedUnchanged = true;
                },
            }));
            chatFileOperationBarriers.set(target.key, `${change}完成`);
            return result;
        } catch (error) {
            if (confirmedUnchanged) {
                chatFileOperationBarriers.delete(target.key);
            }
            throw error;
        }
    }

    // metadata 默认取已知的聊天头；元数据写入原语（updateModernChatMetadata）传入修改后的版本。
    async function saveModernChatNow(entity, chatId, messages, { contextKey, groupMode, metadata: changedMetadata = null }) {
        const cacheKey = getChatCacheKey(contextKey, chatId);
        const metadata = changedMetadata ?? getSelectedChatMetadata(entity, chatId, groupMode);
        const chat = [
            { chat_metadata: metadata, user_name: 'unused', character_name: 'unused' },
            ...messages,
        ];
        let result;
        try {
            result = groupMode
                ? await apiFetch('/api/chats/group/save', { body: { id: chatId, chat } })
                : await apiFetch('/api/chats/save', {
                    body: {
                        ch_name: getCharacterName(entity),
                        file_name: chatId,
                        avatar_url: entity.avatar,
                        chat,
                    },
                });
        } catch (error) {
            // 服务端拒绝过期 integrity 时回 HTTP 400 + {"error":"integrity"}（src/endpoints/chats.js 的 /save 与 /group/save），
            // apiFetch 把它当普通 400 抛出；换成友好提示，status / body 照旧带上，按状态码判断的调用方行为不变
            if (isChatIntegrityConflictError(error)) {
                const conflict = /** @type {Error & { status?: number, body?: string }} */ (new Error(CHAT_INTEGRITY_CONFLICT_MESSAGE, { cause: error }));
                conflict.status = error.status;
                conflict.body = error.body;
                throw conflict;
            }
            throw error;
        }

        if (result?.error) {
            throw new Error(result.error === 'integrity' ? CHAT_INTEGRITY_CONFLICT_MESSAGE : String(result.error));
        }
        // 服务端每次保存都会签发新的 integrity：必须记下，否则下一次保存（含引擎的生成保存）会因旧 integrity 冲突失败
        if (typeof result?.integrity === 'string' && result.integrity) {
            state.chatMetadata[cacheKey] = { ...metadata, integrity: result.integrity };
        } else if (changedMetadata) {
            state.chatMetadata[cacheKey] = changedMetadata;
        }

        state.chatMessages[cacheKey] = messages;
        markChatRead(entity, chatId, messages, groupMode);
    }

    async function saveModernChat(entity, chatId, messages, { groupMode = isGroupChatMode() } = {}) {
        const nextMessages = structuredClone(messages);
        return runModernChatFileOperation(entity, chatId, ({ contextKey, chatId: normalizedChatId }) => {
            return saveModernChatNow(entity, normalizedChatId, nextMessages, { contextKey, groupMode });
        }, { groupMode });
    }

    async function updateModernChat(entity, chatId, updateMessages, { groupMode = isGroupChatMode() } = {}) {
        if (typeof updateMessages !== 'function') {
            throw new Error('聊天消息更新方法无效。');
        }

        return runModernChatFileOperation(entity, chatId, async ({ contextKey, chatId: normalizedChatId }) => {
            const cacheKey = getChatCacheKey(contextKey, normalizedChatId);
            const messages = structuredClone(state.chatMessages[cacheKey] || []);
            const result = await updateMessages(messages);
            await saveModernChatNow(entity, normalizedChatId, messages, { contextKey, groupMode });
            return result;
        }, { groupMode });
    }

    // 同步通道：与消息编辑 / 删除用同一口径（当前选中实体）通知引擎重开该聊天
    function buildReloadChatPayload(entity, groupMode, chatId) {
        return groupMode ? { groupId: entity.id, chat: chatId } : { avatar: entity.avatar, chat: chatId };
    }

    /**
     * updateModernChat 加引擎同步：消息保存成功后，仍持有文件队列时就登记 reloadChat（排在后面的生成会在
     * waitForEngineSync 里看到它）。engineSync 不在这里等待，调用方决定何时等：界面可以先刷新，再等引擎。
     * 不检查是否在生成：调用方自己管理（例如开场白切换用 beginGeneration 占住界面）。
     * @param {object} entity 角色或群聊
     * @param {string} chatId 聊天文件 ID
     * @param {(messages: object[]) => any} updateMessages 就地修改消息副本，抛错则不保存
     * @param {{ groupMode?: boolean }} [options] 群聊模式，默认取当前聊天模式
     * @returns {Promise<{ result: any, engineSync: Promise<{ ok: boolean, error?: string }> }>} result 为回调返回值，
     * engineSync 为 reloadChat 的结果（永不 reject）
     */
    async function updateModernChatAndSync(entity, chatId, updateMessages, { groupMode = isGroupChatMode() } = {}) {
        if (typeof updateMessages !== 'function') {
            throw new Error('聊天消息更新方法无效。');
        }

        let engineSync = null;
        const result = await runModernChatFileOperation(entity, chatId, async ({ contextKey, chatId: normalizedChatId }) => {
            const cacheKey = getChatCacheKey(contextKey, normalizedChatId);
            if (!state.chatMessages[cacheKey]) {
                // 没有读过这份聊天就不能保存：用空消息覆盖会清空聊天文件
                throw new Error('聊天记录尚未读取，无法保存。');
            }
            const messages = structuredClone(state.chatMessages[cacheKey]);
            const outcome = await updateMessages(messages);
            await saveModernChatNow(entity, normalizedChatId, messages, { contextKey, groupMode });
            engineSync = reloadChat(buildReloadChatPayload(entity, groupMode, normalizedChatId));
            return outcome;
        }, { groupMode });

        return { result, engineSync: Promise.resolve(engineSync).then(reload => reload || { ok: true }) };
    }

    /**
     * 聊天头元数据（chat_metadata）的读改写原语：作者注释、背景锁定等聊天级设置都经此写入。
     * 在聊天文件操作队列里克隆已知元数据，交给 mutate 就地修改，连同现有消息一起保存；保存成功后记下服务端新签发的
     * integrity，再等待引擎重开该聊天（reloadChat），使下一次生成读到新元数据且不会因旧 integrity 冲突。
     * 生成中拒绝（引擎正在使用这份聊天文件）。integrity 由服务端签发，mutate 对它的改动会被忽略。
     * @param {object} entity 角色或群聊
     * @param {string} chatId 聊天文件 ID
     * @param {(metadata: object) => any} mutate 就地修改元数据副本，返回值原样放进 result
     * @param {{ groupMode?: boolean }} [options] 群聊模式，默认取当前聊天模式
     * @returns {Promise<{ result: any, metadata: object, reload: { ok: boolean, error?: string } }>} result 为 mutate 的返回值，
     * metadata 为已保存的元数据（含新 integrity），reload 为引擎同步结果（ok:false 表示文件已保存但引擎尚未同步）
     */
    async function updateModernChatMetadata(entity, chatId, mutate, { groupMode = isGroupChatMode() } = {}) {
        if (typeof mutate !== 'function') {
            throw new Error('聊天元数据更新方法无效。');
        }
        if (state.engine.generating) {
            throw new Error('生成中不能修改聊天设置。');
        }

        let engineSync = null;
        const outcome = await runModernChatFileOperation(entity, chatId, async ({ contextKey, chatId: normalizedChatId }) => {
            const cacheKey = getChatCacheKey(contextKey, normalizedChatId);
            if (!state.chatMessages[cacheKey] || !state.chatMetadata[cacheKey]) {
                // 没有读过这份聊天就不能保存：用空消息覆盖会清空聊天文件
                await loadChatMessages(entity, normalizedChatId, { force: true, groupMode, isContextCurrent: () => false });
                if (!state.chatMessages[cacheKey] || !state.chatMetadata[cacheKey]) {
                    throw new Error('聊天记录读取失败，无法保存聊天设置。');
                }
            }

            const knownMetadata = state.chatMetadata[cacheKey];
            const nextMetadata = structuredClone(knownMetadata);
            const result = await mutate(nextMetadata);
            if (typeof knownMetadata.integrity === 'string' && knownMetadata.integrity) {
                nextMetadata.integrity = knownMetadata.integrity;
            } else {
                delete nextMetadata.integrity;
            }

            const messages = structuredClone(state.chatMessages[cacheKey]);
            await saveModernChatNow(entity, normalizedChatId, messages, { contextKey, groupMode, metadata: nextMetadata });
            // 仍持有文件队列时就登记这次同步：排在后面的生成会在 waitForEngineSync 里看到它，引擎侧也按到达顺序先重载后生成
            engineSync = reloadChat(buildReloadChatPayload(entity, groupMode, normalizedChatId));
            return { result, metadata: structuredClone(state.chatMetadata[cacheKey]) };
        }, { groupMode });

        const reload = await engineSync;
        return { ...outcome, reload: reload || { ok: true } };
    }

    function renameModernChatFile(contextKey, chatId, operation) {
        return changeModernChatFile(contextKey, chatId, '重命名', operation);
    }

    function deleteModernChatFile(contextKey, chatId, operation) {
        return changeModernChatFile(contextKey, chatId, '删除', operation);
    }

    // 懒加载角色列表（performance.lazyLoadCharacters）里的卡只有摘要，没有 first_mes / alternate_greetings，要取完整卡
    async function resolveFullCharacter(character) {
        if (!character?.shallow) {
            return character;
        }

        const full = await apiFetch('/api/characters/get', { body: { avatar_url: character.avatar } });
        if (!full || typeof full !== 'object') {
            throw new Error(`角色卡「${getCharacterName(character)}」读取失败，无法生成开场白。`);
        }
        return full;
    }

    /**
     * 新建聊天时写入的开场白消息，对照旧版：
     * - 单人聊天：getFirstMessage，[first_mes, ...备用开场白] 作为候选，first_mes 为空时第一条备用开场白顶上；
     * - 群聊：getGroupChat 的新聊天分支，每个成员各一条，从该成员的开场白里随机挑，没有候选、没有开场白的成员跳过。
     * @param {object} entity 角色或群聊
     * @param {boolean} groupMode 是否群聊
     * @returns {Promise<object[]>} 要写进新聊天的消息
     */
    async function createOpeningMessages(entity, groupMode) {
        if (!groupMode) {
            const greeting = createGreetingMessage(await resolveFullCharacter(entity));
            return greeting ? [greeting] : [];
        }

        const messages = [];
        for (const member of Array.isArray(entity?.members) ? entity.members : []) {
            const listed = state.characters.find(character => character.avatar === member || character.name === member);
            if (!listed) {
                continue;
            }

            const greeting = createGroupMemberGreetingMessage(await resolveFullCharacter(listed));
            if (greeting) {
                messages.push(greeting);
            }
        }
        return messages;
    }

    const chatFileCreationPromises = new Map();

    function createModernChatFile(entity) {
        const groupMode = isGroupChatMode();
        const contextKey = getChatContextKey(entity, groupMode);
        if (!entity || !contextKey) {
            return Promise.reject(new Error(groupMode ? '请先选择群聊' : '请先选择角色'));
        }

        const inFlightCreation = chatFileCreationPromises.get(contextKey);
        if (inFlightCreation) {
            return inFlightCreation;
        }

        const creation = (async () => {
            // 先取好开场白：摘要卡没有开场白字段，读不到时不创建聊天文件
            const messages = await createOpeningMessages(entity, groupMode);
            const chatId = createModernChatId();
            const cacheKey = getChatCacheKey(contextKey, chatId);
            function clearCreatedChatState() {
                delete state.chatMetadata[cacheKey];
                delete state.chatMessages[cacheKey];
                deleteChatReadState(contextKey, chatId);
            }

            state.chatMetadata[cacheKey] = {};

            try {
                await saveModernChat(entity, chatId, messages, { groupMode });
            } catch (error) {
                clearCreatedChatState();
                throw error;
            }

            if (groupMode) {
                // Persist the chat file before publishing its ID in group metadata.
                try {
                    await updateGroupMetadata(entity, nextMetadata => {
                        const chats = Array.isArray(nextMetadata.chats) ? nextMetadata.chats : [];
                        nextMetadata.chats = chats.includes(chatId) ? [...chats] : [...chats, chatId];
                        nextMetadata.chat_id = chatId;
                    });
                } catch (error) {
                    // Keep the file because the metadata write may have committed before its response failed.
                    clearCreatedChatState();
                    throw error;
                }
            }

            await refreshSelectedChatList(entity, { groupMode });
            const isContextCurrent = isGroupChatMode() === groupMode && getChatContextKey(getSelectedChatEntity(), groupMode) === contextKey;
            if (isContextCurrent) {
                state.selected.chat = chatId;
                syncChatSelectionUrl();
            }
            return chatId;
        })();
        chatFileCreationPromises.set(contextKey, creation);
        const clearCreation = () => {
            if (chatFileCreationPromises.get(contextKey) === creation) {
                chatFileCreationPromises.delete(contextKey);
            }
        };
        creation.then(clearCreation, clearCreation);
        return creation;
    }

    function toggleChatSidebar(open = !state.chatSidebarOpen) {
        state.chatSidebarOpen = open;
        localStorage.setItem('st-modern-chat-sidebar-open', String(open));
        render();
    }

    function isChatSidebarOverlayVisible() {
        const scrim = document.querySelector('.chat-sidebar-scrim');
        return !!scrim && window.getComputedStyle(scrim).display !== 'none';
    }

    function closeChatSidebarForMobileSelection() {
        if (!state.chatSidebarOpen || !isChatSidebarOverlayVisible()) {
            return false;
        }

        state.chatSidebarOpen = false;
        localStorage.setItem('st-modern-chat-sidebar-open', 'false');
        return true;
    }

    function closeChatSidebarOverlay() {
        if (!closeChatSidebarForMobileSelection()) {
            return false;
        }

        render();
        return true;
    }

    return {
        getSelectedCharacter,
        getSelectedGroup,
        isGroupChatMode,
        useChatMode,
        ensureAvailableChatMode,
        getChatModeLabel,
        getSelectedChatEntity,
        getChatContextKey,
        getChatEntityName,
        getChatEntityAvatarUrl,
        getGroupAvatarUrl,
        getChatEntityFallbackIcon,
        getChatEntityEmptyTitle,
        getChatEntityEmptyDescription,
        getChatEntityListEmptyText,
        getSelectedChatList,
        getChatId,
        getChatMessageCount,
        getChatUnreadCount,
        getVisibleChatList,
        getEntityUnreadCount,
        getTotalChatUnreadCount,
        getSelectedChatMessages,
        getCurrentMessageLimit,
        increaseCurrentMessageLimit,
        getChatCacheKey,
        sortChats,
        loadCharacterChats,
        loadGroupChats,
        clearChatSearch,
        clearChatTransientState,
        searchSelectedChats,
        loadChatMessages,
        prepareChatForSelectedContext,
        getCurrentDraftKey,
        getCurrentDraft,
        setCurrentDraft,
        getCharacterName,
        getUserName,
        saveGroupMetadata,
        updateGroupMetadata,
        deleteGroupMetadata,
        saveModernChat,
        updateModernChat,
        updateModernChatAndSync,
        updateModernChatMetadata,
        runModernChatFileOperation,
        renameModernChatFile,
        deleteModernChatFile,
        refreshSelectedChatList,
        refreshSelectedChatUnreadState,
        selectLatestUnreadChatTarget,
        createOpeningMessages,
        createModernChatFile,
        moveChatReadState,
        deleteChatReadState,
        toggleChatSidebar,
        closeChatSidebarForMobileSelection,
        closeChatSidebarOverlay,
    };
}
