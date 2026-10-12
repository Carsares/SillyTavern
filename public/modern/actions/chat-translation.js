// 聊天消息翻译和翻译设置的业务动作（B3）。通过 shell/feature-slot-actions.js 并入路由上下文。
//
// 译文只用于显示：写在消息的 extra.display_text（推理内容在 extra.reasoning_display_text），原文始终留在 mes。
// 每次写入都走聊天文件队列（updateModernChatAndSync）：改好消息、保存、登记引擎重载；引擎之后读到的聊天带着译文。
// 「原文 / 译文」开关只改 state.chatTranslation.viewOriginal，不写文件。
import { describeReloadFailure, noEngineSync } from '../core/bridge-reload.js';
import { saveSettingsSerialized } from '../core/keyed-queue.js';
import {
    LEGACY_TRANSLATE_DEFAULTS,
    TRANSLATE_MODES,
    TRANSLATE_PROVIDERS,
    applyMessageTranslation,
    canTranslateMessage,
    clearMessageTranslation,
    createSourceSignature,
    describePlaceholderIssues,
    getLanguageLabel,
    getLanguageShortLabel,
    getMessageTranslationView,
    getMessageUiKey,
    getOriginalReasoning,
    getTranslateProvider,
    getTranslatorLabel,
    looksLikeLanguage,
    normalizeLanguageCode,
    resolveTranslateSettings,
} from '../core/translation.js';
import { TranslateError, createTranslationClient, rememberPrivacyAck } from './translation-client.js';

/** 设置页可以填写的密钥和地址（后端 /api/translate/* 按这些键读取） */
export const TRANSLATE_SECRET_KEYS = Object.freeze(['deepl', 'libre', 'libre_url', 'lingva_url', 'oneringtranslator_url', 'deeplx_url']);
const TRANSLATE_URL_SECRET_KEYS = Object.freeze(TRANSLATE_PROVIDERS.map(provider => provider.urlSecret).filter(Boolean));

/**
 * @param {any} state 全局状态
 * @returns {any} 补齐字段的 state.chatTranslation
 */
export function ensureChatTranslationState(state) {
    if (!state.chatTranslation || typeof state.chatTranslation !== 'object') {
        state.chatTranslation = {};
    }
    const ui = state.chatTranslation;
    // viewOriginal[键]：true 看原文，false 看译文，没有记录按默认（译文未过期看译文，过期看原文）；只存在内存里，不写文件
    ui.viewOriginal ??= {};
    ui.busy ??= {};
    ui.errors ??= {};
    ui.confirm ??= '';
    ui.settingsSaving ??= false;
    ui.settingsTest ??= { running: false, result: '', error: '' };
    return ui;
}

function findMessageIndex(messages, originalMessage, originalIndex) {
    if (!originalMessage?.send_date) {
        return originalIndex < messages.length ? originalIndex : -1;
    }
    return messages.findIndex(message => message?.send_date === originalMessage.send_date
        && message?.name === originalMessage.name
        && !!message?.is_user === !!originalMessage.is_user);
}

/**
 * 服务地址必须是完整的 http(s) 地址。
 * @param {string} value 用户填写的地址
 * @returns {boolean} 是否合法
 */
function isHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

