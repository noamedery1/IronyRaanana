// Native (Capacitor) bridge helpers — used ONLY when the web app is bundled into the native shell
// (webDir=dist). No-ops on the web, so importing/calling these is always safe.
import { Capacitor } from '@capacitor/core';

export function isNativeApp() {
    try { return Capacitor?.isNativePlatform?.() === true; } catch { return false; }
}

export function nativePlatform() {
    try { return Capacitor?.getPlatform?.() || 'web'; } catch { return 'web'; }
}

// Production origin the bundled app talks to. When bundled, the app runs on its OWN origin
// (capacitor://localhost / https://localhost), so a relative "/api/…" or "/clubs/…" would hit the
// device instead of the server. We rewrite same-origin absolute-path requests to this host.
export const PROD_ORIGIN = 'https://squadio.techbynoam.com';

// Install a one-time fetch shim that sends relative "/…" requests to the production server when
// running as the bundled native app. Call once at boot (main.jsx), BEFORE any fetch. No-op on web,
// where "/api/…" already resolves to the same origin as the site. Server must allow the native
// origin via CORS for /api (see NATIVE_RELEASE.md). Leaves cross-origin and data: URLs untouched.
export function installNativeApiBase(base = PROD_ORIGIN) {
    if (!isNativeApp()) return;                 // web / PWA — relative requests are already correct
    if (window.__nativeApiBaseInstalled) return;
    window.__nativeApiBaseInstalled = true;
    const orig = window.fetch.bind(window);
    window.fetch = (input, init) => {
        try {
            if (typeof input === 'string' && input.startsWith('/')) {
                input = base + input;
            } else if (input && typeof input === 'object' && typeof input.url === 'string' && input.url.startsWith('/')) {
                input = new Request(base + input.url, input); // Request objects keep method/headers/body
            }
        } catch { /* fall through with the original input */ }
        return orig(input, init);
    };
}
