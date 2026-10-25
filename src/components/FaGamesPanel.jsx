import { useState, useEffect, useCallback } from 'react';
import { authHeaders } from '../adminApi.js';

// Manager hub for the FA-games sync: fixtures the Cloudflare Worker pulls from the Israel FA.
// One place to pull now, review what's waiting, edit a game and save it to the board + push, and
// browse what's tracked (collapsed by week). Cup/senior games it can't map to a team are tucked into
// a collapsed section at the bottom (we don't auto-push those).
const pad = (n) => String(n).padStart(2, '0');
const heDate = (ymd) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || ''); return m ? `${m[3]}/${m[2]}` : (ymd || ''); };
const hasTime = (t) => Boolean(t) && t !== '00:00';
const weekOf = (ymd) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return '';
    const d = new Date(ymd + 'T00:00:00'); d.setDate(d.getDate() - d.getDay());
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function FaGamesPanel({ clubSlug }) {
    const [games, setGames] = useState([]);
    const [teams, setTeams] = useState([]);
    const [busy, setBusy] = useState('');
    const [msg, setMsg] = useState('');
    const [editing, setEditing] = useState('');
    const [form, setForm] = useState({ date: '', time: '', team: '' });
    const [openWeeks, setOpenWeeks] = useState({});
    const [showUnmapped, setShowUnmapped] = useState(false);

    const load = useCallback(() => {
        fetch(`/api/${clubSlug}/fa?status=all`, { headers: authHeaders(clubSlug) })
            .then((r) => r.json()).then((d) => setGames(Array.isArray(d.games) ? d.games : [])).catch(() => { /* dev */ });
    }, [clubSlug]);
    useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
    useEffect(() => {
        fetch(`/api/${clubSlug}/schedule`).then((r) => r.json())
            .then((d) => { const s = d.sessions || (d.weeks || []).flatMap((w) => w.sessions || []); setTeams([...new Set(s.map((x) => x.team).filter(Boolean))].sort()); })
            .catch(() => { /* dev */ });
    }, [clubSlug]);

    const pullNow = async () => {
        setBusy('pull'); setMsg('⏳ מושך מההתאחדות…');
        try {
            const r = await fetch(`/api/${clubSlug}/fa/pull-url`, { headers: authHeaders(clubSlug) });
            const d = await r.json();
            if (!d.url) throw new Error('לא ניתן למשוך');
            await fetch(d.url, { mode: 'no-cors' }).catch(() => { /* opaque trigger */ });
            setTimeout(() => { load(); setMsg('✓ המשיכה הושלמה'); setBusy(''); }, 6000);
        } catch (e) { setMsg('⚠️ ' + e.message); setBusy(''); }
    };

    const act = async (id, action) => {
        setBusy(id); setMsg('');
        try {
            const r = await fetch(`/api/${clubSlug}/fa/${id}/${action}`, { method: 'POST', headers: authHeaders(clubSlug) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d.error || 'הפעולה נכשלה');
            setMsg(action === 'approve' ? (d.message || '✓ אושר ונשלח להורים') : '✓ נדחה');
            load();
        } catch (e) { setMsg('⚠️ ' + e.message); } finally { setBusy(''); }
    };

    const startEdit = (g) => { setEditing(g.id); setForm({ date: g.game_date || '', time: hasTime(g.game_time) ? g.game_time : '', team: g.team || '' }); };
    const saveGame = async (g) => {
        if (!form.team) { setMsg('⚠️ בחר קבוצה'); return; }
        if (!form.date || !form.time) { setMsg('⚠️ צריך תאריך ושעה'); return; }
        setBusy(g.id); setMsg('');
        try {
            const r = await fetch(`/api/${clubSlug}/fa/${g.id}/apply`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(clubSlug) },
                body: JSON.stringify({ team: form.team, game_date: form.date, game_time: form.time }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d.error || 'השמירה נכשלה');
            setMsg(d.message || '✓ נשמר ללו"ז ונשלח פוש');
            setEditing(''); load();
        } catch (e) { setMsg('⚠️ ' + e.message); } finally { setBusy(''); }
    };

    const today = new Date().toISOString().slice(0, 10);
    const pending = games.filter((g) => g.status === 'pending');
    // Tracked = upcoming only. Hide games already played (game_date before today); keep ones with no
    // date yet (still awaiting a time). Past games are clutter once a new week starts.
    const tracked = games.filter((g) => (g.status === 'tracking' || g.status === 'applied') && (!g.game_date || g.game_date >= today));
    const unmapped = games.filter((g) => g.status === 'unmapped');

    // tracked grouped by week, weeks sorted ascending; nearest-future week open by default.
    const weeks = {};
    tracked.forEach((g) => { const w = weekOf(g.game_date) || 'other'; (weeks[w] = weeks[w] || []).push(g); });
    const weekKeys = Object.keys(weeks).sort();
    const todayWeek = weekOf(new Date().toISOString().slice(0, 10));

    const editBox = (g, allowTeam) => (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginTop: '0.6rem', background: '#f8fafc', padding: '0.6rem', borderRadius: 9 }}>
            {allowTeam && (
                <select value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} style={{ padding: '0.45rem', borderRadius: 7, border: '1px solid #cbd5e1' }}>
                    <option value="">— קבוצה —</option>
                    {teams.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
            )}
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={{ padding: '0.45rem', borderRadius: 7, border: '1px solid #cbd5e1' }} />
            <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} style={{ padding: '0.45rem', borderRadius: 7, border: '1px solid #cbd5e1' }} />
            <button disabled={busy === g.id} onClick={() => saveGame(g)} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '0.5rem 1rem', fontWeight: 800, cursor: 'pointer' }}>💾 שמור ללו"ז + פוש</button>
            <button onClick={() => setEditing('')} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>ביטול</button>
        </div>
    );

    const gameLine = (g) => (
        <>
            <b>{g.team || '—'}</b> <span style={{ color: '#64748b' }}>נגד {g.opponent}{g.home_away ? ` (${g.home_away})` : ''}</span>
            {' · '}{g.game_date ? heDate(g.game_date) : <span style={{ color: '#d97706' }}>חסר תאריך</span>}
            {' · '}<b style={{ color: hasTime(g.game_time) ? '#0f1b33' : '#d97706' }}>{hasTime(g.game_time) ? g.game_time : 'חסר שעה'}</b>
        </>
    );

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
                <h3 style={{ margin: 0 }}>⚽ משחקי ליגה (התאחדות)</h3>
                <button disabled={busy === 'pull'} onClick={pullNow} style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 9, padding: '0.55rem 1.1rem', fontWeight: 700, cursor: busy === 'pull' ? 'wait' : 'pointer' }}>🔄 משוך עכשיו</button>
            </div>
            <p style={{ color: '#475569', maxWidth: 680 }}>
                המערכת מושכת אוטומטית מאתר ההתאחדות כל כמה שעות. כשמשחק מקבל/משנה <b>שעה או תאריך</b> הוא יופיע כאן
                לאישורך. אפשר גם לערוך משחק ידנית, לשמור ללו"ז ולשלוח פוש — הכל מכאן.
            </p>

            {msg && <div style={{ margin: '0.6rem 0', background: msg.startsWith('⚠️') ? '#fee2e2' : '#ecfdf5', color: msg.startsWith('⚠️') ? '#b91c1c' : '#065f46', padding: '0.7rem 1rem', borderRadius: 8 }}>{msg}</div>}

            {/* Pending approvals */}
            <h4 style={{ marginBottom: '0.5rem' }}>ממתינים לאישור {pending.length > 0 && <span style={{ background: '#ef4444', color: '#fff', borderRadius: 999, padding: '0 8px', fontSize: '0.8rem' }}>{pending.length}</span>}</h4>
            {pending.length === 0 && <div style={{ color: '#94a3b8', marginBottom: '1rem' }}>אין משחקים שממתינים לאישור. 👌</div>}
            {pending.map((g) => (
                <div key={g.id} style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '0.9rem 1rem', marginBottom: '0.7rem' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>{gameLine(g)}{g.field ? <span style={{ color: '#64748b' }}> · {g.field}</span> : ''}<div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>{g.league}</div></div>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button disabled={busy === g.id} onClick={() => act(g.id, 'approve')} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 9, padding: '0.55rem 1rem', fontWeight: 800, cursor: 'pointer' }}>✅ אשר ושלח</button>
                            <button onClick={() => (editing === g.id ? setEditing('') : startEdit(g))} style={{ background: '#eef2ff', color: '#3730a3', border: '1px solid #c7d2fe', borderRadius: 9, padding: '0.55rem 0.9rem', fontWeight: 700, cursor: 'pointer' }}>✏️ ערוך</button>
                            <button disabled={busy === g.id} onClick={() => act(g.id, 'reject')} style={{ background: '#fff', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 9, padding: '0.55rem 0.9rem', fontWeight: 700, cursor: 'pointer' }}>דחה</button>
                        </div>
                    </div>
                    {editing === g.id && editBox(g, true)}
                </div>
            ))}

            {/* Tracked, collapsed by week */}
            <h4 style={{ marginTop: '1.6rem', marginBottom: '0.5rem' }}>במעקב ({tracked.length})</h4>
            {weekKeys.length === 0 && <div style={{ color: '#94a3b8' }}>אין עדיין משחקים במעקב.</div>}
            {weekKeys.map((w) => {
                const open = openWeeks[w] ?? (w === todayWeek);
                return (
                    <div key={w} style={{ border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: '0.6rem', overflow: 'hidden' }}>
                        <button onClick={() => setOpenWeeks({ ...openWeeks, [w]: !open })} style={{ width: '100%', textAlign: 'right', background: '#f8fafc', border: 'none', padding: '0.6rem 0.9rem', fontWeight: 800, cursor: 'pointer', color: '#334155', display: 'flex', justifyContent: 'space-between' }}>
                            <span>{open ? '▾' : '▸'} שבוע {w === 'other' ? '—' : heDate(w)}</span>
                            <span style={{ color: '#94a3b8', fontWeight: 600 }}>{weeks[w].filter((g) => g.opponent && g.opponent !== 'חופשית').length} משחקים</span>
                        </button>
                        {open && (
                            <div style={{ padding: '0.3rem 0.9rem 0.6rem' }}>
                                {(() => {
                                    // Group this week's games BY TEAM, so each club team appears once with its
                                    // games under it (not the same name repeated). Byes ("חופשית") are hidden.
                                    const real = weeks[w].filter((g) => g.opponent && g.opponent !== 'חופשית');
                                    const byTeam = {};
                                    real.forEach((g) => { const k = g.team || '—'; (byTeam[k] = byTeam[k] || []).push(g); });
                                    return Object.keys(byTeam).sort().map((team) => (
                                        <div key={team} style={{ marginBottom: '0.5rem' }}>
                                            <div style={{ fontWeight: 800, color: '#1e3a8a', fontSize: '0.9rem', margin: '0.3rem 0' }}>{team}</div>
                                            {byTeam[team].sort((a, b) => (a.game_date + a.game_time).localeCompare(b.game_date + b.game_time)).map((g) => (
                                                <div key={g.id} style={{ padding: '0.35rem 0 0.35rem 0.8rem', borderBottom: '1px solid #f1f5f9', fontSize: '0.88rem' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                        <span><span style={{ color: '#64748b' }}>נגד {g.opponent}{g.home_away ? ` (${g.home_away})` : ''}</span> · {g.game_date ? heDate(g.game_date) : <span style={{ color: '#d97706' }}>חסר תאריך</span>} · <b style={{ color: hasTime(g.game_time) ? '#0f1b33' : '#d97706' }}>{hasTime(g.game_time) ? g.game_time : 'חסר שעה'}</b></span>
                                                        <button onClick={() => (editing === g.id ? setEditing('') : startEdit(g))} style={{ background: '#eef2ff', color: '#3730a3', border: '1px solid #c7d2fe', borderRadius: 8, padding: '0.3rem 0.7rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.82rem' }}>✏️ ערוך</button>
                                                    </div>
                                                    {editing === g.id && editBox(g, true)}
                                                </div>
                                            ))}
                                        </div>
                                    ));
                                })()}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Unmapped — tucked away */}
            {unmapped.length > 0 && (
                <div style={{ marginTop: '1.4rem' }}>
                    <button onClick={() => setShowUnmapped(!showUnmapped)} style={{ background: 'none', border: 'none', color: '#64748b', fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                        {showUnmapped ? '▾' : '▸'} לא זוהתה קבוצה ({unmapped.length}) — בוגרים/גביעים, לא נשלח פוש
                    </button>
                    {showUnmapped && (
                        <div style={{ marginTop: '0.5rem' }}>
                            <p style={{ color: '#94a3b8', fontSize: '0.84rem', marginTop: 0 }}>רוצה להוסיף אחד מהם ללו"ז? ערוך, שייך קבוצה, שמור — יישלח פוש.</p>
                            {unmapped.map((g) => (
                                <div key={g.id} style={{ padding: '0.45rem 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.88rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                        <span style={{ color: '#475569' }}>{g.game_name} · {g.game_date ? heDate(g.game_date) : '—'} · {hasTime(g.game_time) ? g.game_time : 'ללא שעה'} <span style={{ color: '#94a3b8' }}>({g.league})</span></span>
                                        <button onClick={() => (editing === g.id ? setEditing('') : startEdit(g))} style={{ background: '#eef2ff', color: '#3730a3', border: '1px solid #c7d2fe', borderRadius: 8, padding: '0.3rem 0.7rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.82rem' }}>➕ שייך ושמור</button>
                                    </div>
                                    {editing === g.id && editBox(g, true)}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
