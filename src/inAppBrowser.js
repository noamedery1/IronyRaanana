// Detect an in-app browser (WhatsApp / Instagram / Facebook / etc.), where — especially on iOS —
// localStorage is often ephemeral and isolated from Safari and from the installed PWA. Registering
// there doesn't persist, so the user is asked to sign up again on every open. We detect it to steer
// the user into real Safari, where storage survives.

export function isIOS() {
    const ua = navigator.userAgent || '';
    return /iphone|ipad|ipod/i.test(ua)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
    try {
        return window.matchMedia?.('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
    } catch { return false; }
}

// Known in-app browsers that expose themselves in the UA (Android WhatsApp, IG, FB, Line, …).
function knownInAppUA() {
    const ua = navigator.userAgent || '';
    return /(FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|WhatsApp|Snapchat|Twitter|TikTok|Messenger)/i.test(ua);
}

// iOS custom in-app WKWebViews (e.g. WhatsApp's) usually DON'T carry the "Safari/" + "Version/" tokens
// that real Mobile Safari does — so their absence on iOS (while not installed) flags an in-app browser.
function iosInAppWebView() {
    if (!isIOS() || isStandalone()) return false;
    const ua = navigator.userAgent || '';
    const realSafari = /Safari\//.test(ua) && /Version\//.test(ua);
    return !realSafari;
}

export function isInAppBrowser() {
    return knownInAppUA() || iosInAppWebView();
}
