import { useState, useEffect, useCallback } from 'react';
import { authHeaders } from '../adminApi.js';

// Manager tool: take the current Google Sheet (the draft) and publish it to the DB
// as the live schedule for its week. Shows the result + publication history.
export default function PublishPanel({ clubSlug }) {
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [pubs, setPubs] = useState([]);
    const [viewing, setViewing] = useState(null); // { week, sessions } archive view

    const HEB = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const view = async (p) => {
        try {
            const r = await fetch(`/api/${clubSlug}/publications/${p.id}`, { headers: authHeaders(clubSlug) });
            const d = await r.json();
            setViewing({ week: p.week_start, status: p.status, sessions: d.sessions || [] });
        } catch { /* ignore */ }
    };

    const loadPubs = useCallback(() => {
        fetch(`/api/${clubSlug}/publications`)
            .then((r) => r.json())
            .then((d) => Array.isArray(d) && setPubs(d))
            .catch(() => { /* server may be down in dev */ });
    }, [clubSlug]);

    useEffect(() => { loadPubs(); }, [loadPubs]);

    const publish = async () => {
        if (!window.confirm('לפרסם את הלוז הנוכחי מהגיליון אל הלוז החי? פעולה זו תחליף את הלוז החי לשבוע זה.')) return;
        setBusy(true); setError(''); setResult(null);
        try {
            const res = await fetch(`/api/${clubSlug}/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders(clubSlug) },
                body: JSON.stringify({}),
            });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || 'שגיאת פרסום');
            setResult(d);
            loadPubs();
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <h3 style={{ marginTop: 0 }}>🚀 פרסום לוז</h3>
            <p style={{ color: '#475569', maxWidth: 640 }}>
                הגיליון הוא טיוטת העבודה. בלחיצת <b>פרסם</b> המערכת מושכת את הלוז מהגיליון ושומרת אותו ל-DB
                כ<b>לוז החי</b> לשבוע. עריכות בגיליון לא ישפיעו על הלוז החי עד הפרסום הבא.
            </p>

            <button
                onClick={publish}
                disabled={busy}
                style={{ background: '#16a34a', color: 'white', border: 'none', padding: '0.85rem 1.6rem', borderRadius: 10, fontWeight: 'bold', fontSize: '1rem', cursor: busy ? 'wait' : 'pointer' }}
            >
                {busy ? 'מפרסם…' : '📢 פרסם לוז'}
            </button>

            {error && <div style={{ marginTop: '1rem', background: '#fee2e2', color: '#b91c1c', padding: '0.8rem 1rem', borderRadius: 8 }}>שגיאה: {error}</div>}

            {result && (
                <div style={{ marginTop: '1rem', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '1rem', borderRadius: 8 }}>
                    <div style={{ fontWeight: 700, color: '#065f46' }}>✓ פורסם לשבוע {result.weekStart}</div>
                    <div style={{ color: '#334155', marginTop: 4 }}>{result.sessionCount} אימונים נשמרו ל-DB.</div>
                    {result.conflicts?.length > 0 && (
                        <div style={{ marginTop: '0.6rem' }}>
                            <div style={{ fontWeight: 600, color: '#b45309' }}>⚠️ {result.conflicts.length} התנגשויות מגרש/שעה:</div>
                            <ul style={{ margin: '0.3rem 0', paddingInlineStart: '1.2rem', color: '#92400e', fontSize: '0.9rem' }}>
                                {result.conflicts.slice(0, 10).map((c, i) => (
                                    <li key={i}>{c.hall} · {c.date} · {c.start_time} — {(c.teams || []).join(', ')}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            <h4 style={{ marginTop: '2rem', marginBottom: '0.5rem' }}>פרסומים אחרונים</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                    <tr style={{ textAlign: 'right', color: '#64748b', borderBottom: '2px solid #e2e8f0' }}>
                        <th style={{ padding: '0.5rem' }}>שבוע</th>
                        <th style={{ padding: '0.5rem' }}>סטטוס</th>
                        <th style={{ padding: '0.5rem' }}>אימונים</th>
                        <th style={{ padding: '0.5rem' }}>פורסם</th>
                        <th style={{ padding: '0.5rem' }}>ע"י</th>
                        <th style={{ padding: '0.5rem' }}></th>
                    </tr>
                </thead>
                <tbody>
                    {pubs.length === 0 && <tr><td colSpan={6} style={{ padding: '0.8rem', color: '#94a3b8' }}>אין פרסומים עדיין.</td></tr>}
                    {pubs.map((p) => (
                        <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '0.5rem' }}>{p.week_start}</td>
                            <td style={{ padding: '0.5rem' }}>
                                <span style={{ padding: '0.1rem 0.5rem', borderRadius: 12, fontSize: '0.8rem', background: p.status === 'live' ? '#dcfce7' : '#f1f5f9', color: p.status === 'live' ? '#166534' : '#64748b' }}>
                                    {p.status === 'live' ? 'חי' : 'ארכיון'}
                                </span>
                            </td>
                            <td style={{ padding: '0.5rem' }}>{p.sessions}</td>
                            <td style={{ padding: '0.5rem' }}>{new Date(p.published_at).toLocaleString('he-IL')}</td>
                            <td style={{ padding: '0.5rem' }}>{p.published_by}</td>
                            <td style={{ padding: '0.5rem' }}>
                                <button onClick={() => view(p)} style={{ background: '#eef2ff', border: '1px solid #c7d2fe', color: '#3730a3', borderRadius: 8, padding: '0.25rem 0.7rem', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem' }}>👁️ צפה</button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {viewing && (
                <div onClick={() => setViewing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: '1rem' }}>
                    <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', color: '#0f1b33', borderRadius: 16, width: 'min(640px,95vw)', maxHeight: '85vh', overflow: 'auto', padding: '1.3rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                            <h3 style={{ margin: 0 }}>📋 ארכיון לו"ז · שבוע {viewing.week} {viewing.status !== 'live' ? '(ארכיון)' : '(חי)'}</h3>
                            <button onClick={() => setViewing(null)} style={{ border: 'none', background: '#f1f5f9', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', fontSize: '1rem' }}>✕</button>
                        </div>
                        {viewing.sessions.length === 0 ? <div style={{ color: '#94a3b8' }}>אין אימונים.</div> : (
                            HEB.map((day, di) => {
                                const rows = viewing.sessions.filter((s) => s.day_of_week === di);
                                if (!rows.length) return null;
                                return (
                                    <div key={di} style={{ marginBottom: '0.9rem' }}>
                                        <div style={{ fontWeight: 800, color: '#3730a3', borderBottom: '1px solid #e2e8f0', paddingBottom: 4, marginBottom: 6 }}>{day}</div>
                                        {rows.map((s, i) => (
                                            <div key={i} style={{ display: 'flex', gap: '0.6rem', fontSize: '0.92rem', padding: '0.25rem 0', color: s.status === 'cancelled' ? '#b91c1c' : '#334155' }}>
                                                <b style={{ minWidth: 96 }}>{s.start_time}{s.end_time ? '-' + s.end_time : ''}</b>
                                                <span style={{ flex: 1 }}>{s.team}{s.coach ? ' · ' + s.coach : ''}</span>
                                                <span style={{ color: '#64748b' }}>{s.hall}</span>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
