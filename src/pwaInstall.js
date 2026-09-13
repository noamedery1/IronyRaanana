// One-tap PWA install (where the browser allows it).
//
// Chromium browsers fire `beforeinstallprompt` when the app is installable; we capture and
// stash that event so a button can trigger the native install dialog on demand. iOS Safari
// has no such API (install is a manual share-sheet action), so there this simply stays
// unavailable and callers fall back to showing manual steps.

let deferredPrompt = null;
let installed = false;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });

if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();       // stop Chrome's own mini-infobar; we drive it from our button
        deferredPrompt = e;
        notify();
    });
    window.addEventListener('appinstalled', () => {
        installed = true;
        deferredPrompt = null;
        notify();
    });
}

// True when a native install prompt is available to trigger right now (Android/Chromium).
export function canInstallNow() { return !!deferredPrompt; }
export function wasInstalled() { return installed; }

// Subscribe to availability changes; returns an unsubscribe fn.
export function onInstallChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Trigger the native install dialog. Returns { ok, outcome } — a prompt can be used only once.
export async function promptInstall() {
    if (!deferredPrompt) return { ok: false, reason: 'unavailable' };
    const p = deferredPrompt;
    deferredPrompt = null; // a beforeinstallprompt event is single-use
    notify();
    try {
        p.prompt();
        const choice = await p.userChoice;
        return { ok: choice.outcome === 'accepted', outcome: choice.outcome };
    } catch {
        return { ok: false, reason: 'error' };
    }
}
