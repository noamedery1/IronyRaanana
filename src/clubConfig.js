// ===== Multi-club registry =====
// One deploy serves many clubs. The active club is taken from the first URL path
// segment (e.g. /raanana, /hapoel). To add a club: add an entry here, drop its
// icons under public/clubs/<slug>/, and add public/clubs/<slug>.webmanifest.

export const CLUBS = {
    raanana: {
        slug: 'raanana',
        name: 'עירוני רעננה — לו"ז',
        shortName: 'רעננה לו"ז',
        themeColor: '#ff7a18',
        backgroundColor: '#070b16',
        // PWA + apple icons (served from /public).
        icon192: '/pwa-192x192.png',
        icon512: '/pwa-512x512.png',
        appleIcon: '/apple-touch-icon.png',
        // Per-club data sources.
        dataUrl: 'https://docs.google.com/spreadsheets/d/1rNKH9jFD6JEyUvToKKvpoffpCS-X_tcWeWFTPwH3m9o/export?format=csv&gid=0',
        sheetApi: 'https://script.google.com/macros/s/AKfycbxZBUPujrqGRHOgX7Vb8JXdGuivho-FiMqGoshZxLTvqIumLDKGUzyc1mM9-W4jVC0/exec',
    },
};

// The legacy/default club — used when the path has no (recognized) club slug, so old
// links like "/" and "/women" keep working and resolve to this club.
export const DEFAULT_CLUB = 'raanana';

// Reserved first-segment paths that are NOT club slugs (legacy + admin routes).
const RESERVED = new Set(['women', 'trainer', 'admin']);

// Resolve the active club slug from the current URL path.
export function getClubSlug() {
    const seg = window.location.pathname.split('/').filter(Boolean)[0];
    if (seg && !RESERVED.has(seg) && CLUBS[seg]) return seg;
    return DEFAULT_CLUB;
}

export function getActiveClub() {
    return CLUBS[getClubSlug()] || CLUBS[DEFAULT_CLUB];
}
