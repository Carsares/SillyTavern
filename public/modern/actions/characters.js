import { characterFormDefaults } from '../core/constants.js';
import {
    alternateGreetingsToInput,
    arrayToEntryInput,
    downloadFile,
    entryInputToArray,
    getAvatarUrl,
    inputToAlternateGreetings,
    numberInput,
} from '../core/utils.js';

export function createCharacterActions({
    state,
    apiFetch,
    apiFetchResponse,
    loadData,
    render,
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

    function defaultCharacterForm() {
        return { ...characterFormDefaults };
    }

    function getCharacterData(character) {
        return character?.data || {};
    }

    function getCharacterTags(character) {
        const dataTags = getCharacterData(character).tags;
        return Array.isArray(dataTags) ? dataTags : Array.isArray(character?.tags) ? character.tags : [];
    }

    function characterToForm(character) {
        const data = getCharacterData(character);
        const extensions = data.extensions || {};
        const depthPrompt = extensions.depth_prompt || {};

        return {
            ...defaultCharacterForm(),
            name: data.name || character?.name || '',
            description: data.description || character?.description || '',
            personality: data.personality || character?.personality || '',
            scenario: data.scenario || character?.scenario || '',
            first_mes: data.first_mes || character?.first_mes || '',
            mes_example: data.mes_example || character?.mes_example || '',
            creator_notes: data.creator_notes || character?.creatorcomment || '',
            system_prompt: data.system_prompt || '',
            post_history_instructions: data.post_history_instructions || '',
            creator: data.creator || '',
            character_version: data.character_version || '',
            tags: arrayToEntryInput(getCharacterTags(character)),
            world: extensions.world || '',
            alternate_greetings: alternateGreetingsToInput(data.alternate_greetings),
            depth_prompt_prompt: depthPrompt.prompt || '',
            depth_prompt_depth: String(depthPrompt.depth ?? 4),
            depth_prompt_role: depthPrompt.role || 'system',
            talkativeness: String(extensions.talkativeness ?? character?.talkativeness ?? 0.5),
            favorite: Boolean(extensions.fav ?? character?.fav),
        };
    }

    function characterCreatePayload(form) {
        return {
            ch_name: form.name.trim(),
            description: form.description,
            personality: form.personality,
            scenario: form.scenario,
            first_mes: form.first_mes,
            mes_example: form.mes_example,
            creator_notes: form.creator_notes,
            system_prompt: form.system_prompt,
            post_history_instructions: form.post_history_instructions,
            tags: entryInputToArray(form.tags),
            creator: form.creator,
            character_version: form.character_version,
            world: form.world,
            alternate_greetings: inputToAlternateGreetings(form.alternate_greetings),
            depth_prompt_prompt: form.depth_prompt_prompt,
            depth_prompt_depth: numberInput(form.depth_prompt_depth, 4),
            depth_prompt_role: form.depth_prompt_role || 'system',
            talkativeness: numberInput(form.talkativeness, 0.5),
            fav: form.favorite ? 'true' : 'false',
        };
    }

    function characterMergePayload(avatar, form) {
        const tags = entryInputToArray(form.tags);
        const talkativeness = numberInput(form.talkativeness, 0.5);
        const favorite = !!form.favorite;
        const depthPrompt = {
            prompt: form.depth_prompt_prompt || '',
            depth: numberInput(form.depth_prompt_depth, 4),
            role: form.depth_prompt_role || 'system',
        };

        return {
            avatar,
            name: form.name.trim(),
            description: form.description,
            personality: form.personality,
            scenario: form.scenario,
            first_mes: form.first_mes,
            mes_example: form.mes_example,
            creatorcomment: form.creator_notes,
            talkativeness,
            fav: favorite,
            tags,
            data: {
                name: form.name.trim(),
                description: form.description,
                personality: form.personality,
                scenario: form.scenario,
                first_mes: form.first_mes,
                mes_example: form.mes_example,
                creator_notes: form.creator_notes,
                system_prompt: form.system_prompt,
                post_history_instructions: form.post_history_instructions,
                alternate_greetings: inputToAlternateGreetings(form.alternate_greetings),
                tags,
                creator: form.creator,
                character_version: form.character_version,
                extensions: {
                    world: form.world,
                    talkativeness,
                    fav: favorite,
                    depth_prompt: depthPrompt,
                },
            },
        };
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

    function beginCharacterCreate() {
        state.characterCreating = { active: true, form: defaultCharacterForm() };
        state.characterEditing = { avatar: '', form: {} };
        render();
    }

    function cancelCharacterCreate() {
        state.characterCreating = { active: false, form: defaultCharacterForm() };
        render();
    }

    async function saveCharacterCreate() {
        const form = state.characterCreating.form;
        const payload = characterCreatePayload(form);
        if (!payload.ch_name) {
            throw new Error('角色名称不能为空。');
        }

        const avatar = await apiFetch('/api/characters/create', { body: payload });
        state.characterCreating = { active: false, form: defaultCharacterForm() };
        state.selected.character = avatar;
        state.selected.chat = '';
        await loadData({ silent: true });
        await loadCharacterDetail(avatar, { force: true });
        showToast('角色已创建', avatar);
        render();
    }

    async function beginCharacterEdit(avatar) {
        const character = await loadCharacterDetail(avatar);
        if (!character) {
            return;
        }

        state.characterEditing = { avatar, form: characterToForm(character) };
        state.characterCreating = { active: false, form: defaultCharacterForm() };
        state.characterRenaming = { avatar: '', name: '' };
        state.characterDeleteConfirm = { avatar: '', name: '', deleteChats: false };
        render();
    }

    function cancelCharacterEdit() {
        state.characterEditing = { avatar: '', form: {} };
        render();
    }

    async function saveCharacterEdit() {
        const { avatar, form } = state.characterEditing;
        if (!avatar || state.selected.character !== avatar) {
            throw new Error('编辑目标已变化，请重新选择角色。');
        }
        if (!form.name?.trim()) {
            throw new Error('角色名称不能为空。');
        }

        await apiFetch('/api/characters/merge-attributes', { body: characterMergePayload(avatar, form) });
        state.characterEditing = { avatar: '', form: {} };
        clearCharacterCache(avatar);
        await loadData({ silent: true });
        await loadCharacterDetail(avatar, { force: true });
        showToast('角色卡已保存', form.name.trim());
        render();
    }

    function beginCharacterRename(character) {
        state.characterRenaming = {
            avatar: character.avatar,
            name: character.name || character.data?.name || '',
        };
        state.characterDeleteConfirm = { avatar: '', name: '', deleteChats: false };
        render();
    }

    function cancelCharacterRename() {
        state.characterRenaming = { avatar: '', name: '' };
        render();
    }

    async function confirmCharacterRename() {
        const { avatar, name } = state.characterRenaming;
        const nextName = name.trim();
        if (!avatar || state.selected.character !== avatar) {
            throw new Error('重命名目标已变化，请重新选择角色。');
        }
        if (!nextName) {
            throw new Error('新名称不能为空。');
        }

        const result = await apiFetch('/api/characters/rename', { body: { avatar_url: avatar, new_name: nextName } });
        const nextAvatar = result?.avatar || avatar;
        clearCharacterCache(avatar);
        state.characterRenaming = { avatar: '', name: '' };
        state.characterEditing = { avatar: '', form: {} };
        state.selected.character = nextAvatar;
        state.selected.chat = '';
        await loadData({ silent: true });
        await loadCharacterDetail(nextAvatar, { force: true });
        showToast('角色已重命名', nextAvatar);
        render();
    }

    async function duplicateCharacter(avatar) {
        if (!avatar) {
            return;
        }

        const result = await apiFetch('/api/characters/duplicate', { body: { avatar_url: avatar } });
        const nextAvatar = result?.path || result?.avatar || '';
        if (nextAvatar) {
            state.selected.character = nextAvatar;
            state.selected.chat = '';
        }
        await loadData({ silent: true });
        if (nextAvatar) {
            await loadCharacterDetail(nextAvatar, { force: true });
        }
        showToast('角色已复制', nextAvatar || avatar);
        render();
    }

    function beginCharacterDelete(character) {
        state.characterDeleteConfirm = {
            avatar: character.avatar,
            name: character.name || character.data?.name || character.avatar,
            deleteChats: false,
        };
        state.characterRenaming = { avatar: '', name: '' };
        render();
    }

    function cancelCharacterDelete() {
        state.characterDeleteConfirm = { avatar: '', name: '', deleteChats: false };
        render();
    }

    async function confirmCharacterDelete() {
        const { avatar, deleteChats } = state.characterDeleteConfirm;
        if (!avatar || state.selected.character !== avatar) {
            throw new Error('删除目标已变化，请重新选择角色。');
        }

        await apiFetch('/api/characters/delete', { body: { avatar_url: avatar, delete_chats: deleteChats } });
        clearCharacterCache(avatar);
        state.characterDeleteConfirm = { avatar: '', name: '', deleteChats: false };
        state.characterEditing = { avatar: '', form: {} };
        state.selected.character = '';
        state.selected.chat = '';
        await loadData({ silent: true });
        showToast('角色已删除', avatar);
        render();
    }

    async function exportCharacter(avatar, format) {
        const response = await apiFetchResponse('/api/characters/export', { body: { avatar_url: avatar, format } });
        const blob = await response.blob();
        const baseName = String(avatar || 'character').replace(/\.png$/i, '');
        const fileName = `${baseName}.${format}`;
        downloadFile(blob, fileName);
        showToast('导出已开始', fileName);
    }

    async function importCharacterFile(file) {
        if (!file) {
            return;
        }

        const extension = file.name.split('.').pop()?.toLowerCase() || '';
        const supportedFormats = ['png', 'json', 'yaml', 'yml', 'charx', 'byaf'];
        if (!supportedFormats.includes(extension)) {
            throw new Error('仅支持 png/json/yaml/yml/charx/byaf 角色卡文件。');
        }

        const formData = new FormData();
        formData.set('avatar', file, file.name);
        formData.set('file_type', extension);
        formData.set('preserved_name', file.name);
        const result = await apiFetch('/api/characters/import', { body: formData, omitContentType: true });
        if (result?.error) {
            throw new Error('角色卡导入失败。');
        }

        const avatar = result?.file_name || '';
        if (avatar) {
            state.selected.character = avatar;
            state.selected.chat = '';
        }
        await loadData({ silent: true });
        if (avatar) {
            await loadCharacterDetail(avatar, { force: true });
        }
        showToast('角色已导入', avatar || file.name);
        render();
    }

    async function replaceCharacterAvatar(avatar, file) {
        if (!avatar) {
            throw new Error('请选择要替换头像的角色。');
        }
        if (!file) {
            return;
        }
        if (file.type && !file.type.startsWith('image/')) {
            throw new Error('角色头像只支持图片文件。');
        }

        const formData = new FormData();
        formData.set('avatar', file, file.name || 'avatar.png');
        formData.set('avatar_url', avatar);
        await apiFetch('/api/characters/edit-avatar', { body: formData, omitContentType: true });
        state.avatarCacheBust[avatar] = String(Date.now());
        clearCharacterCache(avatar);
        await loadData({ silent: true });
        await loadCharacterDetail(avatar, { force: true });
        showToast('角色头像已替换', avatar);
        render();
    }

    function updateCharacterFormField(element) {
        const form = element.dataset.characterScope === 'create'
            ? state.characterCreating.form
            : state.characterEditing.form;
        form[element.dataset.characterField] = element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element.value;
    }

    return {
        getCharacterAvatarUrl,
        getCharacterByAvatar,
        getCharacterTags,
        characterToForm,
        beginCharacterCreate,
        cancelCharacterCreate,
        saveCharacterCreate,
        loadCharacterDetail,
        beginCharacterEdit,
        cancelCharacterEdit,
        saveCharacterEdit,
        duplicateCharacter,
        beginCharacterRename,
        cancelCharacterRename,
        confirmCharacterRename,
        exportCharacter,
        beginCharacterDelete,
        cancelCharacterDelete,
        confirmCharacterDelete,
        updateCharacterFormField,
        replaceCharacterAvatar,
        importCharacterFile,
    };
}
