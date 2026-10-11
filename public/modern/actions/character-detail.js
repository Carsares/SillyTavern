import { getAvatarUrl } from '../core/utils.js';

export function createCharacterDetailActions({
    state,
    apiFetch,
    showToast,
}) {
    function getCharacterAvatarUrl(character) {
        const url = getAvatarUrl(character);
        const avatar = character?.avatar || '';
        const cacheBust = avatar ? state.avatarCacheBust[avatar] : '';
        return url && cacheBust ? `${url}?v=${encodeURIComponent(cacheBust)}` : url;
    }

    function getCharacterByAvatar(avatar) {
        return state.characters.find(character => character.avatar === avatar) || state.characterDetails[avatar] || null;
    }

    async function loadCharacterDetail(avatar, { force = false } = {}) {
        if (!avatar || (state.characterDetails[avatar] && !force)) {
            return state.characterDetails[avatar] || null;
        }

        try {
            state.characterDetails[avatar] = await apiFetch('/api/characters/get', { body: { avatar_url: avatar } });
            return state.characterDetails[avatar];
        } catch (error) {
            state.errors.push({ key: 'character', message: error.message });
            showToast('角色卡读取失败', error.message);
            return null;
        }
    }

    function clearCharacterCache(avatar) {
        if (!avatar) {
            return;
        }

        delete state.characterDetails[avatar];
        delete state.chatLists[avatar];
        Object.keys(state.chatMessages).forEach(key => {
            if (key.startsWith(`${avatar}::`)) {
                delete state.chatMessages[key];
            }
        });
        Object.keys(state.chatMessageLimits).forEach(key => {
            if (key.startsWith(`${avatar}::`)) {
                delete state.chatMessageLimits[key];
            }
        });
        Object.keys(state.chatMetadata).forEach(key => {
            if (key.startsWith(`${avatar}::`)) {
                delete state.chatMetadata[key];
            }
        });
    }

    return {
        getCharacterAvatarUrl,
        getCharacterByAvatar,
        loadCharacterDetail,
        clearCharacterCache,
    };
}
