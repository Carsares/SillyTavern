// 聊天摘要（A6）的界面动作：聊天工具抽屉里的「聊天摘要」面板（读取、编辑、清除、重新摘要）和设置页「聊天工具」标签里的摘要设置。
// 摘要的数据模型和判断规则在 core/chat-summary.js（纯函数，对照旧版摘要扩展）；生成摘要的请求在 actions/chat-generation.js
// （summarizeModernChat 和每次生成成功后的自动摘要），因为它要占着「生成中」状态、可被停止，和一次生成同等对待。
//
// Modern 是唯一的写入方：
//   - 编辑 / 清除：直接改消息的 extra.memory（覆盖原来持有摘要的那一条，不产生第二份），走聊天文件队列保存，再等引擎重开聊天；
//   - 设置：写进 extension_settings.memory，经 /api/settings/save 保存，再 reloadSettings（引擎按字段合并并重新插入摘要提示词）。
import { describeReloadFailure, noEngineSync } from '../core/bridge-reload.js';
import {
    DEFAULT_SUMMARY_PROMPT,
    buildSummarySettingsPatch,
    clearSummaryOnMessage,
    describeSummaryProgress,
    describeSummarySource,
    getAutoSummaryGate,
    getLatestChatSummary,
    getManualSummaryGate,
    getSummaryProgress,
    isSummaryDraftDirty,
    isSummaryExtensionDisabled,
    parseSummarySettingsDraft,
    previewSummaryHolder,
    readSummarySettings,
    resolveSummaryWriteIndex,
    setSummaryOnMessage,
    toSummarySettingsDraft,
} from '../core/chat-summary.js';
import { saveSettingsSerialized } from '../core/keyed-queue.js';

/**
 * @param {object} deps 依赖
 * @param {any} deps.state 全局界面状态
 * @param {Function} deps.apiFetch 带 CSRF 的 JSON 请求
 * @param {Function} deps.render 重新渲染当前路由
 * @param {Function} deps.showToast 弹出提示
 * @param {any} [deps.bridgeReload] 引擎同步函数（reloadSettings）
 * @param {Record<string, any>} deps.actionRegistry 聊天动作注册表
 * @returns {Record<string, Function>} 聊天摘要的业务动作
 */
