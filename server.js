import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import { buildTeamICSFromCsv } from './server/scheduleCore.js';
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
    if (!club.name || !club.dataUrl || !club.sheetApi) {
        return res.status(400).json({ error: 'name, dataUrl and sheetApi are required' });
    }
    const record = {
        slug: club.slug,
        name: club.name,
        shortName: club.shortName || club.name,
        themeColor: club.themeColor || '#ff7a18',
        backgroundColor: club.backgroundColor || '#070b16',
        dataUrl: club.dataUrl,
        sheetApi: club.sheetApi,
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
