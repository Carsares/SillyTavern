// 输入框下方的「上次发送 X / 预算 Y token」用量标签。
// 数据来自 state.inspector.itemizedPrompt 里缓存的提示词分解快照（与上下文抽屉共用同一份），渲染本身不发任何请求：
// 快照由 actions/inspector-itemized.js 在生成结束后、打开抽屉或点击刷新时更新。
// 标签放进 chat-composer.js 的 .composer-meta 行，与 chat-connection-chip.js 的连接标签并排。
import { escapeHtml, formatNumber } from '../core/utils.js';
import { formatPercent, getUsageSummary } from '../actions/chat-completion-limits.js';

// 占用达到这两个比例时换颜色提醒
const HIGH_USAGE_PERCENT = 90;
const OVER_USAGE_PERCENT = 100;

/**
 * 当前聊天可显示的用量，没有可用快照时返回 null。
 * 快照必须属于正在查看的聊天（切换聊天后上一个聊天的快照不显示），读取失败过的快照也不显示。
 * @param {any} state 全局界面状态
 * @returns {{ text: string, title: string, level: '' | 'is-high' | 'is-over', percentText: string } | null} 标签内容
 */
export function getChatUsageView(state) {
    const view = state.inspector?.itemizedPrompt;
    if (!view?.loaded || !view.data || view.error || view.chatId !== state.selected?.chat) {
        return null;
    }

    const usage = getUsageSummary(view.data, state.settings);
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

    return {
        text: `上次发送 ${formatNumber(usage.used)} / 预算 ${formatNumber(usage.budget)} token`,
        title: [
            `上次生成的提示词共 ${formatNumber(usage.used)} token${percentText ? `，占提示词预算的 ${percentText}` : ''}`,
            ...budgetParts,
            '按当前设置计算预算，超出预算时旧版会从最早的历史开始丢弃',
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
    return `<span class="chat-usage-label${usage.level ? ` ${usage.level}` : ''}" data-chat-usage-label data-usage-percent="${escapeHtml(usage.percentText)}" title="${escapeHtml(usage.title)}">${escapeHtml(usage.text)}</span>`;
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
