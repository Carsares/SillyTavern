export function createDashboardRoute(ctx) {
    const {
        state,
        escapeHtml,
        formatNumber,
        metricCard,
        pageHead,
        renderCharacterRow,
        renderInlineEmpty,
        getPresetCount,
        getProviderInfo,
    } = ctx;

    function renderDashboard() {
        const provider = getProviderInfo();
        const recentCharacters = [...state.characters]
            .sort((a, b) => Number(b.date_last_chat || b.date_added || 0) - Number(a.date_last_chat || a.date_added || 0))
            .slice(0, 6);

        return `
        ${pageHead('工作台', '资源、连接和最近会话。', `
            <button class="primary-button" type="button" data-route="chat">
                <i class="fa-solid fa-comments"></i>
                进入聊天
            </button>
        `)}
        <div class="metrics-grid">
            ${metricCard('角色', formatNumber(state.characters.length), '可用于聊天和人设转换', 'fa-address-card')}
            ${metricCard('群组', formatNumber(state.groups.length), '多人会话和发言策略', 'fa-users')}
            ${metricCard('世界书', formatNumber(state.worldbooks.length || provider.worldCount), '上下文知识库', 'fa-book-open')}
            ${metricCard('预设', formatNumber(getPresetCount()), '模型、指令、上下文模板', 'fa-sliders')}
        </div>
        <div class="dashboard-grid">
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">当前连接</h2>
                        <p class="panel-subtitle">从现有设置读取，不展示任何密钥。</p>
                    </div>
                    <span class="badge">${provider.extensionsEnabled ? '扩展开启' : '扩展关闭'}</span>
                </div>
                <div class="table-wrap">
                    <table>
                        <tbody>
                            <tr><th>主 API</th><td>${escapeHtml(provider.api)}</td></tr>
                            <tr><th>聊天补全来源</th><td>${escapeHtml(provider.chatSource || '未配置')}</td></tr>
                            <tr><th>模型</th><td>${escapeHtml(provider.model || '未读取到模型字段')}</td></tr>
                            <tr><th>预设字段</th><td>${escapeHtml(provider.preset || '未读取到当前预设字段')}</td></tr>
                        </tbody>
                    </table>
                </div>
            </section>
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">资源概览</h2>
                        <p class="panel-subtitle">优先显示需要经常操作的对象。</p>
                    </div>
                </div>
                <div class="resource-list">
                    ${recentCharacters.map(character => renderCharacterRow(character)).join('') || renderInlineEmpty('暂无角色')}
                </div>
            </section>
        </div>
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">快捷入口</h2>
                    <p class="panel-subtitle">按常用工作流进入对应页面。</p>
                </div>
            </div>
            <div class="action-grid">
                ${renderActionCard('聊天', '查看角色会话和历史消息', `${formatNumber(state.characters.length)} 个角色`, 'fa-comments', 'chat')}
                ${renderActionCard('角色', '检查角色卡和关联世界书', `${formatNumber(state.characters.length)} 张卡`, 'fa-address-card', 'characters')}
                ${renderActionCard('群组', '维护成员和群聊策略', `${formatNumber(state.groups.length)} 个群组`, 'fa-users', 'groups')}
                ${renderActionCard('世界书', '查看知识库文件和条目', `${formatNumber(state.worldbooks.length || provider.worldCount)} 本`, 'fa-book-open', 'worldbooks')}
                ${renderActionCard('预设', '浏览模型参数和提示模板', `${formatNumber(getPresetCount())} 个`, 'fa-sliders', 'presets')}
                ${renderActionCard('API', '检查连接、模型和密钥状态', provider.api, 'fa-plug', 'api')}
                ${renderActionCard('扩展', '查看已发现扩展', `${formatNumber(state.extensions.length)} 个`, 'fa-cubes', 'extensions')}
            </div>
        </section>
    `;
    }

    function renderActionCard(title, detail, meta, icon, routeId) {
        return `
        <button class="action-card" type="button" data-route="${routeId}">
            <span class="action-icon"><i class="fa-solid ${icon}"></i></span>
            <span class="action-body">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(detail)}</span>
            </span>
            <span class="badge">${escapeHtml(meta)}</span>
        </button>
    `;
    }

    return {
        render: renderDashboard,
    };
}
