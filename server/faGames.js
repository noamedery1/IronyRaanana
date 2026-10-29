// FA (Israel Football Association) games sync — additive, opt-in per club via config.faClubId.
// Polls the FA site's JSON service a few times a day for a club's fixtures; when a game's TIME
// becomes finalized (FA uses "00:00" for "time not set yet") or a known game's date/time changes,
// it queues a one-tap approval for the manager (email + push). On approval the game is written to
// the live board and the team's parents get a push. Nothing is pushed without the manager's click
// in phase 1 — the approval step is also the safety net against a wrong team mapping.
//
// Change-detection is driven off `notified_*` (the last date/time we queued or applied), not the
// raw latest snapshot, so a value we've already surfaced is never re-sent, but a genuine change is.
import crypto from 'crypto';
import { pool, withTx } from './db.js';
import { clubId } from './people.js';
import { broadcast } from './notify.js';
import { sendEmail } from './mailer.js';
import { getClub } from './clubsStore.js';
import { getSetting, setSetting } from './settings.js';


// Signed approve/reject links (same HMAC scheme as change requests, namespaced so tokens don't cross).
const SIGN_SECRET = process.env.REQUEST_SIGN_SECRET || process.env.PUSH_SECRET || 'dev-secret';
export const faSign = (id) => crypto.createHmac('sha256', SIGN_SECRET).update('fa:' + id).digest('hex').slice(0, 32);
export const faVerify = (id, token) => Boolean(token) && faSign(id) === token;

// ===== pure helpers (exported for the self-check) =====

// Strip bidi marks + geresh/quotes + collapse spaces, so FA league/team strings match our map
// regardless of punctuation (FA uses an ASCII apostrophe; our board uses a geresh, etc.).
export const norm = (s) => (s || '').toString().replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/['"׳״]/g, '').replace(/\s+/g, ' ').trim();

// A real, finalized kickoff time? FA shows "00:00" (and occasionally "") until the time is set.
export const timeSet = (t) => { const s = (t || '').toString().trim(); return /^\d{1,2}:\d{2}$/.test(s) && s !== '00:00'; };

// FA date "19/10/26" -> "2026-10-19". null if unparseable.
export function faDateToYMD(d) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec((d || '').toString().trim());
    if (!m) return null;
    let [, dd, mm, yy] = m;
    if (yy.length === 2) yy = '20' + yy;
    return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

// Stable identity for a fixture across polls. Real FA id when present (>0); else a hash of its
// fixed bits (many youth/cup games come through with Id=-1).
export function faKey(g) {
    if (g.Id && g.Id > 0) return 'id:' + g.Id;
    return 'k:' + crypto.createHmac('sha256', 'fa').update(norm(g.LeagueName) + '|' + g.Round + '|' + norm(g.GameName)).digest('hex').slice(0, 16);
}

// The Raanana side of "home - away" (the side containing "רעננה"). '' if neither/both (ambiguous).
export function ourSide(gameName) {
    const parts = (gameName || '').split(' - ');
    if (parts.length !== 2) return '';
    const [a, b] = parts;
    const ar = /רעננ/.test(a), br = /רעננ/.test(b);
    if (ar && !br) return a.trim();
    if (br && !ar) return b.trim();
    return '';
}
export function opponentOf(gameName) {
    const parts = (gameName || '').split(' - ');
    if (parts.length !== 2) return (gameName || '').trim();
    return (/רעננ/.test(parts[0]) ? parts[1] : parts[0]).trim();
}
export function homeAway(gameName) {
    const parts = (gameName || '').split(' - ');
    if (parts.length !== 2) return '';
    return /רעננ/.test(parts[0]) ? 'בית' : 'חוץ';
}

// Which of OUR teams is this game? League map (1:1 for league games) first; then the name map
// (cups, whose league name isn't unique). '' = unmapped → never auto-queued, only surfaced.
export function mapTeam(g, leagueMap = {}, nameMap = {}) {
    const lg = norm(g.LeagueName);
    for (const [k, v] of Object.entries(leagueMap)) if (norm(k) === lg) return v;
    const n = norm(ourSide(g.GameName));
    for (const [k, v] of Object.entries(nameMap)) if (norm(k) === n) return v;
    return '';
}

// Should a change from (notifiedDate, notifiedTime) to (date, time) alert the manager?
// Only when the new time is real AND differs from what we last surfaced (new date or new time).
export function shouldNotify(notifiedDate, notifiedTime, date, time) {
    if (!timeSet(time)) return false;
    return time !== (notifiedTime || '') || date !== (notifiedDate || '');
}

// The board cell text parents see — "⚽ משחק" marks it as a game (amber card); the rest rides along.
export function faNote(row) {
    const bits = [];
    if (row.opponent) bits.push(`נגד ${row.opponent}`);
    if (row.home_away) bits.push(`(${row.home_away})`);
    if (row.field) bits.push(`· ${row.field}`);
    return `⚽ משחק ${row.game_time}${bits.length ? ' ' + bits.join(' ') : ''}`.trim();
}

// ===== DB sync =====
// The FA fetch does NOT happen here: football.org.il's Cloudflare blocks every datacenter/cloud egress
// IP (Railway, Google — only residential IPs pass), and the proxy worker's own domain challenges
// Railway's IP too. So a Cloudflare Worker (running on Cloudflare's own clean IPs, on a cron) fetches FA
// from Cloudflare's edge and POSTs the raw game objects to our `/fa/ingest` endpoint, which calls
// ingestGames below. The server never reaches out to football.org.il at all.

async function liveTeamIndex(cid) {
    const r = await pool.query('SELECT name, coalesce(gender,$2) gender FROM teams WHERE club_id=$1', [cid, 'M']);
    const idx = new Map();
    for (const row of r.rows) idx.set(norm(row.name), { name: row.name, gender: row.gender });
    return idx;
}

// The Sunday (YMD) of the week containing a date — matches how publications store week_start.
const weekSundayOf = (ymd) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); };
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// We email the manager only for games in THIS week + NEXT week (a fixed 2-week window), regardless of
// whether next week's schedule is published — an approved game lands in the publication for its own
// week (live now, or the draft that goes live when the manager publishes).
function emailHorizon() { return addDays(weekSundayOf(new Date().toISOString().slice(0, 10)), 13); }

