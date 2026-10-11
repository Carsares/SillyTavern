// 设置页「数据维护」标签的面板，由 B4（数据维护页）功能代理实现 isAvailable 和 renderMaintenancePanel，别的功能不要改这个文件。
// isAvailable() 为 false 时标签不出现；renderMaintenancePanel() 返回整个标签页的内容（自己带 <section class="panel section-panel">）。
// 事件写在 routes/settings-maintenance-events.js；状态放在 state.maintenance（actions/maintenance.js 的 ensureMaintenanceState 建出）；
// 业务动作的注册方式见 components/chat-tools.js 顶部注释（同一个路由上下文，设置页也能直接解构到）。
//
// 分区：存储占用、未引用文件清理（Data Maid）、重复的仅开场白会话、聊天备份、完整数据导出。
// 设置快照的删除和按数量清理并进「数据与备份」标签的快照列表（components/settings-snapshots.js），这里只提供 renderSnapshotMaintenance。
// 所有会删除或移动用户数据的分区都是「先扫描列明细 → 勾选 → 点按钮只打开确认框 → 确认后才发请求」。
import { ensureMaintenanceState } from '../actions/maintenance.js';
import { createMaintenanceBackupComponents } from './settings-maintenance-backups.js';
import { createMaintenanceCleanupComponents } from './settings-maintenance-cleanup.js';
import { createMaintenanceStorageComponents } from './settings-maintenance-storage.js';

export function createSettingsMaintenanceComponents(ctx) {
    const { state } = ctx;
    const storage = createMaintenanceStorageComponents(ctx);
    const cleanup = createMaintenanceCleanupComponents(ctx);
    const backups = createMaintenanceBackupComponents(ctx);

    function isAvailable() {
        // 设置页每次渲染都会问一遍各标签是否可用。用户切到别的标签时，借这个机会收掉没做完的清理报告
        // （通知服务器作废 token）；这里不能触发重新渲染，所以走 quiet。
        const maintenance = ensureMaintenanceState(state);
        if (maintenance.dataMaid.token && state.settingsSection !== 'data') {
            ctx.maintenanceReleaseDataMaid?.({ quiet: true });
        }
        return true;
    }

    function renderMaintenancePanel() {
        const maintenance = ensureMaintenanceState(state);
        return `
        <div class="maintenance-sections">
            ${storage.renderStorageSection(maintenance)}
            ${cleanup.renderDataMaidSection(maintenance)}
            ${cleanup.renderDuplicateGreetingsSection(maintenance)}
            ${backups.renderChatBackupSection(maintenance)}
            ${storage.renderExportSection(maintenance)}
        </div>
    `;
    }

    function renderSnapshotMaintenance() {
        return backups.renderSnapshotMaintenance(ensureMaintenanceState(state));
    }

    return {
        isAvailable,
        renderMaintenancePanel,
        renderSnapshotMaintenance,
    };
}
