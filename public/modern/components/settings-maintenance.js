// 设置页「数据维护」标签的面板，由 B4（数据维护页）功能代理实现 isAvailable 和 renderMaintenancePanel，别的功能不要改这个文件。
// isAvailable() 为 false 时标签不出现；renderMaintenancePanel() 返回整个标签页的内容（自己带 <section class="panel section-panel">）。
// 事件写在 routes/settings-maintenance-events.js；状态放在 state.maintenance；
// 业务动作的注册方式见 components/chat-tools.js 顶部注释（同一个路由上下文，设置页也能直接解构到）。
export function createSettingsMaintenanceComponents(ctx) {
    function isAvailable() {
        return false;
    }

    function renderMaintenancePanel() {
        return '';
    }

    return {
        isAvailable,
        renderMaintenancePanel,
    };
}
