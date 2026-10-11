// 「数据与备份」标签的设置快照分区：创建、搜索、预览、恢复、删除，以及按数量清理（清理部分由数据维护面板提供）。
// 删除和清理沿用数据维护的确认流程（data-maintenance-snapshot-*，事件在 routes/settings-maintenance-events.js）。
import { ensureMaintenanceState } from '../actions/maintenance.js';

export function createSettingsSnapshotComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatBytes,
        formatDate,
        renderEmptyState,
        renderInlineEmpty,
    } = ctx;

    /**
     * @param {{ renderSnapshotMaintenance?: () => string } | null} maintenance 数据维护面板；不可用时没有删除和清理
     * @returns {string} HTML
     */
    function renderSettingsSnapshots(maintenance) {
        const allSnapshots = state.settingsSnapshots.items;
        const query = formatSettingsSnapshotQuery(state.settingsSnapshots.query);
        const snapshots = query
            ? allSnapshots.filter(snapshot => getSettingsSnapshotSearchText(snapshot).includes(query))
            : allSnapshots;
        const selectedSnapshot = state.settingsSnapshots.previewName;
        const isLoading = state.settingsSnapshots.loading;
        const isLoaded = state.settingsSnapshots.loaded;
        const creating = state.settingsSnapshots.creating;
        const newestName = allSnapshots[0]?.name || '';
        const totalBytes = allSnapshots.reduce((sum, item) => sum + (item.size || 0), 0);
        const loadError = state.settingsSnapshots.error || '';

        return `
        <section class="panel section-panel" data-settings-snapshots>
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">设置快照</h2>
                    <p class="panel-subtitle">快照是 settings.json 的备份，保存设置时会按间隔自动生成并保留最近 50 份。恢复和删除前都会再确认一次。</p>
                </div>
                <div class="panel-actions">
                    <button class="primary-button" type="button" data-create-settings-snapshot ${creating ? 'disabled' : ''}>
                        <i class="fa-solid ${creating ? 'fa-circle-notch fa-spin' : 'fa-camera'}"></i>
                        创建快照
                    </button>
                    <button class="secondary-button" type="button" data-load-settings-snapshots ${isLoading ? 'disabled' : ''}>
                        <i class="fa-solid ${isLoading ? 'fa-circle-notch fa-spin' : 'fa-rotate'}"></i>
                        刷新
                    </button>
                </div>
            </div>
            <div class="list-toolbar">
                <label class="field-label">
                    <span>搜索快照</span>
                    <input class="text-input" type="search" data-settings-snapshot-search value="${escapeHtml(state.settingsSnapshots.query)}" placeholder="文件名、日期或大小" autocomplete="off">
                </label>
                <span class="badge ${loadError && !isLoaded ? 'danger' : ''}" data-settings-snapshot-count>${describeCount(isLoaded, isLoading, loadError, snapshots.length, allSnapshots.length, totalBytes)}</span>
            </div>
            <div class="backup-layout">
                <div class="resource-list backup-list">
                    ${snapshots.map(snapshot => renderSettingsSnapshotRow(snapshot, snapshot.name === newestName, maintenance)).join('') || renderInlineEmpty(getSettingsSnapshotEmptyText(isLoading, isLoaded, allSnapshots.length, query, loadError))}
                </div>
                <div class="backup-preview">
                    ${selectedSnapshot ? `
                        <div class="panel-header compact-header">
                            <div>
                                <h3 class="panel-title">${escapeHtml(selectedSnapshot)}</h3>
                                <p class="panel-subtitle">只读预览。恢复会替换当前 settings.json。</p>
                            </div>
                        </div>
                        <textarea readonly>${escapeHtml(state.settingsSnapshots.previewText)}</textarea>
                    ` : renderEmptyState('fa-file-code', '未选择快照', '点击“预览”查看快照内容。')}
                </div>
            </div>
            ${isLoaded && maintenance?.renderSnapshotMaintenance ? maintenance.renderSnapshotMaintenance() : ''}
        </section>
    `;
    }

    function describeCount(isLoaded, isLoading, loadError, shown, total, totalBytes) {
        if (isLoaded) {
            return `显示 ${shown} / ${total} · 共 ${escapeHtml(formatBytes(totalBytes))}`;
        }
        if (loadError && !isLoading) {
            return '读取失败';
        }
        return '读取中';
    }

    function getSettingsSnapshotEmptyText(isLoading, isLoaded, snapshotCount, query, loadError) {
        if (isLoading) {
            return '正在读取设置快照';
        }
        if (!isLoaded && loadError) {
            return `读取失败：${loadError}。点「刷新」重试。`;
        }
        if (isLoaded && snapshotCount && query) {
            return '没有匹配的设置快照';
        }
        return isLoaded ? '暂无设置快照' : '正在准备读取设置快照';
    }

    function formatSettingsSnapshotQuery(value) {
        return String(value || '').trim().toLowerCase();
    }

    function getSettingsSnapshotSearchText(snapshot) {
        return formatSettingsSnapshotQuery([
            snapshot.name,
            formatDate(snapshot.date),
            formatBytes(snapshot.size),
        ].join(' '));
    }

    function renderDeleteActions(name, isNewest) {
        const snapshots = ensureMaintenanceState(state).snapshots;
        if (isNewest) {
            return '<span class="badge active" title="最新的一份不能删除">最新</span>';
        }
        if (snapshots.confirmDelete === name) {
            const busy = snapshots.deleting === name;
            return `
                    <button class="secondary-button" type="button" data-maintenance-snapshot-delete-cancel ${busy ? 'disabled' : ''}>取消</button>
                    <button class="secondary-button danger-action" type="button" data-maintenance-snapshot-delete-confirm ${busy ? 'disabled' : ''}>
                        <i class="fa-solid ${busy ? 'fa-circle-notch fa-spin' : 'fa-trash'}"></i>
                        确认删除
                    </button>`;
        }
        return `
                    <button class="secondary-button" type="button" data-maintenance-snapshot-delete="${escapeHtml(name)}" ${snapshots.deleting || snapshots.pruning ? 'disabled' : ''} title="删除这份快照">
                        <i class="fa-solid fa-trash"></i>
                        删除
                    </button>`;
    }

    function renderSettingsSnapshotRow(snapshot, isNewest, maintenance) {
        const name = snapshot.name || '';
        const isConfirming = state.settingsSnapshots.restoreConfirm === name;
        const isBusy = state.settingsSnapshots.restoring && isConfirming;
        return `
        <article class="backup-row ${state.settingsSnapshots.previewName === name ? 'active' : ''}" data-maintenance-snapshot-row="${escapeHtml(name)}">
            <div class="row-main">
                <strong class="row-title">${escapeHtml(name)}</strong>
                <span class="row-subtitle">${escapeHtml(formatDate(snapshot.date))} · ${escapeHtml(formatBytes(snapshot.size))}</span>
            </div>
            <div class="row-actions">
                <button class="secondary-button" type="button" data-preview-settings-snapshot="${escapeHtml(name)}" ${isBusy ? 'disabled' : ''}>
                    <i class="fa-solid fa-eye"></i>
                    预览
                </button>
                ${isConfirming ? `
                    <button class="secondary-button" type="button" data-cancel-settings-restore ${state.settingsSnapshots.restoring ? 'disabled' : ''}>
                        取消
                    </button>
                    <button class="secondary-button danger-action" type="button" data-confirm-settings-restore ${state.settingsSnapshots.restoring ? 'disabled' : ''}>
                        <i class="fa-solid ${state.settingsSnapshots.restoring ? 'fa-circle-notch fa-spin' : 'fa-rotate-left'}"></i>
                        确认恢复
                    </button>
                ` : `
                    <button class="secondary-button" type="button" data-restore-settings-snapshot="${escapeHtml(name)}" ${state.settingsSnapshots.restoring ? 'disabled' : ''}>
                        <i class="fa-solid fa-rotate-left"></i>
                        恢复
                    </button>
                    ${maintenance ? renderDeleteActions(name, isNewest) : ''}
                `}
            </div>
        </article>
    `;
    }

    return {
        renderSettingsSnapshots,
    };
}
