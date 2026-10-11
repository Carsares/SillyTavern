/**
 * 数据维护的两个备份类部分：设置快照的按数量清理（列表本身在 settings-snapshots.js）和聊天备份（统计、按天数清理）。
 */
const PREVIEW_NAME_LIMIT = 20;

export function createMaintenanceBackupComponents(ctx) {
    const { state, escapeHtml, formatBytes, formatNumber } = ctx;

    function formatTime(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN', { hour12: false });
    }

    // ------------------------------------------------------------ 设置快照

    function renderSnapshotPrune(snapshots) {
        const preview = snapshots.preview;
        return `
        <div class="maintenance-prune" data-maintenance-snapshot-prune>
            <label class="field-label maintenance-inline-field">
                <span>保留最新的份数</span>
                <input class="text-input" type="number" min="1" step="1" inputmode="numeric" data-maintenance-snapshot-keep value="${escapeHtml(snapshots.keep)}" ${snapshots.pruning ? 'disabled' : ''}>
            </label>
            <button class="secondary-button" type="button" data-maintenance-snapshot-prune-preview ${snapshots.previewing || snapshots.pruning ? 'disabled' : ''}>
                <i class="fa-solid ${snapshots.previewing ? 'fa-circle-notch fa-spin' : 'fa-eye'}"></i>
                预览要清理的快照
            </button>
        </div>
        ${preview ? `
            <div class="maintenance-confirm ${preview.candidates.length ? 'danger-confirm' : ''}" data-maintenance-snapshot-prune-preview-pane>
                ${preview.candidates.length ? `
                    <p><strong>将删除最旧的 ${escapeHtml(formatNumber(preview.candidates.length))} 份快照（${escapeHtml(formatBytes(preview.candidates.reduce((sum, item) => sum + item.size, 0)))}），保留最新的 ${escapeHtml(formatNumber(preview.kept))} 份。</strong></p>
                    <ul>
                        ${preview.candidates.slice(0, PREVIEW_NAME_LIMIT).map(item => `<li>${escapeHtml(item.name)} · ${escapeHtml(formatTime(item.date))} · ${escapeHtml(formatBytes(item.size))}</li>`).join('')}
                    </ul>
                    ${preview.candidates.length > PREVIEW_NAME_LIMIT ? `<p class="panel-subtitle">另有 ${escapeHtml(formatNumber(preview.candidates.length - PREVIEW_NAME_LIMIT))} 份未列出。</p>` : ''}
                    <p class="panel-subtitle">最新的快照一定会保留。删除后无法恢复。</p>
                    <div class="message-edit-actions">
                        <button class="secondary-button" type="button" data-maintenance-snapshot-prune-cancel ${snapshots.pruning ? 'disabled' : ''}>取消</button>
                        <button class="secondary-button danger-action" type="button" data-maintenance-snapshot-prune-confirm ${snapshots.pruning ? 'disabled' : ''}>
                            <i class="fa-solid ${snapshots.pruning ? 'fa-circle-notch fa-spin' : 'fa-trash'}"></i>
                            确认删除 ${escapeHtml(formatNumber(preview.candidates.length))} 份
                        </button>
                    </div>
                ` : `
                    <p>现有 ${escapeHtml(formatNumber(preview.total))} 份快照，保留 ${escapeHtml(formatNumber(preview.keep))} 份的话没有需要清理的。</p>
                    <div class="message-edit-actions">
                        <button class="secondary-button" type="button" data-maintenance-snapshot-prune-cancel>关闭</button>
                    </div>
                `}
            </div>
        ` : ''}
    `;
    }

    // 设置快照的列表（预览、恢复、删除）在「数据与备份」标签的快照分区（components/settings-snapshots.js），
    // 这里只提供列表下方的按数量清理、错误和结果
    function renderSnapshotMaintenance(maintenance) {
        const snapshots = maintenance.snapshots;
        const items = state.settingsSnapshots.items || [];
        const result = snapshots.result;
        return `
            ${snapshots.error ? `<p class="danger maintenance-wrap" data-maintenance-snapshot-error>${escapeHtml(snapshots.error)}</p>` : ''}
            ${items.length > 1 ? renderSnapshotPrune(snapshots) : ''}
            ${result ? `
                <div class="maintenance-result" data-maintenance-snapshot-result>
                    <p><strong>已删除 ${escapeHtml(formatNumber(result.names.length))} 份快照，释放 ${escapeHtml(formatBytes(result.freedBytes))}。</strong></p>
                    ${result.skipped?.length ? `<p class="warning-text">${escapeHtml(formatNumber(result.skipped.length))} 份没有删除（已不在清理范围内或删除失败）。</p>` : ''}
                </div>
            ` : ''}
        `;
    }

    // ------------------------------------------------------------ 聊天备份

    function renderBackupPrune(backups) {
        const preview = backups.preview;
        return `
        <div class="maintenance-prune" data-maintenance-backup-prune>
            <label class="field-label maintenance-inline-field">
                <span>删除多少天前的备份</span>
                <input class="text-input" type="number" min="1" step="1" inputmode="numeric" data-maintenance-backup-days value="${escapeHtml(backups.days)}" ${backups.deleting ? 'disabled' : ''}>
            </label>
            <button class="secondary-button" type="button" data-maintenance-backup-prune-preview ${backups.previewing || backups.deleting ? 'disabled' : ''}>
                <i class="fa-solid ${backups.previewing ? 'fa-circle-notch fa-spin' : 'fa-eye'}"></i>
                预览
            </button>
        </div>
        ${preview ? `
            <div class="maintenance-confirm ${preview.files ? 'danger-confirm' : ''}" data-maintenance-backup-prune-preview-pane>
                ${preview.files ? `
                    <p><strong>${escapeHtml(formatNumber(preview.days))} 天前的备份共 ${escapeHtml(formatNumber(preview.files))} 个（${escapeHtml(formatBytes(preview.bytes))}），确认后会逐个删除${preview.namesTruncated ? `，这次最多处理 ${escapeHtml(formatNumber(preview.names.length))} 个` : ''}。</strong></p>
                    <ul>${preview.names.slice(0, PREVIEW_NAME_LIMIT).map(name => `<li>${escapeHtml(name)}</li>`).join('')}</ul>
                    ${preview.names.length > PREVIEW_NAME_LIMIT ? `<p class="panel-subtitle">另有 ${escapeHtml(formatNumber(preview.names.length - PREVIEW_NAME_LIMIT))} 个未列出。</p>` : ''}
                    <p class="panel-subtitle">只有文件名符合备份命名规则的才会列入；删除后无法恢复。</p>
                    ${backups.progress ? `<p class="panel-subtitle">${escapeHtml(backups.progress)}</p>` : ''}
                    <div class="message-edit-actions">
                        <button class="secondary-button" type="button" data-maintenance-backup-prune-cancel ${backups.deleting ? 'disabled' : ''}>取消</button>
                        <button class="secondary-button danger-action" type="button" data-maintenance-backup-prune-confirm ${backups.deleting ? 'disabled' : ''}>
                            <i class="fa-solid ${backups.deleting ? 'fa-circle-notch fa-spin' : 'fa-trash'}"></i>
                            确认删除 ${escapeHtml(formatNumber(preview.names.length))} 个
                        </button>
                    </div>
                ` : `
                    <p>没有 ${escapeHtml(formatNumber(preview.days))} 天前的备份。</p>
                    <div class="message-edit-actions">
                        <button class="secondary-button" type="button" data-maintenance-backup-prune-cancel>关闭</button>
                    </div>
                `}
            </div>
        ` : ''}
    `;
    }

    function renderBackupResult(backups) {
        const result = backups.result;
        return `
        ${result ? `
            <div class="maintenance-result" data-maintenance-backup-result>
                <p><strong>已删除 ${escapeHtml(formatNumber(result.deleted.length))} 个 ${escapeHtml(formatNumber(result.days))} 天前的备份。</strong></p>
                ${result.skippedChanged ? `<p class="warning-text">${escapeHtml(formatNumber(result.skippedChanged))} 个在删除前已不满足条件，没有删除。</p>` : ''}
                ${result.failed.length ? `<p class="warning-text">${escapeHtml(formatNumber(result.failed.length))} 个删除失败：</p><ul>${result.failed.slice(0, 20).map(item => `<li>${escapeHtml(item.name)}：${escapeHtml(item.message)}</li>`).join('')}</ul>` : ''}
            </div>
        ` : ''}
    `;
    }

    function renderChatBackupSection(maintenance) {
        const backups = maintenance.chatBackups;
        const stats = backups.stats;
        const config = stats?.config;

        return `
        <section class="panel section-panel" data-maintenance-section="chat-backups">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">聊天备份</h2>
                    <p class="panel-subtitle">每次保存聊天时自动留一份备份，每个角色最多保留一定数量。这里只读取文件列表来统计，不会打开备份内容。</p>
                </div>
                <button class="secondary-button" type="button" data-maintenance-load-backup-stats ${backups.loading ? 'disabled' : ''}>
                    <i class="fa-solid ${backups.loading ? 'fa-circle-notch fa-spin' : 'fa-chart-simple'}"></i>
                    ${stats ? '刷新统计' : '读取统计'}
                </button>
            </div>
            ${backups.error ? `<p class="danger maintenance-wrap" data-maintenance-backup-error>${escapeHtml(backups.error)}</p>` : ''}
            ${stats ? `
                <p class="panel-subtitle" data-maintenance-backup-summary>
                    共 ${escapeHtml(formatNumber(stats.total.files))} 个备份 · ${escapeHtml(formatBytes(stats.total.bytes))} · ${escapeHtml(formatNumber(stats.series.length))} 个角色或会话系列
                    ${stats.unrecognized.files ? ` · ${escapeHtml(formatNumber(stats.unrecognized.files))} 个文件名不符合备份命名（不会被清理）` : ''}
                </p>
                ${config ? `
                    <p class="panel-subtitle" data-maintenance-backup-config>
                        当前配置：自动备份${config.enabled ? '开启' : '关闭'} · 每个系列保留 ${escapeHtml(formatNumber(config.numberOfBackups))} 个
                        · 总数上限${config.maxTotalBackups < 0 ? '不限制' : ` ${escapeHtml(formatNumber(config.maxTotalBackups))} 个`}
                        · 同一用户两次备份至少间隔 ${escapeHtml(formatNumber(config.throttleInterval))} 毫秒
                    </p>
                ` : ''}
                ${stats.truncated ? '<p class="maintenance-note warning"><i class="fa-solid fa-triangle-exclamation"></i> 备份文件太多，统计在上限处停止。</p>' : ''}
                ${stats.series.length ? `
                    <div class="maintenance-table-wrap">
                        <table class="maintenance-table" data-maintenance-backup-table>
                            <thead><tr><th>系列</th><th class="numeric">个数</th><th class="numeric">大小</th><th>最早</th><th>最新</th></tr></thead>
                            <tbody>
                                ${stats.series.slice(0, 15).map(series => `
                                    <tr>
                                        <td>${escapeHtml(series.key)}</td>
                                        <td class="numeric">${escapeHtml(formatNumber(series.files))}</td>
                                        <td class="numeric">${escapeHtml(formatBytes(series.bytes))}</td>
                                        <td>${escapeHtml(formatTime(series.oldest))}</td>
                                        <td>${escapeHtml(formatTime(series.newest))}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    ${stats.series.length > 15 ? `<p class="panel-subtitle">另有 ${escapeHtml(formatNumber(stats.series.length - 15))} 个系列未列出。</p>` : ''}
                ` : ''}
                ${stats.total.files ? renderBackupPrune(backups) : ''}
                ${renderBackupResult(backups)}
            ` : `<p class="panel-subtitle">${backups.loading ? '正在读取…' : '点「读取统计」查看备份数量、大小和当前配置。'}</p>`}
        </section>
    `;
    }

    return {
        renderSnapshotMaintenance,
        renderChatBackupSection,
    };
}
