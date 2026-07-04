export function createChatContextLoaderActions({
    state,
    apiFetch,
    render,
    showToast,
    getChatCacheKey,
    getChatContextKey,
    getChatId,
    getChatMessageCount,
    getSelectedChatEntity,
    isGroupChatMode,
    markChatRead,
    sortChats,
    syncChatReadStateForList,
}) {
    async function loadCharacterChats(character, { force = false, quiet = false } = {}) {
        if (!character?.avatar) {
            return [];
        }
        if (!force && state.chatLists[character.avatar]) {
            return state.chatLists[character.avatar];
        }

        state.loadingChats[character.avatar] = true;
        try {
            const result = await apiFetch('/api/characters/chats', {
                body: {
                    avatar_url: character.avatar,
                    metadata: true,
                },
            });
            const chats = Array.isArray(result) ? sortChats(result.filter(chat => chat.file_name)) : [];
            state.chatLists[character.avatar] = chats;
            syncChatReadStateForList(character.avatar, chats);
            return chats;
        } catch (error) {
            if (!quiet) {
                state.errors.push({ key: 'chats', message: error.message });
                showToast('聊天列表读取失败', error.message);
                state.chatLists[character.avatar] = [];
                return [];
            }
            return state.chatLists[character.avatar] || [];
        } finally {
            state.loadingChats[character.avatar] = false;
        }
    }

    async function loadGroupChats(group, { force = false, quiet = false } = {}) {
        if (!group?.id) {
            return [];
        }

        const contextKey = `group:${group.id}`;
        if (!force && state.chatLists[contextKey]) {
            return state.chatLists[contextKey];
        }

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
            state.chatLists[contextKey] = chats;
            syncChatReadStateForList(contextKey, chats);
            return chats;
        } catch (error) {
            if (!quiet) {
                state.errors.push({ key: 'group-chats', message: error.message });
                showToast('群聊列表读取失败', error.message);
                state.chatLists[contextKey] = [];
                return [];
            }
            return state.chatLists[contextKey] || [];
        } finally {
            state.loadingChats[contextKey] = false;
        }
    }

    function clearChatSearch() {
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
        const entity = getSelectedChatEntity();
        const contextKey = getChatContextKey(entity);
        if (!entity || !contextKey) {
            throw new Error(isGroupChatMode() ? '请先选择一个群聊。' : '请先选择一个角色。');
        }

        const query = state.chatSearch.query.trim();
        if (!query) {
            clearChatSearch();
            return;
        }

        state.chatSearch = {
            ...state.chatSearch,
            avatar: isGroupChatMode() ? '' : entity.avatar,
            contextKey,
            loading: true,
        };
        render();

        try {
            const result = await apiFetch('/api/chats/search', {
                body: {
                    query,
                    avatar_url: isGroupChatMode() ? null : entity.avatar,
                    group_id: isGroupChatMode() ? entity.id : null,
                },
            });
            const results = Array.isArray(result) ? sortChats(result.filter(chat => chat.file_name)) : [];
            state.chatSearch = {
                avatar: isGroupChatMode() ? '' : entity.avatar,
                contextKey,
                query,
                searchedQuery: query,
                loading: false,
                results,
            };
        } catch (error) {
            state.chatSearch.loading = false;
            throw error;
        }
    }

    async function loadChatMessages(entity, chatId, { force = false } = {}) {
        const contextKey = getChatContextKey(entity);
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
                markChatRead(entity, normalizedChatId, cachedMessages);
                return cachedMessages;
            }
        }

        if (state.chatMessages[cacheKey]) {
            delete state.chatMessages[cacheKey];
            delete state.chatMetadata[cacheKey];
        }

        try {
            const result = isGroupChatMode()
                ? await apiFetch('/api/chats/group/get', { body: { id: normalizedChatId } })
                : await apiFetch('/api/chats/get', {
                    body: {
                        ch_name: entity.name || entity.data?.name || '',
                        file_name: normalizedChatId,
                        avatar_url: entity.avatar,
                    },
                });
            const header = Array.isArray(result) ? result.find(message => message && message.chat_metadata) : null;
            const messages = Array.isArray(result) ? result.filter(message => message && !message.chat_metadata) : [];
            state.chatMetadata[cacheKey] = header?.chat_metadata || {};
            state.chatMessages[cacheKey] = messages;
            markChatRead(entity, normalizedChatId, messages);
            return state.chatMessages[cacheKey];
        } catch (error) {
            state.errors.push({ key: 'chat', message: error.message });
            showToast('聊天记录读取失败', error.message);
            return [];
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

    async function prepareChatForSelectedContext({ forceList = false, quiet = false } = {}) {
        const entity = getSelectedChatEntity();
        const chats = isGroupChatMode() ? await loadGroupChats(entity, { force: forceList, quiet }) : await loadCharacterChats(entity, { force: forceList, quiet });

        useFirstAvailableChat(chats);

        await loadChatMessages(entity, state.selected.chat);
    }

    async function refreshSelectedChatList(entity, { quiet = false } = {}) {
        if (isGroupChatMode()) {
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
