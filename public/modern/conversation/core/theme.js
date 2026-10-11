// Same storage key as public/modern/shell/theme.js: the embedded page follows the Modern shell.
export const MODERN_THEME_KEY = 'st-modern-theme';

export function readModernTheme(storage = globalThis.localStorage) {
    try { return storage?.getItem(MODERN_THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}

/** Apply the saved Modern theme, then follow changes made by the Modern shell in the same origin. */
export function followModernTheme(root = document.documentElement, target = globalThis) {
    const apply = () => { root.dataset.theme = readModernTheme(target.localStorage); };
    apply();
    // `storage` fires in other same-origin documents, including this frame, when Modern toggles the theme.
    target.addEventListener('storage', event => { if (event.key === MODERN_THEME_KEY || event.key === null) apply(); });
    // Inside the Modern Agent route the shell already shows the title and a way back.
    try { if (target.top !== target.self) root.dataset.embedded = ''; } catch { root.dataset.embedded = ''; }
}
