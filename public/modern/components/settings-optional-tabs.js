/**
 * 设置页里"有功能接入才出现"的部分：「聊天工具」标签，以及「数据与备份」标签里的数据维护分区。
 * 是否出现由对应面板的 isAvailable() 决定，settings.js 的渲染和 routes/settings-events.js 的标签切换都从这里取，
 * 所以接入一个功能不需要改 settings.js / settings-events.js，只改下面两个面板文件：
 *   chat-tools    components/settings-chat-tools.js 及其分区文件
 *   maintenance   components/settings-maintenance.js
 */
import { resolveSlotAvailability } from '../core/test-flags.js';
import { createSettingsChatToolsComponents } from './settings-chat-tools.js';
import { createSettingsMaintenanceComponents } from './settings-maintenance.js';

const optionalPartsCache = new WeakMap();

/**
 * 同一个路由上下文只创建一套面板，渲染和事件两边共用。
 * @param {object} ctx 路由上下文。
 * @returns {{
 *   tabs: { id: string, icon: string, label: string, after: string, isAvailable: () => boolean, render: () => string }[],
 *   maintenance: { isAvailable: () => boolean, renderPanel: () => string, renderSnapshotMaintenance: () => string },
 * }} tabs 里的 after 是标签条里排在它前面的内置标签 id。
 */
export function getSettingsOptionalParts(ctx) {
    let parts = optionalPartsCache.get(ctx);
    if (!parts) {
        parts = createSettingsOptionalParts(ctx);
        optionalPartsCache.set(ctx, parts);
    }
    return parts;
}

function createSettingsOptionalParts(ctx) {
    const chatTools = createSettingsChatToolsComponents(ctx);
    const maintenance = createSettingsMaintenanceComponents(ctx);

    return {
        tabs: [
            {
                id: 'chat-tools',
                icon: 'fa-screwdriver-wrench',
                label: '聊天工具',
                after: 'preferences',
                isAvailable: () => resolveSlotAvailability('settingsTabs', 'chat-tools', chatTools.isAvailable()),
                render: () => chatTools.renderSettingsChatToolsPanel(),
            },
        ],
        maintenance: {
            isAvailable: () => resolveSlotAvailability('settingsTabs', 'maintenance', maintenance.isAvailable()),
            renderPanel: () => `<div data-settings-maintenance>${maintenance.renderMaintenancePanel()}</div>`,
            renderSnapshotMaintenance: () => maintenance.renderSnapshotMaintenance(),
        },
    };
}
