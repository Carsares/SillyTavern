import { getEffectiveConnection } from '../core/connection-labels.js';
import { escapeHtml } from '../core/utils.js';

export function createTopbar({ state, elements, getProviderInfo }) {
    // Overlays anchored below the topbar (context drawer, top-placed toasts) read its live height,
    // which changes when the narrow layout wraps the search box onto a second row
    function observeTopbarHeight() {
        const topbar = elements.topbar;
        if (!topbar) {
            return;
        }

        const applyHeight = () => {
            document.documentElement.style.setProperty('--modern-topbar-height', `${Math.ceil(topbar.getBoundingClientRect().height)}px`);
        };
        applyHeight();
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(applyHeight).observe(topbar);
        } else {
            window.addEventListener('resize', applyHeight);
        }
    }

    function getStatusTitle(connectionTitle) {
        if (state.loading) {
            return '正在读取 SillyTavern 数据';
        }
        if (state.errors.length) {
            const keys = [...new Set(state.errors.map(error => error.key))].join('、');
            return `部分数据读取失败：${keys}\n${connectionTitle}`;
        }
        return connectionTitle;
    }

    function renderStatus() {
        // main_api alone ("openai") hides which provider and model generation actually uses
        const connection = getEffectiveConnection(state.settings || {}, getProviderInfo());
        const isError = state.errors.length > 0;
        const label = state.loading ? '读取中' : (isError ? '部分失败' : connection.label);
        const dotClass = state.loading ? 'muted' : (isError ? 'warning' : (connection.mainApi ? '' : 'muted'));
        elements.connectionStatus.title = getStatusTitle(connection.title);
        elements.connectionStatus.innerHTML = `
            <span class="dot ${dotClass}"></span>
            <span>${escapeHtml(label)}</span>
        `;
    }

    observeTopbarHeight();

    return { renderStatus };
}
