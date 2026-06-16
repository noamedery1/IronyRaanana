// Phase 2: trainers, members/operators, and teams — all in the DB.
// Mirrors the response shapes the client already expects (from the old Apps Script),
// so the frontend only swaps the URL, not the logic.
import crypto from 'crypto';
import { pool, withTx } from './db.js';
import { getClub } from './clubsStore.js';

const TRAINER_COLORS = ['#FCE5CD', '#D9EAD3', '#CFE2F3', '#F4CCCC', '#FFF2CC', '#D9D2E9', '#D0E0E3', '#EAD1DC'];
const newToken = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const splitTeams = (s) => (s || '').split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);

// Resolve (and lazily create) the club row; trainers/users may exist before any publish.
async function clubId(slug, cx = pool) {
    const r = await cx.query('SELECT id FROM clubs WHERE slug=$1', [slug]);
    if (r.rows.length) return r.rows[0].id;
    const c = getClub(slug);
    if (!c) throw new Error('Unknown club: ' + slug);
    const ins = await cx.query(
        `INSERT INTO clubs (slug, name, sport, data_url) VALUES ($1,$2,$3,$4)
         ON CONFLICT (slug) DO UPDATE SET name=excluded.name RETURNING id`,
        [c.slug, c.name, c.sport || null, c.dataUrl || null],
    );
    return ins.rows[0].id;
}

// ===== Trainers =====
export async function listTrainers(slug) {
    const cid = await clubId(slug);
    const r = await pool.query('SELECT name, teams FROM trainers WHERE club_id=$1', [cid]);
    // merge duplicates by name (combine teams), sort by name
    const byName = {};
    const order = [];
    for (const row of r.rows) {
        const key = row.name.trim().toLowerCase();
        if (!byName[key]) { byName[key] = { name: row.name.trim(), teams: [] }; order.push(key); }
        splitTeams(row.teams).forEach((t) => { if (!byName[key].teams.includes(t)) byName[key].teams.push(t); });
    }
    const list = order.map((k) => ({ name: byName[k].name, teams: byName[k].teams.join(', ') }));
    list.sort((a, b) => a.name.localeCompare(b.name, 'he'));
    return list;
}

export async function saveTrainer(slug, { name, code, teams }) {
    const nm = (name || '').trim();
    if (!nm) throw new Error('חסר שם');
    const cid = await clubId(slug);
    return withTx(async (cx) => {
        const existing = await cx.query('SELECT code, color, token FROM trainers WHERE club_id=$1 AND lower(name)=lower($2) LIMIT 1', [cid, nm]);
        if (!existing.rows.length && !(code || '').trim()) throw new Error('מאמן חדש דורש קוד');
        const base = existing.rows[0] || {};
        const color = base.color || TRAINER_COLORS[Math.floor(Math.random() * TRAINER_COLORS.length)];
        const token = base.token || newToken();
        // consolidate: delete all rows for this name, then insert one merged row
        await cx.query('DELETE FROM trainers WHERE club_id=$1 AND lower(name)=lower($2)', [cid, nm]);
        await cx.query(
            `INSERT INTO trainers (club_id, name, code, teams, color, token) VALUES ($1,$2,$3,$4,$5,$6)`,
            [cid, nm, (code || '').trim() || base.code || '', (teams || '').toString(), color, token],
        );
        return { ok: true };
    });
}

export async function deleteTrainer(slug, name) {
    const cid = await clubId(slug);
    const r = await pool.query('DELETE FROM trainers WHERE club_id=$1 AND lower(name)=lower($2)', [cid, (name || '').trim()]);
    return { ok: true, removed: r.rowCount };
}

