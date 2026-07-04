export function bindShellEvents({
    state,
    elements,
    routeModules,
    backgroundPageSize,
    loadData,
    setTheme,
    render,
    renderPalette,
    closePalette,
    openPalette,
    closeChatSidebarOverlay,
    closeChatBackups,
    handleClick,
}) {
    elements.refreshButton.addEventListener('click', () => loadData());
    elements.themeButton.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
    elements.mobileMenuButton.addEventListener('click', () => elements.app.querySelector('.sidebar')?.classList.toggle('open'));
    elements.search.addEventListener('input', event => {
        const query = event.target.value.trim();
        if (query) {
            openPalette(query);
        }
    });
    elements.content.addEventListener('input', event => {
        if (event.target instanceof HTMLInputElement && event.target.matches('[data-route-filter]')) {
            state.query = event.target.value;
            if (state.route === 'assets') {
                state.backgroundVisibleCount = backgroundPageSize;
            }
            render();
            const nextInput = elements.content.querySelector('[data-route-filter]');
            if (nextInput instanceof HTMLInputElement) {
                nextInput.focus();
                const cursor = nextInput.value.length;
                nextInput.setSelectionRange(cursor, cursor);
            }
            return;
        }

        const routeInputHandler = routeModules[state.route]?.handleInput;
        if (routeInputHandler && routeInputHandler(event) !== false) {
            return;
        }
    });
    elements.content.addEventListener('change', async event => {
        const routeChangeHandler = routeModules[state.route]?.handleChange;
        if (routeChangeHandler && await routeChangeHandler(event) !== false) {
            return;
        }
    });
    elements.content.addEventListener('submit', async event => {
        const routeSubmitHandler = routeModules[state.route]?.handleSubmit;
        if (routeSubmitHandler && await routeSubmitHandler(event) !== false) {
            return;
        }
    });
    elements.paletteSearch.addEventListener('input', event => {
        state.paletteQuery = event.target.value.trim();
        renderPalette();
    });
    elements.commandPalette.addEventListener('click', event => {
        if (event.target === elements.commandPalette) {
            closePalette();
        }
    });
    function clickFirstPaletteCommand() {
        const firstCommand = elements.paletteResults.querySelector('[data-command-route]');
        if (firstCommand) {
            firstCommand.click();
        }
    }
    document.addEventListener('click', event => {
        handleClick(event);
    });
    document.addEventListener('keydown', event => {
        if (!elements.commandPalette.hidden) {
            if (event.key === 'Enter') {
                event.preventDefault();
                clickFirstPaletteCommand();
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                closePalette();
                return;
            }
        }

        const routeKeydownHandler = routeModules[state.route]?.handleKeydown;
        if (routeKeydownHandler && routeKeydownHandler(event) !== false) {
            return;
        }

        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            openPalette();
        }
        if (event.key === 'Escape') {
            closePalette();
            elements.app.querySelector('.sidebar')?.classList.remove('open');
            if (closeChatSidebarOverlay() || closeChatBackups()) {
                event.preventDefault();
            }
        }
    });
}
