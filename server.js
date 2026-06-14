import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import { buildTeamICSFromCsv } from './server/scheduleCore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

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

app.use(express.json({ limit: '1mb' }));

// Apps Script calls this when a schedule change is approved. It passes the team's stored
// push subscriptions + the message; we sign, encrypt and deliver each one.
app.post('/api/push/send', async (req, res) => {
    if (!pushReady) return res.status(503).json({ error: 'push not configured' });

    const { secret, title, body, url, subscriptions } = req.body || {};
    if (secret !== PUSH_SECRET) return res.status(403).json({ error: 'forbidden' });
    if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
        return res.json({ sent: 0, failed: 0, expired: [] });
    }

    const payload = JSON.stringify({
        title: title || 'עירוני רעננה כדורסל',
        body: body || '',
        url: url || '/',
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

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