export function createChatSummaryActions({ state, apiFetch, render, showToast, bridgeReload = {}, actionRegistry }) {
    const reloadSettings = bridgeReload.reloadSettings ?? noEngineSync;

    function store() {
        return state.chatSummary;
    }

    function getTarget() {
        const entity = actionRegistry.getSelectedChatEntity();
        const groupMode = actionRegistry.isGroupChatMode();
        const chatId = state.selected.chat;
        const contextKey = actionRegistry.getChatContextKey(entity, groupMode);
        if (!entity || !contextKey || !chatId) {
            return null;
        }

        const cacheKey = actionRegistry.chatContextActions.getChatCacheKey(contextKey, chatId);
        return { entity, groupMode, chatId, cacheKey, messages: state.chatMessages[cacheKey] };
    }

    // 聊天摘要面板 -----------------------------------------------------------------------------------------------------

    function createEditSection(key, baseline) {
        return { key, baseline, draft: baseline, stale: false, saving: false, error: '', notice: '', warning: '', confirmClear: false };
    }

    // 干净的草稿始终跟着聊天里的摘要走；有未保存修改时草稿保持不动，聊天里的摘要换了就标记 stale；换了聊天就换一份
    function ensureEditSection() {
        const target = getTarget();
        if (!target || !target.messages) {
            return { target, section: null, latest: { text: '', index: -1 } };
        }

        const latest = getLatestChatSummary(target.messages);
        let section = store().edit;
        if (!section || section.key !== target.cacheKey) {
            section = createEditSection(target.cacheKey, latest.text);
            store().edit = section;
        } else if (!section.saving && section.baseline !== latest.text) {
            const dirty = section.draft !== section.baseline;
            section.baseline = latest.text;
            if (dirty) {
                section.stale = true;
            } else {
                section.draft = latest.text;
                section.stale = false;
            }
        }
        return { target, section, latest };
    }

    function isChatSummaryAvailable() {
        return !!(actionRegistry.getSelectedChatEntity() && state.selected.chat);
    }

    /**
     * 面板渲染和 DOM 同步用的视图。调用会顺带把干净的草稿对齐到聊天里最新的摘要。
     * @returns {Record<string, any>} 视图；聊天还没读到时 ready 为 false 并带 reason
     */
    function getChatSummaryView() {
        const { target, section, latest } = ensureEditSection();
        if (!target || !section) {
            return { ready: false, reason: target ? '聊天记录读取中，稍后再试。' : '请先选择一个聊天。' };
        }

        const memory = readSummarySettings(state.settings);
        const progress = getSummaryProgress(target.messages, memory);
        const autoGate = getAutoSummaryGate(state.settings);
        const manualGate = getManualSummaryGate(state.settings, target.messages.length);
        const notice = store().notice;
        const hasSummary = latest.index >= 0;
        return {
            ready: true,
            generating: !!state.engine.generating,
            // 正在为这个聊天生成摘要（自动或手动）：面板里给出停止按钮，因为底部输入区的「停止」被抽屉挡住
            running: !!state.engine.generating && !!state.chatSummary.running,
            sourceLabel: describeSummarySource(memory.source),
            hasSummary,
            summaryIndex: latest.index,
            holder: hasSummary ? previewSummaryHolder(target.messages[latest.index]) : '',
            // 自动摘要进度：不能自动时说明原因，能自动时说明还差多少
            // 来源是 Extras 时面板上方的提示框已经说明原因，这一行不再重复
            autoText: autoGate.eligible ? describeSummaryProgress(progress) : (memory.source === 'extras' ? '' : autoGate.message),
            autoEligible: autoGate.eligible,
            progress,
            manualGate,
            // 来源是 Extras 时，两处提示都引导去设置页切换
            needsSourceSwitch: memory.source === 'extras' && !autoGate.eligible,
            draft: section.draft,
            dirty: section.draft !== section.baseline,
            stale: section.stale && section.draft !== section.baseline,
            saving: section.saving,
            confirmClear: section.confirmClear,
            error: section.error,
            notice: section.notice,
            warning: section.warning,
            // 最近一次生成摘要（自动或手动）的结果，只在发生它的那个聊天里显示
            runNotice: notice && notice.key === target.cacheKey ? notice : null,
        };
    }

    /**
     * 记下摘要输入框的新值；不重新渲染（重渲染会让输入框失去焦点），界面联动由事件文件按返回的视图就地更新。
     * @param {string} value 输入框的值
     * @returns {Record<string, any>} 更新后的视图
     */
    function updateChatSummaryDraft(value) {
        const { section } = ensureEditSection();
        if (section) {
            section.draft = String(value ?? '');
            section.notice = '';
            section.error = '';
        }
        return getChatSummaryView();
    }

    function resetChatSummaryDraft() {
        const { section } = ensureEditSection();
        if (!section || section.saving) {
            return;
        }
        section.draft = section.baseline;
        section.stale = false;
        section.error = '';
        section.notice = '';
        section.warning = '';
        render();
    }

    // 保存前的共同检查：不在保存中、不在生成中。返回 false 时已经把原因写进 section.error
    function canStartEdit(section) {
        if (!section || section.saving) {
            return false;
        }
        section.error = '';
        section.notice = '';
        section.warning = '';
        if (state.engine.generating) {
            section.error = '正在生成，生成结束后才能修改摘要。';
            render();
            return false;
        }
        return true;
    }

    // 写盘成功后的统一收尾：等引擎重开聊天，失败只提示（文件已经保存）
    async function finishEdit(section, engineSync, doneText, title, effect) {
        const reload = await engineSync;
        const failure = describeReloadFailure(reload);
        if (failure) {
            section.warning = `${doneText}${failure}`;
            showToast(title, failure);
        } else {
            section.notice = `${doneText}，生成引擎已同步，${effect}`;
            showToast(title, '生成引擎已同步。');
        }
    }

    async function saveChatSummaryEdit() {
        const { target, section } = ensureEditSection();
        if (!target || !canStartEdit(section)) {
            return;
        }

        const text = section.draft;
        if (!text.trim()) {
            // 清空输入框再保存 = 清除摘要，与旧版把摘要框清空一致，但这里不再二次确认（用户已经亲手清空了）
            await clearLatestSummary(target, section);
            return;
        }

        section.saving = true;
        render();
        try {
            const { result, engineSync } = await actionRegistry.chatContextActions.updateModernChatAndSync(target.entity, target.chatId, messages => {
                // 在队列里重新找一次：覆盖原来持有摘要的那一条，没有摘要才写在倒数第二条
                const index = resolveSummaryWriteIndex(messages);
                if (index < 0) {
                    throw new Error('聊天里还没有消息，无法保存摘要。');
                }
                setSummaryOnMessage(messages, index, text);
                return { index };
            }, { groupMode: target.groupMode });
            section.baseline = text;
            section.draft = text;
            section.stale = false;
            await finishEdit(section, engineSync, `摘要已保存到第 ${result.index + 1} 条消息`, '聊天摘要已保存', '下一次生成使用新的摘要。');
        } catch (error) {
            section.error = `保存失败：${error.message}`;
        } finally {
            section.saving = false;
            render();
        }
    }

    async function clearLatestSummary(target, section) {
        section.saving = true;
        section.confirmClear = false;
        render();
        try {
            const { result, engineSync } = await actionRegistry.chatContextActions.updateModernChatAndSync(target.entity, target.chatId, messages => {
                const latest = getLatestChatSummary(messages);
                if (latest.index < 0 || !clearSummaryOnMessage(messages, latest.index)) {
                    throw new Error('当前聊天里没有可清除的摘要。');
                }
                return { removed: latest.index, remaining: getLatestChatSummary(messages) };
            }, { groupMode: target.groupMode });
            const latest = getLatestChatSummary(state.chatMessages[target.cacheKey]);
            section.baseline = latest.text;
            section.draft = latest.text;
            section.stale = false;
            // 旧版「恢复上一份」：清掉最新一份后，更早的那份（比如原始构造方式每次摘要留下的）重新成为当前摘要
            const rest = result.remaining.index >= 0
                ? `现在生效的是第 ${result.remaining.index + 1} 条消息上较早的一份摘要，可以继续清除`
                : '聊天里已经没有摘要';
            await finishEdit(section, engineSync, `已清除第 ${result.removed + 1} 条消息上的摘要，${rest}`, '聊天摘要已清除', '下一次生成不再带上被清除的那份。');
        } catch (error) {
            section.error = `清除失败：${error.message}`;
        } finally {
            section.saving = false;
            render();
        }
    }

    function beginChatSummaryClear() {
        const { section } = ensureEditSection();
        if (section && !section.saving) {
            section.confirmClear = true;
            render();
        }
    }

    function cancelChatSummaryClear() {
        const { section } = ensureEditSection();
        if (section) {
            section.confirmClear = false;
            render();
        }
    }

    async function confirmChatSummaryClear() {
        const { target, section } = ensureEditSection();
        if (target && canStartEdit(section)) {
            await clearLatestSummary(target, section);
        }
    }

    async function runChatSummaryNow() {
        const { section } = ensureEditSection();
        if (section) {
            section.error = '';
            section.notice = '';
            section.warning = '';
        }
        try {
            await actionRegistry.chatGenerationActions.summarizeModernChat();
        } catch (error) {
            // 提示已由 summarizeModernChat 写进 state.chatSummary.notice，这里只补一个 toast
            showToast('聊天摘要失败', error.message);
        }
        render();
    }

    // 摘要来源是 Extras 时，面板里的「前往设置」：打开设置页的「聊天工具」标签
    function openChatSummarySettings() {
        state.settingsSection = 'chat-tools';
        localStorage.setItem('st-modern-settings-section', 'chat-tools');
        state.chatTools.open = false;
        const navigation = /** @type {HTMLElement | null} */ (document.querySelector('[data-route="settings"]'));
        if (navigation) {
            navigation.click();
        } else {
            render();
        }
    }

    // 设置分区 ---------------------------------------------------------------------------------------------------------

    function ensureMemorySettings() {
        if (!state.settings || typeof state.settings !== 'object') {
            state.settings = {};
        }
        if (!state.settings.extension_settings || typeof state.settings.extension_settings !== 'object') {
            state.settings.extension_settings = {};
        }
        if (!state.settings.extension_settings.memory || typeof state.settings.extension_settings.memory !== 'object') {
            state.settings.extension_settings.memory = {};
        }
        return state.settings.extension_settings.memory;
    }

    function ensureSettingsSection() {
        const memory = readSummarySettings(state.settings);
        const baselineDraft = toSummarySettingsDraft(memory);
        let section = store().settings;
        if (!section) {
            section = { baseline: memory, baselineDraft, draft: { ...baselineDraft }, errors: {}, saving: false, error: '', notice: '', warning: '' };
            store().settings = section;
        } else if (!section.saving) {
            const dirty = isSummaryDraftDirty(section.draft, section.baselineDraft);
            section.baseline = memory;
            section.baselineDraft = baselineDraft;
            if (!dirty) {
                section.draft = { ...baselineDraft };
            }
        }
        return section;
    }

    /**
     * 设置分区渲染和 DOM 同步用的视图：草稿、是否有未保存修改、校验错误、反馈信息。
     * @returns {Record<string, any>} 视图
     */
    function getSummarySettingsView() {
        const section = ensureSettingsSection();
        return {
            draft: section.draft,
            dirty: isSummaryDraftDirty(section.draft, section.baselineDraft),
            errors: section.errors,
            saving: section.saving,
            error: section.error,
            notice: section.notice,
            warning: section.warning,
            // 横幅看已保存的设置，不看草稿：来源还是 Extras 时提示切换，保存后横幅自然消失
            savedSource: section.baseline.source,
            savedSourceLabel: describeSummarySource(section.baseline.source),
            extrasSaved: section.baseline.source === 'extras',
            extensionDisabled: isSummaryExtensionDisabled(state.settings),
            inChat: section.draft.position === '1',
        };
    }

    /**
     * 记下输入框的新值；不重新渲染，界面联动（未保存标记、错误、深度和角色的显隐）由事件文件按返回的视图就地更新。
     * @param {string} field 字段名
     * @param {string} value 新值（复选框用 '1' / ''）
     * @returns {Record<string, any>} 更新后的视图
     */
    function updateSummarySettingsDraft(field, value) {
        const section = ensureSettingsSection();
        if (Object.hasOwn(section.baselineDraft, field)) {
            section.draft[field] = String(value ?? '');
            delete section.errors[field];
            section.notice = '';
        }
        return getSummarySettingsView();
    }

    function resetSummarySettingsDraft() {
        const section = ensureSettingsSection();
        if (section.saving) {
            return;
        }
        section.draft = { ...section.baselineDraft };
        section.errors = {};
        section.error = '';
        section.notice = '';
        section.warning = '';
        render();
    }

    function restoreDefaultSummaryPrompt() {
        const section = ensureSettingsSection();
        section.draft.prompt = DEFAULT_SUMMARY_PROMPT;
        delete section.errors.prompt;
        render();
    }

    // 写进 extension_settings.memory 并通知引擎；保存失败时恢复内存里的旧值
    async function persistMemorySettings(patch) {
        const memory = ensureMemorySettings();
        const snapshot = structuredClone(memory);
        Object.assign(memory, patch);
        try {
            await saveSettingsSerialized(/** @type {any} */ (apiFetch), state.settings);
        } catch (error) {
            for (const key of Object.keys(memory)) {
                if (!Object.hasOwn(snapshot, key)) {
                    delete memory[key];
                }
            }
            Object.assign(memory, snapshot);
            throw error;
        }
        return reloadSettings();
    }

    async function commitSettings(section, patch, doneText, title) {
        section.saving = true;
        section.error = '';
        section.notice = '';
        section.warning = '';
        render();
        try {
            const reload = await persistMemorySettings(patch);
            const saved = readSummarySettings(state.settings);
            section.baseline = saved;
            section.baselineDraft = toSummarySettingsDraft(saved);
            section.errors = {};
            const failure = describeReloadFailure(reload);
            if (failure) {
                section.warning = `${doneText}${failure}`;
                showToast(title, failure);
            } else {
                section.notice = `${doneText}，生成引擎已同步，下一次生成起生效。`;
                showToast(title, '生成引擎已同步。');
            }
            return true;
        } catch (error) {
            section.error = `保存失败：${error.message}`;
            return false;
        } finally {
            section.saving = false;
            render();
        }
    }

    async function saveSummarySettings() {
        const section = ensureSettingsSection();
        if (section.saving) {
            return;
        }

        const parsed = parseSummarySettingsDraft(section.draft, section.baseline);
        section.errors = parsed.errors;
        section.error = '';
        section.notice = '';
        section.warning = '';
        if (!parsed.ok) {
            render();
            return;
        }

        const committed = await commitSettings(section, buildSummarySettingsPatch(parsed.values), '摘要设置已保存', '摘要设置已保存');
        if (committed) {
            section.draft = { ...section.baselineDraft };
        }
        render();
    }

    // 「切换为主模型」：只改来源这一项并立即保存，其余设置和未保存的草稿都不动。每次摘要会多一次主模型调用，横幅里已说明。
    async function switchSummarySourceToMain() {
        const section = ensureSettingsSection();
        if (section.saving) {
            return;
        }

        const wasClean = !isSummaryDraftDirty(section.draft, section.baselineDraft);
        const draftBefore = { ...section.draft };
        const committed = await commitSettings(section, { source: 'main' }, '摘要来源已切换为主模型', '摘要来源已切换');
        if (committed) {
            // 其它字段上未保存的修改保留，来源以刚保存的为准
            section.draft = wasClean ? { ...section.baselineDraft } : { ...draftBefore, source: 'main' };
        }
        render();
    }

    return {
        isChatSummaryAvailable,
        getChatSummaryView,
        updateChatSummaryDraft,
        resetChatSummaryDraft,
        saveChatSummaryEdit,
        beginChatSummaryClear,
        cancelChatSummaryClear,
        confirmChatSummaryClear,
        runChatSummaryNow,
        openChatSummarySettings,
        getSummarySettingsView,
        updateSummarySettingsDraft,
        resetSummarySettingsDraft,
        restoreDefaultSummaryPrompt,
        saveSummarySettings,
        switchSummarySourceToMain,
    };
}
