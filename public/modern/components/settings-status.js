export function createSettingsStatusComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatBytes,
        formatNumber,
        renderEmptyState,
        renderKeyValue,
        getAssetCount,
        getChatModeLabel,
    } = ctx;

    function renderSettingsStatusSection(bundle, savedSecrets, dataStatus, compressionEnabled, requestCompression) {
        return `
        <div class="grid-list">
            <article class="resource-card">
                <h2 class="card-title">用户与账户</h2>
                <p class="card-meta">当前登录与权限状态。</p>
                <div class="kv-list">
                    ${renderKeyValue('当前用户', state.me?.name || state.me?.handle || '默认用户')}
                    ${renderKeyValue('管理员', state.me?.admin ? '是' : '否')}
                    ${renderKeyValue('账户系统', bundle.enable_accounts ? '开启' : '关闭')}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">扩展能力</h2>
                <p class="card-meta">第三方扩展发现、安装和更新策略。</p>
                <div class="kv-list">
                    ${renderKeyValue('扩展启用', bundle.enable_extensions ? '是' : '否')}
                    ${renderKeyValue('自动更新', bundle.enable_extensions_auto_update ? '是' : '否')}
                    ${renderKeyValue('发现数量', state.extensions.length)}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">请求压缩</h2>
                <p class="card-meta">控制大请求的压缩边界。</p>
                <div class="kv-list">
                    ${renderKeyValue('启用', compressionEnabled ? '是' : '否')}
                    ${renderKeyValue('最小载荷', formatBytes(requestCompression.minPayloadSize))}
                    ${renderKeyValue('最大载荷', formatBytes(requestCompression.maxPayloadSize))}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">现代界面</h2>
                <p class="card-meta">新版工作区本地偏好。</p>
                <div class="kv-list">
                    ${renderKeyValue('主题', state.theme)}
                    ${renderKeyValue('聊天类型', getChatModeLabel())}
                    ${renderKeyValue('聊天列表', state.chatSidebarOpen ? '展开' : '收起')}
                    ${renderKeyValue('上下文抽屉', state.inspectorOpen ? '展开' : '收起')}
                    ${renderKeyValue('入口', '/modern/')}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">资源索引</h2>
                <p class="card-meta">当前用户目录读取到的核心对象。</p>
                <div class="kv-list">
                    ${renderKeyValue('角色', formatNumber(state.characters.length))}
                    ${renderKeyValue('群聊', formatNumber(state.groups.length))}
                    ${renderKeyValue('世界书', formatNumber(state.worldbooks.length || (state.settingsBundle.world_names || []).length))}
                    ${renderKeyValue('素材', formatNumber(getAssetCount()))}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">请求安全</h2>
                <p class="card-meta">现代页请求令牌和密钥状态。</p>
                <div class="kv-list">
                    ${renderKeyValue('CSRF', state.csrfToken ? '已获取' : '未获取')}
                    ${renderKeyValue('密钥状态', savedSecrets ? `${formatNumber(savedSecrets)} 个已保存` : '未读取到')}
                    ${renderKeyValue('错误状态', dataStatus)}
                </div>
            </article>
        </div>
    `;
    }

    function renderSettingsDiagnosticsSection(bundle, savedSecrets, dataStatus) {
        return `
        <div class="dashboard-grid">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">安全与请求状态</h2>
                        <p class="panel-subtitle">新版界面只展示密钥保存状态，不暴露密钥内容。</p>
                    </div>
                </div>
                <div class="kv-list">
                    ${renderKeyValue('CSRF', state.csrfToken ? '已获取' : '未获取')}
                    ${renderKeyValue('密钥状态', savedSecrets ? `${formatNumber(savedSecrets)} 个已保存` : '未读取到')}
                    ${renderKeyValue('账户系统', bundle.enable_accounts ? '开启' : '关闭')}
                    ${renderKeyValue('扩展系统', bundle.enable_extensions ? '开启' : '关闭')}
                    ${renderKeyValue('错误状态', dataStatus)}
                </div>
            </section>
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">读取错误</h2>
                        <p class="panel-subtitle">当前数据加载链路的错误会集中显示在这里。</p>
                    </div>
                </div>
                ${state.errors.length ? `
                    <div class="resource-list compact-list">
                        ${state.errors.map(error => `
                            <article class="resource-row">
                                <span class="avatar-fallback"><i class="fa-solid fa-triangle-exclamation"></i></span>
                                <span class="row-main">
                                    <span class="row-title">${escapeHtml(error.key)}</span>
                                    <span class="row-subtitle">${escapeHtml(error.message)}</span>
                                </span>
                            </article>
                        `).join('')}
                    </div>
                ` : renderEmptyState('fa-circle-check', '暂无错误', '当前 modern 数据读取正常。')}
            </section>
        </div>
    `;
    }

    return {
        renderSettingsStatusSection,
        renderSettingsDiagnosticsSection,
    };
}
