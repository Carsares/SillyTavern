export function createShellElements(root = document) {
    return {
        app: root.getElementById('modernApp'),
        navList: root.getElementById('navList'),
        content: root.getElementById('content'),
        inspector: root.getElementById('inspector'),
        search: root.getElementById('globalSearch'),
        refreshButton: root.getElementById('refreshButton'),
        themeButton: root.getElementById('themeButton'),
        mobileMenuButton: root.getElementById('mobileMenuButton'),
        connectionStatus: root.getElementById('connectionStatus'),
        commandPalette: root.getElementById('commandPalette'),
        paletteSearch: root.getElementById('paletteSearch'),
        paletteResults: root.getElementById('paletteResults'),
        toastStack: root.getElementById('toastStack'),
    };
}
