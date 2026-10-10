export function createApiDiagnosticComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatDate,
        renderInlineEmpty,
    } = ctx;

    // 正常 / 可用 (green) is reserved for a passed connection test; a present setting only reads 已配置
    const diagnosticStates = {
        ok: { icon: 'fa-plug-circle-check', className: 'success', text: '正常' },
        configured: { icon: 'fa-circle-check', className: 'muted', text: '已配置' },
        pending: { icon: 'fa-circle-question', className: 'muted', text: '未测试' },
        warn: { icon: 'fa-triangle-exclamation', className: 'danger', text: '需检查', attention: true },
        error: { icon: 'fa-circle-xmark', className: 'danger', text: '失败', attention: true },
    };

    function renderApiDiagnosticCard(check) {
        const view = diagnosticStates[check.state] || diagnosticStates.warn;
        return `
                <article class="api-diagnostic-card ${view.attention ? 'needs-attention' : ''}" data-diagnostic-state="${escapeHtml(check.state)}">
                    <span class="avatar-fallback"><i class="fa-solid ${view.icon}"></i></span>
                    <span class="row-main">
                        <strong>${escapeHtml(check.label)}</strong>
                        <span class="row-subtitle" title="${escapeHtml(check.detail)}">${escapeHtml(check.detail)}</span>
                    </span>
                    <span class="status-text ${view.className}">${escapeHtml(check.statusText || view.text)}</span>
                </article>
            `;
    }

    function renderApiDiagnostics(checks) {
        return `
        <div class="api-diagnostic-list">
            ${checks.map(renderApiDiagnosticCard).join('')}
        </div>
    `;
    }

    function renderApiTestHistory() {
        return `
        <section class="form-section api-history-panel">
            <div>
                <h3 class="form-section-title">测试历史</h3>
                <p class="panel-subtitle">保留最近 5 次本页连接测试。</p>
            </div>
            <div class="resource-list compact-list">
                ${state.apiTestHistory.map(item => `
                    <article class="resource-row">
                        <span class="avatar-fallback"><i class="fa-solid ${item.status === '可用' ? 'fa-plug-circle-check' : 'fa-triangle-exclamation'}"></i></span>
                        <span class="row-main">
                            <span class="row-title">${escapeHtml(item.source)} / ${escapeHtml(item.model)}</span>
                            <span class="row-subtitle">${escapeHtml(formatDate(item.time))} · ${escapeHtml(item.detail)}</span>
                        </span>
                        <span class="${item.status === '可用' ? 'success' : 'danger'}">${escapeHtml(item.status)}</span>
                    </article>
                `).join('') || renderInlineEmpty('还没有测试记录')}
            </div>
        </section>
    `;
    }

    return {
        renderApiDiagnostics,
        renderApiTestHistory,
    };
}
