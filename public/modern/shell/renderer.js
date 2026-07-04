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

    function getRouteLoadErrors() {
        const routeKeys = new Set([...globalLoadErrorKeys, ...(routeLoadErrorKeys[state.route] || [])]);
        return state.errors.filter(error => routeKeys.has(error.key));
    }

    function renderContent() {
        if (state.loading && !state.loaded) {
            elements.content.innerHTML = renderLoading();
            return;
        }

        const renderRoute = routeRenderers[state.route] || routeRenderers.dashboard;
        elements.content.innerHTML = `${renderRouteErrorBanner(getRouteLoadErrors())}${renderRoute()}`;
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
