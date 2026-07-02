import { escapeHtml } from '../core/utils.js';

export function createTopbar({ state, elements, getProviderInfo }) {
    function renderStatus() {
        const provider = getProviderInfo();
        const isError = state.errors.length > 0;
        const label = state.loading ? '读取中' : (isError ? '部分失败' : provider.api);
        const dotClass = state.loading ? 'muted' : (isError ? 'warning' : '');
        elements.connectionStatus.innerHTML = `
            <span class="dot ${dotClass}"></span>
            <span>${escapeHtml(label)}</span>
        `;
    }

    return { renderStatus };
}
