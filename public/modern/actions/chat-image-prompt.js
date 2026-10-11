/**
 * 从消息生成提示词（WP5）：勾选消息、调用当前文本连接生成图片提示词、取消。
 * 方案见 docs/image-generation/FRONTEND-DESIGN.md 第 5 节；界面状态在 core/chat-image-state.js 的 ChatImageView。
 *
 * 流程（view.autoStep）：1 勾选 → 2 生成提示词中（勾选冻结）→ 3 提示词已填进提示词框，由 components/chat-image-composer.js 显示。
 * 生成提示词只发一次非流式的聊天补全请求，不写聊天文件，也不占用 state.engine.generating（它不是一轮对话）。
 *
 * 文件里的纯函数（buildImagePromptMessages 等）也供 components/chat-image-selection.js 和
 * routes/chat-image-prompt-events.js 使用，判断是否处于勾选模式、按钮能不能点。
 */
import { getChatImageView, peekChatImageView } from '../core/chat-image-state.js';
import {
    createChatCompletionRequestBody,
    getChatCompletionSettingsForTest,
    readConnectionTestReply,
} from '../core/chat-completion-request.js';
import { getImageGenerationConfig, PROMPT_SOURCE_LIMITS } from '../core/image-generation-config.js';
import { findMessageIndexByIdentity, isPromptSourceMessage, messageIdentity, pickRecentPromptSources } from '../core/image-message.js';
import { formatGreetingText, resolveCharacterName, resolveUserName } from './chat-greetings.js';

export const CHAT_COMPLETION_GENERATE_API = '/api/backends/chat-completions/generate';

/** 主连接不是聊天补全时的说明（原型「从消息生成」里的提示）。 */
export const PROMPT_GENERATION_UNSUPPORTED_MESSAGE = '当前主连接是文本补全，第一期只支持在聊天补全连接上从消息生成提示词。可以切到「手动输入」自己写。';
export const PROMPT_GENERATION_TEXT_BUSY_MESSAGE = '文本回复生成中，结束后才能生成提示词。';
export const PROMPT_GENERATION_NO_MODEL_MESSAGE = '文本连接还没有填写模型，先到设置中心「模型连接」填好。';
export const PROMPT_SOURCE_OVER_LIMIT_MESSAGE = `最多参考 ${PROMPT_SOURCE_LIMITS.maxMessages} 条、${PROMPT_SOURCE_LIMITS.maxCharacters} 字，请减少勾选。`;
export const PROMPT_SOURCE_EMPTY_MESSAGE = '先在上方消息列表里勾选要参考的消息。';

/**
 * @param {any} settings state.settings。
 * @returns {boolean} 主连接是否是聊天补全（只有它能从消息生成提示词）。
 */
export function isPromptGenerationSupported(settings) {
    return (settings?.main_api || 'openai') === 'openai';
}

/**
 * 勾选模式：图片模式、子模式「从消息生成」、第 1 步，并且主连接支持生成提示词。第 2 步（生成中）勾选冻结，不显示复选框。
 * @param {import('../core/chat-image-state.js').ChatImageView | null} view 当前聊天的图片界面状态。
 * @param {any} settings state.settings。
 * @returns {boolean}
 */
export function isChatImageSelectionActive(view, settings) {
    return Boolean(view)
        && view.mode === 'image'
        && view.sub === 'auto'
        && view.autoStep === 1
        && isPromptGenerationSupported(settings);
}

/**
 * @param {any} engine state.engine。
 * @returns {boolean} 是否有文本回复（或 Agent）在生成；图片生成（activity 为 'image'）不算。
 */
export function isTextGenerationBusy(engine) {
    return Boolean(engine?.generating) && engine?.activity !== 'image';
}

/**
 * 勾选的、仍可参与的消息，按聊天里的顺序。勾选集合里已被删掉或不再可参与的身份忽略。
 * @param {Set<string> | Iterable<string> | null | undefined} selected 勾选的消息身份。
 * @param {any[]} messages 当前聊天的全部消息。
 * @returns {any[]}
 */
