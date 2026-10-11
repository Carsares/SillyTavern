// 测试专用开关，只服务于 tests/modern-slots.e2e.js。
// 正常使用时页面上没有 window.__modernTestFlags，resolveSlotAvailability 原样返回 fallback，不会改变任何行为。
// 测试通过 page.addInitScript 写入，布尔值强制开或关，缺省的 id 仍按面板自己的 isAvailable() 判断：
//   window.__modernTestFlags = {
//       chatTools: { 'authors-note': true, summary: false },   // 聊天工具抽屉里的工具 id
//       settingsToolSections: { translate: true },            // 设置页「聊天工具」标签里的分区 id
//       settingsTabs: { maintenance: true },                  // 设置页「数据维护」标签
//       slotHtml: { chatBackdrop: '<div class="chat-backdrop"></div>' },  // 直接顶替某个渲染插槽的输出
//   };

/**
 * @param {'chatTools' | 'settingsToolSections' | 'settingsTabs'} group 开关分组。
 * @param {string} id 分组内的面板 id。
 * @param {boolean} fallback 没有测试开关时使用的值，即面板自己的 isAvailable() 结果。
 * @returns {boolean}
 */
export function resolveSlotAvailability(group, id, fallback) {
    const flags = /** @type {any} */ (window).__modernTestFlags;
    const override = flags && typeof flags === 'object' ? flags[group]?.[id] : undefined;
    return typeof override === 'boolean' ? override : Boolean(fallback);
}

/**
 * 测试里顶替渲染插槽（chatBackdrop、chatConnectionChip、chatImageModeToggle）的输出，用来验证插槽的位置和样式；没有开关时原样返回 fallback。
 * @param {'chatBackdrop' | 'chatConnectionChip' | 'chatImageModeToggle'} name 插槽名。
 * @param {string} fallback 插槽自己渲染出的 HTML。
 * @returns {string}
 */
export function resolveSlotHtml(name, fallback) {
    const flags = /** @type {any} */ (window).__modernTestFlags;
    const override = flags && typeof flags === 'object' ? flags.slotHtml?.[name] : undefined;
    return typeof override === 'string' ? override : fallback;
}
