// 作者注释（Author's Note）：聊天头 chat_metadata 里的 note_* 字段，加上 extension_settings.note 里的角色注释和默认值。
// 旧版对照：public/scripts/authors-note.js。
//   - 键：note_prompt / note_interval / note_depth / note_position / note_role（metadata_keys）；
//   - 未设置的键在引擎打开聊天时（CHAT_CHANGED → loadSettings）取 extension_settings.note.default* 补上，
//     引擎没有常量时依次取 位置 1、深度 4、频率 1、角色 0；
//   - 插入规则（setFloatingPrompt）：频率 1 每次都插入，频率 0 关闭，其余在「用户消息数是频率的整数倍」的那次生成里插入；
//   - 位置：2 = 主提示前，0 = 主提示后，1 = 聊天内按深度（深度和角色只在这个位置生效）；角色 0 系统 / 1 用户 / 2 助手；
//   - 角色注释存在 extension_settings.note.chara[{ name: 头像文件名去掉扩展名, prompt, useChara, position }]，
//     位置 0 替换作者注释 / 1 放在它前面 / 2 放在它后面；群聊里不能编辑，生成时发言角色的角色注释照常生效。
// Modern 是唯一的写入方：聊天级字段走 updateModernChatMetadata（保存后等待引擎重开聊天），
// 角色注释和默认值走 /api/settings/save，再 reloadSettings（引擎侧的白名单会同步 note）。
import { describeReloadFailure, noEngineSync } from '../core/bridge-reload.js';
import { saveSettingsSerialized } from '../core/keyed-queue.js';

export const AUTHORS_NOTE_METADATA_KEYS = Object.freeze({
    prompt: 'note_prompt',
    interval: 'note_interval',
    position: 'note_position',
    depth: 'note_depth',
    role: 'note_role',
});

export const AUTHORS_NOTE_POSITIONS = Object.freeze([
    { value: 2, label: '主提示前' },
    { value: 0, label: '主提示后' },
    { value: 1, label: '聊天内按深度' },
]);

export const AUTHORS_NOTE_ROLES = Object.freeze([
    { value: 0, label: '系统' },
    { value: 1, label: '用户' },
    { value: 2, label: '助手' },
]);

export const CHARACTER_NOTE_POSITIONS = Object.freeze([
    { value: 0, label: '替换作者注释' },
    { value: 1, label: '放在作者注释前面' },
    { value: 2, label: '放在作者注释后面' },
]);

export const AUTHORS_NOTE_SECTIONS = Object.freeze([
    { id: 'chat', label: '本聊天' },
    { id: 'chara', label: '角色注释' },
    { id: 'default', label: '默认值' },
]);

const FIELDS = Object.freeze(['prompt', 'interval', 'position', 'depth', 'role']);
// 旧版 authors-note.js 的 loadSettings 在 extension_settings.note 没有对应默认值时使用的常量
const LEGACY_DEFAULTS = Object.freeze({ position: 1, depth: 4, interval: 1, role: 0 });
const MAX_NUMBER = 9999;
const CHARACTER_POSITION_VALUES = CHARACTER_NOTE_POSITIONS.map(item => item.value);
const NOTE_POSITION_VALUES = AUTHORS_NOTE_POSITIONS.map(item => item.value);
const NOTE_ROLE_VALUES = AUTHORS_NOTE_ROLES.map(item => item.value);

function toNumberOr(value, fallback) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

/**
 * 全局默认值：新聊天（以及聊天头里还没有对应键的聊天）用的作者注释设置。
 * @param {object} [settings] state.settings
 * @returns {{ prompt: string, interval: number, position: number, depth: number, role: number }} 默认值
 */
export function getAuthorsNoteDefaults(settings) {
    const note = settings?.extension_settings?.note;
    return {
        prompt: typeof note?.default === 'string' ? note.default : '',
        interval: toNumberOr(note?.defaultInterval, LEGACY_DEFAULTS.interval),
        position: toNumberOr(note?.defaultPosition, LEGACY_DEFAULTS.position),
        depth: toNumberOr(note?.defaultDepth, LEGACY_DEFAULTS.depth),
        role: toNumberOr(note?.defaultRole, LEGACY_DEFAULTS.role),
    };
}

