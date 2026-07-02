export function createDashboardResourceComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatDate,
        formatNumber,
        renderInlineEmpty,
        getAssetGroups,
        getAssetEntries,
        getBackgroundFilename,
    } = ctx;

    function renderDashboardResourceList() {
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

        return resourceRows.join('') || renderInlineEmpty('暂无可用资源');
    }

    function renderOverviewRow({ title, subtitle, badge, icon, route, select, id, chatType = '' }) {
        const chatAttrs = chatType === 'group'
            ? `data-route="chat" data-open-group-chat="${escapeHtml(id)}"`
            : (chatType === 'character' ? `data-route="chat" data-open-character-chat="${escapeHtml(id)}"` : '');

        return `
        <div class="dashboard-resource-item">
            <button class="resource-row dashboard-resource-row" type="button" data-command-route="${escapeHtml(route)}" data-command-select="${escapeHtml(select)}" data-command-id="${escapeHtml(id)}">
                <span class="avatar-fallback"><i class="fa-solid ${icon}"></i></span>
                <span class="row-main">
                    <span class="row-title">${escapeHtml(title)}</span>
                    <span class="row-subtitle">${escapeHtml(subtitle)}</span>
                </span>
                <span class="badge">${escapeHtml(badge)}</span>
            </button>
            ${chatAttrs ? `
                <button class="icon-button dashboard-resource-chat" type="button" ${chatAttrs} title="打开聊天" aria-label="打开 ${escapeHtml(title)} 的聊天">
                    <i class="fa-solid fa-comments"></i>
                </button>
            ` : ''}
        </div>
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
            chatType: 'character',
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
            chatType: 'group',
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
        renderDashboardResourceList,
    };
}
