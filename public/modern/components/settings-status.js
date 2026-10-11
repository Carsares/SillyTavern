export function createSettingsStatusComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatBytes,
        formatNumber,
        renderEmptyState,
        renderKeyValue,
        getAssetCount,
    } = ctx;

    // 「系统信息」标签：账户、扩展、请求压缩、资源和请求安全都是只读信息，集中在一处；读取错误放最后
    function renderSettingsSystemSection(bundle, savedSecrets, requestCompression) {
        return `
        <div class="grid-list settings-system-grid">
            <article class="resource-card">
                <h2 class="card-title">用户与账户</h2>
                <div class="kv-list">
                    ${renderKeyValue('当前用户', state.me?.name || state.me?.handle || '默认用户')}
                    ${renderKeyValue('管理员', state.me?.admin ? '是' : '否')}
                    ${renderKeyValue('账户系统', bundle.enable_accounts ? '开启' : '关闭')}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">扩展</h2>
                <div class="kv-list">
                    ${renderKeyValue('扩展系统', bundle.enable_extensions ? '开启' : '关闭')}
                    ${renderKeyValue('自动更新', bundle.enable_extensions_auto_update ? '是' : '否')}
                    ${renderKeyValue('已发现', `${formatNumber(state.extensions.length)} 个`)}
                </div>
            </article>
            <article class="resource-card" data-request-compression-readonly>
                <h2 class="card-title">请求压缩 <span class="badge" title="来自 config.yaml，修改后需重启服务"><i class="fa-solid fa-lock"></i>只读</span></h2>
                <div class="kv-list">
                    ${renderKeyValue('启用', requestCompression.enabled ? '是' : '否')}
                    ${renderKeyValue('最小载荷', formatBytes(requestCompression.minPayloadSize))}
                    ${renderKeyValue('最大载荷', formatBytes(requestCompression.maxPayloadSize))}
                </div>
                <p class="card-meta">来自 config.yaml 的启动配置；如需调整，编辑 config.yaml 后重启服务。</p>
            </article>
            <article class="resource-card">
                <h2 class="card-title">资源</h2>
                <div class="kv-list">
                    ${renderKeyValue('角色', formatNumber(state.characters.length))}
                    ${renderKeyValue('群聊', formatNumber(state.groups.length))}
                    ${renderKeyValue('世界书', formatNumber(state.worldbooks.length || (state.settingsBundle.world_names || []).length))}
                    ${renderKeyValue('背景', formatNumber(Array.isArray(state.backgrounds?.images) ? state.backgrounds.images.length : 0))}
                    ${renderKeyValue('资产文件', formatNumber(getAssetCount()))}
                </div>
            </article>
            <article class="resource-card">
                <h2 class="card-title">请求安全</h2>
                <div class="kv-list">
                    ${renderKeyValue('CSRF 令牌', state.csrfToken ? '已获取' : '未获取')}
                    ${renderKeyValue('已保存密钥', savedSecrets ? `${formatNumber(savedSecrets)} 个` : '没有')}
                    ${renderKeyValue('密钥明文', state.secrets?.allowKeysExposure ? '允许查看' : '不显示')}
                </div>
            </article>
        </div>
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">读取错误</h2>
                    <p class="panel-subtitle">页面数据读取和保存中出现的错误会集中显示在这里。</p>
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
            ` : renderEmptyState('fa-circle-check', '暂无错误', '数据读取正常。')}
        </section>
    `;
    }

    return {
        renderSettingsSystemSection,
    };
}
