import { useState } from 'react';
import { gamesPdfToEntries, gameLine } from '../utils/gamesParse.js';
import { gkTextToEntries, gkWhatsApp } from '../utils/gkParse.js';
import { matchTeam } from '../utils/scheduleMerge.js';
import { authHeaders } from '../adminApi.js';
import { getActiveClub } from '../clubConfig.js';

const DOW_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sundayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; };
const curWeek = () => fmt(sundayOf(new Date()));
const nextWeek = () => { const s = sundayOf(new Date()); s.setDate(s.getDate() + 7); return fmt(s); };
// Route one dated game: this week (or earlier) → live (now); a future week → draft (next week).
// No date → null, meaning "use the manager's default pick".
const targetOf = (dateStr) => {
    if (!dateStr) return null;
    const sun = fmt(sundayOf(new Date(dateStr + 'T00:00:00')));
    return sun <= curWeek() ? 'live' : 'draft';
};

// Manager tools that ADD games / goalkeeper trainings to the schedule. Two targets:
//  • "עכשיו" → the LIVE schedule (current week) — parents see on reload.
//  • "שבוע הבא" → the draft.
// Flow: parse → REVIEW (what goes where, team-matched or not) → confirm → optional push to the
// updated teams. Nothing is written until the manager confirms in the review step.
export default function SpecialSchedule({ mode, onApplied, goPreview }) {
    const slug = getActiveClub().slug;
    const [step, setStep] = useState('input'); // input | review | done
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [gkText, setGkText] = useState('');
    const [defaultTarget, setDefaultTarget] = useState('live'); // week for rows WITHOUT a date in the file
    const [rows, setRows] = useState([]);          // [{team, matched, dow, time, note, start, end, type, gender, coach, date, target}]
    const [unmatched, setUnmatched] = useState([]);
    const [warnings, setWarnings] = useState([]);
    const [applied, setApplied] = useState(null);  // { inserted, affectedTeams, target }
    const [whatsapp, setWhatsapp] = useState('');
    const [pushMsg, setPushMsg] = useState('');

    const fetchTeams = async () => {
        const d = await fetch(`/api/${slug}/teams`).then((r) => r.json()).catch(() => ({ teams: [] }));
        return (d.teams || []).map((t) => ({ name: t.name, gender: t.gender || 'M', coach: t.coach || '' }));
    };

    // entries (team, dow, line, time/timeRange) + team list → review rows (matched) + unmatched.
    const toRows = (entries, teams, kind) => {
        const names = teams.map((t) => t.name);
        const byName = {}; teams.forEach((t) => { byName[t.name] = t; });
        const rowsOut = [], miss = [];
        for (const e of entries) {
            const hit = matchTeam(e.team, names);
            const [start, end] = (kind === 'gk' ? e.timeRange : e.time || '').split('-');
            // GK entries already carry a `line`; game entries don't — build it with gameLine(e).
            const note = kind === 'gk' ? e.line : gameLine(e);
            const base = { dow: e.dow, time: e.timeRange || e.time || '', note, start: start || '', end: end || '', type: kind === 'gk' ? 'training' : 'match', date: e.date || null, target: targetOf(e.date) };
            if (!hit) { miss.push({ ...base, team: e.team }); continue; }
            const t = byName[hit] || {};
            rowsOut.push({ ...base, team: hit, matched: true, gender: t.gender || 'M', coach: t.coach || '' });
        }
        return { rowsOut, miss };
    };

    const startGames = async (file) => {
        if (!file) return;
        setBusy(true); setErr('');
        try {
            const [{ entries, warnings: w, weekStart }, teams] = await Promise.all([gamesPdfToEntries(file), fetchTeams()]);
            const { rowsOut, miss } = toRows(entries, teams, 'games');
            // Default week (for any game WITHOUT a date) from the file's weekend: next week → draft.
            setDefaultTarget(weekStart === nextWeek() ? 'draft' : 'live');
            setRows(rowsOut); setUnmatched(miss); setWarnings(w || []); setWhatsapp('');
            setStep('review');
        } catch (e) { setErr(e.message || 'שגיאה בקריאת הקובץ'); }
        finally { setBusy(false); }
    };

    const startGk = async () => {
        if (!gkText.trim()) { setErr('הדבק את טקסט אימון השוערים'); return; }
        setBusy(true); setErr('');
        try {
            const [{ entries, warnings: w, dayName }, teams] = await Promise.all([Promise.resolve(gkTextToEntries(gkText)), fetchTeams()]);
            const { rowsOut, miss } = toRows(entries, teams, 'gk');
            setDefaultTarget('live'); // GK usually arrives for the current week (a day or two before)
            setRows(rowsOut); setUnmatched(miss); setWarnings(w || []);
            setWhatsapp(gkWhatsApp(entries, dayName));
            setStep('review');
        } catch (e) { setErr(e.message || 'שגיאה בפענוח הטקסט'); }
        finally { setBusy(false); }
    };

    const resolved = (r) => r.target || defaultTarget; // row's own week, else the manager's default

    const postAppend = async (tgt, grp) => {
        if (!grp.length) return { inserted: 0, affectedTeams: [] };
        const sessions = grp.map((r) => ({
            team: r.team, coach: r.coach, gender: r.gender, day_of_week: r.dow,
            start_time: r.start || null, end_time: r.end || null, type: r.type, note: r.note,
        }));
        const res = await fetch(`/api/${slug}/schedule/append`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(slug) },
            body: JSON.stringify({ target: tgt, sessions }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || 'ההוספה נכשלה');
        return d;
    };

    const confirmApply = async () => {
        if (!rows.length) { setErr('אין מה להוסיף'); return; }
        setBusy(true); setErr('');
        try {
            const live = rows.filter((r) => resolved(r) === 'live');
            const draft = rows.filter((r) => resolved(r) === 'draft');
            const [rl, rd] = await Promise.all([postAppend('live', live), postAppend('draft', draft)]);
            const affected = [...new Set([...(rl.affectedTeams || []), ...(rd.affectedTeams || [])])];
            setApplied({
                liveN: rl.inserted || 0, draftN: rd.inserted || 0,
                skipped: (rl.skipped || 0) + (rd.skipped || 0),
                affectedTeams: affected,
            });
            setStep('done');
            if (draft.length) onApplied?.();
        } catch (e) { setErr(e.message); }
        finally { setBusy(false); }
    };

    const sendPush = async () => {
        if (!applied?.affectedTeams?.length) return;
        setBusy(true); setPushMsg('');
        try {
            const body = mode === 'gk' ? 'לו"ז אימון השוערים עודכן 🧤' : 'לו"ז המשחקים עודכן 🏀';
            const segments = applied.affectedTeams.map((t) => 'team:' + t);
            const r = await fetch(`/api/${slug}/messages`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(slug) },
                body: JSON.stringify({ title: 'עדכון לו"ז', body, target: `קבוצות: ${applied.affectedTeams.join(', ')}`, segments, channel: 'all' }),
            });
            const d = await r.json().catch(() => ({}));
            if (d.error) throw new Error();
            const n = (d.sent || 0) + (d.nativeSent || 0);
            setPushMsg(`✓ פוש נשלח ל-${n} מכשירים (${applied.affectedTeams.length} קבוצות)`);
        } catch { setPushMsg('⚠️ שליחת הפוש נכשלה'); }
        finally { setBusy(false); }
    };

    const reset = () => { setStep('input'); setRows([]); setUnmatched([]); setApplied(null); setWhatsapp(''); setPushMsg(''); setErr(''); setGkText(''); };

    const panel = { marginTop: 0, color: '#0f1b33' };
    const btn = (bg) => ({ background: bg, color: '#fff', border: 'none', padding: '0.7rem 1.3rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer', fontWeight: 'bold' });
    const isGk = mode === 'gk';
    const accent = isGk ? '#a855f7' : '#ff7a18';

    return (
        <div className="report-panel" style={panel}>
            <h3 style={{ marginTop: 0 }}>{isGk ? '🧤 לו"ז שוערים' : '🏀 פרסום משחקים'}</h3>

            {step === 'input' && (
                <>
                    {isGk ? (
                        <>
                            <p style={{ color: '#666', maxWidth: 680 }}>
                                הדבק את הטקסט של מאמן השוערים (קבוצות + שעות). בשלב הבא תראה בדיוק מה ייכנס ולאן, תאשר,
                                ותוכל לשלוח פוש לקבוצות שעודכנו. גם מכין טקסט וואטסאפ מסודר.
                            </p>
                            <textarea value={gkText} onChange={(e) => setGkText(e.target.value)} rows={8}
                                placeholder={'לדוגמה:\nאימון שוערים יום ראשון\nנוער\n15:00 - 15:30\nילדים א + ילדים ב\n16:00 - 16:30'}
                                style={{ width: '100%', padding: '0.7rem', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'inherit', resize: 'vertical' }} />
                            <button onClick={startGk} disabled={busy} style={{ ...btn(accent), marginTop: '0.8rem' }}>{busy ? 'מפענח…' : 'המשך לבדיקה ›'}</button>
                        </>
                    ) : (
                        <>
                            <p style={{ color: '#666', maxWidth: 680 }}>
                                העלה את קובץ המשחקים (PDF). בשלב הבא תראה בדיוק אילו משחקים זוהו, לאיזו קבוצה וליום,
                                ולאיזה שבוע — <b>תאשר לפני שמשהו נכנס</b>.
                            </p>
                            <label style={{ ...btn(accent), display: 'inline-block' }}>
                                {busy ? 'קורא…' : '⬆ העלה קובץ משחקים (PDF)'}
                                <input type="file" accept=".pdf" style={{ display: 'none' }}
                                    onChange={(e) => { startGames(e.target.files[0]); e.target.value = ''; }} />
                            </label>
                        </>
                    )}
                    {err && <div style={{ marginTop: '1rem', color: '#dc2626', fontWeight: 700 }}>⚠️ {err}</div>}
                </>
            )}

            {step === 'review' && (
                <>
                    {/* Default week for rows the file gave NO date — dated rows route themselves. */}
                    {rows.some((r) => !r.target) && (
                        <div style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 10, padding: '0.8rem 1rem', marginBottom: '1rem' }}>
                            <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>רשומות ללא תאריך בקובץ — לאיזה שבוע?</div>
                            <label style={{ display: 'block', marginBottom: '0.4rem', cursor: 'pointer' }}>
                                <input type="radio" checked={defaultTarget === 'live'} onChange={() => setDefaultTarget('live')} />{' '}
                                🔴 <b>עכשיו — השבוע הנוכחי</b> (מיד ללו"ז שההורים רואים)
                            </label>
                            <label style={{ display: 'block', cursor: 'pointer' }}>
                                <input type="radio" checked={defaultTarget === 'draft'} onChange={() => setDefaultTarget('draft')} />{' '}
                                🗓️ <b>שבוע הבא</b> (לטיוטה)
                            </label>
                        </div>
                    )}

                    <div style={{ fontWeight: 800, marginBottom: '0.4rem' }}>זוהו {rows.length} רשומות — בדוק ואשר:</div>
                    <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                            <thead><tr style={{ background: '#f8fafc', textAlign: 'right' }}>
                                <th style={{ padding: '0.4rem 0.6rem' }}>קבוצה</th><th>יום</th><th>שעה</th><th>שבוע</th><th>פרטים</th>
                            </tr></thead>
                            <tbody>
                                {rows.map((r, i) => {
                                    const tgt = resolved(r);
                                    return (
                                        <tr key={i} style={{ borderTop: '1px solid #eef2f7' }}>
                                            <td style={{ padding: '0.35rem 0.6rem', fontWeight: 700 }}>{r.team}</td>
                                            <td>{DOW_HE[r.dow]}</td>
                                            <td style={{ direction: 'ltr' }}>{r.time}</td>
                                            <td style={{ fontWeight: 700, color: tgt === 'live' ? '#dc2626' : '#2563eb', whiteSpace: 'nowrap' }}>
                                                {tgt === 'live' ? '🔴 עכשיו' : '🗓️ הבא'}
                                            </td>
                                            <td style={{ color: '#475569' }}>{(r.note || '').replace(/^🏀 |^🧤 /, '')}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {unmatched.length > 0 && (
                        <div style={{ marginTop: '0.8rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '0.6rem 0.8rem' }}>
                            <b>{unmatched.length} לא שויכו לקבוצה (לא יתווספו):</b>
                            <ul style={{ margin: '0.3rem 0 0', paddingInlineStart: '1.2rem' }}>
                                {unmatched.map((u, i) => <li key={i}>{u.team} — {DOW_HE[u.dow]} {u.time}</li>)}
                            </ul>
                        </div>
                    )}
                    {warnings.length > 0 && (
                        <ul style={{ margin: '0.6rem 0 0', paddingInlineStart: '1.2rem', color: '#92400e', fontSize: '0.84rem' }}>
                            {warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                    )}

                    <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                        <button onClick={confirmApply} disabled={busy || !rows.length} style={btn('#16a34a')}>
                            {busy ? 'מוסיף…' : '✅ אשר והוסף'}
                        </button>
                        <button onClick={reset} disabled={busy} style={btn('#64748b')}>ביטול</button>
                    </div>
                    {err && <div style={{ marginTop: '1rem', color: '#dc2626', fontWeight: 700 }}>⚠️ {err}</div>}
                </>
            )}

            {step === 'done' && applied && (
                <div>
                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '0.9rem 1rem' }}>
                        <div style={{ fontWeight: 800, color: '#065f46' }}>
                            {applied.liveN > 0 && <div>✓ {applied.liveN} נוספו ללו"ז החי — ההורים רואים מעכשיו 🔴</div>}
                            {applied.draftN > 0 && <div>✓ {applied.draftN} נוספו לטיוטה (שבוע הבא) 🗓️</div>}
                            {!applied.liveN && !applied.draftN && <div>לא נוספו רשומות חדשות.</div>}
                            {applied.skipped ? <div style={{ fontWeight: 400, color: '#475569' }}>({applied.skipped} כבר היו קיימות — דולגו)</div> : null}
                        </div>
                        {applied.affectedTeams.length > 0 && (
                            <div style={{ marginTop: '0.5rem', color: '#334155' }}>קבוצות שעודכנו: {applied.affectedTeams.join(', ')}</div>
                        )}
                    </div>

                    {applied.affectedTeams.length > 0 && (
                        <div style={{ marginTop: '1rem' }}>
                            <button onClick={sendPush} disabled={busy} style={btn('#2563eb')}>📢 שלח פוש לקבוצות שעודכנו</button>
                            {pushMsg && <span style={{ marginInlineStart: '0.8rem', fontWeight: 700, color: pushMsg.startsWith('✓') ? '#16a34a' : '#dc2626' }}>{pushMsg}</span>}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                        {applied.draftN > 0 && <button onClick={goPreview} style={btn('#7c3aed')}>👁 עבור לתצוגה מקדימה</button>}
                        <button onClick={reset} style={btn('#64748b')}>טעינה נוספת</button>
                    </div>

                    {whatsapp && (
                        <div style={{ marginTop: '1.4rem' }}>
                            <div style={{ fontWeight: 800, marginBottom: '0.4rem' }}>📋 טקסט וואטסאפ מסודר</div>
                            <textarea readOnly value={whatsapp} rows={Math.min(14, whatsapp.split('\n').length + 1)}
                                style={{ width: '100%', padding: '0.7rem', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'inherit', direction: 'rtl' }} />
                            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                <button onClick={() => navigator.clipboard?.writeText(whatsapp)} style={btn('#64748b')}>📋 העתק</button>
                                <button onClick={() => window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(whatsapp)}`, '_blank')} style={btn('#25D366')}>💬 שתף בוואטסאפ</button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
