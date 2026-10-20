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
        logo: '/men_logo.png',
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
    // Belt-and-suspenders: guarantee newer team columns exist even if the formal
    // migration hasn't been run on this DB yet (idempotent; safe on every boot).
    try {
        await pool.query('ALTER TABLE teams ADD COLUMN IF NOT EXISTS age text');
        await pool.query('ALTER TABLE teams ADD COLUMN IF NOT EXISTS grade text');
        // Short, globally-unique 5-digit join code parents type instead of an invite link.
        // Codes are backfilled at boot by people.ensureJoinCodes(); this just guarantees the column.
        await pool.query('ALTER TABLE teams ADD COLUMN IF NOT EXISTS join_code text');
        await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS teams_join_code_uniq ON teams (join_code) WHERE join_code IS NOT NULL');
    } catch { /* teams table not created yet — migration will handle it */ }
    // Origin a push subscription was created on (apex vs a club's subdomain) — lets a club that
    // moved to a subdomain deliver only to subdomain subscriptions and drop stale apex duplicates.
    try {
        await pool.query('ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS host text');
        // Registrant's name, so the manager can identify a device (not just its team/origin).
        await pool.query('ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS label text');
    } catch { /* push_subscriptions not created yet — migration will handle it */ }
    // Native (store-app) push tokens — FCM/APNs device tokens for the bundled Android/iOS apps.
    // Created here too (not only in the formal migration) because deploys don't run migrations, and
    // the native-push register endpoint must have the table to write to. Fully additive.
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS native_push_tokens (
              id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
              token       text UNIQUE NOT NULL,
              segment     text,
              platform    text,
              label       text,
              host        text,
              user_token  text,
              created_at  timestamptz NOT NULL DEFAULT now(),
              updated_at  timestamptz NOT NULL DEFAULT now()
            )`);
        await pool.query('CREATE INDEX IF NOT EXISTS native_push_seg_idx ON native_push_tokens (club_id, segment)');
    } catch (e) { console.error('[native-push] table init failed (non-fatal):', e.message); }
    // FA (Israel FA) games sync — tracked fixtures + their approval state. Additive; created here
    // too because deploys skip migrations. See server/faGames.js.
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS fa_game_sync (
              id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              club_id       uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
              fa_key        text NOT NULL,
              team          text,
              league        text,
              game_name     text,
              opponent      text,
              home_away     text,
              field         text,
              round         int,
              game_date     text,
              game_time     text,
              status        text NOT NULL DEFAULT 'tracking',
              session_id    uuid,
              notified_date text,
              notified_time text,
              created_at    timestamptz NOT NULL DEFAULT now(),
              updated_at    timestamptz NOT NULL DEFAULT now(),
              UNIQUE (club_id, fa_key)
            )`);
        await pool.query('CREATE INDEX IF NOT EXISTS fa_game_sync_status_idx ON fa_game_sync (club_id, status)');
    } catch (e) { console.error('[fa-games] table init failed (non-fatal):', e.message); }
    // Enable FA-games sync for the live Hapoel Raanana football club. Prod-only row (seeded via the
    // super-user screen, not here) so this is a no-op on a dev DB. Fills these keys only when absent
    // (`defaults || config` lets config win), so a later manual edit of the map/emails persists.
    try {
        const FC_DEFAULTS = {
            faClubId: 2203,
            faLeagueMap: {
                'ליגת העל לנוער': 'נוער',
                "נערים א' על": "נערים א'",
                "נערים ב' על": "נערים ב'",
                "נערים ב' לאומית דרום": 'נערים ב צו פיוס',
                "נערים ג' על": "נערים ג'",
                "נערים ג' לאומית דרום": 'נערים ג צו פיוס',
                "ליגת ילדים א' מרכז": "ילדים א'",
                "ליגת ילדים א' שרון 1": 'ילדים א צו פיוס',
                "ליגת ילדים ב' מרכז": "ילדים ב'",
                "ליגת ילדים ב' שרון 1": 'ילדים ב צו פיוס',
                "ליגת ילדים ג' מרכז": "ילדים ג'",
                "ליגת ילדים ג' שרון 1": "ילדים ג' צפון",
                "ליגת ילדים טרום א' שרון": "טרום א'",
                "ליגת ילדים טרום א' שרון 1": "טרום א' צפון",
                "ליגת ילדים טרום ב' שרון": "טרום ב'",
            },
            // Cup games have no 1:1 league, so map them by the (unique) Raanana-side display name.
            // Punctuation is normalized on both sides. Deliberately omits the ambiguous bare names
            // ("הפועל רעננה", "...צפון", "...צו פיוס", "...2 צו פיוס") which can't be resolved by name
            // alone — those stay unmapped and surface to the manager instead of risking a wrong team.
            faNameMap: {
                "הפ' רעננה רועי": 'נוער',
                'הפועל רעננה אביתר עטואר': "נערים א'",
                'הפועל רעננה ליאור אסולין': "נערים ב'",
                'הפ. רעננה דן ווידנבאום צו פיוס': 'נערים ב צו פיוס',
                "הפ' רעננה רחמים צו פיוס": 'ילדים ב צו פיוס',
                'הפועל רעננה אור': "טרום א'",
                "הפ' רעננה ניצן": "טרום ב'",
            },
            managerEmails: ['Dani.tankel@gmail.com'],
        };
        await pool.query(
            `UPDATE clubs SET config = $1::jsonb || coalesce(config,'{}'::jsonb) WHERE slug='fcraanana'`,
            [JSON.stringify(FC_DEFAULTS)],
        );
    } catch (e) { console.error('[fa-games] fcraanana config init failed (non-fatal):', e.message); }
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

// Save an uploaded image (data-URL or raw base64) into the DB as bytes.
// Returns the public URL the client should use to fetch it (cached, served by the API).
export async function saveAsset(slug, kind, dataUrl) {
    let mime = 'image/png';
    let b64 = dataUrl;
    const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '');
    if (m) { mime = m[1]; b64 = m[2]; } else if (dataUrl.includes(',')) { b64 = dataUrl.split(',')[1]; }
    const bytes = Buffer.from(b64, 'base64');
    await pool.query(
        `INSERT INTO club_assets (club_slug, kind, mime, bytes, updated_at)
         VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (club_slug, kind) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes, updated_at = now()`,
        [slug, kind, mime, bytes],
    );
    return `/api/${slug}/icon/${kind}`;
}

// Fetch an image row, or null. updated_at doubles as a cheap ETag/cache key.
export async function getAsset(slug, kind) {
    const r = await pool.query('SELECT mime, bytes, updated_at FROM club_assets WHERE club_slug=$1 AND kind=$2', [slug, kind]);
    return r.rows[0] || null;
}

export function manifestFor(club, startUrl) {
    // `id` stays constant per club so it's always the same installed app; only start_url varies.
    // start_url can be overridden (e.g. an invite page) so the installed icon opens with that context
    // — important on iOS, where Add-to-Home-Screen uses the manifest start_url, not the current URL.
    return {
        id: `/${club.slug}`,
        name: club.name,
        short_name: club.shortName || club.name,
        description: club.description || '',
        lang: 'he', dir: 'rtl',
        theme_color: club.themeColor || '#ff7a18',
        background_color: club.backgroundColor || '#070b16',
        display: 'standalone', orientation: 'portrait',
        start_url: startUrl || `/${club.slug}`, scope: '/',
        icons: [
            { src: club.icon192, sizes: '192x192', type: 'image/png' },
            { src: club.icon512, sizes: '512x512', type: 'image/png' },
            { src: club.icon512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ].filter((ic) => ic.src),
    };
}
