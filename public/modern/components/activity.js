export function createActivityComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatBytes,
        formatDate,
        formatDurationMs,
        formatNumber,
        metricCard,
        pageHead,
        renderEmptyState,
        getActivityEntries,
        getActivitySummary,
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

    function renderActivity() {
        const stats = state.stats || {};
        const entries = getActivityEntries();
        const visibleEntries = getVisibleActivityEntries(entries);
        const summary = getActivitySummary(visibleEntries);
        const rawRows = Object.entries(stats).slice(0, 80);
        const statsUpdatedAt = Number(stats.timestamp || 0);

        return `
        ${pageHead('活动与统计', '统计缓存和使用记录。', `
            <button class="secondary-button" type="button" data-recreate-stats>
                <i class="fa-solid fa-chart-simple"></i>
                重建统计
            </button>
            <button class="secondary-button" type="button" data-refresh>
                <i class="fa-solid fa-rotate"></i>
                刷新
            </button>
        `)}
        <div class="metrics-grid">
            ${metricCard('统计对象', formatNumber(visibleEntries.length), `${formatNumber(entries.length)} 个总对象`, 'fa-id-card')}
            ${metricCard('消息总量', formatNumber(summary.messages), `${formatNumber(summary.words)} words`, 'fa-message')}
            ${metricCard('聊天体积', formatBytes(summary.size), `${formatNumber(summary.swipes)} swipes`, 'fa-database')}
            ${metricCard('最近活动', statsUpdatedAt ? formatDate(statsUpdatedAt) : '未生成', summary.last ? `最近聊天 ${formatDate(summary.last)}` : '无聊天记录', 'fa-clock')}
        </div>
        ${entries.length ? `
            <section class="panel section-panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">活跃对象</h2>
                        <p class="panel-subtitle">筛选、排序并跳转到对应聊天上下文。</p>
                    </div>
                    <span class="badge">生成耗时 ${escapeHtml(formatDurationMs(summary.genTime))}</span>
                </div>
                <div class="form-grid two-columns activity-controls">
                    <label class="field-label">
                        <span>筛选对象</span>
                        <input class="text-input" type="search" data-activity-filter value="${escapeHtml(state.activityFilter)}" placeholder="角色、群组或统计 ID">
                    </label>
                    <label class="field-label">
                        <span>排序</span>
                        <select class="select-input" data-activity-sort>
                            <option value="recent" ${state.activitySort === 'recent' ? 'selected' : ''}>最近聊天</option>
                            <option value="messages" ${state.activitySort === 'messages' ? 'selected' : ''}>消息数量</option>
                            <option value="words" ${state.activitySort === 'words' ? 'selected' : ''}>词数</option>
                            <option value="size" ${state.activitySort === 'size' ? 'selected' : ''}>文件体积</option>
                        </select>
                    </label>
                </div>
                <div class="activity-list">
                    ${visibleEntries.slice(0, 80).map(renderActivityEntryCard).join('') || renderEmptyState('fa-filter', '没有匹配活动', '调整筛选条件后再试。')}
                </div>
            </section>
        ` : renderEmptyState('fa-chart-line', '暂无统计数据', '统计缓存为空或尚未生成。')}
        ${rawRows.length ? `
            <details class="panel section-panel raw-data-panel">
                <summary>
                    <span>
                        <strong>原始统计数据</strong>
                        <em>${formatNumber(rawRows.length)} 个字段</em>
                    </span>
                    <i class="fa-solid fa-chevron-down"></i>
                </summary>
                <div class="resource-list raw-stats-list">
                    ${rawRows.map(([key, value]) => renderRawStatsRow(key, value)).join('')}
                </div>
            </details>
        ` : ''}
    `;
    }

    return {
        renderActivity,
    };
}
