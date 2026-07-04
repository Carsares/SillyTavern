export function createSettingsSnapshotComponents(ctx) {
    const {
        state,
        escapeHtml,
        formatBytes,
        formatDate,
        renderEmptyState,
        renderInlineEmpty,
    } = ctx;

    function renderSettingsSnapshots() {
        const snapshots = state.settingsSnapshots.items;
        const selectedSnapshot = state.settingsSnapshots.previewName;
        const isLoading = state.settingsSnapshots.loading;
        const isLoaded = state.settingsSnapshots.loaded;

        return `
        <section class="panel section-panel">
            <div class="panel-header">
                <div>
                    <h2 class="panel-title">设置快照</h2>
                    <p class="panel-subtitle">备份和恢复 settings.json。恢复前会要求二次确认。</p>
                </div>
                <button class="secondary-button" type="button" data-load-settings-snapshots ${isLoading ? 'disabled' : ''}>
                    <i class="fa-solid ${isLoading ? 'fa-circle-notch fa-spin' : 'fa-rotate'}"></i>
                    刷新
                </button>
            </div>
            <div class="backup-layout">
                <div class="resource-list backup-list">
                    ${snapshots.map(snapshot => renderSettingsSnapshotRow(snapshot)).join('') || renderInlineEmpty(getSettingsSnapshotEmptyText(isLoading, isLoaded))}
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
        </section>
    `;
    }

    function getSettingsSnapshotEmptyText(isLoading, isLoaded) {
        if (isLoading) {
            return '正在读取设置快照';
        }
        return isLoaded ? '暂无设置快照' : '正在准备读取设置快照';
    }

    function renderSettingsSnapshotRow(snapshot) {
        const name = snapshot.name || '';
        const isConfirming = state.settingsSnapshots.restoreConfirm === name;
        const isBusy = state.settingsSnapshots.restoring && isConfirming;
        return `
        <article class="backup-row ${state.settingsSnapshots.previewName === name ? 'active' : ''}">
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
                `}
            </div>
        </article>
    `;
    }

    return {
        renderSettingsSnapshots,
    };
}
