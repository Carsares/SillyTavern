import {
    downloadFile,
} from '../core/utils.js';
import { saveSettingsSerialized } from '../core/keyed-queue.js';
import { createCharacterDataHelpers } from './character-data.js';
import { createCharacterDetailActions } from './character-detail.js';

export function createCharacterActions({
    state,
    apiFetch,
    apiFetchResponse,
    loadData,
    render,
    showToast,
    reloadCharacter,
}) {
    const {
        characterCreatePayload,
        characterMergePayload,
        characterToForm,
        defaultCharacterForm,
        getCharacterTags,
        isCharacterFormDirty,
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

    function emptyCharacterEditing() {
        return { avatar: '', form: {}, errors: {}, baseline: {} };
    }

    function emptyCharacterCreating() {
        return { active: false, form: defaultCharacterForm(), errors: {} };
    }

    function isCharacterEditDirty(editing = state.characterEditing) {
        return Boolean(editing?.avatar) && isCharacterFormDirty(editing.form, editing.baseline);
    }

    function isCharacterCreateDirty() {
        return Boolean(state.characterCreating.active) && isCharacterFormDirty(state.characterCreating.form, defaultCharacterForm());
    }

    function getCharacterEditDraft(avatar) {
        return (avatar && state.characterEditDrafts[avatar]) || null;
    }

    // 收起当前编辑器：有未保存修改时转存为该角色的草稿，回到该角色时可继续编辑或放弃。
    function closeCharacterEditor() {
        const { avatar, form, baseline } = state.characterEditing;
        if (isCharacterEditDirty()) {
            state.characterEditDrafts[avatar] = { form: { ...form }, baseline: { ...baseline } };
        }
        state.characterEditing = emptyCharacterEditing();
    }

    // 角色重命名后，把打开的编辑器和草稿迁到新文件名；卡片名称同步成新名称，其余未保存修改保持不变。
    function moveCharacterEditState(fromAvatar, toAvatar, nextName) {
        const migrate = entry => {
            const previousName = entry.baseline?.name;
            return {
                form: { ...entry.form, name: entry.form?.name === previousName ? nextName : entry.form?.name },
                baseline: { ...entry.baseline, name: nextName },
            };
        };

        if (state.characterEditing.avatar === fromAvatar) {
            state.characterEditing = isCharacterEditDirty()
                ? { avatar: toAvatar, errors: {}, ...migrate(state.characterEditing) }
                : emptyCharacterEditing();
        }

        const draft = getCharacterEditDraft(fromAvatar);
        if (draft) {
            delete state.characterEditDrafts[fromAvatar];
            state.characterEditDrafts[toAvatar] = migrate(draft);
        }
    }

    function forgetCharacterEditState(avatar) {
        if (state.characterEditing.avatar === avatar) {
            state.characterEditing = emptyCharacterEditing();
        }
        delete state.characterEditDrafts[avatar];
    }

    function beginCharacterCreate() {
        // 已打开的新建表单（含未保存内容）保持原样；未修改的编辑器照旧收起，有修改的编辑器保留。
        if (!state.characterCreating.active) {
            state.characterCreating = { active: true, form: defaultCharacterForm(), errors: {} };
        }
        if (!isCharacterEditDirty()) {
            state.characterEditing = emptyCharacterEditing();
        }
        render();
    }

    function cancelCharacterCreate() {
        state.characterCreating = emptyCharacterCreating();
        render();
    }

    async function saveCharacterCreate() {
        const form = state.characterCreating.form;
        const payload = characterCreatePayload(form);
        if (!payload.ch_name) {
            showCharacterFormError('create', 'name', '请输入角色名称。', '角色创建失败');
            return;
        }

        const avatar = await apiFetch('/api/characters/create', { body: payload });
        state.characterCreating = emptyCharacterCreating();
        state.selected.character = avatar;
        state.selected.chat = '';
        await loadData({ silent: true });
        await loadCharacterDetail(avatar, { force: true });
        showToast('角色已创建', avatar);
        render();
    }

    async function beginCharacterEdit(avatar) {
        if (!avatar) {
            return;
        }
        if (state.characterEditing.avatar === avatar) {
            render();
            return;
        }

        const draft = getCharacterEditDraft(avatar);
        const character = draft ? null : await loadCharacterDetail(avatar);
        if (!draft && !character) {
            return;
        }

        closeCharacterEditor();
        if (draft) {
            // 恢复该角色未保存的草稿，基线仍是开始编辑时的已保存内容。
            state.characterEditing = { avatar, form: { ...draft.form }, errors: {}, baseline: { ...draft.baseline } };
            delete state.characterEditDrafts[avatar];
        } else {
            state.characterEditing = { avatar, form: characterToForm(character), errors: {}, baseline: characterToForm(character) };
        }
        if (!isCharacterCreateDirty()) {
            state.characterCreating = emptyCharacterCreating();
        }
        state.characterRenaming = { avatar: '', name: '' };
        state.characterDeleteConfirm = { avatar: '', name: '', deleteChats: false };
        render();
    }

    function cancelCharacterEdit() {
        const hadChanges = isCharacterEditDirty();
        closeCharacterEditor();
        if (hadChanges) {
            showToast('已收起编辑', '未保存的修改已保留，可在角色详情里继续编辑或放弃。');
        }
        render();
    }

    function discardCharacterEditDraft(avatar) {
        if (!avatar) {
            return;
        }

        forgetCharacterEditState(avatar);
        showToast('已放弃修改', '角色卡保持上次保存的内容。');
        render();
    }

    async function saveCharacterEdit() {
        const { avatar, form } = state.characterEditing;
        if (!avatar || state.selected.character !== avatar) {
            throw new Error('编辑目标已变化，请重新选择角色。');
        }
        if (!form.name?.trim()) {
            showCharacterFormError('edit', 'name', '请输入角色名称。', '角色保存失败');
            return;
        }

        await apiFetch('/api/characters/merge-attributes', { body: characterMergePayload(avatar, form) });
        forgetCharacterEditState(avatar);
        clearCharacterCache(avatar);
        await loadData({ silent: true });
        await loadCharacterDetail(avatar, { force: true });
        showToast('角色卡已保存', form.name.trim());
        // 角色卡已落盘，通知 iframe 生成引擎重载角色列表，使后续生成看到最新角色数据。
        await reloadCharacter();
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
        const charLore = settings.world_info_settings?.world_info?.charLore?.find(item => item?.name === oldName);
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
            await saveSettingsSerialized(apiFetch, settings);
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
        moveCharacterEditState(avatar, nextAvatar, nextName);
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
        forgetCharacterEditState(avatar);
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
        const result = await apiFetch('/api/characters/import', { body: formData, omitContentType: true });
        if (result?.error) {
            throw new Error('角色卡导入失败。');
        }

        const avatar = result?.file_name ? String(result.file_name).replace(/\.png$/i, '') + '.png' : '';
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
        const formState = element.dataset.characterScope === 'create'
            ? state.characterCreating
            : state.characterEditing;
        const field = element.dataset.characterField;
        formState.form[field] = element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element.value;
        if (formState.errors?.[field]) {
            delete formState.errors[field];
        }
    }

    function showCharacterFormError(scope, field, message, title) {
        const formState = scope === 'create' ? state.characterCreating : state.characterEditing;
        formState.errors = { ...(formState.errors || {}), [field]: message };
        showToast(title, message);
        render();
        window.setTimeout(() => {
            /** @type {HTMLElement | null} */ (document.querySelector(`[data-character-field="${field}"][data-character-scope="${scope}"]`))?.focus();
        }, 0);
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
        discardCharacterEditDraft,
        getCharacterEditDraft,
        isCharacterEditDirty,
        isCharacterCreateDirty,
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