/**
 * 聊天头里的作者注释当前取值：没有设置的键（缺失或为 null，与旧版 `??` 一致）取默认值，并记在 isDefault 里。
 * @param {object | undefined} metadata chat_metadata
 * @param {ReturnType<typeof getAuthorsNoteDefaults>} defaults 默认值
 * @returns {{ values: ReturnType<typeof getAuthorsNoteDefaults>, isDefault: Record<string, boolean> }} 生效的值和每项是否来自默认值
 */
export function resolveAuthorsNoteValues(metadata, defaults) {
    const values = { ...defaults };
    /** @type {Record<string, boolean>} */
    const isDefault = {};
    for (const field of FIELDS) {
        const raw = metadata?.[AUTHORS_NOTE_METADATA_KEYS[field]];
        if (field === 'prompt') {
            isDefault.prompt = raw === undefined || raw === null;
            values.prompt = isDefault.prompt ? defaults.prompt : String(raw);
            continue;
        }

        const number = raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
        isDefault[field] = !Number.isFinite(number);
        values[field] = isDefault[field] ? defaults[field] : number;
    }
    return { values, isDefault };
}

/**
 * 表单草稿一律用字符串（输入框的值）。
 * @param {ReturnType<typeof getAuthorsNoteDefaults>} values 取值
 * @returns {Record<string, string>} 草稿
 */
export function toAuthorsNoteDraft(values) {
    return {
        prompt: values.prompt,
        interval: String(values.interval),
        position: String(values.position),
        depth: String(values.depth),
        role: String(values.role),
    };
}

function parseBoundedInteger(text) {
    const trimmed = String(text ?? '').trim();
    if (!/^\d+$/.test(trimmed)) {
        return null;
    }
    const number = Number(trimmed);
    return number <= MAX_NUMBER ? number : null;
}

function parseChoice(text, allowed) {
    const trimmed = String(text ?? '').trim();
    if (!/^\d+$/.test(trimmed)) {
        return null;
    }
    const number = Number(trimmed);
    return allowed.includes(number) ? number : null;
}

/**
 * 校验聊天作者注释草稿（本聊天和默认值两处共用）。深度和角色只在「聊天内按深度」时生效，位置不是它时
 * 草稿里的非法值不阻塞保存，沿用 fallback 里的旧值。
 * @param {Record<string, string>} draft 草稿
 * @param {ReturnType<typeof getAuthorsNoteDefaults>} fallback 位置不是「聊天内」时深度 / 角色沿用的值
 * @returns {{ ok: boolean, values: ReturnType<typeof getAuthorsNoteDefaults>, errors: Record<string, string> }} 校验结果
 */
export function parseAuthorsNoteDraft(draft, fallback) {
    /** @type {Record<string, string>} */
    const errors = {};
    const interval = parseBoundedInteger(draft.interval);
    if (interval === null) {
        errors.interval = `插入频率需要是 0 到 ${MAX_NUMBER} 的整数。`;
    }

    const position = parseChoice(draft.position, NOTE_POSITION_VALUES);
    if (position === null) {
        errors.position = '请选择插入位置。';
    }

    const inChat = position === 1;
    let depth = parseBoundedInteger(draft.depth);
    if (depth === null) {
        if (inChat) {
            errors.depth = `深度需要是 0 到 ${MAX_NUMBER} 的整数。`;
        } else {
            depth = fallback.depth;
        }
    }
    let role = parseChoice(draft.role, NOTE_ROLE_VALUES);
    if (role === null) {
        if (inChat) {
            errors.role = '请选择角色。';
        } else {
            role = fallback.role;
        }
    }

    return {
        ok: Object.keys(errors).length === 0,
        values: { prompt: String(draft.prompt ?? ''), interval, position, depth, role },
        errors,
    };
}

