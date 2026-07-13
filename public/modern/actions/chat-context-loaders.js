export function createChatContextLoaderActions({
    state,
    apiFetch,
    render,
    showToast,
    getChatCacheKey,
    getChatContextKey,
    getChatId = chat => String(chat?.file_id || chat?.file_name || '').replace(/\.jsonl$/i, ''),
    getChatMessageCount = chat => Number(chat?.chat_items ?? chat?.message_count ?? 0),
    getSelectedChatEntity,
    isGroupChatMode,
    markChatRead = () => {},
    sortChats,
    syncChatReadStateForList = () => {},
}) {
    const chatListLoadTokens = new Map();
    const chatMessageLoadTokens = new Map();
    let chatSearchToken = null;

    async function loadCharacterChats(character, { force = false, quiet = false, isCurrent = () => true } = {}) {
        if (!character?.avatar) {
            return [];
        }
        if (!force && state.chatLists[character.avatar]) {
            return state.chatLists[character.avatar];
        }

        const loadToken = Symbol(character.avatar);
        chatListLoadTokens.set(character.avatar, loadToken);
        state.loadingChats[character.avatar] = true;
        try {
            const result = await apiFetch('/api/characters/chats', {
                body: {
                    avatar_url: character.avatar,
                    metadata: true,
                },
            });
            const chats = Array.isArray(result) ? sortChats(result.filter(chat => chat.file_name)) : [];
            if (!isCurrent() || chatListLoadTokens.get(character.avatar) !== loadToken) {
                return state.chatLists[character.avatar] || [];
            }
            state.chatLists[character.avatar] = chats;
            syncChatReadStateForList(character.avatar, chats);
            return chats;
        } catch (error) {
            if (isCurrent() && chatListLoadTokens.get(character.avatar) === loadToken && !quiet) {
                state.errors.push({ key: 'chats', message: error.message });
                showToast('聊天列表读取失败', error.message);
                state.chatLists[character.avatar] = [];
                return [];
            }
            return state.chatLists[character.avatar] || [];
        } finally {
            if (chatListLoadTokens.get(character.avatar) === loadToken) {
                chatListLoadTokens.delete(character.avatar);
                state.loadingChats[character.avatar] = false;
            }
        }
    }

    async function loadGroupChats(group, { force = false, quiet = false, isCurrent = () => true } = {}) {
        if (!group?.id) {
            return [];
        }

        const contextKey = `group:${group.id}`;
        if (!force && state.chatLists[contextKey]) {
            return state.chatLists[contextKey];
        }

        const loadToken = Symbol(contextKey);
        chatListLoadTokens.set(contextKey, loadToken);
        state.loadingChats[contextKey] = true;
        try {
            const result = await apiFetch('/api/chats/search', {
                body: {
                    query: '',
                    avatar_url: null,
                    group_id: group.id,
                },
            });
            const chats = Array.isArray(result) ? sortChats(result.filter(chat => chat.file_name)) : [];
            if (!isCurrent() || chatListLoadTokens.get(contextKey) !== loadToken) {
                return state.chatLists[contextKey] || [];
            }
            state.chatLists[contextKey] = chats;
            syncChatReadStateForList(contextKey, chats);
            return chats;
        } catch (error) {
            if (isCurrent() && chatListLoadTokens.get(contextKey) === loadToken && !quiet) {
                state.errors.push({ key: 'group-chats', message: error.message });
                showToast('群聊列表读取失败', error.message);
                state.chatLists[contextKey] = [];
                return [];
            }
            return state.chatLists[contextKey] || [];
        } finally {
            if (chatListLoadTokens.get(contextKey) === loadToken) {
                chatListLoadTokens.delete(contextKey);
                state.loadingChats[contextKey] = false;
            }
        }
    }

    function clearChatSearch() {
        chatSearchToken = null;
        const contextKey = getChatContextKey();
        state.chatSearch = {
            avatar: state.selected.character || '',
            contextKey,
            query: '',
            searchedQuery: '',
            loading: false,
            results: [],
        };
    }

    async function searchSelectedChats() {
        const searchToken = Symbol('chat-search');
        chatSearchToken = searchToken;
        const groupMode = isGroupChatMode();
        const entity = getSelectedChatEntity();
        const contextKey = getChatContextKey(entity, groupMode);
        if (!entity || !contextKey) {
            throw new Error(groupMode ? '请先选择一个群聊。' : '请先选择一个角色。');
        }

        const query = state.chatSearch.query.trim();
        if (!query) {
            clearChatSearch();
            return;
        }

        state.chatSearch = {
            ...state.chatSearch,
            avatar: groupMode ? '' : entity.avatar,
            contextKey,
            loading: true,
        };
        render();

        try {
            const result = await apiFetch('/api/chats/search', {
                body: {
                    query,
                    avatar_url: groupMode ? null : entity.avatar,
                    group_id: groupMode ? entity.id : null,
                },
            });
            if (chatSearchToken !== searchToken) {
                return;
            }
            const results = Array.isArray(result) ? sortChats(result.filter(chat => chat.file_name)) : [];
            state.chatSearch = {
                avatar: groupMode ? '' : entity.avatar,
                contextKey,
                query,
                searchedQuery: query,
                loading: false,
                results,
            };
        } catch (error) {
            if (chatSearchToken !== searchToken) {
                return;
            }
            state.chatSearch.loading = false;
            throw error;
        }
    }

    async function loadChatMessages(entity, chatId, {
        force = false,
        groupMode = isGroupChatMode(),
        isContextCurrent = () => true,
        isLoadCurrent = () => true,
    } = {}) {
        const contextKey = getChatContextKey(entity, groupMode);
        if (!contextKey || !chatId) {
            return [];
        }

        const normalizedChatId = getChatId({ file_id: chatId, file_name: chatId });
        const cacheKey = getChatCacheKey(contextKey, normalizedChatId);
        if (!force && state.chatMessages[cacheKey]) {
            const cachedMessages = state.chatMessages[cacheKey];
            const knownChat = (state.chatLists[contextKey] || []).find(chat => getChatId(chat) === normalizedChatId);
            const knownCount = getChatMessageCount(knownChat);
            const knownLastMes = String(knownChat?.last_mes || '');
            const cachedLastMes = String(cachedMessages.at(-1)?.send_date || '');
            const countMatches = !knownChat || knownCount === cachedMessages.length;
            const timestampMatches = !knownLastMes || !cachedLastMes || knownLastMes === cachedLastMes;
            if (countMatches && timestampMatches) {
                if (isLoadCurrent() && isContextCurrent()) {
                    markChatRead(entity, normalizedChatId, cachedMessages);
                }
                return cachedMessages;
            }
        }

        const loadToken = Symbol(cacheKey);
        chatMessageLoadTokens.set(cacheKey, loadToken);
        try {
            const result = groupMode
                ? await apiFetch('/api/chats/group/get', { body: { id: normalizedChatId } })
                : await apiFetch('/api/chats/get', {
                    body: {
                        ch_name: entity.name || entity.data?.name || '',
                        file_name: normalizedChatId,
                        avatar_url: entity.avatar,
                    },
                });
            if (!isLoadCurrent() || chatMessageLoadTokens.get(cacheKey) !== loadToken) {
                return state.chatMessages[cacheKey] || [];
            }
            const header = Array.isArray(result) ? result.find(message => message && message.chat_metadata) : null;
            const messages = Array.isArray(result) ? result.filter(message => message && !message.chat_metadata) : [];
            state.chatMetadata[cacheKey] = header?.chat_metadata || {};
            state.chatMessages[cacheKey] = messages;
            if (isContextCurrent()) {
                markChatRead(entity, normalizedChatId, messages);
            }
            return state.chatMessages[cacheKey];
        } catch (error) {
            if (isLoadCurrent() && chatMessageLoadTokens.get(cacheKey) === loadToken) {
                delete state.chatMessages[cacheKey];
                delete state.chatMetadata[cacheKey];
                if (isContextCurrent()) {
                    state.errors.push({ key: 'chat', message: error.message });
                    showToast('聊天记录读取失败', error.message);
                }
            }
            return [];
        } finally {
            if (chatMessageLoadTokens.get(cacheKey) === loadToken) {
                chatMessageLoadTokens.delete(cacheKey);
            }
        }
    }

    function useFirstAvailableChat(chats) {
        const selectedChatId = getChatId({ file_id: state.selected.chat, file_name: state.selected.chat });
        if (selectedChatId && chats.some(chat => getChatId(chat) === selectedChatId)) {
            state.selected.chat = selectedChatId;
            return;
        }

        state.selected.chat = getChatId(chats[0]) || '';
    }

    async function prepareChatForSelectedContext({ forceList = false, quiet = false, isCurrent = () => true } = {}) {
        const groupMode = isGroupChatMode();
        const entity = getSelectedChatEntity();
        const contextKey = getChatContextKey(entity, groupMode);
        if (!entity || !contextKey) {
            return;
        }

        const isContextCurrent = () => isCurrent() && isGroupChatMode() === groupMode && getChatContextKey(getSelectedChatEntity(), groupMode) === contextKey;
        const chats = groupMode
            ? await loadGroupChats(entity, { force: forceList, quiet, isCurrent })
            : await loadCharacterChats(entity, { force: forceList, quiet, isCurrent });
        // A slower request for an old context must not replace the newer selection.
        if (!isContextCurrent()) {
            return;
        }

        useFirstAvailableChat(chats);

        await loadChatMessages(entity, state.selected.chat, { groupMode, isContextCurrent, isLoadCurrent: isCurrent });
    }

    async function refreshSelectedChatList(entity, { quiet = false, groupMode = isGroupChatMode() } = {}) {
        if (groupMode) {
            await loadGroupChats(entity, { force: true, quiet });
        } else {
            await loadCharacterChats(entity, { force: true, quiet });
        }
    }

    async function refreshCachedChatLists({ quiet = false } = {}) {
        const contextKeys = Object.keys(state.chatLists);
        if (!contextKeys.length) {
            const entity = getSelectedChatEntity();
            if (entity) {
                await refreshSelectedChatList(entity, { quiet });
            }
            return;
        }

        await Promise.all(contextKeys.map(contextKey => {
            if (contextKey.startsWith('group:')) {
                const group = state.groups.find(item => `group:${item.id}` === contextKey);
                return group ? loadGroupChats(group, { force: true, quiet }) : Promise.resolve([]);
            }

            const character = state.characters.find(item => item.avatar === contextKey);
            return character ? loadCharacterChats(character, { force: true, quiet }) : Promise.resolve([]);
        }));
    }

    return {
        clearChatSearch,
        loadCharacterChats,
        loadChatMessages,
        loadGroupChats,
        prepareChatForSelectedContext,
        refreshCachedChatLists,
        refreshSelectedChatList,
        searchSelectedChats,
    };
}
