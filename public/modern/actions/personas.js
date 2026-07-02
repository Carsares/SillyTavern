export function createPersonaActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
}) {
    function getPowerUserSettingsForWrite() {
        const source = state.settings.power_user || state.settings;
        source.personas = source.personas || {};
        source.persona_descriptions = source.persona_descriptions || {};
        return source;
    }

    function getPersonas() {
        const powerUser = state.settings.power_user || state.settings;
        const personas = powerUser.personas || {};
        const descriptions = powerUser.persona_descriptions || {};

        return Object.entries(personas).map(([avatarId, name]) => ({
            avatarId,
            name,
            title: descriptions[avatarId]?.title || '',
            description: descriptions[avatarId]?.description || '',
            default: powerUser.default_persona === avatarId,
        }));
    }

    function defaultPersonaForm() {
        return { name: '', title: '', description: '' };
    }

    function beginPersonaCreate() {
        state.personaCreating = { active: true, form: defaultPersonaForm(), file: null };
        state.personaEditing = { avatarId: '', form: {} };
        state.personaDeleteConfirm = { avatarId: '' };
        render();
    }

    function cancelPersonaCreate() {
        state.personaCreating = { active: false, form: defaultPersonaForm(), file: null };
        render();
    }

    async function uploadPersonaAvatarFile(file, overwriteName = '') {
        if (!file) {
            throw new Error('请选择头像图片。');
        }

        const formData = new FormData();
        formData.append('avatar', file, file.name);
        if (overwriteName) {
            formData.append('overwrite_name', overwriteName);
        }

        const result = await apiFetch('/api/avatars/upload', { body: formData, omitContentType: true });
        return result?.path || overwriteName;
    }

    async function savePersonaCreate() {
        const { form, file } = state.personaCreating;
        const name = form.name.trim();
        if (!name) {
            throw new Error('人设名称不能为空。');
        }
        if (!file) {
            throw new Error('请先选择头像图片。');
        }

        const avatarId = await uploadPersonaAvatarFile(file);
        const powerUser = getPowerUserSettingsForWrite();
        powerUser.personas[avatarId] = name;
        powerUser.persona_descriptions[avatarId] = {
            title: form.title || '',
            description: form.description || '',
        };
        if (!powerUser.default_persona) {
            powerUser.default_persona = avatarId;
        }
        await apiFetch('/api/settings/save', { body: state.settings });
        state.personaCreating = { active: false, form: defaultPersonaForm(), file: null };
        await loadData({ silent: true });
        showToast('用户人设已创建', name);
        render();
    }

    function beginPersonaEdit(persona) {
        state.personaEditing = {
            avatarId: persona.avatarId,
            form: {
                name: persona.name || '',
                title: persona.title || '',
                description: persona.description || '',
            },
        };
        state.personaCreating = { active: false, form: defaultPersonaForm(), file: null };
        state.personaDeleteConfirm = { avatarId: '' };
        render();
    }

    function cancelPersonaEdit() {
        state.personaEditing = { avatarId: '', form: {} };
        render();
    }

    async function savePersonaEdit() {
        const { avatarId, form } = state.personaEditing;
        if (!avatarId) {
            throw new Error('请选择要编辑的用户人设。');
        }
        if (!form.name?.trim()) {
            throw new Error('人设名称不能为空。');
        }

        const powerUser = getPowerUserSettingsForWrite();
        powerUser.personas[avatarId] = form.name.trim();
        powerUser.persona_descriptions[avatarId] = {
            ...(powerUser.persona_descriptions[avatarId] || {}),
            title: form.title || '',
            description: form.description || '',
        };
        await apiFetch('/api/settings/save', { body: state.settings });
        state.personaEditing = { avatarId: '', form: {} };
        await loadData({ silent: true });
        showToast('用户人设已保存', form.name.trim());
        render();
    }

    async function setDefaultPersona(avatarId) {
        const powerUser = getPowerUserSettingsForWrite();
        if (!powerUser.personas[avatarId]) {
            throw new Error('用户人设不存在，请刷新后重试。');
        }

        powerUser.default_persona = avatarId;
        await apiFetch('/api/settings/save', { body: state.settings });
        await loadData({ silent: true });
        showToast('默认人设已更新', powerUser.personas[avatarId]);
        render();
    }

    function beginPersonaDelete(avatarId) {
        state.personaDeleteConfirm = { avatarId };
        state.personaEditing = { avatarId: '', form: {} };
        render();
    }

    function cancelPersonaDelete() {
        state.personaDeleteConfirm = { avatarId: '' };
        render();
    }

    async function confirmPersonaDelete() {
        const { avatarId } = state.personaDeleteConfirm;
        if (!avatarId) {
            throw new Error('请选择要删除的用户人设。');
        }

        const powerUser = getPowerUserSettingsForWrite();
        const name = powerUser.personas[avatarId] || avatarId;
        await apiFetch('/api/avatars/delete', { body: { avatar: avatarId } });
        delete powerUser.personas[avatarId];
        delete powerUser.persona_descriptions[avatarId];
        if (powerUser.default_persona === avatarId) {
            powerUser.default_persona = null;
        }
        await apiFetch('/api/settings/save', { body: state.settings });
        state.personaDeleteConfirm = { avatarId: '' };
        state.personaEditing = { avatarId: '', form: {} };
        await loadData({ silent: true });
        showToast('用户人设已删除', name);
        render();
    }

    async function replacePersonaAvatar(avatarId, file) {
        if (!avatarId) {
            throw new Error('请选择要替换头像的用户人设。');
        }
        await uploadPersonaAvatarFile(file, avatarId);
        await loadData({ silent: true });
        showToast('头像已替换', avatarId);
        render();
    }

    function updatePersonaFormField(element) {
        const form = element.dataset.personaScope === 'create' ? state.personaCreating.form : state.personaEditing.form;
        form[element.dataset.personaField] = element.value;
    }

    return {
        getPersonas,
        beginPersonaCreate,
        cancelPersonaCreate,
        savePersonaCreate,
        beginPersonaEdit,
        setDefaultPersona,
        beginPersonaDelete,
        cancelPersonaDelete,
        confirmPersonaDelete,
        cancelPersonaEdit,
        savePersonaEdit,
        updatePersonaFormField,
        replacePersonaAvatar,
    };
}
