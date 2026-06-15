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

    // One shared app for parents + trainers (Android can't install two PWAs per origin).
    // Same icon/name for all; the app opens to the right screen by identity (RootRedirect).
    setLink('manifest', `/clubs/${club.slug}.webmanifest`);

    // Title + theme + iOS home-screen icon.
    document.title = club.name;
    setMeta('theme-color', club.themeColor);
    setMeta('apple-mobile-web-app-title', club.shortName);
    setLink('apple-touch-icon', club.appleIcon);
}
