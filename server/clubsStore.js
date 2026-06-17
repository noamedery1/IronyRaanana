// Club registry — DB-backed (table `clubs`, with a jsonb `config` for extra fields).
// Uploaded icons still live on the volume (binary), referenced by URL inside config.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR =
    process.env.DATA_DIR ||
    process.env.RAILWAY_VOLUME_MOUNT_PATH ||
    path.join(__dirname, '..', 'data');
export const ICONS_DIR = path.join(DATA_DIR, 'icons');

// Canonical seed for the default club (kept correct on every boot).
const RAANANA = {
    slug: 'raanana',
    name: 'עירוני רעננה — לו"ז',
    sport: 'basketball',
    dataUrl: 'https://docs.google.com/spreadsheets/d/1rNKH9jFD6JEyUvToKKvpoffpCS-X_tcWeWFTPwH3m9o/export?format=csv&gid=0',
    config: {
        shortName: 'רעננה לו"ז',
        themeColor: '#ff7a18',
        backgroundColor: '#070b16',
        icon192: '/pwa-192x192.png',
        icon512: '/pwa-512x512.png',
        appleIcon: '/apple-touch-icon.png',
        publishUrl: 'https://docs.google.com/spreadsheets/d/1fpbkPyUIGUn_wwdJDXf4dhwHvv5Y-KRYfnmv026Gs6w/export?format=csv&gid=0',
        sheetApi: 'https://script.google.com/macros/s/AKfycbxZBUPujrqGRHOgX7Vb8JXdGuivho-FiMqGoshZxLTvqIumLDKGUzyc1mM9-W4jVC0/exec',
        managerEmails: ['Dani.tankel@gmail.com'],
    },
};

// DB row -> the flat club object callers expect.
const flatten = (row) => (row ? { slug: row.slug, name: row.name, sport: row.sport || '', dataUrl: row.data_url || '', ...(row.config || {}) } : null);

export async function ensureStore() {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
    // Seed/refresh raanana: keep existing edits, fill any missing keys from the seed.
    await pool.query(
        `INSERT INTO clubs (slug, name, sport, data_url, config) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (slug) DO UPDATE SET
           name = excluded.name,
           sport = COALESCE(NULLIF(clubs.sport,''), excluded.sport),
           data_url = COALESCE(NULLIF(clubs.data_url,''), excluded.data_url),
           config = excluded.config || clubs.config`,
        [RAANANA.slug, RAANANA.name, RAANANA.sport, RAANANA.dataUrl, JSON.stringify(RAANANA.config)],
    );
}

export async function listClubs() {
    const r = await pool.query('SELECT slug, name, sport, data_url, config FROM clubs ORDER BY created_at');
    return r.rows.map(flatten);
}

export async function getClub(slug) {
    const r = await pool.query('SELECT slug, name, sport, data_url, config FROM clubs WHERE slug=$1', [slug]);
    return flatten(r.rows[0]);
}

// Insert or update a club by slug. Columns: slug/name/sport/data_url; everything else -> config.
export async function upsertClub(record) {
    const { slug, name, sport, dataUrl, data_url, ...config } = record;
    await pool.query(
        `INSERT INTO clubs (slug, name, sport, data_url, config) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (slug) DO UPDATE SET
           name = excluded.name, sport = excluded.sport, data_url = excluded.data_url,
           config = clubs.config || excluded.config`,
        [slug, name, sport || '', dataUrl || data_url || '', JSON.stringify(config)],
    );
    return getClub(slug);
}

export async function deleteClub(slug) {
    await pool.query('DELETE FROM clubs WHERE slug=$1', [slug]);
}

// Save a base64 PNG icon to the volume; returns its public URL.
export function saveIcon(slug, kind, base64) {
    const data = base64.includes(',') ? base64.split(',')[1] : base64;
    const file = `${slug}-${kind}.png`;
    fs.writeFileSync(path.join(ICONS_DIR, file), Buffer.from(data, 'base64'));
    return `/clubicons/${file}`;
}

export function manifestFor(club) {
    return {
        id: `/${club.slug}`,
        name: club.name,
        short_name: club.shortName || club.name,
        description: club.description || '',
        lang: 'he', dir: 'rtl',
        theme_color: club.themeColor || '#ff7a18',
        background_color: club.backgroundColor || '#070b16',
        display: 'standalone', orientation: 'portrait',
        start_url: `/${club.slug}`, scope: '/',
        icons: [
            { src: club.icon192, sizes: '192x192', type: 'image/png' },
            { src: club.icon512, sizes: '512x512', type: 'image/png' },
            { src: club.icon512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ].filter((ic) => ic.src),
    };
}
