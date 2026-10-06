// Native-app awareness for the LIVE SITE bundle. This same web build is served to browsers/PWAs AND
// loaded inside the bundled native app's WebView, where Capacitor injects a global `window.Capacitor`.
// So we detect and use it via that global — deliberately WITHOUT importing the Capacitor SDK, so the
// web build needs no native dependency and stays unchanged for ordinary web users.

export function isNativeApp() {
    try {
        if (window.Capacitor?.isNativePlatform?.() === true) return true;
        // The bundled app navigates to this live site, where Capacitor's bridge isn't injected. It
        // tags its WebView User-Agent with "SquadioApp" (capacitor.config appendUserAgent) so we can
        // still detect it here and suppress web-only UI (install popups, PWA-notification guidance).
        return /SquadioApp/i.test(navigator.userAgent || '');
    } catch { return false; }
}

// When running inside the native app, a tapped Squadio https link (App Link / Universal Link) that
// arrives while the app is already open should navigate the WebView to that exact URL, so the invite's
// Join / personal-sign-in handling runs. Cold-start launch URLs are handled by the native launcher.
// No-op on the web (no global Capacitor). Safe to call once at boot.
export function installNativeDeepLinks() {
    if (!isNativeApp() || window.__nativeDeepLinksInstalled) return;
    window.__nativeDeepLinksInstalled = true;
    try {
        const App = window.Capacitor?.Plugins?.App;
        if (!App?.addListener) return;
        App.addListener('appUrlOpen', (data) => {
            try {
                const u = new URL(data.url);
                if (!/(^|\.)squadio\.techbynoam\.com$/i.test(u.hostname)) return;
                if (u.href !== window.location.href) window.location.href = u.href;
            } catch { /* malformed URL */ }
        });
    } catch { /* not native */ }
}
