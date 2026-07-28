import { useEffect, useState, useCallback } from 'react';
import { getActiveClub } from '../clubConfig.js';
import { authHeaders } from '../adminApi.js';

// Manager roster: who registered, grouped by team — NAMES ONLY. Phone/email are never
// sent to the client, so the manager can see participation without handling private data.
export default function MembersRoster() {
    const slug = getActiveClub().slug;
    const [data, setData] = useState(null);
    const [msg, setMsg] = useState('');

    const load = useCallback(() => {
        fetch(`/api/${slug}/members`, { headers: authHeaders(slug) })
            .then((r) => r.json())
            .then((d) => { if (d.error) setMsg('שגיאה: ' + d.error); else { setData(d); setMsg(''); } })
            .catch(() => setMsg('שגיאת תקשורת'));
    }, [slug]);

    useEffect(() => { load(); }, [load]);

    const chip = { background: '#eef2ff', color: '#3730a3', borderRadius: 20, padding: '0.2rem 0.7rem', fontSize: '0.85rem' };

    return (
        <div className="report-panel" style={{ marginTop: 0, color: '#0f1b33' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>👪 רשומים לקבוצות</h3>
                <button onClick={load} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 8, padding: '0.4rem 0.9rem', cursor: 'pointer' }}>↻ רענן</button>
            </div>
            <p style={{ color: '#64748b', fontSize: '0.85rem' }}>
                שמות בלבד — פרטי הקשר (טלפון/מייל) אינם מוצגים ונשמרים רק לצורך שליחת עדכונים.
                {data ? <b style={{ marginInlineStart: '0.5rem' }}>סה"כ {data.total} רשומים</b> : null}
                {msg && <b style={{ marginInlineStart: '0.5rem', color: '#ef4444' }}>{msg}</b>}
            </p>

            {!data && !msg && <div style={{ color: '#94a3b8' }}>טוען…</div>}
            {data && data.teams.length === 0 && data.operators.length === 0 && (
                <div style={{ color: '#94a3b8' }}>אין רשומים עדיין. שתפו את לינקי ההזמנה כדי שהורים יירשמו.</div>
            )}

            <div style={{ display: 'grid', gap: '0.7rem' }}>
                {data && data.teams.map((t) => (
                    <div key={t.team} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '0.7rem 0.9rem' }}>
                        <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{t.team} <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: '0.85rem' }}>· {t.names.length}</span></div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                            {t.names.map((n, i) => <span key={i} style={chip}>{n}</span>)}
                        </div>
                    </div>
                ))}
                {data && data.operators.length > 0 && (
                    <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '0.7rem 0.9rem' }}>
                        <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>מפעילים <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: '0.85rem' }}>· {data.operators.length}</span></div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                            {data.operators.map((n, i) => <span key={i} style={{ ...chip, background: '#ffedd5', color: '#9a3412' }}>{n}</span>)}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
