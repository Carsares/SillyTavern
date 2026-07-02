export function createDashboardComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatDate,
        formatNumber,
        metricCard,
        pageHead,
        renderInlineEmpty,
        renderKeyValue,
        getAssetGroups,
        getAssetEntries,
        getBackgroundFilename,
        getPresetCount,
        getProviderInfo,
    } = ctx;

    function renderDashboard() {
        const provider = getProviderInfo();
        const connectionIssues = getConnectionIssues(provider);
        const recentCharacters = [...state.characters]
            .sort((a, b) => Number(b.date_last_chat || b.date_added || 0) - Number(a.date_last_chat || a.date_added || 0))
            .slice(0, 2);
        const recentGroups = [...state.groups]
            .sort((a, b) => Number(b.date_last_chat || 0) - Number(a.date_last_chat || 0))
            .slice(0, 2);
        const recentWorldbooks = state.worldbooks.slice(0, 2);
        const recentBackgrounds = (state.backgrounds?.images || []).slice(0, 2);
        const recentAssets = getAssetGroups().flatMap(group => getAssetEntries(group, 2)).slice(0, 2);
        const resourceRows = [
            ...recentCharacters.map(renderCharacterResourceRow),
            ...recentGroups.map(renderGroupResourceRow),
            ...recentWorldbooks.map(renderWorldbookResourceRow),
            ...recentBackgrounds.map(renderBackgroundResourceRow),
            ...recentAssets.map(renderAssetResourceRow),
        ];

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
                    <button class="secondary-button" type="button" data-route="api">
                        <i class="fa-solid fa-plug-circle-check"></i>
                        检查连接
                    </button>
                </div>
                <div class="kv-list connection-summary-list">
                    ${renderKeyValue('主 API', provider.api)}
                    ${renderKeyValue('聊天补全来源', provider.chatSource || '未配置')}
                    ${renderKeyValue('模型', provider.model || '未读取到模型字段')}
                    ${renderKeyValue('预设字段', provider.preset || '未读取到当前预设字段')}
                </div>
                ${renderConnectionIssues(connectionIssues)}
            </section>
            <section class="panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">资源概览</h2>
                        <p class="panel-subtitle">优先显示需要经常操作的对象。</p>
                    </div>
                </div>
                <div class="resource-list">
                    ${resourceRows.join('') || renderInlineEmpty('暂无可用资源')}
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
                ${renderActionCard('活动', '查看聊天统计和最近活动', '统计缓存', 'fa-chart-line', 'activity')}
                ${renderActionCard('扩展', '查看已发现扩展', `${formatNumber(state.extensions.length)} 个`, 'fa-cubes', 'extensions')}
            </div>
        </section>
    `;
    }

    function getConnectionIssues(provider) {
        const issues = [];
        if (!provider.api || provider.api === '未选择') {
            issues.push('主 API 未选择');
        }
        if (!provider.chatSource) {
            issues.push('聊天补全来源未配置');
        }
        if (!provider.model) {
            issues.push('模型未配置');
        }
        return issues;
    }

    function renderConnectionIssues(issues) {
        if (!issues.length) {
            return '';
        }

        return `
        <div class="dashboard-connection-warning">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span>连接配置不完整：${escapeHtml(issues.join('、'))}</span>
            <button class="secondary-button" type="button" data-route="api">打开 API</button>
        </div>
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

    function renderOverviewRow({ title, subtitle, badge, icon, route, select, id }) {
        return `
        <button class="resource-row dashboard-resource-row" type="button" data-command-route="${escapeHtml(route)}" data-command-select="${escapeHtml(select)}" data-command-id="${escapeHtml(id)}">
            <span class="avatar-fallback"><i class="fa-solid ${icon}"></i></span>
            <span class="row-main">
                <span class="row-title">${escapeHtml(title)}</span>
                <span class="row-subtitle">${escapeHtml(subtitle)}</span>
            </span>
            <span class="badge">${escapeHtml(badge)}</span>
        </button>
    `;
    }

    function renderCharacterResourceRow(character) {
        const title = character.name || character.data?.name || character.avatar || '未命名角色';
        const subtitle = [
            character.date_last_chat ? `最近 ${formatDate(character.date_last_chat)}` : '',
            character.data?.creator ? `作者 ${character.data.creator}` : '',
            character.avatar || '',
        ].filter(Boolean).join(' · ');

        return renderOverviewRow({
            title,
            subtitle: subtitle || '角色卡',
            badge: '角色',
            icon: 'fa-address-card',
            route: 'characters',
            select: 'character',
            id: character.avatar,
        });
    }

    function renderGroupResourceRow(group) {
        return renderOverviewRow({
            title: group.name || group.id || '未命名群组',
            subtitle: `${formatNumber(Array.isArray(group.members) ? group.members.length : 0)} 个成员 · ${formatNumber(Array.isArray(group.chats) ? group.chats.length : 0)} 个会话`,
            badge: '群组',
            icon: 'fa-users',
            route: 'groups',
            select: 'group',
            id: group.id,
        });
    }

    function renderWorldbookResourceRow(worldbook) {
        const id = worldbook.file_id || worldbook.name || '';
        return renderOverviewRow({
            title: worldbook.name || id || '未命名世界书',
            subtitle: id || '世界书文件',
            badge: '世界书',
            icon: 'fa-book-open',
            route: 'worldbooks',
            select: 'worldbook',
            id,
        });
    }

    function renderBackgroundResourceRow(background) {
        const filename = getBackgroundFilename(background);
        return renderOverviewRow({
            title: filename || '未命名背景',
            subtitle: typeof background === 'object' && background?.isAnimated ? '动画背景' : '静态背景',
            badge: '背景',
            icon: 'fa-image',
            route: 'assets',
            select: 'background',
            id: filename,
        });
    }

    function renderAssetResourceRow(entry) {
        return renderOverviewRow({
            title: entry.label || entry.filename || entry.path,
            subtitle: entry.path || `${entry.category}/${entry.filename}`,
            badge: '资产',
            icon: 'fa-file',
            route: 'assets',
            select: 'asset',
            id: `${entry.category}:${entry.path}`,
        });
    }

    return {
        renderDashboard,
    };
}
