import express from 'express';
import path from 'path';
import fs from 'node:fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import { publishClub, getLiveSchedule, listPublications, teamICS, getPublicationSessions } from './server/publish.js';
import {
    listTrainers, saveTrainer, deleteTrainer, authTrainer,
    registerUser, authUser, listTeams, upsertTeam, deleteTeam,
    createManager, authManager, listManagers, changeManagerPassword, resetManagerPassword,
} from './server/people.js';
import { registerPush, unregisterPush, broadcast, addEmailSubscriber, removeEmailSubscriber, saveFeedback } from './server/notify.js';
import { createRequest, listRequests, approveRequest, rejectRequest, verifyId } from './server/requests.js';
import { getDraft, getDraftView, replaceDraftSessions, importCsvToDraft, publishDraft } from './server/draft.js';
import { getSetting, setSetting, listHalls, saveHalls } from './server/settings.js';
import { requireManager, signToken, verifyToken } from './server/auth.js';
import { pool } from './server/db.js';
import {
    ensureStore, listClubs, getClub, upsertClub, deleteClub, saveAsset, getAsset, manifestFor, ICONS_DIR,
} from './server/clubsStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

try {
    await ensureStore();
} catch (e) {
    // Don't let a storage/volume hiccup take down the whole server — club features
    // degrade to the client's built-in fallback; push & schedule keep working.
    console.error('[clubs] store init failed:', e.message);
}

// ===== Web Push config =====
// Public key is shipped to the client (src/push.js); private key + secret stay on the server (env vars).
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ||
    'BHRSmWUH9tdilK-Xh31VGoEMGb9jMZayZSk8znHbbPz-1ZdNswqttSUjXWEBrxsgg5KmEqT8xgm5s-QqPG5RCcw';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:noam.edery@tibaparking.com';
const PUSH_SECRET = process.env.PUSH_SECRET || '';

const pushReady = Boolean(VAPID_PRIVATE_KEY && PUSH_SECRET);
if (pushReady) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
    console.warn('[push] disabled — set VAPID_PRIVATE_KEY and PUSH_SECRET env vars to enable Web Push.');
}

app.use(express.json({ limit: '6mb' })); // larger to allow base64 icon uploads

// Diagnostics: confirms the server is connected to Postgres and that migrations ran.
// Open <APP_BASE_URL>/api/health — no secrets are exposed (host only, no credentials).
app.get('/api/health', async (req, res) => {
    const out = { ok: false, db: false, migrationsRan: false, clubs: 0, dbHost: null, pushReady };
    try { out.dbHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).host : '(DATABASE_URL not set)'; }
    catch { out.dbHost = '(unparseable DATABASE_URL)'; }
    try {
        await pool.query('SELECT 1');
        out.db = true;
        const r = await pool.query("SELECT to_regclass('public.pgmigrations') IS NOT NULL AS pm, to_regclass('public.clubs') IS NOT NULL AS clubs");
        out.migrationsRan = Boolean(r.rows[0].pm && r.rows[0].clubs);
        if (out.migrationsRan) out.clubs = (await pool.query('SELECT count(*)::int n FROM clubs')).rows[0].n;
        out.ok = out.db && out.migrationsRan;
    } catch (e) { out.error = e.message; }
    res.status(out.ok ? 200 : 503).json(out);
});

// ===== Superuser auth =====
const SUPERUSER_PASSWORD = process.env.SUPERUSER_PASSWORD || '';

// Superuser auth uses a signed (HMAC) token — stateless, so it survives server
// restarts/redeploys (the old in-memory set was wiped on every deploy → saves 401'd).
function requireSuperuser(req, res, next) {
    const p = verifyToken(req.get('x-superuser-token'));
    if (!p || p.role !== 'superuser') return res.status(401).json({ error: 'unauthorized' });
    next();
}

app.post('/api/superuser/login', (req, res) => {
    if (!SUPERUSER_PASSWORD) return res.status(503).json({ error: 'superuser not configured' });
    const { password } = req.body || {};
    if (password !== SUPERUSER_PASSWORD) return res.status(403).json({ error: 'wrong password' });
    res.json({ token: signToken({ role: 'superuser' }) });
});

