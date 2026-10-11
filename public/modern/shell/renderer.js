import { createAgentWorkspaceHost } from '../components/agent-workspace.js';
import { capturePreservedInputs, restorePreservedInputs } from '../core/preserve-inputs.js';

export function createRenderer({
    state,
    elements,
    routeRenderers,
    renderLoading,
    renderRouteErrorBanner,
    renderNav,
    renderStatus,
    renderInspector,
    renderPalette,
}) {
    const routeLoadErrorKeys = {
        dashboard: ['settingsBundle', 'characters', 'groups', 'worldbooks', 'backgrounds', 'backgroundFolders', 'assets', 'extensions', 'stats'],
        chat: ['settingsBundle', 'characters', 'groups', 'worldbooks'],
        characters: ['characters', 'worldbooks', 'settingsBundle'],
        groups: ['groups', 'characters'],
        worldbooks: ['worldbooks'],
        presets: ['settingsBundle'],
        personas: ['settingsBundle'],
        assets: ['backgrounds', 'backgroundFolders', 'assets'],
        api: ['settingsBundle', 'secrets', 'secretState'],
        extensions: ['extensions'],
        activity: ['stats', 'characters', 'groups'],
        settings: ['settingsBundle', 'extensions'],
    };
    const globalLoadErrorKeys = ['me', 'settings'];
    let agentWorkspace;
    let lastRenderedRoute = '';

    function getRouteLoadErrors() {
        const routeKeys = new Set([...globalLoadErrorKeys, ...(routeLoadErrorKeys[state.route] || [])]);
        return state.errors.filter(error => routeKeys.has(error.key));
    }

    function renderContent() {
        if (state.route === 'agent' && routeRenderers.agent) {
            agentWorkspace ??= createAgentWorkspaceHost(elements.content);
            agentWorkspace.show(routeRenderers.agent());
            lastRenderedRoute = 'agent';
            return;
        }
        agentWorkspace?.hide();
        if (state.loading && !state.loaded) {
            elements.content.innerHTML = renderLoading();
            lastRenderedRoute = '';
            return;
        }

        const renderRoute = routeRenderers[state.route] || routeRenderers.dashboard;
        // 同一页内重绘时保住设置表单里还没提交的输入和焦点（只处理 [data-preserve-inputs] 容器，见 core/preserve-inputs.js）
        const preserved = lastRenderedRoute === state.route ? capturePreservedInputs(elements.content) : [];
        elements.content.innerHTML = `${renderRouteErrorBanner(getRouteLoadErrors())}${renderRoute()}`;
        lastRenderedRoute = state.route;
        restorePreservedInputs(elements.content, preserved);
    }

    function render() {
        elements.app.dataset.loaded = state.loaded ? 'true' : 'false';
        elements.app.dataset.currentRoute = state.route;
        renderNav();
        renderStatus();
        renderContent();
        renderInspector();
        if (!elements.commandPalette.hidden) {
            renderPalette();
        }
    }

    return {
        render,
        renderContent,
    };
}
