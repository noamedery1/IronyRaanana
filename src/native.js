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

// Any Android WebView (UA token "; wv)") — e.g. an OLD Squadio build without the UA tag, or a
// social app's in-app browser. A PWA can never be installed from a WebView, so install UI is
// pointless there, and the "install from the store" detour only confuses an app user.
export function isAndroidWebView() {
    try { return /; wv\)/.test(navigator.userAgent || ''); } catch { return false; }
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

// When a native push is TAPPED while the app is already running (backgrounded), Capacitor fires
// `pushNotificationActionPerformed` on whatever page the WebView currently shows — i.e. this live-site
// bundle. The launcher (native-shell/index.html) also registers this, but once the app has navigated
// here its listener is gone, so without this the tapped link was dropped (app came forward on the old
// page). Cold-start taps are still handled by the launcher before it navigates here, so this only adds
// the missing warm/background path. External links (an Instagram/Facebook post) open in the system
// browser; a squadio link/path navigates the WebView. No-op on the web. Safe to call once at boot.
export function installNativePushTap() {
    if (!isNativeApp() || window.__nativePushTapInstalled) return;
    window.__nativePushTapInstalled = true;
    try {
        const PN = window.Capacitor?.Plugins?.PushNotifications;
        if (!PN?.addListener) return;
        PN.addListener('pushNotificationActionPerformed', (a) => {
            try {
                const d = (a && a.notification && a.notification.data) || {};
                const url = d.url || d.link || '';
                if (!url) return;
                const base = window.location.origin;
                const full = /^https?:\/\//i.test(url) ? url : (base + (url.charAt(0) === '/' ? '' : '/') + url);
                let host = '';
                try { host = new URL(full).hostname.toLowerCase(); } catch { /* bad url */ }
                if (/(^|\.)squadio\.techbynoam\.com$/i.test(host)) {
                    if (full !== window.location.href) window.location.href = full; // in-app page
                } else {
                    try { window.open(full, '_system'); } catch { window.location.href = full; } // external → system browser
                }
            } catch { /* ignore malformed action */ }
        });
    } catch { /* not native / plugin missing */ }
}
