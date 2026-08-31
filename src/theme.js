// Light/Dark theme. Dark is the default; a toggle flips <html data-theme> and
// persists the choice. Applied at boot (main.jsx) before render to avoid a flash.
const KEY = 'theme';

export function getTheme() {
    try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

export function applyTheme(t) {
    if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
}

export function initTheme() { applyTheme(getTheme()); }

export function toggleTheme() {
    const next = getTheme() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
    applyTheme(next);
    return next;
}
