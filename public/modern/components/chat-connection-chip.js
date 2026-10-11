// 输入框下方的连接标签（B1：聊天内切换模型和连接档案）。renderChatConnectionChip 的结果放进 chat-composer.js 的 .composer-meta 行，
// 与 chat-usage-label.js 的用量标签并排（本标签靠左，用量标签靠右）。别的功能不要改这个文件。
//
// 标签显示当前生效的连接（getEffectiveConnection）；点开后是一个弹层：连接档案列表（标出当前档案）、当前来源最近用过的模型、
// 「从当前连接创建档案」、上一次切换的结果明细，以及去 API 页的链接。点击、键盘和外部点击关闭都写在 routes/chat-connection-events.js，
// 业务动作在 actions/connection-profiles.js（注册在 shell/feature-slot-actions.js）。
// 生成中或正在切换时标签是禁用的，并把原因写在标签旁边；弹层是否展开存在 state.connectionSwitcher.open。
import { getEffectiveConnection } from '../core/connection-labels.js';
import {
    buildConnectionSwitcherView,
    formatApplySummary,
    getSwitchBlocker,
    getSwitcherState,
} from '../actions/connection-profiles.js';
import { escapeHtml } from '../core/utils.js';

/**
 * 上一次切换结果的明细：已应用的项和跳过的项（带原因）。
 * @param {import('../actions/connection-profiles.js').SwitchResult} result 切换结果
 * @param {{ dismissAttribute: string }} options 收起按钮使用的 data 属性名（聊天弹层和 API 页各用各的）
 * @returns {string} HTML
 */
export function renderSwitchResult(result, { dismissAttribute }) {
    const applied = result.applied.map(item => `
        <li class="is-applied"><i class="fa-solid fa-check" aria-hidden="true"></i><span><strong>${escapeHtml(item.label)}</strong>${escapeHtml(item.value)}</span></li>
    `).join('');
    const skipped = result.skipped.map(item => `
        <li class="is-skipped"><i class="fa-solid fa-ban" aria-hidden="true"></i><span><strong>${escapeHtml(item.label)}</strong>${escapeHtml(item.reason)}</span></li>
    `).join('');
    return `
        <section class="connection-result" data-connection-result role="status" aria-live="polite">
            <div class="connection-result-head">
                <strong>${escapeHtml(result.title)}</strong>
                <button class="icon-button compact-icon" type="button" ${dismissAttribute} aria-label="收起切换结果" title="收起切换结果">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>
            </div>
            <p class="connection-result-summary">${escapeHtml(result.summary || formatApplySummary(result))}</p>
            ${result.warning ? `<p class="connection-result-warning">${escapeHtml(result.warning)}</p>` : ''}
            ${applied || skipped ? `<ul class="connection-result-list">${applied}${skipped}</ul>` : ''}
        </section>
    `;
}