export function createChatTranslationActions({
    state,
    apiFetch,
    apiFetchResponse,
    loadData,
    render,
    showToast,
    bridgeReload,
    actionRegistry,
}) {
    const client = createTranslationClient({ state, apiFetchResponse });
    const reloadSettings = bridgeReload?.reloadSettings || noEngineSync;
    const chatContext = actionRegistry.chatContextActions;

    function resolveMessageTarget(messageIndex) {
        const entity = actionRegistry.getSelectedChatEntity();
        const groupMode = actionRegistry.isGroupChatMode();
        const chatId = state.selected.chat;
        const contextKey = actionRegistry.getChatContextKey(entity, groupMode);
        if (!entity || !contextKey || !chatId) {
            throw new Error('请先选择一个聊天文件。');
        }
        const index = Number(messageIndex);
        const messages = chatContext.getSelectedChatMessages();
        if (!Number.isInteger(index) || index < 0 || index >= messages.length) {
            throw new Error('消息位置无效，请刷新后重试。');
        }
        return {
            entity,
            groupMode,
            chatId,
            index,
            message: messages[index],
            key: getMessageUiKey(chatContext.getCurrentDraftKey(), index),
        };
    }

    /**
     * 当前翻译服务的隐私提示，聊天消息里的确认条使用。
     * @returns {{ text: string, providerLabel: string, targetLabel: string }} 提示文字、服务名、目标语言名
     */
    function getChatTranslationNotice() {
        const settings = client.getSettings();
        return {
            text: client.getPrivacyNotice(settings).text,
            providerLabel: getTranslatorLabel(settings),
            targetLabel: getLanguageShortLabel(settings.target_language),
        };
    }

    /**
     * 翻译一条 AI 回复：译文写进 extra.display_text（有推理内容时一并写 reasoning_display_text），不改 mes。
     * 第一次使用某个翻译服务时先在消息下面显示隐私确认，确认后用 { confirmed: true } 再调用。
     * 失败时说明留在消息下面（state.chatTranslation.errors），不抛错。
     * @param {number | string} messageIndex 消息位置
     * @param {{ confirmed?: boolean, quiet?: boolean }} [options] confirmed：用户已确认隐私提示；quiet：成功时不弹提示（自动翻译开场白）
     */
    async function translateModernMessage(messageIndex, { confirmed = false, quiet = false } = {}) {
        const ui = ensureChatTranslationState(state);
        if (state.engine.generating) {
            throw new Error('生成中不能翻译消息。');
        }
        const { entity, groupMode, chatId, index, message: original, key } = resolveMessageTarget(messageIndex);
        if (!canTranslateMessage(original)) {
            throw new Error('只能翻译角色的回复。');
        }
        const source = String(original.mes ?? '');
        if (!source.trim()) {
            throw new Error('这条消息没有可翻译的内容。');
        }
        if (ui.busy[key]) {
            return;
        }

        const settings = client.getSettings();
        const readiness = client.checkProviderReady(settings);
        if (!readiness.ready) {
            ui.errors[key] = readiness.reason;
            ui.confirm = '';
            render();
            return;
        }
        const notice = client.getPrivacyNotice(settings);
        if (!notice.acknowledged && !confirmed) {
            ui.confirm = key;
            delete ui.errors[key];
            render();
            return;
        }
        if (!notice.acknowledged) {
            rememberPrivacyAck(notice.providerId);
        }

        ui.confirm = '';
        delete ui.errors[key];
        ui.busy[key] = true;
        render();

        let engineSync = null;
        let doneNote = '';
        try {
            const translation = await client.translate(source, { settings });
            if (!translation.ok) {
                throw new TranslateError(`译文不完整（${describePlaceholderIssues(translation.issues)}），没有保存。可以重试，或换一个翻译服务。`);
            }

            // 推理内容的译文是附带的：它失败不影响正文译文
            const reasoningSource = getOriginalReasoning(original);
            let reasoningText = '';
            if (reasoningSource.trim()) {
                try {
                    const reasoning = await client.translate(reasoningSource, { settings });
                    if (reasoning.ok) {
                        reasoningText = reasoning.text;
                    } else {
                        doneNote = `推理内容没有翻译：${describePlaceholderIssues(reasoning.issues)}。`;
                    }
                } catch (error) {
                    doneNote = `推理内容没有翻译：${error.message}`;
                }
            }

            const saved = await chatContext.updateModernChatAndSync(entity, chatId, latest => {
                if (state.engine.generating) {
                    throw new Error('生成中不能翻译消息。');
                }
                const latestIndex = findMessageIndex(latest, original, index);
                if (latestIndex < 0) {
                    throw new Error('翻译目标已变化，请重新选择消息。');
                }
                const target = latest[latestIndex];
                if (createSourceSignature(target.mes) !== createSourceSignature(source)) {
                    throw new Error('这条消息的原文在翻译期间变了，请重新翻译。');
                }
                applyMessageTranslation(target, { text: translation.text, reasoningText, lang: translation.lang });
                return target;
            }, { groupMode });
            engineSync = saved.engineSync;
            delete ui.viewOriginal[key];
            if (!quiet) {
                showToast('消息已翻译', `已翻译为${getLanguageShortLabel(translation.lang)}（${client.describeTranslator(settings)}）${doneNote ? `；${doneNote}` : ''}`);
            }
        } catch (error) {
            // 失败说明直接显示在这条消息下面（带「重试」），不再弹提示盖住它
            if (error?.name !== 'AbortError') {
                ui.errors[key] = error.message;
            }
        } finally {
            delete ui.busy[key];
            render();
        }

        // 文件已保存、界面已刷新；引擎同步失败只补一条说明
        const sync = await engineSync;
        if (sync && sync.ok === false) {
            showToast('消息已翻译', `已保存到聊天文件${describeReloadFailure(sync)}`);
        }
    }

    // 本次打开页面里已经尝试过自动翻译的开场白（聊天、候选、原文、目标语言），失败也不重复尝试
    const autoGreetingAttempts = new Set();

    /**
     * 打开聊天时自动翻译外语开场白（设置中心「语言」里的开关，默认开）：第一条消息是角色的开场白、还没有当前语言的译文、
     * 看起来不是目标语言时，按当前翻译方式翻译一次，只写显示译文。机器翻译还没确认过隐私提示时不自动发。
     * 由聊天页每次渲染后调用，满足条件才会真的翻译，同一条开场白每次打开页面最多尝试一次。
     * @returns {Promise<void>}
     */
    async function maybeAutoTranslateGreeting() {
        if (state.route !== 'chat' || state.engine.generating) {
            return;
        }
        const settings = client.getSettings();
        if (!settings.auto_greeting) {
            return;
        }
        let target;
        try {
            target = resolveMessageTarget(0);
        } catch {
            return;
        }
        const { message, chatId } = target;
        const source = String(message?.mes ?? '');
        if (!canTranslateMessage(message) || message.is_user || !source.trim()) {
            return;
        }
        const extra = message.extra || {};
        const signature = createSourceSignature(source);
        if (extra.display_text && extra.display_text_src === signature && extra.display_text_lang === settings.target_language) {
            return;
        }
        if (looksLikeLanguage(source, settings.target_language)) {
            return;
        }
        const attemptKey = `${chatId}|${message.swipe_id ?? 0}|${signature}|${settings.target_language}`;
        if (autoGreetingAttempts.has(attemptKey)) {
            return;
        }
        autoGreetingAttempts.add(attemptKey);
        if (!client.checkProviderReady(settings).ready || !client.getPrivacyNotice(settings).acknowledged) {
            return;
        }
        try {
            await translateModernMessage(0, { quiet: true });
        } catch {
            // 自动翻译失败不打扰：失败说明已经留在这条消息下面
        }
    }

    /**
     * 「原文 / 译文」开关：只改界面状态，不写文件。
     * @param {number | string} messageIndex 消息位置
     */
    function toggleModernMessageTranslationView(messageIndex) {
        const ui = ensureChatTranslationState(state);
        const { message, key } = resolveMessageTarget(messageIndex);
        const view = getMessageTranslationView(message, ui.viewOriginal[key]);
        if (!view.hasTranslation) {
            return;
        }
        ui.viewOriginal[key] = view.showing === 'translation';
        render();
    }

    /**
     * 清除译文（display_text 和推理内容的译文），原文不动。
     * @param {number | string} messageIndex 消息位置
     */
    async function clearModernMessageTranslation(messageIndex) {
        const ui = ensureChatTranslationState(state);
        if (state.engine.generating) {
            throw new Error('生成中不能清除译文。');
        }
        const { entity, groupMode, chatId, index, message: original, key } = resolveMessageTarget(messageIndex);
        if (ui.busy[key]) {
            return;
        }

        ui.busy[key] = true;
        delete ui.errors[key];
        render();
        let engineSync = null;
        try {
            const saved = await chatContext.updateModernChatAndSync(entity, chatId, latest => {
                if (state.engine.generating) {
                    throw new Error('生成中不能清除译文。');
                }
                const latestIndex = findMessageIndex(latest, original, index);
                if (latestIndex < 0) {
                    throw new Error('清除目标已变化，请重新选择消息。');
                }
                clearMessageTranslation(latest[latestIndex]);
            }, { groupMode });
            engineSync = saved.engineSync;
            delete ui.viewOriginal[key];
            showToast('译文已清除', '原文没有改动。');
        } catch (error) {
            ui.errors[key] = error.message;
            showToast('清除译文失败', error.message);
        } finally {
            delete ui.busy[key];
            render();
        }

        const sync = await engineSync;
        if (sync && sync.ok === false) {
            showToast('译文已清除', `已保存到聊天文件${describeReloadFailure(sync)}`);
        }
    }

    function cancelModernMessageTranslationConfirm() {
        ensureChatTranslationState(state).confirm = '';
        render();
    }

    function dismissModernMessageTranslationError(messageIndex) {
        const ui = ensureChatTranslationState(state);
        const { key } = resolveMessageTarget(messageIndex);
        delete ui.errors[key];
        render();
    }

    // -----------------------------------------------------------------------------------------------------------------
    // 设置页
    // -----------------------------------------------------------------------------------------------------------------

    function assertSettingsLoaded() {
        if (!state.settings || !Object.keys(state.settings).length) {
            throw new Error('设置还没有读取成功，无法保存翻译设置。请刷新页面后重试。');
        }
    }

    function ensureTranslateSettingsObject() {
        const settings = state.settings;
        if (!settings.extension_settings || typeof settings.extension_settings !== 'object') {
            settings.extension_settings = {};
        }
        const existing = settings.extension_settings.translate;
        const translate = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
        settings.extension_settings.translate = {
            internal_language: LEGACY_TRANSLATE_DEFAULTS.internal_language,
            auto_mode: LEGACY_TRANSLATE_DEFAULTS.auto_mode,
            ...translate,
        };
        return settings.extension_settings.translate;
    }

    // 设置写盘后通知引擎重载并等它完成，再刷新页面数据，保存后立刻翻译或生成都读到新配置
    // quiet：设置页改动即保存时不弹成功提示（页头的保存状态已经说明），引擎没同步时仍然提示
    async function persistTranslateSettings(doneTitle, doneText, { quiet = false } = {}) {
        await saveSettingsSerialized(apiFetch, state.settings);
        const engineSync = await reloadSettings();
        await loadData({ silent: true });
        const failure = describeReloadFailure(engineSync);
        if (!quiet || failure) {
            showToast(doneTitle, `${doneText}${failure}`);
        }
    }

    /**
     * 保存翻译设置：翻译方式、机器翻译服务、DeepL 接口，以及（给了时）目标语言；新填的密钥和地址写进密钥库（空输入不动已有值），
     * 清除项从密钥库删除。internal_language 和 auto_mode 保持原值；目标语言现在由设置中心「语言」标签管理，表单里没有时不改。
     * @param {{ mode?: string, provider: string, target_language?: string, deepl_endpoint: string, secrets?: Record<string, string>, clear?: string[] }} values 表单取值
     * @param {{ quiet?: boolean }} [options] quiet 见 persistTranslateSettings
     */
    async function saveTranslateSettings(values, { quiet = false } = {}) {
        const ui = ensureChatTranslationState(state);
        if (ui.settingsSaving) {
            return;
        }
        assertSettingsLoaded();
        const current = resolveTranslateSettings(state.settings);
        const mode = TRANSLATE_MODES.includes(values?.mode) ? values.mode : current.mode;
        const provider = getTranslateProvider(values?.provider || current.provider);
        if (!provider) {
            throw new Error('请选择翻译服务。');
        }
        const hasTarget = values?.target_language !== undefined;
        const targetLanguage = hasTarget ? normalizeLanguageCode(values.target_language) : current.target_language;
        if (!targetLanguage) {
            throw new Error('请选择目标语言。');
        }
        const secrets = Object.fromEntries(Object.entries(values?.secrets || {})
            .map(([key, value]) => [key, String(value ?? '').trim()])
            .filter(([key, value]) => value && TRANSLATE_SECRET_KEYS.includes(key)));
        for (const key of TRANSLATE_URL_SECRET_KEYS) {
            if (secrets[key] && !isHttpUrl(secrets[key])) {
                throw new Error('服务地址必须是以 http:// 或 https:// 开头的完整地址。');
            }
        }
        const clear = (values?.clear || []).filter(key => TRANSLATE_SECRET_KEYS.includes(key) && !secrets[key]);

        ui.settingsSaving = true;
        render();
        try {
            for (const [key, value] of Object.entries(secrets)) {
                await apiFetch('/api/secrets/write', { body: { key, value, label: 'translate modern' } });
            }
            for (const key of clear) {
                await apiFetch('/api/secrets/delete', { body: { key } });
            }

            const translate = ensureTranslateSettingsObject();
            translate.mode = mode;
            translate.provider = provider.id;
            if (hasTarget) {
                translate.target_language = targetLanguage;
                translate.follow_reply_language = false;
            }
            translate.deepl_endpoint = values.deepl_endpoint === 'pro' ? 'pro' : 'free';
            await persistTranslateSettings('翻译设置已保存', `${mode === 'llm' ? '大模型翻译' : provider.label} / ${getLanguageLabel(targetLanguage)}`, { quiet });
        } finally {
            ui.settingsSaving = false;
            render();
        }
    }

    /**
     * 关闭旧版翻译扩展的自动翻译（auto_mode 写成 none）。其余设置不动。
     */
    async function disableTranslateAutoMode() {
        const ui = ensureChatTranslationState(state);
        if (ui.settingsSaving) {
            return;
        }
        assertSettingsLoaded();
        ui.settingsSaving = true;
        render();
        try {
            ensureTranslateSettingsObject().auto_mode = 'none';
            await persistTranslateSettings('自动翻译已关闭', '生成引擎不会再自动翻译回复或改写你发送的消息。');
        } finally {
            ui.settingsSaving = false;
            render();
        }
    }

    /**
     * 用已保存的设置翻译一句 "Hello, world!"，检查服务连得通。结果留在 state.chatTranslation.settingsTest。
     * @param {{ refresh?: () => void }} [options] refresh：状态变化后的刷新方式，默认重绘整页；设置页只刷新结果块，保住未保存的输入
     */
    async function testTranslateProvider({ refresh = render } = {}) {
        const ui = ensureChatTranslationState(state);
        if (ui.settingsTest.running) {
            return;
        }
        ui.settingsTest = { running: true, result: '', error: '' };
        refresh();
        try {
            const settings = client.getSettings();
            if (settings.mode !== 'llm') {
                rememberPrivacyAck(settings.provider);
            }
            const result = await client.translate('Hello, world!', { settings });
            ui.settingsTest = { running: false, result: result.text, error: '' };
        } catch (error) {
            ui.settingsTest = { running: false, result: '', error: error.message };
        }
        refresh();
    }

    return {
        getChatTranslationNotice,
        translateModernMessage,
        maybeAutoTranslateGreeting,
        toggleModernMessageTranslationView,
        clearModernMessageTranslation,
        cancelModernMessageTranslationConfirm,
        dismissModernMessageTranslationError,
        saveTranslateSettings,
        disableTranslateAutoMode,
        testTranslateProvider,
    };
}

