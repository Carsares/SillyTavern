// 输入框下方的「上次发送 X / 预算 Y token」用量标签，有可用的估算时改显示「预估下次发送 X / 预算 Y token」。
// 数据来自 state.inspector 里缓存的两份快照（与上下文抽屉共用），渲染本身不发任何请求：
// - itemizedPrompt：上一次真实发送的提示词分解，由 actions/inspector-itemized.js 在生成结束后、打开抽屉或点击刷新时更新；
// - promptEstimate：按当前设置模拟一次发送的估算，由 actions/prompt-estimate.js 更新，一次生成结束后作废。
// 估算可用时优先显示它（更接近用户接下来要发的内容），否则显示上次发送。
// 标签放进 chat-composer.js 的 .composer-meta 行，与 chat-connection-chip.js 的连接标签并排。
import { escapeHtml, formatNumber } from '../core/utils.js';
import { formatPercent, getUsageSummary } from '../actions/chat-completion-limits.js';
import { getValidPromptEstimate } from '../core/prompt-estimate.js';

// 占用达到这两个比例时换颜色提醒
const HIGH_USAGE_PERCENT = 90;
const OVER_USAGE_PERCENT = 100;

/**
 * 当前聊天可显示的用量，没有可用快照时返回 null。
 * 有可用的估算（属于正在查看的聊天、没有失败过）时显示「预估下次发送」，否则显示「上次发送」。
 * 上次发送的快照必须属于正在查看的聊天（切换聊天后上一个聊天的快照不显示），读取失败过的快照也不显示。
 * @param {any} state 全局界面状态
 * @returns {{ kind: 'estimate' | 'last', text: string, title: string, level: '' | 'is-high' | 'is-over', percentText: string } | null} 标签内容
 */
export function getChatUsageView(state) {
    const estimate = getValidPromptEstimate(state);
    if (estimate) {
        const view = buildUsageView(estimate, state.settings, 'estimate');
        if (view) {
            return view;
        }
    }

    const itemized = state.inspector?.itemizedPrompt;
    if (!itemized?.loaded || !itemized.data || itemized.error || itemized.chatId !== state.selected?.chat) {
        return null;
    }
    return buildUsageView(itemized.data, state.settings, 'last');
}

/**
 * @param {any} snapshot 引擎回传的快照（上次发送的分解或估算），字段 totalTokens / maxContext / mainApi 相同
 * @param {any} settings state.settings
 * @param {'estimate' | 'last'} kind 标签种类
 * @returns {NonNullable<ReturnType<typeof getChatUsageView>> | null} 标签内容，快照没有可用数字时为 null
 */
function buildUsageView(snapshot, settings, kind) {
    const usage = getUsageSummary(snapshot, settings);
    if (!usage) {
        return null;
    }

    const budgetParts = [];
    if (usage.contextLimit !== null && usage.responseLimit !== null) {
        budgetParts.push(`提示词预算 = 上下文 ${formatNumber(usage.contextLimit)} − 回复上限 ${formatNumber(usage.responseLimit)}`);
    }
    const percentText = usage.percent === null ? '' : `${formatPercent(usage.percent)}%`;
    /** @type {'' | 'is-high' | 'is-over'} */
    let level = '';
    if (usage.percent !== null && usage.percent >= OVER_USAGE_PERCENT) {
        level = 'is-over';
    } else if (usage.percent !== null && usage.percent >= HIGH_USAGE_PERCENT) {
        level = 'is-high';
    }

    if (kind === 'estimate') {
        return {
            kind,
            text: `预估下次发送 ${formatNumber(usage.used)} / 预算 ${formatNumber(usage.budget)} token`,
            title: [
                `按当前设置模拟一次发送，提示词约 ${formatNumber(usage.used)} token${percentText ? `，占提示词预算的 ${percentText}` : ''}`,
                '不含输入框里未发送的文字',
                ...budgetParts,
                '超出预算时会从最早的历史开始丢弃',
            ].join('；'),
            level,
            percentText,
        };
    }

    return {
        kind,
        text: `上次发送 ${formatNumber(usage.used)} / 预算 ${formatNumber(usage.budget)} token`,
        title: [
            `上次生成的提示词共 ${formatNumber(usage.used)} token${percentText ? `，占提示词预算的 ${percentText}` : ''}`,
            ...budgetParts,
            '按当前设置计算预算，超出预算时会从最早的历史开始丢弃',
        ].join('；'),
        level,
        percentText,
    };
}

/**
 * 标签的 HTML。
 * @param {NonNullable<ReturnType<typeof getChatUsageView>>} usage getChatUsageView 的结果
 * @returns {string} HTML
 */
function renderUsageLabelHtml(usage) {
    // 上次发送的标签保持原样；估算多一个 is-estimate 类和 data-usage-kind，供样式和测试区分
    const estimate = usage.kind === 'estimate';
    const classes = ['chat-usage-label', ...(estimate ? ['is-estimate'] : []), ...(usage.level ? [usage.level] : [])].join(' ');
    return `<span class="${classes}" data-chat-usage-label${estimate ? ' data-usage-kind="estimate"' : ''} data-usage-percent="${escapeHtml(usage.percentText)}" title="${escapeHtml(usage.title)}">${escapeHtml(usage.text)}</span>`;
}

export function createChatUsageLabelComponent(ctx) {
    const { state } = ctx;

    function renderChatUsageLabel() {
        const usage = getChatUsageView(state);
        return usage ? renderUsageLabelHtml(usage) : '';
    }

    return {
        renderChatUsageLabel,
    };
}

/**
 * 快照在聊天页已经渲染之后才变化时（生成结束后的自动刷新、抽屉里点刷新），就地更新输入框下方的标签，
 * 不重绘聊天页，输入框里的草稿和光标不受影响。标签不该显示时移除它，移除后元信息行空了就一并移除。
 * 没有输入框（不在聊天页）时什么也不做。
 * @param {any} state 全局界面状态
 * @param {ParentNode} [root] 查找输入框的范围
 */
export function syncChatUsageLabels(state, root = document) {
    const composer = root.querySelector('.composer');
    if (!composer) {
        return;
    }

    const usage = getChatUsageView(state);
    const existing = composer.querySelector('[data-chat-usage-label]');
    if (!usage) {
        const meta = existing?.closest('[data-composer-meta]');
        existing?.remove();
        if (meta && !meta.children.length && !meta.textContent?.trim()) {
            meta.remove();
        }
        return;
    }

    const template = composer.ownerDocument.createElement('template');
    template.innerHTML = renderUsageLabelHtml(usage);
    const next = template.content.firstElementChild;
    if (!next) {
        return;
    }
    if (existing) {
        if (!existing.isEqualNode(next)) {
            existing.replaceWith(next);
        }
        return;
    }

    let meta = composer.querySelector('[data-composer-meta]');
    if (!meta) {
        meta = composer.ownerDocument.createElement('div');
        meta.className = 'composer-meta';
        meta.setAttribute('data-composer-meta', '');
        // 与 chat-composer.js 的模板顺序一致：元信息行在「手动发言」按钮行之前
        composer.insertBefore(meta, composer.querySelector('.composer-manual-speakers'));
    }
    meta.append(next);
}
