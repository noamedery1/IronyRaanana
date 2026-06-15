/* eslint-disable no-undef */
// Web Push handlers, imported into the generated service worker (see vite.config.js workbox.importScripts).
// Keeps push logic separate from the Workbox precache/runtime-caching code.

self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = { title: 'עירוני רעננה כדורסל', body: event.data ? event.data.text() : '' };
    }

    const title = payload.title || 'עירוני רעננה כדורסל';
    const icon = payload.icon || '/pwa-192x192.png';
    const options = {
        body: payload.body || '',
        icon: icon,
        badge: icon,
        dir: 'rtl',
        lang: 'he',
        tag: payload.tag || 'schedule-update',
        renotify: true,
        data: { url: payload.url || '/' },
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Only focus a window that's already on the target path — don't hijack the
            // parent-app window and navigate it. Otherwise open the target fresh, which
            // launches the matching installed app (e.g. the trainer PWA for /…/trainer).
            const targetPath = target.split('?')[0];
            for (const client of clientList) {
                try {
                    if (new URL(client.url).pathname.indexOf(targetPath) === 0 && 'focus' in client) {
                        return client.focus();
                    }
                } catch (e) { /* ignore */ }
            }
            if (self.clients.openWindow) return self.clients.openWindow(target);
        })
    );
});
