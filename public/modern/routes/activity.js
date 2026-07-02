export function createActivityRoute(ctx) {
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
        render,
        showToast,
        recreateStats,
    } = ctx;

    function renderActivityEntryRow(entry) {
        return `
        <tr>
            <td class="mono">${escapeHtml(entry.id)}</td>
            <td>${formatNumber(entry.messages)}</td>
            <td>${formatNumber(entry.words)}</td>
            <td>${formatBytes(entry.size)}</td>
            <td>${formatNumber(entry.swipes)}</td>
            <td>${escapeHtml(formatDate(entry.last))}</td>
        </tr>
    `;
    }

    function renderActivity() {
        const stats = state.stats || {};
        const entries = getActivityEntries();
        const summary = getActivitySummary(entries);
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
            ${metricCard('统计对象', formatNumber(entries.length), '有聊天统计的角色或群聊', 'fa-id-card')}
            ${metricCard('消息总量', formatNumber(summary.messages), `${formatNumber(summary.words)} words`, 'fa-message')}
            ${metricCard('聊天体积', formatBytes(summary.size), `${formatNumber(summary.swipes)} swipes`, 'fa-database')}
            ${metricCard('最近活动', statsUpdatedAt ? formatDate(statsUpdatedAt) : '未生成', summary.last ? `最近聊天 ${formatDate(summary.last)}` : '无聊天记录', 'fa-clock')}
        </div>
        ${entries.length ? `
            <section class="panel section-panel">
                <div class="panel-header">
                    <div>
                        <h2 class="panel-title">活跃对象</h2>
                        <p class="panel-subtitle">按最近聊天时间排序，展示消息、词数和缓存体积。</p>
                    </div>
                    <span class="badge">生成耗时 ${escapeHtml(formatDurationMs(summary.genTime))}</span>
                </div>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr><th>对象</th><th>消息</th><th>词数</th><th>大小</th><th>候选</th><th>最近聊天</th></tr>
                        </thead>
                        <tbody>
                            ${entries.slice(0, 80).map(renderActivityEntryRow).join('')}
                        </tbody>
                    </table>
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
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr><th>字段</th><th>值</th></tr>
                        </thead>
                        <tbody>
                            ${rawRows.map(([key, value]) => `
                                <tr>
                                    <td class="mono">${escapeHtml(key)}</td>
                                    <td>${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : value)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </details>
        ` : ''}
    `;
    }

    async function handleClick(event) {
        if (event.target.closest('[data-recreate-stats]')) {
            try {
                await recreateStats();
            } catch (error) {
                state.errors.push({ key: 'stats-recreate', message: error.message });
                showToast('统计重建失败', error.message);
                render();
            }
            return;
        }


        return false;
    }

    return {
        render: renderActivity,
        handleClick,
    };
}
