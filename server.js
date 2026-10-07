import express from 'express';
import path from 'path';
import fs from 'node:fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import { publishClub, getLiveSchedule, listPublications, teamICS, getPublicationSessions } from './server/publish.js';
import {
    listTrainers, saveTrainer, deleteTrainer, authTrainer,
    registerUser, authUser, listMembers, deleteMember, deleteAccount, listTeams, upsertTeam, deleteTeam,
    createManager, authManager, listManagers, changeManagerPassword, resetManagerPassword,
    resolveJoinCode, listTeamJoinCodes, ensureJoinCodes,
} from './server/people.js';
import { registerPush, unregisterPush, broadcast, addEmailSubscriber, removeEmailSubscriber, saveFeedback, pushDiag, sendMessage, listMessages, pushStats, listSubscriptions, deleteSubscription, purgeLegacySubscriptions } from './server/notify.js';
import { registerNativeToken, unregisterNativeToken, nativePushDiag } from './server/nativePush.js';
import { createRequest, listRequests, approveRequest, rejectRequest, verifyId } from './server/requests.js';
import { getDraft, getDraftView, replaceDraftSessions, importCsvToDraft, publishDraft } from './server/draft.js';
import { getSetting, setSetting, listHalls, saveHalls, getBanners } from './server/settings.js';
import { requireManager, signToken, verifyToken } from './server/auth.js';
import { pool } from './server/db.js';
import { createSignup, listSignups, setSignupStatus, deleteSignup } from './server/signups.js';
import {
    ensureStore, listClubs, getClub, upsertClub, deleteClub, saveAsset, getAsset, manifestFor, ICONS_DIR,
} from './server/clubsStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ===== Canonical domain (behind Cloudflare) =====================================
// Cloudflare terminates TLS and proxies to us over HTTP, so trust the proxy — this
// makes req.protocol / req.hostname / X-Forwarded-* reflect the real client request.
app.set('trust proxy', true);

const CANONICAL_HOST = process.env.CANONICAL_HOST || 'squadio.techbynoam.com';
const CANONICAL_BASE = `https://${CANONICAL_HOST}`;

// 301 any non-canonical host (e.g. the legacy *.up.railway.app) to the canonical
// domain, preserving the FULL path + query string (req.originalUrl). Registered as the
// very first middleware — BEFORE body parsing, static files, all routes and auth.
//
// This is HOST-based only: we deliberately do NOT redirect on req.protocol. Cloudflare
// already serves HTTPS while the app sees HTTP internally, so a protocol check would
// loop forever. Localhost/loopback is excluded so local dev is untouched, and an empty
// Host (internal Railway health checks) is left alone so deploys stay healthy.
const CANONICAL_SUB_SUFFIX = '.' + CANONICAL_HOST; // e.g. ".squadio.techbynoam.com"

// Clubs that have a PROVISIONED subdomain (<slug>.squadio.techbynoam.com — DNS + TLS cert live).
// Comma-separated slugs via env, defaulting to the one club provisioned today. This list must stay
// accurate: only clubs listed here are (a) redirected from the apex to their subdomain and (b) given
// subdomain invite links. A club NOT listed keeps being served on the apex (/<slug>/…) as before, so
// clubs without a working subdomain never get bounced to a host that would fail to resolve.
const SUBDOMAIN_CLUBS = new Set(
    (process.env.CLUB_SUBDOMAINS || 'fcraanana')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);