// ===== Clubs (public read) =====
app.get('/api/clubs', async (req, res) => {
    try { res.json(await listClubs()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/clubs/:slug', async (req, res) => {
    const club = await getClub(req.params.slug);
    if (!club) return res.status(404).json({ error: 'not found' });
    res.json(club);
});

// ===== Phase 1: schedule in the DB (publish from the manager's Sheet + live reads) =====
// Publish: snapshot the club's Google Sheet into the DB as the live week.
app.post('/api/:club/publish', requireManager, async (req, res) => {
    try {
        const result = await publishClub(req.params.club, req.body || {});
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Read-only draft view for trainers (next week's plan; no auth, like public reads).
app.get('/api/:club/draft/view', async (req, res) => {
    try { res.json(await getDraftView(req.params.club)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== Draft schedule (next week, manager-only) — the DB-backed working copy =====
app.get('/api/:club/draft', requireManager, async (req, res) => {
    try { res.json(await getDraft(req.params.club)); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/:club/draft', requireManager, async (req, res) => {
    try { res.json(await replaceDraftSessions(req.params.club, req.body?.sessions || [], req.body?.weekStart)); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/:club/draft/import', requireManager, async (req, res) => {
    try {
        if (!req.body?.csv) return res.status(400).json({ error: 'missing csv' });
        res.json(await importCsvToDraft(req.params.club, req.body.csv));
    } catch (e) { res.status(400).json({ error: e.message }); }
});
// Publish by promoting the current draft → live (the new DB-only flow).
app.post('/api/:club/publish-draft', requireManager, async (req, res) => {
    try { res.json(await publishDraft(req.params.club, req.body?.publishedBy || 'manager')); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

// Live schedule from the DB (latest live publication, or ?week=YYYY-MM-DD).
app.get('/api/:club/schedule', async (req, res) => {
    try {
        const data = await getLiveSchedule(req.params.club, req.query.week);
        if (!data) return res.status(404).json({ error: 'club not found' });
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Per-club live calendar feed (ICS) from the DB.
app.get('/api/:club/calendar.ics', async (req, res) => {
    const team = (req.query.team || '').toString();
    if (!team) return res.status(400).send('Missing team parameter');
    try {
        const ics = await teamICS(req.params.club, team);
        if (!ics) return res.status(404).send('Team not found');
        res.set('Content-Type', 'text/calendar; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=1800');
        res.set('Content-Disposition', 'inline; filename="schedule.ics"');
        return res.send(ics);
    } catch (e) {
        return res.status(500).send('Error building calendar');
    }
});

// Publication history.
app.get('/api/:club/publications', async (req, res) => {
    try {
        res.json(await listPublications(req.params.club));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// View one publication's schedule (archive view, manager-only).
app.get('/api/:club/publications/:id', requireManager, async (req, res) => {
    try { ok(res, await getPublicationSessions(req.params.club, req.params.id)); } catch (e) { fail(res, e); }
});

// ===== Phase 2: trainers / members / teams in the DB =====
const ok = (res, p) => res.json(p);
const fail = (res, e) => res.status(500).json({ error: e.message });

// Trainers
app.get('/api/:club/trainers', async (req, res) => {
    try { ok(res, { trainers: await listTrainers(req.params.club) }); } catch (e) { fail(res, e); }
});
app.post('/api/:club/trainers', requireManager, async (req, res) => {
    try { ok(res, await saveTrainer(req.params.club, req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/:club/trainers/:name', requireManager, async (req, res) => {
    try { ok(res, await deleteTrainer(req.params.club, req.params.name)); } catch (e) { fail(res, e); }
});
app.post('/api/:club/trainers/auth', async (req, res) => {
    try { ok(res, await authTrainer(req.params.club, req.body || {})); } catch (e) { fail(res, e); }
});

// Members / operators
app.post('/api/:club/users', async (req, res) => {
    try { ok(res, await registerUser(req.params.club, req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/:club/users/auth', async (req, res) => {
    try { ok(res, await authUser(req.params.club, req.body || {})); } catch (e) { fail(res, e); }
});

// Manager-app login (per club).
app.post('/api/:club/managers/auth', async (req, res) => {
    try { ok(res, await authManager(req.params.club, req.body || {})); } catch (e) { fail(res, e); }
});
// Self-service: logged-in manager changes their own password (username from the token).
app.post('/api/:club/managers/password', requireManager, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body || {};
        res.json(await changeManagerPassword(req.params.club, req.auth.sub, currentPassword, newPassword));
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// Teams (add / update / list / delete)
app.get('/api/:club/teams', async (req, res) => {
    try { ok(res, { teams: await listTeams(req.params.club) }); } catch (e) { fail(res, e); }
});
app.post('/api/:club/teams', requireManager, async (req, res) => {
    try { ok(res, await upsertTeam(req.params.club, req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/:club/teams/:id', requireManager, async (req, res) => {
    try { ok(res, await deleteTeam(req.params.club, req.params.id)); } catch (e) { fail(res, e); }
});

// Push subscriptions + broadcast (DB-backed)
app.post('/api/:club/push', async (req, res) => {
    try { ok(res, await registerPush(req.params.club, req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/:club/push', async (req, res) => {
    try { ok(res, await unregisterPush(req.params.club, req.body || {})); } catch (e) { fail(res, e); }
});
app.post('/api/:club/broadcast', requireManager, async (req, res) => {
    try { ok(res, await broadcast(req.params.club, req.body || {})); } catch (e) { fail(res, e); }
});

// Email subscribers
app.post('/api/:club/email-subscribers', async (req, res) => {
    try { ok(res, await addEmailSubscriber(req.params.club, req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/:club/email-subscribers', async (req, res) => {
    try { ok(res, await removeEmailSubscriber(req.params.club, req.body || {})); } catch (e) { fail(res, e); }
});

// Feedback
app.post('/api/:club/feedback', async (req, res) => {
    try { ok(res, await saveFeedback(req.params.club, req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); }
});

// Halls config (DB-backed; list derived from the live schedule)
app.get('/api/:club/halls', async (req, res) => {
    try { ok(res, await listHalls(req.params.club)); } catch (e) { fail(res, e); }
});
app.put('/api/:club/halls', requireManager, async (req, res) => {
    try { ok(res, await saveHalls(req.params.club, (req.body || {}).config || {})); } catch (e) { fail(res, e); }
});

// Generic per-club settings (e.g. floatingMessage)
app.get('/api/:club/settings/:key', async (req, res) => {
    try { ok(res, { value: await getSetting(req.params.club, req.params.key) }); } catch (e) { fail(res, e); }
});
app.put('/api/:club/settings/:key', requireManager, async (req, res) => {
    try { ok(res, await setSetting(req.params.club, req.params.key, (req.body || {}).value)); } catch (e) { fail(res, e); }
});

// Change requests + manager approval
app.post('/api/:club/requests', async (req, res) => {
    try { ok(res, await createRequest(req.params.club, req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/:club/requests', requireManager, async (req, res) => {
    try { ok(res, { requests: await listRequests(req.params.club, req.query.status || 'pending') }); } catch (e) { fail(res, e); }
});
app.post('/api/:club/requests/:id/approve', requireManager, async (req, res) => {
    try { ok(res, await approveRequest(req.params.club, req.params.id)); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/:club/requests/:id/reject', requireManager, async (req, res) => {
    try { ok(res, await rejectRequest(req.params.club, req.params.id)); } catch (e) { fail(res, e); }
});

// Signed one-click approve/reject from the manager's email link (runs the server command).
const resultPage = (title, sub = '') => `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body style="font-family:Arial,sans-serif;text-align:center;padding:48px;background:#0b1220;color:#e8edf7">`
    + `<h2>${title}</h2><p style="color:#94a3b8">${sub}</p></body></html>`;
app.get('/api/:club/requests/:id/approve', async (req, res) => {
    if (!verifyId(req.params.id, req.query.token)) return res.status(403).send(resultPage('קישור לא תקין'));
    try { const r = await approveRequest(req.params.club, req.params.id); res.send(resultPage('✅ הבקשה אושרה', r.message || '')); }
    catch (e) { res.send(resultPage('לא ניתן לאשר', e.message)); }
});
app.get('/api/:club/requests/:id/reject', async (req, res) => {
    if (!verifyId(req.params.id, req.query.token)) return res.status(403).send(resultPage('קישור לא תקין'));
    try { await rejectRequest(req.params.club, req.params.id); res.send(resultPage('הבקשה נדחתה')); }
    catch (e) { res.send(resultPage('שגיאה', e.message)); }
});

// Dynamic per-club Web App Manifest (must be registered before the dist static handler).
app.get(/^\/clubs\/([a-z0-9-]+)\.webmanifest$/, async (req, res) => {
    const club = await getClub(req.params[0]);
    if (!club) return res.status(404).json({ error: 'not found' });
    res.set('Content-Type', 'application/manifest+json; charset=utf-8');
    res.json(manifestFor(club));
});

// Uploaded club icons — legacy volume path (kept for any pre-DB uploads).
app.use('/clubicons', express.static(ICONS_DIR));

// Uploaded club images (logo / PWA icons) now live in the DB; serve them with caching.
app.get('/api/:club/icon/:kind', async (req, res) => {
    try {
        const asset = await getAsset(req.params.club, req.params.kind);
        if (!asset) return res.status(404).end();
        const etag = `"${new Date(asset.updated_at).getTime()}"`;
        if (req.headers['if-none-match'] === etag) return res.status(304).end();
        res.set('Content-Type', asset.mime);
        res.set('Cache-Control', 'public, max-age=86400');
        res.set('ETag', etag);
        res.send(asset.bytes);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== Clubs (superuser write) =====
app.post('/api/superuser/clubs', requireSuperuser, async (req, res) => {
    const { club, icons } = req.body || {};
    // Strip bidi/zero-width marks (common in RTL inputs) + whitespace, then validate.
    const slug = (club?.slug || '').replace(/[​-‏‪-‮⁦-⁩]/g, '').trim().toLowerCase();
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ error: 'invalid slug (use lowercase letters, digits, hyphens)' });
    }
    if (!club.name) {
        return res.status(400).json({ error: 'name is required' });
    }
    const record = {
        slug,
        name: club.name,
        shortName: club.shortName || club.name,
        sport: club.sport || '',
        publishUrl: club.publishUrl || '',
        managerEmails: Array.isArray(club.managerEmails) ? club.managerEmails
            : (club.managerEmails || '').split(/[,;\s]+/).filter(Boolean),
        themeColor: club.themeColor || '#ff7a18',
        backgroundColor: club.backgroundColor || '#070b16',
        dataUrl: club.dataUrl || '',
        sheetApi: club.sheetApi || '',
        icon192: club.icon192 || '',
        icon512: club.icon512 || '',
        appleIcon: club.appleIcon || '',
        logo: club.logo || '',
    };
    if (icons) {
        if (icons.i192) record.icon192 = await saveAsset(slug, '192', icons.i192);
        if (icons.i512) record.icon512 = await saveAsset(slug, '512', icons.i512);
        if (icons.apple) record.appleIcon = await saveAsset(slug, 'apple', icons.apple);
        if (icons.logo) record.logo = await saveAsset(slug, 'logo', icons.logo);
    }
    try { res.json(await upsertClub(record)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// Manager accounts for a club (superuser creates the invite: username + initial password).
app.post('/api/superuser/clubs/:slug/managers', requireSuperuser, async (req, res) => {
    try { res.json(await createManager(req.params.slug, req.body || {})); }
    catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/superuser/clubs/:slug/managers', requireSuperuser, async (req, res) => {
    try { res.json({ managers: await listManagers(req.params.slug) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});
// Superuser resets a manager's password (recovery when a manager is locked out).
app.post('/api/superuser/clubs/:slug/managers/:username/reset', requireSuperuser, async (req, res) => {
    try { res.json(await resetManagerPassword(req.params.slug, req.params.username, (req.body || {}).password)); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/superuser/clubs/:slug', requireSuperuser, async (req, res) => {
    if (req.params.slug === 'raanana') return res.status(400).json({ error: 'cannot delete the default club' });
    await deleteClub(req.params.slug);
    res.json({ ok: true });
});

// Apps Script calls this when a schedule change is approved. It passes the team's stored
// push subscriptions + the message; we sign, encrypt and deliver each one.
app.post('/api/push/send', async (req, res) => {
    if (!pushReady) return res.status(503).json({ error: 'push not configured' });

    const { secret, title, body, url, icon, subscriptions } = req.body || {};
    if (secret !== PUSH_SECRET) return res.status(403).json({ error: 'forbidden' });
    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
        return res.json({ sent: 0, failed: 0, expired: [] });
    }

    const payload = JSON.stringify({
        title: title || 'עדכון מהמועדון',
        body: body || '',
        url: url || '/',
        icon: icon || '/pwa-192x192.png',
    });

    let sent = 0;
    let failed = 0;
    const expired = []; // endpoints that are gone (404/410) so Apps Script can prune them

    await Promise.all(subscriptions.map(async (sub) => {
        try {
            await webpush.sendNotification(sub, payload);
            sent++;
        } catch (err) {
            failed++;
            if (err.statusCode === 404 || err.statusCode === 410) {
                expired.push(sub.endpoint);
            } else {
                console.error('[push] send error:', err.statusCode, err.body || err.message);
            }
        }
    }));

    return res.json({ sent, failed, expired });
});

// Bare domain root → the product sales/landing page. Clubs live under /<slug>.
// (Registered before express.static, which would otherwise auto-serve the SPA index.html at "/".)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'sales-landing.html'));
});

// Serve static files from the dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Standalone sales landing page (clean URL without .html)
app.get('/sales-landing', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'sales-landing.html'));
});

// (Per-club calendar feed is served from /api/:club/calendar.ics — DB-backed.)

// ---- Per-club HTML head (link previews + tab title/icon) --------------------
// Link unfurlers (WhatsApp/Telegram/…) don't run JS, so they read the STATIC
// index.html head. We rewrite it per club so a shared link shows THAT club's
// name + logo, not the built-in raanana defaults.
const INDEX_PATH = path.join(__dirname, 'dist', 'index.html');
let _indexHtml = null;
const readIndexHtml = () => {
    if (_indexHtml == null) { try { _indexHtml = fs.readFileSync(INDEX_PATH, 'utf8'); } catch { _indexHtml = ''; } }
    return _indexHtml;
};
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function clubHead(club, origin) {
    const name = club.name || 'Squadio';
    const short = club.shortName || name;
    const desc = club.description || `לו"ז אימונים, משחקים ועדכונים — ${name}`;
    const abs = (p) => (!p ? '' : (/^https?:\/\//.test(p) ? p : origin + p));
    const preview = abs(club.logo || club.icon512 || club.icon192 || '/pwa-512x512.png');
    const favicon = club.icon192 || club.logo || '/pwa-192x192.png';
    const apple = club.appleIcon || club.icon192 || '/apple-touch-icon.png';
    const theme = club.themeColor || '#ff7a18';
    const url = `${origin}/${club.slug}`;
    return [
        `<title>${esc(name)}</title>`,
        `<meta name="theme-color" content="${esc(theme)}" />`,
        `<link rel="icon" type="image/png" href="${esc(favicon)}" />`,
        `<link rel="apple-touch-icon" href="${esc(apple)}" />`,
        `<meta name="apple-mobile-web-app-title" content="${esc(short)}" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:site_name" content="${esc(name)}" />`,
        `<meta property="og:title" content="${esc(name)}" />`,
        `<meta property="og:description" content="${esc(desc)}" />`,
        preview ? `<meta property="og:image" content="${esc(preview)}" />` : '',
        `<meta property="og:url" content="${esc(url)}" />`,
        `<meta name="twitter:card" content="summary" />`,
        `<meta name="twitter:title" content="${esc(name)}" />`,
        `<meta name="twitter:description" content="${esc(desc)}" />`,
        preview ? `<meta name="twitter:image" content="${esc(preview)}" />` : '',
    ].filter(Boolean).join('\n    ');
}

// Handle React routing, return all requests to React app (with per-club head when applicable).
app.get(/.*/, async (req, res) => {
    try {
        const seg = req.path.split('/').filter(Boolean)[0];
        const club = seg ? await getClub(seg) : null;
        const html = readIndexHtml();
        if (club && html) {
            const proto = req.headers['x-forwarded-proto'] || req.protocol;
            const origin = `${proto}://${req.get('host')}`;
            const patched = html
                .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
                .replace(/<link\s+rel="icon"[^>]*>\s*/i, '')
                .replace(/<link\s+rel="apple-touch-icon"[^>]*>\s*/i, '')
                .replace(/<meta\s+name="theme-color"[^>]*>\s*/i, '')
                .replace(/<meta\s+name="apple-mobile-web-app-title"[^>]*>\s*/i, '')
                .replace('</head>', `    ${clubHead(club, origin)}\n  </head>`);
            res.set('Content-Type', 'text/html; charset=utf-8');
            return res.send(patched);
        }
    } catch { /* fall through to the static SPA below */ }
    res.sendFile(INDEX_PATH);
});

// Final safety net: any uncaught error never reaches the client as a raw stack trace.
// API calls get a clean JSON error; page loads get the SPA (which renders the designed
// ErrorPage), so the user always sees a styled page — never a blank/leaky error screen.
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (res.headersSent) return next(err);
    if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'שגיאת שרת, נסו שוב' });
    res.status(500).sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Graceful shutdown on redeploy: Railway sends SIGTERM to the old container.
// Close cleanly and exit 0 so it isn't reported as a crash ("npm error signal SIGTERM").
function shutdown(signal) {
    console.log(`Received ${signal}, shutting down gracefully...`);
    server.close(() => process.exit(0));
    // Safety net if connections hang.
    setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
