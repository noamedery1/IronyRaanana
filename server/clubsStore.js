// Persistent club store backed by a Railway Volume (or a local ./data dir in dev).
// Clubs live in clubs.json; uploaded icons live under <DATA_DIR>/icons and are
// served at /clubicons/<file>. Set DATA_DIR to the volume mount path on Railway.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Prefer an explicit DATA_DIR, else Railway's auto-injected volume mount path,
// else a local ./data dir (dev). Attaching a Railway Volume is enough — no manual env needed.
export const DATA_DIR =
    process.env.DATA_DIR ||
    process.env.RAILWAY_VOLUME_MOUNT_PATH ||
    path.join(__dirname, '..', 'data');
export const ICONS_DIR = path.join(DATA_DIR, 'icons');
const CLUBS_FILE = path.join(DATA_DIR, 'clubs.json');

// The built-in legacy club, seeded on first run so existing behavior is preserved.
const SEED = [
    {
        slug: 'raanana',
        name: 'עירוני רעננה — לו"ז',
        shortName: 'רעננה לו"ז',
        themeColor: '#ff7a18',
        backgroundColor: '#070b16',
        icon192: '/pwa-192x192.png',
        icon512: '/pwa-512x512.png',
        appleIcon: '/apple-touch-icon.png',
        dataUrl: 'https://docs.google.com/spreadsheets/d/1rNKH9jFD6JEyUvToKKvpoffpCS-X_tcWeWFTPwH3m9o/export?format=csv&gid=0',
        sheetApi: 'https://script.google.com/macros/s/AKfycbxZBUPujrqGRHOgX7Vb8JXdGuivho-FiMqGoshZxLTvqIumLDKGUzyc1mM9-W4jVC0/exec',
    },
];

export function ensureStore() {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
    if (!fs.existsSync(CLUBS_FILE)) {
        fs.writeFileSync(CLUBS_FILE, JSON.stringify(SEED, null, 2), 'utf8');
    }
}

export function listClubs() {
    try {
        return JSON.parse(fs.readFileSync(CLUBS_FILE, 'utf8'));
    } catch {
        return [...SEED];
    }
}

export function getClub(slug) {
    return listClubs().find((c) => c.slug === slug) || null;
}

function writeClubs(clubs) {
    fs.writeFileSync(CLUBS_FILE, JSON.stringify(clubs, null, 2), 'utf8');
}

// Insert or update a club by slug. Returns the saved record.
export function upsertClub(record) {
    const clubs = listClubs();
    const i = clubs.findIndex((c) => c.slug === record.slug);
    if (i >= 0) clubs[i] = { ...clubs[i], ...record };
    else clubs.push(record);
    writeClubs(clubs);
    return getClub(record.slug);
}

export function deleteClub(slug) {
    const clubs = listClubs().filter((c) => c.slug !== slug);
    writeClubs(clubs);
}

// Save a base64 (data-URL or raw) PNG icon to the volume; returns its public URL.
export function saveIcon(slug, kind, base64) {
    const data = base64.includes(',') ? base64.split(',')[1] : base64;
    const file = `${slug}-${kind}.png`;
    fs.writeFileSync(path.join(ICONS_DIR, file), Buffer.from(data, 'base64'));
    return `/clubicons/${file}`;
}

// Build a Web App Manifest object from a club record.
export function manifestFor(club) {
    return {
        id: `/${club.slug}`,
        name: club.name,
        short_name: club.shortName || club.name,
        description: club.description || '',
        lang: 'he',
        dir: 'rtl',
        theme_color: club.themeColor || '#ff7a18',
        background_color: club.backgroundColor || '#070b16',
        display: 'standalone',
        orientation: 'portrait',
        start_url: `/${club.slug}`,
        scope: '/',
        icons: [
            { src: club.icon192, sizes: '192x192', type: 'image/png' },
            { src: club.icon512, sizes: '512x512', type: 'image/png' },
            { src: club.icon512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ].filter((ic) => ic.src),
    };
}
