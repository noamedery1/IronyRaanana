// "Something's stuck — reset" for a parent whose device got into a bad state after several
// install attempts (old cached bundle, a half-registered service worker). Clears every PWA
// cache + unregisters all service workers, then hard-reloads with a cache-busting query.
// By default it KEEPS the parent's login/memberships so they don't have to register again.
export async function resetApp({ keepIdentity = true } = {}) {
    try {
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((r) => r.unregister()));
        }
    } catch { /* ignore */ }
    try {
        if (window.caches) {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
        }
    } catch { /* ignore */ }
    try {
        localStorage.removeItem('pwaPromptDismissed'); // let the install prompt show again
        if (!keepIdentity) {
            ['userToken', 'userRole', 'userTeam', 'userName', 'memberships', 'entryRole', 'entryTeam']
                .forEach((k) => localStorage.removeItem(k));
        }
    } catch { /* ignore */ }
    try {
        const u = new URL(window.location.href);
        u.searchParams.set('fresh', Date.now().toString()); // bust any intermediary cache
        window.location.replace(u.toString());
    } catch {
        window.location.reload();
    }
}