export function selectPromptSources(selected, messages) {
    const identities = selected instanceof Set ? selected : new Set(selected || []);
    if (!identities.size || !Array.isArray(messages)) {
        return [];
    }
    return messages.filter(message => isPromptSourceMessage(message) && identities.has(messageIdentity(message)));
}

/**
 * @param {any[]} sources selectPromptSources 的结果。
 * @returns {{ count: number, characters: number, overLimit: boolean }} characters 按消息原文长度计（约 N 字）。
 */
export function describePromptSourceSelection(sources) {
    const list = Array.isArray(sources) ? sources : [];
    const characters = list.reduce((total, message) => total + String(message?.mes ?? '').trim().length, 0);
    return {
        count: list.length,
        characters,
        overLimit: list.length > PROMPT_SOURCE_LIMITS.maxMessages || characters > PROMPT_SOURCE_LIMITS.maxCharacters,
    };
}

/**
 * 从已保存的聊天补全设置里读出来源和模型名（不抛错）。
 * @param {object} input 输入。
 * @param {any} input.settings state.settings。
 * @param {Record<string, any>} input.oaiSettings settings.oai_settings。
 * @param {(settings: Record<string, any>, source: string) => string} [input.getChatCompletionModel] 按来源取模型名。
 * @returns {{ source: string, model: string }}
 */
export function resolvePromptModel({ settings, oaiSettings, getChatCompletionModel }) {
    const saved = oaiSettings || {};
    const source = saved.chat_completion_source || settings?.chat_completion_source || 'openai';
    const model = typeof getChatCompletionModel === 'function' ? getChatCompletionModel(saved, source) : (saved.openai_model || '');
    return { source, model: String(model || '') };
}

/**
 * 「生成提示词」能不能点，不能时给出原因。
 * @param {object} input 输入。
 * @param {any} input.settings state.settings。
 * @param {any} input.engine state.engine。
 * @param {any[]} input.sources selectPromptSources 的结果。
 * @param {string} [input.model] resolvePromptModel 的模型名；传 undefined 表示不检查。
 * @returns {{ ok: boolean, reason: string, code: '' | 'unsupported' | 'busy' | 'empty' | 'over-limit' | 'no-model' }}
 */
export function getPromptGenerationGate({ settings, engine, sources, model }) {
    if (!isPromptGenerationSupported(settings)) {
        return { ok: false, reason: PROMPT_GENERATION_UNSUPPORTED_MESSAGE, code: 'unsupported' };
    }
    const summary = describePromptSourceSelection(sources);
    if (!summary.count) {
        return { ok: false, reason: PROMPT_SOURCE_EMPTY_MESSAGE, code: 'empty' };
    }
    if (summary.overLimit) {
        return { ok: false, reason: PROMPT_SOURCE_OVER_LIMIT_MESSAGE, code: 'over-limit' };
    }
    if (isTextGenerationBusy(engine)) {
        return { ok: false, reason: PROMPT_GENERATION_TEXT_BUSY_MESSAGE, code: 'busy' };
    }
    if (model !== undefined && !String(model || '').trim()) {
        return { ok: false, reason: PROMPT_GENERATION_NO_MODEL_MESSAGE, code: 'no-model' };
    }
    return { ok: true, reason: '', code: '' };
}

/**
 * 勾选消息转成「名字: 内容」用的条目。
 * @param {any[]} sources 勾选的消息（selectPromptSources 的结果）。
 * @param {string} userName 用户名（用户消息没有 name 时用）。
 * @returns {{ name: string, text: string }[]}
 */
export function toPromptSourceLines(sources, userName) {
    return (Array.isArray(sources) ? sources : []).map(message => ({
        name: String(message?.name || (message?.is_user ? userName : 'Character')),
        text: String(message?.mes ?? '').trim(),
    }));
}

/**
 * 角色外貌段落：每个角色一段「名字: 描述」，空描述跳过。
 * @param {{ name: string, description: string }[]} entries 角色与描述。
 * @returns {string}
 */