const clubSubOrigin = (slug) => `https://${slug}.${CANONICAL_HOST}`;
// The host a club's push subscriptions should live on: its subdomain if provisioned, else null (no
// restriction). Used to dedupe pushes to devices registered on both the old apex and the subdomain.
const clubActiveHost = (slug) => (SUBDOMAIN_CLUBS.has(slug) ? `${slug}.${CANONICAL_HOST}` : null);
// The bare host this request came in on (lowercased, no port), or null.
const reqHost = (req) => ((req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().split(':')[0].toLowerCase() || null);

// The club slug if this request came in on a per-club subdomain (<slug>.squadio.techbynoam.com),
// else null. Each club can have its own subdomain = its own origin = its own installed app,
// service worker, push identity and icon (fixes multi-club collisions on one device).
function clubSubFromReq(req) {
    const rawHost = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const host = rawHost.split(':')[0].toLowerCase();
    if (host.endsWith(CANONICAL_SUB_SUFFIX)) {
        const sub = host.slice(0, -CANONICAL_SUB_SUFFIX.length);
        if (sub && !sub.includes('.') && sub !== 'www') return sub;
    }
    return null;
}

app.use((req, res, next) => {
    const rawHost = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const host = rawHost.split(':')[0].toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return next();
    // Club subdomains (<slug>.squadio.techbynoam.com) are their own origins — serve them, don't
    // bounce them to the canonical root (that would defeat the whole point).
    if (host === CANONICAL_HOST || host.endsWith(CANONICAL_SUB_SUFFIX)) return next();
    return res.redirect(301, CANONICAL_BASE + req.originalUrl); // path + query preserved untouched
});

// Legacy-link bridge: an old apex link (squadio.techbynoam.com/<slug>/…) for a club that now has its
// own subdomain is forwarded to that subdomain (<slug>.squadio.techbynoam.com/<slug>/…), so managers
// and parents who open a link sent before the move land on the isolated per-club origin (its own
// installed app / push / icon). GET & HEAD only (never lose a POST body); full path + query kept.
// 302, not 301, so browsers never permanently cache it — subdomain provisioning can still change.
// /api/* is naturally untouched: its first path segment is "api", never a club slug.
app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const rawHost = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const host = rawHost.split(':')[0].toLowerCase();
    if (host !== CANONICAL_HOST) return next(); // only the bare apex; subdomains + localhost fall through
    const seg = (req.path.split('/').filter(Boolean)[0] || '').toLowerCase();
    if (seg && SUBDOMAIN_CLUBS.has(seg)) return res.redirect(302, clubSubOrigin(seg) + req.originalUrl);
    return next();
});

try {
    await ensureStore();
    await ensureJoinCodes(); // backfill a 5-digit join code for every team (deploys skip migrations)
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

// CORS for the bundled native app only. When Squadio is packaged (Capacitor, webDir=dist) the app
// runs on its OWN origin (capacitor://localhost / https://localhost) and calls this server's /api
// cross-origin. Allow exactly those native origins; the browser/PWA is same-origin and unaffected.
// Identity is a bearer token in the body/headers (not cookies), so no Allow-Credentials is needed.
const NATIVE_ORIGINS = new Set([
    'capacitor://localhost', 'ionic://localhost', 'https://localhost', 'http://localhost',
]);
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && NATIVE_ORIGINS.has(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Vary', 'Origin');
        res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Push-Secret');
        res.set('Access-Control-Max-Age', '86400');
        if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
});

// Android App Links / Digital Asset Links. Served on EVERY host (apex + club subdomains) so tapping a
// Squadio https invite link opens the native app directly instead of the browser. Lists the Play App
// Signing cert (apps installed from Play are re-signed by Google) AND the upload-key cert (sideload).
// Static + public; no secrets. iOS Universal Links (apple-app-site-association) can be added later.
const ASSETLINKS = [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
        namespace: 'android_app',
        package_name: 'com.squadio.app',
        sha256_cert_fingerprints: [
            '04:EA:3A:C0:B8:78:EA:7E:8D:1F:A1:59:25:4F:D3:41:5B:DF:1A:B3:8D:69:24:94:7B:52:0B:4C:4F:93:BA:CC', // Play App Signing key
            '9F:DA:0B:D8:3B:9A:58:AB:66:98:47:EA:C8:86:60:5E:6B:1F:DA:1E:5F:4F:B4:BC:5D:D4:88:C9:8A:26:D2:B3', // upload key
        ],
    },
}];
app.get('/.well-known/assetlinks.json', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(ASSETLINKS);
});

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
    try { out.push = await pushDiag(); } catch { /* non-fatal */ }
    try { out.nativePush = await nativePushDiag(); } catch { /* non-fatal */ }
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
// Annotate each club with whether it has its own subdomain, plus the origin to build invite links
// against, so the client generates <slug>.squadio.techbynoam.com links for provisioned clubs and
// plain apex links for the rest.
const withSubInfo = (c) => (c && SUBDOMAIN_CLUBS.has(c.slug)
    ? { ...c, subdomain: true, inviteOrigin: clubSubOrigin(c.slug) }
    : (c ? { ...c, subdomain: false } : c));
