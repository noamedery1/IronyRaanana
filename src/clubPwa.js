// Applies the active club's PWA identity at runtime: manifest, title, theme color,
// and apple-touch-icon. Run once before React renders (see main.jsx).
import { getActiveClub } from './clubConfig.js';

function setLink(rel, href, extra = {}) {
    let el = document.querySelector(`link[rel="${rel}"]`);
    if (!el) {
        el = document.createElement('link');
        el.rel = rel;
        document.head.appendChild(el);
    }
    el.href = href;
    Object.entries(extra).forEach(([k, v]) => el.setAttribute(k, v));
}

function setMeta(name, content) {
    let el = document.querySelector(`meta[name="${name}"]`);
    if (!el) {
        el = document.createElement('meta');
        el.name = name;
        document.head.appendChild(el);
    }
    el.content = content;
}

export function setupClubPwa() {
    const club = getActiveClub();

    // On the trainer portal, install as a SEPARATE app with its own name + icon.
    const isTrainer = /\/trainer(\/|$)/.test(window.location.pathname);
    if (isTrainer) {
        setLink('manifest', '/trainer.webmanifest');
        document.title = 'פורטל מאמנים — ' + club.shortName;
        setMeta('theme-color', club.themeColor);
        setMeta('apple-mobile-web-app-title', 'מאמנים');
        setLink('apple-touch-icon', '/icons/trainer-192.png');
        return;
    }

    // Point the manifest at the per-club file (overrides the build-time default).
    setLink('manifest', `/clubs/${club.slug}.webmanifest`);

    // Title + theme + iOS home-screen icon.
    document.title = club.name;
    setMeta('theme-color', club.themeColor);
    setMeta('apple-mobile-web-app-title', club.shortName);
    setLink('apple-touch-icon', club.appleIcon);
}