export function buildAppearanceText(entries) {
    return (Array.isArray(entries) ? entries : [])
        .map(entry => ({ name: String(entry?.name || '').trim(), description: String(entry?.description || '').trim() }))
        .filter(entry => entry.description)
        .map(entry => (entry.name ? `${entry.name}: ${entry.description}` : entry.description))
        .join('\n\n');
}

/**
 * 生成提示词时发给文本模型的消息：system 是模板；user 是（可选的）角色外貌加上「名字: 内容」格式的勾选消息。
 * @param {object} input 输入。
 * @param {string} input.template 提示词模板（getImageGenerationConfig(settings).promptGen.template）。
 * @param {string} [input.appearance] 角色外貌（buildAppearanceText 的结果），空串表示不附带。
 * @param {{ name: string, text: string }[]} input.selected 勾选的消息（toPromptSourceLines 的结果），按聊天顺序。
 * @returns {{ role: 'system' | 'user', content: string }[]}
 */
export function buildImagePromptMessages({ template, appearance = '', selected = [] }) {
    const appearanceText = String(appearance || '').trim();
    const excerpt = (Array.isArray(selected) ? selected : []).map(item => `${item.name}: ${item.text}`).join('\n');
    return [
        { role: 'system', content: String(template ?? '') },
        { role: 'user', content: `${appearanceText ? `Character appearance:\n${appearanceText}\n\n` : ''}Conversation excerpt:\n${excerpt}` },
    ];
}

/**
 * 群聊里要附带外貌的角色：勾选消息里出现过的角色名（按首次出现的顺序），先在群成员里找，找不到再在全部角色里按名字找。
 * @param {object} input 输入。
 * @param {any[]} input.sources 勾选的消息。
 * @param {any} input.group 群聊（members 是成员的 avatar）。
 * @param {any[]} input.characters state.characters。
 * @returns {any[]} 角色卡（可能是摘要卡）。
 */
export function findGroupAppearanceCharacters({ sources, group, characters }) {
    const all = Array.isArray(characters) ? characters : [];
    const members = (Array.isArray(group?.members) ? group.members : [])
        .map(member => all.find(character => character?.avatar === member || character?.name === member))
        .filter(Boolean);
    const names = [];
    for (const message of Array.isArray(sources) ? sources : []) {
        const name = String(message?.name || '');
        if (!message?.is_user && name && !names.includes(name)) {
            names.push(name);
        }
    }
    const matches = character => name => character?.name === name || resolveCharacterName(character) === name;
    const result = [];
    for (const name of names) {
        const found = members.find(character => matches(character)(name)) || all.find(character => matches(character)(name));
        if (found && !result.includes(found)) {
            result.push(found);
        }
    }
    return result;
}

/**
 * 从失败里取出能给用户看的原因：apiFetch 抛出的错误带 body（响应体前 2000 字），后端常在里面放 { error: { message } }。
 * @param {any} error 错误。
 * @returns {string}
 */
export function describePromptGenerationFailure(error) {
    const body = typeof error?.body === 'string' ? error.body.trim() : '';
    if (body) {
        try {
            const parsed = JSON.parse(body);
            const detail = parsed?.error?.message || parsed?.message || (typeof parsed?.error === 'string' ? parsed.error : '');
            if (detail) {
                return `生成提示词失败：${String(detail).slice(0, 300)}`;
            }
        } catch {
            return `生成提示词失败：${body.slice(0, 300)}`;
        }
    }
    return `生成提示词失败：${error?.message || String(error)}`;
}

function isAbortError(error) {
    return error?.name === 'AbortError';
}

function getCharacterDescription(character) {
    const value = character?.data?.description || character?.description || '';
    return typeof value === 'string' ? value : '';
}

/**
 * @param {import('../shell/feature-slot-actions.js').FeatureSlotDeps} deps 依赖。
 * @returns {Record<string, Function>}
 */
