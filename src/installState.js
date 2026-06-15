// Shared PWA install state. Captures the browser's `beforeinstallprompt` event once
// (at module load, before React mounts) so both the first-visit modal and the
// persistent install button can trigger installation from the same deferred prompt.

let deferredPrompt = null;
let installed = false;
const listeners = new Set();

function notify() { listeners.forEach((cb) => cb()); }

if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        notify();
    });
    window.addEventListener('appinstalled', () => {
        installed = true;
        deferredPrompt = null;
        notify();
    });
}

export function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function hasNativePrompt() {
    return !!deferredPrompt;
}

// Can we offer install at all? (native prompt available, or iOS which needs manual steps)
export function canInstall() {
    return !installed && !isStandalone() && (!!deferredPrompt || isIOS());
}

export function subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

export async function promptInstall() {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch { /* ignore */ }
    deferredPrompt = null;
    notify();
    return true;
}
