// One-time import of existing Trainers / Users / Subscribers / PushSubs from the
// club's Google Sheet (hidden tabs, via gviz CSV) into the DB.
// Usage: node scripts/backfill.mjs [slug]
import 'dotenv/config';
import Papa from 'papaparse';
import { pool } from '../server/db.js';
import { clubId } from '../server/people.js';
import { getClub } from '../server/clubsStore.js';

const slug = process.argv[2] || 'raanana';
const club = getClub(slug);
if (!club?.dataUrl) { console.error('No dataUrl for club', slug); process.exit(1); }
const sheetId = club.dataUrl.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
if (!sheetId) { console.error('Could not extract sheet id'); process.exit(1); }

const tab = async (name) => {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const csv = await res.text();
    return Papa.parse(csv, { header: true, skipEmptyLines: true }).data;
};

const run = async () => {
    const cid = await clubId(slug);
    const counts = {};

    // Trainers: Name, Code, Teams, (Color), (Token)
    const trainers = await tab('Trainers');
    let t = 0;
    for (const r of trainers) {
        const name = (r.Name || '').trim();
        if (!name) continue;
        await pool.query(
            `INSERT INTO trainers (club_id, name, code, teams, color, token)
             VALUES ($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,''))
             ON CONFLICT (club_id, lower(name)) DO UPDATE SET code=excluded.code, teams=excluded.teams`,
            [cid, name, (r.Code || '').toString().trim(), (r.Teams || '').toString().trim(), (r.Color || '').trim(), (r.Token || '').trim()],
        );
        t++;
    }
    counts.trainers = t;

    // Users: Token, Role, Team, Name, Email, Phone
    const users = await tab('Users');
    let u = 0;
    for (const r of users) {
        const token = (r.Token || '').trim();
        if (!token) continue;
        await pool.query(
            `INSERT INTO app_users (club_id, token, role, team, name, email, phone)
             VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (token) DO NOTHING`,
            [cid, token, (r.Role || '').trim(), (r.Team || '').trim(), (r.Name || '').trim(), (r.Email || '').trim(), (r.Phone || '').toString().trim()],
        );
        u++;
    }
    counts.users = u;

    // Subscribers (email): Name, Email, Team
    const subs = await tab('Subscribers');
    let s = 0;
    for (const r of subs) {
        const email = (r.Email || '').trim();
        if (!email) continue;
        await pool.query(
            `INSERT INTO email_subscribers (club_id, team, name, email)
             VALUES ($1,$2,$3,$4) ON CONFLICT (club_id, lower(email), coalesce(team,'')) DO NOTHING`,
            [cid, (r.Team || '').trim(), (r.Name || '').trim(), email],
        );
        s++;
    }
    counts.email_subscribers = s;

    // PushSubs: Team(segment), Endpoint, Subscription(JSON)
    const ps = await tab('PushSubs');
    let p = 0;
    for (const r of ps) {
        const endpoint = (r.Endpoint || '').trim();
        const subJson = (r.Subscription || '').trim();
        if (!endpoint || !subJson) continue;
        let sub;
        try { sub = JSON.parse(subJson); } catch { continue; }
        await pool.query(
            `INSERT INTO push_subscriptions (club_id, segment, endpoint, subscription)
             VALUES ($1,$2,$3,$4) ON CONFLICT (endpoint) DO NOTHING`,
            [cid, (r.Team || '').trim(), endpoint, sub],
        );
        p++;
    }
    counts.push_subscriptions = p;

    console.log('Backfill complete:', JSON.stringify(counts, null, 2));
    process.exit(0);
};

run().catch((e) => { console.error('Backfill failed:', e.message); process.exit(1); });
