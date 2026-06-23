// ===== Multi-club registry (client) =====
// One deploy serves many clubs. Clubs are stored on the server (Railway volume) and
// fetched at startup via loadClubs(); a built-in raanana entry is the offline fallback.
// The active club is the first URL path segment (e.g. /raanana, /hapoel).

const BUILTIN = {
    raanana: {
        slug: 'raanana',
        name: 'עירוני רעננה — לו"ז',
        shortName: 'רעננה לו"ז',
        themeColor: '#ff7a18',
        backgroundColor: '#070b16',
        icon192: '/pwa-192x192.png',
        icon512: '/pwa-512x512.png',
        appleIcon: '/apple-touch-icon.png',
        logo: '/men_logo.png',
        dataUrl: 'https://docs.google.com/spreadsheets/d/1rNKH9jFD6JEyUvToKKvpoffpCS-X_tcWeWFTPwH3m9o/export?format=csv&gid=0',
        sheetApi: 'https://script.google.com/macros/s/AKfycbxZBUPujrqGRHOgX7Vb8JXdGuivho-FiMqGoshZxLTvqIumLDKGUzyc1mM9-W4jVC0/exec',
    },
};

export const DEFAULT_CLUB = 'raanana';

// Live registry — starts with the built-in club, merged with whatever the server returns.
let REGISTRY = { ...BUILTIN };

// Reserved first-segment paths that are NOT club slugs (legacy + admin + superuser).
const RESERVED = new Set(['women', 'trainer', 'admin', 'superuser']);

// Fetch the club list from the server once at startup. Safe to fail (keeps fallback).
export async function loadClubs() {
    try {
        const res = await fetch('/api/clubs');
        if (res.ok) {
            const list = await res.json();
            const map = {};
            list.forEach((c) => { if (c && c.slug) map[c.slug] = c; });
            REGISTRY = { ...BUILTIN, ...map };
        }
    } catch {
        /* offline / not deployed yet — keep built-in fallback */
    }
}

export function getClubSlug() {
    const seg = window.location.pathname.split('/').filter(Boolean)[0];
    if (seg && !RESERVED.has(seg) && REGISTRY[seg]) return seg;
    return DEFAULT_CLUB;
}

// Strict check: is this URL segment a real, registered club? (No raanana fallback.)
// Used to gate routes — a link without a valid club shows "not connected to a club".
export function isKnownClub(slug) {
    return Boolean(slug && !RESERVED.has(slug) && REGISTRY[slug]);
}

export function getActiveClub() {
    return REGISTRY[getClubSlug()] || REGISTRY[DEFAULT_CLUB];
}

export function getAllClubs() {
    return Object.values(REGISTRY);
}
