import { useState } from 'react';
import { gamesPdfToEntries } from '../utils/gamesParse.js';
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
const targetOf = (dateStr) => {
    if (!dateStr) return null;
    return fmt(sundayOf(new Date(dateStr + 'T00:00:00'))) <= curWeek() ? 'live' : 'draft';
};

// Manager tools that ADD games / goalkeeper trainings to the schedule. Two targets:
//  • "עכשיו" → the LIVE schedule (current week) — parents see on reload.
//  • "שבוע הבא" → the draft.
// Flow: parse → REVIEW (an EDITABLE table — the manager fixes team / day / time / week / details
// before anything is written) → confirm → optional manual push to the updated teams.
export default function SpecialSchedule({ mode, onApplied, goPreview }) {
    const slug = getActiveClub().slug;
    const isGk = mode === 'gk';
    const [step, setStep] = useState('input'); // input | review | done
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [gkText, setGkText] = useState('');
    const [rows, setRows] = useState([]);       // editable: [{hint, team, dow, time, target, details}]
    const [teamsList, setTeamsList] = useState([]); // {name, gender, coach} for the dropdowns
    const [warnings, setWarnings] = useState([]);
    const [applied, setApplied] = useState(null);
    const [whatsapp, setWhatsapp] = useState('');
    const [pushMsg, setPushMsg] = useState('');

    const fetchTeams = async () => {
        const d = await fetch(`/api/${slug}/teams`).then((r) => r.json()).catch(() => ({ teams: [] }));
        return (d.teams || []).map((t) => ({ name: t.name, gender: t.gender || 'M', coach: t.coach || '' }));
    };

    // Build the editable rows. Unmatched teams come through with team:'' so the manager can pick one.
    const toRows = (entries, teams, kind, fileDefault) => {
        const names = teams.map((t) => t.name);
        return entries.map((e) => {
            const details = kind === 'gk' ? ''
                : [e.opponent ? `נגד ${e.opponent}` : '', e.homeAway ? `(${e.homeAway})` : '', e.field ? `· ${e.field}` : ''].filter(Boolean).join(' ');
            return {
                hint: e.team,                                   // the name as parsed (for unmatched rows)
                team: matchTeam(e.team, names) || '',           // matched club team, or '' to assign
                dow: e.dow,
                time: e.timeRange || e.time || '',
                target: targetOf(e.date) || fileDefault,        // per-row week, editable
                details,
            };
        });
    };

    const startGames = async (file) => {
        if (!file) return;
        setBusy(true); setErr('');
        try {
            const [{ entries, warnings: w, weekStart }, teams] = await Promise.all([gamesPdfToEntries(file), fetchTeams()]);
            setTeamsList(teams);
            setRows(toRows(entries, teams, 'games', weekStart === nextWeek() ? 'draft' : 'live'));
            setWarnings(w || []); setWhatsapp(''); setStep('review');
        } catch (e) { setErr(e.message || 'שגיאה בקריאת הקובץ'); }
        finally { setBusy(false); }
    };

    const startGk = async () => {
        if (!gkText.trim()) { setErr('הדבק את טקסט אימון השוערים'); return; }
        setBusy(true); setErr('');
        try {
            const { entries, warnings: w, dayName } = gkTextToEntries(gkText);
            const teams = await fetchTeams();
            setTeamsList(teams);
            setRows(toRows(entries, teams, 'gk', 'live'));
            setWarnings(w || []); setWhatsapp(gkWhatsApp(entries, dayName)); setStep('review');
        } catch (e) { setErr(e.message || 'שגיאה בפענוח הטקסט'); }
        finally { setBusy(false); }
    };

    const update = (i, field, val) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, [field]: val } : r)));
    const removeRow = (i) => setRows((rs) => rs.filter((_, k) => k !== i));

    // One editable row → the session to POST. note is REBUILT from the (possibly edited) fields.
    const toSession = (r) => {
        const [start, end] = (r.time || '').split('-');
        const note = isGk
            ? ['🧤 אימון שוערים', r.time].filter(Boolean).join(' ')
            : ['🏀 משחק', r.time, r.details].filter((x) => x && x.trim()).join(' ');
        const t = teamsList.find((x) => x.name === r.team) || {};
        return {
            team: r.team, coach: t.coach || '', gender: t.gender || 'M', day_of_week: r.dow,
            start_time: start || null, end_time: end || null, type: isGk ? 'training' : 'match', note,
        };
    };

    const postAppend = async (tgt, grp) => {
        if (!grp.length) return { inserted: 0, affectedTeams: [] };
        const res = await fetch(`/api/${slug}/schedule/append`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(slug) },
            body: JSON.stringify({ target: tgt, sessions: grp.map(toSession) }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || 'ההוספה נכשלה');
        return d;
    };

    const confirmApply = async () => {
        const valid = rows.filter((r) => r.team && r.time); // need a team + a time to place it
        if (!valid.length) { setErr('אין רשומות מוכנות — ודא שלכל שורה יש קבוצה ושעה'); return; }
        setBusy(true); setErr('');
        try {
            const [rl, rd] = await Promise.all([
                postAppend('live', valid.filter((r) => r.target === 'live')),
                postAppend('draft', valid.filter((r) => r.target === 'draft')),
            ]);
            setApplied({
                liveN: rl.inserted || 0, draftN: rd.inserted || 0,
                skipped: (rl.skipped || 0) + (rd.skipped || 0),
                // Push only for LIVE teams — next-week (draft) games aren't visible to parents yet.
                liveTeams: rl.affectedTeams || [],
                draftTeams: rd.affectedTeams || [],
            });
            setStep('done');
            if (rd.inserted) onApplied?.();
        } catch (e) { setErr(e.message); }
        finally { setBusy(false); }
    };

    const sendPush = async () => {
        if (!applied?.liveTeams?.length) return;
        setBusy(true); setPushMsg('');
        try {
            const body = isGk ? 'לו"ז אימון השוערים עודכן 🧤' : 'לו"ז המשחקים עודכן 🏀';
            const segments = applied.liveTeams.map((t) => 'team:' + t);
            const r = await fetch(`/api/${slug}/messages`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(slug) },
                body: JSON.stringify({ title: 'עדכון לו"ז', body, target: `קבוצות: ${applied.liveTeams.join(', ')}`, segments, channel: 'all' }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || d.error) throw new Error(d.error || ('HTTP ' + r.status));
            const n = (d.sent || 0) + (d.nativeSent || 0);
            setPushMsg(`✓ פוש נשלח ל-${n} מכשירים (${applied.liveTeams.length} קבוצות)`);
        } catch (e) { setPushMsg('⚠️ שליחת הפוש נכשלה' + (e?.message ? ': ' + e.message : '')); }
        finally { setBusy(false); }
    };

    const reset = () => { setStep('input'); setRows([]); setApplied(null); setWhatsapp(''); setPushMsg(''); setErr(''); setGkText(''); };

    const btn = (bg) => ({ background: bg, color: '#fff', border: 'none', padding: '0.7rem 1.3rem', borderRadius: 8, cursor: busy ? 'wait' : 'pointer', fontWeight: 'bold' });
    const accent = isGk ? '#a855f7' : '#ff7a18';
    const cell = { padding: '0.3rem 0.4rem', borderTop: '1px solid #eef2f7' };
    const inp = { width: '100%', padding: '0.3rem 0.4rem', borderRadius: 6, border: '1px solid #cbd5e1', fontFamily: 'inherit', fontSize: '0.84rem', background: '#fff', color: '#0f1b33' };
    const readyCount = rows.filter((r) => r.team && r.time).length;

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <h3 style={{ marginTop: 0 }}>{isGk ? '🧤 לו"ז שוערים' : '🏀 פרסום משחקים'}</h3>

            {step === 'input' && (
                <>
                    {isGk ? (
                        <>
                            <p style={{ color: '#666', maxWidth: 680 }}>
                                הדבק את הטקסט של מאמן השוערים (קבוצות + שעות). בשלב הבא תוכל <b>לבדוק ולתקן</b> כל שורה
                                לפני אישור, ואז לשלוח פוש לקבוצות שעודכנו. גם מכין טקסט וואטסאפ מסודר.
                            </p>
                            <textarea value={gkText} onChange={(e) => setGkText(e.target.value)} rows={8}
                                placeholder={'לדוגמה:\nאימון שוערים יום ראשון\nנוער\n15:00 - 15:30\nילדים א + ילדים ב\n16:00 - 16:30'}
                                style={{ width: '100%', padding: '0.7rem', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'inherit', resize: 'vertical' }} />
                            <button onClick={startGk} disabled={busy} style={{ ...btn(accent), marginTop: '0.8rem' }}>{busy ? 'מפענח…' : 'המשך לבדיקה ›'}</button>
                        </>
                    ) : (
                        <>
                            <p style={{ color: '#666', maxWidth: 680 }}>
                                העלה את קובץ המשחקים (PDF). בשלב הבא תראה טבלה <b>שאפשר לערוך</b> — קבוצה, יום, שעה, שבוע
                                ופרטים — ו<b>תאשר לפני שמשהו נכנס</b>.
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
                    <div style={{ fontWeight: 800, marginBottom: '0.5rem' }}>
                        זוהו {rows.length} רשומות — אפשר לתקן כל שורה, ואז לאשר ({readyCount} מוכנות).
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem' }}>
                        שורה בלי קבוצה או בלי שעה לא תתווסף. 🔴 = מתווסף עכשיו ללו"ז החי · 🗓️ = לטיוטה (שבוע הבא).
                    </div>
                    <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                            <thead><tr style={{ background: '#f8fafc', textAlign: 'right' }}>
                                <th style={{ padding: '0.4rem', minWidth: 150 }}>קבוצה</th>
                                <th style={{ minWidth: 90 }}>יום</th>
                                <th style={{ minWidth: 90 }}>שעה</th>
                                <th style={{ minWidth: 95 }}>שבוע</th>
                                <th>פרטים</th>
                                <th></th>
                            </tr></thead>
                            <tbody>
                                {rows.map((r, i) => (
                                    <tr key={i} style={{ background: (!r.team || !r.time) ? '#fff7ed' : 'transparent' }}>
                                        <td style={cell}>
                                            <select value={r.team} onChange={(e) => update(i, 'team', e.target.value)} style={{ ...inp, borderColor: r.team ? '#cbd5e1' : '#f59e0b' }}>
                                                <option value="">— בחר קבוצה{r.hint ? ` (${r.hint})` : ''} —</option>
                                                {teamsList.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                                            </select>
                                        </td>
                                        <td style={cell}>
                                            <select value={r.dow} onChange={(e) => update(i, 'dow', Number(e.target.value))} style={inp}>
                                                {DOW_HE.map((d, k) => <option key={k} value={k}>{d}</option>)}
                                            </select>
                                        </td>
                                        <td style={cell}>
                                            <input value={r.time} onChange={(e) => update(i, 'time', e.target.value)} placeholder="16:00" dir="ltr"
                                                style={{ ...inp, borderColor: r.time ? '#cbd5e1' : '#f59e0b' }} />
                                        </td>
                                        <td style={cell}>
                                            <select value={r.target} onChange={(e) => update(i, 'target', e.target.value)}
                                                style={{ ...inp, fontWeight: 700, color: r.target === 'live' ? '#dc2626' : '#2563eb' }}>
                                                <option value="live">🔴 עכשיו</option>
                                                <option value="draft">🗓️ הבא</option>
                                            </select>
                                        </td>
                                        <td style={cell}>
                                            {!isGk && <input value={r.details} onChange={(e) => update(i, 'details', e.target.value)} placeholder="נגד … (בית/חוץ) · מגרש" style={inp} />}
                                        </td>
                                        <td style={cell}>
                                            <button onClick={() => removeRow(i)} title="הסר שורה" style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 800 }}>✕</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {warnings.length > 0 && (
                        <ul style={{ margin: '0.6rem 0 0', paddingInlineStart: '1.2rem', color: '#92400e', fontSize: '0.84rem' }}>
                            {warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                    )}

                    <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                        <button onClick={confirmApply} disabled={busy || !readyCount} style={btn('#16a34a')}>
                            {busy ? 'מוסיף…' : `✅ אשר והוסף (${readyCount})`}
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
                        {applied.liveTeams.length > 0 && (
                            <div style={{ marginTop: '0.5rem', color: '#334155' }}>קבוצות שעודכנו בלו"ז החי: {applied.liveTeams.join(', ')}</div>
                        )}
                        {applied.draftTeams.length > 0 && (
                            <div style={{ marginTop: '0.3rem', color: '#64748b', fontSize: '0.85rem' }}>בטיוטה (שבוע הבא, לא גלוי עדיין להורים): {applied.draftTeams.join(', ')}</div>
                        )}
                    </div>

                    {applied.liveTeams.length > 0 ? (
                        <div style={{ marginTop: '1rem' }}>
                            <button onClick={sendPush} disabled={busy} style={btn('#2563eb')}>📢 שלח פוש להורים (משחקי השבוע)</button>
                            {pushMsg && <span style={{ marginInlineStart: '0.8rem', fontWeight: 700, color: pushMsg.startsWith('✓') ? '#16a34a' : '#dc2626' }}>{pushMsg}</span>}
                            <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.4rem' }}>יישלח ל{applied.liveTeams.length} קבוצות שקיבלו משחק השבוע.</div>
                        </div>
                    ) : (
                        <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#64748b' }}>אין פוש — לא נוספו משחקים ללו"ז החי (רק לטיוטה). הפוש יישלח כשתפרסם את הטיוטה.</div>
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
