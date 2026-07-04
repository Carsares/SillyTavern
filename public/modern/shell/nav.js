import { routes } from '../core/constants.js';
import { escapeHtml, formatNumber } from '../core/utils.js';

export function createNav({ state, elements, getRouteCount, getRouteUnreadCount }) {
    function renderNav() {
        elements.navList.innerHTML = routes.map(route => {
            const count = getRouteCount(route.id);
            const unreadCount = getRouteUnreadCount(route.id);
            return `
                <button class="nav-button ${route.id === state.route ? 'active' : ''}" type="button" data-route="${route.id}">
                    <i class="fa-solid ${route.icon}"></i>
                    <span>${escapeHtml(route.label)}</span>
                    ${unreadCount ? `<span class="nav-unread-badge" data-nav-unread-count="${unreadCount}"><span class="dot danger"></span>${formatNumber(unreadCount)}</span>` : (count !== '' ? `<span class="nav-count">${formatNumber(count)}</span>` : '')}
                </button>
            `;
        }).join('');
    }

    return { renderNav };
}