export function createChatConnectionChipComponent(ctx) {
    const { state, getProviderInfo } = ctx;

    function renderProfileList(view, busy) {
        if (!view.profiles.length) {
            return '<p class="connection-empty">还没有连接档案。把当前连接存成档案后，可以在这里一键切换。</p>';
        }
        return `
            <ul class="connection-list" aria-label="连接档案">
                ${view.profiles.map(profile => `
                    <li>
                        <button class="connection-option${profile.current ? ' is-current' : ''}" type="button" data-connection-profile-apply="${escapeHtml(profile.id)}" data-connection-focusable ${profile.current ? 'aria-current="true"' : ''} ${busy ? 'disabled' : ''} title="${profile.current ? '当前档案，点击重新应用' : '应用这个档案'}">
                            <span class="connection-option-main">
                                <span class="connection-option-name">${escapeHtml(profile.name)}</span>
                                <span class="connection-option-summary">${escapeHtml(profile.summary || profile.modeLabel)}</span>
                            </span>
                            ${profile.current ? '<span class="badge active">当前</span>' : ''}
                        </button>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    function renderModelList(view, busy) {
        if (!view.models.supported) {
            return '<p class="connection-empty">当前 API 不能在这里换模型，请到 API 页修改。</p>';
        }
        if (!view.models.items.length) {
            return '<p class="connection-empty">还没有模型记录。在 API 页保存连接后，用过的模型会出现在这里。</p>';
        }
        return `
            <ul class="connection-list" aria-label="最近使用的模型">
                ${view.models.items.map(item => `
                    <li>
                        <button class="connection-option connection-option-model${item.current ? ' is-current' : ''}" type="button" data-connection-model="${escapeHtml(item.model)}" data-connection-focusable ${item.current ? 'aria-current="true"' : ''} ${busy || item.current ? 'disabled' : ''} title="${item.current ? '正在使用' : `切换到 ${escapeHtml(item.model)}`}">
                            <span class="connection-option-main"><span class="connection-option-name">${escapeHtml(item.model)}</span></span>
                            ${item.current ? '<span class="badge active">当前</span>' : ''}
                        </button>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    function renderCreateSection(switcher, busy) {
        if (!switcher.createOpen) {
            return `
                <button class="secondary-button compact-button" type="button" data-connection-create-open data-connection-focusable ${busy ? 'disabled' : ''}>
                    <i class="fa-solid fa-plus" aria-hidden="true"></i>
                    从当前连接创建档案
                </button>
            `;
        }
        return `
            <div class="connection-create-form" data-connection-create-form>
                <label class="field-label">
                    <span>档案名称</span>
                    <input class="text-input" type="text" maxlength="80" autocomplete="off" data-connection-create-name data-connection-focusable value="${escapeHtml(switcher.createName)}" ${switcher.error ? 'aria-invalid="true" aria-describedby="connection-create-error"' : ''}>
                </label>
                ${switcher.error ? `<p class="field-error" id="connection-create-error" role="alert" data-connection-error>${escapeHtml(switcher.error)}</p>` : ''}
                <div class="connection-create-actions">
                    <button class="primary-button compact-button" type="button" data-connection-create-submit data-connection-focusable ${busy ? 'disabled' : ''}>保存档案</button>
                    <button class="secondary-button compact-button" type="button" data-connection-create-cancel data-connection-focusable>取消</button>
                </div>
            </div>
        `;
    }

    function renderPopover(switcher, connection, busy) {
        const view = buildConnectionSwitcherView({ settings: state.settings || {} });
        return `
            <div class="connection-popover" id="connection-popover" role="dialog" aria-label="切换连接" data-connection-popover>
                <div class="connection-popover-head">
                    <div class="connection-popover-title">
                        <strong>切换连接</strong>
                        <span title="${escapeHtml(connection.title)}">当前：${escapeHtml(connection.label)}</span>
                    </div>
                    <button class="icon-button compact-icon" type="button" data-connection-close aria-label="关闭" title="关闭（Esc）">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </div>
                ${busy ? `<p class="connection-busy" role="status"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i>${escapeHtml(switcher.busyLabel || '正在切换连接')}</p>` : ''}
                <section class="connection-section">
                    <h3 class="connection-section-title">连接档案</h3>
                    ${renderProfileList(view, busy)}
                    ${renderCreateSection(switcher, busy)}
                </section>
                <section class="connection-section">
                    <h3 class="connection-section-title">最近使用的模型${view.models.sourceLabel ? `<span>${escapeHtml(view.models.sourceLabel)}</span>` : ''}</h3>
                    ${renderModelList(view, busy)}
                </section>
                ${switcher.lastResult ? renderSwitchResult(switcher.lastResult, { dismissAttribute: 'data-connection-result-dismiss' }) : ''}
                <div class="connection-popover-foot">
                    <button class="secondary-button compact-button" type="button" data-route="api" data-connection-focusable>
                        <i class="fa-solid fa-plug" aria-hidden="true"></i>
                        打开 API 页
                    </button>
                    <p>档案里的预设、代理按名称精确匹配，找不到的项会跳过并说明原因，不会改用名称相近的项。</p>
                </div>
            </div>
        `;
    }

    function renderChatConnectionChip() {
        // 还没选主 API 时没有连接可显示，也没有「当前连接」可以存成档案
        if (!state.settings?.main_api) {
            return '';
        }
        const switcher = getSwitcherState(state);
        const connection = getEffectiveConnection(state.settings, getProviderInfo());
        const blocker = getSwitchBlocker(state);
        // 生成中不展开弹层：正在发生的生成已经占用引擎，这时改连接没有意义
        const open = switcher.open && !state.engine?.generating;
        const busy = switcher.busy;
        const titleLines = [
            connection.title,
            blocker ? `现在不能切换：${blocker}` : '点击切换连接档案或模型',
        ];

        return `
        <div class="connection-switcher${open ? ' is-open' : ''}" data-connection-switcher>
            <button class="connection-chip" type="button" data-connection-chip aria-haspopup="dialog" aria-expanded="${open ? 'true' : 'false'}" aria-controls="connection-popover" title="${escapeHtml(titleLines.join('\n'))}" ${blocker ? 'disabled' : ''}>
                <i class="fa-solid fa-plug" aria-hidden="true"></i>
                <span class="connection-chip-label">${escapeHtml(connection.label)}</span>
                ${blocker
        ? `<span class="connection-chip-note" data-connection-chip-note>${state.engine?.generating ? '生成中不可切换' : '切换中'}</span>`
        : '<i class="fa-solid fa-chevron-up connection-chip-caret" aria-hidden="true"></i>'}
            </button>
            ${open ? renderPopover(switcher, connection, busy) : ''}
        </div>
    `;
    }

    return {
        renderChatConnectionChip,
    };
}