// Upsert one FA game's tracked state; queue an approval when a change crosses the notify threshold.
// firstPoll=true seeds the baseline silently (so the very first run doesn't alert for every existing
// fixture). Returns a short action tag for the poll summary.
async function syncGame(slug, cid, club, g, firstPoll, horizon, today) {
    const team = mapTeam(g, club.faLeagueMap || {}, club.faNameMap || {});
    const key = faKey(g);
    const date = faDateToYMD(g.GameDate);
    const time = (g.GameTime || '').trim();
    // Only notify for UPCOMING games in the window: from today up to the horizon. Past games (played
    // yesterday etc.) must never re-alert — FA edits them post-game (result/time), which would
    // otherwise spam the manager with approvals for games that already happened.
    const inWindow = !!date && !!horizon && date >= today && date <= horizon;
    const fields = {
        team: team || '', league: g.LeagueName || '', game_name: g.GameName || '',
        opponent: opponentOf(g.GameName), home_away: homeAway(g.GameName),
        field: g.FieldName || '', round: Number.isFinite(+g.Round) ? +g.Round : null,
        game_date: date, game_time: time,
    };

    const cur = await pool.query('SELECT * FROM fa_game_sync WHERE club_id=$1 AND fa_key=$2', [cid, key]);
    if (!cur.rows.length) {
        // New fixture. Baseline-timed games silently on the first run (or any time it's unmapped);
        // a genuinely new, mapped, already-timed fixture after baseline is queued.
        const queue = team && timeSet(time) && !firstPoll && inWindow;
        const status = queue ? 'pending' : (team ? 'tracking' : 'unmapped');
        // Baseline notified_* only on the first (seeding) poll, so later real changes still alert. A
        // far-future game left un-baselined (notified null) so it queues once its week is published.
        const baseline = firstPoll && timeSet(time);
        const ins = await pool.query(
            `INSERT INTO fa_game_sync (club_id, fa_key, team, league, game_name, opponent, home_away, field, round, game_date, game_time, status, notified_date, notified_time)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
            [cid, key, fields.team, fields.league, fields.game_name, fields.opponent, fields.home_away, fields.field,
             fields.round, fields.game_date, fields.game_time, status, baseline ? date : null, baseline ? time : null],
        );
        if (queue) { await queueApproval(slug, ins.rows[0].id, fields); return 'queued'; }
        return team ? 'tracking' : 'unmapped';
    }

    const row = cur.rows[0];
    // Keep the latest snapshot + re-evaluate mapping (map may have been edited).
    await pool.query(
        `UPDATE fa_game_sync SET team=$3, league=$4, game_name=$5, opponent=$6, home_away=$7, field=$8, round=$9, game_date=$10, game_time=$11, updated_at=now() WHERE id=$1 AND club_id=$2`,
        [row.id, cid, fields.team, fields.league, fields.game_name, fields.opponent, fields.home_away, fields.field, fields.round, fields.game_date, fields.game_time],
    );
    if (row.status === 'pending') return 'pending'; // already waiting on the manager; approve the latest

    if (team && inWindow && shouldNotify(row.notified_date, row.notified_time, date, time)) {
        await pool.query(`UPDATE fa_game_sync SET status='pending', updated_at=now() WHERE id=$1`, [row.id]);
        await queueApproval(slug, row.id, fields);
        return 'queued';
    }
    // A previously-unmapped game that now maps becomes trackable.
    if (team && row.status === 'unmapped') await pool.query(`UPDATE fa_game_sync SET status='tracking' WHERE id=$1`, [row.id]);
    return 'tracked';
}

// Process a batch of raw FA game objects (fetched + POSTed by the Cloudflare Worker). Same detection,
// mapping and manager-approval queueing as before — only the fetching moved to the worker. The first
// batch for a club baselines silently (so it doesn't alert for every existing fixture).
export async function ingestGames(slug, games = []) {
    const club = await getClub(slug);
    if (!club?.faClubId) return { slug, skipped: 'no faClubId' };
    const cid = await clubId(slug);
    const firstPoll = !(await getSetting(slug, 'faBaselinedAt'));
    const today = new Date().toISOString().slice(0, 10);
    const horizon = emailHorizon(); // this week + next week
    const summary = { slug, games: games.length, queued: 0, tracking: 0, unmapped: 0, pending: 0 };
    for (const g of games) {
        try {
            const a = await syncGame(slug, cid, club, g, firstPoll, horizon, today);
            if (a === 'queued') summary.queued++;
            else if (a === 'unmapped') summary.unmapped++;
            else if (a === 'pending') summary.pending++;
            else summary.tracking++;
        } catch (e) { console.error('[fa] sync game failed', slug, faKey(g), e.message); }
    }
    // Drop stale pending approvals for games already played (date < today) — they no longer need the
    // manager's approval, so clear them from the pending list instead of leaving dead approval emails.
    await pool.query(`UPDATE fa_game_sync SET status='tracking', updated_at=now() WHERE club_id=$1 AND status='pending' AND game_date < $2`, [cid, today]);
    // Reconcile FA matches to the publication that actually covers their week (FA-created matches carry
    // the ⚽ marker faNote uses; trainings and 🏀/manual matches are never touched).
    // 1) Remove any FA match sitting in a publication whose week does NOT contain its date (mis-filed —
    //    e.g. a next-month game that got written into the current week's publication and showed on the
    //    wrong day). This clears both live and draft.
    const del = await pool.query(
        `DELETE FROM sessions s USING schedule_publications p
         WHERE s.publication_id = p.id AND s.club_id = $1 AND s.type = 'match' AND s.note LIKE '⚽%'
           AND (s.date < p.week_start OR s.date > p.week_start + 6) RETURNING s.id`, [cid]);
    // Also drop FA matches left stale by a date change: an ⚽ session with no APPLIED fixture at that
    // team+date anymore (the game moved, leaving its old-date session behind).
    const del2 = await pool.query(
        `DELETE FROM sessions s WHERE s.club_id=$1 AND s.type='match' AND s.note LIKE '⚽%'
           AND NOT EXISTS (SELECT 1 FROM fa_game_sync f WHERE f.club_id=$1 AND f.status='applied' AND f.team=s.team AND f.game_date=s.date::text) RETURNING s.id`, [cid]);
    summary.unapplied = del.rowCount + del2.rowCount;
    // 2) Ensure each APPROVED FA game has a session in the live/draft publication for its OWN week, once
    //    such a publication exists (so an approved next-week game appears in the draft the manager builds,
    //    then goes live when they publish it). No matching publication yet → it just waits, correctly.
    const applied = await pool.query(`SELECT * FROM fa_game_sync WHERE club_id=$1 AND status='applied'`, [cid]);
    const tIdx = applied.rows.length ? await liveTeamIndex(cid) : null;
    for (const r of applied.rows) {
        if (!r.team || !r.game_date) continue;
        const wk = weekSundayOf(r.game_date);
        const pubs = (await pool.query(`SELECT id FROM schedule_publications WHERE club_id=$1 AND week_start=$2 AND status IN ('live','draft')`, [cid, wk])).rows;
        for (const p of pubs) {
            const has = await pool.query(`SELECT 1 FROM sessions WHERE publication_id=$1 AND club_id=$2 AND team=$3 AND date=$4 AND type='match' LIMIT 1`, [p.id, cid, r.team, r.game_date]);
            if (has.rows.length) continue;
            const canon = tIdx.get(norm(r.team)) || { name: r.team, gender: 'M' };
            const coach = (await pool.query(`SELECT coach FROM sessions WHERE club_id=$1 AND team=$2 AND coach IS NOT NULL AND coach<>'' ORDER BY date DESC LIMIT 1`, [cid, canon.name])).rows[0]?.coach || null;
            const dow = new Date(r.game_date + 'T00:00:00Z').getUTCDay();
            await pool.query(`INSERT INTO sessions (publication_id, club_id, team, coach, gender, hall, date, day_of_week, start_time, end_time, type, status, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'match','active',$11)`,
                [p.id, cid, canon.name, coach, canon.gender, r.field || null, r.game_date, dow, r.game_time || null, null, faNote(r)]);
            summary.reconciled = (summary.reconciled || 0) + 1;
        }
    }
    // Mark the club baselined only once we've actually processed a non-empty batch — an empty ingest
    // (e.g. the clearing half of a reset) must NOT trip the flag, or the real batch would then alert.
    if (firstPoll && games.length) await setSetting(slug, 'faBaselinedAt', new Date().toISOString());
    console.log('[fa] ingest:', JSON.stringify(summary));
    return summary;
}

// Wipe a club's FA state so the NEXT ingest re-baselines from scratch (silently). Used to recover
// from a partial/incomplete first baseline without alerting the manager for games that already exist.
export async function resetClub(slug) {
    const cid = await clubId(slug);
    const r = await pool.query('DELETE FROM fa_game_sync WHERE club_id=$1', [cid]);
    await setSetting(slug, 'faBaselinedAt', '');
    return { ok: true, cleared: r.rowCount };
}

// ===== manager approval (email + push), mirrors server/requests.js =====

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const heDate = (ymd) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || ''); return m ? `${m[3]}/${m[2]}` : (ymd || ''); };

async function queueApproval(slug, id, f) {
    // best-effort; a failed email/push must not abort the poll
    notifyManagerFa(slug, id, f).catch((e) => console.error('[fa] mail failed', e.message));
    pushManagerFa(slug, id, f).catch((e) => console.error('[fa] push-manager failed', e.message));
}

function managerLinks(slug, id) {
    const base = process.env.APP_BASE_URL || '';
    const tok = faSign(id);
    return {
        approve: `${base}/api/${slug}/fa/${id}/approve?token=${tok}`,            // אשר ופרסם (with push)
        approveSilent: `${base}/api/${slug}/fa/${id}/approve?token=${tok}&push=0`, // אשר (no push)
        reject: `${base}/api/${slug}/fa/${id}/reject?token=${tok}`,
        base,
    };
}

async function notifyManagerFa(slug, id, f) {
    const club = await getClub(slug);
    const emails = [];
    if (process.env.MANAGER_EMAIL) emails.push(process.env.MANAGER_EMAIL);
    if (Array.isArray(club?.managerEmails)) emails.push(...club.managerEmails);
    else if (club?.managerEmail) emails.push(club.managerEmail);
    const to = [...new Set(emails.filter(Boolean))];
    if (!to.length) return;
    const { approve, approveSilent, reject } = managerLinks(slug, id);
    const html = `
      <div dir="rtl" style="font-family:Arial,sans-serif">
        <h3>⚽ עודכן משחק — ${esc(f.team)}</h3>
        <p><b>${esc(f.team)}</b> נגד <b>${esc(f.opponent)}</b>${f.home_away ? ` (${esc(f.home_away)})` : ''}</p>
        <p><b>תאריך:</b> ${esc(heDate(f.game_date))} · <b>שעה:</b> ${esc(f.game_time)}${f.field ? ` · <b>מגרש:</b> ${esc(f.field)}` : ''}</p>
        <p style="color:#666">${esc(f.league || '')}</p>
        <p style="margin-top:18px">
          <a href="${approve}" style="background:#16a34a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">✅ אשר ופרסם (שלח פוש)</a>
          &nbsp;&nbsp;
          <a href="${approveSilent}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">➕ אשר (ללו"ז בלבד)</a>
          &nbsp;&nbsp;
          <a href="${reject}" style="background:#dc2626;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">❌ דחה</a>
        </p>
        <p style="color:#999;font-size:12px">"אשר ופרסם" = מוסיף ללו"ז ושולח התראה להורים. "אשר" = מוסיף ללו"ז בלבד, בלי פוש.</p>
      </div>`;
    await sendEmail({ to, subject: `⚽ עדכון משחק — ${f.team} (${heDate(f.game_date)} ${f.game_time})`, html, fromName: `${club?.name || slug}` });
}

async function pushManagerFa(slug, id, f) {
    const { approve, reject, base } = managerLinks(slug, id);
    await broadcast(slug, {
        segment: '__MANAGER__',
        title: `⚽ עודכן משחק — ${f.team}`,
        body: `נגד ${f.opponent} · ${heDate(f.game_date)} בשעה ${f.game_time}`,
        url: `${base}/admin/dashboard`,
        data: { approveUrl: approve, rejectUrl: reject, label: `${f.team} נגד ${f.opponent}`, url: `${base}/admin/dashboard` },
        actions: [{ action: 'approve', title: '✅ אשר' }, { action: 'reject', title: '❌ דחה' }],
    });
}

// ===== apply / reject =====

export async function approveFaGame(slug, id, push = true) {
    const cid = await clubId(slug);
    const teamIdx = await liveTeamIndex(cid);
    const result = await withTx(async (cx) => {
        const rq = await cx.query(`SELECT * FROM fa_game_sync WHERE id=$1 AND club_id=$2 FOR UPDATE`, [id, cid]);
        if (!rq.rows.length) throw new Error('המשחק לא נמצא');
        const row = rq.rows[0];
        if (row.status === 'applied') throw new Error('כבר אושר');
        if (row.status === 'rejected') throw new Error('כבר נדחה');
        if (!row.team) throw new Error('הקבוצה לא ממופה — מפה אותה קודם');
        if (!row.game_date) throw new Error('למשחק אין תאריך');

        // Resolve to the board's exact team string + gender (our config value may differ in punctuation).
        const canon = teamIdx.get(norm(row.team)) || { name: row.team, gender: 'M' };
        const dow = new Date(row.game_date + 'T00:00:00Z').getUTCDay();
        const note = faNote(row);
        // Carry the team's coach so the match merges into the team's row (the public board groups by
        // team; a coach-less match would split the team into a second row and hide its trainings).
        const coach = (await cx.query(
            `SELECT coach FROM sessions WHERE club_id=$1 AND team=$2 AND coach IS NOT NULL AND coach <> '' ORDER BY date DESC LIMIT 1`,
            [cid, canon.name])).rows[0]?.coach || null;

        // Write into the publication(s) whose week actually CONTAINS this game: the live one (parents
        // see it now + we push) and/or the matching draft (goes live when the manager publishes). If
        // neither exists yet (a next-week game before its week is built), store it approved with no board
        // session — ingest's reconcile adds it once a publication for its week appears. Placing by the
        // game's own week is what stops the "wrong Saturday" mis-dating.
        const wk = weekSundayOf(row.game_date);
        const livePub = (await cx.query(`SELECT id FROM schedule_publications WHERE club_id=$1 AND status='live' AND week_start=$2 LIMIT 1`, [cid, wk])).rows[0];
        const draftPub = (await cx.query(`SELECT id FROM schedule_publications WHERE club_id=$1 AND status='draft' AND week_start=$2 LIMIT 1`, [cid, wk])).rows[0];
        // clear our own prior session(s) for this fixture (any publication) so re-applies don't pile up
        if (row.session_id) await cx.query('DELETE FROM sessions WHERE id=$1', [row.session_id]);
        await cx.query(`DELETE FROM sessions WHERE club_id=$1 AND team=$2 AND date=$3 AND type='match' AND note LIKE '⚽%'`, [cid, canon.name, row.game_date]);
        const insInto = async (pid) => (await cx.query(
            `INSERT INTO sessions (publication_id, club_id, team, coach, gender, hall, date, day_of_week, start_time, end_time, type, status, note)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'match','active',$11) RETURNING id`,
            [pid, cid, canon.name, coach, canon.gender, row.field || null, row.game_date, dow, row.game_time || null, null, note])).rows[0].id;
        let sid = null;
        if (livePub) sid = await insInto(livePub.id);
        if (draftPub) { const d = await insInto(draftPub.id); if (!sid) sid = d; }
        await cx.query(
            `UPDATE fa_game_sync SET status='applied', session_id=$2, notified_date=game_date, notified_time=game_time, updated_at=now() WHERE id=$1`,
            [id, sid],
        );
        await cx.query(
            `INSERT INTO audit_log (club_id, actor, action, entity, entity_id, diff) VALUES ($1,'manager','approve','fa_game',$2,$3)`,
            [cid, id, JSON.stringify({ team: canon.name, date: row.game_date, time: row.game_time, opponent: row.opponent })],
        );
        return { team: canon.name, row, onLive: !!livePub };
    });

    // "אשר ופרסם" (push=true) sends the parent push, but only when the game is on the LIVE board (its
    // week is published). "אשר" (push=false) just places it on the schedule, no push. A game that only
    // reached the draft (next week not published) never pushes here — it pushes when the manager publishes.
    const r = result.row;
    const body = `נגד ${r.opponent} · ${heDate(r.game_date)} בשעה ${r.game_time}${r.field ? ` · ${r.field}` : ''}`;
    if (result.onLive && push) {
        broadcast(slug, { segment: 'team:' + result.team, title: `⚽ עודכן משחק — ${result.team}`, body }).catch(() => {});
        return { ok: true, message: `המשחק פורסם ונשלח להורים: ${result.team} ${body}` };
    }
    if (result.onLive) return { ok: true, message: `המשחק נכנס ללו"ז (ללא פוש): ${result.team} ${body}` };
    return { ok: true, message: `המשחק אושר ונכנס לטיוטה — יפורסם כשתפרסם את הלו"ז: ${result.team} ${body}` };
}

// Manager manually edits a game (set/fix team, date, time) then saves it to the board + pushes.
// Reuses approveFaGame for the write+push, so notified_* is set and the auto-sync won't re-queue the
// same value — it re-alerts only if FA later reports a DIFFERENT time/date.
export async function manualApply(slug, id, edits = {}) {
    const cid = await clubId(slug);
    const vals = [id, cid]; const sets = []; let i = 3;
    for (const k of ['team', 'game_date', 'game_time']) {
        if (edits[k] !== undefined && edits[k] !== null) { sets.push(`${k}=$${i++}`); vals.push(String(edits[k])); }
    }
    sets.push("status='pending'");
    await pool.query(`UPDATE fa_game_sync SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 AND club_id=$2`, vals);
    return approveFaGame(slug, id); // writes to the live board + pushes the team + sets notified_*
}

export async function rejectFaGame(slug, id) {
    const cid = await clubId(slug);
    // Mark rejected AND treat the current value as "surfaced" so we don't nag again for the same
    // date/time — but a FURTHER change will cross the threshold and re-queue.
    const r = await pool.query(
        `UPDATE fa_game_sync SET status='rejected', notified_date=game_date, notified_time=game_time, updated_at=now() WHERE id=$1 AND club_id=$2`,
        [id, cid]);
    if (!r.rowCount) throw new Error('המשחק לא נמצא');
    return { ok: true };
}

export async function listFaGames(slug, status = 'pending') {
    const cid = await clubId(slug);
    const r = await pool.query(
        `SELECT id, team, league, game_name, opponent, home_away, field, round, game_date, game_time, status, updated_at
         FROM fa_game_sync WHERE club_id=$1 AND ($2='all' OR status=$2) ORDER BY game_date, game_time`,
        [cid, status]);
    return r.rows;
}

export async function faDiag(slug) {
    const club = await getClub(slug).catch(() => null);
    const out = { faClubId: club?.faClubId || null, baselinedAt: null, byStatus: null };
    if (!club?.faClubId) return out;
    try {
        out.baselinedAt = await getSetting(slug, 'faBaselinedAt');
        const cid = await clubId(slug);
        const r = await pool.query('SELECT status, count(*)::int n FROM fa_game_sync WHERE club_id=$1 GROUP BY status', [cid]);
        out.byStatus = Object.fromEntries(r.rows.map((x) => [x.status, x.n]));
    } catch { /* table may not exist yet */ }
    return out;
}
