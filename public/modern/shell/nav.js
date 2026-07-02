import { routes } from '../core/constants.js';
import { escapeHtml, formatNumber } from '../core/utils.js';

export function createNav({ state, elements, getRouteCount }) {
    function renderNav() {
        elements.navList.innerHTML = routes.map(route => {
            const count = getRouteCount(route.id);
            return `
                <button class="nav-button ${route.id === state.route ? 'active' : ''}" type="button" data-route="${route.id}">
                    <i class="fa-solid ${route.icon}"></i>
                    <span>${escapeHtml(route.label)}</span>
                    ${count !== '' ? `<span class="nav-count">${formatNumber(count)}</span>` : ''}
                </button>
            `;
        }).join('');
    }

    return { renderNav };
}