/**
 * 保存时真正要写进聊天头的键：只写和读取时不同的项。没改的项保持原样，包括「还没设置、跟随默认值」的项，
 * 这样之后改全局默认值，没有单独设置过的聊天仍会跟着变。
 * @param {ReturnType<typeof getAuthorsNoteDefaults>} values 校验后的新取值
 * @param {ReturnType<typeof getAuthorsNoteDefaults>} baseline 读取时的取值
 * @returns {Record<string, string | number>} 字段名 → 新值
 */
export function buildAuthorsNotePatch(values, baseline) {
    /** @type {Record<string, string | number>} */
    const patch = {};
    for (const field of FIELDS) {
        if (values[field] !== baseline[field]) {
            patch[field] = values[field];
        }
    }
    return patch;
}

/**
 * 聊天里的用户消息数（旧版 setFloatingPrompt 数 is_user 的消息，含被隐藏的）。
 * @param {object[]} [messages] 聊天消息
 * @returns {number} 用户消息数
 */
export function countUserMessages(messages) {
    return Array.isArray(messages) ? messages.filter(message => message?.is_user).length : 0;
}

/**
 * 按旧版插入规则说明下一次什么时候插入。生成时用户刚发的那条已经计入用户消息数，所以「还有 N 条用户消息才插入」
 * 的 N 包含触发那一条：N = 频率 − (已有用户消息数 % 频率)，整除时为一整个频率。
 * 旧版界面上的数字在已有消息数超过频率后显示的是「距上次插入过了几条」，不是剩余条数，这里按真实剩余条数显示。
 * @param {number} interval 插入频率
 * @param {number} userMessageCount 聊天里已有的用户消息数
 * @returns {{ kind: 'disabled' | 'always' | 'pending', remaining: number, text: string, detail: string }} 说明
 */
export function describeAuthorsNoteSchedule(interval, userMessageCount) {
    if (!Number.isInteger(interval) || interval <= 0) {
        return { kind: 'disabled', remaining: 0, text: '插入频率为 0，作者注释已关闭。', detail: '' };
    }
    if (interval === 1) {
        return { kind: 'always', remaining: 0, text: '每次生成都会插入。', detail: '' };
    }

    const remaining = interval - (userMessageCount % interval);
    return {
        kind: 'pending',
        remaining,
        text: `还有 ${remaining} 条用户消息才插入。`,
        detail: `这个聊天已有 ${userMessageCount} 条用户消息，发出新的第 ${remaining} 条时会带上作者注释。`,
    };
}

function isDraftDirty(draft, baselineDraft) {
    return Object.keys(baselineDraft).some(key => String(draft[key] ?? '') !== baselineDraft[key]);
}

function createSection(key, baseline, baselineDraft) {
    return {
        key,
        baseline,
        baselineDraft,
        draft: { ...baselineDraft },
        errors: {},
        saving: false,
        error: '',
        notice: '',
        warning: '',
    };
}

function characterNoteKey(character) {
    return String(character?.avatar || '').replace(/\.[^/.]+$/, '');
}

function describeSyncFailure(results) {
    const failed = results.filter(result => result && result.ok === false);
    return failed.length ? describeReloadFailure(failed[0]) : '';
}

/**
 * @param {object} deps 依赖
 * @param {any} deps.state 全局界面状态
 * @param {Function} deps.apiFetch 带 CSRF 的 JSON 请求
 * @param {Function} deps.render 重新渲染当前路由
 * @param {Function} deps.showToast 弹出提示
 * @param {any} [deps.bridgeReload] 引擎同步函数（reloadSettings / reloadChat）
 * @param {Record<string, any>} deps.actionRegistry 聊天动作注册表
 * @returns {Record<string, Function>} 作者注释的业务动作
 */
