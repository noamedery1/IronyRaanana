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
            for (const client of clientList) {
                if ('focus' in client) {
                    client.navigate(target);
                    return client.focus();
                }
            }
            if (self.clients.openWindow) return self.clients.openWindow(target);
        })
    );
});
