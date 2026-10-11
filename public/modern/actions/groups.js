import { formatNumber, isValidGroupAvatarUrl, numberInput } from '../core/utils.js';

const groupMembersRequiredMessage = '请至少选择一个角色成员。';

// 与聊天页新建会话（createModernChatId）使用同一命名格式，新群组的首个会话在列表里和后续会话一致。
function createInitialGroupChatId() {
    return `Modern ${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

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
        const persistentPrevious = /** @type {Record<string, any>} */ ({ ...previous });
        delete persistentPrevious.date_added;
        delete persistentPrevious.create_date;
        delete persistentPrevious.date_last_chat;
        delete persistentPrevious.chat_size;
        delete persistentPrevious.chat_count;
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

    function getGroupFormState(scope) {
        return scope === 'create' ? state.groupCreating : state.groupEditing;
    }

    // 与角色表单一致：在成员选择区下方显示错误，同时弹出提示并把焦点移到第一个成员复选框。
    function showGroupFormError(scope, field, message, title) {
        const formState = getGroupFormState(scope);
        formState.errors = { ...(formState.errors || {}), [field]: message };
        showToast(title, message);
        render();
        window.setTimeout(() => {
            /** @type {HTMLElement | null} */ (document.querySelector(`[data-group-member][data-group-scope="${scope}"], [data-group-focus="${scope}-${field}"]`))?.focus();
        }, 0);
    }

    function beginGroupCreate() {
        state.groupCreating = { active: true, form: defaultGroupForm(), errors: {} };
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
            showGroupFormError('create', 'members', groupMembersRequiredMessage, '群组创建失败');
            return;
        }

        // 先写出首个会话文件，再把它登记进群组：群组登记的会话都有对应文件，首次打开聊天直接进入这个会话，
        // 不会再另建一个会话而留下一个没有文件的登记。
        const chatId = createInitialGroupChatId();
        await apiFetch('/api/chats/group/save', {
            body: {
                id: chatId,
                chat: [{ chat_metadata: {}, user_name: 'unused', character_name: 'unused' }],
            },
        });
        let group;
        try {
            group = await apiFetch('/api/groups/create', { body: { ...payload, chat_id: chatId, chats: [chatId] } });
        } catch (error) {
            // 群组没建成时删掉刚写出的空会话文件；清理失败只会留下一个未登记的空文件，不影响重试。
            await apiFetch('/api/chats/group/delete', { body: { id: chatId } }).catch(() => {});
            throw error;
        }
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

        state.groupEditing = { id: groupId, form: groupToForm(group), errors: {} };
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
            showGroupFormError('edit', 'members', groupMembersRequiredMessage, '群组保存失败');
            return;
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
        // 提示里用群组名称，不显示内部 ID。
        const groupName = deleteConfirm.name || state.groups.find(group => group.id === id)?.name || id;

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
        showToast('群组已删除', groupName);
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
        const formState = getGroupFormState(scope);
        if (form.members.length && formState.errors?.members) {
            delete formState.errors.members;
        }
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