export function createChatImagePromptActions(deps) {
    const { state, apiFetch, render, showToast } = deps;
    const registry = deps.actionRegistry || {};
    const chatContext = registry.chatContextActions || {};
    const apiConnection = registry.apiConnectionActions || {};
    const getChatCompletionModel = apiConnection.getChatCompletionModel || registry.getChatCompletionModel;

    function getCurrent() {
        const cacheKey = chatContext.getCurrentDraftKey();
        const messages = chatContext.getSelectedChatMessages() || [];
        return { cacheKey, messages, view: peekChatImageView(state, cacheKey) };
    }

    /** 处于勾选模式（第 1 步）时返回当前聊天的状态，否则为 null。 */
    function getSelectingView() {
        const current = getCurrent();
        return isChatImageSelectionActive(current.view, state.settings) ? current : null;
    }

    function clearPromptError(view) {
        if (view.promptJob && !view.promptJob.controller) {
            view.promptJob = null;
        }
    }

    /**
     * 中止进行中的提示词请求并回到第 1 步。
     * @returns {boolean} 是否真的中止了一个请求。
     */
    function abortPromptJob(view) {
        const job = view.promptJob;
        view.promptJob = null;
        if (view.autoStep === 2) {
            view.autoStep = 1;
        }
        if (job?.controller) {
            job.controller.abort();
            return true;
        }
        return false;
    }

    /**
     * @param {string} identity core/image-message.js 的 messageIdentity。
     * @returns {boolean} 是否切换了。
     */
    function toggleChatImageSelection(identity) {
        const current = getSelectingView();
        if (!current || !identity) {
            return false;
        }
        const index = findMessageIndexByIdentity(current.messages, identity);
        if (index < 0 || !isPromptSourceMessage(current.messages[index])) {
            return false;
        }
        const { view } = current;
        if (view.selected.has(identity)) {
            view.selected.delete(identity);
        } else {
            view.selected.add(identity);
        }
        view.selectionInitialized = true;
        clearPromptError(view);
        render();
        return true;
    }

    /**
     * 快速选择：只勾选最近 count 条可参与的消息。
     * @param {number} count 条数。
     */
    function selectRecentChatImageMessages(count) {
        const current = getSelectingView();
        if (!current) {
            return;
        }
        current.view.selected = pickRecentPromptSources(current.messages, count);
        current.view.selectionInitialized = true;
        clearPromptError(current.view);
        render();
    }

    function clearChatImageSelection() {
        const current = getSelectingView();
        if (!current) {
            return;
        }
        current.view.selected = new Set();
        current.view.selectionInitialized = true;
        clearPromptError(current.view);
        render();
    }

    /**
     * @param {boolean} enabled 是否附带角色外貌。
     */
    function setChatImageIncludeAppearance(enabled) {
        const { view } = getCurrent();
        if (!view || view.autoStep === 2) {
            return;
        }
        view.includeAppearance = Boolean(enabled);
        render();
    }

    // 摘要卡（懒加载角色列表）没有 description，要取完整卡；已经取过的用 state.characterDetails 里的
    async function loadFullCharacter(character, signal) {
        if (!character || getCharacterDescription(character) || !character.shallow || !character.avatar) {
            return character;
        }
        const cached = state.characterDetails?.[character.avatar];
        if (cached) {
            return cached;
        }
        try {
            const full = await apiFetch('/api/characters/get', { body: { avatar_url: character.avatar }, signal });
            return full && typeof full === 'object' ? full : character;
        } catch (error) {
            if (isAbortError(error)) {
                throw error;
            }
            throw new Error(`角色卡「${resolveCharacterName(character)}」读取失败，可以关掉「附带角色外貌」后重试。`);
        }
    }

    async function resolveAppearance(sources, signal) {
        const entity = registry.getSelectedChatEntity?.();
        const groupMode = Boolean(registry.isGroupChatMode?.());
        const targets = groupMode
            ? findGroupAppearanceCharacters({ sources, group: entity, characters: state.characters })
            : (entity ? [entity] : []);
        const userName = resolveUserName(state);
        const entries = [];
        for (const target of targets) {
            const character = await loadFullCharacter(target, signal);
            entries.push({
                name: resolveCharacterName(character),
                description: formatGreetingText(getCharacterDescription(character), character, userName),
            });
        }
        return buildAppearanceText(entries);
    }

    /**
     * 用勾选的消息生成图片提示词：第 1 / 3 步可以发起（第 3 步即「重新生成提示词」），成功后填进提示词框并进入第 3 步；
     * 失败回到第 1 步并显示原因；取消回到第 1 步。
     */
    async function generateChatImagePrompt() {
        const { cacheKey, messages } = getCurrent();
        if (!cacheKey) {
            return;
        }
        const view = getChatImageView(state, cacheKey);
        if (view.mode !== 'image' || view.sub !== 'auto' || view.autoStep === 2) {
            return;
        }

        const sources = selectPromptSources(view.selected, messages);
        const fail = message => {
            view.promptJob = { controller: null, error: message };
            view.autoStep = 1;
            render();
        };
        const gate = getPromptGenerationGate({ settings: state.settings, engine: state.engine, sources });
        if (!gate.ok) {
            if (gate.code === 'busy') {
                showToast('暂时不能生成提示词', gate.reason);
                return;
            }
            fail(gate.reason);
            return;
        }

        let requestSettings;
        try {
            requestSettings = getChatCompletionSettingsForTest({
                oaiSettings: apiConnection.getOaiSettings ? apiConnection.getOaiSettings() : (state.settings?.oai_settings || {}),
                settings: state.settings,
                getChatCompletionModel,
                getNumberSetting: apiConnection.getNumberSetting,
            });
        } catch {
            fail(PROMPT_GENERATION_NO_MODEL_MESSAGE);
            return;
        }

        const controller = new AbortController();
        /** @type {{ controller: AbortController | null, error: string }} */
        const job = { controller, error: '' };
        view.promptJob = job;
        view.autoStep = 2;
        render();

        try {
            const appearance = view.includeAppearance ? await resolveAppearance(sources, controller.signal) : '';
            const promptMessages = buildImagePromptMessages({
                template: getImageGenerationConfig(state.settings).promptGen.template,
                appearance,
                selected: toPromptSourceLines(sources, resolveUserName(state)),
            });
            const body = createChatCompletionRequestBody(requestSettings, promptMessages);
            const response = await apiFetch(CHAT_COMPLETION_GENERATE_API, { body, signal: controller.signal });
            const reply = readConnectionTestReply(response);
            const text = reply.text.trim();
            if (!text) {
                throw new Error('模型只返回了推理内容，没有给出提示词。可以调大回复长度后重试。');
            }
            if (view.promptJob !== job) {
                return;
            }
            view.promptJob = null;
            // 生成期间离开了「从消息生成」（切到手动输入）：丢掉结果，不覆盖提示词框
            if (view.mode !== 'image' || view.sub !== 'auto') {
                view.autoStep = 1;
                render();
                return;
            }
            view.prompt = text;
            view.promptFrom = sources.length;
            view.autoStep = 3;
            render();
        } catch (error) {
            if (view.promptJob !== job) {
                return;
            }
            if (isAbortError(error) || controller.signal.aborted) {
                view.promptJob = null;
                view.autoStep = 1;
                render();
                return;
            }
            fail(describePromptGenerationFailure(error));
        }
    }

    function cancelChatImagePrompt() {
        const { view } = getCurrent();
        if (!view?.promptJob?.controller) {
            return;
        }
        abortPromptJob(view);
        showToast('已取消生成提示词', '没有写入聊天记录。');
        render();
    }

    function returnToChatImageSelection() {
        const { view } = getCurrent();
        if (!view) {
            return;
        }
        abortPromptJob(view);
        view.autoStep = 1;
        render();
    }

    function exitChatImageSelection() {
        const { view } = getCurrent();
        if (!view) {
            return;
        }
        abortPromptJob(view);
        view.sub = 'manual';
        render();
    }

    return {
        toggleChatImageSelection,
        selectRecentChatImageMessages,
        clearChatImageSelection,
        setChatImageIncludeAppearance,
        generateChatImagePrompt,
        cancelChatImagePrompt,
        returnToChatImageSelection,
        exitChatImageSelection,
    };
}
