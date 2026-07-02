export function createActivityEntryComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatBytes,
        formatDate,
        formatDurationMs,
        formatNumber,
    } = ctx;

    function getEntryTarget(entry) {
        const character = state.characters.find(item => item.avatar === entry.id || item.name === entry.id || item.data?.name === entry.id);
        if (character) {
            return {
                type: 'character',
                id: character.avatar,
                name: character.name || character.data?.name || character.avatar,
            };
        }

        const group = state.groups.find(item => item.id === entry.id || item.name === entry.id);
        if (group) {
            return {
                type: 'group',
                id: group.id,
                name: group.name || group.id,
            };
        }

        return {
            type: '',
            id: '',
            name: entry.id,
        };
    }

    function getVisibleActivityEntries(entries) {
        const query = state.activityFilter.trim().toLowerCase();
        const filtered = query
            ? entries.filter(entry => {
                const target = getEntryTarget(entry);
                return [entry.id, target.name, target.type].some(value => String(value || '').toLowerCase().includes(query));
            })
            : entries;

        return [...filtered].sort((a, b) => {
            switch (state.activitySort) {
                case 'messages':
                    return b.messages - a.messages;
                case 'words':
                    return b.words - a.words;
                case 'size':
                    return b.size - a.size;
                default:
                    return b.last - a.last;
            }
        });
    }

    function renderActivityEntryCard(entry) {
        const target = getEntryTarget(entry);
        const routeAttrs = target.type === 'group'
            ? `data-route="chat" data-open-group-chat="${escapeHtml(target.id)}"`
            : (target.type === 'character' ? `data-route="chat" data-open-character-chat="${escapeHtml(target.id)}"` : '');
        const detailRoute = target.type === 'group' ? 'groups' : (target.type === 'character' ? 'characters' : '');
        const detailLabel = target.type === 'group' ? '查看群组' : (target.type === 'character' ? '查看角色' : '');

        return `
        <article class="resource-card activity-card" data-activity-target="${escapeHtml(target.type ? `${target.type}:${target.id}` : entry.id)}">
            <div class="card-head">
                <div class="row-main">
                    <h3 class="card-title mono">${escapeHtml(target.name || entry.id)}</h3>
                    <p class="row-subtitle">${escapeHtml(entry.id)} · 最近聊天 ${escapeHtml(formatDate(entry.last))}</p>
                </div>
                <span class="badge">${formatNumber(entry.messages)} 条消息</span>
            </div>
            <div class="activity-stat-grid">
                <span><strong>${formatNumber(entry.words)}</strong><em>词数</em></span>
                <span><strong>${formatBytes(entry.size)}</strong><em>体积</em></span>
                <span><strong>${formatNumber(entry.swipes)}</strong><em>候选</em></span>
                <span><strong>${escapeHtml(formatDurationMs(entry.genTime))}</strong><em>生成耗时</em></span>
            </div>
            ${target.type ? `
                <div class="row-actions activity-card-actions">
                    <button class="secondary-button" type="button" data-command-route="${detailRoute}" data-command-select="${target.type}" data-command-id="${escapeHtml(target.id)}">
                        <i class="fa-solid ${target.type === 'group' ? 'fa-users' : 'fa-address-card'}"></i>
                        ${detailLabel}
                    </button>
                    <button class="secondary-button" type="button" ${routeAttrs}>
                        <i class="fa-solid fa-comments"></i>
                        打开聊天
                    </button>
                </div>
            ` : ''}
        </article>
    `;
    }

    function renderRawStatsRow(key, value) {
        const valueText = typeof value === 'object' ? JSON.stringify(value) : String(value);
        return `
        <article class="resource-row raw-stat-row">
            <span class="avatar-fallback"><i class="fa-solid fa-code"></i></span>
            <span class="row-main">
                <span class="row-title mono">${escapeHtml(key)}</span>
                <span class="row-subtitle mono">${escapeHtml(valueText)}</span>
            </span>
        </article>
    `;
    }

    return {
        getVisibleActivityEntries,
        renderActivityEntryCard,
        renderRawStatsRow,
    };
}
