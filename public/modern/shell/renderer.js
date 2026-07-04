export function createRenderer({
    state,
    elements,
    routeRenderers,
    renderLoading,
    renderNav,
    renderStatus,
    renderInspector,
    renderPalette,
}) {
    function renderContent() {
        if (state.loading && !state.loaded) {
            elements.content.innerHTML = renderLoading();
            return;
        }

        const renderRoute = routeRenderers[state.route] || routeRenderers.dashboard;
        elements.content.innerHTML = renderRoute();
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
