export function createApiDiagnosticComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatDate,
        renderInlineEmpty,
    } = ctx;

    function renderApiDiagnostics(checks) {
        return `
        <div class="api-diagnostic-list">
            ${checks.map(check => `
                <article class="api-diagnostic-card ${check.state === 'ok' ? '' : 'needs-attention'}">
                    <span class="avatar-fallback"><i class="fa-solid ${check.state === 'ok' ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i></span>
                    <span class="row-main">
                        <strong>${escapeHtml(check.label)}</strong>
                        <span class="row-subtitle">${escapeHtml(check.detail)}</span>
                    </span>
                    <span class="${check.state === 'ok' ? 'success' : 'danger'}">${check.state === 'ok' ? '正常' : '需检查'}</span>
                </article>
            `).join('')}
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
