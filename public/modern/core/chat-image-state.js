/**
 * 会话内生图的界面状态（state.chatImageGeneration）。只存内存，刷新后回到文本模式；进行中的任务另存 sessionStorage，
 * 刷新后由 actions/chat-image-generation.js 找回结果。
 *
 *   chats: Map<cacheKey, ChatImageView>   每个聊天文件一份（cacheKey = `${contextKey}::${chatId}`，即 getCurrentDraftKey()）
 *   job: ImageJob | null                   全局唯一的进行中 / 刚结束的生图任务（后端限制每个用户同时只跑一单）
 *   lightbox: { cacheKey, identity, index } | null   打开的大图
 */

/** sessionStorage 里记进行中任务的键。 */
export const IMAGE_JOB_STORAGE_KEY = 'st-modern-image-job';

/**
 * @typedef {object} ChatImageView
 * @property {'text'|'image'} mode 输入框模式。
 * @property {'manual'|'auto'} sub 图片模式下的子模式：手动输入 / 从消息生成。
 * @property {1|2|3} autoStep 从消息生成的步骤：1 勾选，2 生成提示词中，3 确认并生成。
 * @property {Set<string>} selected 勾选的消息身份（core/image-message.js 的 messageIdentity）。
 * @property {boolean} selectionInitialized 是否已按默认条数预选过。
 * @property {string} prompt 提示词草稿。
 * @property {Record<string, any>} params 本次覆盖的参数（size、quality…），未覆盖的用配置默认值。
 * @property {boolean} showAdvanced 是否展开高级参数。
 * @property {number} promptFrom 提示词由几条消息生成（0 表示手动）。
 * @property {boolean} includeAppearance 是否附带角色外貌。
 * @property {{ controller: AbortController | null, error: string } | null} promptJob 生成提示词的进行中请求。
 */

/**
 * @typedef {object} ImageJob
 * @property {string} requestId 后端请求 id。
 * @property {'pending'|'failed'|'unknown'} status 进行中 / 明确失败 / 结果未知（成功后直接写入聊天并清掉任务）。
 * @property {string} cacheKey 发起生成的聊天。
 * @property {string} contextKey 角色 avatar 或 group:<id>。
 * @property {string} chatId 聊天文件名。
 * @property {boolean} groupMode 是否群聊。
 * @property {'new'|'version'} kind 新消息 / 给已有图片消息加版本。
 * @property {string} targetIdentity kind 为 version 时的目标消息身份。
 * @property {string} prompt 提示词。
 * @property {string} negativePrompt 反向提示词。
 * @property {Record<string, any>} params 实际发送的参数。
 * @property {string} provider 供应商 id。
 * @property {string} model 模型名。
 * @property {'manual'|'messages'} origin 提示词来源。
 * @property {number} sourceCount 从几条消息生成。
 * @property {number} startedAt 开始时间（毫秒）。
 * @property {number} ratio 占位卡片的高宽比。
 * @property {{ code: string, message: string, detail: string, outcome: string } | null} failure 失败信息。
 */

/**
 * @param {any} state 全局状态。
 * @returns {{ chats: Map<string, ChatImageView>, job: ImageJob | null, lightbox: { cacheKey: string, identity: string, index: number } | null }}
 */
export function ensureChatImageState(state) {
    const slot = state.chatImageGeneration || (state.chatImageGeneration = {});
    if (!(slot.chats instanceof Map)) {
        slot.chats = new Map();
    }
    if (slot.job === undefined) {
        slot.job = null;
    }
    if (slot.lightbox === undefined) {
        slot.lightbox = null;
    }
    return slot;
}

/**
 * 取（必要时创建）某个聊天的图片界面状态。
 * @param {any} state 全局状态。
 * @param {string} cacheKey 聊天的 cacheKey。
 * @returns {ChatImageView}
 */
export function getChatImageView(state, cacheKey) {
    const slot = ensureChatImageState(state);
    let view = slot.chats.get(cacheKey);
    if (!view) {
        view = {
            mode: 'text',
            sub: 'manual',
            autoStep: 1,
            selected: new Set(),
            selectionInitialized: false,
            prompt: '',
            params: {},
            showAdvanced: false,
            promptFrom: 0,
            includeAppearance: true,
            promptJob: null,
        };
        slot.chats.set(cacheKey, view);
    }
    return view;
}

/**
 * @param {any} state 全局状态。
 * @param {string} cacheKey 聊天的 cacheKey。
 * @returns {ChatImageView | null} 已有的状态，没有时为 null（渲染时用，不创建）。
 */
export function peekChatImageView(state, cacheKey) {
    return ensureChatImageState(state).chats.get(cacheKey) || null;
}

/**
 * @param {any} state 全局状态。
 * @returns {boolean} 是否有图片任务正在进行（此时 state.engine.generating 也为真，activity 为 'image'）。
 */
export function isImageJobPending(state) {
    return ensureChatImageState(state).job?.status === 'pending';
}
