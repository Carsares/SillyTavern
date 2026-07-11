export function createApiProfileComponents(ctx) {
    const {
        state,
        escapeHtml,
        renderKeyValue,
    } = ctx;

    function renderApiProfilesSection(profiles) {
        return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">连接档案</h2>
                    <p class="panel-subtitle">敏感字段已省略。</p>
                </div>
            </div>
            <div class="grid-list">
                ${profiles.map(profile => renderApiProfileCard(profile)).join('')}
            </div>
        </section>
    `;
    }

    function renderApiRawDataPanel(provider) {
        return `
        <details class="panel section-panel raw-data-panel">
            <summary>
                <span>
                    <strong>原始字段</strong>
                    <em>用于排查连接选择，默认折叠。</em>
                </span>
                <i class="fa-solid fa-chevron-down"></i>
            </summary>
            <div class="grid-list">
                <article class="resource-card">
                    <h3 class="card-title">主配置</h3>
                    <div class="kv-list">
                        ${renderKeyValue('main_api', provider.api)}
                        ${renderKeyValue('chat_completion_source', provider.chatSource || '未设置')}
                        ${renderKeyValue('model', provider.model || '未设置')}
                        ${renderKeyValue('preset', provider.preset || '未设置')}
                    </div>
                </article>
                <article class="resource-card">
                    <h3 class="card-title">安全</h3>
                    <div class="kv-list">
                        ${renderKeyValue('secrets exposure', state.secrets?.allowKeysExposure ? '允许显示' : '不允许显示')}
                        ${renderKeyValue('csrf token', state.csrfToken ? '已获取' : '未获取')}
                        ${renderKeyValue('accounts', state.settingsBundle.enable_accounts ? '开启' : '关闭')}
                        ${renderKeyValue('extensions', state.settingsBundle.enable_extensions ? '开启' : '关闭')}
                    </div>
                </article>
            </div>
        </details>
    `;
    }

    function renderApiProfileCard(profile) {
        // 主连接 summarizes whichever sub-profile is active, so it must not compete for the 当前/备用 signal
        const isSummary = profile.title === '主连接';
        const badgeLabel = isSummary ? '汇总' : (profile.active ? '当前' : '备用');
        const badgeActive = !isSummary && profile.active;
        // Only an inactive type card gets a switch button; on the active card it would be a silent no-op
        const canSelect = profile.mainApi && !isSummary && !profile.active;
        return `
        <article class="resource-card api-profile-card">
            <div class="card-head">
                <div>
                    <h3 class="card-title">${escapeHtml(profile.title)}</h3>
                    <div class="card-meta">${escapeHtml(profile.kind)}</div>
                </div>
                <span class="badge${badgeActive ? ' active' : ''}">${badgeLabel}</span>
            </div>
            <div class="kv-list">
                ${renderKeyValue('来源', profile.source, { emptyText: '未配置' })}
                ${renderKeyValue('模型', profile.model, { emptyText: '未配置' })}
                ${renderKeyValue('预设', profile.preset, { emptyText: '未配置' })}
                ${renderKeyValue('端点', profile.endpoint, { emptyText: '未配置' })}
            </div>
            ${canSelect ? `
                <button class="secondary-button" type="button" data-api-profile-main="${escapeHtml(profile.mainApi)}">
                    <i class="fa-solid fa-arrow-right"></i>
                    查看${escapeHtml(profile.title)}
                </button>
            ` : ''}
        </article>
    `;
    }

    return {
        renderApiProfilesSection,
        renderApiRawDataPanel,
    };
}
