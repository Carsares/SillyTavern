import {
    downloadFile,
} from '../core/utils.js';
import { createCharacterDataHelpers } from './character-data.js';
import { createCharacterDetailActions } from './character-detail.js';

export function createCharacterActions({
    state,
    apiFetch,
    apiFetchResponse,
    loadData,
    render,
    showToast,
}) {
    const {
        characterCreatePayload,
        characterMergePayload,
        characterToForm,
        defaultCharacterForm,
        getCharacterTags,
    } = createCharacterDataHelpers();
    const {
        getCharacterAvatarUrl,
        getCharacterByAvatar,
        loadCharacterDetail,
        clearCharacterCache,
    } = createCharacterDetailActions({
        state,
        apiFetch,
        showToast,
    });

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

    function getCharacterFileName(avatar) {
        return String(avatar || '').replace(/\.[^/.]+$/, '');
    }

    async function migrateCharacterReferences(oldAvatar, newAvatar) {
        if (!oldAvatar || !newAvatar || oldAvatar === newAvatar) {
            return;
        }

        let changed = false;
        const settings = state.settings || {};
        if (settings.tag_map && Object.prototype.hasOwnProperty.call(settings.tag_map, oldAvatar)) {
            settings.tag_map[newAvatar] = settings.tag_map[oldAvatar] || [];
            delete settings.tag_map[oldAvatar];
            changed = true;
        }

        const oldName = getCharacterFileName(oldAvatar);
        const newName = getCharacterFileName(newAvatar);
        const charLore = settings.world_info?.charLore?.find(item => item?.name === oldName);
        if (charLore) {
            charLore.name = newName;
            changed = true;
        }

        const charNote = settings.extension_settings?.note?.chara?.find(item => item?.name === oldName);
        if (charNote) {
            charNote.name = newName;
            changed = true;
        }

        if (settings.active_character === oldAvatar) {
            settings.active_character = newAvatar;
            changed = true;
        }

        if (changed) {
            await apiFetch('/api/settings/save', { body: settings });
        }
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

        const character = state.characters.find(item => item.avatar === avatar) || state.characterDetails[avatar];
        const currentName = (character?.name || character?.data?.name || '').trim();
        if (currentName && nextName === currentName) {
            cancelCharacterRename();
            return;
        }

        const result = await apiFetch('/api/characters/rename', { body: { avatar_url: avatar, new_name: nextName } });
        const nextAvatar = result?.avatar || avatar;
        await migrateCharacterReferences(avatar, nextAvatar);
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
