export function createTheme({
    state,
    root,
}) {
    function setTheme(theme) {
        state.theme = theme;
        root.dataset.theme = theme;
        localStorage.setItem('st-modern-theme', theme);
    }

    return { setTheme };
}
