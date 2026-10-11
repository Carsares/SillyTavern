/**
 * 设置页「数据维护」标签（B4）的事件绑定，由 B4 功能代理实现，别的功能不要改这个文件。
 * 返回的处理函数都是可选的，约定与 settings-chat-tools-events.js 顶部注释一致：
 *   handleClick / handleInput / handleChange / handleKeydown，返回 true 表示已处理。
 * 已经接到 routes/settings-events.js，事件在设置页任何标签下都会转发，所以要自己用 data-属性判断。
 *
 * 删除或移动数据的按钮分两步：「删除所选 / 隔离所选 / 预览」只打开确认框，「确认…」才真正发请求；
 * 取消按钮只关闭确认框，不发任何请求。
 */
/**
 * @param {any} ctx 路由上下文。
 * @returns {{
 *   handleClick?: (event: Event) => any,
 *   handleInput?: (event: Event) => any,
 *   handleChange?: (event: Event) => any,
 *   handleKeydown?: (event: KeyboardEvent) => any,
 * }} 可选的事件处理函数，约定见文件顶部。
 */
export function bindSettingsMaintenanceEvents(ctx) {
    const { state, render, showToast } = ctx;

    // 动作抛出的错误（生成中、没有勾选、请求失败）统一弹出提示，不让它变成未处理的异常
    async function run(title, action) {
        try {
            await action();
        } catch (error) {
            showToast(title, error?.message || String(error));
            render();
        }
        return true;
    }

    function closest(event, selector) {
        return event.target instanceof Element ? event.target.closest(selector) : null;
    }

    function handleClick(event) {
        let element;

        if (closest(event, '[data-maintenance-load-usage]')) {
            return run('读取存储占用失败', () => ctx.maintenanceLoadUsage());
        }

        if (closest(event, '[data-maintenance-scan-data-maid]')) {
            return run('扫描失败', () => ctx.maintenanceScanDataMaid());
        }
        if (closest(event, '[data-maintenance-release-data-maid]')) {
            ctx.maintenanceReleaseDataMaid();
            return true;
        }
        if ((element = closest(event, '[data-maintenance-data-maid-expand]'))) {
            ctx.maintenanceToggleDataMaidExpand(element.dataset.maintenanceDataMaidExpand);
            return true;
        }
        if ((element = closest(event, '[data-maintenance-data-maid-preview]'))) {
            return run('预览失败', () => ctx.maintenancePreviewDataMaidItem(element.dataset.maintenanceDataMaidPreview));
        }
        if (closest(event, '[data-maintenance-data-maid-preview-close]')) {
            ctx.maintenanceCloseDataMaidPreview();
            return true;
        }
        if (closest(event, '[data-maintenance-data-maid-delete-begin]')) {
            return run('无法删除', () => ctx.maintenanceBeginDataMaidDelete());
        }
        if (closest(event, '[data-maintenance-data-maid-delete-cancel]')) {
            ctx.maintenanceCancelDataMaidDelete();
            return true;
        }
        if (closest(event, '[data-maintenance-data-maid-delete-confirm]')) {
            return run('删除失败', () => ctx.maintenanceConfirmDataMaidDelete());
        }

        if (closest(event, '[data-maintenance-scan-greetings]')) {
            return run('扫描失败', () => ctx.maintenanceScanDuplicateGreetings());
        }
        if (closest(event, '[data-maintenance-greeting-begin]')) {
            return run('无法隔离', () => ctx.maintenanceBeginGreetingResolve());
        }
        if (closest(event, '[data-maintenance-greeting-cancel]')) {
            ctx.maintenanceCancelGreetingResolve();
            return true;
        }
        if (closest(event, '[data-maintenance-greeting-confirm]')) {
            return run('隔离失败', () => ctx.maintenanceConfirmGreetingResolve());
        }

        if (closest(event, '[data-maintenance-load-snapshots]')) {
            return run('读取设置快照失败', () => ctx.maintenanceLoadSnapshots());
        }
        if ((element = closest(event, '[data-maintenance-snapshot-delete]'))) {
            ctx.maintenanceBeginSnapshotDelete(element.dataset.maintenanceSnapshotDelete);
            return true;
        }
        if (closest(event, '[data-maintenance-snapshot-delete-cancel]')) {
            ctx.maintenanceCancelSnapshotDelete();
            return true;
        }
        if (closest(event, '[data-maintenance-snapshot-delete-confirm]')) {
            return run('删除快照失败', () => ctx.maintenanceConfirmSnapshotDelete());
        }
        if (closest(event, '[data-maintenance-snapshot-prune-preview]')) {
            return run('预览失败', () => ctx.maintenancePreviewSnapshotPrune());
        }
        if (closest(event, '[data-maintenance-snapshot-prune-cancel]')) {
            ctx.maintenanceCancelSnapshotPrune();
            return true;
        }
        if (closest(event, '[data-maintenance-snapshot-prune-confirm]')) {
            return run('清理失败', () => ctx.maintenanceConfirmSnapshotPrune());
        }

        if (closest(event, '[data-maintenance-load-backup-stats]')) {
            return run('读取备份统计失败', () => ctx.maintenanceLoadChatBackupStats());
        }
        if (closest(event, '[data-maintenance-backup-prune-preview]')) {
            return run('预览失败', () => ctx.maintenancePreviewChatBackupPrune());
        }
        if (closest(event, '[data-maintenance-backup-prune-cancel]')) {
            ctx.maintenanceCancelChatBackupPrune();
            return true;
        }
        if (closest(event, '[data-maintenance-backup-prune-confirm]')) {
            return run('清理失败', () => ctx.maintenanceConfirmChatBackupPrune());
        }

        if (closest(event, '[data-maintenance-export]')) {
            return run('导出失败', () => ctx.maintenanceExportUserData());
        }

        return false;
    }

    function handleChange(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') {
            return false;
        }

        if (target.matches('[data-maintenance-data-maid-item]')) {
            ctx.maintenanceToggleDataMaidItem(target.dataset.maintenanceDataMaidItem, target.checked);
            return true;
        }
        if (target.matches('[data-maintenance-data-maid-category]')) {
            ctx.maintenanceToggleDataMaidCategory(target.dataset.maintenanceDataMaidCategory, target.checked);
            return true;
        }
        if (target.matches('[data-maintenance-greeting-item]')) {
            ctx.maintenanceToggleGreetingItem(target.dataset.maintenanceGreetingItem, target.checked);
            return true;
        }
        if (target.matches('[data-maintenance-greeting-all]')) {
            ctx.maintenanceToggleAllGreetings(target.checked);
            return true;
        }
        return false;
    }

    // 数字输入只记下值，不重新渲染，这样输入过程中光标和焦点不会丢
    function handleInput(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return false;
        }
        if (target.matches('[data-maintenance-snapshot-keep]')) {
            ctx.maintenanceSetSnapshotKeep(target.value === '' ? '' : Number(target.value));
            return true;
        }
        if (target.matches('[data-maintenance-backup-days]')) {
            ctx.maintenanceSetChatBackupDays(target.value === '' ? '' : Number(target.value));
            return true;
        }
        return false;
    }

    // 只有「确认」类按钮才会发出删除请求；Esc 取消当前打开的确认框
    function handleKeydown(event) {
        if (event.key !== 'Escape' || state.settingsSection !== 'maintenance') {
            return false;
        }
        const maintenance = state.maintenance;
        if (maintenance?.dataMaid?.confirming && !maintenance.dataMaid.deleting) {
            ctx.maintenanceCancelDataMaidDelete();
            return true;
        }
        if (maintenance?.greetings?.confirming && !maintenance.greetings.resolving) {
            ctx.maintenanceCancelGreetingResolve();
            return true;
        }
        return false;
    }

    return {
        handleClick,
        handleChange,
        handleInput,
        handleKeydown,
    };
}
