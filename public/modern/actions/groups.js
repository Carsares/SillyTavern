import { formatNumber, isValidGroupAvatarUrl, numberInput } from '../core/utils.js';

export function createGroupActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
    ensureAvailableChatMode,
    updateGroupMetadata,
    deleteGroupMetadata,
}) {
    function defaultGroupForm() {
        return {
            name: '',
            avatar_url: '',
            members: [],
            disabled_members: [],
            allow_self_responses: false,
            activation_strategy: '0',
            generation_mode: '0',
            auto_mode_delay: '5',
            fav: false,
        };
    }

    function groupToForm(group) {
        return {
            ...defaultGroupForm(),
            name: group?.name || '',
            avatar_url: group?.avatar_url || '',
            members: Array.isArray(group?.members) ? [...group.members] : [],
            disabled_members: Array.isArray(group?.disabled_members) ? [...group.disabled_members] : [],
            allow_self_responses: !!group?.allow_self_responses,
            activation_strategy: String(group?.activation_strategy ?? 0),
            generation_mode: String(group?.generation_mode ?? 0),
            auto_mode_delay: String(group?.auto_mode_delay ?? 5),
            fav: !!group?.fav,
        };
    }

    function groupFormToPayload(form, previous = {}) {
        const members = Array.isArray(form.members) ? form.members : [];
        const avatarUrl = form.avatar_url.trim();
        const previousAvatarUrl = previous.avatar_url || '';
        const persistentPrevious = { ...previous };
        delete persistentPrevious.date_added;
        delete persistentPrevious.create_date;
        delete persistentPrevious.date_last_chat;
        delete persistentPrevious.chat_size;
        return {
            ...persistentPrevious,
            name: form.name.trim() || `群组 ${formatNumber(state.groups.length + 1)}`,
            avatar_url: avatarUrl ? (isValidGroupAvatarUrl(avatarUrl) ? avatarUrl : '') : (isValidGroupAvatarUrl(previousAvatarUrl) ? previousAvatarUrl : ''),
            members,
            allow_self_responses: !!form.allow_self_responses,
            activation_strategy: numberInput(form.activation_strategy, 0),
            generation_mode: numberInput(form.generation_mode, 0),
            disabled_members: Array.isArray(form.disabled_members) ? form.disabled_members.filter(member => members.includes(member)) : [],
            fav: !!form.fav,
            auto_mode_delay: numberInput(form.auto_mode_delay, 5),
        };
    }

    function clearGroupCache(groupId) {
        if (!groupId) {
            return;
        }

        const contextKey = `group:${groupId}`;
        delete state.chatLists[contextKey];
        Object.keys(state.chatMessages).forEach(key => {
            if (key.startsWith(`${contextKey}::`)) {
                delete state.chatMessages[key];
            }
        });
        Object.keys(state.chatMessageLimits).forEach(key => {
            if (key.startsWith(`${contextKey}::`)) {
                delete state.chatMessageLimits[key];
            }
        });
        Object.keys(state.chatMetadata).forEach(key => {
            if (key.startsWith(`${contextKey}::`)) {
                delete state.chatMetadata[key];
            }
        });
        Object.keys(state.chatDrafts).forEach(key => {
            if (key.startsWith(`${contextKey}::`)) {
                delete state.chatDrafts[key];
            }
        });
    }

    function beginGroupCreate() {
        state.groupCreating = { active: true, form: defaultGroupForm() };
        state.groupEditing = { id: '', form: {} };
        state.groupDeleteConfirm = { id: '', name: '' };
        render();
    }

    function cancelGroupCreate() {
        state.groupCreating = { active: false, form: {} };
        render();
    }

    async function saveGroupCreate() {
        const payload = groupFormToPayload(state.groupCreating.form || defaultGroupForm());
        if (!payload.members.length) {
            throw new Error('群组至少需要一个角色成员。');
        }

        const group = await apiFetch('/api/groups/create', { body: payload });
        state.groupCreating = { active: false, form: {} };
        state.selected.group = group?.id || '';
        state.chatMode = 'group';
        localStorage.setItem('st-modern-chat-mode', 'group');
        state.selected.chat = '';
        await loadData({ silent: true });
        showToast('群组已创建', group?.name || payload.name);
        render();
    }

    function beginGroupEdit(groupId) {
        const group = state.groups.find(item => item.id === groupId);
        if (!group) {
            return;
        }

        state.groupEditing = { id: groupId, form: groupToForm(group) };
        state.groupCreating = { active: false, form: {} };
        state.groupDeleteConfirm = { id: '', name: '' };
        render();
    }

    function cancelGroupEdit() {
        state.groupEditing = { id: '', form: {} };
        render();
    }

    async function saveGroupEdit() {
        const editingState = state.groupEditing;
        const { id, form } = editingState;
        const group = state.groups.find(item => item.id === id);
        if (!id || !group || state.selected.group !== id) {
            throw new Error('编辑目标已变化，请重新选择群组。');
        }
        if (!Array.isArray(form.members) || !form.members.length) {
            throw new Error('群组至少需要一个角色成员。');
        }

        const formSnapshot = structuredClone(form);
        const updatedGroup = await updateGroupMetadata(group, nextMetadata => {
            const payload = groupFormToPayload(formSnapshot, nextMetadata);
            Object.keys(nextMetadata).forEach(key => delete nextMetadata[key]);
            Object.assign(nextMetadata, payload);
        });
        clearGroupCache(id);
        if (state.groupEditing === editingState) {
            state.groupEditing = { id: '', form: {} };
        }
        await loadData({ silent: true });
        showToast('群组已保存', updatedGroup.name);
        render();
    }

    function beginGroupDelete(group) {
        state.groupDeleteConfirm = {
            id: group.id,
            name: group.name || group.id,
        };
        state.groupEditing = { id: '', form: {} };
        render();
    }

    function cancelGroupDelete() {
        state.groupDeleteConfirm = { id: '', name: '' };
        render();
    }

    async function confirmGroupDelete() {
        const deleteConfirm = state.groupDeleteConfirm;
        const { id } = deleteConfirm;
        if (!id || state.selected.group !== id) {
            throw new Error('删除目标已变化，请重新选择群组。');
        }

        await deleteGroupMetadata(id);
        state.groups = state.groups.filter(group => group.id !== id);
        clearGroupCache(id);
        if (state.groupDeleteConfirm === deleteConfirm) {
            state.groupDeleteConfirm = { id: '', name: '' };
        }
        if (state.groupEditing.id === id) {
            state.groupEditing = { id: '', form: {} };
        }
        if (state.selected.group === id) {
            state.selected.group = '';
            state.selected.chat = '';
        }

        let refreshError = null;
        try {
            await loadData({ silent: true });
        } catch (error) {
            refreshError = error;
        }
        // Keep the confirmed deletion reflected even if a partial refresh restored stale group data.
        state.groups = state.groups.filter(group => group.id !== id);
        ensureAvailableChatMode();
        if (refreshError) {
            const message = `群组 ${id} 已删除，但列表刷新失败：${refreshError.message}`;
            state.errors.push({ key: 'group-delete-refresh', message });
            showToast('群组已删除，但列表刷新失败', `${id}：${refreshError.message}`);
            render();
            return;
        }
        showToast('群组已删除', id);
        render();
    }

    function updateGroupFormField(element) {
        const form = element.dataset.groupScope === 'create'
            ? state.groupCreating.form
            : state.groupEditing.form;
        form[element.dataset.groupField] = element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : element.value;
    }

    function toggleGroupFormMember(scope, avatar, checked) {
        const form = scope === 'create' ? state.groupCreating.form : state.groupEditing.form;
        const members = new Set(Array.isArray(form.members) ? form.members : []);
        if (checked) {
            members.add(avatar);
        } else {
            members.delete(avatar);
            // Removing a member also clears its disabled flag, so re-adding it later starts active
            form.disabled_members = (Array.isArray(form.disabled_members) ? form.disabled_members : []).filter(member => member !== avatar);
        }
        form.members = [...members];
        render();
    }

    // Reorders a selected member so the "列表顺序" activation strategy has a user-controllable order
    function moveGroupFormMember(scope, avatar, direction) {
        const form = scope === 'create' ? state.groupCreating.form : state.groupEditing.form;
        const members = Array.isArray(form.members) ? [...form.members] : [];
        const index = members.indexOf(avatar);
        if (index === -1) {
            return;
        }
        const target = direction === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= members.length) {
            return;
        }
        [members[index], members[target]] = [members[target], members[index]];
        form.members = members;
        render();
    }

    // Toggles a member between active and temporarily disabled without removing it from the group
    function toggleGroupFormMemberEnabled(scope, avatar) {
        const form = scope === 'create' ? state.groupCreating.form : state.groupEditing.form;
        const disabled = new Set(Array.isArray(form.disabled_members) ? form.disabled_members : []);
        if (disabled.has(avatar)) {
            disabled.delete(avatar);
        } else {
            disabled.add(avatar);
        }
        form.disabled_members = [...disabled];
        render();
    }

    return {
        defaultGroupForm,
        groupToForm,
        beginGroupCreate,
        cancelGroupCreate,
        saveGroupCreate,
        beginGroupEdit,
        cancelGroupEdit,
        saveGroupEdit,
        beginGroupDelete,
        cancelGroupDelete,
        confirmGroupDelete,
        updateGroupFormField,
        toggleGroupFormMember,
        moveGroupFormMember,
        toggleGroupFormMemberEnabled,
    };
}
