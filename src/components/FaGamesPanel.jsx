import { useState, useEffect, useCallback } from 'react';
import { authHeaders } from '../adminApi.js';

// Manager view of the FA-games sync: fixtures pulled from the Israel FA site by the Cloudflare Worker.
// Shows what's waiting for approval (a game whose time/date was just set/changed → one tap sends it to
// parents), plus everything being tracked and anything the system couldn't map to a team.
const heDate = (ymd) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || ''); return m ? `${m[3]}/${m[2]}` : (ymd || ''); };
const hasTime = (t) => Boolean(t) && t !== '00:00';

const STATUS = {
    pending: { label: 'ממתין לאישור', bg: '#fef3c7', fg: '#92400e' },
    applied: { label: 'פורסם', bg: '#dcfce7', fg: '#166534' },
    tracking: { label: 'במעקב', bg: '#eef2ff', fg: '#3730a3' },
    unmapped: { label: 'לא מזוהה', bg: '#f1f5f9', fg: '#64748b' },
    rejected: { label: 'נדחה', bg: '#fee2e2', fg: '#b91c1c' },
};

export default function FaGamesPanel({ clubSlug }) {
    const [games, setGames] = useState([]);
    const [busy, setBusy] = useState('');
    const [msg, setMsg] = useState('');

    const load = useCallback(() => {
        fetch(`/api/${clubSlug}/fa?status=all`, { headers: authHeaders(clubSlug) })
            .then((r) => r.json()).then((d) => setGames(Array.isArray(d.games) ? d.games : [])).catch(() => { /* dev */ });
    }, [clubSlug]);
    useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

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

    const pending = games.filter((g) => g.status === 'pending');
    const tracked = games.filter((g) => g.status === 'tracking' || g.status === 'applied');
    const unmapped = games.filter((g) => g.status === 'unmapped');
    const td = { padding: '0.45rem 0.5rem', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' };

    const row = (g) => {
        const t = hasTime(g.game_time);
        return (
            <tr key={g.id}>
                <td style={td}><b>{g.team || <span style={{ color: '#b91c1c' }}>—</span>}</b></td>
                <td style={td}>{g.opponent}{g.home_away ? ` (${g.home_away})` : ''}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{g.game_date ? heDate(g.game_date) : <span style={{ color: '#d97706' }}>חסר תאריך</span>}</td>
                <td style={{ ...td, whiteSpace: 'nowrap', color: t ? '#0f1b33' : '#d97706', fontWeight: t ? 700 : 400 }}>{t ? g.game_time : 'חסר שעה'}</td>
                <td style={{ ...td, color: '#64748b', fontSize: '0.82rem' }}>{g.league}</td>
            </tr>
        );
    };

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <h3 style={{ marginTop: 0 }}>⚽ משחקי ליגה (התאחדות)</h3>
            <p style={{ color: '#475569', maxWidth: 680 }}>
                המערכת מושכת אוטומטית את לוח המשחקים מאתר ההתאחדות כל כמה שעות. כשמשחק מקבל או משנה
                <b> שעה/תאריך</b> — הוא מופיע כאן לאישורך, ובלחיצה אחת נשלח פוש להורים של אותה קבוצה
                והמשחק נכנס ללו"ז.
            </p>

            {msg && <div style={{ margin: '0.6rem 0', background: msg.startsWith('⚠️') ? '#fee2e2' : '#ecfdf5', color: msg.startsWith('⚠️') ? '#b91c1c' : '#065f46', padding: '0.7rem 1rem', borderRadius: 8 }}>{msg}</div>}

            <h4 style={{ marginBottom: '0.5rem' }}>ממתינים לאישור {pending.length > 0 && <span style={{ background: '#ef4444', color: '#fff', borderRadius: 999, padding: '0 8px', fontSize: '0.8rem' }}>{pending.length}</span>}</h4>
            {pending.length === 0 && <div style={{ color: '#94a3b8', marginBottom: '1rem' }}>אין משחקים שממתינים לאישור. 👌</div>}
            {pending.map((g) => (
                <div key={g.id} style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '0.9rem 1rem', marginBottom: '0.7rem', display: 'flex', flexWrap: 'wrap', gap: '0.8rem', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ minWidth: 220 }}>
                        <div style={{ fontWeight: 800 }}>{g.team} <span style={{ color: '#92400e' }}>נגד {g.opponent}</span>{g.home_away ? ` (${g.home_away})` : ''}</div>
                        <div style={{ color: '#334155', marginTop: 2 }}>
                            {g.game_date ? heDate(g.game_date) : '—'} · <b>{hasTime(g.game_time) ? g.game_time : 'ללא שעה'}</b>
                            {g.field ? ` · ${g.field}` : ''}
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: 2 }}>{g.league}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button disabled={busy === g.id} onClick={() => act(g.id, 'approve')} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 9, padding: '0.6rem 1.1rem', fontWeight: 800, cursor: 'pointer' }}>✅ אשר ושלח</button>
                        <button disabled={busy === g.id} onClick={() => act(g.id, 'reject')} style={{ background: '#fff', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 9, padding: '0.6rem 1.1rem', fontWeight: 700, cursor: 'pointer' }}>דחה</button>
                    </div>
                </div>
            ))}

            {unmapped.length > 0 && (
                <>
                    <h4 style={{ marginTop: '1.6rem', marginBottom: '0.3rem' }}>לא זוהתה קבוצה ({unmapped.length})</h4>
                    <p style={{ color: '#94a3b8', fontSize: '0.86rem', marginTop: 0 }}>בעיקר בוגרים וגביעים — לא נשלח פוש עליהם. אפשר להתעלם או להוסיף ידנית בלשונית "פרסום משחקים".</p>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                        <tbody>{unmapped.map(row)}</tbody>
                    </table>
                </>
            )}

            <h4 style={{ marginTop: '1.6rem', marginBottom: '0.3rem' }}>במעקב ({tracked.length})</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                <thead>
                    <tr style={{ textAlign: 'right', color: '#64748b', borderBottom: '2px solid #e2e8f0' }}>
                        <th style={{ padding: '0.45rem 0.5rem' }}>קבוצה</th>
                        <th style={{ padding: '0.45rem 0.5rem' }}>יריב</th>
                        <th style={{ padding: '0.45rem 0.5rem' }}>תאריך</th>
                        <th style={{ padding: '0.45rem 0.5rem' }}>שעה</th>
                        <th style={{ padding: '0.45rem 0.5rem' }}>ליגה</th>
                    </tr>
                </thead>
                <tbody>
                    {tracked.length === 0 && <tr><td colSpan={5} style={{ padding: '0.8rem', color: '#94a3b8' }}>אין עדיין משחקים במעקב.</td></tr>}
                    {tracked.map(row)}
                </tbody>
            </table>
        </div>
    );
}
