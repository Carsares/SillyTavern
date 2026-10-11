// 「预估下次发送」（A1 第二阶段）的纯函数：判断一份估算是否还能用、把引擎的回复整理成界面状态、给「估不了」的原因配中文说明。
// 不碰 DOM、不发请求，jest 直接测试（tests/modern-prompt-estimate.test.js）。请求和触发时机在 actions/prompt-estimate.js，
// 输入框下方的用量标签（components/chat-usage-label.js）和上下文抽屉（shell/inspector-sections.js）共用这里的判断。
// 引擎侧是 public/script.js 的 handleModernBridgeEstimatePrompt，回复格式见 core/bridge-protocol.js 的 ESTIMATE_PROMPT。

// 估不了的原因（引擎回复的 reason，另有 failed：Modern 自动估算时请求失败，只留原因不弹错误）。
const REASON_TEXT = Object.freeze({
    group: '群聊暂不支持估算。',
    'no-character': '没有选中角色，无法估算。',
    'unsupported-api': '当前主 API（Horde）暂不支持估算。',
    budget: '必选提示词已超出提示词预算，请调大上下文长度，或关闭部分自定义提示词。',
    'no-data': '生成引擎没能拼出提示词，请检查连接设置后重试。',
    failed: '自动估算没有成功，可以点击「估算下次发送」重试。',
});

/**
 * 估不了的原因的中文说明。
 * @param {string} reason 引擎回复的 reason 或 failed
 * @param {string} [message] 引擎附带的原始说明，目前只有 prompt-error 用它
 * @returns {string} 说明文字，没有原因时返回空字符串
 */
export function describePromptEstimateReason(reason, message = '') {
    if (!reason) {
        return '';
    }
    if (reason === 'prompt-error') {
        return message ? `拼装提示词时出错：${message}` : '拼装提示词时出错。';
    }
    return REASON_TEXT[reason] || '暂时无法估算。';
}

/**
 * 把引擎对 ESTIMATE_PROMPT 的回复整理成界面状态。可用的估算必须带有限的 totalTokens 和 maxContext；
 * 其余情况（available 为 false、旧版引擎不认识这个动作而回了 { ok: true } 等）一律按「估不了」处理，没有原因时记为 no-data。
 * @param {any} reply callLegacyBridge 的返回值
 * @returns {{ data: any, reason: string, message: string }} 可用时 data 为回复本身，reason 为空；否则 data 为 null
 */
export function normalizePromptEstimateReply(reply) {
    if (reply && reply.available === true && Number.isFinite(Number(reply.totalTokens)) && Number.isFinite(Number(reply.maxContext))) {
        return { data: reply, reason: '', message: '' };
    }

    return {
        data: null,
        reason: typeof reply?.reason === 'string' && reply.reason ? reply.reason : 'no-data',
        message: typeof reply?.message === 'string' ? reply.message : '',
    };
}

/**
 * 当前聊天可以显示的估算，没有就返回 null。必须已读到、属于正在查看的聊天、没有失败过、引擎确实给出了数字。
 * 生成结束、切换聊天、手动估算失败后它都会变回 null，用量标签随之退回「上次发送」。
 * @param {any} state 全局界面状态
 * @returns {any | null} 引擎回传的估算快照
 */
export function getValidPromptEstimate(state) {
    const view = state?.inspector?.promptEstimate;
    if (!view?.loaded || view.error || !view.data || view.data.available === false || view.chatId !== state.selected?.chat) {
        return null;
    }
    return view.data;
}

/**
 * 上下文抽屉「提示词预算」区块要显示什么。
 * kind：group（群聊不支持，按钮不可用）、loading、error（手动估算失败）、estimate（有可用的估算）、reason（引擎说明估不了）、idle（还没估过）。
 * 手动按钮在估算进行中、生成进行中、群聊里不可用；这几种情况下 buttonTitle 说明原因。
 * @param {any} state 全局界面状态
 * @param {{ groupMode?: boolean }} [options] groupMode 当前是否群聊
 * @returns {{ kind: 'group' | 'loading' | 'error' | 'estimate' | 'reason' | 'idle', text: string, data: any, buttonDisabled: boolean, buttonTitle: string }} 区块状态
 */
export function getPromptEstimateSectionView(state, { groupMode = false } = {}) {
    const view = state?.inspector?.promptEstimate || {};
    const generating = Boolean(state?.engine?.generating);
    const loading = Boolean(view.loading);
    const estimate = getValidPromptEstimate(state);
    const sameChat = view.chatId === state?.selected?.chat;

    let buttonTitle = '按当前设置模拟一次发送，数出下次发送的提示词 token';
    if (groupMode) {
        buttonTitle = describePromptEstimateReason('group');
    } else if (generating) {
        buttonTitle = '正在生成，结束后再估算';
    } else if (loading) {
        buttonTitle = '正在估算';
    }
    const buttonDisabled = groupMode || generating || loading;

    if (groupMode) {
        return { kind: 'group', text: describePromptEstimateReason('group'), data: null, buttonDisabled, buttonTitle };
    }
    if (loading && !estimate) {
        return { kind: 'loading', text: '正在估算…', data: null, buttonDisabled, buttonTitle };
    }
    if (estimate) {
        return { kind: 'estimate', text: '', data: estimate, buttonDisabled, buttonTitle };
    }
    if (view.error) {
        return { kind: 'error', text: `估算失败：${view.error}`, data: null, buttonDisabled, buttonTitle };
    }
    if (view.reason && sameChat) {
        return { kind: 'reason', text: describePromptEstimateReason(view.reason, view.message), data: null, buttonDisabled, buttonTitle };
    }
    return { kind: 'idle', text: '尚未估算。点击「估算下次发送」，按当前设置模拟一次发送。', data: null, buttonDisabled, buttonTitle };
}
