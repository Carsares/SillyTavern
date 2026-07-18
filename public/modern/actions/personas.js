import { saveSettingsSerialized } from '../core/keyed-queue.js';

export function createPersonaActions({
    state,
    apiFetch,
    loadData,
    render,
    showToast,
    reloadSettings,
}) {
    function getPowerUserSettingsForWrite(settings = state.settings) {
        const source = settings.power_user || settings;
        source.personas = source.personas || {};
        source.persona_descriptions = source.persona_descriptions || {};
        return source;
    }

    function removePersonaSettings(settings, avatarId) {
        const powerUser = getPowerUserSettingsForWrite(settings);
        delete powerUser.personas[avatarId];
        delete powerUser.persona_descriptions[avatarId];
        if (powerUser.default_persona === avatarId) {
            powerUser.default_persona = null;
        }
    }

    function getPersonas() {
        const powerUser = state.settings.power_user || state.settings;
        const personas = powerUser.personas || {};
        const descriptions = powerUser.persona_descriptions || {};

        return Object.entries(personas).map(([avatarId, name]) => {
            const descriptor = descriptions[avatarId] || {};
            return {
                avatarId,
                name,
                title: descriptor.title || '',
                description: descriptor.description || '',
                // Advanced descriptor fields that the legacy UI exposed and the engine still consumes
                position: descriptor.position ?? 0,
                depth: descriptor.depth ?? 2,
                role: descriptor.role ?? 0,
                lorebook: descriptor.lorebook || '',
                connections: Array.isArray(descriptor.connections) ? descriptor.connections : [],
                default: powerUser.default_persona === avatarId,
            };
        });
    }

    function defaultPersonaForm() {
        return { name: '', title: '', description: '', position: 0, depth: 2, role: 0, lorebook: '' };
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
            position: Number.isFinite(form.position) ? form.position : 0,
            depth: Number.isFinite(form.depth) ? form.depth : 2,
            role: Number.isFinite(form.role) ? form.role : 0,
            lorebook: form.lorebook || '',
        };
        if (!powerUser.default_persona) {
            powerUser.default_persona = avatarId;
        }
        await saveSettingsSerialized(apiFetch, state.settings);
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
                position: persona.position ?? 0,
                depth: persona.depth ?? 2,
                role: persona.role ?? 0,
                lorebook: persona.lorebook || '',
                // Kept for read-only display; editing connections stays on the character/group pages
                connections: Array.isArray(persona.connections) ? persona.connections : [],
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
            position: Number.isFinite(form.position) ? form.position : 0,
            depth: Number.isFinite(form.depth) ? form.depth : 2,
            role: Number.isFinite(form.role) ? form.role : 0,
            lorebook: form.lorebook || '',
        };
        await saveSettingsSerialized(apiFetch, state.settings);
        state.personaEditing = { avatarId: '', form: {} };
        await loadData({ silent: true });
        showToast('用户人设已保存', form.name.trim());
        // 人设已落盘，通知 iframe 生成引擎重载生成相关配置，使下次生成生效。
        await reloadSettings();
        render();
    }

    async function setDefaultPersona(avatarId) {
        const powerUser = getPowerUserSettingsForWrite();
        if (!powerUser.personas[avatarId]) {
            throw new Error('用户人设不存在，请刷新后重试。');
        }

        powerUser.default_persona = avatarId;
        await saveSettingsSerialized(apiFetch, state.settings);
        await loadData({ silent: true });
        showToast('默认人设已更新', powerUser.personas[avatarId]);
        // 默认人设已落盘，通知 iframe 生成引擎重载生成相关配置，使下次生成生效。
        await reloadSettings();
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

        const powerUser = state.settings.power_user || state.settings;
        const name = powerUser.personas?.[avatarId] || avatarId;

        // Commit the reference removal before deleting the avatar so a failed settings save cannot leave a broken persona.
        const nextSettings = structuredClone(state.settings);
        removePersonaSettings(nextSettings, avatarId);
        await saveSettingsSerialized(apiFetch, nextSettings);
        removePersonaSettings(state.settings, avatarId);

        try {
            await apiFetch('/api/avatars/delete', { body: { avatar: avatarId } });
        } catch (error) {
            // A retry after an uncertain response is complete when the avatar is already gone.
            if (error?.status !== 404) {
                throw error;
            }
        }
        delete state.avatarCacheBust[avatarId];
        state.personaDeleteConfirm = { avatarId: '' };
        state.personaEditing = { avatarId: '', form: {} };
        await loadData({ silent: true });
        showToast('用户人设已删除', name);
        // 人设删除已落盘，通知 iframe 生成引擎重载生成相关配置，使下次生成生效。
        await reloadSettings();
        render();
    }

    async function replacePersonaAvatar(avatarId, file) {
        if (!avatarId) {
            throw new Error('请选择要替换头像的用户人设。');
        }
        await uploadPersonaAvatarFile(file, avatarId);
        state.avatarCacheBust[avatarId] = String(Date.now());
        await loadData({ silent: true });
        showToast('头像已替换', avatarId);
        render();
    }

    function updatePersonaFormField(element) {
        const form = element.dataset.personaScope === 'create' ? state.personaCreating.form : state.personaEditing.form;
        const field = element.dataset.personaField;
        // position/depth/role persist as numbers to match the persona descriptor model
        const numericFields = new Set(['position', 'depth', 'role']);
        form[field] = numericFields.has(field) ? Number(element.value) : element.value;
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
