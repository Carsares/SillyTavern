/**
 * 设置页里"有功能接入才出现"的标签：「聊天工具」和「数据维护」。
 * 标签是否出现由对应面板的 isAvailable() 决定，settings.js 的标签条和 routes/settings-events.js 的标签切换都从这里取，
 * 所以接入一个功能不需要改 settings.js / settings-events.js，只改下面两个面板文件：
 *   chat-tools    components/settings-chat-tools.js 及其分区文件
 *   maintenance   components/settings-maintenance.js
 */
import { resolveSlotAvailability } from '../core/test-flags.js';
import { createSettingsChatToolsComponents } from './settings-chat-tools.js';
import { createSettingsMaintenanceComponents } from './settings-maintenance.js';

const optionalTabsCache = new WeakMap();

/**
 * 同一个路由上下文只创建一套面板，渲染和事件两边共用。
 * @param {object} ctx 路由上下文。
 * @returns {{ id: string, icon: string, label: string, after: string, isAvailable: () => boolean, render: () => string }[]}
 *   after 是标签条里排在它前面的内置标签 id。
 */
export function getSettingsOptionalTabs(ctx) {
    let tabs = optionalTabsCache.get(ctx);
    if (!tabs) {
        tabs = createSettingsOptionalTabs(ctx);
        optionalTabsCache.set(ctx, tabs);
    }
    return tabs;
}

function createSettingsOptionalTabs(ctx) {
    const chatTools = createSettingsChatToolsComponents(ctx);
    const maintenance = createSettingsMaintenanceComponents(ctx);

    return [
        {
            id: 'chat-tools',
            icon: 'fa-screwdriver-wrench',
            label: '聊天工具',
            after: 'preferences',
            isAvailable: () => resolveSlotAvailability('settingsTabs', 'chat-tools', chatTools.isAvailable()),
            render: () => chatTools.renderSettingsChatToolsPanel(),
        },
        {
            id: 'maintenance',
            icon: 'fa-broom',
            label: '数据维护',
            after: 'snapshots',
            isAvailable: () => resolveSlotAvailability('settingsTabs', 'maintenance', maintenance.isAvailable()),
            render: () => `<div data-settings-maintenance>${maintenance.renderMaintenancePanel()}</div>`,
        },
    ];
}