export function createChatAuthorsNoteActions({ state, apiFetch, render, showToast, bridgeReload = {}, actionRegistry }) {
    const reloadSettings = bridgeReload.reloadSettings ?? noEngineSync;
    const reloadChat = bridgeReload.reloadChat ?? noEngineSync;

    function store() {
        const slot = state.chatAuthorsNote;
        if (!slot.section) {
            slot.section = 'chat';
        }
        return slot;
    }

    function ensureNoteSettings() {
        if (!state.settings || typeof state.settings !== 'object') {
            state.settings = {};
        }
        if (!state.settings.extension_settings || typeof state.settings.extension_settings !== 'object') {
            state.settings.extension_settings = {};
        }
        if (!state.settings.extension_settings.note || typeof state.settings.extension_settings.note !== 'object') {
            state.settings.extension_settings.note = { default: '', chara: [], wiAddition: [] };
        }
        return state.settings.extension_settings.note;
    }

    function getChatTarget() {
        const entity = actionRegistry.getSelectedChatEntity();
        const groupMode = actionRegistry.isGroupChatMode();
        const chatId = state.selected.chat;
        const contextKey = actionRegistry.getChatContextKey(entity, groupMode);
        if (!entity || !contextKey || !chatId) {
            return null;
        }

        const cacheKey = actionRegistry.chatContextActions.getChatCacheKey(contextKey, chatId);
        return {
            entity,
            groupMode,
            chatId,
            cacheKey,
            metadata: state.chatMetadata[cacheKey],
            messages: state.chatMessages[cacheKey],
        };
    }

    // 干净的草稿（没有未保存修改）始终跟着当前数据走，有修改的草稿保持不动；换了聊天就换一份草稿
    function refreshSection(name, key, baseline, baselineDraft) {
        let section = store()[name];
        if (!section || section.key !== key) {
            section = createSection(key, baseline, baselineDraft);
            store()[name] = section;
        } else if (!section.saving) {
            const dirty = isDraftDirty(section.draft, section.baselineDraft);
            section.baseline = baseline;
            section.baselineDraft = baselineDraft;
            if (!dirty) {
                section.draft = { ...baselineDraft };
            }
        }
        return section;
    }

    function ensureChatSection() {
        const target = getChatTarget();
        if (!target || !target.metadata || !target.messages) {
            return { target, section: null };
        }

        const baseline = resolveAuthorsNoteValues(target.metadata, getAuthorsNoteDefaults(state.settings));
        const section = refreshSection('chat', target.cacheKey, baseline, toAuthorsNoteDraft(baseline.values));
        return { target, section };
    }

    function readCharacterNote(avatarKey) {
        const list = ensureNoteSettings().chara;
        return Array.isArray(list) ? list.find(entry => entry?.name === avatarKey) : undefined;
    }

    function getCharacterTarget() {
        if (actionRegistry.isGroupChatMode()) {
            return { groupMode: true, character: null, avatarKey: '' };
        }
        const character = actionRegistry.getSelectedChatEntity();
        const avatarKey = characterNoteKey(character);
        return { groupMode: false, character: avatarKey ? character : null, avatarKey };
    }

    function ensureCharacterSection() {
        const target = getCharacterTarget();
        if (!target.character) {
            return { target, section: null };
        }

        const entry = readCharacterNote(target.avatarKey);
        const values = {
            prompt: typeof entry?.prompt === 'string' ? entry.prompt : '',
            useChara: !!entry?.useChara,
            position: toNumberOr(entry?.position, 0),
        };
        const baselineDraft = { prompt: values.prompt, useChara: values.useChara ? '1' : '', position: String(values.position) };
        const section = refreshSection('chara', target.avatarKey, { values, isDefault: {} }, baselineDraft);
        return { target, section };
    }

    function ensureDefaultsSection() {
        const values = { ...getAuthorsNoteDefaults(state.settings), allowWIScan: !!state.settings?.extension_settings?.note?.allowWIScan };
        const baselineDraft = { ...toAuthorsNoteDraft(values), allowWIScan: values.allowWIScan ? '1' : '' };
        const section = refreshSection('defaults', 'default', { values, isDefault: {} }, baselineDraft);
        return { target: null, section };
    }

    function ensureSection(scope) {
        if (scope === 'chara') {
            return ensureCharacterSection();
        }
        return scope === 'default' ? ensureDefaultsSection() : ensureChatSection();
    }

    function getFeedback(section) {
        return {
            errors: section.errors,
            saving: section.saving,
            error: section.error,
            notice: section.notice,
            warning: section.warning,
        };
    }

    /**
     * 面板渲染和 DOM 同步用的视图：草稿、是否有未保存修改、每项是否显示「默认」、校验错误、反馈信息。
     * 调用会顺带把干净的草稿对齐到最新数据。
     * @param {'chat' | 'chara' | 'default'} [scope] 范围，默认当前打开的分区
     * @returns {Record<string, any>} 视图；数据还没读到时 ready 为 false 并带 reason
     */
    function getAuthorsNoteView(scope = store().section) {
        const generating = !!state.engine.generating;
        if (scope === 'chara') {
            const { target, section } = ensureCharacterSection();
            if (target.groupMode) {
                return { scope, ready: false, reason: '群聊里不能编辑角色注释。请先切换到该角色的单人聊天再编辑；群聊生成时，发言角色已保存的角色注释仍会照常生效。' };
            }
            if (!section) {
                return { scope, ready: false, reason: '请先选择一个角色。' };
            }
            return {
                scope,
                ready: true,
                generating,
                characterName: actionRegistry.chatContextActions.getCharacterName(target.character),
                draft: section.draft,
                dirty: isDraftDirty(section.draft, section.baselineDraft),
                useChara: section.draft.useChara === '1',
                ...getFeedback(section),
            };
        }

        if (scope === 'default') {
            const { section } = ensureDefaultsSection();
            return {
                scope,
                ready: true,
                generating,
                draft: section.draft,
                dirty: isDraftDirty(section.draft, section.baselineDraft),
                ...getFeedback(section),
            };
        }

        const { target, section } = ensureChatSection();
        if (!section) {
            return { scope: 'chat', ready: false, reason: target ? '聊天记录读取中，稍后再试。' : '请先选择一个聊天。' };
        }

        const draftInterval = parseBoundedInteger(section.draft.interval);
        const userMessageCount = countUserMessages(target.messages);
        const chips = {};
        for (const field of FIELDS) {
            chips[field] = !!section.baseline.isDefault[field] && String(section.draft[field] ?? '') === section.baselineDraft[field];
        }
        return {
            scope: 'chat',
            ready: true,
            generating,
            groupMode: target.groupMode,
            draft: section.draft,
            dirty: isDraftDirty(section.draft, section.baselineDraft),
            chips,
            schedule: draftInterval === null
                ? { kind: 'invalid', remaining: 0, text: '插入频率填入有效数字后显示下次插入时间。', detail: '' }
                : describeAuthorsNoteSchedule(draftInterval, userMessageCount),
            inChat: section.draft.position === '1',
            ...getFeedback(section),
        };
    }

    function setAuthorsNoteSection(scope) {
        if (AUTHORS_NOTE_SECTIONS.some(item => item.id === scope)) {
            store().section = scope;
            render();
        }
    }

    /**
     * 记下输入框的新值；不重新渲染（重渲染会让输入框失去焦点），界面上的联动由事件文件按返回的视图就地更新。
     * @param {'chat' | 'chara' | 'default'} scope 范围
     * @param {string} field 字段名
     * @param {string} value 新值（复选框用 '1' / ''）
     * @returns {Record<string, any>} 更新后的视图
     */
    function updateAuthorsNoteDraft(scope, field, value) {
        const { section } = ensureSection(scope);
        if (section && Object.hasOwn(section.baselineDraft, field)) {
            section.draft[field] = String(value ?? '');
            delete section.errors[field];
            section.notice = '';
        }
        return getAuthorsNoteView(scope);
    }

    function resetAuthorsNoteDraft(scope) {
        const { section } = ensureSection(scope);
        if (!section || section.saving) {
            return;
        }
        section.draft = { ...section.baselineDraft };
        section.errors = {};
        section.error = '';
        section.notice = '';
        section.warning = '';
        render();
    }

    // 保存前的共同检查：数据已读到、不在保存中、不在生成中。返回 false 时已经把原因写进 section.error
    function canStartSave(section) {
        if (!section || section.saving) {
            return false;
        }
        section.error = '';
        section.notice = '';
        section.warning = '';
        if (state.engine.generating) {
            section.error = '生成中不能保存作者注释，请等生成结束后再保存。';
            render();
            return false;
        }
        return true;
    }

    async function saveAuthorsNoteChat() {
        const { target, section } = ensureChatSection();
        if (!canStartSave(section)) {
            return;
        }

        const parsed = parseAuthorsNoteDraft(section.draft, section.baseline.values);
        section.errors = parsed.errors;
        if (!parsed.ok) {
            render();
            return;
        }

        const patch = buildAuthorsNotePatch(parsed.values, section.baseline.values);
        section.saving = true;
        render();
        try {
            const { reload } = await actionRegistry.updateModernChatMetadata(target.entity, target.chatId, metadata => {
                for (const [field, value] of Object.entries(patch)) {
                    metadata[AUTHORS_NOTE_METADATA_KEYS[field]] = value;
                }
            }, { groupMode: target.groupMode });

            // 保存成功后草稿对齐到文件里的值（含服务端新签发的 integrity 之外的全部 note_*）
            const saved = resolveAuthorsNoteValues(state.chatMetadata[target.cacheKey], getAuthorsNoteDefaults(state.settings));
            section.baseline = saved;
            section.baselineDraft = toAuthorsNoteDraft(saved.values);
            section.draft = { ...section.baselineDraft };
            section.errors = {};
            if (reload.ok === false) {
                section.warning = `作者注释已保存到聊天文件，但生成引擎没有同步成功：${reload.error || '未知原因'}。下一次生成可能仍用旧的作者注释，可以再点一次「保存」重试同步，或刷新页面。`;
                showToast('作者注释已保存', `生成引擎未同步：${reload.error || '未知原因'}`);
            } else {
                section.notice = '已保存，生成引擎已同步，下一次生成使用新的作者注释。';
                showToast('作者注释已保存', '生成引擎已同步。');
            }
        } catch (error) {
            section.error = `保存失败：${error.message}`;
        } finally {
            section.saving = false;
            render();
        }
    }

    // 把改过的 extension_settings.note 写盘并通知引擎；失败时恢复内存里的旧值。返回引擎同步结果
    async function persistNoteSettings(note, snapshot, extraSync = null) {
        try {
            await saveSettingsSerialized(/** @type {any} */ (apiFetch), state.settings);
        } catch (error) {
            for (const key of Object.keys(note)) {
                if (!Object.hasOwn(snapshot, key)) {
                    delete note[key];
                }
            }
            Object.assign(note, snapshot);
            throw error;
        }

        const results = [await reloadSettings()];
        if (extraSync) {
            results.push(await extraSync());
        }
        return results;
    }

    async function saveAuthorsNoteCharacter() {
        const { target, section } = ensureCharacterSection();
        if (!canStartSave(section)) {
            return;
        }

        const useChara = section.draft.useChara === '1';
        const position = parseChoice(section.draft.position, CHARACTER_POSITION_VALUES);
        const prompt = String(section.draft.prompt ?? '');
        const errors = {};
        if (position === null) {
            errors.position = '请选择角色注释的位置。';
        }
        if (useChara && !prompt.trim()) {
            errors.prompt = '勾选「使用角色注释」时需要填写内容。';
        }
        section.errors = errors;
        if (Object.keys(errors).length) {
            render();
            return;
        }

        const note = ensureNoteSettings();
        const snapshot = structuredClone(note);
        const list = Array.isArray(note.chara) ? note.chara.map(entry => ({ ...entry })) : [];
        const index = list.findIndex(entry => entry?.name === target.avatarKey);
        if (!prompt.trim() && !useChara) {
            // 与旧版一致：内容清空且没有勾选使用时，直接移除这个角色的注释
            if (index >= 0) {
                list.splice(index, 1);
            }
        } else if (index >= 0) {
            list[index] = { ...list[index], name: target.avatarKey, prompt, useChara, position };
        } else {
            list.push({ name: target.avatarKey, prompt, useChara, position });
        }
        note.chara = list;

        section.saving = true;
        render();
        try {
            const results = await persistNoteSettings(note, snapshot);
            const saved = readCharacterNote(target.avatarKey);
            const baselineDraft = {
                prompt: typeof saved?.prompt === 'string' ? saved.prompt : '',
                useChara: saved?.useChara ? '1' : '',
                position: String(toNumberOr(saved?.position, 0)),
            };
            section.baselineDraft = baselineDraft;
            section.draft = { ...baselineDraft };
            const failure = describeSyncFailure(results);
            if (failure) {
                section.warning = `角色注释已保存${failure}`;
                showToast('角色注释已保存', failure);
            } else {
                section.notice = '角色注释已保存，下一次生成起生效。';
                showToast('角色注释已保存', `${actionRegistry.chatContextActions.getCharacterName(target.character)}`);
            }
        } catch (error) {
            section.error = `保存失败：${error.message}`;
        } finally {
            section.saving = false;
            render();
        }
    }

    async function saveAuthorsNoteDefaults() {
        const { section } = ensureDefaultsSection();
        if (!canStartSave(section)) {
            return;
        }

        const parsed = parseAuthorsNoteDraft(section.draft, section.baseline.values);
        section.errors = parsed.errors;
        if (!parsed.ok) {
            render();
            return;
        }

        const note = ensureNoteSettings();
        const snapshot = structuredClone(note);
        Object.assign(note, {
            default: parsed.values.prompt,
            defaultInterval: parsed.values.interval,
            defaultPosition: parsed.values.position,
            defaultDepth: parsed.values.depth,
            defaultRole: parsed.values.role,
            allowWIScan: section.draft.allowWIScan === '1',
        });

        // 引擎只在打开聊天（CHAT_CHANGED）时把默认值补进聊天头里没有的键：保存默认值后要让它重新打开当前聊天
        const chatTarget = getChatTarget();
        const syncCurrentChat = chatTarget
            ? () => reloadChat(chatTarget.groupMode ? { groupId: chatTarget.entity.id, chat: chatTarget.chatId } : { avatar: chatTarget.entity.avatar, chat: chatTarget.chatId })
            : null;

        section.saving = true;
        render();
        try {
            const results = await persistNoteSettings(note, snapshot, syncCurrentChat);
            const baseline = { ...getAuthorsNoteDefaults(state.settings), allowWIScan: !!note.allowWIScan };
            section.baseline = { values: baseline, isDefault: {} };
            section.baselineDraft = { ...toAuthorsNoteDraft(baseline), allowWIScan: baseline.allowWIScan ? '1' : '' };
            section.draft = { ...section.baselineDraft };
            const failure = describeSyncFailure(results);
            if (failure) {
                section.warning = `默认值已保存${failure}`;
                showToast('作者注释默认值已保存', failure);
            } else {
                section.notice = '默认值已保存。新建的聊天，以及还没有单独设置的聊天，会使用它。';
                showToast('作者注释默认值已保存', '生成引擎已同步。');
            }
        } catch (error) {
            section.error = `保存失败：${error.message}`;
        } finally {
            section.saving = false;
            render();
        }
    }

    return {
        getAuthorsNoteView,
        setAuthorsNoteSection,
        updateAuthorsNoteDraft,
        resetAuthorsNoteDraft,
        saveAuthorsNoteChat,
        saveAuthorsNoteCharacter,
        saveAuthorsNoteDefaults,
        isAuthorsNoteAvailable() {
            return !!(actionRegistry.getSelectedChatEntity() && state.selected.chat);
        },
    };
}
