import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import { buildTeamICSFromCsv } from './server/scheduleCore.js';
import { publishClub, getLiveSchedule, listPublications, teamICS } from './server/publish.js';
import {
    listTrainers, saveTrainer, deleteTrainer, authTrainer,
    registerUser, authUser, listTeams, upsertTeam, deleteTeam,
    createManager, authManager, listManagers,
} from './server/people.js';
import { registerPush, unregisterPush, broadcast, addEmailSubscriber, removeEmailSubscriber, saveFeedback } from './server/notify.js';
import { createRequest, listRequests, approveRequest, rejectRequest, verifyId } from './server/requests.js';
import { getSetting, setSetting, listHalls, saveHalls } from './server/settings.js';
import { requireManager } from './server/auth.js';
import {
    ensureStore, listClubs, getClub, upsertClub, deleteClub, saveIcon, manifestFor, ICONS_DIR,
} from './server/clubsStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

try {
    ensureStore();
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

// ===== Superuser auth =====
const SUPERUSER_PASSWORD = process.env.SUPERUSER_PASSWORD || '';
const validTokens = new Set(); // in-memory; cleared on restart (re-login required)

function requireSuperuser(req, res, next) {
    const token = req.get('x-superuser-token');
    if (!token || !validTokens.has(token)) return res.status(401).json({ error: 'unauthorized' });
    next();
}

app.post('/api/superuser/login', (req, res) => {
    if (!SUPERUSER_PASSWORD) return res.status(503).json({ error: 'superuser not configured' });
    const { password } = req.body || {};
    if (password !== SUPERUSER_PASSWORD) return res.status(403).json({ error: 'wrong password' });
    const token = crypto.randomBytes(24).toString('hex');
    validTokens.add(token);
    res.json({ token });
});

// ===== Clubs (public read) =====
app.get('/api/clubs', (req, res) => res.json(listClubs()));
app.get('/api/clubs/:slug', (req, res) => {
    const club = getClub(req.params.slug);
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
app.get(/^\/clubs\/([a-z0-9-]+)\.webmanifest$/, (req, res) => {
    const club = getClub(req.params[0]);
    if (!club) return res.status(404).json({ error: 'not found' });
    res.set('Content-Type', 'application/manifest+json; charset=utf-8');
    res.json(manifestFor(club));
});

// Uploaded club icons (served from the volume).
app.use('/clubicons', express.static(ICONS_DIR));

// ===== Clubs (superuser write) =====
app.post('/api/superuser/clubs', requireSuperuser, (req, res) => {
    const { club, icons } = req.body || {};
    if (!club || !club.slug || !/^[a-z0-9-]+$/.test(club.slug)) {
        return res.status(400).json({ error: 'invalid slug (use lowercase letters, digits, hyphens)' });
    }
    if (!club.name) {
        return res.status(400).json({ error: 'name is required' });
    }
    const record = {
        slug: club.slug,
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
    };
    if (icons) {
        if (icons.i192) record.icon192 = saveIcon(club.slug, '192', icons.i192);
        if (icons.i512) record.icon512 = saveIcon(club.slug, '512', icons.i512);
        if (icons.apple) record.appleIcon = saveIcon(club.slug, 'apple', icons.apple);
    }
    res.json(upsertClub(record));
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

app.delete('/api/superuser/clubs/:slug', requireSuperuser, (req, res) => {
    if (req.params.slug === 'raanana') return res.status(400).json({ error: 'cannot delete the default club' });
    deleteClub(req.params.slug);
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
        title: title || 'עירוני רעננה כדורסל',
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

// Live public schedule CSV (same source the public site reads)
const DATA_URL = "https://docs.google.com/spreadsheets/d/1rNKH9jFD6JEyUvToKKvpoffpCS-X_tcWeWFTPwH3m9o/export?format=csv&gid=0";

// Serve static files from the dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Standalone sales landing page (clean URL without .html)
app.get('/sales-landing', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'sales-landing.html'));
});

// Live, auto-updating calendar feed per team (subscribe once -> phone calendar refreshes).
// e.g. webcal://<host>/calendar.ics?team=<encoded team label>
app.get('/calendar.ics', async (req, res) => {
    const team = (req.query.team || '').toString();
    if (!team) return res.status(400).send('Missing team parameter');
    try {
        const r = await fetch(DATA_URL);
        const csv = await r.text();
        const ics = buildTeamICSFromCsv(csv, team);
        if (!ics) return res.status(404).send('Team not found');
        res.set('Content-Type', 'text/calendar; charset=utf-8');
        res.set('Cache-Control', 'public, max-age=1800');
        res.set('Content-Disposition', 'inline; filename="schedule.ics"');
        return res.send(ics);
    } catch (e) {
        console.error('calendar feed error:', e);
        return res.status(500).send('Error building calendar');
    }
});

// Handle React routing, return all requests to React app
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
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
