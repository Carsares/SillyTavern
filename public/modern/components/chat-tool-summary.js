// 聊天工具「聊天摘要」面板（A6）：看当前聊天的摘要、编辑、清除，以及「重新摘要」。
// 数据规则在 core/chat-summary.js，动作在 actions/chat-summary.js（面板的读写）和 actions/chat-generation.js（生成摘要），
// 事件在 routes/chat-tool-summary-events.js，接入方式见 chat-tools.js 顶部注释。
// 输入框的改动只写进草稿、不重新渲染（重渲染会让输入框失去焦点）；未保存标记、保存按钮的可用状态由事件文件按 data-cs-* 属性就地更新。
export function createChatToolSummaryPanel(ctx) {
    const { escapeHtml } = ctx;

    function renderRunNotice(view) {
        if (!view.runNotice) {
            return '';
        }
        const kind = view.runNotice.kind === 'success' ? 'success' : (view.runNotice.kind === 'info' ? 'info' : 'warning');
        const role = kind === 'success' ? 'status' : 'alert';
        return `<p class="chat-summary-message ${kind}" role="${role}" data-cs-run-notice>${escapeHtml(view.runNotice.text)}</p>`;
    }

    function renderSourceWarning(view) {
        if (!view.needsSourceSwitch) {
            return '';
        }
        return `
        <div class="chat-summary-callout" role="alert" data-cs-source-warning>
            <p>摘要来源现在是 Extras API。它需要连接 Extras 服务器，这里没有连接，所以不会自动摘要，「重新摘要」也不能用。把来源改成主模型后，每次摘要会多一次主模型调用。</p>
            <button class="secondary-button" type="button" data-cs-open-settings>
                <i class="fa-solid fa-gear"></i>
                前往设置切换为主模型
            </button>
        </div>
    `;
    }

    function renderFeedback(view) {
        return `
        <div class="chat-summary-feedback">
            <p class="chat-summary-message error" role="alert" data-cs-message="error" ${view.error ? '' : 'hidden'}>${escapeHtml(view.error || '')}</p>
            <p class="chat-summary-message warning" role="alert" data-cs-message="warning" ${view.warning ? '' : 'hidden'}>${escapeHtml(view.warning || '')}</p>
            <p class="chat-summary-message warning" role="alert" data-cs-message="stale" ${view.stale ? '' : 'hidden'}>聊天里的摘要已经变了（重新摘要或在别处修改）。保存会用下面的内容覆盖它；点「还原」读取最新的摘要。</p>
            <p class="chat-summary-message success" role="status" data-cs-message="notice" ${view.notice ? '' : 'hidden'}>${escapeHtml(view.notice || '')}</p>
        </div>
    `;
    }

    function renderEditor(view) {
        const busy = view.saving || view.generating;
        const location = view.hasSummary
            ? `位于第 ${view.summaryIndex + 1} 条消息${view.holder ? `（${escapeHtml(view.holder)}）` : ''}`
            : '聊天里还没有摘要';
        return `
        <div class="settings-form chat-summary-form">
            <label class="field-label">
                <span class="chat-summary-label">当前摘要 <span class="authors-note-hint" data-cs-location>${location}</span></span>
                <textarea rows="10" data-cs-input ${view.generating ? 'readonly' : ''} placeholder="还没有摘要。点「重新摘要」让模型生成，或者直接在这里写一份再保存。">${escapeHtml(view.draft)}</textarea>
            </label>
            ${view.generating ? '<p class="authors-note-hint">正在生成，生成结束后才能修改摘要。</p>' : ''}
            ${renderFeedback(view)}
            <div class="chat-summary-actions">
                <span class="badge" data-cs-dirty ${view.dirty ? '' : 'hidden'}>有未保存的修改</span>
                ${view.confirmClear ? `
                    <span class="chat-summary-confirm">清除第 ${view.summaryIndex + 1} 条消息上的摘要？</span>
                    <button class="secondary-button" type="button" data-cs-clear-cancel>
                        <i class="fa-solid fa-xmark"></i>
                        取消
                    </button>
                    <button class="secondary-button danger-action" type="button" data-cs-clear-confirm ${busy ? 'disabled' : ''}>
                        <i class="fa-solid fa-trash"></i>
                        确认清除
                    </button>
                ` : `
                    <button class="secondary-button" type="button" data-cs-clear ${busy || !view.hasSummary ? 'disabled' : ''} title="删除最新一份摘要；如果更早的消息上还有摘要，它会重新成为当前摘要">
                        <i class="fa-solid fa-eraser"></i>
                        清除摘要
                    </button>
                `}
                <button class="secondary-button" type="button" data-cs-reset ${view.saving ? 'disabled' : ''}>
                    <i class="fa-solid fa-rotate-left"></i>
                    还原
                </button>
                <button class="primary-button" type="button" data-cs-save ${busy || !view.dirty ? 'disabled' : ''}>
                    <i class="fa-solid ${view.saving ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'}"></i>
                    ${view.saving ? '保存中' : '保存修改'}
                </button>
            </div>
        </div>
    `;
    }

    function renderSummarize(view) {
        const blocked = view.generating || !view.manualGate.ok;
        // 不能点的原因写在按钮旁边，不让用户猜
        let reason = view.manualGate.ok ? '会向摘要来源发一次请求，完成后覆盖当前摘要，可以随时停止。' : view.manualGate.message;
        if (view.running) {
            reason = '正在生成摘要，完成后会自动显示在这里。';
        } else if (view.generating) {
            reason = '正在生成，结束后才能重新摘要。';
        }
        return `
        <div class="chat-summary-run">
            <div class="chat-summary-run-buttons">
                <button class="primary-button" type="button" data-cs-run ${blocked ? 'disabled' : ''} title="${escapeHtml(reason)}">
                    <i class="fa-solid ${view.running ? 'fa-circle-notch fa-spin' : 'fa-wand-magic-sparkles'}"></i>
                    ${view.running ? '摘要中' : '重新摘要'}
                </button>
                ${view.running ? `
                    <button class="secondary-button" type="button" data-stop-generation>
                        <i class="fa-solid fa-stop"></i>
                        停止
                    </button>
                ` : ''}
            </div>
            <p class="authors-note-hint" data-cs-run-hint>${escapeHtml(reason)}</p>
        </div>
    `;
    }

    return {
        id: 'summary',
        label: '聊天摘要',
        icon: 'fa-align-left',
        // 选中了聊天文件就可用：摘要存在聊天文件的消息里，单人聊天和群聊都有
        isAvailable() {
            return !!ctx.isChatSummaryAvailable?.();
        },
        render() {
            const view = ctx.getChatSummaryView();
            if (!view.ready) {
                return `<p class="panel-subtitle chat-summary-unavailable">${escapeHtml(view.reason)}</p>`;
            }

            return `
            <div class="chat-summary" data-chat-summary>
                <div class="chat-summary-status">
                    <span class="badge" data-cs-source>来源：${escapeHtml(view.sourceLabel)}</span>
                    <span class="authors-note-hint" data-cs-auto-text>${escapeHtml(view.autoText)}</span>
                </div>
                ${renderSourceWarning(view)}
                ${renderRunNotice(view)}
                ${renderEditor(view)}
                ${renderSummarize(view)}
            </div>
        `;
        },
    };
}
