// Per-club settings (key/value JSON): halls config, floating message, future toggles.
import { pool } from './db.js';
import { clubId } from './people.js';

export async function getSetting(slug, key) {
    const cid = await clubId(slug);
    const r = await pool.query('SELECT value FROM club_settings WHERE club_id=$1 AND key=$2', [cid, key]);
    return r.rows[0]?.value ?? null;
}

export async function setSetting(slug, key, value) {
    const cid = await clubId(slug);
    await pool.query(
        `INSERT INTO club_settings (club_id, key, value) VALUES ($1,$2,$3)
         ON CONFLICT (club_id, key) DO UPDATE SET value=excluded.value, updated_at=now()`,
        [cid, key, JSON.stringify(value ?? {})],
    );
    return { ok: true };
}

// Halls list = distinct halls from the live schedule, merged with saved per-hall config.
export async function listHalls(slug) {
    const cid = await clubId(slug);
    const r = await pool.query(
        `SELECT DISTINCT hall FROM sessions
         WHERE club_id=$1 AND hall IS NOT NULL AND hall <> ''
           AND publication_id=(SELECT id FROM schedule_publications WHERE club_id=$1 AND status='live' ORDER BY week_start DESC LIMIT 1)`,
        [cid],
    );
    const cfg = (await getSetting(slug, 'halls')) || {};
    const names = new Set(r.rows.map((x) => x.hall.trim()));
    Object.keys(cfg).forEach((n) => names.add(n));
    const halls = [...names].sort((a, b) => a.localeCompare(b, 'he')).map((name) => ({
        name,
        type: cfg[name]?.type || 'FULL',
        courts: cfg[name]?.courts || 2,
        address: cfg[name]?.address || '',
    }));
    return { halls, config: cfg };
}

export const saveHalls = (slug, config) => setSetting(slug, 'halls', config || {});