app.get('/api/clubs', async (req, res) => {
    try { res.json((await listClubs()).map(withSubInfo)); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/clubs/:slug', async (req, res) => {
    const club = await getClub(req.params.slug);
    if (!club) return res.status(404).json({ error: 'not found' });
    res.json(withSubInfo(club));
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
// Self-service account deletion (App Store Guideline 5.1.1(v)). The caller proves ownership by sending
// their own account token(s); removes the account, email signups, and native push tokens.
app.post('/api/:club/account/delete', async (req, res) => {
    try { ok(res, await deleteAccount(req.params.club, req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); }
});
// Manager-only roster — names grouped by team, NO contact details.
app.get('/api/:club/members', requireManager, async (req, res) => {
    try { res.json(await listMembers(req.params.club)); } catch (e) { fail(res, e); }
});
// Manager-only: remove a registrant (by name + team).
app.delete('/api/:club/members', requireManager, async (req, res) => {
    try { res.json(await deleteMember(req.params.club, req.body || {})); } catch (e) { fail(res, e); }
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
// Manager-only: each team with its shareable 5-digit join code.
app.get('/api/:club/teams/join-codes', requireManager, async (req, res) => {
    try { ok(res, { teams: await listTeamJoinCodes(req.params.club) }); } catch (e) { fail(res, e); }
});

// Public: resolve a 5-digit join code → { clubSlug, team }. Lets a parent type a code instead of
// following an invite link; the code-entry screen then opens that team's normal join flow. The code
// alone only reveals a club+team name (same as a shareable invite), and joining still needs the
// regular registration — so this is safe to expose unauthenticated. 404 for an unknown code.
app.get('/api/join/:code', async (req, res) => {
    try {
        const r = await resolveJoinCode(req.params.code);
        if (!r) return res.status(404).json({ error: 'קוד לא קיים' });
        // A subdomain club lives on its own origin — tell the code-entry screen so it lands the parent
        // there (storage/PWA isolation). Same source of truth as /api/clubs' inviteOrigin.
        const inviteOrigin = SUBDOMAIN_CLUBS.has(r.clubSlug) ? clubSubOrigin(r.clubSlug) : '';
        res.json({ ...r, inviteOrigin });
    } catch (e) { fail(res, e); }
});

// Push subscriptions + broadcast (DB-backed)
app.post('/api/:club/push', async (req, res) => {
    try { ok(res, await registerPush(req.params.club, { ...(req.body || {}), host: reqHost(req) })); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/:club/push', async (req, res) => {
    try { ok(res, await unregisterPush(req.params.club, req.body || {})); } catch (e) { fail(res, e); }
});
app.post('/api/:club/broadcast', requireManager, async (req, res) => {
    try { ok(res, await broadcast(req.params.club, req.body || {})); } catch (e) { fail(res, e); }
});

// Native (store-app) push token registration. Public (the bundled app registers its own device),
// cross-origin from the native origin — already covered by the global native-CORS middleware above
// (incl. OPTIONS preflight). The token is only stored; delivery is gated server-side
// (NATIVE_PUSH_ENABLED + FCM creds), so this is fully additive and can't affect the live web system.
app.post('/api/:club/native-push/register', async (req, res) => {
    try { ok(res, await registerNativeToken(req.params.club, { ...(req.body || {}), host: req.body?.host || reqHost(req) })); }
    catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/:club/native-push/unregister', async (req, res) => {
    try { ok(res, await unregisterNativeToken(req.params.club, req.body || {})); } catch (e) { fail(res, e); }
});
// Manager message: send to segment(s) AND archive it (for review / resend). Message history.
app.post('/api/:club/messages', requireManager, async (req, res) => {
    try { ok(res, await sendMessage(req.params.club, req.body || {})); } catch (e) { fail(res, e); }
});
app.get('/api/:club/messages', requireManager, async (req, res) => {
    try { ok(res, await listMessages(req.params.club)); } catch (e) { fail(res, e); }
});
// Subscriber counts per segment (so the manager sees how many devices each target reaches).
app.get('/api/:club/push-stats', requireManager, async (req, res) => {
    try { ok(res, await pushStats(req.params.club)); } catch (e) { fail(res, e); }
});
// Manager: inspect / clean up raw device subscriptions (remove stale or duplicate registrations,
// e.g. an old apex subscription still delivering after the club moved to its subdomain).
app.get('/api/:club/push-subscriptions', requireManager, async (req, res) => {
    try { ok(res, await listSubscriptions(req.params.club, clubActiveHost(req.params.club))); } catch (e) { fail(res, e); }
});
app.delete('/api/:club/push-subscriptions/:id', requireManager, async (req, res) => {
    try { ok(res, await deleteSubscription(req.params.club, req.params.id)); } catch (e) { fail(res, e); }
});
app.post('/api/:club/push-subscriptions/purge-legacy', requireManager, async (req, res) => {
    try { ok(res, await purgeLegacySubscriptions(req.params.club, clubActiveHost(req.params.club))); } catch (e) { fail(res, e); }
});

// Public banners for the ticker: general (club-wide) + per-team (client shows a team's to its members).
app.get('/api/:club/banners', async (req, res) => {
    try { ok(res, await getBanners(req.params.club)); } catch (e) { fail(res, e); }
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

// Club landing-page registrations (public form → secretary inbox/email)
const SITE_ORIGINS = new Set(['https://hapoel-raanana.techbynoam.com', 'https://noamedery1.github.io', ...(process.env.SITE_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean)]);
app.use('/api/:club/signups', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && SITE_ORIGINS.has(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Vary', 'Origin');
        res.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', '86400');
        if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
});
app.post('/api/:club/signups', async (req, res) => {
    try { ok(res, await createSignup(req.params.club, req.body || {}, req.ip)); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/:club/signups', requireManager, async (req, res) => {
    try { ok(res, { signups: await listSignups(req.params.club) }); } catch (e) { fail(res, e); }
});
app.put('/api/:club/signups/:id', requireManager, async (req, res) => {
    try { ok(res, await setSignupStatus(req.params.club, req.params.id, (req.body || {}).status)); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/:club/signups/:id', requireManager, async (req, res) => {
    try { ok(res, await deleteSignup(req.params.club, req.params.id)); } catch (e) { fail(res, e); }
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
    // Optional start_url override, restricted to a path within THIS club (so the installed icon can
    // open e.g. the operator invite). Must be a relative path beginning "/<slug>" — never off-site.
    let start;
    const s = req.query.start;
    if (typeof s === 'string' && s.startsWith(`/${club.slug}`) && !s.startsWith('//') && !/^\/[a-z0-9-]+:/i.test(s)) {
        start = s;
    }
    res.set('Content-Type', 'application/manifest+json; charset=utf-8');
    res.json(manifestFor(club, start));
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
// BUT on a per-club subdomain (<slug>.squadio.techbynoam.com) the root IS that club, so serve the
// club's SPA there instead of the sales page.
// (Registered before express.static, which would otherwise auto-serve the SPA index.html at "/".)
app.get('/', async (req, res) => {
    const subSlug = clubSubFromReq(req);
    if (subSlug) {
        try {
            const club = await getClub(subSlug);
            const patched = club && renderClubIndex(club, `/${club.slug}`);
            if (patched) { res.set('Content-Type', 'text/html; charset=utf-8'); return res.send(patched); }
        } catch { /* fall through to sales page */ }
    }
    res.sendFile(path.join(__dirname, 'dist', 'sales-landing.html'));
});

// Serve static files from the dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Standalone sales landing page (clean URL without .html)
app.get('/sales-landing', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'sales-landing.html'));
});

// Club marketing sites live on their OWN origin (never under the app's origin/scope — an installed
// PWA/WebAPK captures every in-scope URL and would resume on the site instead of the schedule).
// Old /site/<slug> links redirect there.
// Until the standalone site is hosted, send old links (and any device that got stuck on it) back to the app.
const CLUB_SITES = { fcraanana: '/fcraanana' };
app.get('/site/:club', (req, res, next) => {
    const url = CLUB_SITES[String(req.params.club).toLowerCase()];
    return url ? res.redirect(302, url) : next();
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

// Per-club <head>. All URLs are ABSOLUTE on the canonical domain so link previews
// (WhatsApp/Telegram) and the canonical tag are correct no matter which host served it.
// `pagePath` is the request's own path (e.g. /fcraanana or /fcraanana/trainer) so each
// club page gets its own canonical + og:url, not the root.
function clubHead(club, pagePath) {
    const name = club.name || 'Squadio';
    const short = club.shortName || name;
    const desc = club.description || `לו"ז אימונים, משחקים ועדכונים — ${name}`;
    const abs = (p) => (!p ? '' : (/^https?:\/\//.test(p) ? p : CANONICAL_BASE + p));
    const preview = abs(club.logo || club.icon512 || club.icon192 || '/pwa-512x512.png');
    const favicon = club.icon192 || club.logo || '/pwa-192x192.png';
    const apple = club.appleIcon || club.icon192 || '/apple-touch-icon.png';
    const theme = club.themeColor || '#ff7a18';
    const canonical = CANONICAL_BASE + (pagePath || `/${club.slug}`);
    return [
        `<title>${esc(name)}</title>`,
        `<meta name="theme-color" content="${esc(theme)}" />`,
        `<link rel="canonical" href="${esc(canonical)}" />`,
        `<link rel="icon" type="image/png" href="${esc(favicon)}" />`,
        `<link rel="apple-touch-icon" href="${esc(apple)}" />`,
        `<meta name="apple-mobile-web-app-title" content="${esc(short)}" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:site_name" content="${esc(name)}" />`,
        `<meta property="og:title" content="${esc(name)}" />`,
        `<meta property="og:description" content="${esc(desc)}" />`,
        preview ? `<meta property="og:image" content="${esc(preview)}" />` : '',
        `<meta property="og:url" content="${esc(canonical)}" />`,
        `<meta name="twitter:card" content="summary" />`,
        `<meta name="twitter:title" content="${esc(name)}" />`,
        `<meta name="twitter:description" content="${esc(desc)}" />`,
        preview ? `<meta name="twitter:image" content="${esc(preview)}" />` : '',
    ].filter(Boolean).join('\n    ');
}

// For an invite page, the PATH-based start_url the installed icon should use, so iOS (which reads the
// manifest at page load and strips any query from start_url) installs with the role/team preserved.
// Converts a legacy ?r=…&team=… link to the path form too, so old links also install cleanly.
// Strict path-segment encoder — also escapes ! ' ( ) * (which encodeURIComponent leaves raw), so a
// Hebrew team geresh (נוער א') doesn't end up as a bare ' that WhatsApp truncates / iOS mangles.
const encPathSeg = (s) => encodeURIComponent(String(s ?? '')).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function joinManifestStart(club, req) {
    const parts = req.path.split('/').filter(Boolean); // [slug, 'join', role?, teamEnc?]
    if (parts[0] !== club.slug || parts[1] !== 'join') return null;
    if (parts[2]) {
        const role = parts[2] === 'operator' ? 'operator' : 'member';
        return `/${club.slug}/join/${role}` + (parts[3] ? `/${parts[3]}` : ''); // parts[3] already URL-encoded
    }
    const r = req.query.r === 'operator' ? 'operator' : (req.query.r === 'member' ? 'member' : null);
    if (!r) return null;
    return `/${club.slug}/join/${r}` + (req.query.team ? `/${encPathSeg(req.query.team)}` : '');
}

// Render the SPA index.html with a club's <head> injected (title/icons/manifest/canonical/OG).
// `manifestStart` overrides the installed app's start_url (used for invite pages).
function renderClubIndex(club, canonicalPath, manifestStart) {
    const html = readIndexHtml();
    if (!html) return null;
    const manifestHref = manifestStart
        ? `/clubs/${club.slug}.webmanifest?start=${encodeURIComponent(manifestStart)}`
        : `/clubs/${club.slug}.webmanifest`;
    return html
        .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
        .replace(/<link\s+rel="icon"[^>]*>\s*/i, '')
        .replace(/<link\s+rel="apple-touch-icon"[^>]*>\s*/i, '')
        .replace(/<meta\s+name="theme-color"[^>]*>\s*/i, '')
        .replace(/<meta\s+name="apple-mobile-web-app-title"[^>]*>\s*/i, '')
        .replace(/(<link\s+rel="manifest"\s+href=")[^"]*(")/i, `$1${manifestHref}$2`)
        .replace('</head>', `    ${clubHead(club, canonicalPath || `/${club.slug}`)}\n  </head>`);
}

// Handle React routing, return all requests to React app (with per-club head when applicable).
app.get(/.*/, async (req, res) => {
    try {
        // On a club subdomain the club comes from the host; otherwise from the first path segment.
        const subSlug = clubSubFromReq(req);
        const seg = subSlug || req.path.split('/').filter(Boolean)[0];
        const club = seg ? await getClub(seg) : null;
        const html = readIndexHtml();
        if (html) {
            let patched;
            if (club) {
                patched = renderClubIndex(club, subSlug ? `/${club.slug}` : req.path, joinManifestStart(club, req));
            } else {
                // Non-club SPA page (unknown slug, legacy routes) — still emit a canonical for this path.
                const canonical = `${CANONICAL_BASE}${req.path}`;
                patched = html.replace('</head>', `    <link rel="canonical" href="${esc(canonical)}" />\n  </head>`);
            }
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
