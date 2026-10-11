import { routes } from '../core/constants.js';
import { escapeHtml, formatNumber } from '../core/utils.js';

// Each count badge names what it counts in its title. The listed data-loader keys feed the count: when one
// of them failed to load the count is unknown, so the badge is left out instead of showing a wrong 0
const routeCountBadges = {
    characters: { sources: ['characters'], describe: count => `${formatNumber(count)} 张角色卡` },
    groups: { sources: ['groups'], describe: count => `${formatNumber(count)} 个群组` },
    worldbooks: { sources: ['worldbooks'], describe: count => `${formatNumber(count)} 本世界书` },
    presets: { sources: ['settingsBundle'], describe: count => `${formatNumber(count)} 个预设` },
    personas: { sources: ['settingsBundle', 'settings'], describe: count => `${formatNumber(count)} 个用户人设` },
    assets: { sources: ['backgrounds', 'assets'] },
    remoteResources: { sources: [], describe: count => `${formatNumber(count)} 条导入记录` },
    extensions: { sources: ['extensions'], describe: count => `${formatNumber(count)} 个扩展` },
};

export function createNav({ state, elements, getRouteCount, getRouteUnreadCount }) {
    function renderNav() {
        elements.navList.innerHTML = routes.map(route => `
                <button class="nav-button ${route.id === state.route ? 'active' : ''}" type="button" data-route="${route.id}">
                    <i class="fa-solid ${route.icon}"></i>
                    <span>${escapeHtml(route.label)}</span>
                    ${renderNavBadge(route.id)}
                </button>
            `).join('');
    }

    function renderNavBadge(routeId) {
        // The chat entry only flags unread messages; a character count there read as a chat count
        if (routeId === 'chat') {
            const unreadCount = getRouteUnreadCount(routeId);
            return unreadCount
                ? `<span class="nav-unread-badge" data-nav-unread-count="${unreadCount}" title="${escapeHtml(`${formatNumber(unreadCount)} 条未读消息`)}"><span class="dot danger"></span>${formatNumber(unreadCount)}</span>`
                : '';
        }

        const badge = routeCountBadges[routeId];
        if (!badge) {
            return '';
        }

        const count = getKnownCount(routeId, badge);
        if (count === null) {
            return isCountLoading(routeId) ? '<span class="nav-count pending" data-nav-count-pending title="读取中">…</span>' : '';
        }

        const title = routeId === 'assets' ? describeAssetCount() : badge.describe(count);
        return `<span class="nav-count" data-nav-count="${count}" title="${escapeHtml(title)}">${formatNumber(count)}</span>`;
    }

    // Returns null while the count is unknown: before the first load, or when its source failed to load
    function getKnownCount(routeId, badge) {
        if (!state.loaded) {
            return null;
        }
        const failedKeys = new Set(state.errors.map(error => error.key));
        if (badge.sources.some(key => failedKeys.has(key))) {
            return null;
        }

        if (routeId === 'remoteResources') {
            const remote = state.remoteResources;
            return remote.loaded || remote.recordsLoaded ? getRouteCount(routeId) : null;
        }
        if (routeId === 'assets') {
            return getBackgroundCount() + Number(getRouteCount(routeId) || 0);
        }

        const count = getRouteCount(routeId);
        return count === '' ? null : Number(count) || 0;
    }

    function isCountLoading(routeId) {
        if (!state.loaded) {
            return true;
        }
        return routeId === 'remoteResources' && (state.loading || state.remoteResources.loading);
    }

    // The assets route manages backgrounds and asset files together, so its badge counts both
    function getBackgroundCount() {
        return Array.isArray(state.backgrounds?.images) ? state.backgrounds.images.length : 0;
    }

    function describeAssetCount() {
        return `${formatNumber(getBackgroundCount())} 张背景 · ${formatNumber(Number(getRouteCount('assets') || 0))} 个资产文件`;
    }

    return { renderNav };
}