export async function authTrainer(slug, { token, name, code }) {
    const cid = await clubId(slug);
    let row;
    if (token) {
        const r = await pool.query('SELECT * FROM trainers WHERE club_id=$1 AND token=$2 LIMIT 1', [cid, token]);
        row = r.rows[0];
    }
    if (!row && name && code) {
        const r = await pool.query('SELECT * FROM trainers WHERE club_id=$1 AND lower(name)=lower($2) AND code=$3 LIMIT 1', [cid, name.trim(), code.toString().trim()]);
        row = r.rows[0];
    }
    if (!row) return { valid: false };
    // ensure color + token persisted
    let { color, token: tok } = row;
    if (!color || !tok) {
        color = color || TRAINER_COLORS[Math.floor(Math.random() * TRAINER_COLORS.length)];
        tok = tok || newToken();
        await pool.query('UPDATE trainers SET color=$1, token=$2 WHERE id=$3', [color, tok, row.id]);
    }
    return { valid: true, trainerName: row.name, teams: splitTeams(row.teams), color, token: tok };
}

// ===== Members / operators =====
export async function registerUser(slug, { role, team, name, email, phone }) {
    if (role !== 'member' && role !== 'operator') return { valid: false, error: 'Invalid role' };
    if (role === 'member' && !team) return { valid: false, error: 'Missing team' };
    if (!name || (!email && !phone)) return { valid: false, error: 'Missing name / contact' };
    const cid = await clubId(slug);
    const token = newToken();
    await pool.query(
        `INSERT INTO app_users (club_id, token, role, team, name, email, phone) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [cid, token, role, team || '', name, email || '', phone || ''],
    );
    return { valid: true, token, role, team: team || '', name };
}

export async function authUser(slug, { token }) {
    if (!token) return { valid: false };
    const cid = await clubId(slug);
    const r = await pool.query('SELECT role, team, name FROM app_users WHERE club_id=$1 AND token=$2 LIMIT 1', [cid, token]);
    if (!r.rows.length) return { valid: false };
    return { valid: true, ...r.rows[0] };
}

// ===== Teams =====
export async function listTeams(slug) {
    const cid = await clubId(slug);
    const r = await pool.query('SELECT id, name, gender, coach, active FROM teams WHERE club_id=$1 ORDER BY name', [cid]);
    return r.rows;
}

export async function upsertTeam(slug, { id, name, gender, coach, active }) {
    const nm = (name || '').trim();
    if (!nm) throw new Error('חסר שם קבוצה');
    const cid = await clubId(slug);
    if (id) {
        const r = await pool.query(
            `UPDATE teams SET name=$1, gender=$2, coach=$3, active=COALESCE($4, active) WHERE id=$5 AND club_id=$6 RETURNING *`,
            [nm, gender || 'M', coach || null, active, id, cid],
        );
        return r.rows[0];
    }
    const r = await pool.query(
        `INSERT INTO teams (club_id, name, gender, coach) VALUES ($1,$2,$3,$4)
         ON CONFLICT (club_id, lower(name)) DO UPDATE SET gender=excluded.gender, coach=excluded.coach, active=true
         RETURNING *`,
        [cid, nm, gender || 'M', coach || null],
    );
    return r.rows[0];
}

export async function deleteTeam(slug, id) {
    const cid = await clubId(slug);
    await pool.query('DELETE FROM teams WHERE id=$1 AND club_id=$2', [id, cid]);
    return { ok: true };
}

// Called from publish: seed/refresh the teams table from the published sessions.
export async function seedTeamsFromSessions(cx, clubIdVal, publicationId) {
    // One row per team name (a name may appear with varying gender/coach across sessions).
    await cx.query(
        `INSERT INTO teams (club_id, name, gender, coach)
         SELECT DISTINCT ON (lower(team)) $1, team, gender, coach
         FROM sessions WHERE publication_id=$2 AND team IS NOT NULL AND team <> ''
         ORDER BY lower(team)
         ON CONFLICT (club_id, lower(name)) DO UPDATE SET gender=excluded.gender,
            coach=COALESCE(NULLIF(excluded.coach,''), teams.coach), active=true`,
        [clubIdVal, publicationId],
    );
}
